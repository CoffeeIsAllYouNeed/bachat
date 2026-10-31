/**
 * Savings coach: Gemini reasons over the device's saving ideas.
 *
 * Facts in, JSON out, guarded:
 *  - Gemini gets ONLY aggregated facts (category totals, goals, the ideas with
 *    their numbers and evidence counts). No SMS text, no transaction rows.
 *  - It orders the ideas by impact and ease and writes one "why" and one "fix"
 *    sentence per idea. Every sentence passes guardOutput: numbers must come
 *    from the facts, and it may never recommend a security or product.
 *  - Any failure (no key, offline, busy, bad JSON, a sentence that fails the
 *    guard) falls back to deterministic templates, per idea.
 *  - Results are cached per day + data hash, so Home isn't slow.
 */

import { create } from 'zustand';
import { todayISO, useStore } from '@/data/store';
import { savingIdeas, type SavingIdea, type SavingsSummary } from '@/engine/savings';
import { guardOutput } from '@/engine/guard';
import { hashString } from '@/engine/parseUtil';
import { geminiConfigured, geminiJSON } from '@/services/gemini';
import { areAmountsHidden, HIDDEN_AMOUNT, money, moneyPlain, withAmountsShown } from '@/theme/format';

export interface CoachLine {
  id: string;
  why: string;
  fix: string;
}

/** What the UI shows under an idea. `ai` = Gemini wrote it (and it passed the guard). */
export interface SavingReason {
  why: string;
  fix: string;
  ai: boolean;
}

/** Ideas sent to the model (the rest keep the deterministic text). */
export const COACH_MAX_IDEAS = 6;

// ------------------------------------------------------------------ numbers the model may use

/** Every number written in a device-made string ("₹2,180", "23 orders", "10 PM"). */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (isFinite(n)) out.push(n);
  }
  return out;
}

function ideaNumbers(i: SavingIdea): number[] {
  const out = [i.monthly, i.yearly, Math.round(i.confidence * 100)];
  for (const e of i.evidence) out.push(e.count, e.amount);
  for (const v of Object.values(i.meta ?? {})) if (typeof v === 'number') out.push(v);
  out.push(...numbersIn(i.title), ...numbersIn(i.detail), ...numbersIn(i.fix), ...numbersIn(i.ask ?? ''));
  return out;
}

function summaryNumbers(s: SavingsSummary): number[] {
  const out = [s.monthlyIncome, s.spentThisMonth, s.totalMonthly, s.totalYearly];
  for (const c of s.categories) out.push(c.spent, c.usual);
  for (const g of s.goals) {
    out.push(g.target, g.saved, Math.max(0, g.target - g.saved));
    if (g.due) out.push(...numbersIn(g.due));
  }
  return out;
}

// ------------------------------------------------------------------ fallback

function first<T>(xs: T[]): T | undefined {
  return xs.length ? xs[0] : undefined;
}

/** Deterministic "why" + "fix" for one idea (used when Gemini is off or a line fails the guard). */
export function fallbackReasoning(idea: SavingIdea, summary?: SavingsSummary | null): { why: string; fix: string } {
  const top = first(idea.evidence);
  const goal = summary?.goals.find((g) => g.target > g.saved);
  const goalTail = goal ? ` That's money that could go to ${goal.name}.` : '';
  let why: string;
  switch (idea.kind) {
    case 'price_hike':
      why = `${top?.merchant ?? 'This payment'} now costs ${money(idea.yearly)} more a year for the same thing.`;
      break;
    case 'unused_sub':
      why = `You pay ${money(idea.yearly)} a year for ${top?.merchant ?? 'this'} whether you use it or not.`;
      break;
    case 'overlap_subs':
      why = `These plans cover the same need, so one of them is enough.`;
      break;
    case 'food_delivery': {
      const late = idea.meta?.lateNightOrders ?? 0;
      const avgOrder = idea.meta?.averageOrder;
      why = late > 0 && avgOrder
        ? `${late} of these were late-night orders, and each order averages ${money(avgOrder)}.`
        : avgOrder
          ? `Delivery is your fastest-growing spend, at about ${money(avgOrder)} an order.`
          : 'Delivery is running ahead of your usual month.';
      break;
    }
    case 'category_spike':
      why = top
        ? `Most of the jump is at ${top.merchant} (${top.count} payments, ${money(top.amount)}).`
        : 'This category is running ahead of a usual month.';
      break;
    case 'small_frequent':
      why = `Small spends feel harmless, but these add up to ${money(idea.monthly * 2)} a month.`;
      break;
    case 'impulse_shopping':
      why = 'Orders bunched into a few days are usually the ones that are easiest to skip.';
      break;
    case 'fees':
      why = 'Charges and penalties buy you nothing, and they are fully avoidable.';
      break;
    case 'cabs':
      why = 'Many of these rides are short, where a metro, bus or auto costs a fraction.';
      break;
    default:
      why = idea.detail;
  }
  return { why: why + (idea.monthly >= 500 ? goalTail : ''), fix: idea.fix };
}

// ------------------------------------------------------------------ Gemini

const SYSTEM =
  "You are Bachat's savings coach inside an Indian budgeting app. You receive facts computed on the user's phone: " +
  'their category totals, goals and a list of saving ideas, each with its numbers and evidence. Reason like a careful, kind coach. ' +
  'Step 1: order the ideas by impact (monthly saving × confidence) and ease — cancelling a duplicate subscription or avoiding a fee is easier than changing a daily habit. ' +
  "Step 2: for each idea write `why`: ONE sentence on why it matters for THIS user, tied to their own facts (a goal, a merchant, late-night orders, a price change). " +
  'Step 3: write `fix`: ONE concrete, realistic action they can take this week. ' +
  'Rules: use ONLY numbers that appear in the facts, written exactly as given (₹ with Indian digit grouping); never invent, estimate, add up or compute new numbers or percentages. ' +
  'Never name, recommend or compare any stock, mutual fund, ETF, crypto, insurance, credit card or other financial product, and never talk about investing. ' +
  'No shaming, no exclamation marks, no jargon, at most 25 words per sentence. ' +
  'Return JSON only: {"ideas":[{"id":"<id from the facts>","why":"...","fix":"..."}]} — best idea first, at most 6.';

function factSheet(ideas: SavingIdea[], s: SavingsSummary): Record<string, unknown> {
  return {
    month: s.month,
    period: s.period,
    monthlyIncome: s.monthlyIncome ? moneyPlain(s.monthlyIncome) : 'unknown',
    spentThisMonthSoFar: moneyPlain(s.spentThisMonth),
    categories: s.categories.map((c) => ({ name: c.name, spent: moneyPlain(c.spent), usualMonth: moneyPlain(c.usual) })),
    goals: s.goals.map((g) => ({ name: g.name, target: moneyPlain(g.target), saved: moneyPlain(g.saved), stillNeeded: moneyPlain(Math.max(0, g.target - g.saved)), due: g.due ?? 'no date' })),
    couldSaveInTotal: `${moneyPlain(s.totalMonthly)} a month`,
    ideas: ideas.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      detail: i.detail,
      saves: `${moneyPlain(i.monthly)} a month (${moneyPlain(i.yearly)} a year)`,
      confidence: Math.round(i.confidence * 100) + '%',
      evidence: i.evidence.map((e) => ({ merchant: e.merchant, payments: e.count, total: moneyPlain(e.amount) })),
      extraFacts: i.meta ?? {},
      suggestedFix: i.fix,
    })),
  };
}

/**
 * The same ideas with their texts built while amounts are shown. Idea titles/details
 * are made with money(), which returns "₹••••" while "Hide amounts" is on — the AI
 * (and the guard's number list) must get the real figures, the screen must not.
 * Ideas are rebuilt from the store inside withAmountsShown(); an idea that can't be
 * rebuilt is sent only if its text has no hidden amount.
 */
function plainIdeas(ideas: SavingIdea[]): SavingIdea[] {
  if (!areAmountsHidden()) return ideas;
  let fresh: SavingIdea[] = [];
  try {
    const s = useStore.getState();
    fresh = withAmountsShown(() =>
      savingIdeas(
        { txns: s.txns, settings: s.settings, profile: s.profile, checkIns: s.checkIns, checkInShown: s.checkInShown, dismissedAlerts: [] },
        todayISO(),
      ),
    );
  } catch {
    fresh = [];
  }
  const byId = new Map(fresh.map((i) => [i.id, i]));
  const masked = (i: SavingIdea) => [i.title, i.detail, i.fix, i.ask ?? ''].some((t) => t.includes(HIDDEN_AMOUNT));
  return ideas
    .map((i) => byId.get(i.id) ?? i)
    .filter((i) => !masked(i));
}

function clean(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 8 || t.length > 260) return null;
  return t;
}

/**
 * Asks Gemini to order and explain the ideas. Returns guarded lines (best first),
 * or null when Gemini is off / failed / produced nothing usable.
 */
export async function reasonAboutSavings(ideas: SavingIdea[], summary: SavingsSummary): Promise<CoachLine[] | null> {
  if (!geminiConfigured || !ideas.length) return null;
  const list = plainIdeas(ideas.slice(0, COACH_MAX_IDEAS));
  if (!list.length) return null;
  const prompt = `Facts (computed on the device):\n${JSON.stringify(factSheet(list, summary))}`;
  const res = await geminiJSON<unknown>(prompt, { agent: 'savings', system: SYSTEM, temperature: 0.3, timeoutMs: 15000 });
  const arr: unknown[] = Array.isArray(res)
    ? res
    : res && typeof res === 'object' && Array.isArray((res as { ideas?: unknown }).ideas)
      ? ((res as { ideas: unknown[] }).ideas)
      : [];
  const byId = new Map(list.map((i) => [i.id, i]));
  const shared = summaryNumbers(summary);
  const out: CoachLine[] = [];
  for (const x of arr.slice(0, COACH_MAX_IDEAS)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const idea = byId.get(id);
    if (!idea || out.some((l) => l.id === id)) continue;
    const allowed = [...ideaNumbers(idea), ...shared];
    const why = clean(o.why);
    const fix = clean(o.fix);
    const safeWhy = why ? guardOutput(why, allowed) : null;
    const safeFix = fix ? guardOutput(fix, allowed) : null;
    if (!safeWhy || !safeFix) continue;
    out.push({ id, why: safeWhy, fix: safeFix });
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------------ cache + store

/** Cache key: today + a hash of the ideas and the facts. */
export function coachKey(ideas: SavingIdea[], summary: SavingsSummary, today: string): string {
  const sig = JSON.stringify([
    ideas.slice(0, COACH_MAX_IDEAS).map((i) => [i.id, i.monthly, Math.round(i.confidence * 100), i.title]),
    summary.categories,
    summary.goals,
    summary.monthlyIncome,
  ]);
  return `${today}|${hashString(sig)}`;
}

export interface SavingsCoachState {
  key: string | null;
  status: 'idle' | 'loading' | 'done';
  /** Gemini's lines for `key` (null = fallback text only). */
  lines: CoachLine[] | null;
}

/** Latest coach result (not persisted). */
export const useSavingsCoach = create<SavingsCoachState>()(() => ({ key: null, status: 'idle', lines: null }));

const cache = new Map<string, CoachLine[] | null>();
const inflight = new Map<string, Promise<void>>();

/** Runs the coach for `key` once (cached per day + data hash); safe to call on every render change. */
export function requestReasoning(key: string, ideas: SavingIdea[], summary: SavingsSummary): Promise<void> {
  if (!key) return Promise.resolve();
  if (cache.has(key)) {
    const cur = useSavingsCoach.getState();
    if (cur.key !== key || cur.status !== 'done') useSavingsCoach.setState({ key, status: 'done', lines: cache.get(key) ?? null });
    return Promise.resolve();
  }
  const running = inflight.get(key);
  if (running) return running;
  if (!geminiConfigured || !ideas.length) {
    cache.set(key, null);
    useSavingsCoach.setState({ key, status: 'done', lines: null });
    return Promise.resolve();
  }
  useSavingsCoach.setState({ key, status: 'loading', lines: null });
  const p = (async () => {
    let lines: CoachLine[] | null = null;
    try {
      lines = await reasonAboutSavings(ideas, summary);
    } catch {
      lines = null;
    }
    cache.set(key, lines);
    if (cache.size > 12) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    inflight.delete(key);
    // Only publish if nothing newer was requested meanwhile.
    if (useSavingsCoach.getState().key === key) useSavingsCoach.setState({ key, status: 'done', lines });
  })();
  inflight.set(key, p);
  return p;
}

/** Cached Gemini lines for a key, if any (for the assistant's answer). */
export function cachedReasoning(key: string): CoachLine[] | null {
  return cache.get(key) ?? null;
}
