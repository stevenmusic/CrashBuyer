# Live quote proxy

A Cloudflare Worker that stands between the page and Twelve Data. Without it
the page shows a daily snapshot: `stooq` and `query1.finance.yahoo.com` answer
without `Access-Control-Allow-Origin`, so a browser refuses their responses
however often it asks. Putting the API key into the page's own JavaScript would
solve the CORS problem and create a worse one — a key anyone can read and
spend.

The Worker holds the key, answers with CORS headers, and caches for 60 seconds
so every viewer shares one upstream call.

## Deploying

You need a free Cloudflare account. No card.

```sh
npm install -g wrangler
wrangler login

cd worker
wrangler secret put TWELVEDATA_API_KEY   # paste the key when prompted
wrangler deploy
```

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
# {"date":"2026-08-20","close":769.06,"extended":false,"marketOpen":true}
```

Add `&debug=1` to see Twelve Data's raw answer instead. That is the way to find
out what a given plan actually returns outside regular hours: `extended_price`
appears on plans that carry extended hours, and the Worker prefers it when it
is there. If your plan does not include them, the pre-market and after-hours
windows will simply keep showing the last regular close, which is honest — the
page says which session it is either way.

## Origins

`ALLOWED_ORIGINS` in `live-quote.js` lists who may call it from a browser. Add
your own domain if you serve the page from somewhere else. This does not stop a
determined script calling it directly — CORS never does — but it keeps the
endpoint from being casually embedded in someone else's page.

## Quota

Twelve Data's free tier allows 800 requests a day. With the 60-second cache,
a full day costs roughly:

| Window | Length | Poll | Requests |
| ------ | ------ | ---- | -------- |
| Pre-market | 5.5h | 180s | 110 |
| Regular | 6.5h | 60s | 390 |
| After hours | 4h | 180s | 80 |
| | | | **~580** |

That is the total however many people are watching, because they share the
cache. If you outgrow it, raise `CACHE_SECONDS` here and the poll intervals in
`assets/session.mjs` together.
