# CrashBuyer — Crash Buying Simulator · S&P 500

Rewind the S&P 500 across a quarter-century of daily closes, buy the crashes with
a fixed drawdown allocation ladder, and see what the portfolio is worth today.
English and 繁體中文.

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

`data/instruments.json` lists what the picker offers; each entry has its own
`data/<id>.json` of **daily** closes as parallel `dates` / `closes` arrays. The
manifest is written by the fetcher, so an instrument that failed to download is
simply absent rather than 404-ing at runtime.

| Instrument | Source                                  | Key                    |
| ---------- | --------------------------------------- | ---------------------- |
| ^GSPC      | FRED `SP500` — real index levels        | free FRED key          |
| SPY        | Tiingo, falling back to stockanalysis   | free Tiingo key, or none |
| VOO / IVV  | same                                    | same                   |
| QQQ        | same (Nasdaq 100, not the S&P)          | same                   |

Daily bars only. A monthly long history (Shiller, back to 1871) was tried and
removed: averaging a month of closes hides exactly the intramonth collapses this
tool exists to show — October 1987 flattens from −20% in a session to about −13%
— and a chart mixing resolutions invites comparing a smoothed 1930s with a
jagged 2020s.

### How far back — 2000 for the ETFs, ten years for the index

Depth on each free tier, measured from a CI runner rather than assumed:

| Route                          | Depth on the free tier                          |
| ------------------------------ | ----------------------------------------------- |
| Tiingo                         | **back to listing** — 6696 SPY bars from 2000-01-03 |
| Twelve Data                    | `outputsize` caps at 5000 bars, so only to 2006 |
| FRED `SP500`                   | rolling 10 years, and it rolls forward daily    |
| stockanalysis.com              | silently caps at `10Y` — longer ranges return 1 |
| Alpha Vantage                  | last 100 bars; `outputsize=full` is **paid**    |

`START_FROM` in the fetcher sets a floor of 2000-01-01. Tiingo reaches it, so the
ETFs now start there — or at their own listing date, which is why VOO begins in
2010 and IVV in 2000-05. The Alpha Vantage path is kept because a paid key would
work unchanged, but a free one answers `outputsize=full` with "this is a premium
feature" and the fetcher falls back.

The index is the exception, and the wall is a licence rather than an API limit.
Tiingo's free tier carries no index symbols, Twelve Data answers SPX with "this
symbol is available starting with the Grow plan", and FRED's `SP500` stays on its
rolling ten-year window — as does `DJIA`, the other S&P Dow Jones Indices series,
while `NASDAQCOM` on the same endpoint returns its full history. So ^GSPC starts
wherever FRED's window currently begins, and that start date moves forward every
day.

That is why the picker opens on SPY. Over the ten years the two overlap, SPY
tracks the index to within 1.0 percentage point of total return (251.2% against
252.2%) and 0.18 of a point of maximum drawdown (34.10% against 33.92%), with a
daily-return correlation of 0.997 — and every number this tool shows except the
raw price level is a percentage.

Tiingo's raw `close` carries splits and its `adjClose` folds in dividends, so
neither suits a price chart. The fetcher undoes splits only, accumulating
`splitFactor` from the newest bar backwards — QQQ split 2:1 in March 2000, inside
the window, where a raw series would show a one-day halving this simulator cannot
tell from a crash.

[av]: https://www.alphavantage.co/support/#api-key

For ETF history back to 2000, add a free [Tiingo key][tiingo] as `TIINGO_API_KEY`;
without it the ETFs fall back to stockanalysis.com's ten-year ceiling. For real
index levels rather than the SPY proxy, add a free [FRED key][fred] as
`FRED_API_KEY`. All go under **Settings → Secrets and variables → Actions**.

[tiingo]: https://www.tiingo.com/account/api/token

[fred]: https://fredaccount.stlouisfed.org/apikeys

Which sources answer a GitHub-hosted runner was measured, not assumed:
`raw.githubusercontent.com` and `api.stlouisfed.org` answer; `stockanalysis.com`
answers on `/s/` but 400s on `/i/` for every index symbol;
`fred.stlouisfed.org/graph` times out; `stooq.com` returns an HTML robots page;
`query{1,2}.finance.yahoo.com` 429s across the whole runner IP range.

### Refresh

1. **Daily.** `.github/workflows/update-data.yml` runs `scripts/fetch-sp500.mjs` at
   23:10 UTC on weekdays and commits whatever changed. Each instrument refuses to
   overwrite itself with a shorter or older series from the same source, so a bad
   upstream response fails that one instrument instead of corrupting it.
2. **Live top-up (best effort).** On load the page appends today's bar from a
   public quote endpoint. Those are key-less, so a browser may refuse them on CORS
   grounds; the status pill shows `live · <source>` or `daily snapshot`. A quote
   more than 30% away from the last close is rejected, so an index quote can never
   be spliced onto an ETF series.

```sh
node scripts/fetch-sp500.mjs                      # ETFs only, ~10 years
TIINGO_API_KEY=... node scripts/fetch-sp500.mjs   # + ETFs back to 2000
FRED_API_KEY=... node scripts/fetch-sp500.mjs     # + ^GSPC index levels
```

## Instruments

The picker in the command bar switches series. **Each instrument keeps its own
book** — trades, day pointer and all — so comparing SPY against the index never
mixes the two. Ladder base, language, log scale and alerts are shared.

London-listed accumulating trackers such as CSPX are deliberately absent: the
key-less endpoint only covers US listings, so they would 404.

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
