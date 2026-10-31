/**
 * Investments at cost: what the user put in, where, and how regularly.
 * No market prices, returns or benchmarks, and never a recommendation.
 */

import type { Txn } from '@/data/types';
import { displayName, merchantKey } from '@/engine/merchant';
import { dayDiff, investedAmount, minusYears, plusDays } from '@/engine/periods';

export interface InvestmentSummary {
  total: number;
  thisYear: number;
  lastYearSamePeriod: number;
  platforms: { name: string; total: number; lastDate: string }[];
  sips: { name: string; monthly: number; day: number; months: number }[];
  allocation: { bucket: string; amount: number; share: number }[];
  path: { date: string; cumulative: number }[];
}

/** Allocation buckets, checked in this order (first match wins). */
export const BUCKETS: { bucket: string; re: RegExp }[] = [
  { bucket: 'ELSS', re: /\belss\b|tax\s*saver/i },
  { bucket: 'Index funds', re: /\bindex\b|nifty|sensex|\betf\b/i },
  { bucket: 'Gold', re: /\bgold\b|\bsgb\b|sovereign/i },
  { bucket: 'PPF/NPS', re: /\bppf\b|\bnps\b|pension|\bepf\b|\bvpf\b|provident/i },
  { bucket: 'Debt/FD/RD', re: /\bfd\b|fixed\s*deposit|\brd\b|recurring\s*deposit|\bdebt\b|liquid|\bbond|gilt|deposit/i },
  { bucket: 'Equity funds', re: /mutual\s*fund|\bmf\b|\bsip\b|\bcoin\b|groww|kuvera|paytm\s*money|et\s*money|scripbox|\bfund\b|\bamc\b/i },
  { bucket: 'Stocks', re: /stock|\bshares?\b|equity|zerodha|kite|upstox|angel|demat|\bipo\b|smallcase|dhan\b/i },
];

/** Known platforms for grouping ("Zerodha Coin" and "ZERODHA BROKING" stay apart). */
const PLATFORMS: { name: string; re: RegExp }[] = [
  { name: 'Zerodha Coin', re: /zerodha\s*coin|\bcoin\b/i },
  { name: 'Zerodha', re: /zerodha|kite/i },
  { name: 'Groww', re: /groww/i },
  { name: 'Kuvera', re: /kuvera/i },
  { name: 'Paytm Money', re: /paytm\s*money/i },
  { name: 'Upstox', re: /upstox/i },
  { name: 'Angel One', re: /angel/i },
  { name: 'ET Money', re: /et\s*money/i },
  { name: 'PPF', re: /\bppf\b/i },
  { name: 'NPS', re: /\bnps\b/i },
];

/** Allocation bucket for one investment row (keywords only). */
export function bucketOf(t: Txn): string {
  const text = `${t.merchant} ${t.narration ?? ''}`;
  for (const b of BUCKETS) if (b.re.test(text)) return b.bucket;
  return 'Other';
}

/** Platform name for one investment row. */
export function platformOf(t: Txn): string {
  const text = `${t.merchant} ${t.narration ?? ''}`;
  for (const p of PLATFORMS) if (p.re.test(text)) return p.name;
  return displayName(t.merchant);
}

/** Investment rows (purchases and redemptions), oldest first. */
export function investmentTxns(txns: Txn[]): Txn[] {
  return txns.filter((t) => investedAmount(t) !== 0).sort((a, b) => a.date.localeCompare(b.date));
}

function detectSips(rows: Txn[], today: string): InvestmentSummary['sips'] {
  const groups = new Map<string, Txn[]>();
  for (const t of rows) {
    if (investedAmount(t) <= 0) continue;
    const k = merchantKey(t.merchant) || t.merchant.toLowerCase();
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out: InvestmentSummary['sips'] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // One charge per month: keep the first per yyyy-mm.
    const perMonth = new Map<string, Txn>();
    for (const t of g) if (!perMonth.has(t.date.slice(0, 7))) perMonth.set(t.date.slice(0, 7), t);
    const list = [...perMonth.values()];
    if (list.length < 2) continue;
    // Count the run of monthly gaps ending at the latest charge.
    let months = 1;
    for (let i = list.length - 1; i > 0; i--) {
      const gap = dayDiff(list[i - 1].date, list[i].date);
      if (gap >= 26 && gap <= 35) months++;
      else break;
    }
    const last = list[list.length - 1];
    if (months < 2 || dayDiff(last.date, today) > 45) continue;
    out.push({ name: platformOf(last), monthly: last.amount, day: Number(last.date.slice(8, 10)), months });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** Totals, platforms, SIPs, keyword allocation and the cumulative path — all at cost. */
export function investmentSummary(txns: Txn[], today: string): InvestmentSummary {
  const rows = investmentTxns(txns).filter((t) => t.date <= today);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const lyStart = minusYears(yearStart);
  const lyEnd = minusYears(today);

  let total = 0;
  let thisYear = 0;
  let lastYearSamePeriod = 0;
  const plat = new Map<string, { total: number; lastDate: string }>();
  const alloc = new Map<string, number>();
  const path: { date: string; cumulative: number }[] = [];

  for (const t of rows) {
    const v = investedAmount(t);
    total += v;
    if (t.date >= yearStart) thisYear += v;
    if (t.date >= lyStart && t.date <= lyEnd) lastYearSamePeriod += v;
    const name = platformOf(t);
    const p = plat.get(name) ?? { total: 0, lastDate: t.date };
    p.total += v;
    if (t.date > p.lastDate) p.lastDate = t.date;
    plat.set(name, p);
    const b = bucketOf(t);
    alloc.set(b, (alloc.get(b) ?? 0) + v);
    const lastPt = path[path.length - 1];
    if (lastPt && lastPt.date === t.date) lastPt.cumulative = total;
    else path.push({ date: t.date, cumulative: total });
  }

  const positive = [...alloc.entries()].filter(([, a]) => a > 0);
  const allocTotal = positive.reduce((a, [, v]) => a + v, 0);
  const allocation = positive
    .map(([bucket, amount]) => ({ bucket, amount, share: allocTotal > 0 ? amount / allocTotal : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const platforms = [...plat.entries()]
    .filter(([, p]) => p.total > 0)
    .map(([name, p]) => ({ name, total: p.total, lastDate: p.lastDate }))
    .sort((a, b) => b.total - a.total);

  return { total, thisYear, lastYearSamePeriod, platforms, sips: detectSips(rows, today), allocation, path };
}

/**
 * Cumulative invested values for a chart window: the value carried in at
 * [from], every change inside it, and today. Always ≥ 2 points when there is data.
 */
export function pathWindow(path: InvestmentSummary['path'], from: string, today: string): { date: string; cumulative: number }[] {
  if (!path.length) return [];
  let start = 0;
  for (const p of path) if (p.date < from) start = p.cumulative;
  const inside = path.filter((p) => p.date >= from && p.date <= today);
  const out = [{ date: from, cumulative: start }, ...inside];
  const lastVal = out[out.length - 1].cumulative;
  if (out[out.length - 1].date !== today) out.push({ date: today, cumulative: lastVal });
  return out;
}

/** Start date for a 1W / 1M / 3M / YTD / 1Y chart range. */
export function rangeStart(range: '1W' | '1M' | '3M' | 'YTD' | '1Y', today: string): string {
  if (range === '1W') return plusDays(today, -6);
  if (range === '1M') return plusDays(today, -29);
  if (range === '3M') return plusDays(today, -89);
  if (range === 'YTD') return `${today.slice(0, 4)}-01-01`;
  return plusDays(today, -364);
}
