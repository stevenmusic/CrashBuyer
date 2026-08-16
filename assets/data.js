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

/** Calendar days between the last bar and today. */
export function daysSince(iso) {
  const then = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then) / 86400000);
}

export function isStale(series) {
  return daysSince(series.end) > STALE_AFTER_DAYS;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
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
