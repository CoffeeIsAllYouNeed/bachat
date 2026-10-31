import type { Cadence, CheckInAnswer, CheckInRecord, Recurring, RecurringAlert, Txn } from '@/data/types';
import { isCountedSpend } from '@/engine/clean';
import { displayName, merchantKey } from '@/engine/merchant';
import { dayMonth, money } from '@/theme/format';

/*
 * Recurring payments found deterministically in the user's own data:
 * counted expenses grouped by merchant key, regular gaps, stable amounts.
 */

const DAY = 86400000;

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function fromUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

/** ISO date plus n days. */
export function addDaysISO(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * DAY);
}

/** ISO date plus n months, day clamped to the month's length. */
export function addMonthsISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(ny, nm, Math.min(d, last)));
}

const RANGES: { cadence: Cadence; min: number; max: number; days: number }[] = [
  { cadence: 'weekly', min: 6, max: 8, days: 7 },
  { cadence: 'monthly', min: 26, max: 35, days: 30 },
  { cadence: 'quarterly', min: 85, max: 95, days: 91 },
  { cadence: 'yearly', min: 350, max: 380, days: 365 },
];

/** Charges per year for a cadence. */
export function perYear(c: Cadence): number {
  return c === 'weekly' ? 52 : c === 'monthly' ? 12 : c === 'quarterly' ? 4 : 1;
}

/** "Monthly", "Every week" … for display. */
export function cadenceLabel(c: Cadence): string {
  return c === 'weekly' ? 'Weekly' : c === 'monthly' ? 'Monthly' : c === 'quarterly' ? 'Every 3 months' : 'Yearly';
}

function nextAfter(last: string, c: Cadence): string {
  if (c === 'weekly') return addDaysISO(last, 7);
  return addMonthsISO(last, c === 'monthly' ? 1 : c === 'quarterly' ? 3 : 12);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function within(xs: number[], tol: number): boolean {
  if (!xs.length) return true;
  const m = median(xs);
  return xs.every((x) => Math.abs(x - m) <= m * tol);
}

/** Amounts all within ±35%, or two stable runs split by one step change (e.g. ₹2 trial → ₹149, ₹499 → ₹649). */
function amountsRegular(amounts: number[]): boolean {
  if (within(amounts, 0.35)) return true;
  for (let k = 1; k < amounts.length; k++) {
    if (within(amounts.slice(0, k), 0.35) && within(amounts.slice(k), 0.35)) return true;
  }
  return false;
}

function cadenceOf(gaps: number[]): Cadence | null {
  for (const r of RANGES) if (gaps.every((g) => g >= r.min && g <= r.max)) return r.cadence;
  return null;
}

/** Recurring payments (≥ 2 regular charges per merchant) sorted by next date. */
export function detectRecurring(txns: Txn[], today: string): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.type !== 'expense' || !isCountedSpend(t)) continue;
    if (t.date > today) continue;
    const key = merchantKey(t.merchant);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const thisMonth = today.slice(0, 7);
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    const cadence = cadenceOf(gaps);
    if (!cadence) continue;
    if (!amountsRegular(sorted.map((t) => t.amount))) continue;

    const latest = sorted[sorted.length - 1];
    const range = RANGES.find((r) => r.cadence === cadence)!;
    // Stopped long ago (3+ missed cycles): not recurring any more.
    if (daysBetween(latest.date, today) > range.days * 3 + range.max - range.days) continue;

    const nextDate = nextAfter(latest.date, cadence);
    const paidThisMonth = sorted.some((t) => t.date.slice(0, 7) === thisMonth);
    // Missed only after the due date plus a 3-day grace.
    const overdue = !paidThisMonth && daysBetween(nextDate, today) > MISSED_GRACE_DAYS;
    out.push({
      key,
      name: displayName(latest.merchant),
      category: latest.category,
      amount: latest.amount,
      monthly: Math.round((latest.amount * perYear(cadence)) / 12),
      cadence,
      lastDate: latest.date,
      nextDate,
      history: sorted.map((t) => ({ date: t.date, amount: t.amount, txnId: t.id })),
      paidThisMonth,
      overdue,
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
}

/** What this payment costs per year at its latest amount. */
export function yearlyCost(rec: Recurring): number {
  return Math.round(rec.amount * perYear(rec.cadence));
}

/** Price changes, trial→paid, missed and new recurring payments; dismissed ids removed; biggest yearly impact first. */
export function recurringAlerts(recs: Recurring[], today: string, dismissed: string[]): RecurringAlert[] {
  const gone = new Set(dismissed);
  const out: RecurringAlert[] = [];
  for (const r of recs) {
    const h = r.history;
    const n = h.length;
    const latest = h[n - 1];
    const prev = n >= 2 ? h[n - 2] : null;
    const recent = daysBetween(latest.date, today) <= 60;

    // trial → paid: an earlier charge ≤ ₹10, then normal charges.
    let lastTrial = -1;
    for (let i = 0; i < n - 1; i++) if (h[i].amount <= 10) lastTrial = i;
    const isTrialFlip = lastTrial >= 0 && h.slice(lastTrial + 1).every((x) => x.amount > 10);
    if (isTrialFlip) {
      const firstPaid = h[lastTrial + 1];
      if (daysBetween(firstPaid.date, today) <= 60) {
        out.push({
          id: `trial:${r.key}:${firstPaid.date}`,
          key: r.key,
          kind: 'trial',
          title: `${r.name} trial ended · now ${money(r.amount)}`,
          detail: `Started at ${money(h[lastTrial].amount)}, now charging ${money(r.amount)} ${cadenceLabel(r.cadence).toLowerCase()} (${money(yearlyCost(r))} a year).`,
          yearlyImpact: yearlyCost(r),
        });
      }
    } else if (prev && recent && prev.amount > 10 && Math.round(latest.amount) !== Math.round(prev.amount)) {
      const diff = latest.amount - prev.amount;
      const impact = Math.round(diff * perYear(r.cadence));
      out.push({
        id: `price:${r.key}:${latest.date}`,
        key: r.key,
        kind: 'price',
        title: `${r.name} ${money(prev.amount)} → ${money(latest.amount)}`,
        detail: `${diff > 0 ? 'Price went up' : 'Price went down'} on the latest charge · ${impact > 0 ? '+' : '−'}${money(Math.abs(impact))} a year.`,
        yearlyImpact: impact,
      });
    }

    if (r.overdue) {
      out.push({
        id: `missed:${r.key}:${r.nextDate}`,
        key: r.key,
        kind: 'missed',
        title: `${r.name} hasn't been charged`,
        detail: `Expected around ${dayMonth(r.nextDate)} — paid another way, or cancelled?`,
        yearlyImpact: 0,
      });
    }

    // Yearly renewal: a heads-up in the 7 days before the charge.
    if (r.cadence === 'yearly' && !r.overdue) {
      const d = daysBetween(today, r.nextDate);
      if (d >= 0 && d <= RENEWAL_WARN_DAYS) {
        out.push({
          id: `renewal:${r.key}:${r.nextDate}`,
          key: r.key,
          kind: 'renewal',
          title: `${r.name} renews ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`,
          detail: `${money(r.amount)} on ${dayMonth(r.nextDate)}.`,
          yearlyImpact: 0,
        });
      }
    }

    if (n === 2 && daysBetween(h[0].date, today) <= 35) {
      out.push({
        id: `new:${r.key}`,
        key: r.key,
        kind: 'new',
        title: `New recurring: ${r.name}`,
        detail: `${money(r.amount)} ${cadenceLabel(r.cadence).toLowerCase()} · ${money(yearlyCost(r))} a year.`,
        yearlyImpact: yearlyCost(r),
      });
    }
  }
  return out
    .filter((a) => !gone.has(a.id))
    .sort((a, b) => Math.abs(b.yearlyImpact) - Math.abs(a.yearlyImpact));
}

/** Days before a yearly charge when the renewal warning starts. */
export const RENEWAL_WARN_DAYS = 7;
/** Days after the expected date before a charge counts as missed. */
export const MISSED_GRACE_DAYS = 3;

/**
 * Why a subscription looks unused, or null:
 * 'rarely' = answered "Rarely" two months in a row;
 * 'ignored' = the monthly check-in was shown twice (≥ 30 days apart) without an answer.
 */
export function likelyUnused(
  rec: Recurring,
  checkIns: Record<string, CheckInRecord>,
  shown: Record<string, string[]> | undefined,
  today: string,
): 'rarely' | 'ignored' | null {
  const c = checkIns[rec.key];
  if (c && c.answer === 'rarely') {
    const prev = c.history?.[c.history.length - 1];
    if (prev && prev.answer === 'rarely' && prev.at.slice(0, 7) !== c.at.slice(0, 7)) return 'rarely';
  }
  if (c && (c.answer === 'not_using' || c.answer === 'cancel')) return null; // already handled as unused
  const s = (shown?.[rec.key] ?? []).filter((d) => d <= today && (!c || d >= c.at.slice(0, 10)));
  if (s.length >= 2 && daysBetween(s[0], s[s.length - 1]) >= 30) return 'ignored';
  return null;
}

/** True when the monthly "Still using it?" check-in is due (never asked, or last answer ≥ 30 days ago). */
export function checkInDue(
  rec: Recurring,
  checkIns: Record<string, { answer: CheckInAnswer; at: string }>,
  today: string,
): boolean {
  const c = checkIns[rec.key];
  if (!c) return true;
  return daysBetween(c.at.slice(0, 10), today) >= 30;
}
