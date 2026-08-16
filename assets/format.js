// Shared number/date formatting. Every figure in the UI goes through here so
// the same quantity never renders two different ways in two panels.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-13" -> "13 Aug 2026". Parsed by parts to stay timezone-proof. */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Whole dollars, e.g. $623,523 — used for balances and equity. */
export function money(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

/** Signed whole dollars, e.g. +$423,523 — used for P&L. */
export function moneySigned(n) {
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + money(n).replace('-', '−');
}

/** Cents precision, e.g. $7,798.99 — used for prices. */
export function price(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Four decimals, e.g. 79.9492 — index units are always fractional. */
export function units(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** Ratio to percent, e.g. -0.1042 -> "−10.42%". */
export function percent(ratio, digits = 2) {
  if (!Number.isFinite(ratio)) return '—';
  const v = ratio * 100;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
}

/** Signed percent for returns, e.g. "+211.76%". */
export function percentSigned(ratio, digits = 2) {
  if (!Number.isFinite(ratio)) return '—';
  const v = ratio * 100;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

/** Compact axis label, e.g. 7798.99 -> "7,799". */
export function axisNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}
