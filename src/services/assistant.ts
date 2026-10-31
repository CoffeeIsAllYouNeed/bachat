/**
 * The assistant: one request in, one answer pinned at the top of the right
 * page. Routing is deterministic (src/engine/router.ts), every number comes
 * from the engines, and Gemini only rephrases (through guardOutput) or
 * answers open questions from aggregated numbers. Pick requests are refused
 * with an educational note. Open and multi-step asks go to the agent loop
 * (src/services/agent.ts): Gemini calls on-device tools, writes are only
 * proposed and run after the user taps Confirm. Not persisted.
 */

import { create } from 'zustand';
import { category } from '@/data/categories';
import { todayISO, uid, useStore } from '@/data/store';
import type { Adjustment, AssistantAnswer, CategoryId, CoachVoice, Recurring, SavedScenario } from '@/data/types';
import { budgetLines, monthRange } from '@/engine/budgets';
import { cashFlow, type CashRange } from '@/engine/cashflow';
import { netSpend, spendByCategory } from '@/engine/clean';
import { guardOutput, isPickRequest, REFUSAL } from '@/engine/guard';
import { investmentSummary } from '@/engine/investments';
import { netWorth } from '@/engine/networth';
import { detectRecurring, yearlyCost } from '@/engine/recurring';
import { rentSummary } from '@/engine/rent';
import { savingIdeas } from '@/engine/savings';
import { routeCommand, type Route } from '@/engine/router';
import { addMonths, baseline, describeAdjustment, etaLabel, monthsBetween, project } from '@/engine/scenario';
import { parseWhatIf } from '@/engine/whatif';
import { runAgent } from '@/services/agent';
import type { PendingAction } from '@/services/agentTools';
import { aiAvailable, geminiText, lastGeminiError } from '@/services/gemini';
import { shown } from '@/services/planCoach';
import { dayMonth, money, moneyPlain, monthYear, pct } from '@/theme/format';

/** An answer plus what the agent did: the tool steps line and changes waiting for Confirm. */
export interface AgentAnswer extends AssistantAnswer {
  /** "Checked spending · ran what-if" */
  steps?: string;
  pending?: PendingAction[];
}

export interface AssistantState {
  query: string;
  busy: boolean;
  answer: AgentAnswer | null;
  /** Bumps on every new answer so the shell can navigate. */
  nonce: number;
  run(text: string): Promise<void>;
  dismiss(): void;
  removeAdjustment(i: number): void;
  saveCurrent(): void;
  /** Re-opens a saved scenario in the answer panel (Goals → Saved scenarios). */
  openScenario(s: SavedScenario): void;
  /** Removes a proposed change from the answer and returns it (the panel runs it after Confirm). */
  takePending(id: string): PendingAction | undefined;
}

/** Open or multi-step asks (and asks to change something) go to the agent loop first. */
const AGENT_ASK: RegExp[] = [
  /\b(?:can|could|will) i (?:still |really )?afford\b/,
  /\b(?:and|but) (?:still|also)\b/,
  /\bshould i\b/,
  /\bhelp me\b/,
  /\bplan (?:for|my)\b/,
  /\bhow (?:long|much longer)\b/,
  /\b(?:set|change|make|update|raise|lower|increase|reduce)\b.{0,30}\bbudget\b/,
  /\b(?:add|create|new|start|make|set up)\b.{0,20}\bgoal\b/,
  /\b(?:always|rule)\b.{0,40}\b(?:categori[sz]e|file|put|as|under)\b/,
  /\bmark\b.{0,30}\b(?:using|unused|not using|rarely|cancel\w*)\b/,
  /\b(?:i'?m|i am) (?:not |still |rarely )?using\b/,
  /\b(?:save|apply|update)\b.{0,25}\b(?:profile|plan)\b/,
];

function wantsAgent(text: string): boolean {
  const t = text.toLowerCase();
  return AGENT_ASK.some((re) => re.test(t));
}

const EXAMPLES = '"Where can I save money?", "Am I over budget?", "What if rent goes up ₹5,000?", "Netflix", "What\'s my net worth?", "Monthly review"';

// ------------------------------------------------------------------ voice

/** Closing line per coach voice (wording only; numbers never change). */
const VOICE_CLOSER: Record<CoachVoice, string> = {
  supportive: 'Small changes add up, and you are already looking.',
  straight: '',
  calm: 'No rush. Look at it when you are ready.',
  playful: 'Your future self just high-fived you. 🪙',
};

function withVoice(body: string, voice: CoachVoice): string {
  const closer = VOICE_CLOSER[voice];
  return closer ? `${body} ${closer}` : body;
}

// ------------------------------------------------------------------ scenario text

interface ScenarioParts {
  title: string;
  body: string;
  current: ReturnType<typeof project>;
  scenario: ReturnType<typeof project>;
  allowed: number[];
}

function buildScenario(adjustments: Adjustment[]): ScenarioParts {
  const base = baseline();
  const current = project(base);
  const scenario = project(base, adjustments);
  const diff = scenario.monthlySurplus - current.monthlySurplus;
  const parts: string[] = [];
  if (diff !== 0) {
    parts.push(`${diff > 0 ? 'You keep' : 'You lose'} ${money(Math.abs(diff))} a month: your surplus goes from ${money(current.monthlySurplus)} to ${money(scenario.monthlySurplus)}.`);
  } else {
    parts.push(`Your monthly surplus stays at ${money(scenario.monthlySurplus)}.`);
  }
  if (scenario.monthlySurplus < 0) parts.push(`You would spend ${money(-scenario.monthlySurplus)} more than you earn each month.`);
  if (current.emergencyEta !== scenario.emergencyEta) {
    parts.push(`Emergency fund: ${etaLabel(scenario.emergencyEta)} instead of ${etaLabel(current.emergencyEta)}.`);
  } else if (scenario.emergencyEta) {
    parts.push(`Emergency fund timing stays ${monthYear(scenario.emergencyEta)}.`);
  }
  const moved = base.goals.find((g) => current.goalEta[g.id] !== scenario.goalEta[g.id]);
  if (moved) parts.push(`${moved.name}: ${etaLabel(scenario.goalEta[moved.id] ?? null)} instead of ${etaLabel(current.goalEta[moved.id] ?? null)}.`);

  const allowed: number[] = [current.monthlySurplus, scenario.monthlySurplus, Math.abs(diff), current.monthlySpend, scenario.monthlySpend];
  for (const a of adjustments) {
    if ('amount' in a) allowed.push(Math.abs(a.amount));
    if ('pct' in a) allowed.push(Math.abs(a.pct));
    if (a.kind === 'cancelSub') allowed.push(a.monthly, a.monthly * 12);
  }
  const start = base.startMonth;
  for (const e of [current.emergencyEta, scenario.emergencyEta]) if (e) allowed.push(monthsBetween(start, e));
  return {
    title: adjustments.length ? adjustments.map(describeAdjustment).join(' · ') : 'No changes',
    body: parts.join(' '),
    current,
    scenario,
    allowed,
  };
}

// ------------------------------------------------------------------ per-topic answers

type Info = { title: string; body: string; allowed: number[]; query?: string };

function findRec(recs: Recurring[], term?: string): Recurring | undefined {
  if (!term) return undefined;
  const t = term.toLowerCase();
  return recs.find((r) => r.name.toLowerCase() === t) ?? recs.find((r) => r.name.toLowerCase().includes(t) || t.includes(r.name.toLowerCase()));
}

function cashRangeFor(text: string): { range: CashRange; label: string } {
  const t = text.toLowerCase();
  if (/\b(?:this year|ytd|so far this year|is saal)\b/.test(t)) return { range: 'YTD', label: 'This year so far' };
  if (/\b(?:last year|12 months|past year|1y)\b/.test(t)) return { range: '1Y', label: 'Over the last 12 months' };
  if (/\b(?:3 months|three months|quarter|3m)\b/.test(t)) return { range: '3M', label: 'Over the last 3 months' };
  if (/\b(?:4 weeks|four weeks|last month|30 days)\b/.test(t)) return { range: '4W', label: 'Over the last 4 weeks' };
  return { range: 'MTD', label: 'This month so far' };
}

function infoFor(route: Route, text: string, recs: Recurring[]): Info {
  const s = useStore.getState();
  const today = todayISO();
  const cur = today.slice(0, 7);
  const txns = s.txns;

  switch (route.topic) {
    case 'savings': {
      const ideas = savingIdeas(
        { txns, settings: s.settings, profile: s.profile, checkIns: s.checkIns, dismissedAlerts: s.dismissedAlerts },
        today,
      );
      if (!ideas.length) return { title: 'Nothing to trim right now', body: "You're spending in line with your plan. Nothing to trim right now.", allowed: [] };
      const total = ideas.reduce((a, i) => a + i.monthly, 0);
      const yearly = ideas.reduce((a, i) => a + i.yearly, 0);
      const top = ideas.slice(0, 3);
      return {
        title: `Save up to ${money(total)}/mo`,
        body:
          `${ideas.length} idea${ideas.length === 1 ? '' : 's'} on Home under Save more (${money(yearly)} a year). The biggest:\n` +
          top.map((i) => `• ${i.title} — save ${money(i.monthly)}/mo`).join('\n'),
        allowed: [total, yearly, ideas.length, ...top.map((i) => i.monthly)],
      };
    }
    case 'review': {
      const n = txns.filter((t) => t.needsReview).length;
      return n
        ? { title: `${n} to review`, body: `${n} transaction${n === 1 ? '' : 's'} need a category check. Fix one and Bachat offers to learn a rule for the rest.`, allowed: [n] }
        : { title: 'All caught up', body: 'Nothing needs review right now.', allowed: [] };
    }
    case 'report':
      return { title: `${monthYear(cur)} review`, body: 'Opening your monthly review.', allowed: [] };
    case 'settings':
      return { title: 'Settings', body: 'Opening settings.', allowed: [] };
    case 'budgets': {
      const lines = budgetLines(txns, s.settings.budgets, s.profile, cur, today);
      if (route.category) {
        const l = lines.find((x) => x.category === route.category);
        const label = category(route.category).label;
        if (!l) return { title: `${label} budget`, body: `No ${label.toLowerCase()} spending or budget yet this month.`, allowed: [] };
        return {
          title: `${label}: ${l.over ? `${money(-l.left)} over` : `${money(l.left)} left`}`,
          body: `${money(l.spent)} spent of ${money(l.budget)} this month.`,
          allowed: [l.spent, l.budget, Math.abs(l.left)],
        };
      }
      const budget = lines.reduce((a, l) => a + l.budget, 0);
      const spent = lines.reduce((a, l) => a + l.spent, 0);
      const over = lines.filter((l) => l.over);
      if (!lines.length) return { title: 'No budgets yet', body: 'Add transactions and Bachat suggests budgets from your last 3 months.', allowed: [] };
      if (over.length) {
        const overBy = over.reduce((a, l) => a + (l.spent - l.budget), 0);
        return {
          title: `Over in ${over.length} ${over.length === 1 ? 'category' : 'categories'}`,
          body: `${over.map((l) => category(l.category).label).join(', ')}: ${money(overBy)} over in total. Overall ${money(spent)} spent of ${money(budget)}.`,
          allowed: [overBy, spent, budget, over.length],
        };
      }
      return {
        title: `${money(budget - spent)} left`,
        body: `You're within budget: ${money(spent)} spent of ${money(budget)} this month.`,
        allowed: [budget - spent, spent, budget],
      };
    }
    case 'networth': {
      const nw = netWorth(txns);
      if (!nw.assets && !nw.debts) return { title: 'No balances yet', body: "Balances come from bank SMS 'Avl Bal' lines or statements.", allowed: [] };
      return {
        title: `Net worth ${money(nw.net)}`,
        body: `Assets ${money(nw.assets)}, debts ${money(nw.debts)}. Investments count at cost.`,
        allowed: [nw.net, nw.assets, nw.debts],
      };
    }
    case 'rent': {
      const r = rentSummary(txns, s.profile, today);
      if (!r.monthly) return { title: 'No rent found', body: 'No rent payments yet. Add your rent in Settings → Your money.', allowed: [] };
      const share = r.shareOfIncome != null ? ` That is ${pct(r.shareOfIncome)} of your income.` : '';
      const paid = r.paidThisMonth ? ` Paid ${money(r.paidThisMonth.amount)} on ${dayMonth(r.paidThisMonth.date)}.` : r.nextDue ? ` Next due ${dayMonth(r.nextDue)}.` : '';
      return {
        title: `Rent ${money(r.monthly)}/mo`,
        body: `${r.fyLabel}: ${money(r.fyTotal)} paid so far.${share}${paid}`,
        allowed: [r.monthly, r.fyTotal, r.shareOfIncome ?? 0, r.paidThisMonth?.amount ?? 0],
      };
    }
    case 'cashflow': {
      const { range, label } = cashRangeFor(text);
      const cf = cashFlow(txns, range, today);
      return {
        title: `Net ${money(cf.net)}`,
        body: `${label}: earned ${money(cf.income)}, spent ${money(cf.spend)}, invested ${money(cf.invested)}.`,
        allowed: [cf.net, cf.income, cf.spend, cf.invested],
      };
    }
    case 'subscription': {
      const rec = findRec(recs, route.term);
      if (rec) {
        const yearly = yearlyCost(rec);
        return {
          title: `${rec.name}: ${money(rec.amount)}`,
          body: `${money(rec.monthly)} a month, ${money(yearly)} a year. ${rec.paidThisMonth ? 'Paid this month.' : rec.overdue ? 'Looks overdue.' : `Next on ${dayMonth(rec.nextDate)}.`}`,
          allowed: [rec.amount, rec.monthly, yearly],
          query: rec.name,
        };
      }
      const monthly = recs.reduce((a, r) => a + r.monthly, 0);
      return {
        title: `${recs.length} recurring`,
        body: recs.length ? `${money(monthly)} a month, ${money(monthly * 12)} a year across ${recs.length} recurring payments.` : 'No recurring payments found yet.',
        allowed: [recs.length, monthly, monthly * 12],
      };
    }
    case 'investments': {
      const inv = investmentSummary(txns, today);
      const sipTotal = inv.sips.reduce((a, x) => a + x.monthly, 0);
      return {
        title: `${money(inv.total)} invested`,
        body: `At cost: ${money(inv.thisYear)} this year${inv.sips.length ? `, ${inv.sips.length} SIP${inv.sips.length === 1 ? '' : 's'} totalling ${money(sipTotal)} a month` : ''}. Bachat tracks what you put in. It never tells you what to buy.`,
        allowed: [inv.total, inv.thisYear, sipTotal, inv.sips.length],
      };
    }
    case 'goals': {
      const base = baseline();
      const p = project(base);
      const goalsText = base.goals.map((g) => `${g.name}: ${etaLabel(p.goalEta[g.id] ?? null)}`).join(' · ');
      return {
        title: `Surplus ${money(p.monthlySurplus)}/mo`,
        body: `Emergency fund ready ${etaLabel(p.emergencyEta)}.${goalsText ? ' ' + goalsText + '.' : ' No goals yet.'}`,
        allowed: [p.monthlySurplus],
      };
    }
    case 'transactions': {
      const term = route.term?.trim();
      if (!term) return { title: 'Transactions', body: 'Opening your transactions.', allowed: [] };
      const q = term.toLowerCase();
      const hits = txns.filter((t) => t.merchant.toLowerCase().includes(q) || (t.narration ?? '').toLowerCase().includes(q));
      const total = hits.filter((t) => t.type === 'expense' && !t.excluded).reduce((a, t) => a + t.amount, 0);
      return {
        title: `"${term}"`,
        body: hits.length ? `${hits.length} transaction${hits.length === 1 ? '' : 's'}, ${money(total)} spent in total.` : 'No matching transactions.',
        allowed: [hits.length, total],
        query: term,
      };
    }
    case 'spending': {
      const { from } = monthRange(cur);
      if (route.category) {
        const label = category(route.category).label;
        const now = spendByCategory(txns, from, today)[route.category] ?? 0;
        const prev = monthRange(addMonths(cur, -1));
        const last = spendByCategory(txns, prev.from, prev.to)[route.category] ?? 0;
        return {
          title: `${label}: ${money(now)}`,
          body: `${money(now)} on ${label.toLowerCase()} this month, against ${money(last)} last month.`,
          allowed: [now, last],
        };
      }
      const spent = netSpend(txns, from, today);
      const by = Object.entries(spendByCategory(txns, from, today))
        .filter(([, v]) => (v ?? 0) > 0)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3);
      return {
        title: `${money(spent)} spent`,
        body: `This month so far.${by.length ? ' Biggest: ' + by.map(([k, v]) => `${category(k as CategoryId).label} ${money(v ?? 0)}`).join(', ') + '.' : ''}`,
        allowed: [spent, ...by.map(([, v]) => v ?? 0)],
      };
    }
    default:
      return { title: 'Not sure', body: `Try: ${EXAMPLES}.`, allowed: [] };
  }
}

// ------------------------------------------------------------------ open questions

const SYSTEM =
  'You are Bachat, a calm personal-finance coach inside an Indian budgeting app. Answer in at most 2 short sentences. ' +
  'Use ONLY the numbers given in the facts; never invent or estimate numbers. Rupees with ₹ and Indian grouping. ' +
  'Never name, recommend, rate or compare any specific stock, mutual fund, ETF, crypto coin, IPO, bond or insurance product, ' +
  'never predict markets or returns, never quote prices. You may explain general concepts (emergency fund, diversification, ' +
  'asset allocation, index funds as a category) and suggest talking to a SEBI-registered investment adviser for personal advice.';

async function openQuestion(text: string): Promise<{ title: string; body: string } | null> {
  const s = useStore.getState();
  const today = todayISO();
  const base = baseline();
  const p = project(base);
  const { from } = monthRange(today.slice(0, 7));
  const spent = netSpend(s.txns, from, today);
  const facts: [string, number][] = [
    ['monthly income', base.monthlyIncome],
    ['rent per month', base.rent],
    ['EMIs per month', base.emis],
    ['other fixed bills per month', base.otherFixed],
    ['average flexible spend per month', p.monthlySpend - base.rent - base.emis - base.otherFixed],
    ['monthly surplus', p.monthlySurplus],
    ['spent this month so far', spent],
    ['emergency fund now', base.emergencyFund],
    ['emergency fund target', base.emergencyTarget],
  ];
  const allowed = facts.map(([, v]) => Math.round(v));
  const prompt =
    `Facts (computed on the device): ${facts.map(([k, v]) => `${k} ${moneyPlain(v)}`).join('; ')}. ` +
    `Emergency fund ready: ${etaLabel(p.emergencyEta)}. Question: ${JSON.stringify(text.slice(0, 300))}`;
  const reply = await geminiText(prompt, { agent: 'assistant', system: SYSTEM, temperature: 0.3, timeoutMs: 12000 });
  const safe = reply ? guardOutput(reply.replace(/\s+/g, ' ').trim(), allowed) : null;
  return safe ? { title: 'Here is what I see', body: safe } : null;
}

async function phrase(body: string, voice: CoachVoice, allowed: number[]): Promise<string> {
  const reply = await geminiText(
    `Rewrite as one or two short, friendly sentences in a ${voice} tone for an Indian budgeting app. ` +
      `Keep every number and month exactly as written, add no new numbers, no advice about investments: ${body}`,
    { agent: 'assistant', temperature: 0.4, timeoutMs: 6000, fallback: false },
  );
  if (!reply) return body;
  return guardOutput(reply.replace(/\s+/g, ' ').trim(), allowed) ?? body;
}

// ------------------------------------------------------------------ store

/** The assistant store (not persisted). Every answer bumps `nonce`. */
export const useAssistant = create<AssistantState>()((set, get) => ({
  query: '',
  busy: false,
  answer: null,
  nonce: 0,

  run: async (text: string) => {
    /** True when the last Gemini call failed (busy, offline, bad key) — shown instead of a vague "not sure". */
    const aiBusy = () => !aiAvailable() || !!lastGeminiError;
    const query = text.trim();
    if (!query) return;
    set({ query, busy: true });
    let answer: AgentAnswer;
    try {
      const st = useStore.getState();
      const voice = st.settings.voice;
      const today = todayISO();
      let recs: Recurring[] = [];
      try {
        recs = detectRecurring(st.txns, today);
      } catch {
        recs = [];
      }
      const route = routeCommand(query, { subscriptions: recs.map((r) => r.name) });
      const isPick = route.topic === 'pick' || isPickRequest(query);

      // Agent loop for open questions, multi-step asks and asks to change something.
      // Fast deterministic routes below still answer the common questions (offline / AI busy).
      let agent: AgentAnswer | null = null;
      let agentFailed = false;
      if (!isPick && (route.topic === 'unknown' || wantsAgent(query)) && aiAvailable()) {
        try {
          const r = await runAgent(query);
          if (r) {
            agent = {
              section: r.section, kind: 'info', title: r.title, body: shown(r.body),
              steps: r.steps || undefined, pending: r.pending.length ? r.pending : undefined,
            };
          }
        } catch {
          agentFailed = true;
        }
      }

      // Guardrail first, always: a stock/fund/crypto pick is refused before any AI is involved.
      if (isPick) {
        answer = { section: 'investments', kind: 'refusal', title: "I can't pick investments for you", body: REFUSAL };
      } else if (agent) {
        answer = agent;
      } else if (route.topic === 'whatif') {
        const adjustments = await parseWhatIf(query);
        if (!adjustments.length) {
          answer = {
            section: 'goals',
            kind: 'info',
            title: aiBusy() ? 'AI is busy — basic mode' : "I couldn't turn that into a scenario",
            body: (aiBusy() ? "Google's AI didn't answer just now, so I only understood the simple phrasings. " : '') +
              'Try: "What if I cut food by 20%?", "What if rent goes up ₹5,000?", "What if I cancel Netflix?", "What if I add a SIP of ₹5,000?"',
          };
        } else {
          const sc = buildScenario(adjustments);
          const body = withVoice(await phrase(sc.body, voice, sc.allowed), voice);
          answer = { section: 'goals', kind: 'scenario', title: sc.title, body, adjustments, current: sc.current, scenario: sc.scenario };
        }
      } else if (route.topic === 'unknown') {
        const open = agentFailed ? null : await openQuestion(query);
        answer = open
          ? { section: 'home', kind: 'info', title: open.title, body: open.body }
          : agentFailed || aiBusy()
            ? { section: 'home', kind: 'info', title: 'AI is busy — basic mode', body: `Google's AI didn't answer just now${lastGeminiError ? ` (${lastGeminiError})` : ''}. Your numbers still work — try a direct request: ${EXAMPLES}.` }
            : { section: 'home', kind: 'info', title: "I'm not sure about that one", body: `Try: ${EXAMPLES}.` };
      } else {
        const info = infoFor(route, query, recs);
        const body = route.topic === 'report' || route.topic === 'settings' ? info.body : withVoice(info.body, voice);
        answer = { section: route.section, kind: 'info', title: info.title, body, query: info.query };
      }
    } catch {
      answer = { section: 'home', kind: 'info', title: 'Something went wrong', body: `I couldn't read your data for that. Try: ${EXAMPLES}.` };
    }
    set({ answer, busy: false, nonce: get().nonce + 1 });
  },

  dismiss: () => set({ answer: null, query: '' }),

  takePending: (id: string) => {
    const a = get().answer;
    const p = a?.pending?.find((x) => x.id === id);
    if (!a || !p) return undefined;
    const rest = (a.pending ?? []).filter((x) => x.id !== id);
    set({ answer: { ...a, pending: rest.length ? rest : undefined } });
    return p;
  },

  removeAdjustment: (i: number) => {
    const a = get().answer;
    if (!a || a.kind !== 'scenario' || !a.adjustments) return;
    const adjustments = a.adjustments.filter((_, k) => k !== i);
    try {
      const sc = buildScenario(adjustments);
      set({
        answer: {
          ...a,
          adjustments,
          title: sc.title,
          body: adjustments.length ? withVoice(sc.body, useStore.getState().settings.voice) : 'No changes left. Ask another what-if to add one.',
          current: sc.current,
          scenario: sc.scenario,
        },
      });
    } catch {
      set({ answer: { ...a, adjustments } });
    }
  },

  saveCurrent: () => {
    const a = get().answer;
    if (!a || a.kind !== 'scenario' || !a.adjustments?.length) return;
    useStore.getState().saveScenario({ id: uid('sc_'), name: a.title, createdAt: new Date().toISOString(), adjustments: a.adjustments });
  },

  openScenario: (saved: SavedScenario) => {
    try {
      const sc = buildScenario(saved.adjustments);
      set({
        query: saved.name,
        busy: false,
        answer: {
          section: 'goals', kind: 'scenario', title: sc.title, body: withVoice(sc.body, useStore.getState().settings.voice),
          adjustments: saved.adjustments, current: sc.current, scenario: sc.scenario,
        },
        nonce: get().nonce + 1,
      });
    } catch {
      // ignore: planner unavailable
    }
  },
}));
