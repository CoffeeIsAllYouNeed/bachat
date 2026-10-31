import type { CategoryId, Txn } from '@/data/types';
import { category as categoryInfo } from '@/data/categories';
import { merchantKey } from './merchant';
import { daysBetween } from './parseUtil';

/*
 * Cleaning pass over ALL transactions (deterministic, idempotent):
 *  - card-bill payments are excluded (the card spends were already counted)
 *  - money moved between your own accounts = a transfer pair, both legs excluded
 *  - refunds are linked to the purchase they reverse (and take its category)
 */

const CARD_BILL = /credit ?card (bill )?(payment|pymt|repayment)|\bcc (bill )?payment|card ?bill ?payment|billdesk.*card|card.*billdesk|\bcred\b.*(card|bill)|autopay.*card|card.*autopay|\bcard dues?\b/i;
const REFUND_WORDS = /\brefund|\breversal|\breversed|\brev\b|chargeback|\breturned\b/i;
const SALARY = /salary|\bsal\b|payroll|stipend/i;

function text(t: Txn): string {
  return `${t.merchant} ${t.narration ?? ''}`;
}

/** Returns every transaction with transferPairId / refundOf / excluded recomputed. */
export function cleanTxns(txns: Txn[]): Txn[] {
  const rows: Txn[] = txns.map((t) => ({ ...t, transferPairId: undefined, refundOf: undefined, excluded: undefined }));
  const byDate = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // 1. Card bill payments (money out of a bank account to a card).
  for (const t of byDate) {
    if (t.type === 'income' || t.type === 'refund') continue;
    if (!CARD_BILL.test(text(t))) continue;
    if (t.catSource === 'user' && t.category !== 'transfer') continue;
    t.excluded = true;
    t.category = 'transfer';
    t.type = 'transfer';
  }

  // 2. Transfer pairs: same amount out of one own account and into another within 2 days.
  const outs = byDate.filter((t) => !t.excluded && t.account && (t.type === 'expense' || t.type === 'transfer') && pairable(t));
  const ins = byDate.filter((t) => !t.excluded && t.account && (t.type === 'income' || t.type === 'transfer') && pairable(t) && !SALARY.test(text(t)));
  const usedIn = new Set<string>();
  for (const o of outs) {
    if (o.transferPairId || usedIn.has(o.id)) continue;
    let best: Txn | null = null;
    let bestGap = 99;
    for (const i of ins) {
      if (usedIn.has(i.id) || i.id === o.id || i.account === o.account) continue;
      if (Math.abs(i.amount - o.amount) > 0.5) continue;
      const gap = Math.abs(daysBetween(o.date, i.date));
      if (gap > 2) continue;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (!best) continue;
    usedIn.add(best.id);
    usedIn.add(o.id);
    for (const [a, b] of [[o, best], [best, o]] as const) {
      a.transferPairId = b.id;
      a.excluded = true;
      if (a.catSource !== 'user') a.category = 'transfer';
      a.type = 'transfer';
    }
  }
  // Rows the user / a rule filed as Transfer are never counted.
  for (const t of rows) if (t.category === 'transfer' || t.type === 'transfer') t.excluded = true;

  // 3. Refunds → the most recent same-merchant purchase ≥ amount within 60 days.
  const refunded = new Set<string>();
  const expensesByKey = new Map<string, Txn[]>();
  for (const t of byDate) {
    if (t.type !== 'expense' || t.excluded) continue;
    const k = merchantKey(t.merchant);
    const list = expensesByKey.get(k);
    if (list) list.push(t);
    else expensesByKey.set(k, [t]);
  }
  for (const r of byDate) {
    const isRefund = r.type === 'refund' || (r.type === 'income' && r.catSource !== 'user' && REFUND_WORDS.test(text(r)));
    if (!isRefund || r.excluded) continue;
    r.type = 'refund';
    const k = merchantKey(r.merchant);
    const candidates = expensesByKey.get(k) ?? [];
    let match: Txn | null = null;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const e = candidates[i];
      const gap = daysBetween(e.date, r.date);
      if (gap < 0 || gap > 60) continue;
      if (e.amount + 0.5 < r.amount || refunded.has(e.id)) continue;
      match = e;
      break;
    }
    if (match) {
      refunded.add(match.id);
      r.refundOf = match.id;
      if (r.catSource !== 'user') r.category = match.category;
    } else if (r.category === 'income' && r.catSource !== 'user') {
      r.category = 'other';
    }
  }

  return rows;
}

function pairable(t: Txn): boolean {
  if (t.catSource === 'user' && t.category !== 'transfer') return false;
  if (t.category === 'investment' || t.category === 'rent' || t.category === 'emi') return false;
  return true;
}

/** True when a row counts toward spending (an expense in a spend category, not excluded). */
export function isCountedSpend(t: Txn): boolean {
  return t.type === 'expense' && !t.excluded && categoryInfo(t.category).spend;
}

function isCountedRefund(t: Txn): boolean {
  return t.type === 'refund' && !t.excluded && !!t.refundOf && categoryInfo(t.category).spend;
}

/** Expenses − linked refunds for counted rows between from and to (inclusive ISO dates). */
export function netSpend(txns: Txn[], from: string, to: string): number {
  let total = 0;
  for (const t of txns) {
    if (t.date < from || t.date > to) continue;
    if (isCountedSpend(t)) total += t.amount;
    else if (isCountedRefund(t)) total -= t.amount;
  }
  return Math.max(0, Math.round(total * 100) / 100);
}

/** Net spend per spend category between from and to (inclusive); zero categories omitted. */
export function spendByCategory(txns: Txn[], from: string, to: string): Partial<Record<CategoryId, number>> {
  const acc: Partial<Record<CategoryId, number>> = {};
  for (const t of txns) {
    if (t.date < from || t.date > to) continue;
    if (isCountedSpend(t)) acc[t.category] = (acc[t.category] ?? 0) + t.amount;
    else if (isCountedRefund(t)) acc[t.category] = (acc[t.category] ?? 0) - t.amount;
  }
  const out: Partial<Record<CategoryId, number>> = {};
  for (const [k, v] of Object.entries(acc) as [CategoryId, number][]) {
    const r = Math.round(v * 100) / 100;
    if (r > 0) out[k] = r;
  }
  return out;
}
