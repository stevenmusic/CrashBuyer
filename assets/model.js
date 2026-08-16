// Pure simulation logic: the allocation ladder, drawdown maths and the ledger
// that turns a list of trades into running cash / units / equity.

/**
 * Fixed drawdown ladder. Each rung says: once the index is this far below its
 * running peak, put this share of *starting cash* to work. The five rungs add
 * up to 100%, so a full crash sequence deploys the whole account.
 */
export const LADDER = [
  { drawdown: 0.1, invest: 0.1 },
  { drawdown: 0.15, invest: 0.15 },
  { drawdown: 0.2, invest: 0.2 },
  { drawdown: 0.25, invest: 0.25 },
  { drawdown: 0.3, invest: 0.3 },
];

/** How deep the drawdown meter runs before it pins to the right edge. */
export const METER_FLOOR = 0.4;

/** Running maximum close, i.e. the peak-to-date at every index. */
export function runningPeaks(closes) {
  const peaks = new Array(closes.length);
  let peak = -Infinity;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    peaks[i] = peak;
  }
  return peaks;
}

/**
 * Peak-to-recovery episodes worth shading on the chart: every stretch where the
 * index fell at least `threshold` below its peak, from that peak until it is
 * regained (or the end of the series, for one still underwater).
 */
export function drawdownEpisodes(closes, threshold = 0.1) {
  const episodes = [];
  let peak = closes[0];
  let peakIdx = 0;
  let troughIdx = 0;
  let minRatio = 1;

  const close = (endIdx, ongoing) => {
    if (1 - minRatio >= threshold) {
      episodes.push({ start: peakIdx, end: endIdx, trough: troughIdx, depth: 1 - minRatio, ongoing });
    }
  };

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] >= peak) {
      close(i, false);
      peak = closes[i];
      peakIdx = i;
      troughIdx = i;
      minRatio = 1;
    } else {
      const ratio = closes[i] / peak;
      if (ratio < minRatio) {
        minRatio = ratio;
        troughIdx = i;
      }
    }
  }
  close(closes.length - 1, true);
  return episodes;
}

/** Index of the first bar on or after `iso`, or -1 when the series ends first. */
export function indexOnOrAfter(dates, iso) {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] >= iso) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

/**
 * Replays every trade in chronological order and returns one row per trade with
 * the balances *after* it. `error` is set when the sequence is impossible
 * (spending cash that is not there, or selling units that are not held), which
 * is how a proposed trade gets rejected before it is committed.
 */
export function buildLedger(trades, startingCash) {
  const ordered = [...trades].sort((a, b) => a.day - b.day || a.seq - b.seq);
  const rows = [];
  let cash = startingCash;
  let held = 0;
  let error = null;

  for (const trade of ordered) {
    const signedAmount = trade.action === 'BUY' ? -trade.amount : trade.amount;
    const signedUnits = trade.action === 'BUY' ? trade.units : -trade.units;

    cash += signedAmount;
    held += signedUnits;

    // Tolerate float dust before calling a sequence impossible. The error is
    // structured rather than a sentence so the UI can render it in either
    // language.
    if (cash < -0.005 && !error) {
      error = { kind: 'overdraw', day: trade.day, shortfall: Math.abs(cash) };
    }
    if (held < -1e-9 && !error) {
      error = { kind: 'oversell', day: trade.day };
    }

    rows.push({
      ...trade,
      cashAfter: cash,
      unitsAfter: held,
      equityAfter: cash + held * trade.price,
    });
  }

  return { rows, error };
}

/**
 * Portfolio as of the day pointer. Only trades that have already happened count
 * — rewinding the pointer to 2018 must not show units bought in 2020.
 */
export function portfolioAt(ledgerRows, startingCash, day, currentPrice) {
  let cash = startingCash;
  let held = 0;
  let applied = 0;

  for (const row of ledgerRows) {
    if (row.day > day) break;
    cash = row.cashAfter;
    held = row.unitsAfter;
    applied++;
  }

  const marketValue = held * currentPrice;
  const equity = cash + marketValue;
  return {
    cash,
    units: held,
    marketValue,
    equity,
    pnl: equity - startingCash,
    returnPct: startingCash > 0 ? (equity - startingCash) / startingCash : 0,
    applied,
    pending: ledgerRows.length - applied,
  };
}

/** Ladder rows resolved against the current peak, starting cash and drawdown. */
export function allocationRows(peak, startingCash, drawdown) {
  return LADDER.map((rung) => ({
    ...rung,
    triggerPrice: peak * (1 - rung.drawdown),
    amount: startingCash * rung.invest,
    // `armed` = the index is already this far down, so the rung is actionable.
    armed: -drawdown >= rung.drawdown - 1e-9,
  }));
}
