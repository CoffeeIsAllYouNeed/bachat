/**
 * Review (Day · Week · Month · Year): the deterministic numbers for a period
 * compared with the period before, plus a 1–2 sentence recap.
 *
 * The recap: Gemini gets ONLY the aggregated facts below (totals, top
 * categories/merchants, changes) and writes at most two short sentences; the
 * reply passes guardOutput (numbers must come from the facts, no products).
 * Any failure → a deterministic sentence. Cached per period + data hash.
 */

import { category } from '@/data/categories';
import type { CategoryId, Txn } from '@/data/types';
import { incomeBetween } from '@/engine/cashflow';
import { isCountedSpend, netSpend, spendByCategory } from '@/engine/clean';
import { guardOutput } from '@/engine/guard';
import { displayName, merchantKey } from '@/engine/merchant';
import { hashString } from '@/engine/parseUtil';
import { minusYears, monthBounds, monthDays, plusDays, plusMonths } from '@/engine/periods';
import { geminiConfigured, geminiText } from '@/services/gemini';
import { areAmountsHidden, dayMonth, money, moneyPlain, monthYear, parseISO } from '@/theme/format';

export type ReviewKind = 'day' | 'week' | 'month' | 'year';

export interface ReviewLine {
  name: string;
  emoji?: string;
  category?: CategoryId;
  amount: number;
  prev: number;
  /** (amount − prev) / prev; null when prev is 0 */
  change: number | null;
  /** Payments (merchants only). */
  count?: number;
}

export interface ReviewFacts {
  kind: ReviewKind;
  /** "This week", "Oct 2026" … */
  label: string;
  /** "last week", "Sep 2026" … */
  prevLabel: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** Period still running (compared with the same number of days before). */
  partial: boolean;
  spent: number;
  earned: number;
  net: number;
  prev: { spent: number; earned: number; net: number };
  topCategories: ReviewLine[];
  topMerchants: ReviewLine[];
  /** Biggest meaningful category moves vs the period before (max 3). */
  changes: (ReviewLine & { delta: number })[];
}

function change(a: number, b: number): number | null {
  return b > 0 ? (a - b) / b : null;
}

function signedChange(a: number, b: number): number | null {
  return b !== 0 ? (a - b) / Math.abs(b) : null;
}

/** Period bounds for kind + offset (0 = current, −1 = the one before …). */
export function reviewPeriod(kind: ReviewKind, offset: number, today: string): {
  from: string; to: string; prevFrom: string; prevTo: string; label: string; prevLabel: string; partial: boolean;
} {
  if (kind === 'day') {
    const d = plusDays(today, offset);
    const p = plusDays(d, -1);
    const label = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : dayMonth(d);
    const prevLabel = offset === 0 ? 'yesterday' : offset === -1 ? 'the day before' : dayMonth(p);
    return { from: d, to: d, prevFrom: p, prevTo: p, label, prevLabel, partial: offset === 0 };
  }
  if (kind === 'week') {
    const dow = (parseISO(today).getDay() + 6) % 7; // Monday = 0
    const from = plusDays(today, -dow + offset * 7);
    const end = plusDays(from, 6);
    const partial = offset === 0;
    const to = partial ? today : end;
    const prevFrom = plusDays(from, -7);
    const prevTo = partial ? plusDays(today, -7) : plusDays(from, -1);
    const label = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `${dayMonth(from)} – ${dayMonth(end)}`;
    const prevLabel = offset === 0 ? 'last week' : 'the week before';
    return { from, to, prevFrom, prevTo, label, prevLabel, partial };
  }
  if (kind === 'month') {
    const ym = plusMonths(today.slice(0, 7), offset);
    const b = monthBounds(ym);
    const partial = offset === 0;
    const to = partial ? today : b.to;
    const pym = plusMonths(ym, -1);
    const pb = monthBounds(pym);
    const day = Number(to.slice(8, 10));
    const prevTo = partial ? `${pym}-${String(Math.min(day, monthDays(pym))).padStart(2, '0')}` : pb.to;
    return { from: b.from, to, prevFrom: pb.from, prevTo, label: monthYear(ym), prevLabel: monthYear(pym), partial };
  }
  const y = Number(today.slice(0, 4)) + offset;
  const from = `${y}-01-01`;
  const partial = offset === 0;
  const to = partial ? today : `${y}-12-31`;
  return { from, to, prevFrom: minusYears(from), prevTo: minusYears(to), label: String(y), prevLabel: String(y - 1), partial };
}

function merchantTotals(txns: Txn[], from: string, to: string): Map<string, { name: string; amount: number; count: number }> {
  const out = new Map<string, { name: string; amount: number; count: number }>();
  for (const t of txns) {
    if (t.date < from || t.date > to || !isCountedSpend(t)) continue;
    const k = merchantKey(t.merchant) || t.merchant.toLowerCase();
    const cur = out.get(k) ?? { name: displayName(t.merchant) || t.merchant, amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    out.set(k, cur);
  }
  return out;
}

/** All the numbers for one review period (deterministic). */
export function reviewFacts(txns: Txn[], kind: ReviewKind, offset: number, today: string): ReviewFacts {
  const p = reviewPeriod(kind, offset, today);
  const spent = netSpend(txns, p.from, p.to);
  const earned = incomeBetween(txns, p.from, p.to);
  const pSpent = netSpend(txns, p.prevFrom, p.prevTo);
  const pEarned = incomeBetween(txns, p.prevFrom, p.prevTo);

  const cats = spendByCategory(txns, p.from, p.to);
  const pCats = spendByCategory(txns, p.prevFrom, p.prevTo);
  const catLine = (id: CategoryId): ReviewLine => {
    const info = category(id);
    const amount = cats[id] ?? 0;
    const prev = pCats[id] ?? 0;
    return { name: info.label, emoji: info.emoji, category: id, amount, prev, change: change(amount, prev) };
  };
  const topCategories = (Object.keys(cats) as CategoryId[])
    .map(catLine)
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  const m = merchantTotals(txns, p.from, p.to);
  const pm = merchantTotals(txns, p.prevFrom, p.prevTo);
  const topMerchants: ReviewLine[] = [...m.entries()]
    .map(([k, v]) => {
      const prev = pm.get(k)?.amount ?? 0;
      return { name: v.name, amount: v.amount, prev, change: change(v.amount, prev), count: v.count };
    })
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  // Notable: a move of at least ₹200 (₹500 for a month/year) and 25% of the old amount (or a new spend of that size).
  const minDelta = kind === 'day' || kind === 'week' ? 200 : 500;
  const ids = new Set<CategoryId>([...(Object.keys(cats) as CategoryId[]), ...(Object.keys(pCats) as CategoryId[])]);
  const changes = [...ids]
    .map((id) => {
      const l = catLine(id);
      return { ...l, delta: l.amount - l.prev };
    })
    .filter((l) => Math.abs(l.delta) >= minDelta && (l.prev <= 0 || Math.abs(l.delta) / l.prev >= 0.25))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  return {
    kind,
    label: p.label,
    prevLabel: p.prevLabel,
    from: p.from,
    to: p.to,
    prevFrom: p.prevFrom,
    prevTo: p.prevTo,
    partial: p.partial,
    spent,
    earned,
    net: earned - spent,
    prev: { spent: pSpent, earned: pEarned, net: pEarned - pSpent },
    topCategories,
    topMerchants,
    changes,
  };
}

/** Change of net vs the period before (sign-aware). */
export function netChange(f: ReviewFacts): number | null {
  return signedChange(f.net, f.prev.net);
}

// ------------------------------------------------------------------ recap

function lowerLabel(f: ReviewFacts): string {
  if (f.kind === 'day') return f.label === 'Today' ? 'today' : f.label === 'Yesterday' ? 'yesterday' : `on ${f.label}`;
  if (f.kind === 'week') return f.label === 'This week' ? 'this week' : f.label === 'Last week' ? 'last week' : `in ${f.label}`;
  return `in ${f.label}`;
}

/** Deterministic 1–2 sentence recap (also the fallback). */
export function fallbackRecap(f: ReviewFacts): string {
  if (f.spent <= 0 && f.earned <= 0) return '';
  const ch = change(f.spent, f.prev.spent);
  const vs = ch == null || Math.abs(ch) < 0.01
    ? ''
    : `, ${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? 'more' : 'less'} than ${f.prevLabel}`;
  const first = `You spent ${money(f.spent)} ${lowerLabel(f)}${vs}.`;
  const big = f.changes[0];
  let second = '';
  if (big && big.delta > 0) second = ` ${big.name} rose by ${money(big.delta)}.`;
  else if (f.topCategories[0]) second = ` ${f.topCategories[0].name} was the biggest at ${money(f.topCategories[0].amount)}.`;
  return first + second;
}

const SYSTEM =
  "You write a recap of the user's money for one period inside an Indian budgeting app. " +
  'Write ONE or TWO short sentences (at most 40 words in total), plain and kind, the most useful fact first. ' +
  'Use ONLY numbers that appear in the facts, written exactly as given; never compute new numbers. ' +
  'Never name or recommend any stock, fund, crypto, insurance, card or other financial product, never talk about investing. ' +
  'No exclamation marks, no emojis, no greeting. Return the sentences only.';

function factSheet(f: ReviewFacts): Record<string, unknown> {
  const pct = (x: number | null) => (x == null ? 'n/a' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x) * 100)}%`);
  return {
    period: f.label + (f.partial ? ' (so far)' : ''),
    comparedWith: f.prevLabel + (f.partial ? ' (same number of days)' : ''),
    spent: moneyPlain(f.spent),
    spentBefore: moneyPlain(f.prev.spent),
    spentChange: pct(change(f.spent, f.prev.spent)),
    earned: moneyPlain(f.earned),
    earnedBefore: moneyPlain(f.prev.earned),
    net: moneyPlain(f.net),
    topCategories: f.topCategories.map((l) => ({ name: l.name, spent: moneyPlain(l.amount), before: moneyPlain(l.prev) })),
    topMerchants: f.topMerchants.map((l) => ({ name: l.name, spent: moneyPlain(l.amount), payments: l.count ?? 0 })),
    biggestChanges: f.changes.map((l) => ({ name: l.name, now: moneyPlain(l.amount), before: moneyPlain(l.prev), difference: moneyPlain(Math.abs(l.delta)), direction: l.delta > 0 ? 'up' : 'down' })),
  };
}

function allowedNumbers(f: ReviewFacts): number[] {
  const out: number[] = [f.spent, f.earned, f.net, f.prev.spent, f.prev.earned, f.prev.net];
  const pushChange = (x: number | null) => {
    if (x == null) return;
    const a = Math.abs(x);
    out.push(a, Math.round(a * 100), Math.round(a * 1000) / 10);
  };
  pushChange(change(f.spent, f.prev.spent));
  pushChange(change(f.earned, f.prev.earned));
  for (const l of [...f.topCategories, ...f.topMerchants, ...f.changes]) {
    out.push(l.amount, l.prev, Math.abs(l.amount - l.prev));
    if (l.count != null) out.push(l.count);
    pushChange(l.change);
  }
  return out;
}

/** First two sentences, trimmed; null if empty or too long. */
function tidy(text: string | null): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '').trim();
  if (!t) return null;
  const parts = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  const two = parts.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (two.length < 12 || two.length > 280) return null;
  return two;
}

export function recapKey(f: ReviewFacts): string {
  return `${f.kind}|${f.from}|${f.to}|${hashString(JSON.stringify(factSheet(f)))}`;
}

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Gemini recap for the facts (guarded), or null. Cached per period + data hash. */
export function requestRecap(f: ReviewFacts): Promise<string | null> {
  const key = recapKey(f);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const running = inflight.get(key);
  if (running) return running;
  if (!geminiConfigured || (f.spent <= 0 && f.earned <= 0)) {
    cache.set(key, null);
    return Promise.resolve(null);
  }
  const p = (async () => {
    let out: string | null = null;
    try {
      const raw = await geminiText(`Facts (computed on the device):\n${JSON.stringify(factSheet(f))}`, {
        agent: 'recap', system: SYSTEM, temperature: 0.3, timeoutMs: 12000, fallback: false,
      });
      const t = tidy(raw);
      out = t ? guardOutput(t, allowedNumbers(f)) : null;
    } catch {
      out = null;
    }
    cache.set(key, out);
    if (cache.size > 24) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    inflight.delete(key);
    return out;
  })();
  inflight.set(key, p);
  return p;
}

/** The recap to show now: the cached AI line (unless amounts are hidden), else the deterministic one. */
export function recapText(f: ReviewFacts): string {
  const ai = cache.get(recapKey(f));
  if (ai && !areAmountsHidden()) return ai;
  return fallbackRecap(f);
}
