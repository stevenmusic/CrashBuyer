// Which US market session is running right now.
//
// The open is 09:30 in New York, which is 21:30 in Taipei for half the year and
// 22:30 for the other half. Reading the wall clock in America/New_York rather
// than applying a fixed offset is what makes the changeover a non-event.

/** Extended and regular hours, as minutes past midnight, New York time. */
const WINDOWS = [
  { name: 'pre', from: 4 * 60, to: 9 * 60 + 30 },
  { name: 'open', from: 9 * 60 + 30, to: 16 * 60 },
  { name: 'post', from: 16 * 60, to: 20 * 60 },
];

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * 'pre' | 'open' | 'post' | 'closed'.
 *
 * Weekends are excluded; market holidays are not, because a hardcoded list of
 * them goes stale and being wrong about a holiday only costs a few requests
 * that return the previous close.
 */
export function sessionAt(now = new Date()) {
  const parts = Object.fromEntries(PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'closed';

  // Midnight comes back as 24 in some engines.
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return WINDOWS.find((w) => minutes >= w.from && minutes < w.to)?.name ?? 'closed';
}

/**
 * How often to ask for a fresh quote, in ms. Null when nothing is trading.
 *
 * Thirty seconds in regular hours is fast enough to read as live without
 * being faster than the decision it feeds: the ladder arms at whole percents,
 * so a tick-by-tick price would change the number on screen far more often
 * than it changes what to do about it. The proxy caches to the same window
 * (CACHE_SECONDS in the Worker), so this is also the upstream Finnhub call
 * rate no matter how many people are watching — Finnhub's free tier caps at
 * 60 calls/minute, and answers over that with a rate-limit page rather than a
 * quote, so the margin here is what keeps a normal viewer well clear of it.
 */
export function pollInterval(session) {
  if (session === 'open') return 30_000;
  if (session === 'pre' || session === 'post') return 60_000;
  return null;
}
