# Live quote proxy

A Cloudflare Worker that stands between the page and Finnhub. Without it the
page shows a daily snapshot: `stooq` and `query1.finance.yahoo.com` answer
without `Access-Control-Allow-Origin`, so a browser refuses their responses
however often it asks.

Finnhub does allow a browser to call it, so CORS alone would not need a proxy —
but the key would then be sitting in the page's JavaScript for anyone to read
and spend, and every viewer would be spending it separately. Finnhub's free
tier allows 60 calls a minute; twenty people polling every 15 seconds directly
would be 80. The Worker holds the key and caches for 15 seconds, which makes
the upstream cost four calls a minute regardless of how many people are
watching.

## Deploying

You need a free Cloudflare account. No card.

First get a free Finnhub key at <https://finnhub.io/register> — no card.

### From a browser

Nothing here needs a terminal, which matters if the machine to hand is a
tablet.

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**.
   Name it `crashbuyer-quote` and deploy the placeholder it offers.
2. **Edit code**, replace everything with `live-quote.js` from this directory,
   and deploy.
3. The Worker's **Settings → Variables and Secrets** → add `FINNHUB_API_KEY`
   as a **Secret**, not a plaintext variable, and save.

### Or from a terminal

```sh
npm install -g wrangler
wrangler login

cd worker
wrangler deploy                     # creates the Worker; it 502s until the key
wrangler secret put FINNHUB_API_KEY # paste the key when prompted
```

Either way the Worker has to exist before the secret can attach to it, so
deploy first. The secret takes effect straight away; no second deploy.

`wrangler deploy` prints the URL, something like
`https://crashbuyer-quote.<your-subdomain>.workers.dev`.

## Pointing the page at it

Uncomment the line in `index.html` and put your URL in it:

```html
<script>
  window.CRASHBUYER_LIVE_URL = 'https://crashbuyer-quote.<your-subdomain>.workers.dev';
</script>
```

Leave it commented out and nothing breaks — the page keeps the daily snapshot
it has now.

## Checking it

```sh
curl 'https://crashbuyer-quote.<subdomain>.workers.dev/?symbol=SPY'
# {"date":"2026-08-20","close":769.06,"source":"finnhub","previousClose":767.45}
```

Add `&debug=1` to see Finnhub's raw answer instead — useful for checking what
it returns outside regular hours, which is the one thing that varies. Finnhub
answers an unknown symbol with zeroes rather than an error, so the Worker
rejects a zero close instead of passing it on as a price.

## Origins

`ALLOWED_ORIGINS` in `live-quote.js` lists who may call it from a browser. Add
your own domain if you serve the page from somewhere else. This does not stop a
determined script calling it directly — CORS never does — but it keeps the
endpoint from being casually embedded in someone else's page.

## Quota

Finnhub's free tier limits by the minute — 60 calls — rather than by the day,
which is what makes 15-second polling affordable where Twelve Data's 800-a-day
was not.

| Window | Poll | Upstream calls per minute |
| ------ | ---- | ------------------------- |
| Regular | 15s | 4 |
| Pre-market, after hours | 60s | 1 |

Those numbers do not move with the number of viewers, because the cache means
they all share one call. Cloudflare's own free tier allows 100,000 requests a
day, which this is nowhere near. If you ever need to slow it down, raise
`CACHE_SECONDS` here and the intervals in `assets/session.mjs` together — they
should match.
