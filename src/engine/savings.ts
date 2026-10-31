/**
 * "Save more": deterministic saving ideas found in the user's own data.
 * Every number here is computed on the device from the stored transactions;
 * the AI (src/services/savingsCoach.ts) only explains and orders these ideas.
 *
 * Detectors: price hikes, unused subscriptions, overlapping subscriptions,
 * food delivery, category spikes, small frequent spends, impulse shopping,
 * fees & charges, cabs. Ranked by monthly saving × confidence, deduped,
 * dismissed ideas removed (dismiss ids are stored with dismissAlert).
 */

import { category } from '@/data/categories';
import { useStore } from '@/data/store';
import type { CategoryId, CheckInRecord, Goal, Profile, Recurring, Settings, Txn } from '@/data/types';
import { addMonthsYm, budgetLines, daysInMonth, lastCompleteMonths, monthRange } from '@/engine/budgets';
import { isCountedSpend, netSpend, spendByCategory } from '@/engine/clean';
import { displayName, merchantKey } from '@/engine/merchant';
import { inferProfile } from '@/engine/profile';
import {
  addDaysISO, daysBetween, detectRecurring, likelyUnused, perYear, recurringAlerts, RENEWAL_WARN_DAYS, yearlyCost,
} from '@/engine/recurring';
import { dayMonth, money, monthYear } from '@/theme/format';

export type SavingKind =
  | 'price_hike' | 'unused_sub' | 'overlap_subs' | 'food_delivery' | 'category_spike'
  | 'small_frequent' | 'impulse_shopping' | 'fees' | 'cabs';

export interface SavingEvidence {
  merchant: string;
  count: number;
  amount: number;
}

export interface SavingIdea {
  /** Stable id; dismissed ids are stored with dismissAlert(). */
  id: string;
  kind: SavingKind;
  title: string;
  detail: string;
  /** Rupees a month this idea saves (computed on the device). */
  monthly: number;
  yearly: number;
  /** 0..1 — how sure the detector is that this is a real, avoidable cost. */
  confidence: number;
  evidence: SavingEvidence[];
  /** What-if sentence for the assistant ("What if I cut food by 20%?"). */
  ask?: string;
  category?: CategoryId;
  /** Deterministic one-sentence fix (the fallback when the AI is unavailable). */
  fix: string;
  /** Extra numbers behind the idea (cap per week, average order …) — shown to the AI as facts. */
  meta?: Record<string, number>;
}

export interface SavingsInput {
  txns: Txn[];
  settings: Settings;
  profile: Profile;
  checkIns: Record<string, CheckInRecord>;
  dismissedAlerts: string[];
  /** Check-in shown-without-answer days (store.checkInShown); read from the store when left out. */
  checkInShown?: Record<string, string[]>;
}

// ------------------------------------------------------------------ helpers

function sum(rows: Txn[]): number {
  let s = 0;
  for (const t of rows) s += t.amount;
  return s;
}

/** Savings are shown rounded to ₹10 (₹1 below ₹100). */
function round10(v: number): number {
  if (!isFinite(v) || v <= 0) return 0;
  return v < 100 ? Math.round(v) : Math.round(v / 10) * 10;
}

function round5(v: number): number {
  return Math.round(v / 5) * 5;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function inRange(t: Txn, from: string, to: string): boolean {
  return t.date >= from && t.date <= to;
}

/** Spend rows grouped by display name: count + amount, biggest first. */
function evidenceOf(rows: Txn[], max = 4): SavingEvidence[] {
  const by = new Map<string, SavingEvidence>();
  for (const t of rows) {
    const name = displayName(t.merchant) || t.merchant;
    const e = by.get(name) ?? { merchant: name, count: 0, amount: 0 };
    e.count += 1;
    e.amount += t.amount;
    by.set(name, e);
  }
  return [...by.values()]
    .map((e) => ({ ...e, amount: Math.round(e.amount) }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .slice(0, max);
}

/** Hour of day from the original SMS / statement text ("23:14", "11:05 PM"), or null. */
export function hourOf(t: Txn): number | null {
  const s = t.raw ?? '';
  const m = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] ?? '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h;
}

/** % cut of a monthly amount that gives [saving], rounded to 5, between 5 and 60. */
function cutPct(saving: number, monthlySpend: number): number {
  if (monthlySpend <= 0) return 20;
  return clamp(round5((saving / monthlySpend) * 100), 5, 60);
}

/** The period the monthly detectors look at. */
interface Win {
  ym: string;
  from: string;
  to: string;
  /** Share of the month covered (1 for a complete month). */
  share: number;
  /** 'this month' (from day 8) or 'last month' (days 1–7, too early to judge). */
  label: 'this month' | 'last month';
  /** Complete months before it that have data (the "usual"). */
  base: string[];
}

function pickWindow(txns: Txn[], today: string): Win {
  const cur = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const have = new Set(txns.map((t) => t.date.slice(0, 7)));
  if (day >= 8) {
    return {
      ym: cur, from: `${cur}-01`, to: today, share: Math.min(1, day / daysInMonth(cur)), label: 'this month',
      base: lastCompleteMonths(today, 3).filter((m) => have.has(m)),
    };
  }
  const lm = addMonthsYm(cur, -1);
  const r = monthRange(lm);
  return {
    ym: lm, from: r.from, to: r.to, share: 1, label: 'last month',
    base: [1, 2, 3].map((i) => addMonthsYm(lm, -i)).filter((m) => have.has(m)),
  };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// ------------------------------------------------------------------ merchant groups

const DELIVERY = /\b(?:swiggy|zomato|eatsure|box8|faasos|behrouz|dominos|domino|pizza hut|mcdonald\w*|kfc|burger king|magicpin|eatfit|ovenstory|rasoi express)\b/;
const CABS = /\b(?:uber|ola|olacabs|ani technologies|rapido|blusmart|namma yatri|meru|indrive|quick ride)\b/;
const COFFEE = /\b(?:coffee|cafe|chai|chaayos|chai point|starbucks|third wave|blue tokai|ccd|cafe coffee day|tea)\b/;
const SNACKS = /\b(?:snacks?|bakery|sweets|haldiram|chaat|samosa|vada pav|momos?|juice|theobroma)\b/;
const FEES = /\b(?:charges?|late (?:payment )?fees?|penalty|penal|overdue interest|finance charges?|gst on (?:charges|fees?)|annual (?:fees?|charges?)|joining fee|min(?:imum)? (?:avg |average |monthly )?bal(?:ance)?|non[- ]maintenance|cheque (?:return|bounce)|ecs (?:return|bounce)|nach (?:return|bounce)|bounce charges?)\b/i;
/** Purchase categories where "charges" in a narration is part of the order, not a bank fee. */
const NOT_FEE_CATS = new Set<CategoryId>(['food', 'groceries', 'shopping', 'travel', 'entertainment', 'rent', 'education', 'health']);

function isDelivery(t: Txn): boolean {
  if (t.category !== 'food' || !isCountedSpend(t)) return false;
  const k = merchantKey(t.merchant);
  if (/instamart/.test(k)) return false;
  return DELIVERY.test(k) || /\b(?:food order|delivery)\b/i.test(t.narration ?? '');
}

function isCab(t: Txn): boolean {
  return isCountedSpend(t) && CABS.test(merchantKey(t.merchant));
}

/** Subscription groups that overlap (one is usually enough). */
const OVERLAP_GROUPS: { id: string; label: string; members: [string, RegExp, string?][] }[] = [
  {
    id: 'video', label: 'video streaming',
    members: [
      ['netflix', /netflix/, 'Netflix'],
      // "Amazon Prime", "Prime Video", "Amazon Prime Video", "AMZN PRIME", "PRIMEVIDEO" → one service
      ['prime', /prime ?video|(?:amazon|amzn) ?prime|^prime$/, 'Prime Video'],
      ['hotstar', /hotstar|disney/], ['sonyliv', /sony ?liv/], ['zee5', /zee ?5/], ['jiocinema', /jio ?cinema/],
    ],
  },
  {
    id: 'music', label: 'music',
    members: [['youtube', /youtube/], ['spotify', /spotify/], ['gaana', /gaana/], ['saavn', /saavn/], ['applemusic', /apple music|itunes/]],
  },
];

/** Categories whose recurring amounts naturally vary: a higher latest charge is not a price hike. */
const VARIABLE_CATS = new Set<CategoryId>(['food', 'groceries', 'shopping', 'transport', 'travel', 'personal', 'other']);

function cadenceWord(r: Recurring): string {
  return r.cadence === 'weekly' ? 'week' : r.cadence === 'quarterly' ? 'quarter' : r.cadence === 'yearly' ? 'year' : 'month';
}

// ------------------------------------------------------------------ detectors

function subscriptionIdeas(recs: Recurring[], input: SavingsInput, today: string): SavingIdea[] {
  const out: SavingIdea[] = [];
  const alerts = recurringAlerts(recs, today, []);
  const unusedKeys = new Set<string>();

  // 2. Unused: the check-in said "not using" / "cancel", "rarely" two months in a row, or the
  //    check-in was ignored twice — and it is still charging. A yearly plan renewing within
  //    7 days becomes a "renews soon" idea instead.
  let shown = input.checkInShown;
  if (!shown) {
    try {
      shown = useStore.getState().checkInShown;
    } catch {
      shown = {};
    }
  }
  for (const r of recs) {
    if (r.overdue) continue; // no charge since: probably cancelled already
    const ci = input.checkIns[r.key];
    const said = ci && (ci.answer === 'not_using' || ci.answer === 'cancel') ? ci.answer : null;
    const lu = said ? null : likelyUnused(r, input.checkIns, shown, today);
    const likely = lu ?? (ci?.answer === 'rarely' ? 'rarely' : null);
    const daysToRenew = r.cadence === 'yearly' ? daysBetween(today, r.nextDate) : -1;
    const renewing = daysToRenew >= 0 && daysToRenew <= RENEWAL_WARN_DAYS;
    // A single "Rarely" answer only counts when a yearly charge is about to renew.
    const strong = said ?? lu;
    if (!strong && !(renewing && likely)) continue;
    const yearly = yearlyCost(r);
    unusedKeys.add(r.key);
    const when = daysToRenew === 0 ? 'today' : daysToRenew === 1 ? 'tomorrow' : `in ${daysToRenew} days`;
    out.push({
      id: renewing ? `save:renewal:${r.key}:${r.nextDate}` : `save:unused:${r.key}`,
      kind: 'unused_sub',
      title: renewing
        ? `${r.name} renews ${when}`
        : said === 'cancel'
          ? `${r.name} is still charging after you chose to cancel`
          : said === 'not_using'
            ? `${r.name}: you said you're not using it`
            : likely === 'rarely'
              ? `${r.name}: used rarely`
              : `${r.name}: still using it?`,
      detail: renewing
        ? `${money(r.amount)} on ${dayMonth(r.nextDate)} for another year.`
        : `${money(r.amount)} every ${cadenceWord(r)}, last charged ${dayMonth(r.lastDate)}. That's ${money(yearly)} a year.`,
      monthly: Math.round(r.monthly),
      yearly,
      confidence: said ? 0.95 : renewing ? 0.85 : likely === 'rarely' ? 0.75 : 0.5,
      evidence: [{ merchant: r.name, count: r.history.length, amount: Math.round(r.history.reduce((a, h) => a + h.amount, 0)) }],
      ask: `What if I cancel ${r.name}?`,
      category: r.category,
      fix: renewing
        ? `Cancel ${r.name} before ${dayMonth(r.nextDate)} to save ${money(yearly)}.`
        : `Cancel ${r.name} in its app or account settings before the next charge on ${dayMonth(r.nextDate)}.`,
    });
  }

  // 2b. A trial that turned into a paid plan (nobody has said they use it).
  for (const a of alerts) {
    if (a.kind !== 'trial' || unusedKeys.has(a.key)) continue;
    const r = recs.find((x) => x.key === a.key);
    if (!r || r.overdue) continue;
    const ci = input.checkIns[r.key];
    if (ci && ci.answer === 'using') continue;
    const first = r.history[0];
    const yearly = yearlyCost(r);
    unusedKeys.add(r.key);
    out.push({
      id: `save:trial:${r.key}`,
      kind: 'unused_sub',
      title: `${r.name} trial became ${money(r.amount)} a ${cadenceWord(r)}`,
      detail: `It started at ${money(first.amount)} on ${dayMonth(first.date)} and now costs ${money(yearly)} a year.`,
      monthly: Math.round(r.monthly),
      yearly,
      confidence: 0.5,
      evidence: [{ merchant: r.name, count: r.history.length, amount: Math.round(r.history.reduce((s, h) => s + h.amount, 0)) }],
      ask: `What if I cancel ${r.name}?`,
      category: r.category,
      fix: `If you signed up only for the trial, cancel ${r.name} before ${dayMonth(r.nextDate)}.`,
    });
  }

  // 1. Price hikes on a recurring payment.
  for (const a of alerts) {
    if (a.kind !== 'price' || a.yearlyImpact <= 0 || unusedKeys.has(a.key)) continue;
    const r = recs.find((x) => x.key === a.key);
    if (!r || r.history.length < 2) continue;
    // Variable spends (groceries, shopping, an electricity bill …) change every month:
    // only a step change on an otherwise fixed price counts as a price hike.
    if (VARIABLE_CATS.has(r.category)) continue;
    const h = r.history;
    const prev = h[h.length - 2];
    const latest = h[h.length - 1];
    const earlier = h.slice(0, -1).filter((x) => x.amount > 10); // ignore ₹1–₹10 trial charges
    if (!earlier.length || earlier.some((x) => Math.abs(x.amount - prev.amount) > prev.amount * 0.03)) continue;
    const step = Math.round(latest.amount - prev.amount);
    if (step <= 0) continue;
    const monthly = Math.round((step * perYear(r.cadence)) / 12);
    const yearly = Math.round(step * perYear(r.cadence));
    const isSub = r.category === 'subscriptions' || r.category === 'entertainment';
    out.push({
      id: `save:price:${r.key}:${latest.date}`,
      kind: 'price_hike',
      title: `${r.name} went up ${money(step)} a ${cadenceWord(r)}`,
      detail: `${money(prev.amount)} → ${money(latest.amount)} from ${dayMonth(latest.date)}. That's ${money(yearly)} more a year.`,
      monthly,
      yearly,
      confidence: 0.8,
      evidence: [{ merchant: r.name, count: h.length, amount: Math.round(latest.amount) }],
      ask: isSub ? `What if I cancel ${r.name}?` : undefined,
      category: r.category,
      fix: isSub
        ? `Move ${r.name} to a cheaper plan, share a family plan, or cancel it if you rarely use it.`
        : `Ask ${r.name} about the new price, or compare a cheaper option before the next charge.`,
    });
  }

  // 3. Overlapping subscriptions in the same group.
  for (const g of OVERLAP_GROUPS) {
    const members: Recurring[] = [];
    const label = new Map<Recurring, string>();
    const seen = new Set<string>();
    for (const r of recs) {
      if (r.overdue || unusedKeys.has(r.key)) continue;
      const k = r.key;
      const hit = g.members.find(([, re]) => re.test(k) || re.test(r.name.toLowerCase()));
      if (!hit || seen.has(hit[0])) continue;
      seen.add(hit[0]);
      members.push(r);
      label.set(r, hit[2] ?? r.name);
    }
    if (members.length < 2) continue;
    const yt = g.id === 'music' ? members.find((r) => /youtube/.test(r.key)) : undefined;
    const sorted = [...members].sort((a, b) => b.monthly - a.monthly);
    const keep = yt ?? sorted[0];
    const drop = sorted.filter((r) => r !== keep);
    const monthly = Math.round(drop.reduce((s, r) => s + r.monthly, 0));
    if (monthly <= 0) continue;
    // Title in a stable order ("Netflix + Prime Video"), the one to keep first.
    const names = [keep, ...drop].map((r) => label.get(r) ?? r.name);
    const total = Math.round(members.reduce((s, r) => s + r.monthly, 0));
    out.push({
      id: `save:overlap:${g.id}:${drop.map((r) => r.key).sort().join('+')}`,
      kind: 'overlap_subs',
      title: names.join(' + '),
      detail: yt
        ? `${keep.name} already includes ad-free music. ${plural(members.length, 'music plan')} cost ${money(total)} a month together.`
        : `${plural(members.length, 'video app')} cost ${money(total)} a month together. Keeping ${names[0]} alone saves ${money(monthly)} a month.`,
      monthly,
      yearly: monthly * 12,
      confidence: 0.6,
      evidence: [keep, ...drop].map((r) => ({ merchant: r.name, count: r.history.length, amount: Math.round(r.amount) })),
      ask: `What if I cancel ${drop.map((r) => r.name).join(' and ')}?`,
      category: 'subscriptions',
      fix: `Keep one: keep ${names[0]} and cancel ${names.slice(1).join(' and ')}; rejoin for a month when something you want comes out.`,
    });
  }
  return out;
}

function foodDeliveryIdea(txns: Txn[], w: Win): SavingIdea | null {
  const rows = txns.filter((t) => inRange(t, w.from, w.to) && isDelivery(t));
  const count = rows.length;
  if (count < 4) return null;
  const amount = sum(rows);
  const avgOrder = amount / count;
  const projected = count / w.share;
  const baseCounts = w.base.map((m) => {
    const r = monthRange(m);
    return txns.filter((t) => inRange(t, r.from, r.to) && isDelivery(t)).length;
  });
  const usual = avg(baseCounts);
  const up = usual > 0 ? projected / usual - 1 : null;
  const elevated = up != null && up >= 0.15;
  if (!elevated && projected < 10) return null;

  const weeks = daysInMonth(w.ym) / 7;
  const capWeek = Math.max(1, Math.floor((elevated ? usual : projected * 0.7) / weeks));
  const capMonth = capWeek * weeks;
  const monthly = round10(Math.max(0, projected - capMonth) * avgOrder);
  if (monthly < 300) return null;

  const late = rows.filter((t) => {
    const h = hourOf(t);
    return h != null && (h >= 22 || h < 4);
  }).length;
  const usualByNow = Math.round(usual * w.share);
  const partial = w.share < 1;
  const title = usual > 0
    ? `Food delivery: ${count} orders ${partial ? 'so far' : w.label} vs ${usualByNow} usual${partial ? ' by now' : ''}`
    : `Food delivery: ${count} orders ${partial ? 'so far this month' : w.label}`;
  const food = (spendByCategory(txns, w.from, w.to).food ?? 0) / w.share;
  return {
    id: `save:food:${w.ym}`,
    kind: 'food_delivery',
    title,
    detail: `Average order ${money(avgOrder)}${late ? `, ${late} after 10 PM` : ''}. ${money(amount)} on delivery ${partial ? 'so far' : w.label}.`,
    monthly,
    yearly: monthly * 12,
    confidence: elevated ? 0.75 : 0.55,
    evidence: evidenceOf(rows),
    ask: `What if I cut food by ${cutPct(monthly, food)}%?`,
    category: 'food',
    fix: `Cap delivery at ${plural(capWeek, 'order')} a week and plan simple meals for the other nights.`,
    meta: { orders: count, usualOrders: usualByNow, averageOrder: Math.round(avgOrder), lateNightOrders: late, capPerWeek: capWeek },
  };
}

const SPIKE_CATS: CategoryId[] = ['shopping', 'entertainment', 'food', 'transport', 'personal'];
const SPIKE_FIX: Partial<Record<CategoryId, string>> = {
  shopping: 'Keep a wishlist and buy on one fixed day a month, after a 48-hour wait.',
  entertainment: 'Pick one paid outing a week and look for free plans for the rest.',
  food: 'Cook two more dinners at home each week and carry lunch twice.',
  transport: 'Club errands into one trip and use the metro or bus for regular routes.',
  personal: 'Space out salon visits and skip the add-ons this month.',
};

function categorySpikes(input: SavingsInput, w: Win, today: string): SavingIdea[] {
  const { txns } = input;
  const now = spendByCategory(txns, w.from, w.to);
  const baseBy = w.base.map((m) => {
    const r = monthRange(m);
    return spendByCategory(txns, r.from, r.to);
  });
  let lines: ReturnType<typeof budgetLines> = [];
  try {
    lines = budgetLines(txns, input.settings.budgets, input.profile, w.ym, today);
  } catch {
    lines = [];
  }
  const out: SavingIdea[] = [];
  for (const cat of SPIKE_CATS) {
    const spent = now[cat] ?? 0;
    if (spent <= 0) continue;
    const usual = avg(baseBy.map((b) => b[cat] ?? 0));
    const expected = usual * w.share;
    const ratio = expected > 0 ? spent / expected : 0;
    const budget = lines.find((l) => l.category === cat)?.budget ?? 0;
    const hot = usual > 0 && ratio >= 1.25;
    const overBudget = budget > 0 && (spent > budget || spent > budget * w.share * 1.15);
    if (!hot && !overBudget) continue;
    const projected = spent / w.share;
    const ref = hot ? usual : budget;
    const monthly = round10(projected - ref);
    if (monthly < 400) continue;
    const label = category(cat).label;
    const partial = w.share < 1;
    const pctUp = Math.round((ratio - 1) * 100);
    const rows = txns.filter((t) => inRange(t, w.from, w.to) && isCountedSpend(t) && t.category === cat);
    out.push({
      id: `save:spike:${cat}:${w.ym}`,
      kind: 'category_spike',
      title: hot ? `${label} ${pctUp}% above usual` : `${label} is over budget`,
      detail: hot
        ? partial
          ? `${money(spent)} so far vs about ${money(expected)} by now in a usual month.`
          : `${money(spent)} ${w.label} vs ${money(usual)} in a usual month.`
        : `${money(spent)} ${partial ? 'so far' : w.label} against a ${money(budget)} budget.`,
      monthly,
      yearly: monthly * 12,
      confidence: hot && overBudget ? 0.75 : hot ? 0.65 : 0.55,
      evidence: evidenceOf(rows),
      ask: `What if I cut ${label.toLowerCase()} by ${cutPct(monthly, projected)}%?`,
      category: cat,
      fix: SPIKE_FIX[cat] ?? `Set a ${label.toLowerCase()} limit for the rest of the month.`,
      meta: { spent: Math.round(spent), usual: Math.round(usual), expectedByNow: Math.round(expected), budget: Math.round(budget), percentAbove: pctUp, projected: Math.round(projected) },
    });
  }
  return out;
}

function smallFrequentIdeas(txns: Txn[], today: string): SavingIdea[] {
  const from = addDaysISO(today, -29);
  const groups = new Map<string, { label: string; rows: Txn[] }>();
  for (const t of txns) {
    if (!inRange(t, from, today) || !isCountedSpend(t) || t.amount >= 300) continue;
    if (isCab(t) || isDelivery(t)) continue; // their own detectors
    if (t.category === 'rent' || t.category === 'emi' || t.category === 'bills' || t.category === 'subscriptions') continue;
    const k = merchantKey(t.merchant);
    if (!k) continue;
    let gk = k;
    let label = displayName(t.merchant);
    if (COFFEE.test(k)) {
      gk = 'kind:coffee';
      label = 'Coffee & chai';
    } else if (SNACKS.test(k)) {
      gk = 'kind:snacks';
      label = 'Snacks';
    }
    const g = groups.get(gk) ?? { label, rows: [] };
    g.rows.push(t);
    groups.set(gk, g);
  }
  const out: SavingIdea[] = [];
  const ym = today.slice(0, 7);
  for (const [gk, g] of groups) {
    const n = g.rows.length;
    if (n < 8) continue;
    const total = sum(g.rows);
    const monthly = round10(total / 2);
    if (monthly < 150) continue;
    const cats = new Map<CategoryId, number>();
    for (const t of g.rows) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    const cat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const catMonthly = spendByCategory(txns, from, today)[cat] ?? total;
    const kind = gk.startsWith('kind:');
    out.push({
      id: `save:small:${gk}:${ym}`,
      kind: 'small_frequent',
      title: `${g.label}: ${n} small spends in 30 days`,
      detail: `${money(total)} in all, about ${money(total / n)} each.`,
      monthly,
      yearly: monthly * 12,
      confidence: 0.55,
      evidence: evidenceOf(g.rows),
      ask: SPIKE_CATS.includes(cat) || cat === 'groceries' ? `What if I cut ${category(cat).label.toLowerCase()} by ${cutPct(monthly, catMonthly)}%?` : undefined,
      category: cat,
      fix: kind && gk === 'kind:coffee'
        ? 'Halve the café runs: make coffee or chai at home on weekdays and keep the café for weekends.'
        : `Halve these: set a weekly count for ${g.label} and stop once it's used.`,
      meta: { times: n, averageSpend: Math.round(total / n), total: Math.round(total) },
    });
  }
  return out;
}

function cabsIdea(txns: Txn[], today: string): SavingIdea | null {
  const from = addDaysISO(today, -29);
  const rows = txns.filter((t) => inRange(t, from, today) && isCab(t));
  if (rows.length < 8) return null;
  const short = rows.filter((t) => t.amount <= 400).length;
  if (short < 6) return null;
  const total = sum(rows);
  const monthly = round10(total * 0.3);
  if (monthly < 200) return null;
  const transport = spendByCategory(txns, from, today).transport ?? total;
  return {
    id: `save:cabs:${today.slice(0, 7)}`,
    kind: 'cabs',
    title: `Cabs: ${rows.length} rides in 30 days`,
    detail: `${money(total)} on cabs, ${short} of the rides under ${money(400)}.`,
    monthly,
    yearly: monthly * 12,
    confidence: 0.6,
    evidence: evidenceOf(rows),
    ask: `What if I cut transport by ${cutPct(monthly, transport)}%?`,
    category: 'transport',
    fix: 'Take the metro, bus or an auto for short trips — about 3 in 10 rides.',
    meta: { rides: rows.length, shortRides: short, total: Math.round(total) },
  };
}

function impulseIdea(txns: Txn[], today: string): SavingIdea | null {
  const from = addDaysISO(today, -89);
  const orders = txns
    .filter((t) => inRange(t, from, today) && isCountedSpend(t) && t.category === 'shopping')
    .sort((a, b) => a.date.localeCompare(b.date));
  const returns = txns.filter((t) => inRange(t, from, today) && t.type === 'refund' && t.category === 'shopping' && !t.excluded);
  const extras: Txn[] = [];
  let bursts = 0;
  let burstOrders = 0;
  for (let i = 0; i < orders.length; ) {
    let j = i;
    while (j + 1 < orders.length && daysBetween(orders[i].date, orders[j + 1].date) <= 6) j++;
    if (j - i + 1 >= 3) {
      bursts++;
      burstOrders += j - i + 1;
      extras.push(...orders.slice(i + 1, j + 1));
      i = j + 1;
    } else {
      i++;
    }
  }
  if (!bursts) return null;
  const firstData = txns.reduce((m, t) => (t.date < m ? t.date : m), today);
  const months = clamp(Math.max(daysBetween(firstData > from ? firstData : from, today), 1) / 30, 1, 3);
  const extraTotal = sum(extras);
  const monthly = round10(extraTotal / months);
  if (monthly < 300) return null;
  const shopMonthly = sum(orders) / months;
  return {
    id: `save:impulse:${today.slice(0, 7)}`,
    kind: 'impulse_shopping',
    title: `Shopping in bursts: ${burstOrders} orders in ${plural(bursts, 'busy week')}`,
    detail: `${money(extraTotal)} went on the extra orders in those weeks${returns.length ? `, and ${plural(returns.length, 'order')} went back as returns` : ''}.`,
    monthly,
    yearly: monthly * 12,
    confidence: returns.length ? 0.6 : 0.5,
    evidence: evidenceOf(extras.length ? extras : orders),
    ask: `What if I cut shopping by ${cutPct(monthly, shopMonthly)}%?`,
    category: 'shopping',
    fix: 'Wait 48 hours before buying anything that is not urgent, and keep one order a week.',
    meta: { bursts, burstOrders, extraOrders: extras.length, returns: returns.length },
  };
}

function feesIdea(txns: Txn[], today: string): SavingIdea | null {
  const from = addDaysISO(today, -89);
  const rows = txns.filter((t) => {
    if (!inRange(t, from, today) || t.type !== 'expense' || t.excluded) return false;
    if (NOT_FEE_CATS.has(t.category)) return false;
    return FEES.test(`${t.merchant} ${t.narration ?? ''} ${t.raw ?? ''}`);
  });
  if (!rows.length) return null;
  const total = sum(rows);
  if (total < 100) return null;
  const monthly = round10(total / 3);
  return {
    id: `save:fees:${today.slice(0, 7)}`,
    kind: 'fees',
    title: `${money(total)} in bank & card charges`,
    detail: `${plural(rows.length, 'charge')} in the last 3 months — late fees, penalties or balance charges you can avoid.`,
    monthly,
    yearly: monthly * 12,
    confidence: 0.85,
    evidence: evidenceOf(rows),
    category: rows[0].category,
    fix: 'Set card autopay to the full amount and keep each account above its minimum balance.',
    meta: { charges: rows.length, total: Math.round(total) },
  };
}

// ------------------------------------------------------------------ main

/** Every saving idea, ranked by monthly × confidence; dismissed ideas removed. Never throws. */
export function savingIdeas(state: SavingsInput, today: string): SavingIdea[] {
  const { txns } = state;
  if (!txns.length) return [];
  const all: SavingIdea[] = [];
  const run = (fn: () => SavingIdea | SavingIdea[] | null) => {
    try {
      const r = fn();
      if (Array.isArray(r)) all.push(...r);
      else if (r) all.push(r);
    } catch {
      // one detector failing never hides the others
    }
  };
  let recs: Recurring[] = [];
  try {
    recs = detectRecurring(txns, today);
  } catch {
    recs = [];
  }
  const w = pickWindow(txns, today);
  run(() => subscriptionIdeas(recs, state, today));
  run(() => foodDeliveryIdea(txns, w));
  run(() => categorySpikes(state, w, today));
  run(() => smallFrequentIdeas(txns, today));
  run(() => cabsIdea(txns, today));
  run(() => impulseIdea(txns, today));
  run(() => feesIdea(txns, today));

  // Dedupe ids.
  const byId = new Map<string, SavingIdea>();
  for (const i of all) if (!byId.has(i.id)) byId.set(i.id, i);
  let ideas = [...byId.values()];

  // A category spike overlaps the specific ideas in the same category (delivery, cabs, impulse,
  // small spends): count only the part they don't already cover, so totals never double count.
  ideas = ideas.flatMap((i) => {
    if (i.kind !== 'category_spike' || !i.category) return [i];
    const covered = ideas
      .filter((o) => o !== i && o.kind !== 'category_spike' && o.category === i.category)
      .reduce((s, o) => s + o.monthly, 0);
    if (!covered) return [i];
    const left = round10(i.monthly - covered);
    if (left < 400) return [];
    const projected = i.meta?.projected ?? left;
    return [{ ...i, monthly: left, yearly: left * 12, ask: `What if I cut ${category(i.category).label.toLowerCase()} by ${cutPct(left, projected)}%?` }];
  });

  const gone = new Set(state.dismissedAlerts);
  return ideas
    .filter((i) => i.monthly > 0 && !gone.has(i.id))
    .sort((a, b) => b.monthly * b.confidence - a.monthly * a.confidence || b.monthly - a.monthly);
}

/** Aggregated facts for the AI coach (no raw SMS, no transaction rows). */
export interface SavingsSummary {
  /** "Oct 2026" */
  month: string;
  /** 'this month' / 'last month' — the period the monthly ideas look at. */
  period: string;
  monthlyIncome: number;
  spentThisMonth: number;
  categories: { name: string; spent: number; usual: number }[];
  goals: { name: string; target: number; saved: number; due?: string }[];
  totalMonthly: number;
  totalYearly: number;
}

/** Category totals, income and goals as a small fact sheet. Never throws. */
export function savingsSummary(state: SavingsInput & { goals?: Goal[] }, ideas: SavingIdea[], today: string): SavingsSummary {
  const { txns } = state;
  const w = pickWindow(txns, today);
  const cur = today.slice(0, 7);
  let income = state.profile.monthlyIncome;
  if (!(income > 0)) {
    try {
      income = inferProfile(txns, today).monthlyIncome;
    } catch {
      income = 0;
    }
  }
  let spent = 0;
  try {
    spent = netSpend(txns, `${cur}-01`, today);
  } catch {
    spent = 0;
  }
  const now = spendByCategory(txns, w.from, w.to);
  const baseBy = w.base.map((m) => {
    const r = monthRange(m);
    return spendByCategory(txns, r.from, r.to);
  });
  const categories = (Object.keys(now) as CategoryId[])
    .map((id) => ({ name: category(id).label, spent: Math.round(now[id] ?? 0), usual: Math.round(avg(baseBy.map((b) => b[id] ?? 0))) }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 8);
  const goals = (state.goals ?? [])
    .filter((g) => !g.archived)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((g) => ({
      name: g.name,
      target: Math.round(g.target),
      saved: Math.round(Math.max(0, g.contributions.reduce((s, c) => s + c.amount, 0))),
      due: g.dueDate ? monthYear(g.dueDate) : undefined,
    }));
  const totalMonthly = ideas.reduce((s, i) => s + i.monthly, 0);
  return {
    month: monthYear(w.ym),
    period: w.label,
    monthlyIncome: Math.round(income || 0),
    spentThisMonth: Math.round(spent),
    categories,
    goals,
    totalMonthly,
    totalYearly: ideas.reduce((s, i) => s + i.yearly, 0),
  };
}
