# Live quote proxy

A Cloudflare Worker that stands between the page and Finnhub. Without it the
page shows a daily snapshot: `stooq` and `query1.finance.yahoo.com` answer
without `Access-Control-Allow-Origin`, so a browser refuses their responses
however often it asks.

Finnhub does allow a browser to call it, so CORS alone would not need a proxy —
but the key would then be sitting in the page's JavaScript for anyone to read
and spend, and every viewer would be spending it separately. Finnhub's free
tier allows 60 calls a minute; a handful of people polling directly could
already spend that. The Worker holds the key and shares one upstream call
across every viewer via a KV cache — see **Cache** below for why it is KV and
not the more obvious `caches.default`.

## Deploying

You need a free Cloudflare account. No card.

First get a free Finnhub key at <https://finnhub.io/register> — no card.

### From GitHub, with no copy and paste

The least fiddly route on a phone, where selecting a hundred lines of code out
of one page and into another is the hard part. Cloudflare builds this directory
straight from the repository, and redeploys whenever it changes.

1. <https://dash.cloudflare.com> → **Compute** → **Workers** → **Create** →
   **Connect GitHub**, and authorise the `CrashBuyer` repository.
2. Set the **root directory** to `worker`. That is what makes Cloudflare read
   this directory's `wrangler.toml` rather than looking for a Worker at the top
   of the repository, where there is only a website.
3. Deploy. Then add the key as below — a build cannot supply it, because a
   secret is not in the repository.

If the name `crashbuyer-quote` is already taken by a Worker created from the
Hello World template, delete that one first: its Settings page has the button,
and recreating under the same name gives back the same URL.

### From a browser, pasting the code

Nothing here needs a terminal, which matters if the machine to hand is a
tablet.

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**.
   Name it `crashbuyer-quote` and deploy the placeholder it offers.
2. **Edit code**, replace everything with `live-quote.js` from this directory,
   and deploy.
3. The Worker's **Settings → Variables and Secrets** → add `FINNHUB_API_KEY`
   as a **Secret**, not a plaintext variable, and save.
4. Set up the KV cache — see **Cache** below. The Worker still answers
   without it, just without the shared-call protection that keeps a handful
   of viewers from spending Finnhub's whole per-minute quota.

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
`https://crashbuyer-quote.sifan888494.workers.dev`.

## Pointing the page at it

Uncomment the line in `index.html` and put your URL in it:

```html
<script>
  window.CRASHBUYER_LIVE_URL = 'https://crashbuyer-quote.sifan888494.workers.dev';
</script>
```

Leave it commented out and nothing breaks — the page keeps the daily snapshot
it has now.

## Checking it

```sh
curl 'https://crashbuyer-quote.sifan888494.workers.dev/?symbol=SPY'
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

## Cache

The share-one-call-across-every-viewer design first used `caches.default`,
the Workers Cache API, keyed by symbol. That looked right and reads right —
but it is scoped **per Cloudflare data center, not shared globally**: a
request landing in a different colo than the one that cached the last quote
is a miss there regardless. In production this showed up as the status pill
flapping between live and offline, and `?debug=1` (which always bypasses the
cache) turning up Finnhub's own 429 HTML page — the free tier's per-minute
quota was being spent many times over by requests that each looked, from one
viewer's side, like "just polling every 30 seconds."

KV namespaces are the same account's globally-replicated store, so this uses
one instead: a hit in one data center counts everywhere. Set it up once —

1. **Storage & Databases → KV → Create a namespace.** Any name, e.g.
   `crashbuyer-quote-cache`.
2. Back on the Worker → **Settings → Bindings → Add → KV Namespace.**
   Variable name **must** be `QUOTE_CACHE`; namespace is the one just
   created. Save.

Without this binding the Worker still answers every request — it just
reaches Finnhub every time, same as before this fix, rather than failing.

## Quota

Finnhub's free tier limits by the minute — 60 calls — rather than by the day.
KV's own floor for a cache entry's lifetime is 60 seconds, which conveniently
matches: at most one upstream call per symbol per minute, regardless of how
many viewers there are or which data center answers each of them.

| Window | Poll | Upstream calls per minute |
| ------ | ---- | ------------------------- |
| Regular | 30s | ≤1 |
| Pre-market, after hours | 60s | ≤1 |

Cloudflare's own free tier allows 100,000 KV reads and 1,000 writes a day,
which this is nowhere near. If you ever need to change the window, raise
`CACHE_SECONDS` here and the intervals in `assets/session.mjs` together —
they should match, and `CACHE_SECONDS` cannot go below 60 (KV's minimum
`expirationTtl`).
