/**
 * Cash flow: money in vs money out per week or month.
 * Spend uses the shared clean helpers (counted expenses − linked refunds),
 * so transfers between own accounts and card-bill payments never count.
 * Investments are reported separately ("invested"), never as spend.
 */

import type { CategoryId, Txn } from '@/data/types';
import { netSpend, spendByCategory } from '@/engine/clean';
import { dayMonth, monthName, parseISO, ym } from '@/theme/format';
import {
  inRange, investedAmount, isCountedIncome, minISO, minusYears, monthBounds, plusDays, plusMonths,
} from '@/engine/periods';

export type CashRange = '4W' | '3M' | '1Y' | 'MTD' | 'YTD';

export const CASH_RANGES: readonly CashRange[] = ['4W', '3M', '1Y', 'MTD', 'YTD'];

export interface CashBucket {
  label: string;
  from: string;
  to: string;
  income: number;
  spend: number;
  net: number;
  /** Net for the same period one year earlier; null when there was no data then. */
  lastYearNet: number | null;
  spendByCat: Partial<Record<CategoryId, number>>;
  /** Bucket starts after today (drawn faded, all zeros). */
  future: boolean;
}

export interface CashFlow {
  from: string;
  to: string;
  buckets: CashBucket[];
  income: number;
  spend: number;
  net: number;
  lastYear: { income: number; spend: number; net: number };
  invested: number;
}

/** Counted income between two dates (inclusive). */
export function incomeBetween(txns: Txn[], from: string, to: string): number {
  let s = 0;
  for (const t of txns) if (isCountedIncome(t) && inRange(t.date, from, to)) s += t.amount;
  return s;
}

/** Net money put into investments (at cost) between two dates. */
export function investedBetween(txns: Txn[], from: string, to: string): number {
  let s = 0;
  for (const t of txns) if (inRange(t.date, from, to)) s += investedAmount(t);
  return s;
}

function hasActivity(txns: Txn[], from: string, to: string): boolean {
  return txns.some((t) => !t.excluded && inRange(t.date, from, to));
}

function periods(range: CashRange, today: string): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  const cur = ym(today);
  if (range === '4W') {
    for (let i = 3; i >= 0; i--) {
      const to = plusDays(today, -7 * i);
      const from = plusDays(to, -6);
      out.push({ label: dayMonth(from), from, to });
    }
  } else if (range === 'MTD') {
    const { from: mFrom, to: mTo } = monthBounds(cur);
    for (let start = mFrom; start <= mTo; start = plusDays(start, 7)) {
      const end = minISO(plusDays(start, 6), mTo);
      out.push({ label: dayMonth(start), from: start, to: end });
    }
  } else {
    const first = range === '3M' ? plusMonths(cur, -2) : range === '1Y' ? plusMonths(cur, -11) : `${today.slice(0, 4)}-01`;
    const count = range === '3M' ? 3 : 12;
    for (let i = 0; i < count; i++) {
      const m = plusMonths(first, i);
      const b = monthBounds(m);
      out.push({ label: monthName(parseISO(b.from).getMonth()), from: b.from, to: b.to });
    }
  }
  return out;
}

/** Income, spend and net per week (4W, MTD) or month (3M, 1Y, YTD), with last year for comparison. */
export function cashFlow(txns: Txn[], range: CashRange, today: string): CashFlow {
  const ps = periods(range, today);
  const buckets: CashBucket[] = ps.map((p) => {
    const future = p.from > today;
    const to = minISO(p.to, today);
    const lyFrom = minusYears(p.from);
    const lyTo = minusYears(p.to);
    const lyNet = hasActivity(txns, lyFrom, lyTo)
      ? incomeBetween(txns, lyFrom, lyTo) - netSpend(txns, lyFrom, lyTo)
      : null;
    if (future) {
      return { ...p, income: 0, spend: 0, net: 0, lastYearNet: lyNet, spendByCat: {}, future: true };
    }
    const income = incomeBetween(txns, p.from, to);
    const spend = netSpend(txns, p.from, to);
    return {
      ...p,
      income,
      spend,
      net: income - spend,
      lastYearNet: lyNet,
      spendByCat: spendByCategory(txns, p.from, to),
      future: false,
    };
  });

  const from = ps.length ? ps[0].from : today;
  const end = ps.length ? ps[ps.length - 1].to : today;
  const to = minISO(end, today);
  const income = buckets.reduce((a, b) => a + b.income, 0);
  const spend = buckets.reduce((a, b) => a + b.spend, 0);
  const lyFrom = minusYears(from);
  const lyTo = minusYears(to);
  const lyIncome = incomeBetween(txns, lyFrom, lyTo);
  const lySpend = netSpend(txns, lyFrom, lyTo);
  return {
    from,
    to,
    buckets,
    income,
    spend,
    net: income - spend,
    lastYear: { income: lyIncome, spend: lySpend, net: lyIncome - lySpend },
    invested: investedBetween(txns, from, to),
  };
}

/** Net (income − spend) from the 1st of this month to today and for the same days last month. */
export function netMonthToDate(txns: Txn[], today: string): { net: number; lastMonthNet: number } {
  const cur = ym(today);
  const day = Number(today.slice(8, 10));
  const from = `${cur}-01`;
  const prev = plusMonths(cur, -1);
  const pb = monthBounds(prev);
  const prevTo = minISO(`${prev}-${String(day).padStart(2, '0')}`, pb.to);
  return {
    net: incomeBetween(txns, from, today) - netSpend(txns, from, today),
    lastMonthNet: incomeBetween(txns, pb.from, prevTo) - netSpend(txns, pb.from, prevTo),
  };
}
