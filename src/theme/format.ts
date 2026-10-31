/** What money() / moneyShort() show while amounts are hidden (header eye icon). */
export const HIDDEN_AMOUNT = '₹••••';

let amountsHidden = false;

/** Kept in sync with settings.hideAmounts by the Shell (src/shell/Shell.tsx). */
export function setAmountsHidden(v: boolean): void {
  amountsHidden = v;
}

export function areAmountsHidden(): boolean {
  return amountsHidden;
}

/**
 * Runs [fn] with "Hide amounts" off, then restores the flag. For text built with
 * money() that never reaches the screen (AI prompts, guard numbers). Synchronous only.
 */
export function withAmountsShown<T>(fn: () => T): T {
  const prev = amountsHidden;
  amountsHidden = false;
  try {
    return fn();
  } finally {
    amountsHidden = prev;
  }
}

/** Indian-style rupee formatting: ₹1,23,456. No decimals unless asked. "₹••••" while amounts are hidden. */
export function money(v: number, decimals = 0): string {
  if (amountsHidden) return HIDDEN_AMOUNT;
  return moneyPlain(v, decimals);
}

/**
 * money() that ignores "Hide amounts" — for text that is not shown on screen
 * (AI prompts, the numbers the guard checks, exported files).
 */
export function moneyPlain(v: number, decimals = 0): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  const [int, frac] = fixed.split('.');
  // Indian grouping: last 3 digits, then groups of 2.
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${sign}₹${grouped}${frac ? '.' + frac : ''}`;
}

/** Short axis form: ₹4.2L, ₹1.1Cr, ₹12k. */
export function moneyShort(v: number): string {
  if (amountsHidden) return HIDDEN_AMOUNT;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}k`;
  return `${sign}₹${Math.round(a)}`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function pct(v: number, decimals = 0): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-29" → Date (local midnight). */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "29 Oct" */
export function dayMonth(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Oct 2026" from "2026-10" or a full ISO date. */
export function monthYear(isoOrYm: string): string {
  const [y, m] = isoOrYm.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

export function monthName(monthIndex0: number, long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[monthIndex0];
}

/** "TODAY", "YESTERDAY", "THU, OCT 29" for day-group headers. */
export function dayHeader(iso: string, today = new Date()): string {
  const d = parseISO(iso);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`.toUpperCase();
}

/** "1st", "22nd" */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** yyyy-mm of an ISO date */
export function ym(iso: string): string {
  return iso.slice(0, 7);
}
