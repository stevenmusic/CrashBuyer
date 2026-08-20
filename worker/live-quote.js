// Cloudflare Worker: one CORS-answering quote endpoint in front of Twelve Data.
//
// It exists for two reasons. The browser cannot call a quote API directly —
// stooq and Yahoo send no Access-Control-Allow-Origin, so their answers are
// refused however often the page asks — and an API key put in the page's own
// JavaScript is a key anyone can read and spend.
//
// GET /?symbol=SPY  ->  { "date": "2026-08-20", "close": 769.06, "session": … }
// GET /?symbol=SPY&debug=1  ->  the upstream response, unchanged, for seeing
// what a given plan actually returns.

const ALLOWED_ORIGINS = [
  'https://stevenmusic.github.io',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

/**
 * Every viewer shares one upstream call per window. Twelve Data's free tier
 * allows 800 requests a day: a 6.5 hour session polled every 60s is 390, and
 * the extended hours at 180s add about 190, which fits with room to spare —
 * but only because the cache means those totals do not multiply by the number
 * of people watching.
 */
const CACHE_SECONDS = 60;

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  Vary: 'Origin',
});

/**
 * Reads the fields this page needs out of Twelve Data's quote. `close` is the
 * last regular-session close; `extended_price` appears outside those hours on
 * plans that carry extended hours, and is preferred when present because that
 * is the number actually trading.
 */
function readQuote(json) {
  const extended = Number(json?.extended_price);
  const regular = Number(json?.close);
  const close = Number.isFinite(extended) && extended > 0 ? extended : regular;
  const stamp = String(json?.datetime ?? json?.extended_timestamp ?? '');
  const date = stamp.slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) return null;
  return {
    date,
    close: Math.round(close * 100) / 100,
    source: 'twelvedata',
    extended: Number.isFinite(extended) && extended > 0,
    marketOpen: json?.is_market_open === true,
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

    const upstream = new URL('https://api.twelvedata.com/quote');
    upstream.searchParams.set('symbol', symbol);
    upstream.searchParams.set('apikey', env.TWELVEDATA_API_KEY);

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
      // Twelve Data reports its own errors in the body with a 200, so pass the
      // message through rather than inventing a status.
      return Response.json(
        { error: json?.message ?? 'unusable quote', code: json?.code ?? null },
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
