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
import { equityCurve, stats, benchmarks } from './analytics.js';
import { t, setLang, getLang, applyStatic, LANGS, DEFAULT_LANG } from './i18n.js';
import {
  formatDate,
  money,
  moneySigned,
  percent,
  percentSigned,
  price as fmtPrice,
  units as fmtUnits,
} from './format.js';

const STORE_KEY = 'crashbuyer.v1';
const DEFAULT_CASH = 200000;

/** Every 10% of drawdown raises an alert, if alerts are switched on. */
const ALERT_STEP = 10;

/**
 * Jump targets, anchored on the market peak that preceded each selloff. Any
 * whose date falls outside the loaded series is dropped at build time, so the
 * same list works for a 10-year window and for the full history since 1871.
 */
const PRESETS = [
  { key: 'preset.start', tone: 'neutral', at: 'first' },
  { key: 'preset.1929', date: '1929-09-01' },
  { key: 'preset.1987', date: '1987-08-01' },
  { key: 'preset.2000', date: '2000-08-01' },
  { key: 'preset.2008', date: '2007-10-01' },
  { key: 'preset.2020', date: '2020-02-01' },
  { key: 'preset.2022', date: '2022-01-01' },
  { key: 'preset.latest', tone: 'neutral', at: 'last' },
];

/**
 * Shading every 10% dip over 150 years would tint most of the chart, so a long
 * series only highlights the serious bear markets.
 */
function episodeThreshold() {
  const years = (Date.parse(series.end) - Date.parse(series.start)) / 3.15576e10;
  return years > 40 ? 0.2 : 0.1;
}

const el = (id) => document.getElementById(id);

const dom = {
  layout: el('layout'),
  dataStatus: el('data-status'),
  dataError: el('data-error'),
  dataMeta: el('data-meta'),
  resetAll: el('reset-all'),
  langSwitch: el('lang-switch'),
  toasts: el('toasts'),

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
  alertsToggle: el('alerts-toggle'),
  alertsHint: el('alerts-hint'),

  startingCash: el('starting-cash'),
  pfInvested: el('pf-invested'),
  pfWithdrawnRow: el('pf-withdrawn-row'),
  pfWithdrawn: el('pf-withdrawn'),
  pfCash: el('pf-cash'),
  pfUnits: el('pf-units'),
  pfMv: el('pf-mv'),
  pfEquity: el('pf-equity'),
  pfPnl: el('pf-pnl'),
  pfRet: el('pf-ret'),
  pfRoiRow: el('pf-roi-row'),
  pfRoi: el('pf-roi'),
  pfPending: el('pf-pending'),

  allocBody: el('alloc-body'),

  chartTitle: el('chart-title'),
  chart: el('chart'),
  chartTip: el('chart-tip'),
  legend: el('chart-legend'),
  logToggle: el('log-toggle'),

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

  perfEmpty: el('perf-empty'),
  perfBody: el('perf-body'),
  perfYou: el('perf-you'),
  perfYouPct: el('perf-you-pct'),
  perfLump: el('perf-lump'),
  perfLumpPct: el('perf-lump-pct'),
  perfDca: el('perf-dca'),
  perfDcaPct: el('perf-dca-pct'),
  perfExcess: el('perf-excess'),
  perfCagr: el('perf-cagr'),
  perfMaxdd: el('perf-maxdd'),
  perfVol: el('perf-vol'),
  perfSharpe: el('perf-sharpe'),
  perfTim: el('perf-tim'),
  perfSpan: el('perf-span'),
};

/* ------------------------------------------------------------------ state */

let series = null;
let peaks = [];
let episodes = [];
let chart = null;
let nextSeq = 1;
let bootstrapped = false;
let lastLive = null;
/** Deepest 10% band already announced, so each level alerts once per selloff. */
let alertedLevel = 0;
/** The last message shown, kept as a key so it can be re-rendered on language change. */
let lastMessage = null;

const state = {
  day: 1,
  startingCash: DEFAULT_CASH,
  action: 'BUY',
  trades: [],
  visible: { price: true, peak: true, buy: true, sell: true },
  logScale: true,
  alerts: false,
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
        logScale: state.logScale,
        alerts: state.alerts,
        lang: getLang(),
      })
    );
  } catch {
    // Private-mode storage failures should not take the simulator down.
  }
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function restore(saved) {
  if (!saved) return;

  if (Number.isFinite(saved.startingCash) && saved.startingCash >= 0) {
    state.startingCash = saved.startingCash;
  }
  if (Array.isArray(saved.trades)) {
    // Re-anchor by date: the series grows daily, so a stored day number would
    // silently point at the wrong bar once new data lands.
    state.trades = saved.trades
      .map((trade) => {
        const day = indexOnOrAfter(series.dates, trade.date) + 1;
        return day > 0 && series.dates[day - 1] === trade.date
          ? { ...trade, day, seq: nextSeq++ }
          : null;
      })
      .filter(Boolean);
  }
  if (saved.visible) Object.assign(state.visible, saved.visible);
  if (typeof saved.logScale === 'boolean') state.logScale = saved.logScale;
  if (typeof saved.alerts === 'boolean') state.alerts = saved.alerts;

  const anchored = saved.dayDate ? indexOnOrAfter(series.dates, saved.dayDate) + 1 : 0;
  state.day = clampDay(anchored > 0 ? anchored : (saved.day ?? series.count));
}

/* -------------------------------------------------------------- selectors */

const clampDay = (day) => Math.min(series.dates.length, Math.max(1, Math.round(Number(day) || 1)));

function market() {
  const i = state.day - 1;
  const currentPrice = series.closes[i];
  const peak = peaks[i];
  return { i, date: series.dates[i], currentPrice, peak, drawdown: currentPrice / peak - 1 };
}

const ledger = () => buildLedger(state.trades, state.startingCash);

/** Renders a structured ledger error in the active language. */
function describeError(error) {
  if (!error) return '';
  return error.kind === 'overdraw'
    ? t('msg.overdraw', error.day, error.shortfall.toFixed(2))
    : t('msg.oversell', error.day);
}

/* ---------------------------------------------------------------- alerts */

/** At most this many alerts on screen at once — they are a nudge, not a log. */
const MAX_TOASTS = 3;

function toast(text) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  dom.toasts.prepend(node);
  while (dom.toasts.children.length > MAX_TOASTS) dom.toasts.lastElementChild.remove();
  setTimeout(() => node.remove(), 5000);
}

const bandAt = (drawdown) =>
  Math.floor((Math.max(0, -drawdown) * 100) / ALERT_STEP) * ALERT_STEP;

/**
 * Announces the deepest new 10% band the drawdown has fallen through, once per
 * selloff; recovering to a fresh high rearms the ladder.
 *
 * Only stepping through time raises an alert. Dragging the chart, hitting a
 * preset or typing a day number is navigation, not the market falling — firing
 * on those buried the screen under one toast per bear market in 150 years of
 * history, which is how this was first built and it was unusable.
 */
function checkAlerts(snapshot, notify) {
  const level = bandAt(snapshot.drawdown);

  if (!notify || !state.alerts || level <= alertedLevel) {
    alertedLevel = level;
    return;
  }

  alertedLevel = level;
  const body = t('alert.body', level, formatDate(snapshot.date), fmtPrice(snapshot.currentPrice));
  toast(body);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(t('alert.title'), { body, tag: `dd-${level}` });
    } catch {
      // Some browsers refuse constructed notifications outside a service worker.
    }
  }
}

async function setAlerts(on) {
  state.alerts = on;
  dom.alertsHint.hidden = true;

  if (on && typeof Notification !== 'undefined') {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    dom.alertsHint.hidden = false;
    dom.alertsHint.textContent =
      permission === 'granted' ? t('alerts.enabled') : t('alerts.blocked');
  }

  // Re-arm from the current position so switching on does not replay old bands.
  alertedLevel = bandAt(market().drawdown);
  save();
}

/* ---------------------------------------------------------------- actions */

function setDay(day, { persist = true, notify = false } = {}) {
  const next = clampDay(day);
  if (next === state.day) return;
  state.day = next;
  checkAlerts(market(), notify);
  if (persist) save();
  render();
}

/** Moving one bar at a time — the case where a drawdown alert is meaningful. */
const stepDay = (delta) => setDay(state.day + delta, { notify: true });

function setAction(action) {
  state.action = action;
  dom.actBuy.classList.toggle('is-active', action === 'BUY');
  dom.actSell.classList.toggle('is-active', action === 'SELL');
  dom.actBuy.setAttribute('aria-pressed', String(action === 'BUY'));
  dom.actSell.setAttribute('aria-pressed', String(action === 'SELL'));
  render();
}

/** Messages are stored as (key, args) so they survive a language switch. */
function message(key, tone = 'error', ...args) {
  lastMessage = key ? { key, tone, args } : null;
  dom.tradeMsg.textContent = key ? t(key, ...args) : '';
  dom.tradeMsg.dataset.tone = tone;
  dom.tradeMsg.hidden = !key;
}

function messageRaw(text, tone) {
  lastMessage = null;
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
    message('msg.enterAmount');
    return;
  }

  const candidate = buildLedger([...state.trades, draft], state.startingCash);
  if (candidate.error) {
    messageRaw(describeError(candidate.error), 'error');
    return;
  }

  nextSeq++;
  state.trades.push(draft);
  dom.amountInput.value = '0';
  message(
    'msg.executed',
    'ok',
    t(draft.action === 'BUY' ? 'trade.buy' : 'trade.sell'),
    fmtUnits(draft.units),
    fmtPrice(draft.price),
    formatDate(draft.date)
  );
  save();
  render();
}

function suggest() {
  const { currentPrice, peak, drawdown } = market();
  const { rows } = ledger();
  const pf = portfolioAt(rows, state.startingCash, state.day, currentPrice);

  if (state.action === 'SELL') {
    if (pf.units <= 0) {
      message('msg.noUnits');
      return;
    }
    dom.amountInput.value = (Math.floor(pf.marketValue * 100) / 100).toFixed(2);
    message('msg.suggestSell', 'ok', fmtUnits(pf.units));
    render();
    return;
  }

  const armed = allocationRows(peak, state.startingCash, drawdown).filter((r) => r.armed);
  if (!armed.length) {
    message('msg.noRung', 'error', percent(drawdown));
    return;
  }
  if (pf.cash <= 0) {
    message('msg.noCash');
    return;
  }

  const deepest = armed[armed.length - 1];
  const amount = Math.min(deepest.amount, pf.cash);
  dom.amountInput.value = String(Math.round(amount));
  message(
    'msg.suggestBuy',
    'ok',
    (deepest.drawdown * 100).toFixed(0),
    (deepest.invest * 100).toFixed(0),
    amount < deepest.amount
  );
  render();
}

function removeTrade(id) {
  state.trades = state.trades.filter((trade) => trade.id !== id);
  message(null);
  save();
  render();
}

function resetAll() {
  if (!confirm(t('confirm.reset'))) return;
  state.trades = [];
  state.startingCash = DEFAULT_CASH;
  state.day = series.count;
  dom.startingCash.value = String(DEFAULT_CASH);
  dom.amountInput.value = '0';
  message(null);
  save();
  render();
}

function switchLang(lang) {
  setLang(lang);
  for (const button of dom.langSwitch.children) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
  applyStatic();
  applyInstrumentLabels();
  buildPresets();
  if (lastMessage) message(lastMessage.key, lastMessage.tone, ...lastMessage.args);
  renderDataStatus();
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
  dom.pfInvested.textContent = money(pf.invested);
  dom.pfWithdrawnRow.hidden = pf.withdrawn <= 0;
  dom.pfWithdrawn.textContent = money(pf.withdrawn);
  dom.pfCash.textContent = money(pf.cash);
  dom.pfUnits.textContent = fmtUnits(pf.units);
  dom.pfMv.textContent = money(pf.marketValue);
  dom.pfEquity.textContent = money(pf.equity);

  dom.pfPnl.textContent = moneySigned(pf.pnl);
  dom.pfPnl.className = `kv-value ${pf.pnl >= 0 ? 'is-gain' : 'is-loss'}`;
  dom.pfRet.textContent = percentSigned(pf.returnPct);
  dom.pfRet.className = `kv-value ${pf.returnPct >= 0 ? 'is-gain' : 'is-loss'}`;

  dom.pfRoiRow.hidden = pf.returnOnInvested === null;
  if (pf.returnOnInvested !== null) {
    dom.pfRoi.textContent = `${percentSigned(pf.returnOnInvested)}  (${moneySigned(pf.investedPnl)})`;
    dom.pfRoi.className = `kv-value ${pf.returnOnInvested >= 0 ? 'is-gain' : 'is-loss'}`;
  }

  dom.pfPending.hidden = pf.pending === 0;
  dom.pfPending.textContent = pf.pending ? t('pf.pending', pf.pending) : '';
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
      use.textContent = t('alloc.use');
      use.addEventListener('click', () => {
        setAction('BUY');
        dom.amountInput.value = String(Math.round(row.amount));
        message(
          'msg.loadedRung',
          'ok',
          (row.drawdown * 100).toFixed(0),
          money(row.amount),
          formatDate(market().date)
        );
        render();
      });
      tr.lastElementChild.appendChild(use);
      return tr;
    })
  );
}

function renderPreview({ date, currentPrice }) {
  const draft = draftTrade();
  dom.unitsOutput.value = draft ? fmtUnits(draft.units) : '0.0000';

  if (!draft) {
    dom.previewRow.innerHTML = `<td colspan="9" class="empty">${t('trade.previewEmpty')}</td>`;
    dom.executeBtn.disabled = false;
    return;
  }

  const candidate = buildLedger([...state.trades, draft], state.startingCash);
  const row = candidate.rows.find((r) => r.id === draft.id);
  const tag = draft.action === 'BUY' ? 'tag-buy' : 'tag-sell';
  const label = t(draft.action === 'BUY' ? 'trade.buy' : 'trade.sell');

  dom.previewRow.innerHTML =
    `<td>${state.day}</td>` +
    `<td>${formatDate(date)}</td>` +
    `<td class="num">${fmtPrice(currentPrice)}</td>` +
    `<td><span class="tag ${tag}">${label}</span></td>` +
    `<td class="num">${fmtUnits(row.units)}</td>` +
    `<td class="num">${money(row.amount)}</td>` +
    `<td class="num">${money(row.cashAfter)}</td>` +
    `<td class="num">${fmtUnits(row.unitsAfter)}</td>` +
    `<td class="num">${money(row.equityAfter)}</td>`;

  dom.executeBtn.disabled = Boolean(candidate.error);
  if (candidate.error) messageRaw(describeError(candidate.error), 'error');
}

function renderLog(rows) {
  dom.logCount.textContent = t('log.count', rows.length);

  if (!rows.length) {
    dom.logBody.innerHTML = `<tr><td colspan="12" class="empty">${t('log.empty')}</td></tr>`;
    return;
  }

  dom.logBody.replaceChildren(
    ...rows.map((row, index) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-future', row.day > state.day);
      const label = t(row.action === 'BUY' ? 'trade.buy' : 'trade.sell');
      tr.innerHTML =
        `<td class="num">${index + 1}</td>` +
        `<td class="num">${row.day}</td>` +
        `<td>${formatDate(row.date)}</td>` +
        `<td class="num">${fmtPrice(row.price)}</td>` +
        `<td><span class="tag ${row.action === 'BUY' ? 'tag-buy' : 'tag-sell'}">${label}</span></td>` +
        `<td class="num">${fmtUnits(row.units)}</td>` +
        `<td class="num">${money(row.amount)}</td>` +
        `<td class="num">${money(row.cashAfter)}</td>` +
        `<td class="num">${fmtUnits(row.unitsAfter)}</td>` +
        `<td class="num">${money(row.equityAfter)}</td>` +
        '<td></td><td class="num"></td>';

      const note = document.createElement('input');
      note.className = 'note-input';
      note.placeholder = t('log.notePlaceholder');
      note.value = row.note ?? '';
      note.addEventListener('change', () => {
        const trade = state.trades.find((candidate) => candidate.id === row.id);
        if (trade) trade.note = note.value;
        save();
      });
      tr.children[10].appendChild(note);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-btn';
      del.title = t('log.delete');
      del.textContent = '✕';
      del.addEventListener('click', () => removeTrade(row.id));
      tr.children[11].appendChild(del);

      return tr;
    })
  );
}

/**
 * Compares the ladder against two passive alternatives over the window running
 * from the first trade to the day pointer, and scores the equity curve.
 */
function renderPerformance(rows) {
  const applied = rows.filter((row) => row.day <= state.day);
  const from = applied.length ? applied[0].day - 1 : -1;
  const to = state.day - 1;

  if (from < 0 || to <= from) {
    dom.perfEmpty.hidden = false;
    dom.perfBody.hidden = true;
    return;
  }
  dom.perfEmpty.hidden = true;
  dom.perfBody.hidden = false;

  const curve = equityCurve(rows, state.startingCash, series.closes, from, to);
  const you = curve.at(-1).equity;
  const { lump, dca } = benchmarks(series.dates, series.closes, from, to, state.startingCash);
  const gain = (value) => percentSigned(value / state.startingCash - 1);

  dom.perfYou.textContent = money(you);
  dom.perfYouPct.textContent = gain(you);
  dom.perfLump.textContent = money(lump);
  dom.perfLumpPct.textContent = gain(lump);
  dom.perfDca.textContent = money(dca);
  dom.perfDcaPct.textContent = gain(dca);

  const excess = you / lump - 1;
  dom.perfExcess.textContent = percentSigned(excess);
  dom.perfExcess.className = `kv-value ${excess >= 0 ? 'is-gain' : 'is-loss'}`;

  const s = stats(curve, series.dates, from, to, state.startingCash);
  dom.perfCagr.textContent = s.cagr === null ? '—' : percentSigned(s.cagr);
  dom.perfCagr.className = s.cagr >= 0 ? 'is-gain' : 'is-loss';
  dom.perfMaxdd.textContent = s.maxDrawdown === null ? '—' : percent(s.maxDrawdown);
  dom.perfMaxdd.className = 'is-loss';
  dom.perfVol.textContent = s.volatility === null ? '—' : percent(s.volatility);
  dom.perfSharpe.textContent = s.sharpe === null ? '—' : s.sharpe.toFixed(2);
  dom.perfTim.textContent = s.timeInMarket === null ? '—' : percent(s.timeInMarket, 0);
  dom.perfSpan.textContent = t('perf.years', s.years.toFixed(1));
}

function render() {
  const snapshot = market();
  const { rows } = ledger();

  renderMarket(snapshot);
  renderPortfolio(portfolioAt(rows, state.startingCash, state.day, snapshot.currentPrice));
  renderPerformance(rows);
  renderAllocation(snapshot);
  renderPreview(snapshot);
  renderLog(rows);

  chart.render({
    dates: series.dates,
    closes: series.closes,
    peaks,
    episodes,
    day: state.day,
    trades: state.trades,
    visible: state.visible,
    logScale: state.logScale,
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
        // Outside the loaded window, or so early it would just be the start.
        if (index <= 0) return null;
        day = index + 1;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.textContent = t(preset.key);
      button.dataset.day = String(day);
      if (preset.tone) button.dataset.tone = preset.tone;
      button.addEventListener('click', () => setDay(day));
      return button;
    }).filter(Boolean)
  );
}

function bindEvents() {
  dom.dayPrev.addEventListener('click', () => stepDay(-1));
  dom.dayNext.addEventListener('click', () => stepDay(1));
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
      messageRaw(t('msg.cashTooLow', money(value), describeError(check.error)), 'error');
      return;
    }
    state.startingCash = value;
    message(null);
    save();
    render();
  });

  dom.actBuy.addEventListener('click', () => setAction('BUY'));
  dom.actSell.addEventListener('click', () => setAction('SELL'));
  dom.amountInput.addEventListener('input', () => render());
  dom.suggestBtn.addEventListener('click', suggest);
  dom.executeBtn.addEventListener('click', execute);
  dom.resetAll.addEventListener('click', resetAll);
  dom.alertsToggle.addEventListener('change', () => setAlerts(dom.alertsToggle.checked));

  dom.langSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('.lang-btn');
    if (button) switchLang(button.dataset.lang);
  });

  dom.logToggle.addEventListener('click', () => {
    state.logScale = !state.logScale;
    dom.logToggle.setAttribute('aria-pressed', String(state.logScale));
    save();
    render();
  });

  dom.legend.addEventListener('click', (event) => {
    const button = event.target.closest('.legend-item');
    if (!button || !button.dataset.series) return;
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
      stepDay(-step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepDay(step);
    }
  });
}

/**
 * The page is written for the index, but a fallback data source may quote the
 * SPY ETF instead. Name the instrument from the data rather than hardcoding it,
 * and disclose both the ETF substitution and the monthly-average resolution.
 */
function applyInstrumentLabels() {
  const name = series.name ?? 'S&P 500';
  document.querySelector('.brand-sub').textContent = name;
  dom.chartTitle.textContent = t('panel.chart', name);
  document.title = t('app.title', name);

  for (const node of document.querySelectorAll('.footer-note')) node.remove();

  const notes = [];
  if (series.proxy) notes.push(t('proxy.note', series.symbol));
  if (series.monthlyNote) notes.push(t('note.monthly', series.dailyFrom && formatDate(series.dailyFrom)));

  const footer = document.querySelector('.footer');
  for (const text of notes.reverse()) {
    const node = document.createElement('p');
    node.className = 'footer-note';
    node.textContent = text;
    footer.prepend(node);
  }
}

function renderDataStatus() {
  const live = lastLive;
  const stale = isStale(series);
  const status = live?.ok || bootstrapped ? 'live' : stale ? 'error' : 'daily';
  const label = live?.ok
    ? t('status.live', live.source, formatDate(series.end))
    : bootstrapped
      ? t('status.direct', formatDate(series.end))
      : t('status.daily', formatDate(series.end));

  dom.dataStatus.dataset.state = status;
  dom.dataStatus.textContent = label;
  dom.dataStatus.title = live?.ok ? t('status.liveTitle', live.source) : t('status.offlineTitle');

  dom.dataMeta.textContent =
    t(
      'meta.summary',
      series.count.toLocaleString('en-US'),
      formatDate(series.start),
      formatDate(series.end),
      series.symbol ?? '?',
      series.source ?? 'n/a'
    ) + (series.proxy ? t('meta.proxy') : '');

  // Don't overwrite the bootstrap notice, which is the more actionable message.
  if (stale && !bootstrapped) {
    dom.dataError.hidden = false;
    dom.dataError.textContent = t('err.stale', daysSince(series.end));
  }
}

async function main() {
  const saved = readSaved();
  setLang(LANGS.includes(saved?.lang) ? saved.lang : DEFAULT_LANG);
  for (const button of dom.langSwitch.children) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  }
  applyStatic();
  dom.dataStatus.textContent = t('status.loading');

  try {
    series = await loadSeries();
  } catch (error) {
    // No committed snapshot yet — try to pull the history in the browser so the
    // page is usable before the first CI refresh lands.
    dom.dataStatus.textContent = t('status.fetching');
    series = await bootstrapSeries();
    if (!series) {
      dom.dataError.hidden = false;
      dom.dataError.textContent = t('err.noDataAtAll', error.message);
      dom.dataStatus.dataset.state = 'error';
      dom.dataStatus.textContent = t('status.noData');
      return;
    }
    bootstrapped = true;
    dom.dataError.hidden = false;
    dom.dataError.textContent = t('err.bootstrap');
  }

  peaks = runningPeaks(series.closes);
  episodes = drawdownEpisodes(series.closes, episodeThreshold());
  state.day = series.count;

  restore(saved);
  dom.startingCash.value = String(state.startingCash);
  dom.alertsToggle.checked = state.alerts;
  dom.logToggle.setAttribute('aria-pressed', String(state.logScale));
  for (const button of dom.legend.querySelectorAll('[data-series]')) {
    button.setAttribute('aria-pressed', String(state.visible[button.dataset.series]));
  }
  alertedLevel = bandAt(market().drawdown);

  applyInstrumentLabels();
  chart = createChart(dom.chart, dom.chartTip, { onScrub: (day) => setDay(day) });
  buildPresets();
  bindEvents();
  render();
  dom.layout.setAttribute('aria-busy', 'false');
  renderDataStatus();

  // Best-effort top-up; recompute the derived series if it added a bar.
  lastLive = await refreshLive(series);
  if (lastLive.ok) {
    peaks = runningPeaks(series.closes);
    episodes = drawdownEpisodes(series.closes, episodeThreshold());
    if (lastLive.added && state.day === series.count - 1) state.day = series.count;
    render();
  }
  renderDataStatus();
}

main();
