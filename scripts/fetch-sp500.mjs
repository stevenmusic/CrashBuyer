#!/usr/bin/env node
// Fetches the S&P 500 daily close history and writes data/sp500-daily.json.
//
// Daily bars only. A monthly series was tried and dropped: averaging a month of
// closes hides exactly the intramonth collapses this tool exists to show, and a
// chart mixing the two resolutions invites the reader to compare a smoothed
// 1930s with a jagged 2020s. Sources are tried in order; CI runs this daily.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'data');

/**
 * Instruments offered in the picker. The index needs a free FRED key; the ETFs
 * prefer a free TIINGO_API_KEY, which reaches 2000, and fall back to
 * stockanalysis.com, which serves `/s/` (stocks and ETFs) without a key but
 * 400s on `/i/` for every index symbol and caps history at ten years.
 *
 * London-listed accumulating trackers such as CSPX are deliberately absent:
 * that endpoint only covers US listings, so they would 404.
 */
/**
 * Which instrument the picker opens on. The index is the honest answer but FRED
 * only serves a rolling ten years, so it cannot reach the two crashes this tool
 * most exists for — 2000 and 2008. SPY carries the same percentages back to
 * 2000 and is labelled a proxy in the UI, so it opens instead. Falls back to
 * whatever did download if SPY failed today.
 */
const DEFAULT_ID = 'spy';

const INSTRUMENTS = [
  { id: 'sp500', symbol: '^GSPC', name: 'S&P 500', kind: 'index', proxy: false },
  { id: 'spy', symbol: 'SPY', name: 'SPY · SPDR S&P 500', kind: 'etf', proxy: true },
  { id: 'voo', symbol: 'VOO', name: 'VOO · Vanguard S&P 500', kind: 'etf', proxy: true },
  { id: 'ivv', symbol: 'IVV', name: 'IVV · iShares Core S&P 500', kind: 'etf', proxy: true },
  { id: 'qqq', symbol: 'QQQ', name: 'QQQ · Invesco Nasdaq 100', kind: 'etf', proxy: true },
  {
    id: 'cspx',
    symbol: 'CSPX',
    name: 'CSPX · iShares Core S&P 500 UCITS',
    kind: 'etf',
    proxy: true,
    // Not on any US-listing feed: Tiingo answers "Ticker not found" for every
    // spelling and Twelve Data gates the London line behind a paid plan.
    // justETF serves it by ISIN with no key, in whichever currency is asked
    // for — USD here, so the London line rather than the EUR Xetra one.
    isin: 'IE00B5BMR087',
    via: 'justetf',
    // The one that has to be labelled: CSPX reinvests its dividends inside the
    // fund, so its price is a total-return series while SPY, VOO and IVV quote
    // price only. Over the window they share, 2010-05-19 to 2026-08-18, that is
    // 8.78x against SPY's 6.87x — 1.52%/yr that is dividends, not skill.
    accumulating: true,
  },
];

const fileFor = (id) => resolve(DATA_DIR, `${id}.json`);

/**
 * Earliest bar to keep. Alpha Vantage reaches back further for the older ETFs
 * (SPY listed in 1993), but a common floor keeps the instruments comparable and
 * the day-pointer numbering sane. Sources that cannot reach it simply start
 * later — the manifest records each one's real range.
 */
const START_FROM = '2000-01-01';

// Which sources answer a GitHub-hosted runner was measured, not guessed:
//
//   api.stlouisfed.org      200 with a key   <- true S&P 500 index levels
//   stockanalysis.com /s/   200, no key      <- ETF only; /i/ (indices) 400s
//   fred.stlouisfed.org/graph  connection times out
//   stooq.com               200 but an HTML "robots" interstitial
//   query{1,2}.finance.yahoo.com  429 for the whole runner IP range
//
// So FRED is preferred and gives the real index, but it needs a free key in the
// FRED_API_KEY secret. Without one, SPY stands in: it tracks the index closely
// and every number this simulator shows except the raw price level is a
// percentage, so the ladder and returns behave the same. The payload records
// which one was used so the UI can label a proxy honestly.
// Fallbacks used only when the index series above cannot be built at all. SPY
// quotes roughly a tenth of the index level, so it is flagged as a proxy.
const FALLBACKS = [
  { name: 'stockanalysis', fetch: fromStockAnalysis },
  { name: 'stooq', fetch: fromStooq },
  { name: 'yahoo', fetch: fromYahoo },
];

const META = {
  stockanalysis: { symbol: 'SPY', name: 'S&P 500 · SPY ETF', proxy: true },
  stooq: { symbol: '^GSPC', name: 'S&P 500', proxy: false },
  yahoo: { symbol: '^GSPC', name: 'S&P 500', proxy: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept,
          // These endpoints serve bot-ish clients unevenly without a browser UA.
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        },
      });
      if (res.ok) return res;
      // Rate limits and upstream blips are worth another try; 4xx is not.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await sleep(attempt * 2000);
  }
  throw lastError;
}

/**
 * FRED's official API — real daily S&P 500 index closes. The SP500 series only
 * covers the last 10 years, which is exactly the window it is used for here.
 * Holidays come through as "." and are dropped.
 */
async function fromFred() {
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 11);
  const url =
    'https://api.stlouisfed.org/fred/series/observations' +
    `?series_id=SP500&file_type=json&observation_start=${start.toISOString().slice(0, 10)}` +
    `&api_key=${encodeURIComponent(process.env.FRED_API_KEY)}`;

  const json = await (await get(url, 'application/json')).json();
  if (!Array.isArray(json?.observations)) throw new Error('unexpected FRED payload');

  const rows = [];
  for (const { date, value } of json.observations) {
    const close = Number(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
      rows.push([date, close]);
    }
  }
  return rows;
}

/**
 * stockanalysis.com, no key required. Only the /s/ (stocks and ETFs) route
 * works — /i/ returns 400 for every S&P index symbol — so this is SPY, newest
 * bar first. `c` is the raw close; the dividend-adjusted `a` is deliberately
 * ignored so the series behaves like a price index.
 */
/**
 * Alpha Vantage, optional and currently of little use: `outputsize=full` — the
 * only setting that reaches past the last 100 bars — is a paid feature, so a
 * free key buys nothing here. Kept because a paid key would work unchanged, and
 * because the failure is worth logging explicitly rather than looking like a
 * network problem. Covers ETFs, not the index.
 */
/**
 * Alpha Vantage's free tier allows about five calls a minute and answers a
 * sixth with a 200 and a prose apology rather than a status code. Four ETFs
 * fired back to back tripped it every time, so calls are paced.
 */
const ALPHA_SPACING_MS = 15000;
let lastAlphaCall = 0;

async function paceAlphaVantage() {
  const wait = lastAlphaCall + ALPHA_SPACING_MS - Date.now();
  if (wait > 0) {
    console.log(`[fetch] pacing Alpha Vantage — waiting ${Math.ceil(wait / 1000)}s`);
    await sleep(wait);
  }
  lastAlphaCall = Date.now();
}

async function fromAlphaVantage(symbol) {
  await paceAlphaVantage();
  const url =
    'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=full' +
    `&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(process.env.ALPHAVANTAGE_API_KEY)}`;
  const json = await (await get(url, 'application/json')).json();

  // Free-tier throttling comes back as 200 with a prose "Note"/"Information".
  let series = json?.['Time Series (Daily)'];
  if (!series) {
    const complaint = String(json?.Note ?? json?.Information ?? json?.['Error Message'] ?? 'unexpected payload');
    // Only a rate-limit complaint is worth waiting out. Every Alpha Vantage
    // refusal opens with "Thank you for using Alpha Vantage!", including the
    // one saying outputsize=full is paid — matching on that wasted a minute
    // per instrument discovering a permanent condition.
    if (!/frequency|spread out|per minute|calls per/i.test(complaint)) {
      throw new Error(complaint.slice(0, 110));
    }
    console.log('[fetch] Alpha Vantage throttled, backing off 60s');
    await sleep(60000);
    lastAlphaCall = Date.now();
    const retry = await (await get(url, 'application/json')).json();
    series = retry?.['Time Series (Daily)'];
    if (!series) {
      throw new Error(String(retry?.Note ?? retry?.Information ?? 'still throttled').slice(0, 90));
    }
  }

  const rows = [];
  for (const [date, bar] of Object.entries(series)) {
    const close = Number(bar?.['4. close']);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) rows.push([date, close]);
  }
  return rows;
}

/**
 * Tiingo's EOD API. A free key reaches back to listing — measured in CI at 6696
 * SPY bars from 2000-01-03, against stockanalysis.com's hard 10-year ceiling —
 * which is the whole reason this source exists. It covers stocks and ETFs but
 * not indices, so the S&P 500 itself still comes from FRED.
 *
 * `close` is the raw as-reported close and `adjClose` folds in dividends, so
 * neither is what this chart wants. Splits alone are undone here: a 2:1 split
 * left in a raw series reads as a one-day halving, indistinguishable from the
 * crashes this tool exists to show. QQQ split 2:1 in March 2000, inside the
 * window, so this is load-bearing rather than defensive.
 */
async function fromTiingo(symbol) {
  const url =
    `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol.toLowerCase())}/prices` +
    `?startDate=${START_FROM}&token=${encodeURIComponent(process.env.TIINGO_API_KEY)}`;
  const json = await (await get(url, 'application/json')).json();
  if (!Array.isArray(json)) throw new Error(`unexpected payload: ${JSON.stringify(json).slice(0, 80)}`);

  const bars = [];
  for (const bar of json) {
    const date = String(bar?.date ?? '').slice(0, 10);
    const close = Number(bar?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    const split = Number(bar?.splitFactor);
    bars.push([date, close, Number.isFinite(split) && split > 0 ? split : 1]);
  }
  bars.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // Walk newest to oldest accumulating split factors, so each bar is divided by
  // the splits that happened after it. The factor is reported on the split's
  // effective day, so it applies to every earlier bar but not to that one.
  const rows = [];
  let cumulative = 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const [date, close, split] = bars[i];
    rows.push([date, close / cumulative]);
    cumulative *= split;
  }
  return rows;
}

/**
 * justETF, keyed by ISIN and key-less. The only free route to a UCITS tracker
 * measured from CI: the issuer's own files answer with the product page rather
 * than a CSV, Boerse Frankfurt's history endpoint returns an empty object,
 * Yahoo 429s across the runner range and stooq serves its robots page.
 *
 * `valuesType=NET_ASSET_VALUE` comes back empty, so this asks for market value
 * — the quoted price, which is what the rest of the series are anyway.
 */
async function fromJustEtf(isin) {
  const url =
    `https://www.justetf.com/api/etfs/${encodeURIComponent(isin)}/performance-chart` +
    '?locale=en&currency=USD&valuesType=MARKET_VALUE&reduceData=false&includeDividends=false';
  const json = await (await get(url, 'application/json')).json();
  if (!Array.isArray(json?.series)) throw new Error(`unexpected payload: ${JSON.stringify(json).slice(0, 80)}`);

  const rows = [];
  for (const bar of json.series) {
    const date = String(bar?.date ?? '');
    const close = Number(bar?.value?.raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) rows.push([date, close]);
  }
  return rows;
}

async function fromStockAnalysis(symbol) {
  const url = `https://stockanalysis.com/api/symbol/s/${symbol.toLowerCase()}/history?range=10Y&period=Day`;
  const json = await (await get(url, 'application/json')).json();
  if (!Array.isArray(json?.data)) throw new Error(`unexpected payload: ${JSON.stringify(json).slice(0, 80)}`);

  const rows = [];
  for (const bar of json.data) {
    const close = Number(bar?.c);
    if (/^\d{4}-\d{2}-\d{2}$/.test(bar?.t ?? '') && Number.isFinite(close) && close > 0) {
      rows.push([bar.t, close]);
    }
  }
  return rows;
}

async function fromStooq() {
  const res = await get('https://stooq.com/q/d/l/?s=%5Espx&i=d', 'text/csv');
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (!/^Date,/i.test(lines[0])) throw new Error(`unexpected CSV header: ${lines[0]?.slice(0, 60)}`);

  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = head.indexOf('date');
  const iClose = head.indexOf('close');
  if (iDate < 0 || iClose < 0) throw new Error('CSV missing Date/Close columns');

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const date = cells[iDate];
    const close = Number(cells[iClose]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    rows.push([date, close]);
  }
  return rows;
}

async function fromYahoo() {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=25y&interval=1d&events=div%2Csplit';
  const res = await get(url, 'application/json');
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) throw new Error('unexpected Yahoo payload');

  const rows = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push([new Date(stamps[i] * 1000).toISOString().slice(0, 10), close]);
  }
  return rows;
}

/** Sorts, de-duplicates by date and drops anything before the floor. */
function normalise(rows) {
  const byDate = new Map();
  for (const [date, close] of rows) byDate.set(date, close);
  return [...byDate.entries()]
    .filter(([date]) => date >= START_FROM)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Guards against a source that answers 200 with a truncated or stale series —
// overwriting good data with that is worse than failing the run.
async function assertNotWorseThanCommitted(next) {
  let prev;
  try {
    prev = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return; // No committed data yet (or it is unreadable): nothing to compare.
  }
  if (prev.seed) return;
  // A deliberate change of source or instrument legitimately reshapes the
  // series, so only guard against regressions within the same source.
  if (prev.source !== next.source || prev.symbol !== next.symbol) return;
  if (next.count < prev.count * 0.9) {
    throw new Error(`refusing to shrink series: ${prev.count} committed vs ${next.count} fetched`);
  }
  if (next.end < prev.end) {
    throw new Error(`refusing to go backwards: committed ends ${prev.end}, fetched ends ${next.end}`);
  }
}

async function assertNotWorse(file, next) {
  let prev;
  try {
    prev = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return; // Nothing committed yet.
  }
  if (prev.source !== next.source || prev.symbol !== next.symbol) return;
  if (next.count < prev.count * 0.9) {
    throw new Error(`refusing to shrink: ${prev.count} committed vs ${next.count} fetched`);
  }
  if (next.end < prev.end) {
    throw new Error(`refusing to go backwards: committed ends ${prev.end}, fetched ends ${next.end}`);
  }
}

const pack = (rows, extra) => ({
  ...extra,
  updatedAt: new Date().toISOString(),
  start: rows[0][0],
  end: rows.at(-1)[0],
  count: rows.length,
  dailyFrom: rows[0][0],
  dates: rows.map((r) => r[0]),
  closes: rows.map((r) => Math.round(r[1] * 100) / 100),
});

/** Fetches one instrument, or returns null with a reason if it cannot be had. */
async function fetchInstrument(instrument) {
  if (instrument.kind === 'index') {
    if (!process.env.FRED_API_KEY) return { skipped: 'no FRED_API_KEY' };
    const rows = normalise(await fromFred());
    if (rows.length < 500) throw new Error(`only ${rows.length} rows`);
    return { payload: pack(rows, { ...instrument, source: 'fred' }) };
  }
  // An instrument that names its own route takes it; there is no second source
  // for a UCITS listing to fall back to.
  if (instrument.via === 'justetf') {
    const rows = normalise(await fromJustEtf(instrument.isin));
    if (rows.length < 500) throw new Error(`only ${rows.length} rows`);
    return { payload: pack(rows, { ...instrument, source: 'justetf' }) };
  }

  // Tiingo first when configured: the same instrument back to 2000 instead of
  // the ten years stockanalysis.com caps at.
  if (process.env.TIINGO_API_KEY) {
    try {
      const rows = normalise(await fromTiingo(instrument.symbol));
      if (rows.length >= 500) return { payload: pack(rows, { ...instrument, source: 'tiingo' }) };
      console.warn(`[fetch] ${instrument.id} tiingo returned ${rows.length} rows, falling back`);
    } catch (err) {
      console.warn(`[fetch] ${instrument.id} tiingo failed — ${err.message}, falling back`);
    }
  }
  // Alpha Vantage first when configured: same instrument, decades more history.
  if (process.env.ALPHAVANTAGE_API_KEY) {
    try {
      const rows = normalise(await fromAlphaVantage(instrument.symbol));
      if (rows.length >= 500) return { payload: pack(rows, { ...instrument, source: 'alphavantage' }) };
      console.warn(`[fetch] ${instrument.id} alphavantage returned ${rows.length} rows, falling back`);
    } catch (err) {
      console.warn(`[fetch] ${instrument.id} alphavantage failed — ${err.message}, falling back`);
    }
  }

  const rows = normalise(await fromStockAnalysis(instrument.symbol));
  if (rows.length < 500) throw new Error(`only ${rows.length} rows`);
  return { payload: pack(rows, { ...instrument, source: 'stockanalysis' }) };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const available = [];
  const failures = [];

  for (const instrument of INSTRUMENTS) {
    try {
      const { payload, skipped } = await fetchInstrument(instrument);
      if (skipped) {
        console.log(`[fetch] ${instrument.id.padEnd(6)} skipped — ${skipped}`);
        continue;
      }
      const file = fileFor(instrument.id);
      await assertNotWorse(file, payload);
      await writeFile(file, JSON.stringify(payload) + '\n');
      available.push({
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        proxy: instrument.proxy,
        accumulating: Boolean(instrument.accumulating),
        start: payload.start,
        end: payload.end,
        count: payload.count,
      });
      console.log(
        `[fetch] ${instrument.id.padEnd(6)} ${payload.count} bars ${payload.start} → ${payload.end}` +
          ` (last ${payload.closes.at(-1)})`
      );
    } catch (err) {
      failures.push(`${instrument.id}: ${err.message}`);
      console.warn(`[fetch] ${instrument.id.padEnd(6)} failed — ${err.message}`);
    }
  }

  if (!available.length) {
    console.error('[fetch] every instrument failed:\n  ' + failures.join('\n  '));
    process.exit(1);
  }

  // The manifest is what the page reads to build its picker, so an instrument
  // that failed today simply does not appear rather than 404-ing at runtime.
  const preferred = available.some((a) => a.id === DEFAULT_ID) ? DEFAULT_ID : available[0].id;
  const manifest = { updatedAt: new Date().toISOString(), default: preferred, instruments: available };
  await writeFile(resolve(DATA_DIR, 'instruments.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[fetch] manifest: ${available.map((a) => a.id).join(', ')} (default ${manifest.default})`);
}

main();
