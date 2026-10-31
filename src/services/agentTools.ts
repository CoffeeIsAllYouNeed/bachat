/**
 * The assistant's tools. Every tool is deterministic and runs on the device
 * against the store and the engines; the AI only decides which to call.
 *
 * Read tools return aggregated numbers (raw rupees, never money(), so "Hide
 * amounts" never reaches the AI). Write tools never change anything: they
 * return a PendingAction the user must Confirm in the answer panel.
 * Every number a tool returns is collected so the final reply can be guarded
 * against invented numbers.
 */

import { category, isCategoryId } from '@/data/categories';
import { todayISO, uid, useStore } from '@/data/store';
import type { Adjustment, CategoryId, CheckInAnswer, CheckInRecord, Goal, ProfileSnapshot, Recurring, Rule, Txn } from '@/data/types';
import { budgetLines, monthRange } from '@/engine/budgets';
import { isCountedSpend, netSpend, spendByCategory } from '@/engine/clean';
import { isPickRequest } from '@/engine/guard';
import { displayName, merchantKey } from '@/engine/merchant';
import { drifts } from '@/engine/nudges';
import { investedAmount, isCountedIncome } from '@/engine/periods';
import { detectRecurring, recurringAlerts, yearlyCost } from '@/engine/recurring';
import { applyRules, learnCorrection, undoLast } from '@/engine/rules';
import { savingIdeas } from '@/engine/savings';
import {
  addMonths, baseline, describeAdjustment, etaLabel, goalFeasibility, goalSaved, profileAfter, project,
} from '@/engine/scenario';
import { parseWhatIf } from '@/engine/whatif';
import { familySummary } from '@/services/family';
import type { FunctionDeclaration } from '@/services/geminiTools';
import { applyReplan } from '@/services/planCoach';
import { money, withAmountsShown } from '@/theme/format';

// ------------------------------------------------------------------ shapes

/** A change the AI proposed. Nothing happens until the user taps Confirm. */
export interface PendingAction {
  id: string;
  /** Screen text (money(), so it follows "Hide amounts"). */
  title: string;
  detail: string;
  run(): void;
  undo?(): void;
}

export interface ToolContext {
  /** Every number the tools returned (for guardOutput). */
  allowed: number[];
  /** Proposals waiting for Confirm. */
  pending: PendingAction[];
  /** Short labels of what ran ("Checked spending"). */
  labels: string[];
}

export interface AgentTool {
  decl: FunctionDeclaration;
  /** Shown in the one muted steps line (lower case; the line capitalises the first). */
  label: string;
  write?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function newToolContext(): ToolContext {
  return { allowed: [], pending: [], labels: [] };
}

// ------------------------------------------------------------------ arg validation

type Bad = { error: string };
const bad = (error: string): Bad => ({ error });
const isBad = (x: unknown): x is Bad => !!x && typeof x === 'object' && 'error' in x;

/** Trimmed text; '' when optional and missing. */
function str(args: Record<string, unknown>, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string | Bad {
  const v = args[key];
  if (v == null || v === '') return opts.optional ? '' : bad(`"${key}" is required.`);
  if (typeof v !== 'string') return bad(`"${key}" must be text.`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length < (opts.min ?? 1) || t.length > (opts.max ?? 200)) return bad(`"${key}" must be ${opts.min ?? 1}–${opts.max ?? 200} characters.`);
  return t;
}

function num(args: Record<string, unknown>, key: string, min: number, max: number): number | Bad {
  const v = args[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : NaN;
  if (!isFinite(n)) return bad(`"${key}" must be a number.`);
  if (n < min || n > max) return bad(`"${key}" must be between ${min} and ${max}.`);
  return Math.round(n);
}

function oneOf<V extends string>(args: Record<string, unknown>, key: string, values: readonly V[], fallback?: V): V | Bad {
  const v = args[key];
  if (v == null || v === '') return fallback ?? bad(`"${key}" is required.`);
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as V) : bad(`"${key}" must be one of: ${values.join(', ')}.`);
}

function spendCategory(args: Record<string, unknown>, key: string, optional: boolean): CategoryId | undefined | Bad {
  const v = args[key];
  if (v == null || v === '') return optional ? undefined : bad(`"${key}" is required.`);
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  const id = isCategoryId(raw) ? raw : SPEND_IDS.find((c) => category(c).label.toLowerCase() === raw);
  if (!id || !category(id).spend) return bad(`"${key}" must be one of: ${SPEND_IDS.join(', ')}.`);
  return id;
}

// ------------------------------------------------------------------ numbers

/** Every number in a tool result (also inside strings) — the guard's allow-list. */
function collect(x: unknown, out: number[], depth = 0): void {
  if (depth > 6 || x == null) return;
  if (typeof x === 'number') {
    if (isFinite(x)) out.push(x);
  } else if (typeof x === 'string') {
    for (const m of x.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (isFinite(n)) out.push(n);
    }
  } else if (Array.isArray(x)) {
    for (const v of x) collect(v, out, depth + 1);
  } else if (typeof x === 'object') {
    for (const v of Object.values(x as Record<string, unknown>)) collect(v, out, depth + 1);
  }
}

const r0 = (v: number) => Math.round(v);

// ------------------------------------------------------------------ periods

const PERIODS = ['this_month', 'last_month', 'last_3_months', 'this_year', 'last_12_months'] as const;
type Period = (typeof PERIODS)[number];

function periodRange(p: Period, today: string): { from: string; to: string; label: string } {
  const cur = today.slice(0, 7);
  switch (p) {
    case 'last_month': {
      const r = monthRange(addMonths(cur, -1));
      return { ...r, label: 'last month' };
    }
    case 'last_3_months':
      return { from: monthRange(addMonths(cur, -3)).from, to: monthRange(addMonths(cur, -1)).to, label: 'last 3 complete months' };
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'this year so far' };
    case 'last_12_months':
      return { from: monthRange(addMonths(cur, -11)).from, to: today, label: 'last 12 months' };
    case 'this_month':
    default:
      return { from: `${cur}-01`, to: today, label: 'this month so far' };
  }
}

const SPEND_IDS: CategoryId[] = (['rent', 'food', 'groceries', 'transport', 'bills', 'shopping', 'entertainment', 'subscriptions', 'health', 'personal', 'education', 'travel', 'emi', 'other'] as CategoryId[])
  .filter((c) => category(c).spend);

function topMerchants(txns: Txn[], from: string, to: string, cat?: CategoryId, n = 5): { merchant: string; payments: number; amount: number }[] {
  const by = new Map<string, { merchant: string; payments: number; amount: number }>();
  for (const t of txns) {
    if (t.date < from || t.date > to || !isCountedSpend(t) || (cat && t.category !== cat)) continue;
    const name = displayName(t.merchant) || t.merchant;
    const e = by.get(name) ?? { merchant: name, payments: 0, amount: 0 };
    e.payments += 1;
    e.amount += t.amount;
    by.set(name, e);
  }
  return [...by.values()].map((e) => ({ ...e, amount: r0(e.amount) })).sort((a, b) => b.amount - a.amount).slice(0, n);
}

function recs(): Recurring[] {
  try {
    return detectRecurring(useStore.getState().txns, todayISO());
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ read tools

const getOverview: AgentTool = {
  label: 'checkedoverview',
  decl: {
    name: 'get_overview',
    description: 'Income, spending, investing and net for a period, plus this month\'s plan surplus and rows waiting for review. Amounts are rupees.',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: [...PERIODS] } } },
  },
  run(args) {
    const period = oneOf(args, 'period', PERIODS, 'this_month');
    if (isBad(period)) return period;
    const s = useStore.getState();
    const today = todayISO();
    const r = periodRange(period, today);
    let income = 0;
    let invested = 0;
    for (const t of s.txns) {
      if (t.date < r.from || t.date > r.to) continue;
      if (isCountedIncome(t)) income += t.amount;
      invested += investedAmount(t);
    }
    const spent = netSpend(s.txns, r.from, r.to);
    const p = project(baseline());
    return {
      period: r.label, from: r.from, to: r.to,
      income: r0(income), spent: r0(spent), invested: r0(invested), net: r0(income - spent - invested),
      planMonthlySurplus: r0(p.monthlySurplus),
      needsReview: s.txns.filter((t) => t.needsReview).length,
    };
  },
};

const getSpending: AgentTool = {
  label: 'checkedspending',
  decl: {
    name: 'get_spending',
    description: 'Spending for a period: total and top categories, or one category with its top merchants and last period for comparison.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: SPEND_IDS, description: 'Optional spend category id.' },
        period: { type: 'string', enum: [...PERIODS] },
      },
    },
  },
  run(args) {
    const period = oneOf(args, 'period', PERIODS, 'this_month');
    if (isBad(period)) return period;
    const cat = spendCategory(args, 'category', true);
    if (isBad(cat)) return cat;
    const s = useStore.getState();
    const today = todayISO();
    const r = periodRange(period, today);
    const by = spendByCategory(s.txns, r.from, r.to);
    if (cat) {
      const budget = budgetLines(s.txns, s.settings.budgets, s.profile, today.slice(0, 7), today).find((l) => l.category === cat);
      const prev = period === 'this_month' ? monthRange(addMonths(today.slice(0, 7), -1)) : null;
      return {
        period: r.label, category: cat, label: category(cat).label,
        spent: r0(by[cat] ?? 0),
        ...(prev ? { lastMonth: r0(spendByCategory(s.txns, prev.from, prev.to)[cat] ?? 0) } : {}),
        ...(budget ? { monthlyBudget: r0(budget.budget), spentThisMonth: r0(budget.spent), budgetLeft: r0(budget.left) } : {}),
        topMerchants: topMerchants(s.txns, r.from, r.to, cat),
      };
    }
    const top = (Object.entries(by) as [CategoryId, number | undefined][])
      .map(([k, v]) => ({ category: k, label: category(k).label, spent: r0(v ?? 0) }))
      .filter((x) => x.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 6);
    return { period: r.label, total: r0(netSpend(s.txns, r.from, r.to)), topCategories: top, topMerchants: topMerchants(s.txns, r.from, r.to, undefined, 3) };
  },
};

const getRecurring: AgentTool = {
  label: 'checkedrecurring',
  decl: {
    name: 'get_recurring',
    description: 'Recurring payments and subscriptions with ids, amounts, cadence, next date, the user\'s last "still using it?" answer, and current alerts (price changes, trials, missed, renewals).',
  },
  run() {
    const s = useStore.getState();
    const today = todayISO();
    const list = recs();
    const alerts = withAmountsShown(() => recurringAlerts(list, today, s.dismissedAlerts));
    return {
      count: list.length,
      monthlyTotal: r0(list.reduce((a, x) => a + x.monthly, 0)),
      items: list.slice(0, 15).map((x) => ({
        id: x.key, name: x.name, category: x.category, amount: r0(x.amount), monthly: r0(x.monthly), yearly: yearlyCost(x),
        cadence: x.cadence, nextDate: x.nextDate, paidThisMonth: x.paidThisMonth, overdue: x.overdue,
        lastAnswer: s.checkIns[x.key]?.answer ?? null,
      })),
      alerts: alerts.slice(0, 6).map((a) => ({ kind: a.kind, title: a.title, yearlyImpact: r0(a.yearlyImpact) })),
    };
  },
};

const getGoals: AgentTool = {
  label: 'checkedgoals',
  decl: {
    name: 'get_goals',
    description: 'Savings goals (target, saved, due month, plan ETA, on track, extra per month needed) and the emergency fund (saved, target, ETA) at today\'s surplus.',
  },
  run() {
    const s = useStore.getState();
    const base = baseline();
    const p = project(base);
    const goals = s.goals.filter((g) => !g.archived).map((g) => {
      const saved = goalSaved(g);
      const f = goalFeasibility(base, { id: g.id, target: g.target, saved, dueDate: g.dueDate });
      return {
        id: g.id, name: g.name, target: r0(g.target), saved: r0(saved), remaining: r0(f.remaining), due: f.due,
        eta: etaLabel(f.eta), onTrack: f.onTrack, neededPerMonth: r0(f.needMonthly), extraPerMonth: r0(f.extraMonthly),
      };
    });
    return {
      monthlySurplus: r0(p.monthlySurplus),
      emergencyFund: { saved: r0(base.emergencyFund), target: r0(base.emergencyTarget), months: s.profile.emergencyMonths, ready: etaLabel(p.emergencyEta) },
      goals,
    };
  },
};

const getProfile: AgentTool = {
  label: 'checkedyour plan',
  decl: {
    name: 'get_profile_summary',
    description: 'The money profile used for planning: monthly income, rent, EMIs, other fixed bills, average flexible spend by category, monthly surplus, emergency fund.',
  },
  run() {
    const s = useStore.getState();
    const base = baseline();
    const p = project(base);
    const flex = (Object.entries(base.categorySpend) as [CategoryId, number | undefined][])
      .map(([k, v]) => ({ category: k, label: category(k).label, perMonth: r0(v ?? 0) }))
      .filter((x) => x.perMonth > 0)
      .sort((a, b) => b.perMonth - a.perMonth)
      .slice(0, 8);
    return {
      monthlyIncome: r0(base.monthlyIncome), irregularIncome: s.profile.irregularIncome,
      rent: r0(base.rent), emis: r0(base.emis), otherFixed: r0(base.otherFixed),
      flexiblePerMonth: r0(p.monthlySpend - base.rent - base.emis - base.otherFixed),
      flexibleByCategory: flex,
      monthlySurplus: r0(p.monthlySurplus),
      emergencyFund: r0(base.emergencyFund), emergencyTarget: r0(base.emergencyTarget),
    };
  },
};

const getIdeas: AgentTool = {
  label: 'checkedSave more',
  decl: {
    name: 'get_save_more_ideas',
    description: 'Ways to save found in the user\'s own spending (each with monthly and yearly saving) and categories running ahead of their budget pace this month.',
  },
  run() {
    const s = useStore.getState();
    const today = todayISO();
    const ideas = withAmountsShown(() =>
      savingIdeas({ txns: s.txns, settings: s.settings, profile: s.profile, checkIns: s.checkIns, dismissedAlerts: s.dismissedAlerts, checkInShown: s.checkInShown }, today),
    );
    const off = drifts(s.txns, s.settings.budgets, s.profile, today).filter((d) => d.meaningful).slice(0, 3);
    return {
      totalMonthly: r0(ideas.reduce((a, i) => a + i.monthly, 0)),
      ideas: ideas.slice(0, 6).map((i) => ({ id: i.id, kind: i.kind, title: i.title, monthly: r0(i.monthly), yearly: r0(i.yearly), whatIf: i.ask ?? null })),
      offPlan: off.map((d) => ({ category: d.category, label: category(d.category).label, spent: r0(d.spent), expectedByToday: d.expectedByToday, overPace: r0(Math.max(0, d.spent - d.expectedByToday)), budget: r0(d.budget) })),
    };
  },
};

/** Before/after of a set of adjustments (raw numbers). */
function scenarioFacts(adjustments: Adjustment[]): Record<string, unknown> {
  const base = baseline();
  const now = project(base);
  const then = project(base, adjustments);
  return {
    changes: withAmountsShown(() => adjustments.map(describeAdjustment)),
    monthlySurplus: { now: r0(now.monthlySurplus), then: r0(then.monthlySurplus) },
    monthlySpend: { now: r0(now.monthlySpend), then: r0(then.monthlySpend) },
    emergencyFundReady: { now: etaLabel(now.emergencyEta), then: etaLabel(then.emergencyEta) },
    emergencyFundSaved: r0(base.emergencyFund),
    emergencyTarget: r0(base.emergencyTarget),
    goals: base.goals.map((g) => ({ name: g.name, now: etaLabel(now.goalEta[g.id] ?? null), then: etaLabel(then.goalEta[g.id] ?? null) })),
    savingsIn12Months: { now: r0(now.savingsPath[11] ?? 0), then: r0(then.savingsPath[11] ?? 0) },
  };
}

const runWhatIf: AgentTool = {
  label: 'ran what-if',
  decl: {
    name: 'run_what_if',
    description:
      'Models a hypothetical change on the device and returns before/after surplus, emergency-fund and goal ETAs. ' +
      'One short English sentence, e.g. "spend ₹30,000 in 2027-03", "cut food by 20%", "rent goes up ₹5,000", "cancel Netflix", "income drops 10%".',
    parameters: { type: 'object', properties: { sentence: { type: 'string' } }, required: ['sentence'] },
  },
  async run(args) {
    const sentence = str(args, 'sentence', { min: 3, max: 200 });
    if (isBad(sentence)) return sentence;
    if (isPickRequest(sentence)) return bad('Bachat does not model specific investments.');
    const adjustments = await parseWhatIf(sentence);
    if (!adjustments.length) return bad('Could not turn that into a change. Try a simpler sentence.');
    return scenarioFacts(adjustments);
  },
};

// ------------------------------------------------------------------ write tools (proposals only)

function proposed(ctx: ToolContext, action: Omit<PendingAction, 'id'>, facts: Record<string, unknown>): Record<string, unknown> {
  ctx.pending.push({ id: uid('pa_'), ...action });
  return { ...facts, status: 'proposed', note: 'Shown to the user with Confirm / Cancel. It is NOT done yet — do not say it is done.' };
}

function dueDate(raw: string, today: string): string | undefined | Bad {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-(\d{2}))?$/);
  if (!m) return bad('"due" must be yyyy-mm or yyyy-mm-dd.');
  const iso = m[3] ? raw : `${m[1]}-${m[2]}-28`;
  if (iso <= today) return bad('"due" must be in the future.');
  if (Number(m[1]) > Number(today.slice(0, 4)) + 30) return bad('"due" is too far away.');
  return iso;
}

const addGoal: AgentTool = {
  label: 'drafted a goal',
  write: true,
  decl: {
    name: 'add_goal',
    description: 'Proposes a new savings goal. The user must confirm. due = target month (yyyy-mm), optional.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, amount: { type: 'number', description: 'Target in rupees.' }, due: { type: 'string', description: 'yyyy-mm' } },
      required: ['name', 'amount'],
    },
  },
  run(args, ctx) {
    const today = todayISO();
    const name = str(args, 'name', { min: 2, max: 40 });
    if (isBad(name)) return name;
    if (isPickRequest(name)) return bad('Goals cannot name an investment.');
    const amount = num(args, 'amount', 500, 100000000);
    if (isBad(amount)) return amount;
    const dueRaw = str(args, 'due', { optional: true, max: 10 });
    if (isBad(dueRaw)) return dueRaw;
    const due = dueDate(dueRaw, today);
    if (isBad(due)) return due;
    const s = useStore.getState();
    const id = uid('g_');
    const goal: Goal = {
      id, name, emoji: '🎯', target: amount, dueDate: due,
      priority: s.goals.reduce((m, g) => Math.max(m, g.priority), 0) + 1,
      archived: false, createdAt: new Date().toISOString(), contributions: [],
    };
    return proposed(ctx, {
      title: `Add goal: ${name}`,
      detail: `${money(amount)}${due ? ` by ${etaLabel(due.slice(0, 7))}` : ''}`,
      run: () => useStore.getState().upsertGoal({ ...goal, createdAt: new Date().toISOString() }),
      undo: () => useStore.getState().removeGoal(id),
    }, { goal: name, amount, due: due ?? null });
  },
};

const setBudget: AgentTool = {
  label: 'drafted a budget',
  write: true,
  decl: {
    name: 'set_budget',
    description: 'Proposes a monthly budget for one spend category. The user must confirm.',
    parameters: {
      type: 'object',
      properties: { category: { type: 'string', enum: SPEND_IDS }, amount: { type: 'number', description: 'Rupees per month.' } },
      required: ['category', 'amount'],
    },
  },
  run(args, ctx) {
    const cat = spendCategory(args, 'category', false);
    if (isBad(cat)) return cat;
    if (!cat) return bad('"category" is required.');
    const amount = num(args, 'amount', 100, 1000000);
    if (isBad(amount)) return amount;
    const s = useStore.getState();
    const today = todayISO();
    const line = budgetLines(s.txns, s.settings.budgets, s.profile, today.slice(0, 7), today).find((l) => l.category === cat);
    const before = s.settings.budgets[cat];
    const label = category(cat).label;
    return proposed(ctx, {
      title: `${label} budget ${money(amount)}/mo`,
      detail: line ? `Now ${money(line.budget)} · ${money(line.spent)} spent` : 'New budget',
      run: () => {
        const b = useStore.getState().settings.budgets;
        useStore.getState().setSettings({ budgets: { ...b, [cat]: amount } });
      },
      undo: () => {
        const next = { ...useStore.getState().settings.budgets };
        if (before == null) delete next[cat];
        else next[cat] = before;
        useStore.getState().setSettings({ budgets: next });
      },
    }, { category: cat, amount, currentBudget: line ? r0(line.budget) : null, spentThisMonth: line ? r0(line.spent) : null });
  },
};

const addRule: AgentTool = {
  label: 'drafted a rule',
  write: true,
  decl: {
    name: 'add_rule',
    description: 'Proposes a rule: always file this merchant under a category (past and future rows). The merchant must appear in the user\'s transactions. The user must confirm.',
    parameters: {
      type: 'object',
      properties: { merchant: { type: 'string' }, category: { type: 'string', enum: [...SPEND_IDS, 'income', 'transfer', 'investment'] } },
      required: ['merchant', 'category'],
    },
  },
  run(args, ctx) {
    const merchant = str(args, 'merchant', { min: 2, max: 60 });
    if (isBad(merchant)) return merchant;
    const rawCat = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
    if (!isCategoryId(rawCat)) return bad('"category" must be a category id.');
    const cat: CategoryId = rawCat;
    const key = merchantKey(merchant);
    const txns = useStore.getState().txns;
    const hits = key ? txns.filter((t) => merchantKey(t.merchant) === key) : [];
    const loose = hits.length ? hits : key ? txns.filter((t) => merchantKey(t.merchant).includes(key)) : [];
    if (!loose.length) return bad(`No transactions from "${merchant}" found.`);
    const latest = loose[0];
    const name = displayName(latest.merchant) || latest.merchant;
    const label = category(cat).label;
    let logId: string | undefined;
    let ruleId: string | undefined;
    return proposed(ctx, {
      title: `Always ${name} → ${label}`,
      detail: `${loose.length} transaction${loose.length === 1 ? '' : 's'} now`,
      run: () => {
        const still = useStore.getState().txns.find((t) => t.id === latest.id);
        if (still) {
          learnCorrection(still.id, cat, 'merchant');
          logId = useStore.getState().learnLog[useStore.getState().learnLog.length - 1]?.id;
          return;
        }
        // The row is gone: add the rule on its own.
        const rule: Rule = { id: uid('r_'), createdAt: new Date().toISOString(), merchantKey: merchantKey(latest.merchant), scope: 'merchant', category: cat, active: true };
        ruleId = rule.id;
        useStore.getState().addRule(rule);
        useStore.getState().updateTxns(applyRules(useStore.getState().txns, [rule]));
      },
      undo: () => {
        const log = useStore.getState().learnLog;
        if (logId && log[log.length - 1]?.id === logId) undoLast();
        else if (ruleId) useStore.getState().setRules(useStore.getState().rules.filter((r) => r.id !== ruleId));
      },
    }, { merchant: name, category: cat, matchingTransactions: loose.length });
  },
};

const applyLifeChange: AgentTool = {
  label: 'drafted a plan change',
  write: true,
  decl: {
    name: 'apply_life_change',
    description: 'Proposes saving a lasting life change into the money profile (income, rent, EMIs or fixed bills), e.g. "I got a raise of 10%", "rent goes up ₹5,000". The user must confirm.',
    parameters: { type: 'object', properties: { sentence: { type: 'string' } }, required: ['sentence'] },
  },
  async run(args, ctx) {
    const sentence = str(args, 'sentence', { min: 3, max: 200 });
    if (isBad(sentence)) return sentence;
    if (isPickRequest(sentence)) return bad('Bachat does not model specific investments.');
    const adjustments = await parseWhatIf(sentence);
    if (!adjustments.length) return bad('Could not turn that into a change.');
    const next = profileAfter(baseline(), adjustments);
    if (!next) return { ...scenarioFacts(adjustments), error: 'Not a lasting change to income, rent, EMIs or bills — use run_what_if instead.' };
    const prev: ProfileSnapshot = { ...useStore.getState().profile };
    const chips = withAmountsShown(() => adjustments.map(describeAdjustment));
    return proposed(ctx, {
      title: `Update plan: ${adjustments.map(describeAdjustment).join(' · ')}`,
      detail: `Income ${money(next.monthlyIncome)} · fixed ${money(next.rent + next.emis + next.otherFixed)}`,
      run: () => {
        applyReplan(adjustments);
      },
      undo: () => {
        const p = prev;
        useStore.getState().saveProfile({
          monthlyIncome: p.monthlyIncome, irregularIncome: p.irregularIncome, rent: p.rent, emis: p.emis,
          otherFixed: p.otherFixed, emergencyFund: p.emergencyFund, emergencyMonths: p.emergencyMonths,
        });
      },
    }, { changes: chips, newProfile: { monthlyIncome: r0(next.monthlyIncome), rent: r0(next.rent), emis: r0(next.emis), otherFixed: r0(next.otherFixed) }, ...scenarioFacts(adjustments) });
  },
};

const ANSWERS = ['using', 'rarely', 'not_using', 'cancel'] as const;
const ANSWER_LABEL: Record<CheckInAnswer, string> = { using: 'Using', rarely: 'Rarely', not_using: 'Not using', cancel: "I'll cancel" };

const markSubscription: AgentTool = {
  label: 'drafted a check-in',
  write: true,
  decl: {
    name: 'mark_subscription',
    description: 'Proposes recording the user\'s answer for a recurring payment ("still using it?"). recId comes from get_recurring. The user must confirm.',
    parameters: {
      type: 'object',
      properties: { recId: { type: 'string' }, answer: { type: 'string', enum: [...ANSWERS] } },
      required: ['recId', 'answer'],
    },
  },
  run(args, ctx) {
    const recId = str(args, 'recId', { max: 120 });
    if (isBad(recId)) return recId;
    const answer = oneOf(args, 'answer', ANSWERS);
    if (isBad(answer)) return answer;
    const rec = recs().find((r) => r.key === recId) ?? recs().find((r) => r.name.toLowerCase() === recId.toLowerCase());
    if (!rec) return bad('Unknown recId. Call get_recurring for the ids.');
    const key = rec.key;
    const s = useStore.getState();
    const prevRecord: CheckInRecord | undefined = s.checkIns[key];
    const prevShown = s.checkInShown[key];
    return proposed(ctx, {
      title: `${rec.name}: ${ANSWER_LABEL[answer]}`,
      detail: `${money(rec.monthly)}/mo`,
      run: () => useStore.getState().setCheckIn(key, answer),
      undo: () =>
        useStore.setState((st) => {
          const checkIns = { ...st.checkIns };
          if (prevRecord) checkIns[key] = prevRecord;
          else delete checkIns[key];
          const checkInShown = { ...st.checkInShown };
          if (prevShown) checkInShown[key] = prevShown;
          return { checkIns, checkInShown };
        }),
    }, { name: rec.name, answer, monthly: r0(rec.monthly) });
  },
};

// ------------------------------------------------------------------ family (optional module)

const getFamily: AgentTool = {
  label: 'checked family',
  decl: {
    name: 'get_family_summary',
    description: 'The family\'s merged month: combined income, spend, savings rate, top categories, emergency fund vs fixed costs, shared goals, subscriptions paid twice, and each member\'s share. Empty when there is no family.',
  },
  run() {
    const f = familySummary(todayISO());
    if (!f) return { family: false, note: 'No other family member yet (Family → Invite).' };
    return {
      family: true, month: f.month,
      income: r0(f.income), spend: r0(f.spend), savings: r0(f.savings), savingsRatePct: Math.round(f.savingsRate * 100),
      emergencyFund: r0(f.emergencyFund), fixedCostsPerMonth: r0(f.fixedCosts), emergencyMonths: Math.round(f.emergencyMonths * 10) / 10,
      topCategories: f.byCategory.slice(0, 5).map((c) => ({ category: c.category, amount: r0(c.amount), familyBudget: r0(c.budget) })),
      members: f.members.filter((m) => !m.stale).map((m) => ({
        who: m.isMe ? 'you' : m.relation || (m.name.trim().split(/\s+/)[0] ?? 'member'),
        incomeSharePct: Math.round(m.incomeShare * 100), spendSharePct: Math.round(m.spendShare * 100),
      })),
      sharedGoals: f.sharedGoals.map((g) => ({ name: g.name, target: r0(g.target), saved: r0(g.saved), due: g.due ?? null })),
      duplicates: f.duplicates.map((d) => ({ name: d.name, plans: d.members.length, monthly: r0(d.monthly), saving: r0(d.saving) })),
    };
  },
};

// ------------------------------------------------------------------ registry

export const AGENT_TOOLS: AgentTool[] = [
  getOverview, getSpending, getRecurring, getGoals, getProfile, getIdeas, runWhatIf, getFamily,
  addGoal, setBudget, addRule, applyLifeChange, markSubscription,
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.decl.name, t]));

export function toolDeclarations(): FunctionDeclaration[] {
  return AGENT_TOOLS.map((t) => t.decl);
}

/** Runs one tool by name; records its label and every number it returned. Never throws. */
export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `Unknown tool "${name}".` };
  let out: Record<string, unknown>;
  try {
    out = await tool.run(args, ctx);
  } catch {
    out = { error: 'The tool failed on the device.' };
  }
  if (!('error' in out) || !tool.write) {
    if (!ctx.labels.includes(tool.label)) ctx.labels.push(tool.label);
  }
  collect(out, ctx.allowed);
  return out;
}

/** Section the answer should open for the tools that ran. */
export function sectionForTools(names: string[]): 'home' | 'spending' | 'recurring' | 'goals' | 'budgets' | 'transactions' {
  for (const n of names) {
    if (n === 'set_budget') return 'budgets';
    if (n === 'add_goal' || n === 'get_goals' || n === 'run_what_if' || n === 'apply_life_change') return 'goals';
    if (n === 'get_recurring' || n === 'mark_subscription') return 'recurring';
    if (n === 'add_rule') return 'transactions';
    if (n === 'get_spending') return 'spending';
  }
  return 'home';
}
