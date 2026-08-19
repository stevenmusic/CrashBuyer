// Pure simulation logic: the allocation ladder, drawdown maths and the ledger
// that turns a list of trades into running cash / units / equity.

/**
 * Fixed drawdown ladder. Each rung says: once the index is this far below its
 * running peak, put this share of the ladder base to work. The rungs add up to
 * 100%, so a full crash sequence deploys the whole planned amount.
 *
 * It used to stop at −30% with the whole budget spent there, which was sound
 * while the series only went back ten years and bottomed at −34%. The history
 * now reaches 2000: SPY fell 56.5% into March 2009 and QQQ 83% into October
 * 2002. Stopping at −30% meant standing there with an empty account through the
 * cheapest half of both crashes — the opposite of what this tool is arguing
 * for. The last two rungs hold 35% back for below −30%, which costs some
 * deployment speed in an ordinary correction and buys ammunition for a real one.
 */
export const LADDER = [
  { drawdown: 0.1, invest: 0.1 },
  { drawdown: 0.15, invest: 0.1 },
  { drawdown: 0.2, invest: 0.15 },
  { drawdown: 0.25, invest: 0.15 },
  { drawdown: 0.3, invest: 0.15 },
  { drawdown: 0.4, invest: 0.15 },
  { drawdown: 0.5, invest: 0.2 },
];

/**
 * How deep the drawdown meter runs before it pins to the right edge. Derived
 * from the ladder rather than set independently: what the meter is really
 * reporting is how much ladder is left, so its scale has to end where the
 * ladder does. A little headroom past the last rung keeps the deepest marker
 * off the very edge.
 */
export const METER_FLOOR = LADDER[LADDER.length - 1].drawdown * 1.2;

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
 * the running position after it.
 *
 * There is no cash account: the tool records what was actually bought and sold,
 * so the only impossible sequence is selling units that are not held. `error` is
 * structured rather than a sentence so the UI can phrase it in either language.
 */
export function buildLedger(trades) {
  const ordered = [...trades].sort((a, b) => a.day - b.day || a.seq - b.seq);
  const rows = [];
  let held = 0;
  let invested = 0;
  let withdrawn = 0;
  let error = null;

  for (const trade of ordered) {
    if (trade.action === 'BUY') {
      held += trade.units;
      invested += trade.amount;
    } else {
      held -= trade.units;
      withdrawn += trade.amount;
    }

    // Tolerate float dust before calling a sequence impossible.
    if (held < -1e-9 && !error) {
      error = { kind: 'oversell', day: trade.day };
    }

    rows.push({
      ...trade,
      unitsAfter: held,
      investedAfter: invested,
      withdrawnAfter: withdrawn,
      // What the position was worth at that trade's own price.
      valueAfter: held * trade.price,
    });
  }

  return { rows, error };
}

/**
 * Portfolio as of the day pointer. Only trades that have already happened count
 * — rewinding the pointer to 2018 must not show units bought in 2020.
 */
export function portfolioAt(ledgerRows, day, currentPrice) {
  let held = 0;
  let invested = 0;
  let withdrawn = 0;
  let applied = 0;

  for (const row of ledgerRows) {
    if (row.day > day) break;
    held = row.unitsAfter;
    invested = row.investedAfter;
    withdrawn = row.withdrawnAfter;
    applied++;
  }

  const marketValue = held * currentPrice;
  // Everything the committed money turned into, minus what went in.
  const pnl = marketValue + withdrawn - invested;

  return {
    units: held,
    marketValue,
    invested,
    withdrawn,
    pnl,
    returnPct: invested > 0 ? pnl / invested : null,
    applied,
    pending: ledgerRows.length - applied,
  };
}

/** Ladder rows resolved against the current peak, ladder base and drawdown. */
export function allocationRows(peak, ladderBase, drawdown) {
  return LADDER.map((rung) => ({
    ...rung,
    triggerPrice: peak * (1 - rung.drawdown),
    amount: ladderBase * rung.invest,
    // `armed` = the index is already this far down, so the rung is actionable.
    armed: -drawdown >= rung.drawdown - 1e-9,
  }));
}
