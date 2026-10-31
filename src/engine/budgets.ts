import { SPEND_CATEGORIES } from '@/data/categories';
import type { BudgetLine, CategoryId, Profile, Settings, Txn } from '@/data/types';
import { spendByCategory } from '@/engine/clean';

/*
 * Budgets: deterministic monthly budget lines. Suggested budget = average of
 * the last 3 complete months (rounded up to ₹100). Rent / EMI default to the
 * profile amounts when the user gave them. All dates are ISO strings.
 */

/** Days in the month of a "yyyy-mm" string. */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "yyyy-mm" shifted by n months (n may be negative). */
export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** First and last ISO day of a "yyyy-mm" month (inclusive). */
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}` };
}

/** The n complete months before today's month, as "yyyy-mm", newest first. */
export function lastCompleteMonths(today: string, n: number): string[] {
  const cur = today.slice(0, 7);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(addMonthsYm(cur, -i));
  return out;
}

function roundUp100(v: number): number {
  return v > 0 ? Math.ceil(v / 100) * 100 : 0;
}

/** Months (of the given list) in which there is at least one transaction. */
function monthsWithData(txns: Txn[], months: string[]): string[] {
  const have = new Set(txns.map((t) => t.date.slice(0, 7)));
  return months.filter((m) => have.has(m));
}

/** 3-complete-month average spend per spend category, rounded up to ₹100. Months with no data at all are skipped. */
export function suggestedBudgets(txns: Txn[], today: string): Partial<Record<CategoryId, number>> {
  const months = monthsWithData(txns, lastCompleteMonths(today, 3));
  const out: Partial<Record<CategoryId, number>> = {};
  if (!months.length) return out;
  const totals: Partial<Record<CategoryId, number>> = {};
  for (const m of months) {
    const { from, to } = monthRange(m);
    const by = spendByCategory(txns, from, to);
    for (const k of Object.keys(by) as CategoryId[]) totals[k] = (totals[k] ?? 0) + Math.max(0, by[k] ?? 0);
  }
  for (const c of SPEND_CATEGORIES) {
    const v = roundUp100((totals[c.id] ?? 0) / months.length);
    if (v > 0) out[c.id] = v;
  }
  return out;
}

/** Budget rows for month `ym`: spend categories with spend or budget > 0, sorted by `used` (desc). */
export function budgetLines(
  txns: Txn[],
  overrides: Settings['budgets'],
  profile: Profile,
  ym: string,
  today: string,
): BudgetLine[] {
  const { from, to } = monthRange(ym);
  const spent = spendByCategory(txns, from, to);
  const suggested = suggestedBudgets(txns, today);
  const lines: BudgetLine[] = [];
  for (const c of SPEND_CATEGORIES) {
    const s = Math.max(0, Math.round(spent[c.id] ?? 0));
    const sug = suggested[c.id] ?? 0;
    const override = overrides[c.id];
    const custom = override != null && override >= 0;
    let budget = sug;
    if (custom) budget = override as number;
    else if (c.id === 'rent' && profile.rent > 0) budget = profile.rent;
    else if (c.id === 'emi' && profile.emis > 0) budget = profile.emis;
    if (s <= 0 && budget <= 0) continue;
    const used = budget > 0 ? s / budget : s > 0 ? 1 : 0;
    lines.push({
      category: c.id,
      budget,
      suggested: sug,
      spent: s,
      custom,
      left: budget - s,
      over: s > budget,
      used,
    });
  }
  return lines.sort((a, b) => b.used - a.used || b.spent - a.spent);
}

/** Spend per month for one category over the last `months` months including today's month (oldest first). */
export function monthlyHistory(
  txns: Txn[],
  category: CategoryId,
  months: number,
  today: string,
): { ym: string; spent: number }[] {
  const cur = today.slice(0, 7);
  const out: { ym: string; spent: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonthsYm(cur, -i);
    const { from, to } = monthRange(m);
    const by = spendByCategory(txns, from, to);
    out.push({ ym: m, spent: Math.max(0, Math.round(by[category] ?? 0)) });
  }
  return out;
}
