/**
 * Deterministic command routing for the assistant: decides which section a
 * request belongs to before any engine or model runs. Order matters:
 * pick → whatif → savings → review → report → settings → budgets → networth → rent →
 * cashflow → subscription → investments → goals → transactions → spending →
 * short search → unknown.
 */

import type { AssistantAnswer, CategoryId } from '@/data/types';
import { isPickRequest, isWhatIf } from '@/engine/guard';
import { findCategory } from '@/engine/whatif';

export type RouteTopic =
  | 'pick' | 'whatif' | 'savings' | 'review' | 'report' | 'settings' | 'budgets' | 'networth' | 'rent' | 'cashflow'
  | 'subscription' | 'investments' | 'goals' | 'transactions' | 'spending' | 'unknown';

export interface Route {
  section: AssistantAnswer['section'];
  topic: RouteTopic;
  term?: string;
  category?: CategoryId;
}

const RE = {
  /** "Where can I save money?", "How can I save more?", "kaise bachaun" → Save more. */
  savings: /\b(?:(?:where (?:can|could|should|do) i|how (?:can|could|do|should) i|how to) save(?! for\b| up for\b)|save (?:more|money|some money)|saving (?:ideas|tips)|ways to save|tips to save|cut (?:my |down )?(?:costs|spending|expenses|back)|spend less|reduce (?:my )?(?:spending|expenses|costs)|kaise bacha\w*|bacha(?:un|u|oon|na|ne|yein|ye) kaise|paise? kaise bacha\w*|kaha(?:n)? (?:se )?bacha\w*|bachat kaise|kharcha kam\w*)\b/,
  review: /\b(?:to review|needs? review|review (?:my )?(?:transactions|txns|categories)|uncategori[sz]ed|unknown transactions|fix (?:my )?categories|categori[sz]e (?:my )?transactions|what needs checking)\b/,
  report: /\b(?:monthly review|month in review|review (?:of )?(?:the |this |last )?month|report|summary|recap|wrap ?up|hisaab|hisab)\b/,
  settings: /\b(?:settings?|dark mode|light mode|theme|appearance|notifications?|quiet hours|coach voice|voice|rearrange|reorder|clear (?:all )?data|reset app|preferences)\b/,
  budgets: /\b(?:budgets?|over budget|under budget|left to spend|on track|within budget|overspend\w*|kitna bacha|budget limit)\b/,
  networth: /\b(?:net ?worth|assets?|debts?|liabilit\w*|balances?|bank accounts?|accounts?|credit cards?|card (?:bill|outstanding|dues)|outstanding|loans?|kitna paisa hai)\b/,
  rent: /\b(?:rent|landlord|hra|kiraya|kiraaya|kiraye)\b/,
  cashflow: /\b(?:cash ?flow|income|earn|earned|earning|earnings|salary|savings? rate|saved|net this month|how much did i make|money in|kamaya|kamai|tankhwa)\b/,
  subscription: /\b(?:subscriptions?|recurring|renewals?|auto-?pay|mandates?|bills? due|upcoming (?:bills|payments|charges)|due (?:this|next) week)\b/,
  investments: /\b(?:invest\w*|sips?|mutual funds?|portfolio|zerodha|groww|kuvera|coin|ppf|nps|elss|fds?|fixed deposits?)\b/,
  goals: /\b(?:goals?|emergency fund|save for|saving for|savings goal|target|eta|when (?:can|will) i (?:afford|reach|have))\b/,
  transactions: /\b(?:transactions?|txns?|search|find|look ?up|show (?:me )?(?:all|my)? ?(?:payments|charges)|payments? (?:to|from)|paid to|charges? from|history)\b/,
  spending: /\b(?:spend|spending|spent|kharch\w*|expenses?|where did (?:my|the) money go|paisa kahan gaya|cost me)\b/,
};

/** Bank / lender words that start many recurring names but don't identify one. */
const BANK_WORDS = new Set(['hdfc', 'icici', 'sbi', 'axis', 'kotak', 'bajaj', 'tata', 'idfc', 'indusind', 'yes', 'bank', 'loan', 'home', 'personal', 'car']);

/** Search term after "for/at/to/from/on" or in quotes; falls back to the trimmed text. */
function extractTerm(text: string): string | undefined {
  const q = text.match(/["“']([^"”']{2,40})["”']/);
  if (q) return q[1].trim();
  const m = text.match(/\b(?:for|at|to|from|on|with|named|called)\s+([a-z0-9][\w .&'-]{1,40})/i);
  if (m) {
    const term = m[1]
      .replace(/\b(?:this|last|in|during|today|yesterday|month|week|year|please|pls)\b.*$/i, '')
      .trim();
    if (term.length >= 2) return term;
  }
  return undefined;
}

/** Deterministic routing; ctx.subscriptions = detected recurring names (e.g. "Netflix"). */
export function routeCommand(text: string, ctx: { subscriptions: string[] }): Route {
  const raw = text.trim();
  const t = ' ' + raw.toLowerCase().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ') + ' ';

  if (isPickRequest(raw)) return { section: 'investments', topic: 'pick' };
  if (isWhatIf(raw)) return { section: 'goals', topic: 'whatif' };
  if (RE.savings.test(t)) return { section: 'home', topic: 'savings' };
  if (RE.review.test(t)) return { section: 'transactions', topic: 'review' };
  if (RE.report.test(t)) return { section: 'report', topic: 'report' };
  if (RE.settings.test(t)) return { section: 'settings', topic: 'settings' };
  if (RE.budgets.test(t)) return { section: 'budgets', topic: 'budgets', category: findCategory(t) };
  if (RE.networth.test(t)) return { section: 'networth', topic: 'networth' };
  if (RE.rent.test(t)) return { section: 'rent', topic: 'rent' };
  if (RE.cashflow.test(t)) return { section: 'cashflow', topic: 'cashflow' };

  const sub = ctx.subscriptions.find((name) => {
    const n = name.toLowerCase().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length < 3) return false;
    // Whole-word match only ("ola" must not match "cola").
    if (t.includes(' ' + n + ' ')) return true;
    const first = n.split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
    // A bank name alone ("HDFC" from "HDFC Loan EMI") is not a subscription mention.
    if (BANK_WORDS.has(first)) return false;
    return first.length >= 4 && new RegExp(`\\b${first}\\b`).test(t);
  });
  if (sub) return { section: 'recurring', topic: 'subscription', term: sub };
  if (RE.subscription.test(t)) return { section: 'recurring', topic: 'subscription' };

  if (RE.investments.test(t)) return { section: 'investments', topic: 'investments' };
  if (RE.goals.test(t)) return { section: 'goals', topic: 'goals' };
  if (RE.transactions.test(t)) return { section: 'transactions', topic: 'transactions', term: extractTerm(raw) };

  const cat = findCategory(t);
  if (RE.spending.test(t) || cat) return { section: 'spending', topic: 'spending', category: cat };

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 3) return { section: 'transactions', topic: 'transactions', term: raw.replace(/[?!.]+$/, '') };
  return { section: 'home', topic: 'unknown' };
}
