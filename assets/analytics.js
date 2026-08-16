// Benchmarks and performance statistics.
//
// Everything here is measured over one window: from the first logged trade to
// wherever the day pointer sits. That is the only honest comparison window —
// before the first trade the strategy is just cash, and rating it against a
// benchmark that was invested the whole time would be meaningless.

const MS_PER_YEAR = 365.2425 * 86400000;

/** Instalments the DCA benchmark spreads its cash over. */
const DCA_INSTALMENTS = 12;

/**
 * Portfolio value at every bar in [from, to], replaying the ledger as it goes.
 * Trades are already in date order, so one pass suffices.
 */
export function equityCurve(rows, startingCash, closes, from, to) {
  const curve = new Array(to - from + 1);
  let cash = startingCash;
  let units = 0;
  let next = 0;

  // Apply anything that happened before the window opens.
  while (next < rows.length && rows[next].day - 1 < from) {
    cash = rows[next].cashAfter;
    units = rows[next].unitsAfter;
    next++;
  }

  for (let i = from; i <= to; i++) {
    while (next < rows.length && rows[next].day - 1 === i) {
      cash = rows[next].cashAfter;
      units = rows[next].unitsAfter;
      next++;
    }
    curve[i - from] = { cash, units, equity: cash + units * closes[i] };
  }
  return curve;
}

/** Years between two ISO dates, as a fraction. */
const yearsBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_YEAR;

/**
 * CAGR, worst peak-to-trough fall, annualised volatility, Sharpe and the share
 * of bars holding any position.
 *
 * CAGR is measured on `base` growing to `final` — the caller passes the money
 * actually committed, so idle cash neither flatters nor drags it. Drawdown and
 * volatility still come from the account's equity path, which is what an
 * investor would actually have watched.
 *
 * Volatility is annualised from the series' own bar frequency rather than an
 * assumed 252, because the history mixes monthly bars with daily ones. Sharpe
 * assumes a zero risk-free rate — stated rather than silently folded in.
 */
export function stats(curve, dates, from, to, base, final) {
  const years = yearsBetween(dates[from], dates[to]);

  if (!(years > 0) || !(base > 0) || curve.length < 2) {
    return { cagr: null, maxDrawdown: null, volatility: null, sharpe: null, timeInMarket: null, years };
  }

  const cagr = (final / base) ** (1 / years) - 1;

  let peak = -Infinity;
  let maxDrawdown = 0;
  let invested = 0;
  const returns = [];

  for (let i = 0; i < curve.length; i++) {
    const { equity, units } = curve[i];
    if (equity > peak) peak = equity;
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (units > 1e-9) invested++;
    if (i > 0) {
      const previous = curve[i - 1].equity;
      if (previous > 0) returns.push(equity / previous - 1);
    }
  }

  let volatility = null;
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
    const barsPerYear = returns.length / years;
    volatility = Math.sqrt(variance) * Math.sqrt(barsPerYear);
  }

  return {
    cagr,
    maxDrawdown,
    volatility,
    sharpe: volatility > 0 ? cagr / volatility : null,
    timeInMarket: invested / curve.length,
    years,
  };
}

/** Index of the bar on or after `from` that is nearest to `months` later. */
function barAfterMonths(dates, from, months) {
  const start = new Date(`${dates[from]}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + months);
  const target = start.toISOString().slice(0, 10);
  for (let i = from; i < dates.length; i++) if (dates[i] >= target) return i;
  return -1;
}

/**
 * What the same cash would be worth at `to` under two passive alternatives:
 *
 *   lump  — the whole account invested on the first trade's bar.
 *   dca   — twelve equal monthly instalments starting that same bar; anything
 *           not yet invested by `to` is still sitting in cash and counted.
 */
export function benchmarks(dates, closes, from, to, startingCash) {
  const lump = (startingCash / closes[from]) * closes[to];

  const slice = startingCash / DCA_INSTALMENTS;
  let units = 0;
  let spent = 0;
  for (let k = 0; k < DCA_INSTALMENTS; k++) {
    const at = k === 0 ? from : barAfterMonths(dates, from, k);
    if (at < 0 || at > to) break;
    units += slice / closes[at];
    spent += slice;
  }
  const dca = units * closes[to] + (startingCash - spent);

  return { lump, dca };
}
