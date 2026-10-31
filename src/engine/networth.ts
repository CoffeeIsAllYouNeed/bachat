/**
 * Accounts and net worth from what the bank told us: the latest "Avl Bal"
 * (balanceAfter) per account, card outstanding from card spends since the
 * last bill payment, and investments at cost (never market value).
 */

import type { AccountSummary, Txn } from '@/data/types';
import { investedAmount, plusDays } from '@/engine/periods';

type Kind = AccountSummary['kind'];

const CARD_BILL = /credit\s*card\s*(bill|payment)|\bcc\s*(bill|payment|pymt)|billdesk.*card|card\s*bill|card\s*payment|payment\s*received.*card|thank you for (your )?payment/i;

/** Account kind from its name ("HDFC Card ••4521" → card). */
export function accountKind(name: string): Kind {
  const n = name.toLowerCase();
  if (/\bcard\b|credit/.test(n)) return 'card';
  if (/\bloan\b|\bemi\b|mortgage/.test(n)) return 'loan';
  if (/wallet|paytm|phonepe|mobikwik|freecharge|amazon\s*pay|gpay|google\s*pay|airtel\s*money|jio\s*money/.test(n)) return 'wallet';
  return 'bank';
}

/** Last 4 digits from an account name ("SBI ••7781", "XX1234", "ending 4521"). */
export function last4Of(name: string): string | undefined {
  const m = name.match(/(?:••|•|xx+|\*+|ending\s*|a\/c\s*)(\d{4})\b/i) ?? name.match(/(\d{4})\s*$/);
  return m ? m[1] : undefined;
}

interface AccountData {
  name: string;
  kind: Kind;
  last4?: string;
  /** ascending by date */
  rows: Txn[];
  /** ascending (date, balance) */
  balances: { date: string; balance: number }[];
  /** Card only: dates of bill payments (ascending). */
  payments: string[];
}

function isCardPayment(t: Txn, card: AccountData): boolean {
  const text = `${t.merchant} ${t.narration ?? ''} ${t.raw ?? ''}`;
  if (t.account === card.name) {
    // A credit on the card itself (other than a refund) is a bill payment.
    return t.type === 'income' || t.type === 'transfer' || (t.type !== 'expense' && t.type !== 'refund' && CARD_BILL.test(text));
  }
  if (!CARD_BILL.test(text)) return false;
  // A payment from a bank account: if it names a card number, it must be this card's.
  if (card.last4 && text.includes(card.last4)) return true;
  const named = text.match(/card[^0-9]{0,12}(?:ending|xx+|••|\*+)\s*(\d{4})/i);
  return !named || named[1] === card.last4;
}

function collect(txns: Txn[]): AccountData[] {
  const byName = new Map<string, AccountData>();
  const asc = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of asc) {
    const name = t.account?.trim();
    if (!name) continue;
    let a = byName.get(name);
    if (!a) {
      a = { name, kind: accountKind(name), last4: last4Of(name), rows: [], balances: [], payments: [] };
      byName.set(name, a);
    }
    a.rows.push(t);
    if (typeof t.balanceAfter === 'number' && isFinite(t.balanceAfter)) a.balances.push({ date: t.date, balance: t.balanceAfter });
  }
  const list = [...byName.values()];
  for (const a of list) {
    if (a.kind !== 'card') continue;
    const seen = new Set<string>();
    for (const t of asc) {
      if (isCardPayment(t, a) && !seen.has(t.date)) {
        seen.add(t.date);
        a.payments.push(t.date);
      }
    }
  }
  return list;
}

/** Outstanding on a card with no reported balance, as of a date. */
function cardOutstandingAt(a: AccountData, asOf: string): number {
  let lastPay: string | null = null;
  for (const p of a.payments) if (p <= asOf) lastPay = p;
  const after = lastPay ?? plusDays(asOf, -30);
  let s = 0;
  for (const t of a.rows) {
    if (t.date <= after || t.date > asOf) continue;
    if (t.type === 'expense') s += t.amount;
    else if (t.type === 'refund') s -= t.amount;
  }
  return Math.max(0, s);
}

/** Last reported balance on or before a date; before the first report, the first one (flat back-fill). */
function balanceAt(a: AccountData, asOf: string): number | null {
  if (!a.balances.length) return null;
  let v = a.balances[0].balance;
  for (const b of a.balances) {
    if (b.date > asOf) break;
    v = b.balance;
  }
  return v;
}

/** Balance of one account as of a date, or null when it can't be known. */
function valueAt(a: AccountData, asOf: string): number | null {
  const reported = balanceAt(a, asOf);
  if (a.kind === 'card') return reported != null ? Math.abs(reported) : cardOutstandingAt(a, asOf);
  if (a.kind === 'loan') return reported != null ? Math.abs(reported) : null;
  return reported;
}

function investedAt(txns: Txn[], asOf: string): { total: number; last: string | null } {
  let total = 0;
  let last: string | null = null;
  for (const t of txns) {
    const v = investedAmount(t);
    if (!v || t.date > asOf) continue;
    total += v;
    if (!last || t.date > last) last = t.date;
  }
  return { total: Math.max(0, total), last };
}

/** One summary per account (latest balance), plus investments at cost as one entry. */
export function accounts(txns: Txn[]): AccountSummary[] {
  const out: AccountSummary[] = [];
  const far = '9999-12-31';
  for (const a of collect(txns)) {
    const v = valueAt(a, far);
    if (v == null) continue;
    if (a.kind === 'card' && v === 0 && !a.balances.length && !a.rows.some((t) => t.type === 'expense')) continue;
    out.push({
      key: 'acct:' + a.name.toLowerCase(),
      name: a.name,
      kind: a.kind,
      balance: Math.round(v),
      updated: a.rows[a.rows.length - 1].date,
      last4: a.last4,
    });
  }
  const inv = investedAt(txns, far);
  if (inv.total > 0 && inv.last) {
    out.push({ key: 'investments', name: 'Investments (at cost)', kind: 'investment', balance: Math.round(inv.total), updated: inv.last });
  }
  const order: Record<Kind, number> = { card: 0, bank: 1, wallet: 2, investment: 3, loan: 4 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || y.balance - x.balance);
}

function split(list: { kind: Kind; balance: number }[]): { assets: number; debts: number } {
  let assets = 0;
  let debts = 0;
  for (const a of list) {
    if (a.kind === 'card' || a.kind === 'loan') debts += Math.max(0, a.balance);
    else if (a.balance >= 0) assets += a.balance;
    else debts += -a.balance; // overdrawn account
  }
  return { assets, debts };
}

/** Assets (bank + wallet + investments at cost), debts (cards + loans) and the difference. */
export function netWorth(txns: Txn[]): { assets: number; debts: number; net: number } {
  const { assets, debts } = split(accounts(txns));
  return { assets, debts, net: assets - debts };
}

/** Daily assets/debts for the last [days] days ending today (oldest first), carrying balances forward. */
export function netWorthHistory(txns: Txn[], days: number, today: string): { date: string; assets: number; debts: number }[] {
  const data = collect(txns);
  const n = Math.max(1, Math.round(days));
  const out: { date: string; assets: number; debts: number }[] = [];
  const invRows = txns
    .map((t) => ({ date: t.date, v: investedAmount(t) }))
    .filter((r) => r.v !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const start = plusDays(today, -(n - 1));
  let invTotal = 0;
  let k = 0;
  while (k < invRows.length && invRows[k].date < start) invTotal += invRows[k++].v;
  for (let i = 0; i < n; i++) {
    const date = plusDays(start, i);
    while (k < invRows.length && invRows[k].date <= date) invTotal += invRows[k++].v;
    const list: { kind: Kind; balance: number }[] = [];
    for (const a of data) {
      const v = valueAt(a, date);
      if (v != null) list.push({ kind: a.kind, balance: v });
    }
    if (invTotal > 0) list.push({ kind: 'investment', balance: invTotal });
    const s = split(list);
    out.push({ date, assets: Math.round(s.assets), debts: Math.round(s.debts) });
  }
  return out;
}
