// Shared number/date formatting. Every figure in the UI goes through here so
// the same quantity never renders two different ways in two panels.

import { getLang } from './i18n.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-08-13" -> "13 Aug 2026" / "2026年8月13日". Parsed by parts rather than
 * through Date so it cannot drift by a day in a western timezone.
 */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (getLang() === 'zh') return `${y}年${Number(m)}月${Number(d)}日`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Month precision, for bars that represent a whole month. */
export function formatMonth(iso) {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  if (getLang() === 'zh') return `${y}年${Number(m)}月`;
  return `${MONTHS[Number(m) - 1]} ${y}`;
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
