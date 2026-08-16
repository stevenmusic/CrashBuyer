// Wiring: load the series, hold the simulation state, render every panel.

import { loadSeries, bootstrapSeries, refreshLive, isStale, daysSince } from './data.js';
import {
  runningPeaks,
  drawdownEpisodes,
  indexOnOrAfter,
  buildLedger,
  portfolioAt,
  allocationRows,
  METER_FLOOR,
} from './model.js';
import { createChart } from './chart.js';
import { formatDate, money, moneySigned, percent, percentSigned, price as fmtPrice, units as fmtUnits } from './format.js';

const STORE_KEY = 'crashbuyer.v1';
const DEFAULT_CASH = 200000;

/** Jump targets, anchored on the market peak that preceded each selloff. */
const PRESETS = [
  { label: 'START', tone: 'neutral', at: 'first' },
  { label: '2018 Trade War', date: '2018-09-20' },
  { label: '2020 Covid', date: '2020-02-19' },
  { label: '2022 Inflation', date: '2022-01-03' },
  { label: '2025 Liberation Day', date: '2025-02-19' },
  { label: 'Latest', tone: 'neutral', at: 'last' },
];

const el = (id) => document.getElementById(id);

const dom = {
  layout: el('layout'),
  dataStatus: el('data-status'),
  dataError: el('data-error'),
  dataMeta: el('data-meta'),
  resetAll: el('reset-all'),

  dayPrev: el('day-prev'),
  dayNext: el('day-next'),
  dayInput: el('day-input'),
  dayTotal: el('day-total'),
  curDate: el('cur-date'),
  curPrice: el('cur-price'),
  curDd: el('cur-dd'),
  curPeak: el('cur-peak'),
  meterMarker: el('meter-marker'),
  presets: el('presets'),

  startingCash: el('starting-cash'),
  pfCash: el('pf-cash'),
  pfUnits: el('pf-units'),
  pfMv: el('pf-mv'),
  pfEquity: el('pf-equity'),
  pfPnl: el('pf-pnl'),
  pfRet: el('pf-ret'),
  pfPending: el('pf-pending'),

  allocBody: el('alloc-body'),

  chart: el('chart'),
  chartTip: el('chart-tip'),
  legend: el('chart-legend'),

  actBuy: el('act-buy'),
  actSell: el('act-sell'),
  amountInput: el('amount-input'),
  unitsOutput: el('units-output'),
  suggestBtn: el('suggest-btn'),
  executeBtn: el('execute-btn'),
  tradeMsg: el('trade-msg'),
  previewRow: el('preview-row'),

  logBody: el('log-body'),
  logCount: el('log-count'),
};

/* ------------------------------------------------------------------ state */

let series = null;
let peaks = [];
let episodes = [];
let chart = null;
let nextSeq = 1;

const state = {
  day: 1,
  startingCash: DEFAULT_CASH,
  action: 'BUY',
  trades: [],
  visible: { price: true, peak: true, buy: true, sell: true },
};

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        day: state.day,
        // The series is a rolling window, so old bars eventually drop off the
        // front and day numbers shift. The date is the stable anchor.
        dayDate: series.dates[state.day - 1],
        startingCash: state.startingCash,
        trades: state.trades,
        visible: state.visible,
      })
    );
  } catch {
    // Private-mode storage failures should not take the simulator down.
  }
}

function restore() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
  } catch {
    return;
  }
  if (!saved) return;

  if (Number.isFinite(saved.startingCash) && saved.startingCash >= 0) {
    state.startingCash = saved.startingCash;
  }
  if (Array.isArray(saved.trades)) {
    // Re-anchor by date: the series grows daily, so a stored day number would
    // silently point at the wrong bar once new data lands.
    state.trades = saved.trades
      .map((t) => {
        const day = indexOnOrAfter(series.dates, t.date) + 1;
        return day > 0 && series.dates[day - 1] === t.date ? { ...t, day, seq: nextSeq++ } : null;
      })
      .filter(Boolean);
  }
  if (saved.visible) Object.assign(state.visible, saved.visible);

  const anchored = saved.dayDate ? indexOnOrAfter(series.dates, saved.dayDate) + 1 : 0;
  state.day = clampDay(anchored > 0 ? anchored : saved.day ?? series.count);
}

/* -------------------------------------------------------------- selectors */

const clampDay = (day) => Math.min(series.dates.length, Math.max(1, Math.round(Number(day) || 1)));

function market() {
  const i = state.day - 1;
  const currentPrice = series.closes[i];
  const peak = peaks[i];
  return { i, date: series.dates[i], currentPrice, peak, drawdown: currentPrice / peak - 1 };
}

function ledger() {
  return buildLedger(state.trades, state.startingCash);
}

/* ---------------------------------------------------------------- actions */

function setDay(day, { persist = true } = {}) {
  const next = clampDay(day);
  if (next === state.day) return;
  state.day = next;
  if (persist) save();
  render();
}

function setAction(action) {
  state.action = action;
  dom.actBuy.classList.toggle('is-active', action === 'BUY');
  dom.actSell.classList.toggle('is-active', action === 'SELL');
  dom.actBuy.setAttribute('aria-pressed', String(action === 'BUY'));
  dom.actSell.setAttribute('aria-pressed', String(action === 'SELL'));
  render();
}

function message(text, tone = 'error') {
  dom.tradeMsg.textContent = text;
  dom.tradeMsg.dataset.tone = tone;
  dom.tradeMsg.hidden = !text;
}

/** The trade the inputs currently describe, or null when the amount is empty. */
function draftTrade() {
  const amount = Number(dom.amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const { date, currentPrice } = market();
  return {
    id: `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    seq: nextSeq,
    day: state.day,
    date,
    price: currentPrice,
    action: state.action,
    amount,
    units: amount / currentPrice,
    note: '',
  };
}

function execute() {
  const draft = draftTrade();
  if (!draft) {
    message('Enter an amount greater than zero.');
    return;
  }

  const candidate = buildLedger([...state.trades, draft], state.startingCash);
  if (candidate.error) {
    message(candidate.error);
    return;
  }

  nextSeq++;
  state.trades.push(draft);
  dom.amountInput.value = '0';
  message(
    `${draft.action} ${fmtUnits(draft.units)} units at ${fmtPrice(draft.price)} on ${formatDate(draft.date)}.`,
    'ok'
  );
  save();
  render();
}

function suggest() {
  const { currentPrice, peak, drawdown } = market();
  const rows = ledger().rows;
  const pf = portfolioAt(rows, state.startingCash, state.day, currentPrice);

  if (state.action === 'SELL') {
    if (pf.units <= 0) {
      message('No units held at this date to sell.');
      return;
    }
    dom.amountInput.value = (Math.floor(pf.marketValue * 100) / 100).toFixed(2);
    message(`Suggested: sell the full position (${fmtUnits(pf.units)} units).`, 'ok');
    render();
    return;
  }

  const armed = allocationRows(peak, state.startingCash, drawdown).filter((r) => r.armed);
  if (!armed.length) {
    message(`No allocation rung is armed at ${percent(drawdown)} — the first rung triggers at −10%.`);
    return;
  }
  if (pf.cash <= 0) {
    message('No cash left to deploy at this date.');
    return;
  }

  const deepest = armed[armed.length - 1];
  const amount = Math.min(deepest.amount, pf.cash);
  dom.amountInput.value = String(Math.round(amount));
  message(
    `Suggested: the −${(deepest.drawdown * 100).toFixed(0)}% rung — ${(deepest.invest * 100).toFixed(0)}% of starting cash${
      amount < deepest.amount ? ', capped by remaining cash' : ''
    }.`,
    'ok'
  );
  render();
}

function removeTrade(id) {
  state.trades = state.trades.filter((t) => t.id !== id);
  message('');
  save();
  render();
}

function resetAll() {
  if (!confirm('Clear all trades and restore the default starting cash?')) return;
  state.trades = [];
  state.startingCash = DEFAULT_CASH;
  state.day = series.count;
  dom.startingCash.value = String(DEFAULT_CASH);
  dom.amountInput.value = '0';
  message('');
  save();
  render();
}

/* ----------------------------------------------------------------- render */

function renderMarket({ date, currentPrice, peak, drawdown }) {
  dom.dayInput.value = String(state.day);
  dom.dayInput.max = String(series.count);
  dom.dayTotal.textContent = series.count.toLocaleString('en-US');
  dom.dayPrev.disabled = state.day <= 1;
  dom.dayNext.disabled = state.day >= series.count;

  dom.curDate.textContent = formatDate(date);
  dom.curPrice.textContent = fmtPrice(currentPrice);
  dom.curDd.textContent = percent(drawdown);
  dom.curDd.classList.toggle('is-loss', drawdown < -0.0001);
  dom.curPeak.textContent = fmtPrice(peak);

  const pinned = Math.min(1, Math.max(0, -drawdown / METER_FLOOR));
  dom.meterMarker.style.left = `${pinned * 100}%`;

  for (const button of dom.presets.children) {
    button.classList.toggle('is-current', Number(button.dataset.day) === state.day);
  }
}

function renderPortfolio(pf) {
  dom.pfCash.textContent = money(pf.cash);
  dom.pfUnits.textContent = fmtUnits(pf.units);
  dom.pfMv.textContent = money(pf.marketValue);
  dom.pfEquity.textContent = money(pf.equity);

  dom.pfPnl.textContent = moneySigned(pf.pnl);
  dom.pfPnl.className = `kv-value ${pf.pnl >= 0 ? 'is-gain' : 'is-loss'}`;
  dom.pfRet.textContent = percentSigned(pf.returnPct);
  dom.pfRet.className = `kv-value ${pf.returnPct >= 0 ? 'is-gain' : 'is-loss'}`;

  dom.pfPending.hidden = pf.pending === 0;
  dom.pfPending.textContent = pf.pending
    ? pf.pending === 1
      ? '1 logged trade happens after this date and is not counted yet.'
      : `${pf.pending} logged trades happen after this date and are not counted yet.`
    : '';
}

function renderAllocation({ peak, drawdown }) {
  const rows = allocationRows(peak, state.startingCash, drawdown);
  dom.allocBody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-armed', row.armed);
      tr.innerHTML =
        `<td class="alloc-dd">−${(row.drawdown * 100).toFixed(0)}%</td>` +
        `<td class="num">${fmtPrice(row.triggerPrice)}</td>` +
        `<td class="num">${(row.invest * 100).toFixed(0)}%</td>` +
        `<td class="num">${money(row.amount)}</td>` +
        `<td class="num"></td>`;

      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'use-btn';
      use.textContent = 'Use';
      use.addEventListener('click', () => {
        setAction('BUY');
        dom.amountInput.value = String(Math.round(row.amount));
        message(
          `Loaded the −${(row.drawdown * 100).toFixed(0)}% rung: ${money(row.amount)}. Execute to log it at ${formatDate(
            market().date
          )}.`,
          'ok'
        );
        render();
      });
      tr.lastElementChild.appendChild(use);
      return tr;
    })
  );
}

function renderPreview({ date, currentPrice }, rows) {
  const draft = draftTrade();
  dom.unitsOutput.value = draft ? fmtUnits(draft.units) : '0.0000';

  if (!draft) {
    dom.previewRow.innerHTML = '<td colspan="9" class="empty">Enter an amount to preview the trade.</td>';
    dom.executeBtn.disabled = false;
    return;
  }

  const candidate = buildLedger([...state.trades, draft], state.startingCash);
  const row = candidate.rows.find((r) => r.id === draft.id);
  const tag = draft.action === 'BUY' ? 'tag-buy' : 'tag-sell';

  dom.previewRow.innerHTML =
    `<td>${state.day}</td>` +
    `<td>${formatDate(date)}</td>` +
    `<td class="num">${fmtPrice(currentPrice)}</td>` +
    `<td><span class="tag ${tag}">${draft.action}</span></td>` +
    `<td class="num">${fmtUnits(row.units)}</td>` +
    `<td class="num">${money(row.amount)}</td>` +
    `<td class="num">${money(row.cashAfter)}</td>` +
    `<td class="num">${fmtUnits(row.unitsAfter)}</td>` +
    `<td class="num">${money(row.equityAfter)}</td>`;

  dom.executeBtn.disabled = Boolean(candidate.error);
  if (candidate.error) message(candidate.error);
}

function renderLog(rows) {
  dom.logCount.textContent = `${rows.length} trade${rows.length === 1 ? '' : 's'} logged`;

  if (!rows.length) {
    dom.logBody.innerHTML =
      '<tr><td colspan="12" class="empty">No trades yet — rewind to a crash and buy the dip.</td></tr>';
    return;
  }

  dom.logBody.replaceChildren(
    ...rows.map((row, index) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-future', row.day > state.day);
      tr.innerHTML =
        `<td class="num">${index + 1}</td>` +
        `<td class="num">${row.day}</td>` +
        `<td>${formatDate(row.date)}</td>` +
        `<td class="num">${fmtPrice(row.price)}</td>` +
        `<td><span class="tag ${row.action === 'BUY' ? 'tag-buy' : 'tag-sell'}">${row.action}</span></td>` +
        `<td class="num">${fmtUnits(row.units)}</td>` +
        `<td class="num">${money(row.amount)}</td>` +
        `<td class="num">${money(row.cashAfter)}</td>` +
        `<td class="num">${fmtUnits(row.unitsAfter)}</td>` +
        `<td class="num">${money(row.equityAfter)}</td>` +
        '<td></td><td class="num"></td>';

      const note = document.createElement('input');
      note.className = 'note-input';
      note.placeholder = 'add note…';
      note.value = row.note ?? '';
      note.addEventListener('change', () => {
        const trade = state.trades.find((t) => t.id === row.id);
        if (trade) trade.note = note.value;
        save();
      });
      tr.children[10].appendChild(note);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-btn';
      del.title = 'Delete trade';
      del.textContent = '✕';
      del.addEventListener('click', () => removeTrade(row.id));
      tr.children[11].appendChild(del);

      return tr;
    })
  );
}

function render() {
  const snapshot = market();
  const { rows } = ledger();

  renderMarket(snapshot);
  renderPortfolio(portfolioAt(rows, state.startingCash, state.day, snapshot.currentPrice));
  renderAllocation(snapshot);
  renderPreview(snapshot, rows);
  renderLog(rows);

  chart.render({
    dates: series.dates,
    closes: series.closes,
    peaks,
    episodes,
    day: state.day,
    trades: state.trades,
    visible: state.visible,
  });
}

/* ------------------------------------------------------------------ setup */

function buildPresets() {
  dom.presets.replaceChildren(
    ...PRESETS.map((preset) => {
      let day;
      if (preset.at === 'first') day = 1;
      else if (preset.at === 'last') day = series.count;
      else {
        const index = indexOnOrAfter(series.dates, preset.date);
        if (index < 0) return null; // Outside the loaded window.
        day = index + 1;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.textContent = preset.label;
      button.dataset.day = String(day);
      if (preset.tone) button.dataset.tone = preset.tone;
      button.addEventListener('click', () => setDay(day));
      return button;
    }).filter(Boolean)
  );
}

function bindEvents() {
  dom.dayPrev.addEventListener('click', () => setDay(state.day - 1));
  dom.dayNext.addEventListener('click', () => setDay(state.day + 1));
  dom.dayInput.addEventListener('change', () => setDay(dom.dayInput.value));

  dom.startingCash.addEventListener('change', () => {
    const value = Number(dom.startingCash.value);
    if (!Number.isFinite(value) || value < 0) {
      dom.startingCash.value = String(state.startingCash);
      return;
    }
    const check = buildLedger(state.trades, value);
    if (check.error) {
      dom.startingCash.value = String(state.startingCash);
      message(`Starting cash of ${money(value)} cannot fund the logged trades. ${check.error}`);
      return;
    }
    state.startingCash = value;
    message('');
    save();
    render();
  });

  dom.actBuy.addEventListener('click', () => setAction('BUY'));
  dom.actSell.addEventListener('click', () => setAction('SELL'));
  dom.amountInput.addEventListener('input', () => render());
  dom.suggestBtn.addEventListener('click', suggest);
  dom.executeBtn.addEventListener('click', execute);
  dom.resetAll.addEventListener('click', resetAll);

  dom.legend.addEventListener('click', (event) => {
    const button = event.target.closest('.legend-item');
    if (!button) return;
    const key = button.dataset.series;
    state.visible[key] = !state.visible[key];
    button.setAttribute('aria-pressed', String(state.visible[key]));
    save();
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.matches('input, textarea, select')) return;
    const step = event.shiftKey ? 20 : 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDay(state.day - step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setDay(state.day + step);
    }
  });
}

function renderDataStatus(live, bootstrapped) {
  const stale = isStale(series);
  const state_ = live?.ok || bootstrapped ? 'live' : stale ? 'error' : 'daily';
  const label = live?.ok
    ? `live · ${live.source} · ${formatDate(series.end)}`
    : bootstrapped
      ? `direct fetch · ${formatDate(series.end)}`
      : `daily snapshot · ${formatDate(series.end)}`;

  dom.dataStatus.dataset.state = state_;
  dom.dataStatus.textContent = label;
  dom.dataStatus.title = live?.ok
    ? `Topped up in-browser from ${live.source}.`
    : 'Live top-up unavailable (usually a CORS block); showing the daily committed snapshot.';

  dom.dataMeta.textContent = `${series.count.toLocaleString('en-US')} trading days · ${formatDate(
    series.start
  )} → ${formatDate(series.end)} · source: ${series.source ?? 'n/a'}`;

  // Don't overwrite the bootstrap notice, which is the more actionable message.
  if (stale && !bootstrapped) {
    dom.dataError.hidden = false;
    dom.dataError.textContent = `Price data is ${daysSince(
      series.end
    )} days old. The daily refresh workflow may not be running — check the "Update S&P 500 data" GitHub Action.`;
  }
}

async function main() {
  let bootstrapped = false;
  try {
    series = await loadSeries();
  } catch (error) {
    // No committed snapshot yet — try to pull the history in the browser so the
    // page is usable before the first CI refresh lands.
    dom.dataStatus.textContent = 'fetching history…';
    series = await bootstrapSeries();
    if (!series) {
      dom.dataError.hidden = false;
      dom.dataError.textContent = `${error.message} A direct in-browser fetch was also blocked, so there is nothing to display.`;
      dom.dataStatus.dataset.state = 'error';
      dom.dataStatus.textContent = 'no data';
      return;
    }
    bootstrapped = true;
    dom.dataError.hidden = false;
    dom.dataError.textContent =
      'No committed price snapshot found — this history was fetched directly in your browser and is not cached. Run the "Update S&P 500 data" workflow to commit it.';
  }

  peaks = runningPeaks(series.closes);
  episodes = drawdownEpisodes(series.closes);
  state.day = series.count;

  restore();
  dom.startingCash.value = String(state.startingCash);

  chart = createChart(dom.chart, dom.chartTip, { onScrub: (day) => setDay(day) });
  buildPresets();
  bindEvents();
  render();
  dom.layout.setAttribute('aria-busy', 'false');
  renderDataStatus(null, bootstrapped);

  // Best-effort top-up; recompute the derived series if it added a bar.
  const live = await refreshLive(series);
  if (live.ok) {
    peaks = runningPeaks(series.closes);
    episodes = drawdownEpisodes(series.closes);
    if (live.added && state.day === series.count - 1) state.day = series.count;
    render();
  }
  renderDataStatus(live, bootstrapped);
}

main();
