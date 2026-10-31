/**
 * Family: the merged view of a household. Every number is computed here on the
 * device from this user's own data plus the other members' decrypted monthly
 * snapshots (src/services/familySync.ts). Works without a server: when the demo
 * is loaded and there is no real household, the demo family (src/data/demo.ts)
 * stands in for the other members.
 */

import { useMemo } from 'react';
import { isCategoryId } from '@/data/categories';
import { buildDemoFamily, type DemoFamily } from '@/data/demo';
import { todayISO, uid, useStore, type BachatState } from '@/data/store';
import type {
  CategoryId, FamilyMember, FamilyShare, FamilySnapshot, FamilyState, SharedGoal, TxnType,
} from '@/data/types';
import { monthRange } from '@/engine/budgets';
import { isCountedSpend, spendByCategory } from '@/engine/clean';
import { displayName, merchantKey } from '@/engine/merchant';
import { inferProfile } from '@/engine/profile';
import { detectRecurring } from '@/engine/recurring';
import type { SavingIdea } from '@/engine/savings';
import { goalSaved } from '@/engine/scenario';

// ------------------------------------------------------------------ types

export interface FamilyMemberView {
  id: string;
  name: string;
  relation: string;
  share: FamilyShare;
  isMe: boolean;
  income: number;
  spend: number;
  savings: number;
  emergencyFund: number;
  fixedCosts: number;
  /** Share of family income / spend this month (0..1). */
  incomeShare: number;
  spendShare: number;
  lastSync?: string;
  /** Snapshot is from an earlier month (left out of the totals). */
  stale: boolean;
}

export interface FamilyCategoryLine {
  category: CategoryId;
  amount: number;
  /** Family budget for the category, 0 when none is set. */
  budget: number;
}

export interface FamilyGoalView {
  id: string;
  name: string;
  emoji: string;
  target: number;
  due?: string;
  saved: number;
  contributions: { memberId: string; name: string; amount: number }[];
}

export interface FamilyDuplicate {
  /** Canonical service key ("netflix"). */
  key: string;
  name: string;
  members: { memberId: string; name: string; monthly: number }[];
  /** All plans together, per month. */
  monthly: number;
  /** Rough saving per month when the family keeps one plan (all but the priciest). */
  saving: number;
}

export interface FamilySummary {
  /** Demo family (no real household). */
  demo: boolean;
  householdName: string;
  /** yyyy-mm (month to date). */
  month: string;
  members: FamilyMemberView[];
  income: number;
  spend: number;
  savings: number;
  /** savings / income, 0 when there is no income. */
  savingsRate: number;
  byCategory: FamilyCategoryLine[];
  budgets: Partial<Record<CategoryId, number>>;
  emergencyFund: number;
  fixedCosts: number;
  /** Combined emergency fund ÷ combined monthly fixed costs. */
  emergencyMonths: number;
  sharedGoals: FamilyGoalView[];
  memberGoals: { memberId: string; memberName: string; name: string; target: number; saved: number; due?: string }[];
  duplicates: FamilyDuplicate[];
}

/** The store fields the family maths reads. */
export type FamilyInput = Pick<BachatState, 'txns' | 'profile' | 'profileInfo' | 'goals' | 'family' | 'dismissedAlerts'>;

// ------------------------------------------------------------------ helpers

function round(v: number): number {
  return Math.round(isFinite(v) ? v : 0);
}

function sumValues(o: Partial<Record<CategoryId, number>>): number {
  let s = 0;
  for (const v of Object.values(o)) s += v ?? 0;
  return s;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

let demoCache: { day: string; data: DemoFamily } | null = null;

function demoFamily(today: string): DemoFamily {
  if (!demoCache || demoCache.day !== today) demoCache = { day: today, data: buildDemoFamily(today) };
  return demoCache.data;
}

/**
 * True when the demo family stands in: demo data loaded, no real member has
 * joined yet (an invite made during the demo keeps the demo family until then),
 * and the user hasn't removed it.
 */
export function isDemoFamily(input: Pick<BachatState, 'txns' | 'family'>): boolean {
  const h = input.family.household;
  return (!h || !h.members.length) && !input.family.demoHidden && input.txns.some((t) => t.source === 'demo');
}

/** The other members and their snapshots (real household, or the demo family). */
export function familyMembers(input: FamilyInput, today: string = todayISO()): { demo: boolean; members: FamilyMember[]; snapshots: Record<string, FamilySnapshot> } {
  const h = input.family.household;
  if (h && (h.members.length || !isDemoFamily(input))) {
    const snapshots: Record<string, FamilySnapshot> = {};
    for (const m of h.members) {
      const s = input.family.snapshots[m.id];
      if (s) snapshots[m.id] = s;
    }
    return { demo: false, members: h.members, snapshots };
  }
  if (isDemoFamily(input)) {
    const d = demoFamily(today);
    return { demo: true, members: d.members, snapshots: d.snapshots };
  }
  return { demo: false, members: [], snapshots: {} };
}

/** Family budgets in force: the newest set among this phone and every member's snapshot. */
export function effectiveBudgets(family: FamilyState, snapshots: Record<string, FamilySnapshot>): Partial<Record<CategoryId, number>> {
  let best = family.budgets;
  let at = family.budgetsAt ?? '';
  for (const s of Object.values(snapshots)) {
    if (s.budgetsAt && s.budgetsAt > at) {
      best = s.familyBudgets;
      at = s.budgetsAt;
    }
  }
  return best;
}

/** Shared goals in force: newest version of each goal id, removed ones left out. */
export function effectiveSharedGoals(family: FamilyState, snapshots: Record<string, FamilySnapshot>): SharedGoal[] {
  const byId = new Map<string, SharedGoal>();
  const take = (g: SharedGoal) => {
    const cur = byId.get(g.id);
    if (!cur || g.updatedAt > cur.updatedAt) byId.set(g.id, g);
  };
  family.sharedGoals.forEach(take);
  for (const s of Object.values(snapshots)) s.sharedGoals.forEach(take);
  return [...byId.values()].filter((g) => !g.deleted).sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ my snapshot

/** Rent + EMIs + other fixed costs per month (own profile, or inferred from the data). */
function myFixedCosts(input: FamilyInput, today: string): number {
  const p = input.profile;
  const own = p.rent + p.emis + p.otherFixed;
  if (own > 0 || p.onboarded) return round(own);
  const inf = input.txns.length ? inferProfile(input.txns, today) : null;
  return inf ? round(inf.rent + inf.emis + inf.otherFixed) : 0;
}

/**
 * This user's monthly snapshot — the only thing that leaves the phone (encrypted).
 * Month to date; transactions only when share = 'full' (last 90 days, counted rows,
 * clean merchant names; never raw SMS or narrations).
 */
export function buildMySnapshot(input: FamilyInput, today: string = todayISO(), meId = 'me'): FamilySnapshot {
  const month = today.slice(0, 7);
  const { from } = monthRange(month);
  const byCategory = spendByCategory(input.txns, from, today);
  const spend = round(sumValues(byCategory));
  let earned = 0;
  for (const t of input.txns) {
    if (t.date >= from && t.date <= today && t.type === 'income' && !t.excluded && t.category === 'income') earned += t.amount;
  }
  const income = round(earned > 0 ? earned : input.profile.monthlyIncome);
  const recurring = detectRecurring(input.txns, today)
    .filter((r) => r.category !== 'rent' && r.category !== 'emi')
    .slice(0, 30)
    .map((r) => ({ name: r.name, monthly: round(r.monthly), category: r.category }));
  const share = input.family.share;
  let txns: FamilySnapshot['txns'];
  if (share === 'full') {
    const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 90);
    const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    txns = input.txns
      .filter((t) => t.date >= cutoff && t.date <= today && (isCountedSpend(t) || (t.type === 'income' && !t.excluded && t.category === 'income')))
      .slice(0, 800)
      .map((t) => ({ date: t.date, amount: round(t.amount), type: t.type as TxnType, merchant: displayName(t.merchant).slice(0, 60), category: t.category }));
  }
  return {
    v: 1,
    memberId: meId,
    name: input.profileInfo.name.trim() || 'Family member',
    share,
    month,
    updatedAt: new Date().toISOString(),
    income,
    spend,
    byCategory,
    savings: income - spend,
    emergencyFund: round(Math.max(0, input.profile.emergencyFund)),
    fixedCosts: myFixedCosts(input, today),
    goals: input.goals
      .filter((g) => !g.archived)
      .slice(0, 20)
      .map((g) => ({ name: g.name, target: round(g.target), saved: round(goalSaved(g)), due: g.dueDate })),
    recurring,
    familyBudgets: input.family.budgets,
    budgetsAt: input.family.budgetsAt,
    sharedGoals: input.family.sharedGoals,
    contributions: input.family.contributions,
    txns,
  };
}

// ------------------------------------------------------------------ duplicates

/** Services one family plan can cover (canonical key, matcher, display name). */
const SHAREABLE: [string, RegExp, string][] = [
  ['netflix', /netflix/, 'Netflix'],
  ['prime', /prime ?video|(?:amazon|amzn) ?prime|^prime$/, 'Amazon Prime'],
  ['hotstar', /hotstar|disney/, 'Disney+ Hotstar'],
  ['spotify', /spotify/, 'Spotify'],
  ['youtube', /youtube/, 'YouTube Premium'],
  ['applemusic', /apple music|itunes/, 'Apple Music'],
  ['icloud', /icloud/, 'iCloud+'],
  ['googleone', /google ?one/, 'Google One'],
  ['sonyliv', /sony ?liv/, 'Sony LIV'],
  ['zee5', /zee ?5/, 'ZEE5'],
  ['jiocinema', /jio ?cinema/, 'JioCinema'],
];

function serviceOf(name: string, cat: CategoryId): { key: string; name: string } | null {
  const raw = name.toLowerCase();
  const key = merchantKey(name);
  for (const [k, re, label] of SHAREABLE) if (re.test(raw) || re.test(key)) return { key: k, name: label };
  return cat === 'subscriptions' && key ? { key, name: displayName(name) } : null;
}

type RecurringBy = { memberId: string; name: string; items: FamilySnapshot['recurring'] };

function duplicatesFrom(lists: RecurringBy[], dismissed: Set<string>): FamilyDuplicate[] {
  const groups = new Map<string, { name: string; members: Map<string, { name: string; monthly: number }> }>();
  for (const l of lists) {
    for (const r of l.items) {
      const svc = serviceOf(r.name, r.category);
      if (!svc || !(r.monthly > 0)) continue;
      const g = groups.get(svc.key) ?? { name: svc.name, members: new Map() };
      const cur = g.members.get(l.memberId);
      g.members.set(l.memberId, { name: l.name, monthly: (cur?.monthly ?? 0) + r.monthly });
      groups.set(svc.key, g);
    }
  }
  const out: FamilyDuplicate[] = [];
  for (const [key, g] of groups) {
    if (g.members.size < 2 || dismissed.has(`save:family:${key}`)) continue;
    const members = [...g.members.entries()].map(([memberId, m]) => ({ memberId, name: m.name, monthly: round(m.monthly) }));
    const monthly = members.reduce((s, m) => s + m.monthly, 0);
    const top = Math.max(...members.map((m) => m.monthly));
    out.push({ key, name: g.name, members, monthly, saving: Math.max(0, monthly - top) });
  }
  return out.sort((a, b) => b.saving - a.saving);
}

// ------------------------------------------------------------------ summary

/** Pure merge for given store fields; null when the user has no other family member. */
export function summarizeFamily(input: FamilyInput, today: string = todayISO()): FamilySummary | null {
  const { demo, members, snapshots } = familyMembers(input, today);
  if (!members.length) return null;
  const month = today.slice(0, 7);
  const meId = input.family.household?.meId ?? 'me';
  const mine = buildMySnapshot(input, today, meId);
  const myName = input.profileInfo.name.trim() || 'You';

  const rows: { m: Omit<FamilyMemberView, 'incomeShare' | 'spendShare'>; s: FamilySnapshot | null }[] = [
    {
      m: {
        id: meId, name: myName, relation: 'You', share: input.family.share, isMe: true, income: mine.income, spend: mine.spend,
        savings: mine.savings, emergencyFund: mine.emergencyFund, fixedCosts: mine.fixedCosts, stale: false,
      },
      s: mine,
    },
  ];
  for (const fm of members) {
    const s = snapshots[fm.id] ?? null;
    const stale = !s || s.month !== month;
    rows.push({
      m: {
        id: fm.id, name: s?.name || fm.name, relation: fm.relation, share: s?.share ?? fm.share, isMe: false,
        income: s ? s.income : 0, spend: s ? s.spend : 0, savings: s ? s.savings : 0,
        emergencyFund: s ? s.emergencyFund : 0, fixedCosts: s ? s.fixedCosts : 0, lastSync: s?.updatedAt ?? fm.lastSync, stale,
      },
      s,
    });
  }

  const live = rows.filter((r) => !r.m.stale && r.s);
  const income = live.reduce((a, r) => a + r.m.income, 0);
  const spend = live.reduce((a, r) => a + r.m.spend, 0);
  const savings = income - spend;
  // Emergency fund / fixed costs are standing amounts: the latest known value counts even from an older month.
  const emergencyFund = rows.reduce((a, r) => a + (r.s ? r.m.emergencyFund : 0), 0);
  const fixedCosts = rows.reduce((a, r) => a + (r.s ? r.m.fixedCosts : 0), 0);

  const budgets = effectiveBudgets(input.family, snapshots);
  const cats: Partial<Record<CategoryId, number>> = {};
  for (const r of live) {
    for (const [k, v] of Object.entries(r.s?.byCategory ?? {})) {
      if (!isCategoryId(k) || !v) continue;
      cats[k] = (cats[k] ?? 0) + v;
    }
  }
  for (const k of Object.keys(budgets)) if (isCategoryId(k) && cats[k] == null && (budgets[k] ?? 0) > 0) cats[k] = 0;
  const byCategory: FamilyCategoryLine[] = (Object.entries(cats) as [CategoryId, number][])
    .map(([category, amount]) => ({ category, amount: round(amount), budget: round(budgets[category] ?? 0) }))
    .filter((l) => l.amount > 0 || l.budget > 0)
    .sort((a, b) => b.amount - a.amount || b.budget - a.budget);

  const nameOf = new Map(rows.map((r) => [r.m.id, r.m.isMe ? 'You' : firstName(r.m.name) || r.m.name]));
  const sharedGoals: FamilyGoalView[] = effectiveSharedGoals(input.family, snapshots).map((g) => {
    const contributions = rows
      .map((r) => ({ memberId: r.m.id, name: nameOf.get(r.m.id) ?? '', amount: round((r.m.isMe ? input.family.contributions : r.s?.contributions ?? {})[g.id] ?? 0) }))
      .filter((x) => x.amount > 0);
    return {
      id: g.id, name: g.name, emoji: g.emoji, target: g.target, due: g.due,
      saved: contributions.reduce((a, x) => a + x.amount, 0), contributions,
    };
  });

  const memberGoals = rows.flatMap((r) =>
    (r.s?.goals ?? []).map((g) => ({ memberId: r.m.id, memberName: r.m.name, name: g.name, target: g.target, saved: g.saved, due: g.due })));

  const duplicates = duplicatesFrom(
    rows.filter((r) => r.s).map((r) => ({ memberId: r.m.id, name: r.m.isMe ? 'You' : firstName(r.m.name) || r.m.name, items: r.s?.recurring ?? [] })),
    new Set(input.dismissedAlerts),
  );

  return {
    demo,
    householdName: input.family.household?.name || `${firstName(input.profileInfo.name) || 'My'} family`,
    month,
    members: rows.map(({ m }) => ({
      ...m,
      incomeShare: income > 0 && !m.stale ? m.income / income : 0,
      spendShare: spend > 0 && !m.stale ? m.spend / spend : 0,
    })),
    income,
    spend,
    savings,
    savingsRate: income > 0 ? savings / income : 0,
    byCategory,
    budgets,
    emergencyFund,
    fixedCosts,
    emergencyMonths: fixedCosts > 0 ? emergencyFund / fixedCosts : 0,
    sharedGoals,
    memberGoals,
    duplicates,
  };
}

/**
 * The family's merged month (combined income, spend by category, savings rate,
 * emergency fund vs fixed costs, shared goals, overlapping subscriptions,
 * per-member contribution). Null when there is no other family member.
 * Reads the store; safe to call from anywhere (never throws).
 */
export function familySummary(today: string = todayISO()): FamilySummary | null {
  try {
    return summarizeFamily(useStore.getState(), today);
  } catch {
    return null;
  }
}

/** Subscriptions paid by two or more family members ("Duplicates across family"). */
export function familyDuplicates(today: string = todayISO()): FamilyDuplicate[] {
  return familySummary(today)?.duplicates ?? [];
}

/**
 * Duplicates as Save more ideas ("Share one plan"). Same shape as engine/savings
 * ideas (kind 'overlap_subs', id `save:family:<service>`; dismiss with dismissAlert).
 * Text carries no amounts; `monthly` / `yearly` hold the numbers.
 */
export function familySavingIdeas(today: string = todayISO()): SavingIdea[] {
  return familyDuplicates(today)
    .filter((d) => d.saving > 0)
    .map((d) => ({
      id: `save:family:${d.key}`,
      kind: 'overlap_subs' as const,
      title: `${d.members.length} ${d.name} plans`,
      detail: `${d.members.map((m) => m.name).join(', ')} each pay for ${d.name}.`,
      monthly: d.saving,
      yearly: d.saving * 12,
      confidence: 0.7,
      evidence: d.members.map((m) => ({ merchant: `${d.name} (${m.name})`, count: 1, amount: m.monthly })),
      category: 'subscriptions' as CategoryId,
      fix: 'Share one family plan.',
      meta: { plans: d.members.length, familyMonthly: d.monthly },
    }));
}

/** Merged family view for screens (memoised on the store fields it reads). */
export function useFamilySummary(): FamilySummary | null {
  const txns = useStore((s) => s.txns);
  const profile = useStore((s) => s.profile);
  const profileInfo = useStore((s) => s.profileInfo);
  const goals = useStore((s) => s.goals);
  const family = useStore((s) => s.family);
  const dismissedAlerts = useStore((s) => s.dismissedAlerts);
  const today = todayISO();
  return useMemo(() => {
    try {
      return summarizeFamily({ txns, profile, profileInfo, goals, family, dismissedAlerts }, today);
    } catch {
      return null;
    }
  }, [txns, profile, profileInfo, goals, family, dismissedAlerts, today]);
}

// ------------------------------------------------------------------ local changes

function currentSnapshots(): Record<string, FamilySnapshot> {
  return familyMembers(useStore.getState()).snapshots;
}

/** Sets (amount > 0) or clears (0) the family budget for a category. Shared on the next sync. */
export function setFamilyBudget(cat: CategoryId, amount: number): void {
  const st = useStore.getState();
  const next = { ...effectiveBudgets(st.family, currentSnapshots()) };
  if (amount > 0) next[cat] = Math.round(amount);
  else delete next[cat];
  st.setFamily({ budgets: next, budgetsAt: new Date().toISOString() });
}

/** Adds a shared goal; returns its id. */
export function addSharedGoal(name: string, target: number, emoji = '🎯', due?: string): string {
  const st = useStore.getState();
  const g: SharedGoal = { id: uid('fg_'), name: name.trim().slice(0, 40) || 'Family goal', emoji, target: Math.round(target), due, updatedAt: new Date().toISOString() };
  st.setFamily({ sharedGoals: [...st.family.sharedGoals.filter((x) => x.id !== g.id), g] });
  return g.id;
}

/** Removes a shared goal for everyone (tombstone, shared on the next sync). */
export function removeSharedGoal(id: string): void {
  const st = useStore.getState();
  const cur = effectiveSharedGoals(st.family, currentSnapshots()).find((g) => g.id === id);
  if (!cur) return;
  const gone: SharedGoal = { ...cur, deleted: true, updatedAt: new Date().toISOString() };
  st.setFamily({ sharedGoals: [...st.family.sharedGoals.filter((x) => x.id !== id), gone] });
}

/** Adds this user's contribution to a shared goal (negative takes money out, never below 0). Returns the previous amount (for Undo). */
export function contributeToSharedGoal(id: string, amount: number): number {
  const st = useStore.getState();
  const prev = st.family.contributions[id] ?? 0;
  st.setFamily({ contributions: { ...st.family.contributions, [id]: Math.max(0, Math.round(prev + amount)) } });
  return prev;
}

/** Restores this user's contribution to a shared goal (Undo). */
export function setSharedGoalContribution(id: string, amount: number): void {
  const st = useStore.getState();
  st.setFamily({ contributions: { ...st.family.contributions, [id]: Math.max(0, Math.round(amount)) } });
}

/** What this user shares with the family. */
export function setMyShare(share: FamilyShare): void {
  useStore.getState().setFamily({ share });
}

/** Local label for a member ("Spouse", "Parent" …). */
export function setMemberRelation(memberId: string, relation: string): void {
  const st = useStore.getState();
  const h = st.family.household;
  if (!h) return;
  st.setFamily({ household: { ...h, members: h.members.map((m) => (m.id === memberId ? { ...m, relation } : m)) } });
}

/** Hides the demo family (until Clear all data / the next demo load). */
export function hideDemoFamily(): void {
  useStore.getState().setFamily({ demoHidden: true });
}

export const RELATIONS = ['Spouse', 'Partner', 'Parent', 'Child', 'Sibling', 'Family'] as const;

// ------------------------------------------------------------------ snapshot validation

function num(x: unknown, max = 1e10): number {
  return typeof x === 'number' && isFinite(x) ? Math.max(-max, Math.min(max, x)) : 0;
}

function str(x: unknown, len = 80): string {
  return typeof x === 'string' ? x.slice(0, len) : '';
}

function catMap(x: unknown): Partial<Record<CategoryId, number>> {
  const out: Partial<Record<CategoryId, number>> = {};
  if (!x || typeof x !== 'object') return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (isCategoryId(k)) out[k] = num(v);
  return out;
}

function arr(x: unknown, max: number): unknown[] {
  return Array.isArray(x) ? x.slice(0, max) : [];
}

function rec(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
}

const TXN_TYPES: TxnType[] = ['expense', 'income', 'transfer', 'investment', 'refund'];

/** Validates a decrypted snapshot (another phone wrote it): known fields only, numbers finite, strings and lists capped. */
export function cleanSnapshot(x: unknown): FamilySnapshot | null {
  const o = rec(x);
  if (o.v !== 1 || typeof o.memberId !== 'string' || !o.memberId) return null;
  const share: FamilyShare = o.share === 'full' ? 'full' : 'totals';
  const goals = arr(o.goals, 30).map(rec).map((g) => ({ name: str(g.name, 40), target: num(g.target), saved: num(g.saved), due: str(g.due, 10) || undefined }));
  const recurring = arr(o.recurring, 40).map(rec)
    .filter((r) => isCategoryId(r.category))
    .map((r) => ({ name: str(r.name, 60), monthly: num(r.monthly), category: r.category as CategoryId }));
  const sharedGoals: SharedGoal[] = arr(o.sharedGoals, 30).map(rec)
    .filter((g) => typeof g.id === 'string' && g.id)
    .map((g) => ({
      id: str(g.id, 40), name: str(g.name, 40), emoji: str(g.emoji, 8) || '🎯', target: num(g.target), due: str(g.due, 10) || undefined,
      updatedAt: str(g.updatedAt, 30), deleted: g.deleted === true ? true : undefined,
    }));
  const contributions: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(o.contributions)).slice(0, 30)) contributions[k.slice(0, 40)] = Math.max(0, num(v));
  const txns = share === 'full'
    ? arr(o.txns, 1000).map(rec)
      .filter((t) => isCategoryId(t.category) && TXN_TYPES.includes(t.type as TxnType))
      .map((t) => ({ date: str(t.date, 10), amount: num(t.amount), type: t.type as TxnType, merchant: str(t.merchant, 60), category: t.category as CategoryId }))
    : undefined;
  return {
    v: 1,
    memberId: str(o.memberId, 40),
    name: str(o.name, 40) || 'Family member',
    share,
    month: /^\d{4}-\d{2}$/.test(str(o.month, 7)) ? str(o.month, 7) : '',
    updatedAt: str(o.updatedAt, 30),
    income: num(o.income),
    spend: num(o.spend),
    byCategory: catMap(o.byCategory),
    savings: num(o.savings),
    emergencyFund: num(o.emergencyFund),
    fixedCosts: num(o.fixedCosts),
    goals,
    recurring,
    familyBudgets: catMap(o.familyBudgets),
    budgetsAt: str(o.budgetsAt, 30) || undefined,
    sharedGoals,
    contributions,
    txns,
  };
}
