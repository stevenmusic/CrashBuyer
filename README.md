# CrashBuyer — Crash Buying Simulator · S&P 500

Rewind the S&P 500 to any trading day of the last ~10 years, buy the crashes with a
fixed drawdown allocation ladder, and see what the portfolio is worth today.

A static page: plain HTML, CSS and ES modules, no build step, no dependencies, no
external requests at runtime beyond an optional live price top-up.

## Running it

Any static server works — ES modules will not load over `file://`:

```sh
python3 -m http.server 8000    # then open http://localhost:8000
```

## The allocation ladder

Fixed, and expressed as a share of **starting cash** (not of remaining cash), so the
five rungs deploy the whole account across a full crash:

| Drawdown from peak | % invest | Amount on $200,000 |
| ------------------ | -------- | ------------------ |
| −10%               | 10%      | $20,000            |
| −15%               | 15%      | $30,000            |
| −20%               | 20%      | $40,000            |
| −25%               | 25%      | $50,000            |
| −30%               | 30%      | $60,000            |

The trigger price on each row is `peak-to-date × (1 − drawdown)` at the current day
pointer. Rungs highlight once the index is that far down; **Use** loads the amount
into the trade input, and **Suggest** picks the deepest armed rung, capped by cash on
hand. To change the ladder, edit `LADDER` in `assets/model.js` — everything else
derives from it.

## How the simulation behaves

- **Day pointer** drives everything. Move it with the arrows, the number box, the
  ← / → keys (hold Shift for 20 days), the crash preset buttons, or by clicking and
  dragging on the chart.
- **Units are fractional**: `units = amount / close`, exactly, with no minimum lot.
- **The portfolio only counts trades that have already happened** — trades dated after
  the day pointer are listed but greyed out, so rewinding to 2018 never shows units
  bought in 2020.
- **Impossible sequences are rejected** rather than silently allowed. Every trade is
  replayed in date order; if any point overdraws cash or sells units that are not
  held, the trade is refused with the reason.
- **State persists** in `localStorage`, re-anchored by date on load so a growing
  series does not shift trades onto the wrong bar.

Prices are index closes: no dividends, fees, taxes or slippage. Educational only.

## Data

`data/sp500-daily.json` holds the daily close series as parallel `dates` / `closes`
arrays, on a rolling ~10.6-year window.

Two layers keep it current:

1. **Daily refresh (reliable).** `.github/workflows/update-data.yml` runs
   `scripts/fetch-sp500.mjs` at 23:10 UTC on weekdays — after the 16:00 ET close in
   both EST and EDT — and commits the file when it changes. It refuses to overwrite
   the committed series with anything shorter or older, so a bad upstream response
   fails the run instead of corrupting the data.
2. **Live top-up (best effort).** On load the page fetches the latest quote directly
   and appends or replaces today's bar. Those endpoints are key-less, so a browser may
   refuse them on CORS grounds; when that happens the page silently stays on the
   committed snapshot. The status pill in the header shows which is in effect —
   `live · <source>` or `daily snapshot` — and the page warns if the snapshot is more
   than five days old.

### Getting true index levels

Which sources answer a GitHub-hosted runner was measured, not assumed:

| Source                        | From CI                            |
| ----------------------------- | ---------------------------------- |
| `api.stlouisfed.org` (FRED)   | 200 — needs a free key             |
| `stockanalysis.com/api/.../s/`| 200, no key — **ETFs only**        |
| `stockanalysis.com/api/.../i/`| 400 for every S&P index symbol     |
| `fred.stlouisfed.org/graph`   | connection times out               |
| `stooq.com`                   | 200, but an HTML robots page       |
| `query{1,2}.finance.yahoo.com`| 429 across the runner IP range     |

So **out of the box the data is SPY**, the ETF that tracks the index. It quotes about
a tenth of the index level (~$776 vs ~$7,799), and the page labels itself accordingly.
Because every other figure here — drawdown, ladder trigger, return — is a percentage,
the simulation behaves the same either way.

To switch to real S&P 500 index levels, [get a free FRED API key][fred] (instant, no
card) and add it as a repository secret named `FRED_API_KEY` under
**Settings → Secrets and variables → Actions**. The next run picks it up automatically
and prefers it over SPY.

[fred]: https://fredaccount.stlouisfed.org/apikeys

Run the fetch by hand with:

```sh
node scripts/fetch-sp500.mjs              # SPY
FRED_API_KEY=... node scripts/fetch-sp500.mjs   # S&P 500 index
```

## Deploying

`.github/workflows/deploy-pages.yml` publishes the repo root to GitHub Pages on every
push to `main`, and again after each successful data refresh. Enable it under
**Settings → Pages → Source: GitHub Actions**.

## Layout

```
index.html               markup for all six panels
assets/styles.css        theme and layout
assets/app.js            state, rendering, event wiring
assets/model.js          ladder, drawdown maths, trade ledger
assets/data.js           snapshot loading + live top-up
assets/chart.js          canvas price chart
assets/format.js         number and date formatting
scripts/fetch-sp500.mjs  data fetcher used by CI
data/sp500-daily.json    committed price series
```
