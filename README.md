# CrashBuyer — Crash Buying Simulator · S&P 500

Rewind the S&P 500 across ten years of daily closes, buy the crashes with a fixed
drawdown allocation ladder, and see what the portfolio is worth today. English
and 繁體中文.

A static page: plain HTML, CSS and ES modules, no build step, no dependencies, no
external requests at runtime beyond an optional live price top-up.

The interface is a neutral institutional terminal: a full-width market tape across
the top, the chart as the hero, then a three-column workbench (ladder, ticket,
portfolio) over the performance board and the log.

Chrome is neutral — warm stone ground, one slate-teal for emphasis — and colour
is spent only where it means something. Buy/gain and sell/loss follow the
international market convention (green up, red down); swapping the `--pos*` and
`--neg*` blocks in `:root` gives the Greater China convention (red up, green
down) with no other edit. Every foreground clears WCAG AA against its
background, most of it AAA, down to the 10px micro-caps labels.

## Running it

Any static server works — ES modules will not load over `file://`:

```sh
python3 -m http.server 8000    # then open http://localhost:8000
```

## The allocation ladder

Fixed, and expressed as a share of the **cash budget** (not of remaining cash), so the
five rungs deploy the whole budget across a full crash:

| Drawdown from peak | % invest | Amount on a $200,000 budget |
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
  ← / → keys (hold Shift for 20 bars), the crash preset buttons, or by clicking
  and dragging on the chart. Presets outside the loaded range are hidden.
- **Units are fractional**: `units = amount / close`, exactly, with no minimum lot.
- **The portfolio only counts trades that have already happened** — trades dated after
  the day pointer are listed but greyed out, so rewinding to 2018 never shows units
  bought in 2020.
- **Impossible sequences are rejected** rather than silently allowed. Every trade is
  replayed in date order; if any point overdraws cash or sells units that are not
  held, the trade is refused with the reason.
- **Nothing has to be typed.** There is no cash account to configure: the
  portfolio is the sum of the trades themselves — total invested, units, average
  cost, market value, P&L and return. *Ladder base* sits in the Allocation Guide
  header and only scales the amounts that panel suggests.
- **Returns are measured on what was actually invested.** Dividing by a budget
  would credit the strategy for money that never left the sidelines.
- **The only impossible trade is selling units you do not hold.** Without a cash
  account there is nothing to overdraw.
- **The chart zooms.** Pinch on touch, scroll or trackpad-pinch on desktop,
  double-click or the Reset zoom button to go back. The y axis rescales to the
  visible window, so zooming actually magnifies the detail.
- **State persists** in `localStorage`, re-anchored by date on load so a growing
  series does not shift trades onto the wrong bar.

Prices are index closes: no dividends, fees, taxes or slippage. Educational only.

## Data

`data/sp500-daily.json` holds **daily** closes as parallel `dates` / `closes`
arrays, covering roughly the last ten years.

Daily bars only. A monthly long history (Shiller, back to 1871) was tried and
removed: averaging a month of closes hides exactly the intramonth collapses this
tool exists to show — October 1987 flattens from −20% in a session to about −13%
— and a chart mixing the two resolutions invites comparing a smoothed 1930s with
a jagged 2020s.

| Source                        | Instrument         | Key    |
| ----------------------------- | ------------------ | ------ |
| `api.stlouisfed.org` (FRED)   | ^GSPC index levels | free   |
| `stockanalysis.com` `/s/`     | SPY ETF, ~10Y      | none   |

Which sources answer a GitHub-hosted runner was measured, not assumed:
`raw.githubusercontent.com` and `api.stlouisfed.org` answer; `stockanalysis.com`
answers on `/s/` but 400s on `/i/` for every index symbol; `fred.stlouisfed.org/graph`
times out; `stooq.com` returns an HTML robots page; `query{1,2}.finance.yahoo.com`
429s across the whole runner IP range.

With no key the script falls back to the SPY ETF — about a tenth of the index
level — and the page labels itself as showing a proxy rather than silently
mislabelling ETF prices as the index. To get real index levels,
[get a free FRED API key][fred] and add it as a repository secret named
`FRED_API_KEY` under **Settings → Secrets and variables → Actions**.

[fred]: https://fredaccount.stlouisfed.org/apikeys

### Refresh

1. **Daily.** `.github/workflows/update-data.yml` runs `scripts/fetch-sp500.mjs` at
   23:10 UTC on weekdays and commits the file when it changes. It refuses to
   overwrite a series with a shorter or older one from the same source, so a bad
   upstream response fails the run instead of corrupting the data.
2. **Live top-up (best effort).** On load the page fetches the latest quote and
   appends today's bar. Those endpoints are key-less, so a browser may refuse them
   on CORS grounds; the status pill shows `live · <source>` or `daily snapshot`. A
   quote more than 30% away from the last close is rejected, so an index quote can
   never be spliced onto an ETF series.

```sh
node scripts/fetch-sp500.mjs                    # SPY, no key
FRED_API_KEY=... node scripts/fetch-sp500.mjs   # ^GSPC index levels
```

## Language

The interface ships in English and 繁體中文, switchable from the top right and
remembered in `localStorage`. Strings live in `assets/i18n.js`; anything a
translation has not filled in falls back to English.

## Performance panel

Once a trade is logged, the panel scores the ladder over the window from the
**first trade to the day pointer** — the only fair window, since before the first
trade the account is just cash.

All three commit the **same Total Invested** from the first trade's bar, so the
comparison is like for like — a benchmark deploying the whole budget against a
ladder that only spent part of it would be measuring two different bets.

- **Lump sum** — that amount invested all at once on the first trade's bar.
- **Monthly DCA** — the same amount in 12 equal monthly instalments from that bar.
- **CAGR, max drawdown, volatility, Sharpe, time in market**, computed from the
  portfolio's own equity curve. Volatility is annualised from the series' actual
  bar frequency rather than an assumed 252, because the history mixes monthly
  bars with daily ones. Sharpe assumes a 0% risk-free rate.

Laddering into the 2008 crash, for instance, beats lump sum by about 46% — and
still loses to plain monthly DCA, which kept buying all the way down.

## Drawdown alerts

Tick **Alert on every −10% of drawdown** in Current Market. Stepping forward
through time — the arrows or the ← / → keys — raises a toast, and a browser
notification if you grant permission, for each new 10% band the index falls
through. Recovering to a fresh high rearms the ladder.

Navigation does not alert. Dragging the chart, hitting a preset or typing a day
number is browsing history, not the market falling; alerting on those produced
one toast per bear market in 150 years and buried the screen. At most three
alerts are on screen at once.

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
assets/i18n.js           English / 繁體中文 strings
assets/analytics.js      benchmarks and performance statistics
scripts/fetch-sp500.mjs  data fetcher used by CI
data/sp500-daily.json    committed price series
```
