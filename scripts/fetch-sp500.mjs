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
 * come from stockanalysis.com, which serves `/s/` (stocks and ETFs) without one
 * but 400s on `/i/` for every index symbol.
 *
 * London-listed accumulating trackers such as CSPX are deliberately absent:
 * that endpoint only covers US listings, so they would 404.
 */
const INSTRUMENTS = [
  { id: 'sp500', symbol: '^GSPC', name: 'S&P 500', kind: 'index', proxy: false },
  { id: 'spy', symbol: 'SPY', name: 'SPY · SPDR S&P 500', kind: 'etf', proxy: true },
  { id: 'voo', symbol: 'VOO', name: 'VOO · Vanguard S&P 500', kind: 'etf', proxy: true },
  { id: 'ivv', symbol: 'IVV', name: 'IVV · iShares Core S&P 500', kind: 'etf', proxy: true },
  { id: 'qqq', symbol: 'QQQ', name: 'QQQ · Invesco Nasdaq 100', kind: 'etf', proxy: true },
];

const fileFor = (id) => resolve(DATA_DIR, `${id}.json`);

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
 * Alpha Vantage, optional. `outputsize=full` reaches back to the late 1990s,
 * which is the only key-less-or-cheap way found to get daily bars before ~2016:
 * FRED's SP500 series is a rolling ten years and stockanalysis silently caps at
 * 10Y (every longer range returns one year). Covers ETFs, not the index.
 */
async function fromAlphaVantage(symbol) {
  const url =
    'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=full' +
    `&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(process.env.ALPHAVANTAGE_API_KEY)}`;
  const json = await (await get(url, 'application/json')).json();

  // Free-tier throttling comes back as 200 with a prose "Note"/"Information".
  const series = json?.['Time Series (Daily)'];
  if (!series) {
    throw new Error(String(json?.Note ?? json?.Information ?? json?.['Error Message'] ?? 'unexpected payload').slice(0, 90));
  }

  const rows = [];
  for (const [date, bar] of Object.entries(series)) {
    const close = Number(bar?.['4. close']);
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

/** Sorts and de-duplicates by date. All available history is kept. */
function normalise(rows) {
  const byDate = new Map();
  for (const [date, close] of rows) byDate.set(date, close);
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
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
  const manifest = { updatedAt: new Date().toISOString(), default: available[0].id, instruments: available };
  await writeFile(resolve(DATA_DIR, 'instruments.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[fetch] manifest: ${available.map((a) => a.id).join(', ')} (default ${manifest.default})`);
}

main();
