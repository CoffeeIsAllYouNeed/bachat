/**
 * Small date helpers shared by the engines (cash flow, net worth,
 * investments, rent, nudges, report). ISO yyyy-mm-dd strings in, out.
 * Pure and deterministic; local calendar dates only.
 */

import type { Txn } from '@/data/types';
import { isoDate } from '@/data/store';
import { parseISO } from '@/theme/format';

/** iso + n days. */
export function plusDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Whole days from a to b (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

/** yyyy-mm + n months. */
export function plusMonths(ymStr: string, n: number): string {
  const [y, m] = ymStr.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Days in a yyyy-mm month. */
export function monthDays(ymStr: string): number {
  const [y, m] = ymStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** First and last ISO day of a yyyy-mm month. */
export function monthBounds(ymStr: string): { from: string; to: string } {
  return { from: `${ymStr}-01`, to: `${ymStr}-${String(monthDays(ymStr)).padStart(2, '0')}` };
}

/** Same calendar day one or more years earlier (29 Feb → 28 Feb). */
export function minusYears(iso: string, years = 1): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ny = y - years;
  const dim = new Date(ny, m, 0).getDate();
  return `${ny}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

/** Smaller of two ISO dates. */
export function minISO(a: string, b: string): string {
  return a < b ? a : b;
}

/** Inclusive date check on ISO strings. */
export function inRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

/** Income that counts (not a transfer leg / excluded row). */
export function isCountedIncome(t: Txn): boolean {
  return t.type === 'income' && !t.excluded && t.category !== 'transfer' && t.category !== 'investment';
}

/**
 * Signed money put into investments at cost: + for a purchase/SIP,
 * − for a redemption credited back, 0 for anything else.
 */
export function investedAmount(t: Txn): number {
  if (t.excluded) return 0;
  if (t.type === 'investment') return t.amount;
  if (t.category === 'investment') {
    if (t.type === 'expense') return t.amount;
    if (t.type === 'income' || t.type === 'refund') return -t.amount;
  }
  return 0;
}

/** Indian financial year (Apr–Mar) containing an ISO date. */
export function indianFY(iso: string): { from: string; to: string; label: string } {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return {
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    label: `FY ${start}–${String((start + 1) % 100).padStart(2, '0')}`,
  };
}
