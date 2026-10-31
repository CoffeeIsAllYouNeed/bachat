/**
 * Monthly review: one deterministic summary of a month (income vs spend,
 * top categories and merchants, subscription changes, cancel candidates,
 * goals, emergency cover, what Bachat learned, three focus areas) and a
 * PDF export (expo-print → expo-sharing; print dialog on the web).
 */

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { CategoryId, CheckInAnswer, RecurringAlert, Txn } from '@/data/types';
import { budgetLines } from '@/engine/budgets';
import { incomeBetween, investedBetween } from '@/engine/cashflow';
import { isCountedSpend, netSpend, spendByCategory } from '@/engine/clean';
import { displayName, merchantKey } from '@/engine/merchant';
import { minISO, monthBounds, monthDays, plusMonths } from '@/engine/periods';
import { detectRecurring, recurringAlerts, yearlyCost } from '@/engine/recurring';
import { rentSummary } from '@/engine/rent';
import { baseline, project } from '@/engine/scenario';
import { money, monthYear, pct, ym as ymOf } from '@/theme/format';
import { reportHtml } from '@/engine/reportHtml';

export interface ReportLine {
  name: string;
  amount: number;
  prev: number;
  /** (amount − prev) / prev; null when prev is 0 */
  change: number | null;
}

export interface MonthlyReport {
  ym: string;
  label: string;
  prevLabel: string;
  /** The month is still running (compared with the same days of last month). */
  partial: boolean;
  /** Last day included */
  to: string;
  income: number;
  spend: number;
  net: number;
  prev: { income: number; spend: number; net: number };
  /** net / income; null without income */
  savingsRate: number | null;
  invested: number;
  topCategories: (ReportLine & { category: CategoryId; emoji: string })[];
  topMerchants: ReportLine[];
  overBudget: { category: CategoryId; name: string; emoji: string; spent: number; budget: number }[];
  subscriptionChanges: RecurringAlert[];
  cancelCandidates: { key: string; name: string; monthly: number; yearly: number; answer: CheckInAnswer }[];
  goals: { id: string; name: string; emoji: string; saved: number; target: number; eta: string | null }[];
  emergency: { fund: number; monthlyNeed: number; monthsCovered: number; targetMonths: number; eta: string | null };
  rulesLearned: { count: number; labels: string[] };
  focus: FocusArea[];
}

/** One focus area: short title, one plain sentence, optional question for the assistant ("Try it ›"). */
export interface FocusArea {
  title: string;
  body: string;
  ask?: string;
}

function change(a: number, b: number): number | null {
  return b > 0 ? (a - b) / b : null;
}

function merchantTotals(txns: Txn[], from: string, to: string): Map<string, { name: string; amount: number }> {
  const out = new Map<string, { name: string; amount: number }>();
  for (const t of txns) {
    if (t.date < from || t.date > to || !isCountedSpend(t)) continue;
    const k = merchantKey(t.merchant) || t.merchant.toLowerCase();
    const cur = out.get(k) ?? { name: displayName(t.merchant), amount: 0 };
    cur.amount += t.amount;
    out.set(k, cur);
  }
  return out;
}

/** Builds the review for a yyyy-mm month from the store (deterministic). */
export function monthlyReport(ym: string): MonthlyReport {
  const s = useStore.getState();
  const txns = s.txns;
  const today = todayISO();
  const cur = ymOf(today);
  const partial = ym === cur;
  const b = monthBounds(ym);
  const to = partial ? minISO(today, b.to) : b.to;
  const prevYm = plusMonths(ym, -1);
  const pb = monthBounds(prevYm);
  const day = Number(to.slice(8, 10));
  const prevTo = partial ? `${prevYm}-${String(Math.min(day, monthDays(prevYm))).padStart(2, '0')}` : pb.to;

  const income = incomeBetween(txns, b.from, to);
  const spend = netSpend(txns, b.from, to);
  const pIncome = incomeBetween(txns, pb.from, prevTo);
  const pSpend = netSpend(txns, pb.from, prevTo);

  // Top categories
  const cats = spendByCategory(txns, b.from, to);
  const pCats = spendByCategory(txns, pb.from, prevTo);
  const topCategories = (Object.keys(cats) as CategoryId[])
    .map((id) => {
      const amount = cats[id] ?? 0;
      const prev = pCats[id] ?? 0;
      const info = category(id);
      return { category: id, name: info.label, emoji: info.emoji, amount, prev, change: change(amount, prev) };
    })
    .filter((r) => r.amount > 0)
    .sort((x, y) => y.amount - x.amount)
    .slice(0, 5);

  // Top merchants
  const m = merchantTotals(txns, b.from, to);
  const pm = merchantTotals(txns, pb.from, prevTo);
  const topMerchants: ReportLine[] = [...m.entries()]
    .map(([k, v]) => {
      const prev = pm.get(k)?.amount ?? 0;
      return { name: v.name, amount: v.amount, prev, change: change(v.amount, prev) };
    })
    .sort((x, y) => y.amount - x.amount)
    .slice(0, 5);

  // Budgets over
  let overBudget: MonthlyReport['overBudget'] = [];
  try {
    overBudget = budgetLines(txns, s.settings.budgets, s.profile, ym, to)
      .filter((l) => l.over && l.budget > 0)
      .map((l) => ({ category: l.category, name: category(l.category).label, emoji: category(l.category).emoji, spent: l.spent, budget: l.budget }));
  } catch {
    overBudget = [];
  }

  // Subscriptions
  let subscriptionChanges: RecurringAlert[] = [];
  let cancelCandidates: MonthlyReport['cancelCandidates'] = [];
  try {
    const recs = detectRecurring(txns, to);
    subscriptionChanges = recurringAlerts(recs, to, []).filter((a) => a.kind !== 'unused');
    cancelCandidates = recs
      .filter((r) => {
        const a = s.checkIns[r.key]?.answer;
        return a === 'not_using' || a === 'cancel';
      })
      .map((r) => ({ key: r.key, name: r.name, monthly: r.monthly, yearly: yearlyCost(r), answer: s.checkIns[r.key].answer }));
  } catch {
    subscriptionChanges = [];
    cancelCandidates = [];
  }

  // Goals + emergency fund (planner)
  let goals: MonthlyReport['goals'] = [];
  let emergency: MonthlyReport['emergency'] = {
    fund: s.profile.emergencyFund, monthlyNeed: 0, monthsCovered: 0, targetMonths: s.profile.emergencyMonths, eta: null,
  };
  try {
    const base = baseline();
    const proj = project(base);
    const monthlyNeed = base.rent + base.emis + base.otherFixed +
      Object.values(base.categorySpend).reduce<number>((a, v) => a + (v ?? 0), 0);
    emergency = {
      fund: base.emergencyFund,
      monthlyNeed,
      monthsCovered: monthlyNeed > 0 ? base.emergencyFund / monthlyNeed : 0,
      targetMonths: s.profile.emergencyMonths,
      eta: proj.emergencyEta,
    };
    const emojiById = new Map(s.goals.map((g) => [g.id, g.emoji]));
    goals = base.goals.map((g) => ({
      id: g.id, name: g.name, emoji: emojiById.get(g.id) ?? '🎯', saved: g.saved, target: g.target, eta: proj.goalEta[g.id] ?? null,
    }));
  } catch {
    // Planner unavailable: goals/emergency stay at simple values.
  }

  const rulesInMonth = s.rules.filter((r) => r.createdAt.slice(0, 7) === ym);
  const labels = s.learnLog.filter((l) => l.at.slice(0, 7) === ym).map((l) => l.label).slice(-5);

  const net = income - spend;
  const report: MonthlyReport = {
    ym,
    label: monthYear(ym),
    prevLabel: monthYear(prevYm),
    partial,
    to,
    income,
    spend,
    net,
    prev: { income: pIncome, spend: pSpend, net: pIncome - pSpend },
    savingsRate: income > 0 ? net / income : null,
    invested: investedBetween(txns, b.from, to),
    topCategories,
    topMerchants,
    overBudget,
    subscriptionChanges,
    cancelCandidates,
    goals,
    emergency,
    rulesLearned: { count: rulesInMonth.length, labels },
    focus: [],
  };
  let rentShare: number | null = null;
  try {
    rentShare = rentSummary(txns, s.profile, to).shareOfIncome;
  } catch {
    rentShare = null;
  }
  report.focus = focusAreas(report, rentShare);
  return report;
}

/** Three educational focus areas, picked by fixed rules in priority order. One plain sentence each. */
function focusAreas(r: MonthlyReport, rentShare: number | null): FocusArea[] {
  const out: FocusArea[] = [];
  const e = r.emergency;
  if (e.monthlyNeed > 0 && e.monthsCovered < e.targetMonths) {
    out.push({
      title: 'Build the emergency fund',
      body: `It covers ${e.monthsCovered.toFixed(1)} of your ${e.targetMonths}-month target; it protects every other goal.`,
      ask: 'When will my emergency fund be full?',
    });
  }
  if (r.savingsRate != null && r.savingsRate < 0.2) {
    out.push({
      title: r.net < 0 ? 'Spend less than you earn' : 'Raise your savings rate',
      body: r.net < 0
        ? `You spent ${money(-r.net)} more than you earned in ${r.label}; start with the biggest flexible category.`
        : `You kept ${pct(r.savingsRate)} of your income; saving about 20% on payday makes it automatic.`,
      ask: 'Where did my money go this month?',
    });
  }
  const riser = r.topCategories.find((c) => c.change != null && c.change > 0.2 && c.amount - c.prev >= 1000 && !category(c.category).fixed);
  if (riser) {
    out.push({
      title: `${riser.name} went up`,
      body: `${money(riser.amount)} vs ${money(riser.prev)} in ${r.prevLabel} (${pct(riser.change ?? 0)} more).`,
      ask: `What if I cut ${riser.name.toLowerCase()} by 20%?`,
    });
  }
  if (r.cancelCandidates.length) {
    const yearly = r.cancelCandidates.reduce((a, c) => a + c.yearly, 0);
    out.push({
      title: 'Cancel what you don\'t use',
      body: `${r.cancelCandidates.map((c) => c.name).join(', ')}: about ${money(yearly)} a year back.`,
      ask: 'Show my subscriptions',
    });
  }
  const priceUp = r.subscriptionChanges.filter((a) => a.kind === 'price' || a.kind === 'trial');
  if (priceUp.length) {
    out.push({
      title: 'Check price changes',
      body: `${priceUp.length} subscription${priceUp.length > 1 ? 's' : ''} changed price or ended a trial this month.`,
      ask: 'Show my subscriptions',
    });
  }
  if (rentShare != null && rentShare > 0.4) {
    out.push({
      title: 'Housing cost is high',
      body: `Rent takes about ${pct(rentShare)} of income; a common guide is 30–40%.`,
      ask: 'How much of my income goes to rent?',
    });
  }
  const fillers: FocusArea[] = [
    { title: 'Match risk to time', body: 'Money needed within about 3 years usually sits in lower-risk options.' },
    { title: 'Review recurring payments', body: 'Scan subscriptions and bills once a month; small charges add up.', ask: 'Show my subscriptions' },
    { title: 'Keep costs low', body: 'Lower expense ratios leave more of long-term growth with you.' },
  ];
  for (const f of fillers) if (out.length < 3) out.push(f);
  return out.slice(0, 3);
}

/** Exports the month's review as a PDF and opens the share sheet (print dialog on web). Returns a message. */
export async function exportReportPdf(ym: string): Promise<string> {
  try {
    const report = monthlyReport(ym);
    const html = reportHtml(report);
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
      return 'Print dialog opened — choose "Save as PDF".';
    }
    const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Bachat review — ${report.label}` });
      return `Review for ${report.label} is ready to share.`;
    }
    return `PDF saved: ${uri}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Couldn't export the PDF (${msg}).`;
  }
}
