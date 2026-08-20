// Canvas price chart: the full series, shaded drawdown episodes, the peak-to-date
// line, trade markers and the day-pointer cursor. No chart library — the page
// has to work from a static host with nothing external to fetch.

import { axisNumber, formatDate, percent, price as fmtPrice } from './format.js';
import { t } from './i18n.js';

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const Y_TICKS = 5; // 5 intervals -> 6 labels, matching the reference layout.

/**
 * Read from the stylesheet rather than repeated here. These were duplicated as
 * literals identical to --pos and --neg, which quietly broke the one edit the
 * palette is documented to support: swapping the pos and neg blocks for the
 * Greater China convention (red up, green down) flipped the whole interface
 * except the chart, leaving buy dots green on a page where green meant down.
 *
 * Resolved once at module load; nothing changes these at runtime.
 */
const token = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const COLORS = {
  price: token('--chart-price', '#3c5a68'),
  peak: token('--chart-peak', '#9c948a'),
  grid: token('--chart-grid', '#e2ded8'),
  axis: token('--chart-axis', '#6b655c'),
  episode: token('--neg-veil', 'rgba(192, 39, 31, 0.055)'),
  episodeEdge: token('--neg-veil-edge', 'rgba(192, 39, 31, 0.15)'),
  pointer: token('--accent', '#2d6e69'),
  buy: token('--pos', '#137a38'),
  sell: token('--neg', '#c0271f'),
  // Marker haloes punch back to the panel ground.
  ground: token('--chart-ground', '#fbfaf9'),
};

/**
 * The palette flips with the interface language — Greater China reads red as
 * rising — so the resolved values go stale the moment someone switches. The
 * page calls this before re-rendering rather than resolving on every draw,
 * which would put ten getComputedStyle calls inside the pan loop.
 */
function refreshColors() {
  COLORS.price = token('--chart-price', COLORS.price);
  COLORS.peak = token('--chart-peak', COLORS.peak);
  COLORS.grid = token('--chart-grid', COLORS.grid);
  COLORS.axis = token('--chart-axis', COLORS.axis);
  COLORS.episode = token('--neg-veil', COLORS.episode);
  COLORS.episodeEdge = token('--neg-veil-edge', COLORS.episodeEdge);
  COLORS.pointer = token('--accent', COLORS.pointer);
  COLORS.buy = token('--pos', COLORS.buy);
  COLORS.sell = token('--neg', COLORS.sell);
  COLORS.ground = token('--chart-ground', COLORS.ground);
}

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
      // Shape carries buy/sell, not only colour. Simulated on this palette,
      // green and red collapse to the same olive under protanopia (dE 16) and
      // deuteranopia (dE 25), and their luminances differ by 1.09:1, so a
      // colour-only marker leaves red-green viewers nothing to read. A
      // triangle pointing the way the trade goes survives every CVD type.
      const px = plot.x(i);
      const py = plot.y(closes[i]);
      const r = 4.5;
      ctx.beginPath();
      if (isBuy) {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py + r * 0.75);
        ctx.lineTo(px - r, py + r * 0.75);
      } else {
        ctx.moveTo(px, py + r);
        ctx.lineTo(px + r, py - r * 0.75);
        ctx.lineTo(px - r, py - r * 0.75);
      }
      ctx.closePath();
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

  /** Scrubbing has no event to read a client position from, only a local x. */
  function showTipAt(index, canvasX) {
    const rect = canvas.getBoundingClientRect();
    showTip(index, { clientX: rect.left + canvasX, clientY: rect.top + rect.height / 2 });
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

  /** Below this much travel a press is a tap, not a drag. */
  const TAP_SLOP = 5;

  /** Live pointers by id, so a second finger can turn a drag into a pinch. */
  const pointers = new Map();
  let pinch = null;
  let pan = null;

  /**
   * Hold still for this long and the press becomes a scrub: sliding left and
   * right then walks the day pointer through the history instead of panning the
   * window. Panning already owns a plain drag, and a tap already owns a single
   * date, so the long press is what was left to give the one gesture people
   * reach for on a phone — put a finger down, then go looking for a year.
   */
  const HOLD_MS = 350;
  let scrub = null;
  let holdTimer = null;

  function cancelHold() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  /** Shifts the window by whole bars, clamped to the data. */
  function panBy(bars) {
    const span = view.end - view.start;
    let start = Math.round(bars);
    if (start < 0) start = 0;
    if (start + span > state.closes.length - 1) start = state.closes.length - 1 - span;
    view = { start, end: start + span };
    onZoom?.(view.start > 0 || view.end < state.closes.length - 1);
  }

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
      // Second finger down: abandon the pan, start a pinch.
      cancelHold();
      scrub = null;
      canvas.classList.remove('is-scrubbing');
      pan = null;
      tipEl.hidden = true;
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.abs(a - b) || 1, span: view.end - view.start };
      return;
    }

    // A press starts a pan; it only becomes one once it has travelled. Releasing
    // without travelling is a tap, which sets the day pointer instead.
    pan = { originX: localX(event), startBar: view.start, moved: false };

    // ...unless it stays put long enough to become a scrub.
    const holdX = localX(event);
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!pan || pan.moved || pointers.size !== 1) return;
      pan = null;
      scrub = true;
      canvas.classList.add('is-scrubbing');
      const idx = plot.indexAt(holdX);
      hoverIndex = idx;
      onScrub(idx + 1);
      showTipAt(idx, holdX);
    }, HOLD_MS);
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

    if (scrub) {
      const x = localX(event);
      const idx = plot.indexAt(x);
      if (idx !== hoverIndex) {
        hoverIndex = idx;
        onScrub(idx + 1);
      }
      showTipAt(idx, x);
      return;
    }

    if (pan) {
      const dx = localX(event) - pan.originX;
      // Travelling before the hold fires means this was a drag all along.
      if (Math.abs(dx) >= TAP_SLOP) cancelHold();
      if (!pan.moved && Math.abs(dx) < TAP_SLOP) {
        // Still within the tap threshold — show the crosshair, do not pan yet.
        const idx = plot.indexAt(localX(event));
        hoverIndex = idx;
        showTip(idx, event);
        return;
      }
      pan.moved = true;
      tipEl.hidden = true;
      // Dragging right walks back in time, as on any chart.
      const barsPerPx = (view.end - view.start) / plot.innerW;
      panBy(pan.startBar - dx * barsPerPx);
      render();
      return;
    }

    const index = plot.indexAt(localX(event));
    if (index !== hoverIndex) hoverIndex = index;
    showTip(index, event);
  });

  const releasePointer = (event) => {
    pointers.delete(event.pointerId);
    cancelHold();
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && scrub) {
      scrub = null;
      canvas.classList.remove('is-scrubbing');
      tipEl.hidden = true;
    }
    if (pointers.size === 0) {
      // A press that never travelled is a tap: place the day pointer.
      if (pan && !pan.moved && plot) onScrub(plot.indexAt(localX(event)) + 1);
      pan = null;
    }
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  // A held finger otherwise raises a context menu mid-scrub.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

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

  return {
    render,
    resetView: () => { resetView(); render(); },
    refreshPalette: () => { refreshColors(); render(); },
  };
}
