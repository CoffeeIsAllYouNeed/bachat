/**
 * Rent: what is paid, when it's due, its share of income, and an HRA-ready
 * summary for the Indian financial year (April–March).
 */

import type { Profile, Txn } from '@/data/types';
import { displayName } from '@/engine/merchant';
import { dayMonth, money, monthYear, ordinal, ym } from '@/theme/format';
import { indianFY, inRange, isCountedIncome, minISO, monthBounds, monthDays, plusMonths } from '@/engine/periods';

export interface RentSummary {
  monthly: number;
  shareOfIncome: number | null;
  paidThisMonth: { date: string; amount: number } | null;
  nextDue: string | null;
  payee: string | null;
  /** Last 12 months, oldest first */
  months: { ym: string; amount: number }[];
  fyTotal: number;
  fyLabel: string;
  changeNote: string | null;
}

/** Rent payments (counted expenses in the rent category), newest first. */
export function rentPayments(txns: Txn[]): Txn[] {
  return txns
    .filter((t) => t.category === 'rent' && t.type === 'expense' && !t.excluded)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function sumMonth(rows: Txn[], m: string): number {
  return rows.reduce((a, t) => (t.date.startsWith(m) ? a + t.amount : a), 0);
}

function avgIncome(txns: Txn[], today: string): number {
  const cur = ym(today);
  let total = 0;
  let n = 0;
  for (let i = 1; i <= 3; i++) {
    const b = monthBounds(plusMonths(cur, -i));
    let s = 0;
    for (const t of txns) if (isCountedIncome(t) && inRange(t.date, b.from, b.to)) s += t.amount;
    if (s > 0) {
      total += s;
      n++;
    }
  }
  return n ? total / n : 0;
}

/** Monthly rent, share of income, this month's status, 12-month history, FY total and any change. */
export function rentSummary(txns: Txn[], profile: Profile, today: string): RentSummary {
  const rows = rentPayments(txns).filter((t) => t.date <= today);
  const cur = ym(today);
  const months: RentSummary['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const m = plusMonths(cur, -i);
    months.push({ ym: m, amount: sumMonth(rows, m) });
  }

  // Monthly rent: profile first, else the recent paid months.
  const paidMonths = months.filter((m) => m.amount > 0 && m.ym !== cur).slice(-3);
  const observed = paidMonths.length
    ? paidMonths.reduce((a, m) => a + m.amount, 0) / paidMonths.length
    : sumMonth(rows, cur);
  const monthly = profile.rent > 0 ? profile.rent : Math.round(observed);

  const income = profile.monthlyIncome > 0 ? profile.monthlyIncome : avgIncome(txns, today);
  const shareOfIncome = income > 0 && monthly > 0 ? monthly / income : null;

  const thisMonth = rows.filter((t) => t.date.startsWith(cur));
  const paidThisMonth = thisMonth.length
    ? { date: thisMonth[0].date, amount: thisMonth.reduce((a, t) => a + t.amount, 0) }
    : null;

  const latest = rows[0];
  let nextDue: string | null = null;
  if (latest) {
    const day = Number(latest.date.slice(8, 10));
    const target = paidThisMonth ? plusMonths(cur, 1) : cur;
    const d = Math.min(day, monthDays(target));
    nextDue = `${target}-${String(d).padStart(2, '0')}`;
  }

  const fy = indianFY(today);
  const fyTotal = rows.filter((t) => inRange(t.date, fy.from, minISO(fy.to, today))).reduce((a, t) => a + t.amount, 0);

  // Change: latest paid month vs the paid month before it (> 1% difference).
  let changeNote: string | null = null;
  const paid = months.filter((m) => m.amount > 0);
  if (paid.length >= 2) {
    const a = paid[paid.length - 2];
    const b = paid[paid.length - 1];
    if (Math.abs(b.amount - a.amount) > a.amount * 0.01) {
      changeNote = `Rent went ${b.amount > a.amount ? 'up' : 'down'} from ${money(a.amount)} to ${money(b.amount)} in ${monthYear(b.ym)}.`;
    }
  }

  return {
    monthly,
    shareOfIncome,
    paidThisMonth,
    nextDue,
    payee: latest ? displayName(latest.merchant) : null,
    months,
    fyTotal,
    fyLabel: fy.label,
    changeNote,
  };
}

/** One-line status ("Paid ₹22,000 to NoBroker Rent on 3 Oct" / "Due on the 3rd"). */
export function rentStatus(s: RentSummary, today: string): string {
  if (s.paidThisMonth) {
    return `Paid ${money(s.paidThisMonth.amount)}${s.payee ? ` to ${s.payee}` : ''} on ${dayMonth(s.paidThisMonth.date)}.` +
      (s.nextDue ? ` Next due ${dayMonth(s.nextDue)}.` : '');
  }
  if (!s.nextDue) return 'No rent payments found yet.';
  const day = ordinal(Number(s.nextDue.slice(8, 10)));
  return s.nextDue < today
    ? `Not paid yet this month — it's usually paid on the ${day}.`
    : `Due on the ${day} (${dayMonth(s.nextDue)}).`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * HRA rent summary CSV for the Indian FY containing [today]: one row per
 * payment, monthly totals and the FY total. Optional landlord details.
 */
export function rentCsv(txns: Txn[], today: string, landlord?: { name?: string; pan?: string; address?: string }): string {
  const fy = indianFY(today);
  const rows = rentPayments(txns)
    .filter((t) => inRange(t.date, fy.from, minISO(fy.to, today)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.reduce((a, t) => a + t.amount, 0);
  const lines: string[] = [];
  lines.push(csvCell(`Rent paid — ${fy.label} (1 Apr ${fy.from.slice(0, 4)} to 31 Mar ${fy.to.slice(0, 4)})`));
  if (landlord?.name) lines.push(['Landlord', landlord.name].map(csvCell).join(','));
  if (landlord?.pan) lines.push(['Landlord PAN', landlord.pan].map(csvCell).join(','));
  if (landlord?.address) lines.push(['Property address', landlord.address].map(csvCell).join(','));
  lines.push('');
  lines.push(['Date', 'Month', 'Paid to', 'Amount (INR)', 'From account', 'Bank narration'].map(csvCell).join(','));
  for (const t of rows) {
    lines.push([
      t.date,
      monthYear(t.date),
      displayName(t.merchant),
      t.amount.toFixed(2),
      t.account ?? '',
      (t.narration ?? t.raw ?? '').replace(/\s+/g, ' ').slice(0, 160),
    ].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(['Month', 'Total (INR)'].map(csvCell).join(','));
  const byMonth = new Map<string, number>();
  for (const t of rows) byMonth.set(ym(t.date), (byMonth.get(ym(t.date)) ?? 0) + t.amount);
  for (const [m, v] of byMonth) lines.push([monthYear(m), v.toFixed(2)].map(csvCell).join(','));
  lines.push(['Total for ' + fy.label, total.toFixed(2)].map(csvCell).join(','));
  lines.push('');
  lines.push(csvCell('Landlord PAN is needed when annual rent is above ₹1,00,000. Keep rent receipts for your employer. Educational information only, not tax advice.'));
  return lines.join('\n');
}
