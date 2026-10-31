/**
 * Infers the money profile (income, fixed costs) from the last 3 complete
 * months of transactions. Used to prefill onboarding and by the demo loader.
 * Pure and deterministic.
 */

import type { ProfileSnapshot, Txn } from '@/data/types';
import { lastCompleteMonths, monthRange } from '@/engine/budgets';
import { spendByCategory } from '@/engine/clean';

function round100(v: number): number {
  return v > 0 ? Math.round(v / 100) * 100 : 0;
}

function avg(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
}

/** Income, irregularity, rent, EMIs and other fixed bills from 3 complete months (months without data are skipped). */
export function inferProfile(txns: Txn[], today: string): ProfileSnapshot {
  const empty: ProfileSnapshot = {
    monthlyIncome: 0, irregularIncome: false, rent: 0, emis: 0, otherFixed: 0, emergencyFund: 0, emergencyMonths: 6,
  };
  const have = new Set(txns.map((t) => t.date.slice(0, 7)));
  const months = lastCompleteMonths(today, 3).filter((m) => have.has(m));
  if (!months.length) return empty;

  const incomes: number[] = [];
  const rents: number[] = [];
  const emis: number[] = [];
  const others: number[] = [];
  for (const m of months) {
    const { from, to } = monthRange(m);
    incomes.push(
      txns
        .filter((t) => t.type === 'income' && !t.excluded && t.date >= from && t.date <= to)
        .reduce((a, t) => a + t.amount, 0),
    );
    const by = spendByCategory(txns, from, to);
    rents.push(by.rent ?? 0);
    emis.push(by.emi ?? 0);
    others.push((by.bills ?? 0) + (by.subscriptions ?? 0));
  }

  const income = avg(incomes);
  const spread = incomes.length >= 2 && income > 0 ? (Math.max(...incomes) - Math.min(...incomes)) / income : 0;

  return {
    monthlyIncome: round100(income),
    irregularIncome: spread > 0.25,
    rent: round100(avg(rents)),
    emis: round100(avg(emis)),
    otherFixed: round100(avg(others)),
    emergencyFund: 0,
    emergencyMonths: 6,
  };
}
