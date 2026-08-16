// Canvas price chart: the full series, shaded drawdown episodes, the peak-to-date
// line, trade markers and the day-pointer cursor. No chart library — the page
// has to work from a static host with nothing external to fetch.

import { axisNumber, formatDate, percent, price as fmtPrice } from './format.js';
import { t } from './i18n.js';

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const Y_TICKS = 5; // 5 intervals -> 6 labels, matching the reference layout.

const COLORS = {
  price: '#3c5a68',
  peak: '#9c948a',
  grid: '#e2ded8',
  axis: '#6b655c',
  episode: 'rgba(192, 39, 31, 0.055)',
  episodeEdge: 'rgba(192, 39, 31, 0.15)',
  pointer: '#2d6e69',
  buy: '#137a38',
  sell: '#c0271f',
  // Marker haloes punch back to the panel ground.
  ground: '#fbfaf9',
};

/** Never zoom in past this many bars — beyond it the line is just dots. */
const MIN_VISIBLE = 8;

export function createChart(canvas, tipEl, { onScrub, onZoom }) {
  const ctx = canvas.getContext('2d');
  let state = null;
  let plot = null; // { x(i), y(v), w, h, n }
  let hoverIndex = null;
  /** Visible index window. Null until the first render sizes it to the data. */
  let view = null;

  function resetView() {
    view = state ? { start: 0, end: state.closes.length - 1 } : null;
    onZoom?.(false);
  }

  function clampView(start, end) {
    const n = state.closes.length;
    let a = Math.round(start);
    let b = Math.round(end);
    if (b - a + 1 < MIN_VISIBLE) {
      const mid = (a + b) / 2;
      a = Math.round(mid - MIN_VISIBLE / 2);
      b = a + MIN_VISIBLE - 1;
    }
    if (a < 0) { b -= a; a = 0; }
    if (b > n - 1) { a -= b - (n - 1); b = n - 1; }
    view = { start: Math.max(0, a), end: Math.min(n - 1, b) };
    onZoom?.(view.start > 0 || view.end < n - 1);
  }

  /**
   * Scales the window by `factor` about `anchor` (0..1 across the current view),
   * so the bar under the cursor or the pinch midpoint stays put.
   */
  function zoomBy(factor, anchor) {
    if (!view) return;
    const span = view.end - view.start;
    const focus = view.start + span * anchor;
    const next = span / factor;
    clampView(focus - next * anchor, focus + next * (1 - anchor));
    render();
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  // Bar timestamps, cached against the dates array they came from. The x axis
  // is time-based rather than index-based because the series can mix monthly
  // bars (pre-1990s) with daily ones — spacing those evenly would squeeze a
  // century of history into the same width as the last decade.
  let timeCache = { dates: null, times: [] };

  function timesFor(dates) {
    if (timeCache.dates !== dates) {
      timeCache = { dates, times: dates.map((d) => Date.parse(`${d}T00:00:00Z`)) };
    }
    return timeCache.times;
  }

  function buildScales(w, h) {
    const { closes, dates, peaks, visible } = state;
    const n = closes.length;
    if (!view || view.end > n - 1) resetView();

    // Range over the *visible* slice, so zooming in actually magnifies the
    // wiggles instead of leaving them squashed against the full-history scale.
    let min = Infinity;
    let max = -Infinity;
    for (let i = view.start; i <= view.end; i++) {
      if (closes[i] < min) min = closes[i];
      if (closes[i] > max) max = closes[i];
      if (visible.peak && peaks[i] > max) max = peaks[i];
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const times = timesFor(dates);
    const tMin = times[view.start];
    const tMax = times[view.end];
    const tSpan = tMax - tMin || 1;

    const innerW = Math.max(1, w - PAD.left - PAD.right);
    const innerH = Math.max(1, h - PAD.top - PAD.bottom);

    // Over a century the index grows ~1700x, so a linear axis would press
    // everything before 1980 flat against the floor. Log keeps equal percentage
    // moves the same height, which is what a drawdown tool is about.
    const log = state.logScale;
    const lo = log ? Math.log(min) : min;
    const hi = log ? Math.log(max) : max;
    const span = hi - lo || 1;

    const x = (i) => PAD.left + ((times[i] - tMin) / tSpan) * innerW;

    return {
      n,
      min,
      max,
      innerW,
      innerH,
      times,
      tMin,
      tMax,
      x,
      xAtTime: (t) => PAD.left + ((t - tMin) / tSpan) * innerW,
      y: (v) => PAD.top + innerH - (((log ? Math.log(v) : v) - lo) / span) * innerH,
      ticks: log ? logTicks(min, max) : linearTicks(min, max),
      view,
      indexAt: (px) => {
        const target = tMin + ((px - PAD.left) / innerW) * tSpan;
        let lo = view.start;
        let hi = view.end;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        // Snap to whichever neighbour is actually closer in time.
        if (lo > 0 && Math.abs(times[lo - 1] - target) <= Math.abs(times[lo] - target)) lo--;
        return lo;
      },
    };
  }

  /** Evenly spaced values spanning the data, as the linear axis always used. */
  function linearTicks(min, max) {
    return Array.from({ length: Y_TICKS + 1 }, (_, i) => min + ((max - min) * i) / Y_TICKS);
  }

  /** 1-2-5 decade steps, the conventional log-axis ladder. */
  function logTicks(min, max) {
    const out = [];
    for (let exp = Math.floor(Math.log10(min)); exp <= Math.ceil(Math.log10(max)); exp++) {
      for (const mantissa of [1, 2, 5]) {
        const value = mantissa * 10 ** exp;
        if (value >= min && value <= max) out.push(value);
      }
    }
    // Very narrow ranges can fall between rungs; fall back rather than show none.
    return out.length >= 3 ? out : linearTicks(min, max);
  }

  /** Year step that yields roughly 8–12 labels across the visible span. */
  function yearStep(spanYears) {
    for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) {
      if (spanYears / step <= 12) return step;
    }
    return 200;
  }

  function drawGrid(w, h) {
    const { min, max, y } = plot;
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.axis;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const value of plot.ticks) {
      const py = Math.round(y(value)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(w - PAD.right, py);
      ctx.stroke();
      ctx.fillText(axisNumber(value), PAD.left - 8, py);
    }

    // Year gridlines on a round step, placed by date so a 150-year series and a
    // 10-year one are both readable.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const firstYear = new Date(plot.tMin).getUTCFullYear();
    const lastYear = new Date(plot.tMax).getUTCFullYear();
    const step = yearStep(lastYear - firstYear || 1);
    const startYear = Math.ceil(firstYear / step) * step;

    for (let year = startYear; year <= lastYear; year += step) {
      const px = Math.round(plot.xAtTime(Date.UTC(year, 0, 1))) + 0.5;
      if (px < PAD.left || px > w - PAD.right) continue;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(px, PAD.top);
      ctx.lineTo(px, h - PAD.bottom);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(String(year), px, h - PAD.bottom + 6);
    }
    ctx.restore();
  }

  function drawEpisodes(h) {
    ctx.save();
    for (const ep of state.episodes) {
      const x0 = plot.x(ep.start);
      const x1 = plot.x(ep.end);
      ctx.fillStyle = COLORS.episode;
      ctx.fillRect(x0, PAD.top, Math.max(1, x1 - x0), h - PAD.bottom - PAD.top);
      ctx.strokeStyle = COLORS.episodeEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x1) + 0.5, PAD.top);
      ctx.lineTo(Math.round(x1) + 0.5, h - PAD.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSeries(values, style) {
    // One bar of overscan each side so the line enters and leaves the frame.
    const from = Math.max(0, plot.view.start - 1);
    const to = Math.min(values.length - 1, plot.view.end + 1);
    ctx.save();
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const px = plot.x(i);
      const py = plot.y(values[i]);
      if (i === from) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    Object.assign(ctx, style);
    ctx.stroke();
    ctx.restore();
  }

  function drawMarkers() {
    const { trades, visible, closes } = state;
    ctx.save();
    for (const trade of trades) {
      const isBuy = trade.action === 'BUY';
      if (isBuy && !visible.buy) continue;
      if (!isBuy && !visible.sell) continue;
      const i = trade.day - 1;
      if (i < plot.view.start || i > plot.view.end) continue;
      ctx.beginPath();
      ctx.arc(plot.x(i), plot.y(closes[i]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isBuy ? COLORS.buy : COLORS.sell;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.ground;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPointer(h) {
    const i = state.day - 1;
    if (i < plot.view.start || i > plot.view.end) return;
    const px = Math.round(plot.x(i)) + 0.5;
    ctx.save();
    ctx.strokeStyle = COLORS.pointer;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, PAD.top);
    ctx.lineTo(px, h - PAD.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(px, plot.y(state.closes[i]), 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pointer;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.ground;
    ctx.stroke();
    ctx.restore();
  }

  function render(next) {
    if (next) {
      // A different series (new symbol, or fresh data) invalidates the window.
      if (state && next.closes !== state.closes) view = null;
      state = next;
    }
    if (!state) return;

    const { w, h } = layout();
    ctx.clearRect(0, 0, w, h);
    plot = buildScales(w, h);

    drawEpisodes(h);
    drawGrid(w, h);
    if (state.visible.peak) {
      ctx.setLineDash([4, 4]);
      drawSeries(state.peaks, { strokeStyle: COLORS.peak, lineWidth: 1 });
      ctx.setLineDash([]);
    }
    if (state.visible.price) {
      drawSeries(state.closes, {
        strokeStyle: COLORS.price,
        lineWidth: 1.25,
        lineJoin: 'round',
        lineCap: 'round',
      });
    }
    drawMarkers();
    drawPointer(h);
  }

  /* ------------------------------------------------------------ pointing */

  function localX(event) {
    return event.clientX - canvas.getBoundingClientRect().left;
  }

  function showTip(index, event) {
    const { dates, closes, peaks } = state;
    const dd = closes[index] / peaks[index] - 1;
    tipEl.innerHTML = t('chart.tip', index + 1, formatDate(dates[index]), fmtPrice(closes[index]), percent(dd));
    tipEl.hidden = false;

    const wrap = tipEl.parentElement.getBoundingClientRect();
    const x = event.clientX - wrap.left;
    const y = event.clientY - wrap.top;
    const tw = tipEl.offsetWidth;
    tipEl.style.left = `${Math.min(Math.max(6, x + 12), wrap.width - tw - 6)}px`;
    tipEl.style.top = `${Math.max(6, y - tipEl.offsetHeight - 12)}px`;
  }

  let scrubbing = false;
  /** Live pointers by id, so a second finger can turn a scrub into a pinch. */
  const pointers = new Map();
  let pinch = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (!plot) return;
    pointers.set(event.pointerId, localX(event));
    // Capture is a nicety — it keeps a drag alive outside the canvas — but it
    // throws for pointers the element never saw. Losing it must not abort the
    // gesture setup below.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* gesture still works without capture */
    }

    if (pointers.size === 2) {
      // Second finger down: abandon the scrub, start a pinch.
      scrubbing = false;
      tipEl.hidden = true;
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.abs(a - b) || 1, span: view.end - view.start };
      return;
    }
    scrubbing = true;
    onScrub(plot.indexAt(localX(event)) + 1);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!plot) return;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, localX(event));

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.abs(a - b) || 1;
      const mid = (a + b) / 2;
      const anchor = Math.min(1, Math.max(0, (mid - PAD.left) / plot.innerW));
      const focus = view.start + (view.end - view.start) * anchor;
      const span = pinch.span * (pinch.distance / distance);
      clampView(focus - span * anchor, focus + span * (1 - anchor));
      render();
      return;
    }

    const index = plot.indexAt(localX(event));
    if (scrubbing) onScrub(index + 1);
    if (index !== hoverIndex || scrubbing) hoverIndex = index;
    showTip(index, event);
  });

  const releasePointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) scrubbing = false;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  // Wheel and trackpad pinch (which arrives as ctrl+wheel) zoom about the cursor.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!plot) return;
      event.preventDefault();
      const anchor = Math.min(1, Math.max(0, (localX(event) - PAD.left) / plot.innerW));
      zoomBy(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), anchor);
    },
    { passive: false }
  );

  canvas.addEventListener('dblclick', () => {
    resetView();
    render();
  });

  canvas.addEventListener('pointerleave', () => {
    hoverIndex = null;
    tipEl.hidden = true;
  });

  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => render());
  }).observe(canvas);

  return { render, resetView: () => { resetView(); render(); } };
}
