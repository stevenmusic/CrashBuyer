// Cloudflare Worker: one CORS-answering quote endpoint in front of Finnhub.
//
// It exists for three reasons. The browser cannot call stooq or Yahoo directly
// — they send no Access-Control-Allow-Origin, so their answers are refused
// however often the page asks. An API key put in the page's own JavaScript is
// a key anyone can read and spend. And the cache means every viewer shares one
// upstream call, so the rate limit is a property of the site rather than of
// how many people happen to be watching.
//
// GET /?symbol=SPY  ->  { "date": "2026-08-20", "close": 769.06, "session": … }
// GET /?symbol=SPY&debug=1  ->  the upstream response, unchanged, for seeing
// what a given plan actually returns.

/**
 * Normally empty: the key belongs in the Worker's encrypted secrets, set from
 * Settings → Variables and Secrets, and read from `env` below. If that panel
 * will not cooperate, paste the key here **in the dashboard editor only** and
 * leave this file's copy empty. The deployed code is private to the Cloudflare
 * account, so the key is not published — but a secret is still the better
 * place, because it cannot be read back out once saved.
 */
const INLINE_KEY = '';

const ALLOWED_ORIGINS = [
  'https://stevenmusic.github.io',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

/**
 * Matches the page's fastest poll, so each request gets a fresh number and no
 * two viewers cost two upstream calls. Finnhub's free tier limits by the
 * minute rather than the day — 60 calls — and at this window the upstream sees
 * four a minute however many people are on the page.
 */
const CACHE_SECONDS = 15;

/** en-CA renders as YYYY-MM-DD, which is the shape the page expects. */
const NY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  Vary: 'Origin',
});

/**
 * Reads Finnhub's quote shape: `c` is the current price, `pc` the previous
 * close, `t` a unix timestamp in seconds. Outside regular hours `c` holds the
 * last price it has, which is the honest thing to show — the page says which
 * session it is, so a number that stops moving reads as a closed market.
 *
 * `h`/`l`/`o` are today's high, low and open. They ride along at no extra
 * cost — the same call already returns them — and are what lets the page draw
 * a range indicator instead of only a single moving number.
 *
 * A symbol Finnhub does not know comes back as zeroes rather than an error,
 * which is why a zero close is rejected here instead of trusted.
 */
function readQuote(json) {
  const close = Number(json?.c);
  const seconds = Number(json?.t);
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;

  const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

  return {
    // The New York date, not UTC. After 20:00 ET the UTC clock has already
    // rolled over, so an ISO slice would label an after-hours quote with
    // tomorrow, and the page would append a bar for a day that has not
    // happened instead of updating today's.
    date: NY_DATE.format(new Date(seconds * 1000)),
    close: Math.round(close * 100) / 100,
    source: 'finnhub',
    previousClose: positive(Number(json?.pc)),
    dayHigh: positive(Number(json?.h)),
    dayLow: positive(Number(json?.l)),
    dayOpen: positive(Number(json?.o)),
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || 'SPY').toUpperCase();
    if (!/^[A-Z.^-]{1,12}$/.test(symbol)) {
      return Response.json({ error: 'bad symbol' }, { status: 400, headers: cors });
    }

    // Cache on the symbol alone, so every viewer shares one upstream call.
    const cacheKey = new Request(`https://quote.cache/${symbol}`, request);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit && !url.searchParams.has('debug')) {
      return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...cors } });
    }

    const upstream = new URL('https://finnhub.io/api/v1/quote');
    upstream.searchParams.set('symbol', symbol);
    const token = env.FINNHUB_API_KEY || INLINE_KEY;
    if (!token) {
      return Response.json(
        { error: 'no FINNHUB_API_KEY: add it under Settings → Variables and Secrets' },
        { status: 500, headers: cors }
      );
    }
    upstream.searchParams.set('token', token);

    let json;
    try {
      json = await (await fetch(upstream, { cf: { cacheTtl: CACHE_SECONDS } })).json();
    } catch (err) {
      return Response.json({ error: `upstream unreachable: ${err.message}` }, { status: 502, headers: cors });
    }

    if (url.searchParams.has('debug')) {
      return Response.json(json, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }

    const quote = readQuote(json);
    if (!quote) {
      return Response.json(
        { error: json?.error ?? 'unusable quote', upstream: json ?? null },
        { status: 502, headers: cors }
      );
    }

    const res = Response.json(quote, {
      headers: { ...cors, 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};
