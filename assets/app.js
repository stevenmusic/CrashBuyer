// Wiring: load the series, hold the simulation state, render every panel.

import { loadManifest, loadSeries, bootstrapSeries, refreshLive, isStale, daysSince } from './data.js';
import {
  runningPeaks,
  drawdownEpisodes,
  indexOnOrAfter,
  buildLedger,
  portfolioAt,
  allocationRows,
  LADDER,
  METER_FLOOR,
} from './model.js';
import { createChart } from './chart.js';
import { sessionAt, pollInterval } from './session.mjs';
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
const DEFAULT_LADDER_BASE = 200000;

/** Every 10% of drawdown raises an alert, if alerts are switched on. */
/** Drawdown bands the alerts step through, in percent. */
const ALERT_STEPS = [5, 10, 15, 20, 25];
const DEFAULT_ALERT_STEP = 10;

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
  { key: 'preset.2018', date: '2018-09-20' },
  { key: 'preset.2020', date: '2020-02-19' },
  { key: 'preset.2022', date: '2022-01-03' },
  { key: 'preset.2025', date: '2025-02-19' },
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
  instrument: el('instrument'),
  toasts: el('toasts'),

  dayPrev: el('day-prev'),
  dayNext: el('day-next'),
  dayInput: el('day-input'),
  dayTotal: el('day-total'),
  curDate: el('cur-date'),
  curPrice: el('cur-price'),
  curDd: el('cur-dd'),
  curPeak: el('cur-peak'),
  todayRange: el('today-range'),
  todayRangeLo: el('today-range-lo'),
  todayRangeHi: el('today-range-hi'),
  todayRangeMarker: el('today-range-marker'),
  meterMarker: el('meter-marker'),
  meterTicks: el('meter-ticks'),
  presets: el('presets'),
  alertsToggle: el('alerts-toggle'),
  alertsStep: el('alerts-step'),
  alertsBasis: el('alerts-basis'),
  alertsHint: el('alerts-hint'),

  ladderBase: el('ladder-base'),
  pfInvested: el('pf-invested'),
  pfWithdrawnRow: el('pf-withdrawn-row'),
  pfWithdrawn: el('pf-withdrawn'),
  pfUnits: el('pf-units'),
  pfAvg: el('pf-avg'),
  pfMv: el('pf-mv'),
  pfPnl: el('pf-pnl'),
  pfRet: el('pf-ret'),
  pfPending: el('pf-pending'),

  allocBody: el('alloc-body'),

  chartTitle: el('chart-title'),
  chart: el('chart'),
  chartTip: el('chart-tip'),
  legend: el('chart-legend'),
  logToggle: el('log-toggle'),
  zoomReset: el('zoom-reset'),

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
  perfYouBar: el('perf-you-bar'),
  perfLump: el('perf-lump'),
  perfLumpPct: el('perf-lump-pct'),
  perfLumpBar: el('perf-lump-bar'),
  perfDca: el('perf-dca'),
  perfDcaPct: el('perf-dca-pct'),
  perfDcaBar: el('perf-dca-bar'),
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
let manifest = null;
/** Trades are kept per instrument, so switching symbol never mixes books. */
let books = {};
let lastLive = null;
/** Deepest 10% band already announced, so each level alerts once per selloff. */
let alertedLevel = 0;
/** The last message shown, kept as a key so it can be re-rendered on language change. */
let lastMessage = null;

const state = {
  instrument: null,
  day: 1,
  // Only scales the allocation ladder's suggested amounts. Nothing the
  // portfolio reports depends on it — those come from the trades themselves.
  ladderBase: DEFAULT_LADDER_BASE,
  action: 'BUY',
  trades: [],
  visible: { price: true, peak: true, buy: true, sell: true },
  logScale: true,
  alerts: false,
  alertStep: DEFAULT_ALERT_STEP,
  alertBasis: 'peak',
};

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        instrument: state.instrument,
        ladderBase: state.ladderBase,
        visible: state.visible,
        logScale: state.logScale,
        alerts: state.alerts,
        alertStep: state.alertStep,
        alertBasis: state.alertBasis,
        lang: getLang(),
        books: {
          ...books,
          [state.instrument]: {
            day: state.day,
            // The series is a rolling window, so old bars drop off the front
            // and day numbers shift. The date is the stable anchor.
            dayDate: series.dates[state.day - 1],
            trades: state.trades,
          },
        },
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

/** Applies the settings shared by every instrument. */
function restoreSettings(saved) {
  if (!saved) return;

  // `startingCash` is the pre-rename key from when this doubled as a budget.
  const base = saved.ladderBase ?? saved.startingCash;
  if (Number.isFinite(base) && base >= 0) state.ladderBase = base;
  if (saved.visible) Object.assign(state.visible, saved.visible);
  if (typeof saved.logScale === 'boolean') state.logScale = saved.logScale;
  if (typeof saved.alerts === 'boolean') state.alerts = saved.alerts;
  if (ALERT_STEPS.includes(saved.alertStep)) state.alertStep = saved.alertStep;
  if (saved.alertBasis === 'peak' || saved.alertBasis === 'trade') state.alertBasis = saved.alertBasis;

  // Saves from before the picker kept a single book at the top level.
  books = saved.books ?? {};
  if (!saved.books && (saved.trades || saved.dayDate)) {
    books = { __legacy: { day: saved.day, dayDate: saved.dayDate, trades: saved.trades } };
  }
}

/** Loads one instrument's book against the series currently in memory. */
function restoreBook(book) {
  state.trades = [];
  state.day = series.count;
  if (!book) return;

  if (Array.isArray(book.trades)) {
    // Re-anchor by date: the series grows daily, so a stored day number would
    // silently point at the wrong bar once new data lands.
    state.trades = book.trades
      .map((trade) => {
        const day = indexOnOrAfter(series.dates, trade.date) + 1;
        return day > 0 && series.dates[day - 1] === trade.date
          ? { ...trade, day, seq: nextSeq++ }
          : null;
      })
      .filter(Boolean);
  }

  const anchored = book.dayDate ? indexOnOrAfter(series.dates, book.dayDate) + 1 : 0;
  state.day = clampDay(anchored > 0 ? anchored : (book.day ?? series.count));
}

/* -------------------------------------------------------------- selectors */

const clampDay = (day) => Math.min(series.dates.length, Math.max(1, Math.round(Number(day) || 1)));

function market() {
  const i = state.day - 1;
  const currentPrice = series.closes[i];
  const peak = peaks[i];
  return { i, date: series.dates[i], currentPrice, peak, drawdown: currentPrice / peak - 1 };
}

const ledger = () => buildLedger(state.trades);

/** Renders a structured ledger error in the active language. */
function describeError(error) {
  return error ? t('msg.oversell', error.day) : '';
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

/**
 * What the alerts measure down from, and the two answer different questions.
 *
 * Peak-to-date is what the allocation ladder arms against, so an alert on that
 * basis means a rung just became available — the thing this tool exists to act
 * on — and the number in the alert matches the one on the meter. It is the
 * default for that reason.
 *
 * The first trade's price answers "how far under water am I", which is about a
 * position rather than an opportunity. On that basis there is nothing to be
 * down on until something has been bought, so it returns null until then, and
 * while the day pointer still sits before that first trade.
 */
function alertBasis() {
  if (state.alertBasis === 'peak') return market().peak;
  const first = ledger().rows[0];
  if (!first || first.day > state.day) return null;
  return first.price;
}

/** Which band the current price falls in, measured down from the basis. */
const bandAt = (drawdown) =>
  Math.floor((Math.max(0, -drawdown) * 100) / state.alertStep) * state.alertStep;

const bandNow = () => {
  const basis = alertBasis();
  if (!basis) return 0;
  return bandAt(market().currentPrice / basis - 1);
};

/**
 * Announces the deepest new band the price has fallen through below the first
 * trade, once per selloff; climbing back above the basis rearms it.
 *
 * Only stepping through time raises an alert. Dragging the chart, hitting a
 * preset or typing a day number is navigation, not the market falling — firing
 * on those buried the screen under one toast per bear market in 150 years of
 * history, which is how this was first built and it was unusable.
 */
function checkAlerts(snapshot, notify) {
  const basis = alertBasis();
  if (!basis) {
    alertedLevel = 0;
    return;
  }
  const drop = snapshot.currentPrice / basis - 1;
  const level = bandAt(drop);

  if (!notify || !state.alerts) {
    alertedLevel = level;
    return;
  }

  // Rearming on `level === 0` was too loose: that covers everything shallower
  // than one step, and a market chopping either side of −10% on its way down
  // announced −10% six times before it ever reached −20%. Only getting all the
  // way back to the basis counts as a recovery.
  if (level <= alertedLevel) {
    if (drop >= 0) alertedLevel = 0;
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
      permission === 'granted' ? t('alerts.enabled', state.alertStep) : t('alerts.blocked');
  }

  // Re-arm from the current position so switching on does not replay old bands.
  alertedLevel = bandNow();
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

/**
 * Messages keep a *thunk* rather than finished text, so switching language
 * re-renders them from scratch. Storing the interpolated strings left dates and
 * BUY/SELL labels frozen in whichever language was active when they were built.
 */
function show(text, tone) {
  dom.tradeMsg.textContent = text;
  dom.tradeMsg.dataset.tone = tone;
  dom.tradeMsg.hidden = !text;
}

function message(key, tone = 'error', argsFn = null) {
  lastMessage = key ? { key, tone, argsFn } : null;
  show(key ? t(key, ...(argsFn ? argsFn() : [])) : '', tone);
}

/**
 * For text that is not a single key, e.g. a composed ledger error. `transient`
 * marks a message the preview owns: it describes the draft in the inputs right
 * now, so it has to disappear when that draft becomes valid. Messages about
 * something that already happened — a trade executed, a rung loaded — are not
 * transient and survive the next render.
 */
function messageFrom(producer, tone, transient = false) {
  lastMessage = { producer, tone, transient };
  show(producer(), tone);
}

function replayMessage() {
  if (!lastMessage) return;
  if (lastMessage.producer) messageFrom(lastMessage.producer, lastMessage.tone, lastMessage.transient);
  else message(lastMessage.key, lastMessage.tone, lastMessage.argsFn);
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

  const candidate = buildLedger([...state.trades, draft]);
  if (candidate.error) {
    messageFrom(() => describeError(candidate.error), 'error');
    return;
  }

  nextSeq++;
  state.trades.push(draft);
  dom.amountInput.value = '0';
  message('msg.executed', 'ok', () => [
    t(draft.action === 'BUY' ? 'trade.buy' : 'trade.sell'),
    fmtUnits(draft.units),
    fmtPrice(draft.price),
    formatDate(draft.date),
  ]);
  save();
  render();
}

function suggest() {
  const { currentPrice, peak, drawdown } = market();
  const { rows } = ledger();
  const pf = portfolioAt(rows, state.day, currentPrice);

  if (state.action === 'SELL') {
    if (pf.units <= 0) {
      message('msg.noUnits');
      return;
    }
    dom.amountInput.value = (Math.floor(pf.marketValue * 100) / 100).toFixed(2);
    message('msg.suggestSell', 'ok', () => [fmtUnits(pf.units)]);
    render();
    return;
  }

  const armed = allocationRows(peak, state.ladderBase, drawdown).filter((r) => r.armed);
  if (!armed.length) {
    message('msg.noRung', 'error', () => [percent(drawdown)]);
    return;
  }

  const deepest = armed[armed.length - 1];
  dom.amountInput.value = String(Math.round(deepest.amount));
  message('msg.suggestBuy', 'ok', () => [
    (deepest.drawdown * 100).toFixed(0),
    (deepest.invest * 100).toFixed(0),
  ]);
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
  state.ladderBase = DEFAULT_LADDER_BASE;
  state.day = series.count;
  dom.ladderBase.value = String(DEFAULT_LADDER_BASE);
  dom.amountInput.value = '0';
  message(null);
  save();
  render();
}

/** One tick per rung, placed on the same scale the marker uses. */
function buildMeterTicks() {
  dom.meterTicks.replaceChildren(
    ...LADDER.map((rung) => {
      const span = document.createElement('span');
      span.style.left = `${(rung.drawdown / METER_FLOOR) * 100}%`;
      span.textContent = `\u2212${Math.round(rung.drawdown * 100)}`;
      return span;
    })
  );
}

/**
 * Keeps the last bar fresh while a session is running. Pauses on a hidden tab —
 * a phone in a pocket does not need the price — and re-checks on the way back,
 * so returning to the page shows the current quote rather than whatever it held
 * when it was put away.
 */
let pollTimer = null;

function scheduleLivePoll() {
  clearTimeout(pollTimer);
  const wait = pollInterval(sessionAt());
  if (!wait || document.hidden) return;

  pollTimer = setTimeout(async () => {
    const before = series.closes.at(-1);
    lastLive = await refreshLive(series);
    if (lastLive?.ok) {
      if (series.closes.at(-1) !== before) {
        peaks = runningPeaks(series.closes);
        episodes = drawdownEpisodes(series.closes, episodeThreshold());
        // A genuinely new bar, not just a same-day price update, is the only
        // case that moves what index "today" sits at — the Latest preset's
        // day number was baked in at boot and goes stale the moment the
        // series grows, taking anyone who clicks it back to yesterday instead
        // of forward to what just arrived.
        if (lastLive.added) buildPresets();
        // A new bar lengthens the series. Follow it only if the pointer was
        // already on the last one, so a rewound view is not yanked forward.
        if (state.day >= series.count - 1) state.day = series.count;
        render();
      } else if (state.day === series.count) {
        // The close held its rounded cents but the day's high/low can still
        // have moved, so the range bar gets its own cheap refresh rather than
        // waiting for a render the price itself did not earn.
        renderTodayRange(market().currentPrice);
      }
    }
    renderDataStatus();
    scheduleLivePoll();
  }, wait);
}

/**
 * Best-effort top-up against whatever `series` currently is, then arms the
 * next poll. Shared by boot and by switching instruments, so VOO/IVV/QQQ/CSPX
 * pick up a live quote the moment they are selected instead of sitting on
 * yesterday's snapshot until the next scheduled poll tick fires.
 */
async function topUpLive() {
  lastLive = await refreshLive(series);
  scheduleLivePoll();
  if (lastLive.ok) {
    peaks = runningPeaks(series.closes);
    episodes = drawdownEpisodes(series.closes, episodeThreshold());
    if (lastLive.added) buildPresets();
    if (lastLive.added && state.day === series.count - 1) state.day = series.count;
    render();
  }
  renderDataStatus();
}

function switchLang(lang) {
  setLang(lang);
  for (const button of dom.langSwitch.children) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
  applyStatic();
  applyInstrumentLabels();
  buildPresets();
  replayMessage();
  renderDataStatus();
  save();
  // The palette follows the language, so the chart has to re-read its tokens
  // before the next draw or buy/sell markers keep the outgoing convention.
  chart?.refreshPalette();
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

  renderTodayRange(currentPrice);
}

/**
 * Today's high/low, as a small range bar under the price. It costs nothing
 * extra to have — the live quote call already returns high/low/open — so it
 * shows whenever they are available, and only then: a rewound day has no
 * "today" for a range to mean anything about, a fallback source (stooq,
 * Yahoo) never carries high/low at all, and a stale feed's numbers would be
 * describing a session that is not this one.
 */
function renderTodayRange(currentPrice) {
  const onTodaysBar = state.day === series.count;
  const lo = lastLive?.dayLow;
  const hi = lastLive?.dayHigh;
  if (!onTodaysBar || !lastLive?.ok || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    dom.todayRange.hidden = true;
    return;
  }

  dom.todayRange.hidden = false;
  dom.todayRangeLo.textContent = fmtPrice(lo);
  dom.todayRangeHi.textContent = fmtPrice(hi);
  dom.todayRange.title = t('mkt.todayRange', fmtPrice(lo), fmtPrice(hi));
  const at = Math.min(1, Math.max(0, (currentPrice - lo) / (hi - lo)));
  dom.todayRangeMarker.style.left = `${at * 100}%`;
}

function renderPortfolio(pf) {
  dom.pfInvested.textContent = money(pf.invested);
  dom.pfWithdrawnRow.hidden = pf.withdrawn <= 0;
  dom.pfWithdrawn.textContent = money(pf.withdrawn);
  dom.pfUnits.textContent = fmtUnits(pf.units);
  dom.pfAvg.textContent = pf.units > 0 ? fmtPrice(pf.invested / pf.units) : '—';
  dom.pfMv.textContent = money(pf.marketValue);

  dom.pfPnl.textContent = moneySigned(pf.pnl);
  dom.pfPnl.className = `kv-value ${pf.pnl >= 0 ? 'is-gain' : 'is-loss'}`;
  dom.pfRet.textContent = pf.returnPct === null ? '—' : percentSigned(pf.returnPct);
  dom.pfRet.className = `kv-value ${(pf.returnPct ?? 0) >= 0 ? 'is-gain' : 'is-loss'}`;

  dom.pfPending.hidden = pf.pending === 0;
  dom.pfPending.textContent = pf.pending ? t('pf.pending', pf.pending) : '';
}

function renderAllocation({ peak, drawdown }) {
  const rows = allocationRows(peak, state.ladderBase, drawdown);
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
        message('msg.loadedRung', 'ok', () => [
          (row.drawdown * 100).toFixed(0),
          money(row.amount),
          formatDate(market().date),
        ]);
        render();
      });
      tr.lastElementChild.appendChild(use);
      return tr;
    })
  );
}

const cell = (label, value) => `<span class="cell"><span>${label}</span><b>${value}</b></span>`;

function renderPreview({ date, currentPrice }) {
  const draft = draftTrade();
  dom.unitsOutput.value = draft ? fmtUnits(draft.units) : '0.0000';

  if (!draft) {
    dom.previewRow.textContent = t('trade.previewEmpty');
    dom.previewRow.classList.add('is-empty');
    dom.executeBtn.disabled = false;
    if (lastMessage?.transient) message(null);
    return;
  }

  const candidate = buildLedger([...state.trades, draft]);
  const row = candidate.rows.find((r) => r.id === draft.id);
  const tag = draft.action === 'BUY' ? 'tag-buy' : 'tag-sell';
  const label = t(draft.action === 'BUY' ? 'trade.buy' : 'trade.sell');

  dom.previewRow.classList.remove('is-empty');
  dom.previewRow.innerHTML =
    cell(t('col.date'), `${formatDate(date)}`) +
    cell(t('col.price'), fmtPrice(currentPrice)) +
    cell(t('col.action'), `<span class="tag ${tag}">${label}</span>`) +
    cell(t('col.units'), fmtUnits(row.units)) +
    cell(t('col.amount'), money(row.amount)) +
    cell(t('col.unitsAfter'), fmtUnits(row.unitsAfter)) +
    cell(t('col.investedAfter'), money(row.investedAfter)) +
    cell(t('col.valueAfter'), money(row.valueAfter));

  dom.executeBtn.disabled = Boolean(candidate.error);
  if (candidate.error) messageFrom(() => describeError(candidate.error), 'error', true);
  else if (lastMessage?.transient) message(null);
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
        `<td class="num">${fmtUnits(row.unitsAfter)}</td>` +
        `<td class="num">${money(row.investedAfter)}</td>` +
        `<td class="num">${money(row.valueAfter)}</td>` +
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
function renderPerformance(rows, pf) {
  const applied = rows.filter((row) => row.day <= state.day);
  const from = applied.length ? applied[0].day - 1 : -1;
  const to = state.day - 1;

  if (from < 0 || to <= from || pf.invested <= 0) {
    dom.perfEmpty.hidden = false;
    dom.perfBody.hidden = true;
    return;
  }
  dom.perfEmpty.hidden = true;
  dom.perfBody.hidden = false;

  // All three alternatives commit the same amount the user actually invested,
  // so the comparison is like for like. `you` is what that money became —
  // holdings plus anything already sold — rather than the whole account, which
  // would otherwise include cash the benchmarks never had.
  const base = pf.invested;
  const you = pf.marketValue + pf.withdrawn;
  const curve = equityCurve(rows, series.closes, from, to);
  const { lump, dca } = benchmarks(series.dates, series.closes, from, to, base);
  const gain = (value) => percentSigned(value / base - 1);

  dom.perfYou.textContent = money(you);
  dom.perfYouPct.textContent = gain(you);
  dom.perfLump.textContent = money(lump);
  dom.perfLumpPct.textContent = gain(lump);
  dom.perfDca.textContent = money(dca);
  dom.perfDcaPct.textContent = gain(dca);

  // Bars share one scale so the three outcomes are visually comparable.
  const widest = Math.max(you, lump, dca, 1);
  dom.perfYouBar.style.width = `${(you / widest) * 100}%`;
  dom.perfLumpBar.style.width = `${(lump / widest) * 100}%`;
  dom.perfDcaBar.style.width = `${(dca / widest) * 100}%`;

  const excess = you / lump - 1;
  dom.perfExcess.textContent = percentSigned(excess);
  dom.perfExcess.className = `kv-value ${excess >= 0 ? 'is-gain' : 'is-loss'}`;

  const s = stats(curve, series.dates, from, to, base, you);
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
  const pf = portfolioAt(rows, state.day, snapshot.currentPrice);
  renderPortfolio(pf);
  renderPerformance(rows, pf);
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

/**
 * Only the plot refuses a pinch, and only so that pinching the chart zooms the
 * chart rather than the page behind it. The page itself stays zoomable.
 *
 * It used to be locked document-wide, with maximum-scale=1 and
 * user-scalable=no in the viewport meta besides. That is what broke iPad:
 * Safari lays a page out at desktop width and scales it down to fit, and a
 * page that forbids scaling cannot be fitted, so it was simply cut off at
 * whichever edge you were not looking at. Every other site fits because no
 * other site takes the scale away. Zooming is also how anyone who needs
 * larger text reads this at all, which WCAG asks for and the lock denied.
 */
function lockChartPinch() {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    dom.chart.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }
}

function bindEvents() {
  dom.dayPrev.addEventListener('click', () => stepDay(-1));
  dom.dayNext.addEventListener('click', () => stepDay(1));
  dom.dayInput.addEventListener('change', () => setDay(dom.dayInput.value));

  dom.ladderBase.addEventListener('change', () => {
    const value = Number(dom.ladderBase.value);
    if (!Number.isFinite(value) || value < 0) {
      dom.ladderBase.value = String(state.ladderBase);
      return;
    }
    state.ladderBase = value;
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

  // Changing either setting redraws the bands, so re-arm from where the
  // pointer already is rather than replaying every band it has passed.
  dom.alertsStep.addEventListener('change', () => {
    state.alertStep = Number(dom.alertsStep.value) || DEFAULT_ALERT_STEP;
    alertedLevel = bandNow();
    save();
  });

  dom.alertsBasis.addEventListener('change', () => {
    state.alertBasis = dom.alertsBasis.value === 'trade' ? 'trade' : 'peak';
    alertedLevel = bandNow();
    save();
  });

  dom.langSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('.lang-btn');
    if (button) switchLang(button.dataset.lang);
  });

  dom.zoomReset.addEventListener('click', () => chart.resetView());

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
/**
 * Instrument names carry their descriptive half after a middle dot — "CSPX ·
 * iShares Core S&P 500 UCITS". The board head splits it in two so CSS can drop
 * the descriptive part on a narrow screen, where it ran the title to a board's
 * full width to repeat what the picker directly above was already showing, and
 * keep it where there is room for it.
 */
const splitName = (name) => {
  const cut = name.indexOf(' · ');
  return cut < 0 ? [name, ''] : [name.slice(0, cut), name.slice(cut)];
};

function applyInstrumentLabels() {
  const name = series.name ?? 'S&P 500';
  document.querySelector('.brand-sub').textContent = name;

  const [lead, rest] = splitName(name);
  const leadEl = document.createElement('span');
  leadEl.className = 'title-lead';
  leadEl.textContent = lead;
  const restEl = document.createElement('span');
  restEl.className = 'title-rest';
  restEl.textContent = rest + t('panel.chartSuffix');
  dom.chartTitle.replaceChildren(leadEl, restEl);

  document.title = t('app.title', name);

  for (const node of document.querySelectorAll('.footer-note')) node.remove();

  const notes = [];
  if (series.proxy) notes.push(t('proxy.note', series.symbol));
  if (series.accumulating) notes.push(t('accumulating.note', series.symbol));

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
  // Say which session it is, so a price that is not moving reads as a closed
  // market rather than a broken page.
  dom.dataStatus.textContent = label + t(`session.${sessionAt()}`);
  dom.dataStatus.title = live?.ok
    ? t('status.liveTitle', live.source)
    : live?.reason
      ? t('status.offlineReason', t(`status.reason.${live.reason}`))
      : t('status.offlineTitle');

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

/** Rebuilds every derived structure after a new series is loaded. */
function adoptSeries() {
  peaks = runningPeaks(series.closes);
  episodes = drawdownEpisodes(series.closes, episodeThreshold());
  alertedLevel = bandNow();
  applyInstrumentLabels();
  buildPresets();
}

async function switchInstrument(id) {
  if (id === state.instrument) return;
  // Park the outgoing book before the series it is anchored to goes away.
  books[state.instrument] = {
    day: state.day,
    dayDate: series.dates[state.day - 1],
    trades: state.trades,
  };

  try {
    series = await loadSeries(id);
  } catch (error) {
    dom.dataError.hidden = false;
    dom.dataError.textContent = error.message;
    dom.instrument.value = state.instrument;
    return;
  }

  state.instrument = id;
  adoptSeries();
  restoreBook(books[id]);
  message(null);
  lastLive = null;
  save();
  render();
  renderDataStatus();
  // Not awaited: the switch itself should not stall on the network, and the
  // status pill/range bar update in place once the quote lands.
  topUpLive();
}

function buildInstrumentPicker() {
  if (!manifest) return;
  dom.instrument.hidden = false;
  dom.instrument.replaceChildren(
    ...manifest.instruments.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      option.selected = entry.id === state.instrument;
      return option;
    })
  );
  dom.instrument.addEventListener('change', () => switchInstrument(dom.instrument.value));
}

async function main() {
  const saved = readSaved();
  setLang(LANGS.includes(saved?.lang) ? saved.lang : DEFAULT_LANG);
  for (const button of dom.langSwitch.children) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  }
  applyStatic();
  buildMeterTicks();
  dom.dataStatus.textContent = t('status.loading');

  manifest = await loadManifest();
  restoreSettings(saved);
  // After the restore, not before it: these were reading the defaults.
  dom.alertsStep.value = String(state.alertStep);
  dom.alertsBasis.value = state.alertBasis;
  state.instrument =
    manifest?.instruments.some((i) => i.id === saved?.instrument) ? saved.instrument
    : manifest ? manifest.default
    : '__legacy';

  try {
    series = await loadSeries(manifest ? state.instrument : null);
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

  adoptSeries();
  restoreBook(books[state.instrument] ?? books.__legacy);
  dom.ladderBase.value = String(state.ladderBase);
  dom.alertsToggle.checked = state.alerts;
  dom.logToggle.setAttribute('aria-pressed', String(state.logScale));
  for (const button of dom.legend.querySelectorAll('[data-series]')) {
    button.setAttribute('aria-pressed', String(state.visible[button.dataset.series]));
  }
  alertedLevel = bandNow();

  buildInstrumentPicker();
  chart = createChart(dom.chart, dom.chartTip, {
    onScrub: (day) => setDay(day),
    onZoom: (zoomed) => {
      dom.zoomReset.hidden = !zoomed;
    },
  });
  bindEvents();
  lockChartPinch();
  render();
  dom.layout.setAttribute('aria-busy', 'false');
  renderDataStatus();

  document.addEventListener('visibilitychange', scheduleLivePoll);
  await topUpLive();
}

main();
