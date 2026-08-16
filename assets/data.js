// Loading the price series.
//
// Two layers:
//   1. data/sp500-daily.json — committed to the repo and refreshed every
//      weekday by .github/workflows/update-data.yml. Always available, works
//      offline, and is what every calculation is based on.
//   2. A best-effort live quote fetched in the browser on load, which tops the
//      series up with today's bar. Both public endpoints below are used without
//      an API key, so a browser may refuse them on CORS grounds — that is not
//      an error, it just leaves the page on the daily snapshot.

const DATA_URL = new URL('../data/sp500-daily.json', import.meta.url);
const LIVE_TIMEOUT_MS = 6000;

/** Trading days after which the committed snapshot is called out as stale. */
const STALE_AFTER_DAYS = 5;

/** Rolling window kept in memory, matching what scripts/fetch-sp500.mjs commits. */
const WINDOW_YEARS = 10.6;

export async function loadSeries() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'data/sp500-daily.json is missing — run the "Update S&P 500 data" workflow (or `node scripts/fetch-sp500.mjs`) to create it.'
        : `Could not load price data (HTTP ${res.status}).`
    );
  }

  const json = await res.json();
  const { dates, closes } = json;
  if (!Array.isArray(dates) || !Array.isArray(closes) || dates.length !== closes.length || !dates.length) {
    throw new Error('Price data is malformed: expected matching non-empty `dates` and `closes` arrays.');
  }
  return json;
}

/** Sorts, de-duplicates and trims to the rolling window. */
function toSeries(rows, source) {
  const byDate = new Map(rows);
  const sorted = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const cutoff = new Date(`${sorted.at(-1)[0]}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Math.floor(WINDOW_YEARS));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.round((WINDOW_YEARS % 1) * 12));
  const from = cutoff.toISOString().slice(0, 10);
  const kept = sorted.filter(([date]) => date >= from);

  return {
    symbol: '^GSPC',
    name: 'S&P 500',
    source: `${source} (in-browser)`,
    updatedAt: new Date().toISOString(),
    start: kept[0][0],
    end: kept.at(-1)[0],
    count: kept.length,
    dates: kept.map((r) => r[0]),
    closes: kept.map((r) => Math.round(r[1] * 100) / 100),
  };
}

async function stooqHistory() {
  const res = await fetchWithTimeout('https://stooq.com/q/d/l/?s=%5Espx&i=d', {}, 20000);
  const lines = (await res.text()).trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = head.indexOf('date');
  const iClose = head.indexOf('close');
  if (iDate < 0 || iClose < 0) throw new Error('unexpected CSV columns');

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const close = Number(cells[iClose]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[iDate]) && Number.isFinite(close) && close > 0) {
      rows.push([cells[iDate], close]);
    }
  }
  return rows;
}

async function yahooHistory() {
  const res = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=15y&interval=1d',
    {},
    20000
  );
  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const rows = [];
  for (let i = 0; i < stamps.length; i++) {
    if (Number.isFinite(closes[i]) && closes[i] > 0) {
      rows.push([new Date(stamps[i] * 1000).toISOString().slice(0, 10), closes[i]]);
    }
  }
  return rows;
}

/**
 * Last-resort path when the committed snapshot is missing: pull the whole
 * history straight from the browser. Whether this is allowed is up to the
 * endpoint's CORS policy, so it is a bonus, not the supported route.
 */
export async function bootstrapSeries() {
  for (const source of [
    { name: 'stooq', fetch: stooqHistory },
    { name: 'yahoo', fetch: yahooHistory },
  ]) {
    try {
      const rows = await source.fetch();
      if (rows.length >= 500) return toSeries(rows, source.name);
    } catch {
      // Try the next source.
    }
  }
  return null;
}

/** Calendar days between the last bar and today. */
export function daysSince(iso) {
  const then = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then) / 86400000);
}

export function isStale(series) {
  return daysSince(series.end) > STALE_AFTER_DAYS;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = LIVE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function stooqQuote() {
  const res = await fetchWithTimeout('https://stooq.com/q/l/?s=%5Espx&f=sd2t2ohlcv&h&e=csv');
  const lines = (await res.text()).trim().split('\n');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const cells = lines[1].split(',');
  const date = cells[head.indexOf('date')];
  const close = Number(cells[head.indexOf('close')]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) {
    throw new Error('unusable quote');
  }
  return { date, close };
}

async function yahooQuote() {
  const res = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d'
  );
  const result = (await res.json())?.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (Number.isFinite(closes[i]) && closes[i] > 0) {
      return { date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close: closes[i] };
    }
  }
  throw new Error('no usable bar');
}

const LIVE_SOURCES = [
  { name: 'stooq', fetch: stooqQuote },
  { name: 'yahoo', fetch: yahooQuote },
];

/**
 * Tops the series up with the newest quote a browser can reach. Mutates
 * `series` in place and reports what changed so the caller can re-render.
 * Never throws: a blocked or unreachable endpoint just means `ok: false`.
 */
export async function refreshLive(series) {
  for (const source of LIVE_SOURCES) {
    let quote;
    try {
      quote = await source.fetch();
    } catch {
      continue;
    }

    const last = series.dates.length - 1;
    const close = Math.round(quote.close * 100) / 100;

    if (quote.date > series.dates[last]) {
      series.dates.push(quote.date);
      series.closes.push(close);
      series.end = quote.date;
      series.count = series.dates.length;
      return { ok: true, source: source.name, added: true, date: quote.date, close };
    }

    if (quote.date === series.dates[last]) {
      const changed = series.closes[last] !== close;
      series.closes[last] = close;
      return { ok: true, source: source.name, added: false, changed, date: quote.date, close };
    }

    // Quote older than what is committed (a stale mirror) — ignore it.
    return { ok: false, reason: 'stale' };
  }

  return { ok: false, reason: 'unreachable' };
}
