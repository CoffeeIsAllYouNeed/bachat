/**
 * Plan coach: goal action plans (A), adaptive re-planning (B) and "why am I
 * off plan" (C).
 *
 * The maths is always on the device (src/engine/scenario.ts): feasibility,
 * the extra money a goal needs, every ETA and every rupee amount. Gemini only
 * rewrites short texts from aggregated facts, each line through guardOutput;
 * when it is off, slow or a line fails the guard, the deterministic text stays.
 */

import { create } from 'zustand';
import { category } from '@/data/categories';
import { todayISO, uid, useStore } from '@/data/store';
import type { Adjustment, Baseline, CategoryId, Goal, Txn } from '@/data/types';
import { isCountedSpend } from '@/engine/clean';
import { guardOutput, isPickRequest } from '@/engine/guard';
import { displayName } from '@/engine/merchant';
import type { Drift } from '@/engine/nudges';
import { hashString } from '@/engine/parseUtil';
import type { SavingIdea } from '@/engine/savings';
import {
  baseline, describeAdjustment, etaWithExtra, goalFeasibility, goalSaved, monthsBetween, profileAfter, replanRows,
  type GoalFeasibility, type ReplanRow,
} from '@/engine/scenario';
import { parseWhatIf } from '@/engine/whatif';
import { geminiConfigured, geminiJSON } from '@/services/gemini';
import { areAmountsHidden, HIDDEN_AMOUNT, money, moneyPlain, monthYear } from '@/theme/format';

// ------------------------------------------------------------------ shared helpers

/** Masks rupee amounts in a text while "Hide amounts" is on (AI lines carry numbers inline). */
export function shown(text: string): string {
  return areAmountsHidden() ? text.replace(/₹\s?\d[\d,]*(?:\.\d+)?/g, HIDDEN_AMOUNT) : text;
}

function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (isFinite(n)) out.push(n);
  }
  return out;
}

function cleanLine(s: unknown, max = 220): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length >= 6 && t.length <= max ? t : null;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Keeps a cache map small (oldest keys dropped). */
function trimmed<V>(map: Record<string, V>, max = 30): Record<string, V> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out: Record<string, V> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k];
  return out;
}

// ------------------------------------------------------------------ AI cache (not persisted)

export interface PlanCoachState {
  /** plan key → { move id → guarded text } (null = AI gave nothing usable) */
  moves: Record<string, Record<string, string> | null>;
  /** off-plan key → guarded 1–2 sentences (null = use the fallback) */
  why: Record<string, string | null>;
}

export const usePlanCoach = create<PlanCoachState>()(() => ({ moves: {}, why: {} }));
const inflight = new Set<string>();

// ------------------------------------------------------------------ A. goal action plan

export interface PlanMove {
  id: string;
  /** Short action ("Cap food delivery at 3 orders a week"); amounts written with moneyPlain — show through shown(). */
  text: string;
  /** Rupees a month this move frees (device maths). */
  monthly: number;
  /** What-if sentence for the assistant. */
  ask?: string;
  ai?: boolean;
  /** Numbers the AI may use when it rewrites this move. */
  numbers: number[];
  evidence: { merchant: string; count: number; amount: number }[];
}

export interface PlanContext {
  base: Baseline;
  /** Save more ideas (not dismissed). */
  ideas: SavingIdea[];
  today: string;
}

export interface GoalPlan {
  key: string;
  feas: GoalFeasibility;
  moves: PlanMove[];
  /** Sum of the moves' monthly amounts. */
  total: number;
  /** Goal ETA with all moves done (device maths). */
  etaWithMoves: string | null;
}

function ideaNumbers(i: SavingIdea): number[] {
  const out = [i.monthly, i.yearly];
  for (const e of i.evidence) out.push(e.count, e.amount);
  for (const v of Object.values(i.meta ?? {})) if (typeof v === 'number') out.push(v);
  if (i.meta?.capPerWeek) out.push(i.meta.capPerWeek * 4);
  out.push(...numbersIn(i.title), ...numbersIn(i.detail), ...numbersIn(i.ask ?? ''));
  return out;
}

/** A Save more idea as one short, concrete move. */
function moveFromIdea(i: SavingIdea): PlanMove {
  let text: string;
  switch (i.kind) {
    case 'food_delivery': {
      const cap = i.meta?.capPerWeek;
      text = cap ? `Cap food delivery at ${cap} order${cap === 1 ? '' : 's'} a week` : 'Order food delivery less often';
      break;
    }
    case 'unused_sub':
    case 'overlap_subs':
    case 'price_hike': {
      const m = i.ask ? i.ask.match(/^what if i (cancel .+?)\??$/i) : null;
      text = m ? capital(m[1]) : `Move ${i.evidence[0]?.merchant ?? 'this plan'} to a cheaper plan`;
      break;
    }
    case 'category_spike': {
      const label = i.category ? category(i.category).label.toLowerCase() : 'this category';
      const usual = i.meta?.usual;
      text = usual ? `Bring ${label} back to ${moneyPlain(usual)} a month` : `Keep ${label} within its budget`;
      break;
    }
    case 'small_frequent':
      text = `Halve ${i.title.split(':')[0].trim().toLowerCase()} spends`;
      break;
    case 'cabs':
      text = 'Swap short cab rides for metro or auto';
      break;
    case 'impulse_shopping':
      text = 'Wait 48 hours before non-urgent orders';
      break;
    case 'fees':
      text = 'Avoid bank and card charges';
      break;
    default:
      text = i.title;
  }
  return { id: i.id, text, monthly: i.monthly, ask: i.ask, numbers: ideaNumbers(i), evidence: i.evidence };
}

/** "Spend 20% less on shopping" for big flexible categories no idea covers yet. */
function categoryMoves(base: Baseline, covered: Set<CategoryId>): PlanMove[] {
  return (Object.entries(base.categorySpend) as [CategoryId, number | undefined][])
    .map(([k, v]) => [k, v ?? 0] as const)
    .filter(([k, v]) => v >= 1500 && !covered.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => {
      const monthly = Math.round((v * 0.2) / 100) * 100;
      const label = category(k).label.toLowerCase();
      return { id: `cat:${k}`, text: `Spend 20% less on ${label}`, monthly, ask: `What if I cut ${label} by 20%?`, numbers: [Math.round(v), monthly, 20], evidence: [] };
    })
    .filter((m) => m.monthly >= 300);
}

/** 2–3 moves: biggest first, stopping once the shortfall is covered (at least 2 when there are 2). */
function pickMoves(all: PlanMove[], need: number): PlanMove[] {
  const sorted = [...all].sort((a, b) => b.monthly - a.monthly);
  const out: PlanMove[] = [];
  let sum = 0;
  for (const m of sorted) {
    if (out.length >= 3) break;
    out.push(m);
    sum += m.monthly;
    if (need > 0 && sum >= need && out.length >= 2) break;
  }
  return out;
}

/** Feasibility + 2–3 deterministic moves for one goal. Pure maths; never calls the AI. */
export function buildGoalPlan(goal: Goal, ctx: PlanContext): GoalPlan {
  const saved = goalSaved(goal);
  const feas = goalFeasibility(ctx.base, { id: goal.id, target: goal.target, saved, dueDate: goal.dueDate });
  let moves: PlanMove[] = [];
  if (feas.remaining > 0 && !goal.archived) {
    const fromIdeas = ctx.ideas.filter((i) => i.monthly > 0).map(moveFromIdea);
    const covered = new Set(ctx.ideas.map((i) => i.category).filter((c): c is CategoryId => !!c));
    moves = pickMoves([...fromIdeas, ...categoryMoves(ctx.base, covered)], feas.extraMonthly);
  }
  const total = moves.reduce((a, m) => a + m.monthly, 0);
  const etaWithMoves = total > 0 ? etaWithExtra(ctx.base, goal.id, total) : feas.eta;
  const key =
    ctx.today + '|' +
    hashString(JSON.stringify([goal.id, goal.name, goal.target, saved, goal.dueDate ?? '', feas, moves.map((m) => [m.id, m.monthly])]));
  return { key, feas, moves, total, etaWithMoves };
}

/** One line on the plan ("On track for Mar 2027", "₹3,200/mo short of Dec 2026"). Device maths only. */
export function feasibilityLine(f: GoalFeasibility): string {
  if (!f.remaining) return 'Goal reached';
  if (f.due && f.onTrack) return `On track for ${monthYear(f.due)}`;
  if (f.due && f.extraMonthly > 0) return `${money(f.extraMonthly)}/mo short of ${monthYear(f.due)}`;
  if (f.due && f.due < todayISO().slice(0, 7)) return 'Due date has passed';
  return f.eta ? `Ready ${monthYear(f.eta)}` : 'Not within 5 years at today’s surplus';
}

const MOVES_SYSTEM =
  "You are Bachat's goal coach in an Indian budgeting app. You get one savings goal and 2–3 moves the phone already computed " +
  "from the user's own spending, each with its monthly saving and evidence (merchants, payment counts, totals). " +
  'Rewrite each move as ONE short, concrete action of at most 12 words that names the real merchant or habit, ' +
  'for example "Cut Swiggy from 23 to 12 orders a month". Use only numbers that appear in the facts; never compute new ones; ' +
  'do not write the monthly saving (the app shows it). Never mention investing, stocks, funds, crypto or any financial product. ' +
  'No exclamation marks. Return JSON only: {"moves":[{"id":"<id from the facts>","text":"..."}]}';

async function aiMoves(plan: GoalPlan, goal: Goal): Promise<Record<string, string> | null> {
  const saved = goalSaved(goal);
  const goalNums = [goal.target, saved, plan.feas.remaining, plan.feas.needMonthly, plan.feas.extraMonthly, plan.total];
  const facts = {
    goal: {
      name: goal.name,
      target: moneyPlain(goal.target),
      saved: moneyPlain(saved),
      due: plan.feas.due ? monthYear(plan.feas.due) : 'no date',
      neededPerMonth: plan.feas.needMonthly ? moneyPlain(plan.feas.needMonthly) : 'n/a',
      shortPerMonth: plan.feas.extraMonthly ? moneyPlain(plan.feas.extraMonthly) : 'on track',
    },
    moves: plan.moves.map((m) => ({
      id: m.id,
      current: m.text,
      savesPerMonth: moneyPlain(m.monthly),
      evidence: m.evidence.map((e) => ({ merchant: e.merchant, payments: e.count, total: moneyPlain(e.amount) })),
      numbers: m.numbers,
    })),
  };
  const res = await geminiJSON<unknown>(`Facts (computed on the device):\n${JSON.stringify(facts)}`, { agent: 'goalPlanner', system: MOVES_SYSTEM, temperature: 0.3, timeoutMs: 12000 });
  const arr: unknown[] = res && typeof res === 'object' && Array.isArray((res as { moves?: unknown }).moves) ? (res as { moves: unknown[] }).moves : Array.isArray(res) ? res : [];
  const byId = new Map(plan.moves.map((m) => [m.id, m]));
  const out: Record<string, string> = {};
  for (const x of arr.slice(0, 3)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const move = typeof o.id === 'string' ? byId.get(o.id) : undefined;
    const text = cleanLine(o.text, 110);
    if (!move || !text || out[move.id]) continue;
    const safe = guardOutput(text.replace(/[.!]+$/, ''), [...move.numbers, ...goalNums]);
    if (safe) out[move.id] = safe;
  }
  return Object.keys(out).length ? out : null;
}

/** Asks Gemini (once per plan key) to make the moves concrete. Safe to call on every render. */
export function requestGoalMoves(plan: GoalPlan, goal: Goal): void {
  if (!geminiConfigured || !plan.moves.length) return;
  const key = plan.key;
  if (key in usePlanCoach.getState().moves || inflight.has(key)) return;
  inflight.add(key);
  void (async () => {
    let out: Record<string, string> | null = null;
    try {
      out = await aiMoves(plan, goal);
    } catch {
      out = null;
    }
    inflight.delete(key);
    usePlanCoach.setState((s) => ({ moves: trimmed({ ...s.moves, [key]: out }) }));
  })();
}

/** Deterministic moves with the AI's wording where it passed the guard. */
export function withAiMoves(moves: PlanMove[], ai: Record<string, string> | null | undefined): PlanMove[] {
  if (!ai) return moves;
  return moves.map((m) => (ai[m.id] ? { ...m, text: ai[m.id], ai: true } : m));
}

// ------------------------------------------------------------------ B. adaptive re-planning

export interface ReplanResult {
  query: string;
  adjustments: Adjustment[];
  /** Short chips ("Income −20%", "Income −₹80,000/mo · 3 months"). */
  chips: string[];
  rows: ReplanRow[];
  /** True when Apply can save it into the profile (income, rent, EMIs, fixed bills). */
  lasting: boolean;
}

/** Chip texts; a run of equal one-offs in consecutive months (a temporary income change) becomes one chip. */
export function describeChanges(adjustments: Adjustment[]): string[] {
  const out: string[] = [];
  const offs = adjustments
    .filter((a): a is Extract<Adjustment, { kind: 'oneOff' }> => a.kind === 'oneOff')
    .sort((a, b) => a.month.localeCompare(b.month));
  for (const a of adjustments) if (a.kind !== 'oneOff') out.push(describeAdjustment(a));
  for (let i = 0; i < offs.length; ) {
    let j = i;
    while (j + 1 < offs.length && offs[j + 1].amount === offs[i].amount && monthsBetween(offs[j].month, offs[j + 1].month) === 1) j++;
    const n = j - i + 1;
    if (n >= 2) out.push(`Income ${offs[i].amount > 0 ? '−' : '+'}${money(Math.abs(offs[i].amount))}/mo · ${n} months`);
    else out.push(describeAdjustment(offs[i]));
    i = j + 1;
  }
  return out;
}

/** Life change sentence → adjustments (rules first, Gemini fallback) → before/after for the emergency fund and every goal. */
export async function replan(text: string): Promise<ReplanResult | { error: string }> {
  const query = text.trim();
  if (!query) return { error: 'Type a change, like “rent goes up ₹5,000”.' };
  if (isPickRequest(query)) return { error: 'Bachat doesn’t pick investments. Try a life change instead.' };
  let adjustments: Adjustment[] = [];
  try {
    adjustments = await parseWhatIf(query);
  } catch {
    adjustments = [];
  }
  if (!adjustments.length) return { error: 'Try “my income dropped 20%” or “rent goes up ₹5,000”.' };
  try {
    const s = useStore.getState();
    const base = baseline();
    const names: Record<string, string> = {};
    for (const g of s.goals) names[g.id] = `${g.emoji} ${g.name}`;
    return {
      query,
      adjustments,
      chips: describeChanges(adjustments),
      rows: replanRows(base, adjustments, s.profile.emergencyMonths, names),
      lasting: !!profileAfter(base, adjustments),
    };
  } catch {
    return { error: 'Couldn’t re-plan right now.' };
  }
}

/** Saves the lasting part (income, rent, EMIs, fixed bills) into the profile — a new version. False when nothing applies. */
export function applyReplan(adjustments: Adjustment[]): boolean {
  try {
    const s = useStore.getState();
    const next = profileAfter(baseline(), adjustments);
    if (!next) return false;
    const p = s.profile;
    s.saveProfile({
      monthlyIncome: next.monthlyIncome,
      irregularIncome: p.irregularIncome,
      rent: next.rent,
      emis: next.emis,
      otherFixed: next.otherFixed,
      emergencyFund: p.emergencyFund,
      emergencyMonths: p.emergencyMonths,
    });
    return true;
  } catch {
    return false;
  }
}

/** "Just exploring": keeps it as a saved what-if (Goals → Saved scenarios). */
export function keepAsWhatIf(r: ReplanResult): void {
  useStore.getState().saveScenario({ id: uid('sc_'), name: r.chips.join(' · ') || r.query, createdAt: new Date().toISOString(), adjustments: r.adjustments });
}

// ------------------------------------------------------------------ C. why am I off plan

export interface OffPlanFacts {
  key: string;
  /** Meaningful drifts, most over pace first (max 3). */
  drifts: Drift[];
  /** Top merchants this month per drifting category. */
  merchants: Partial<Record<CategoryId, { merchant: string; count: number; amount: number }[]>>;
  day: number;
}

/** Over pace in rupees (device maths). */
export function overPace(d: Drift): number {
  return Math.max(0, Math.round(d.spent - d.expectedByToday));
}

/** Facts behind the off-plan banner. */
export function offPlanFacts(txns: Txn[], drifts: Drift[], today: string): OffPlanFacts {
  const list = drifts.filter((d) => d.meaningful).slice(0, 3);
  const from = `${today.slice(0, 7)}-01`;
  const merchants: OffPlanFacts['merchants'] = {};
  for (const d of list) {
    const by = new Map<string, { merchant: string; count: number; amount: number }>();
    for (const t of txns) {
      if (t.category !== d.category || t.date < from || t.date > today || !isCountedSpend(t)) continue;
      const name = displayName(t.merchant) || t.merchant;
      const e = by.get(name) ?? { merchant: name, count: 0, amount: 0 };
      e.count += 1;
      e.amount += t.amount;
      by.set(name, e);
    }
    merchants[d.category] = [...by.values()].map((e) => ({ ...e, amount: Math.round(e.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 2);
  }
  const key = today + '|' + hashString(JSON.stringify([list.map((d) => [d.category, Math.round(d.spent), d.expectedByToday, Math.round(d.budget)]), merchants]));
  return { key, drifts: list, merchants, day: Number(today.slice(8, 10)) };
}

/** Deterministic 1–2 sentences (amounts via moneyPlain; show through shown()). */
export function whyFallback(f: OffPlanFacts): string {
  const d = f.drifts[0];
  if (!d) return '';
  const label = category(d.category).label;
  const top = f.merchants[d.category]?.[0];
  const first = `${label} is ${moneyPlain(overPace(d))} ahead of pace${top ? `, mostly ${top.merchant} (${top.count} payment${top.count === 1 ? '' : 's'})` : ''}.`;
  const rest = f.drifts.slice(1).map((x) => category(x.category).label.toLowerCase());
  return rest.length ? `${first} ${capital(rest.join(' and '))} ${rest.length === 1 ? 'is' : 'are'} ahead too.` : first;
}

const WHY_SYSTEM =
  'You explain, in at most 2 short sentences (max 35 words), why an Indian budgeting app user is going off plan this month. ' +
  'Use only the facts given: categories ahead of their budget pace and the merchants behind them. Name the main merchant or habit. ' +
  'Use only numbers from the facts, written exactly as given; never compute new ones. Calm and kind, no shaming, no exclamation marks, ' +
  'no advice about investing or any financial product. Return JSON only: {"why":"..."}';

async function aiWhy(f: OffPlanFacts): Promise<string | null> {
  const allowed: number[] = [f.day];
  const facts = f.drifts.map((d) => {
    const over = overPace(d);
    const ms = f.merchants[d.category] ?? [];
    allowed.push(Math.round(d.spent), d.expectedByToday, over, Math.round(d.budget));
    for (const m of ms) allowed.push(m.count, m.amount);
    return {
      category: category(d.category).label,
      spentSoFar: moneyPlain(d.spent),
      expectedByToday: moneyPlain(d.expectedByToday),
      overPace: moneyPlain(over),
      monthlyBudget: moneyPlain(d.budget),
      merchants: ms.map((m) => ({ name: m.merchant, payments: m.count, total: moneyPlain(m.amount) })),
    };
  });
  const res = await geminiJSON<unknown>(`Day ${f.day} of the month. Facts (computed on the device):\n${JSON.stringify(facts)}`, {
    agent: 'offPlan', system: WHY_SYSTEM, temperature: 0.3, timeoutMs: 10000,
  });
  const text = res && typeof res === 'object' ? cleanLine((res as { why?: unknown }).why, 260) : null;
  return text ? guardOutput(text, allowed) : null;
}

/** Asks Gemini (once per day + facts) for the off-plan explanation. Safe to call on every render. */
export function requestWhy(f: OffPlanFacts): void {
  if (!geminiConfigured || !f.drifts.length) return;
  if (f.key in usePlanCoach.getState().why || inflight.has(f.key)) return;
  inflight.add(f.key);
  void (async () => {
    let out: string | null = null;
    try {
      out = await aiWhy(f);
    } catch {
      out = null;
    }
    inflight.delete(f.key);
    usePlanCoach.setState((s) => ({ why: trimmed({ ...s.why, [f.key]: out }) }));
  })();
}

/** "What if I cut food by 25%?" — enough to undo the over-pace part (5–60%, steps of 5). */
export function offPlanAsk(d: Drift): string {
  const pct = d.budget > 0 ? Math.min(60, Math.max(5, Math.round(((overPace(d) / d.budget) * 100) / 5) * 5)) : 20;
  return `What if I cut ${category(d.category).label.toLowerCase()} by ${pct}%?`;
}
