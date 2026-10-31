/**
 * The planner. Deterministic month-by-month projection of the user's surplus:
 * it fills the emergency fund first, then goals by priority. What-if
 * scenarios are just Adjustment[] applied to the same baseline, so "now" and
 * "then" are always computed the same way, on the device.
 */

import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { Adjustment, Baseline, CategoryId, Goal, Projection, Txn } from '@/data/types';
import { lastCompleteMonths, monthRange } from '@/engine/budgets';
import { spendByCategory } from '@/engine/clean';
import { inferProfile } from '@/engine/profile';
import { money, monthYear } from '@/theme/format';

/** Spend categories treated as fixed (not flexible) by the planner. */
export const FIXED_CATEGORIES: CategoryId[] = ['rent', 'emi', 'bills', 'subscriptions'];
const NOT_FLEXIBLE = new Set<CategoryId>([...FIXED_CATEGORIES, 'income', 'transfer', 'investment']);

// ------------------------------------------------------------------ month helpers

/** "yyyy-mm" + n months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  return `${ny}-${String(idx - ny * 12 + 1).padStart(2, '0')}`;
}

/** Whole months from a to b ("yyyy-mm" each; b − a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** 27 → "2 years 3 months", 1 → "1 month", 0 → "this month". */
export function durationText(months: number): string {
  if (months <= 0) return 'this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** "Mar 2027", or "not within 5 years" for null. */
export function etaLabel(eta: string | null): string {
  return eta ? monthYear(eta) : 'not within 5 years';
}

/** Sum of a goal's contributions (withdrawals are negative), never below 0. */
export function goalSaved(g: Goal): number {
  return Math.max(0, g.contributions.reduce((a, c) => a + c.amount, 0));
}

// ------------------------------------------------------------------ baseline

/** Average monthly flexible spend per category over the last 3 complete months that have data. */
export function averageFlexible(txns: Txn[], today: string): Partial<Record<CategoryId, number>> {
  const have = new Set(txns.map((t) => t.date.slice(0, 7)));
  const months = lastCompleteMonths(today, 3).filter((m) => have.has(m));
  const out: Partial<Record<CategoryId, number>> = {};
  if (!months.length) return out;
  for (const m of months) {
    const { from, to } = monthRange(m);
    const by = spendByCategory(txns, from, to);
    for (const [k, v] of Object.entries(by)) {
      const id = k as CategoryId;
      if (NOT_FLEXIBLE.has(id) || !category(id).spend || !v) continue;
      out[id] = (out[id] ?? 0) + v;
    }
  }
  for (const k of Object.keys(out) as CategoryId[]) out[k] = Math.round((out[k] ?? 0) / months.length);
  return out;
}

/** Planner inputs from the store: profile (or inferred values), flexible spend averages and active goals. */
export function baseline(): Baseline {
  const s = useStore.getState();
  const today = todayISO();
  const p = s.profile;
  const inferred = s.txns.length ? inferProfile(s.txns, today) : null;
  const trusted = p.onboarded;
  const pick = (mine: number, guess: number | undefined) => (mine > 0 ? mine : trusted ? mine : guess ?? 0);

  const rent = pick(p.rent, inferred?.rent);
  const emis = pick(p.emis, inferred?.emis);
  const otherFixed = pick(p.otherFixed, inferred?.otherFixed);
  const categorySpend = averageFlexible(s.txns, today);
  const flexible = Object.values(categorySpend).reduce<number>((a, v) => a + (v ?? 0), 0);
  const months = p.emergencyMonths > 0 ? p.emergencyMonths : 6;

  return {
    monthlyIncome: p.monthlyIncome > 0 ? p.monthlyIncome : inferred?.monthlyIncome ?? 0,
    rent,
    emis,
    otherFixed,
    categorySpend,
    emergencyFund: Math.max(0, p.emergencyFund),
    emergencyTarget: Math.round(months * (rent + emis + otherFixed + flexible)),
    goals: s.goals
      .filter((g) => !g.archived)
      .map((g) => ({ id: g.id, name: g.name, target: g.target, saved: goalSaved(g), dueDate: g.dueDate, priority: g.priority })),
    startMonth: today.slice(0, 7),
  };
}

// ------------------------------------------------------------------ maths

/** The monthly numbers behind a projection ("Show the maths"). */
export interface Breakdown {
  income: number;
  /** rent + EMIs + other fixed bills, after changes and cancellations */
  fixed: number;
  rent: number;
  emis: number;
  otherFixed: number;
  flexible: number;
  categorySpend: Partial<Record<CategoryId, number>>;
  /** SIPs added by the scenario (money invested, not spent) */
  sip: number;
  /** income − fixed − flexible − sip */
  surplus: number;
}

/** Applies the recurring (non one-off) adjustments to the baseline's monthly numbers. */
export function breakdown(base: Baseline, adjustments: Adjustment[] = []): Breakdown {
  let income = base.monthlyIncome;
  let rent = base.rent;
  let emis = base.emis;
  let otherFixed = base.otherFixed;
  let cancelled = 0;
  let sip = 0;
  const spend: Partial<Record<CategoryId, number>> = { ...base.categorySpend };

  // Percent changes to income apply to the base income, then rupee changes.
  const incPct = adjustments.reduce((a, x) => (x.kind === 'incomePct' ? a + x.pct : a), 0);
  income = income * Math.max(0, 1 + incPct / 100);

  for (const a of adjustments) {
    switch (a.kind) {
      case 'incomeAbs':
        income += a.amount;
        break;
      case 'fixedChange':
        if (a.what === 'rent') rent = Math.max(0, rent + a.amount);
        else if (a.what === 'emi') emis = Math.max(0, emis + a.amount);
        else otherFixed = Math.max(0, otherFixed + a.amount);
        break;
      case 'cancelSub':
        cancelled += Math.max(0, a.monthly);
        break;
      case 'addSip':
        sip += a.amount;
        break;
      case 'categoryPct':
      case 'categoryAbs': {
        const apply = (v: number) => Math.max(0, a.kind === 'categoryPct' ? v * (1 + a.pct / 100) : v + a.amount);
        if (a.category === 'rent') rent = apply(rent);
        else if (a.category === 'emi') emis = apply(emis);
        else if (a.category === 'bills' || a.category === 'subscriptions') otherFixed = apply(otherFixed);
        else spend[a.category] = apply(spend[a.category] ?? 0);
        break;
      }
      default:
        break;
    }
  }
  income = Math.max(0, income);
  const fixed = Math.max(0, rent + emis + otherFixed - cancelled);
  const flexible = Object.values(spend).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const r = (v: number) => Math.round(v);
  return {
    income: r(income),
    fixed: r(fixed),
    rent: r(rent),
    emis: r(emis),
    otherFixed: r(Math.max(0, otherFixed - cancelled)),
    flexible: r(flexible),
    categorySpend: spend,
    sip: r(sip),
    surplus: r(income - fixed - flexible - sip),
  };
}

/**
 * Month-by-month projection (default 60 months). Each month's surplus fills
 * the emergency fund to its target first, then goals in priority order;
 * one-offs land in their month; a negative month draws from unallocated
 * savings, then the emergency fund. savingsPath = existing savings
 * (emergency fund + goal savings) + cumulative surplus.
 */
export function project(base: Baseline, adjustments: Adjustment[] = [], months = 60): Projection {
  const b = breakdown(base, adjustments);
  const n = Math.max(1, Math.round(months));
  const start = base.startMonth;
  const oneOffs = new Map<string, number>();
  for (const a of adjustments) if (a.kind === 'oneOff') oneOffs.set(a.month, (oneOffs.get(a.month) ?? 0) + a.amount);

  let ef = base.emergencyFund;
  const target = Math.max(0, base.emergencyTarget);
  let emergencyEta: string | null = ef >= target ? start : null;

  const goals = [...base.goals]
    .sort((x, y) => x.priority - y.priority || (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') || x.name.localeCompare(y.name))
    .map((g) => ({ id: g.id, target: g.target, saved: g.saved }));
  const goalEta: Record<string, string | null> = {};
  for (const g of goals) goalEta[g.id] = g.saved >= g.target ? start : null;

  let free = 0;
  let cumulative = ef + goals.reduce((a, g) => a + g.saved, 0);
  const savingsPath: number[] = [];

  for (let i = 0; i < n; i++) {
    const m = addMonths(start, i);
    let s = b.surplus - (oneOffs.get(m) ?? 0);
    cumulative += s;
    if (s >= 0) {
      const toEf = Math.min(s, Math.max(0, target - ef));
      ef += toEf;
      s -= toEf;
      if (emergencyEta === null && ef >= target - 0.5) emergencyEta = m;
      if (emergencyEta !== null || ef >= target - 0.5) {
        for (const g of goals) {
          if (s <= 0) break;
          const need = g.target - g.saved;
          if (need <= 0) continue;
          const put = Math.min(s, need);
          g.saved += put;
          s -= put;
          if (goalEta[g.id] === null && g.saved >= g.target - 0.5) goalEta[g.id] = m;
        }
      }
      free += s;
    } else {
      let deficit = -s;
      const fromFree = Math.min(free, deficit);
      free -= fromFree;
      deficit -= fromFree;
      ef = Math.max(0, ef - deficit);
    }
    savingsPath.push(Math.round(cumulative));
  }

  return {
    monthlySurplus: b.surplus,
    monthlySpend: b.fixed + b.flexible,
    emergencyEta,
    goalEta,
    savingsPath,
  };
}

// ------------------------------------------------------------------ feasibility & re-planning

/** Emergency-fund months from the profile (6 when unset). */
export function emergencyMonthsOf(months: number): number {
  return months > 0 ? months : 6;
}

/**
 * The same baseline, but the emergency target follows the scenario's monthly
 * costs (rent up → a bigger fund is needed). One-offs don't change the target.
 */
export function adjustedBaseline(base: Baseline, adjustments: Adjustment[], months: number): Baseline {
  const b = breakdown(base, adjustments.filter((a) => a.kind !== 'oneOff'));
  return { ...base, emergencyTarget: Math.round(emergencyMonthsOf(months) * (b.fixed + b.flexible)) };
}

/** ETA of one goal with ₹extra more surplus every month (extra = 0 → the plain plan). */
export function etaWithExtra(base: Baseline, goalId: string, extra: number, adjustments: Adjustment[] = []): string | null {
  const adj: Adjustment[] = extra > 0 ? [...adjustments, { kind: 'incomeAbs', amount: extra }] : adjustments;
  return project(base, adj).goalEta[goalId] ?? null;
}

/**
 * Smallest extra monthly surplus (rounded up to ₹100) that gets the goal done
 * by `dueYm`. 0 when it is already on track; null when the due month has passed.
 * Binary search over project(): more surplus never makes an ETA later.
 */
export function extraNeeded(base: Baseline, goalId: string, dueYm: string, adjustments: Adjustment[] = []): number | null {
  if (dueYm < base.startMonth) return null;
  const ok = (x: number) => {
    const eta = etaWithExtra(base, goalId, x, adjustments);
    return eta !== null && eta <= dueYm;
  };
  if (ok(0)) return 0;
  const b = breakdown(base, adjustments);
  const oneOffs = adjustments.reduce((a, x) => (x.kind === 'oneOff' && x.amount > 0 ? a + x.amount : a), 0);
  const upper =
    Math.max(0, base.emergencyTarget - base.emergencyFund) +
    base.goals.reduce((a, g) => a + Math.max(0, g.target - g.saved), 0) +
    Math.max(0, -b.surplus) * 60 + oneOffs + 100;
  let lo = 0;
  let hi = Math.ceil(upper / 100);
  if (!ok(hi * 100)) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid * 100)) hi = mid;
    else lo = mid;
  }
  return hi * 100;
}

export interface GoalFeasibility {
  goalId: string;
  remaining: number;
  /** yyyy-mm or null without a due date */
  due: string | null;
  /** Plan ETA (yyyy-mm) or null when > 5 years */
  eta: string | null;
  /** remaining ÷ months left (0 without a due date) */
  needMonthly: number;
  onTrack: boolean;
  /** Extra surplus a month to make the due date (0 when on track or no date). */
  extraMonthly: number;
}

/** Can this goal be reached by its due date at today's surplus? All maths from project(). */
export function goalFeasibility(base: Baseline, goal: { id: string; target: number; saved: number; dueDate?: string }): GoalFeasibility {
  const remaining = Math.max(0, goal.target - goal.saved);
  const eta = remaining ? project(base).goalEta[goal.id] ?? null : base.startMonth;
  const due = goal.dueDate ? goal.dueDate.slice(0, 7) : null;
  const left = due ? Math.max(1, monthsBetween(base.startMonth, due) + 1) : 0;
  const needMonthly = due && remaining ? Math.ceil(remaining / left) : 0;
  const onTrack = !remaining || (due ? eta !== null && eta <= due : eta !== null);
  const extraMonthly = !onTrack && due ? extraNeeded(base, goal.id, due) ?? 0 : 0;
  return { goalId: goal.id, remaining, due, eta, needMonthly, onTrack, extraMonthly };
}

export interface ReplanRow {
  key: string;
  label: string;
  before: string;
  after: string;
  /** true = better, false = worse, null = unchanged */
  better: boolean | null;
}

function etaBetter(now: string | null, then: string | null): boolean | null {
  if (now === then) return null;
  if (now === null) return true;
  if (then === null) return false;
  return then < now;
}

/**
 * Before → after for a life change: this month's surplus, the emergency
 * target and ETA (target follows the new costs) and every unfinished goal.
 */
export function replanRows(base: Baseline, adjustments: Adjustment[], months: number, names: Record<string, string> = {}): ReplanRow[] {
  const nowBase = adjustedBaseline(base, [], months);
  const thenBase = adjustedBaseline(base, adjustments, months);
  const now = project(nowBase);
  const then = project(thenBase, adjustments);
  const firstOneOff = adjustments.reduce((a, x) => (x.kind === 'oneOff' && x.month === base.startMonth ? a + x.amount : a), 0);
  const sNow = breakdown(nowBase).surplus;
  const sThen = breakdown(thenBase, adjustments).surplus - firstOneOff;
  const rows: ReplanRow[] = [
    { key: 'surplus', label: 'Surplus this month', before: money(sNow), after: money(sThen), better: sNow === sThen ? null : sThen > sNow },
  ];
  if (nowBase.emergencyTarget !== thenBase.emergencyTarget) {
    rows.push({
      key: 'efTarget', label: 'Emergency target', before: money(nowBase.emergencyTarget), after: money(thenBase.emergencyTarget),
      better: thenBase.emergencyTarget < nowBase.emergencyTarget,
    });
  }
  rows.push({
    key: 'ef', label: 'Emergency fund ready', before: etaLabel(now.emergencyEta), after: etaLabel(then.emergencyEta),
    better: etaBetter(now.emergencyEta, then.emergencyEta),
  });
  for (const g of base.goals) {
    if (g.saved >= g.target) continue;
    const a = now.goalEta[g.id] ?? null;
    const b = then.goalEta[g.id] ?? null;
    rows.push({ key: g.id, label: names[g.id] ?? g.name, before: etaLabel(a), after: etaLabel(b), better: etaBetter(a, b) });
  }
  return rows;
}

/** Adjustments that change the money profile (income, rent, EMIs, fixed bills). */
export function profileAdjustments(adjustments: Adjustment[]): Adjustment[] {
  return adjustments.filter(
    (a) =>
      a.kind === 'incomePct' || a.kind === 'incomeAbs' || a.kind === 'fixedChange' ||
      ((a.kind === 'categoryPct' || a.kind === 'categoryAbs') && FIXED_CATEGORIES.includes(a.category)),
  );
}

/** The new profile numbers after a lasting change, or null when nothing in it belongs to the profile. */
export function profileAfter(
  base: Baseline,
  adjustments: Adjustment[],
): { monthlyIncome: number; rent: number; emis: number; otherFixed: number } | null {
  const lasting = profileAdjustments(adjustments);
  if (!lasting.length) return null;
  const b = breakdown(base, lasting);
  return { monthlyIncome: b.income, rent: b.rent, emis: b.emis, otherFixed: b.otherFixed };
}

/** Short chip text: "Cut Food 30%", "Rent +₹5,000/mo", "Cancel Netflix", "SIP ₹5,000/mo". */
export function describeAdjustment(a: Adjustment): string {
  const signed = (v: number) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;
  switch (a.kind) {
    case 'categoryPct': {
      const label = category(a.category).label;
      if (a.pct <= -100) return `Stop ${label}`;
      return a.pct < 0 ? `Cut ${label} ${Math.abs(a.pct)}%` : `${label} +${a.pct}%`;
    }
    case 'categoryAbs': {
      const label = category(a.category).label;
      return a.amount < 0 ? `Cut ${label} ${money(Math.abs(a.amount))}/mo` : `${label} +${money(a.amount)}/mo`;
    }
    case 'fixedChange': {
      const label = a.what === 'rent' ? 'Rent' : a.what === 'emi' ? 'EMI' : 'Fixed bills';
      return `${label} ${signed(a.amount)}/mo`;
    }
    case 'incomePct':
      if (a.pct <= -100) return 'No income';
      return `Income ${a.pct < 0 ? '−' : '+'}${Math.abs(a.pct)}%`;
    case 'incomeAbs':
      return `Income ${signed(a.amount)}/mo`;
    case 'cancelSub':
      return `Cancel ${a.name}`;
    case 'addSip':
      return a.amount >= 0 ? `SIP ${money(a.amount)}/mo` : `Stop SIP ${money(Math.abs(a.amount))}/mo`;
    case 'oneOff':
      return a.amount >= 0 ? `Spend ${money(a.amount)} in ${monthYear(a.month)}` : `Extra ${money(Math.abs(a.amount))} in ${monthYear(a.month)}`;
    default:
      return 'Change';
  }
}
