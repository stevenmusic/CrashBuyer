#!/usr/bin/env node
// Fetches the full S&P 500 daily close history and writes data/sp500-daily.json.
//
// Sources are tried in order until one returns a usable series. Stooq is first
// because it needs no key and serves the whole history in one CSV; Yahoo is the
// fallback. Run locally with `node scripts/fetch-sp500.mjs`; CI runs it daily.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/sp500-daily.json');

// Only keep this much history. The reference simulator runs ~10.5 years, which
// is long enough to contain 2018, 2020, 2022 and 2025 without making the day
// pointer unwieldy.
const YEARS = 10.6;

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
const sources = [
  { name: 'fred', fetch: fromFred, skip: () => !process.env.FRED_API_KEY },
  { name: 'stockanalysis', fetch: fromStockAnalysis },
  { name: 'stooq', fetch: fromStooq },
  { name: 'yahoo', fetch: fromYahoo },
];

const META = {
  fred: { symbol: '^GSPC', name: 'S&P 500', proxy: false },
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
 * FRED's official API — real S&P 500 index closes. Its SP500 series only goes
 * back 10 years, which is the window this simulator wants anyway. Holidays come
 * through as "." and are dropped.
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
async function fromStockAnalysis() {
  const url = 'https://stockanalysis.com/api/symbol/s/spy/history?range=10Y&period=Day';
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

// Sorts, de-duplicates by date and trims to the retention window.
function normalise(rows) {
  const byDate = new Map();
  for (const [date, close] of rows) byDate.set(date, close);

  const sorted = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  // UTC throughout, so the window does not shift with the runner's timezone.
  const cutoff = new Date(`${sorted.at(-1)[0]}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Math.floor(YEARS));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.round((YEARS % 1) * 12));
  const from = cutoff.toISOString().slice(0, 10);

  return sorted.filter(([date]) => date >= from);
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
  if (next.count < prev.count * 0.9) {
    throw new Error(`refusing to shrink series: ${prev.count} committed vs ${next.count} fetched`);
  }
  if (next.end < prev.end) {
    throw new Error(`refusing to go backwards: committed ends ${prev.end}, fetched ends ${next.end}`);
  }
}

async function main() {
  const failures = [];
  for (const source of sources) {
    if (source.skip?.()) {
      console.log(`[fetch-sp500] ${source.name} skipped — no API key configured`);
      continue;
    }

    let rows;
    try {
      rows = normalise(await source.fetch());
    } catch (err) {
      failures.push(`${source.name}: ${err.message}`);
      console.warn(`[fetch-sp500] ${source.name} failed — ${err.message}`);
      continue;
    }

    if (rows.length < 500) {
      failures.push(`${source.name}: only ${rows.length} rows`);
      console.warn(`[fetch-sp500] ${source.name} returned only ${rows.length} rows, skipping`);
      continue;
    }

    const payload = {
      ...META[source.name],
      source: source.name,
      updatedAt: new Date().toISOString(),
      start: rows[0][0],
      end: rows.at(-1)[0],
      count: rows.length,
      dates: rows.map((r) => r[0]),
      closes: rows.map((r) => Math.round(r[1] * 100) / 100),
    };

    await assertNotWorseThanCommitted(payload);
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(payload) + '\n');
    console.log(
      `[fetch-sp500] wrote ${payload.count} rows from ${source.name}: ` +
        `${payload.start} → ${payload.end} (last close ${payload.closes.at(-1)})`
    );
    return;
  }

  console.error('[fetch-sp500] every source failed:\n  ' + failures.join('\n  '));
  process.exit(1);
}

main();
