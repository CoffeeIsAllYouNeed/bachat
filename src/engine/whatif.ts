/**
 * What-if parsing: turns a sentence ("cut dining out by 30% and rent goes up
 * ₹5k", "agar salary 10% badh jaye") into Adjustment[] for the planner.
 * Rules first (English + Hinglish); Gemini only when the rules find nothing,
 * and its JSON is validated strictly. All maths stays in scenario.ts.
 */

import { CATEGORIES, category as categoryInfo, isCategoryId } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { Adjustment, CategoryId } from '@/data/types';
import { detectRecurring } from '@/engine/recurring';
import { addMonths, baseline } from '@/engine/scenario';
import { geminiJSON } from '@/services/gemini';

/** Optional numbers the rules use to turn "rent up 10%" / "save ₹5k more" into amounts. */
export interface WhatIfContext {
  rent?: number;
  emis?: number;
  /** Monthly income: turns "lost my job for 3 months" into month-by-month amounts. */
  income?: number;
  categorySpend?: Partial<Record<CategoryId, number>>;
  /** yyyy-mm-dd; defaults to today. */
  today?: string;
}

/** Everyday words → category (order matters: first match wins). */
export const CATEGORY_WORDS: [RegExp, CategoryId][] = [
  [/\b(?:groceries|grocery|kirana|sabzi|sabji|vegetables?|veggies|ration|bigbasket|blinkit|zepto|instamart|dmart)\b/, 'groceries'],
  [/\b(?:dining out|dining|dine out|dine-out|eating out|eat out|eating outside|restaurants?|food delivery|ordering in|order(?:ing)? food|takeaways?|swiggy|zomato|food|meals?|lunch(?:es)?|dinners?|cafes?|coffee|chai|khana|khaana|bahar ka khana)\b/, 'food'],
  [/\b(?:cabs?|taxis?|uber|ola|rapido|autos?|rickshaws?|commute|commuting|transport|transportation|petrol|diesel|fuel|metro|bus|local train)\b/, 'transport'],
  [/\b(?:shopping|clothes|kapde|kapda|amazon|flipkart|myntra|ajio|meesho|gadgets)\b/, 'shopping'],
  [/\b(?:subscriptions?|ott|streaming)\b/, 'subscriptions'],
  [/\b(?:entertainment|movies?|cinema|concerts?|gaming|games|parties|party|partying|outings?|going out|nightlife|drinks|pubs?)\b/, 'entertainment'],
  [/\b(?:bills?|utilities|utility|electricity|bijli|internet|wifi|wi-fi|broadband|phone bill|mobile bill|recharges?|gas bill|water bill)\b/, 'bills'],
  [/\b(?:health|medicines?|medical|dawai|dawa|doctors?|pharmacy|gym|fitness)\b/, 'health'],
  [/\b(?:personal care|personal|salon|haircuts?|grooming|parlou?r|spa)\b/, 'personal'],
  [/\b(?:education|courses?|books?|tuition|classes|school fees|college fees|padhai)\b/, 'education'],
  [/\b(?:travel|trips?|vacations?|holidays?|flights?|ghoomna|ghumna)\b/, 'travel'],
  [/\b(?:others?|miscellaneous|misc)\b/, 'other'],
];

/** First category named in the text (labels like "Food" and everyday synonyms), if any. */
export function findCategory(text: string): CategoryId | undefined {
  const t = ' ' + text.toLowerCase() + ' ';
  for (const [re, id] of CATEGORY_WORDS) if (re.test(t)) return id;
  for (const c of CATEGORIES) {
    if (!c.spend) continue;
    if (new RegExp(`\\b${c.label.toLowerCase()}\\b`).test(t)) return c.id;
  }
  return undefined;
}

// ------------------------------------------------------------------ number helpers

const PCT_RE = /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per ?cent\b|pc\b|pratishat\b|takka\b)/;
const AMT_RE = /(₹|rs\.?|inr|rupees?)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k\b|thousand\b|hazaa?r\b|lakhs?\b|lacs?\b|l\b|crores?\b|cr\b)?/;

function parsePct(s: string): number | null {
  const m = s.match(PCT_RE);
  return m ? Number(m[1]) : null;
}

/** First rupee amount in a clause (percentages removed first). "₹5k" → 5000, "1.5 lakh" → 150000. */
export function parseAmountText(s: string): number | null {
  const clean = s.replace(new RegExp(PCT_RE.source, 'g'), ' ');
  const re = new RegExp(AMT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (!m[2]) continue;
    const n = Number(m[2].replace(/,/g, ''));
    if (!isFinite(n) || n <= 0) continue;
    const unit = (m[3] ?? '').trim();
    let mult = 1;
    if (unit === 'k' || unit === 'thousand' || unit.startsWith('haza')) mult = 1e3;
    else if (/^(?:lakhs?|lacs?|l)$/.test(unit)) mult = 1e5;
    else if (/^(?:crores?|cr)$/.test(unit)) mult = 1e7;
    const v = Math.round(n * mult);
    // A bare 1–31 without ₹ is probably a date, not money.
    if (!m[1] && mult === 1 && v <= 31) continue;
    return v;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+'?(\d{2}|\d{4}))?/;

/** Month reference → yyyy-mm (next occurrence). Returns the remaining text without it. */
function findMonth(s: string, today: string): { month: string; rest: string } | null {
  const cur = today.slice(0, 7);
  const rel = s.match(/\b(next month|agle mahine|agle month|this month|is mahine|is month|in (\d{1,2}) months?|(\d{1,2}) months? (?:later|baad|from now))\b/);
  if (rel) {
    let n = 0;
    if (/next|agle/.test(rel[1])) n = 1;
    else if (rel[2] || rel[3]) n = Number(rel[2] ?? rel[3]);
    return { month: addMonths(cur, n), rest: s.replace(rel[0], ' ') };
  }
  const m = s.match(MONTH_RE);
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].slice(0, 3));
  if (idx < 0) return null;
  const [cy, cm] = cur.split('-').map(Number);
  let year = cy;
  if (m[2]) year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  else if (idx + 1 < cm) year = cy + 1;
  return { month: `${year}-${String(idx + 1).padStart(2, '0')}`, rest: s.replace(m[0], ' ') };
}

// ------------------------------------------------------------------ direction words

const NEG = /\b(?:cut|cuts|cutting|reduce|reduces|reduced|reducing|lower|lowers|lowered|decrease|decreases|decreased|less|drop|drops|dropped|dropping|fall|falls|fell|fallen|shrinks?|shrunk|halved|down|trim|slash|spend less|kam|kam karu|kam kar|kam ho|kam kar du|ghata\w*|ghat\w*|kat\w*|minus)\b/;
const POS = /\b(?:increase|increases|increased|raise|raises|up|more|hike|hiked|rise|rises|grow|grows|boost|badh\w*|zyada|jyada|zyaada|extra|plus)\b/;
const STOP = /\b(?:stop|quit|no more|zero|band kar\w*|band|completely cut|cut out|eliminate|give up|chhod\w*)\b/;

function sign(clause: string, fallback: 1 | -1): 1 | -1 {
  if (NEG.test(clause)) return -1;
  if (POS.test(clause)) return 1;
  return fallback;
}

// ------------------------------------------------------------------ life changes

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
};

/** Temporary changes are spread month by month, at most this long. */
const MAX_TEMP_MONTHS = 12;

/** "for 3 months", "for the next six months", "for a year", "3 mahine tak" → months; null when it's not temporary. */
export function durationMonths(clause: string): number | null {
  if (/\bfor (?:a|one|1) (?:year|saal)\b|\b(?:ek|1) saal (?:tak|ke liye)\b/.test(clause)) return 12;
  const m =
    clause.match(/\bfor (?:the )?(?:next |coming )?(\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) months?\b/) ??
    clause.match(/\b(\d{1,2}|ek|do|teen|chaa?r|paa?nch|chhe|che) (?:months?|mahine|mahino|mahinon) (?:tak|ke liye|ke lie)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1]] ?? null;
  if (!n || n < 1) return null;
  return Math.min(MAX_TEMP_MONTHS, n);
}

/** Job loss / no income (English + Hinglish). */
const JOB_LOSS =
  /\b(?:lose my job|lost my job|losing my job|lose the job|lost the job|job loss|jobless|unemployed|between jobs|no income|no salary|no job|quit my job|quitting my job|resign\w*|sabbatical|career break|laid off|layoff|fired|naukri (?:chali|chhoot|chhut|gayi|gai)\w*|job (?:chali|chhoot|chhut|gayi|gai)\w*)\b/;

// ------------------------------------------------------------------ helpers

/**
 * "Save ₹N more a month" → cuts across flexible categories, proportional to
 * what is spent there (biggest first, rounded to ₹100), so the surplus rises
 * by ≈ N. Without spend data it falls back to one cut on "Others".
 * (Chosen over a fake income change or a SIP so the chips stay honest:
 * saving more means spending less somewhere.)
 */
function saveMore(amount: number, spend: Partial<Record<CategoryId, number>> | undefined): Adjustment[] {
  const rows = Object.entries(spend ?? {})
    .map(([k, v]) => [k as CategoryId, v ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  if (!rows.length || total <= 0) return [{ kind: 'categoryAbs', category: 'other', amount: -amount }];
  const goal = Math.min(amount, total);
  const top = rows.slice(0, 3);
  const topTotal = top.reduce((a, [, v]) => a + v, 0);
  const out: Adjustment[] = [];
  let left = goal;
  top.forEach(([cat, v], i) => {
    const share = i === top.length - 1 ? left : Math.min(v, Math.round((goal * v) / topTotal / 100) * 100);
    const cut = Math.min(v, Math.max(0, share));
    if (cut > 0) out.push({ kind: 'categoryAbs', category: cat, amount: -cut });
    left -= cut;
  });
  // Top 3 could not cover it (cut capped at their spend): spread over the rest.
  for (const [cat, v] of rows.slice(3)) {
    if (left <= 0) break;
    const cut = Math.min(v, left);
    out.push({ kind: 'categoryAbs', category: cat, amount: -cut });
    left -= cut;
  }
  return out;
}

function sameAdj(a: Adjustment, b: Adjustment): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cleanText(text: string): string {
  return (
    ' ' +
    text
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[?!;()"“”]/g, ' ')
      .replace(/\b(?:what if|what happens if|what would happen if|suppose|supposing|imagine|let's say|lets say|agar|agr|maan lo|man lo|kya hoga|to kya hoga|toh kya hoga)\b/g, ' ')
      .replace(/\s+/g, ' ') +
    ' '
  );
}

// ------------------------------------------------------------------ rules

/**
 * Deterministic parser. `cancelable` = detected recurring payments the user
 * could cancel; `ctx` (optional) gives rent/EMI/flexible spend for % and
 * "save more" phrases.
 */
export function parseWhatIfRules(
  text: string,
  cancelable: { name: string; monthly: number }[],
  ctx: WhatIfContext = {},
): Adjustment[] {
  const today = ctx.today ?? todayISO();
  const clauses = cleanText(text)
    .split(/\s+(?:and|aur|&|plus also|also|then|phir)\s+|;|,(?!\d)/)
    .map((c) => ' ' + c.trim() + ' ')
    .filter((c) => c.trim().length > 0);

  const out: Adjustment[] = [];
  const push = (a: Adjustment) => {
    if (!out.some((x) => sameAdj(x, a))) out.push(a);
  };
  let lastSign: 1 | -1 = -1;
  let pending: CategoryId[] = [];
  /** A monthly income change for `months` months only → one-offs (positive = money out). */
  const temporary = (deltaPerMonth: number, months: number) => {
    const start = today.slice(0, 7);
    for (let i = 0; i < months; i++) push({ kind: 'oneOff', amount: -Math.round(deltaPerMonth), month: addMonths(start, i) });
  };

  for (const raw of clauses) {
    let clause = raw;
    const pct = parsePct(clause);

    // 1) cancel a subscription ("cancel netflix", "netflix band kar du", "cancel all subscriptions")
    const cancelVerb = /\b(?:cancel\w*|unsubscribe|stop paying for|get rid of|drop|band kar\w*|band|hata\w*|stop)\b/.test(clause);
    if (cancelVerb) {
      if (/\ball\b.*\bsubscriptions?\b/.test(clause)) {
        cancelable.forEach((c) => push({ kind: 'cancelSub', name: c.name, monthly: Math.round(c.monthly) }));
        continue;
      }
      const hits = cancelable.filter((c) => {
        const name = c.name.toLowerCase().trim();
        if (!name) return false;
        if (clause.includes(name)) return true;
        const first = name.split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
        return first.length >= 3 && new RegExp(`\\b${first}\\b`).test(clause);
      });
      if (hits.length) {
        hits.forEach((c) => push({ kind: 'cancelSub', name: c.name, monthly: Math.round(c.monthly) }));
        continue;
      }
    }

    // 2) SIP ("add a SIP of ₹5,000", "start SIP 3k", "stop my SIP of ₹3,000", "invest ₹2k every month")
    const amount = parseAmountText(clause);
    if (/\bsips?\b/.test(clause) || (/\b(?:invest\w*|lagau\w*|daal\w*)\b/.test(clause) && /\b(?:every month|a month|per month|monthly|har mahine|\/mo|pm)\b/.test(clause))) {
      if (amount) {
        const stop = /\b(?:stop|pause|cancel|band|end|close)\b/.test(clause);
        push({ kind: 'addSip', amount: stop ? -amount : amount });
        continue;
      }
    }

    // 3) Rent ("rent goes up ₹5,000", "rent 10% badh jaye", "rent goes to ₹30k")
    if (/\b(?:rent|kiraya|kiraaya|kiraye)\b/.test(clause)) {
      const s = sign(clause, 1);
      let delta: number | null = null;
      if (pct != null && ctx.rent) delta = Math.round((ctx.rent * pct) / 100) * s;
      else if (amount != null) {
        if (/\b(?:goes to|becomes|ho jaye|ho jaaye|to ₹|to rs|new rent)\b/.test(clause) && ctx.rent != null && !/\bby\b/.test(clause)) delta = amount - ctx.rent;
        else delta = amount * s;
      }
      if (delta) {
        push({ kind: 'fixedChange', what: 'rent', amount: delta });
        lastSign = s;
        continue;
      }
    }

    // 4) EMIs / loans ("new car loan EMI ₹8,000", "EMI up 2k", "pay off my loan")
    if (/\b(?:emis?|loans?)\b/.test(clause)) {
      if (/\b(?:pay off|payoff|close|closes|prepay|foreclose|finish|finishes|ends|khatam|clear)\b/.test(clause) && ctx.emis) {
        push({ kind: 'fixedChange', what: 'emi', amount: -Math.round(amount && amount < ctx.emis ? amount : ctx.emis) });
        continue;
      }
      if (pct != null && ctx.emis) {
        push({ kind: 'fixedChange', what: 'emi', amount: Math.round((ctx.emis * pct) / 100) * sign(clause, 1) });
        continue;
      }
      if (amount) {
        const s = /\b(?:new|take|another|add|start)\b/.test(clause) ? 1 : sign(clause, 1);
        push({ kind: 'fixedChange', what: 'emi', amount: amount * s });
        continue;
      }
    }

    // 5) Income ("salary goes up 10%", "10% hike", "pay cut of 20%", "lose my job", "side income ₹15k", "bonus ₹50k in March")
    const incomeWord = /\b(?:salary|income|ctc|in-hand|in hand|take home|takehome|tankhwa|tankha|tankhwah|hike|raise|increment|appraisal|pay ?cut|pay ?hike|pay ?rise|my pay|earnings?|kamai|freelanc\w*|side hustle)\b/.test(clause);
    const months = durationMonths(clause);
    const income = ctx.income && ctx.income > 0 ? ctx.income : 0;
    if (JOB_LOSS.test(clause)) {
      if (months && income) temporary(-income, months);
      else push({ kind: 'incomePct', pct: -100 });
      continue;
    }
    if (/\bbonus\b/.test(clause) && amount) {
      const mo = findMonth(clause, today);
      push({ kind: 'oneOff', amount: -amount, month: mo ? mo.month : addMonths(today.slice(0, 7), 1) });
      continue;
    }
    if (incomeWord) {
      const s = /\b(?:hike|raise|increment|appraisal|side|freelanc\w*|extra)\b/.test(clause) && !NEG.test(clause) ? 1 : sign(clause, 1);
      if (pct != null) {
        const p = Math.min(500, pct) * s;
        if (months && income) temporary((income * Math.max(-100, p)) / 100, months);
        else push({ kind: 'incomePct', pct: p });
        continue;
      }
      if (amount) {
        if (months) temporary(amount * s, months);
        else push({ kind: 'incomeAbs', amount: amount * s });
        continue;
      }
    }

    // 6) Save more ("save ₹5,000 more a month", "₹3k extra bachau")
    const cat = findCategory(clause);
    if (!cat && amount && /\b(?:save|saving|bachau\w*|bachana|bacha\w*|put aside|set aside)\b/.test(clause)) {
      saveMore(amount, ctx.categorySpend).forEach(push);
      continue;
    }

    // 7) One-off purchase ("buy a ₹80k laptop in December", "spend ₹50,000 on a trip in March", "wedding ₹2L next month")
    const month = findMonth(clause, today);
    const buyVerb = /\b(?:buy|buying|purchase|kharid\w*|book|gift|spend|spending|pay for|wedding|shaadi|emergency|hospital\w*|surgery|operation|repairs?|deposit|down ?payment)\b/.test(clause);
    const changeVerb = /\b(?:cut|reduce|lower|increase|raise|less|more|kam|zyada|badh\w*|by)\b/.test(clause);
    if (amount && pct == null && ((month && !(cat && changeVerb)) || (buyVerb && !(cat && changeVerb)))) {
      push({ kind: 'oneOff', amount, month: month ? month.month : addMonths(today.slice(0, 7), 1) });
      continue;
    }

    // 8) Category change ("cut Food by 20%", "cabs by 10%", "spend ₹2,000 less on shopping", "stop eating out")
    if (cat) {
      if (cat === 'rent' || cat === 'emi') continue;
      if (month) clause = month.rest;
      const s = sign(clause, lastSign);
      // "cut food and shopping by 10%": the first clause has no number yet, so it waits for the next one.
      const cats = [...pending, cat];
      let made: ((c: CategoryId) => Adjustment) | null = null;
      if (pct != null) made = (c) => ({ kind: 'categoryPct', category: c, pct: s < 0 ? -Math.min(100, pct) : Math.min(500, pct) });
      else if (/\b(?:halve|half|aadha|aadhi)\b/.test(clause)) made = (c) => ({ kind: 'categoryPct', category: c, pct: -50 });
      else if (/\bdouble\b/.test(clause)) made = (c) => ({ kind: 'categoryPct', category: c, pct: 100 });
      else if (amount) made = (c) => ({ kind: 'categoryAbs', category: c, amount: amount * s });
      else if (STOP.test(clause)) made = (c) => ({ kind: 'categoryPct', category: c, pct: -100 });
      if (made) {
        const build = made;
        cats.forEach((c) => push(build(c)));
        pending = [];
        lastSign = NEG.test(clause) || STOP.test(clause) ? -1 : POS.test(clause) ? 1 : lastSign;
      } else if (!pending.includes(cat)) {
        pending.push(cat);
        if (NEG.test(clause)) lastSign = -1;
        else if (POS.test(clause)) lastSign = 1;
      }
    }
  }
  // A temporary change is one row per month (up to 12), so allow more than the usual 8.
  return out.slice(0, 8 + MAX_TEMP_MONTHS);
}

// ------------------------------------------------------------------ Gemini fallback

const VALID_KINDS = new Set(['categoryPct', 'categoryAbs', 'fixedChange', 'incomePct', 'incomeAbs', 'cancelSub', 'addSip', 'oneOff']);

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : typeof v === 'number' ? v : NaN;
  return isFinite(n) ? n : null;
}

/** Strictly validates one model-proposed adjustment; null when anything is off. */
function validate(x: any, cancelable: { name: string; monthly: number }[], today: string): Adjustment | null {
  if (!x || typeof x !== 'object' || !VALID_KINDS.has(x.kind)) return null;
  const amount = num(x.amount);
  const pct = num(x.pct);
  const okAmt = (a: number | null): a is number => a != null && a !== 0 && Math.abs(a) <= 1e8;
  switch (x.kind) {
    case 'categoryPct':
      if (!isCategoryId(x.category) || !categoryInfo(x.category).spend || x.category === 'rent' || x.category === 'emi') return null;
      if (pct == null || pct === 0 || pct < -100 || pct > 300) return null;
      return { kind: 'categoryPct', category: x.category, pct: Math.round(pct) };
    case 'categoryAbs':
      if (!isCategoryId(x.category) || !categoryInfo(x.category).spend || x.category === 'rent' || x.category === 'emi') return null;
      return okAmt(amount) ? { kind: 'categoryAbs', category: x.category, amount: Math.round(amount) } : null;
    case 'fixedChange':
      if (x.what !== 'rent' && x.what !== 'emi' && x.what !== 'other') return null;
      return okAmt(amount) ? { kind: 'fixedChange', what: x.what, amount: Math.round(amount) } : null;
    case 'incomePct':
      if (pct == null || pct === 0 || pct < -100 || pct > 300) return null;
      return { kind: 'incomePct', pct: Math.round(pct) };
    case 'incomeAbs':
      return okAmt(amount) ? { kind: 'incomeAbs', amount: Math.round(amount) } : null;
    case 'cancelSub': {
      const name = String(x.name ?? '').toLowerCase().trim();
      if (!name) return null;
      const hit = cancelable.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase()));
      return hit ? { kind: 'cancelSub', name: hit.name, monthly: Math.round(hit.monthly) } : null;
    }
    case 'addSip':
      return okAmt(amount) ? { kind: 'addSip', amount: Math.round(amount) } : null;
    case 'oneOff': {
      if (!okAmt(amount) || typeof x.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month)) return null;
      const cur = today.slice(0, 7);
      if (x.month < cur || x.month > addMonths(cur, 60)) return null;
      return { kind: 'oneOff', amount: Math.round(amount), month: x.month };
    }
    default:
      return null;
  }
}

/** Rules first; if they find nothing, Gemini turns the sentence into validated JSON. [] on failure. */
export async function parseWhatIf(text: string): Promise<Adjustment[]> {
  const s = useStore.getState();
  const today = todayISO();
  let cancelable: { name: string; monthly: number }[] = [];
  try {
    cancelable = detectRecurring(s.txns, today)
      .filter((r) => r.category !== 'rent' && r.category !== 'emi' && r.category !== 'income' && r.category !== 'investment')
      .map((r) => ({ name: r.name, monthly: r.monthly }));
  } catch {
    cancelable = [];
  }
  let ctx: WhatIfContext = { today };
  try {
    const b = baseline();
    ctx = { today, rent: b.rent, emis: b.emis, income: b.monthlyIncome, categorySpend: b.categorySpend };
  } catch {
    // keep the minimal context
  }

  const ruled = parseWhatIfRules(text, cancelable, ctx);
  if (ruled.length) return ruled;

  const spendCats = CATEGORIES.filter((c) => c.spend && c.id !== 'rent' && c.id !== 'emi').map((c) => c.id).join(', ');
  const prompt =
    'Turn this what-if sentence from an Indian personal-finance app user into a JSON array of adjustments. ' +
    'Allowed objects (amounts in rupees per month unless oneOff; negative = less):\n' +
    `{"kind":"categoryPct","category":<one of ${spendCats}>,"pct":-30}\n` +
    '{"kind":"categoryAbs","category":<same list>,"amount":-2000}\n' +
    '{"kind":"fixedChange","what":"rent"|"emi"|"other","amount":5000}\n' +
    '{"kind":"incomePct","pct":10}\n{"kind":"incomeAbs","amount":10000}\n' +
    `{"kind":"cancelSub","name":<one of: ${cancelable.map((c) => c.name).join(', ') || 'none'}>}\n` +
    '{"kind":"addSip","amount":5000}\n' +
    `{"kind":"oneOff","amount":80000,"month":"yyyy-mm"} (today is ${today}; use a negative amount for a one-time inflow)\n` +
    `A change that lasts only some months (e.g. "lost my job for 3 months") is one oneOff per month starting ${today.slice(0, 7)}, ` +
    `positive amount = money lost that month${ctx.income ? ` (monthly income is ${ctx.income})` : ''}.\n` +
    'Only include what the sentence clearly says. Never name or choose any stock, fund or crypto. ' +
    'If nothing fits, return []. Sentence: ' + JSON.stringify(text.slice(0, 300));
  const res = await geminiJSON<unknown>(prompt, { agent: 'replanner', temperature: 0, timeoutMs: 12000 });
  const arr = Array.isArray(res) ? res : res && typeof res === 'object' && Array.isArray((res as any).adjustments) ? (res as any).adjustments : [];
  const out: Adjustment[] = [];
  for (const x of arr.slice(0, 8 + MAX_TEMP_MONTHS)) {
    const v = validate(x, cancelable, today);
    if (v && !out.some((o) => sameAdj(o, v))) out.push(v);
  }
  return out;
}
