// Canvas price chart: the full series, shaded drawdown episodes, the peak-to-date
// line, trade markers and the day-pointer cursor. No chart library — the page
// has to work from a static host with nothing external to fetch.

import { axisNumber, formatDate, percent, price as fmtPrice } from './format.js';

const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
const Y_TICKS = 5; // 5 intervals -> 6 labels, matching the reference layout.

const COLORS = {
  price: '#2c4f7c',
  peak: '#b6b0a4',
  grid: '#eeeae1',
  axis: '#98928a',
  episode: 'rgba(224, 49, 49, 0.06)',
  episodeEdge: 'rgba(224, 49, 49, 0.16)',
  pointer: '#b9a13a',
  buy: '#2f9e44',
  sell: '#e03131',
};

export function createChart(canvas, tipEl, { onScrub }) {
  const ctx = canvas.getContext('2d');
  let state = null;
  let plot = null; // { x(i), y(v), w, h, n }
  let hoverIndex = null;

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

  function buildScales(w, h) {
    const { closes } = state;
    const n = closes.length;
    let min = Infinity;
    let max = -Infinity;
    for (const c of closes) {
      if (c < min) min = c;
      if (c > max) max = c;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const innerW = Math.max(1, w - PAD.left - PAD.right);
    const innerH = Math.max(1, h - PAD.top - PAD.bottom);

    return {
      n,
      min,
      max,
      innerW,
      innerH,
      x: (i) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: (v) => PAD.top + innerH - ((v - min) / (max - min)) * innerH,
      indexAt: (px) => {
        const t = (px - PAD.left) / innerW;
        return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
      },
    };
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

    for (let i = 0; i <= Y_TICKS; i++) {
      const value = min + ((max - min) * i) / Y_TICKS;
      const py = Math.round(y(value)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(w - PAD.right, py);
      ctx.stroke();
      ctx.fillText(axisNumber(value), PAD.left - 8, py);
    }

    // Year boundaries along the bottom.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const { dates } = state;
    let lastLabelX = -Infinity;
    for (let i = 1; i < dates.length; i++) {
      if (dates[i].slice(0, 4) === dates[i - 1].slice(0, 4)) continue;
      const px = Math.round(plot.x(i)) + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(px, PAD.top);
      ctx.lineTo(px, h - PAD.bottom);
      ctx.stroke();
      if (px - lastLabelX < 34) continue;
      lastLabelX = px;
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(dates[i].slice(0, 4), px, h - PAD.bottom + 6);
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
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const px = plot.x(i);
      const py = plot.y(values[i]);
      if (i === 0) ctx.moveTo(px, py);
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
      if (i < 0 || i >= closes.length) continue;
      ctx.beginPath();
      ctx.arc(plot.x(i), plot.y(closes[i]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isBuy ? COLORS.buy : COLORS.sell;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPointer(h) {
    const i = state.day - 1;
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
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  function render(next) {
    if (next) state = next;
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
    tipEl.innerHTML =
      `<b>Day ${index + 1}</b> · ${formatDate(dates[index])}<br />` +
      `${fmtPrice(closes[index])}<br />` +
      `Drawdown ${percent(dd)}`;
    tipEl.hidden = false;

    const wrap = tipEl.parentElement.getBoundingClientRect();
    const x = event.clientX - wrap.left;
    const y = event.clientY - wrap.top;
    const tw = tipEl.offsetWidth;
    tipEl.style.left = `${Math.min(Math.max(6, x + 12), wrap.width - tw - 6)}px`;
    tipEl.style.top = `${Math.max(6, y - tipEl.offsetHeight - 12)}px`;
  }

  let scrubbing = false;

  canvas.addEventListener('pointerdown', (event) => {
    if (!plot) return;
    scrubbing = true;
    canvas.setPointerCapture(event.pointerId);
    onScrub(plot.indexAt(localX(event)) + 1);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!plot) return;
    const index = plot.indexAt(localX(event));
    if (scrubbing) onScrub(index + 1);
    if (index !== hoverIndex || scrubbing) hoverIndex = index;
    showTip(index, event);
  });

  const endScrub = (event) => {
    scrubbing = false;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', endScrub);
  canvas.addEventListener('pointercancel', endScrub);

  canvas.addEventListener('pointerleave', () => {
    hoverIndex = null;
    tipEl.hidden = true;
  });

  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => render());
  }).observe(canvas);

  return { render };
}
