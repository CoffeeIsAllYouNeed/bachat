import type { AmountBand, CategoryId, CatSource, CorrectionExample, RawTxn, Rule, Txn, TxnType } from '@/data/types';
import { CATEGORIES, category as categoryInfo, isCategoryId } from '@/data/categories';
import { useStore } from '@/data/store';
import { dataBlock, geminiJSON } from '@/services/gemini';
import { merchantKey } from './merchant';

/*
 * Categorisation, in order:
 *  1. newest matching active rule the user taught (conf 0.98)
 *  2. type: income → Income, investment → Investment, transfer → Transfer
 *  3. built-in merchant dictionary (conf 0.92)
 *  4. keywords in the narration (conf 0.7)
 *  5. Others (conf 0.3) → needs review; Gemini may suggest later.
 */

export interface CatResult {
  category: CategoryId;
  catSource: CatSource;
  confidence: number;
}

/** Built-in merchant dictionary: [phrase in the merchant key, category]. Longer phrases are checked first. */
const MERCHANTS: [string, CategoryId][] = [
  // food delivery & eating out
  ['swiggy', 'food'], ['zomato', 'food'], ['eatsure', 'food'], ['box8', 'food'], ['faasos', 'food'], ['behrouz', 'food'],
  ['dominos', 'food'], ['domino', 'food'], ['mcdonald', 'food'], ['mcdonalds', 'food'], ['kfc', 'food'], ['pizza hut', 'food'],
  ['burger king', 'food'], ['subway', 'food'], ['starbucks', 'food'], ['third wave', 'food'], ['blue tokai', 'food'],
  ['chaayos', 'food'], ['chai point', 'food'], ['cafe coffee day', 'food'], ['ccd', 'food'], ['haldiram', 'food'],
  ['barbeque nation', 'food'], ['wow momo', 'food'], ['theobroma', 'food'], ['magicpin', 'food'], ['eatfit', 'food'],
  // groceries
  ['swiggy instamart', 'groceries'], ['instamart', 'groceries'], ['bigbasket', 'groceries'], ['bbnow', 'groceries'],
  ['blinkit', 'groceries'], ['grofers', 'groceries'], ['zepto', 'groceries'], ['dmart', 'groceries'], ['avenue supermarts', 'groceries'],
  ['jiomart', 'groceries'], ['reliance fresh', 'groceries'], ['reliance smart', 'groceries'], ['more retail', 'groceries'],
  ['natures basket', 'groceries'], ['spencers', 'groceries'], ['licious', 'groceries'], ['country delight', 'groceries'],
  ['milkbasket', 'groceries'], ['freshtohome', 'groceries'], ['amazon fresh', 'groceries'], ['flipkart minutes', 'groceries'],
  // transport
  ['uber', 'transport'], ['ola', 'transport'], ['olacabs', 'transport'], ['ani technologies', 'transport'], ['rapido', 'transport'],
  ['namma yatri', 'transport'], ['blusmart', 'transport'], ['namma metro', 'transport'], ['mumbai metro', 'transport'],
  ['dmrc', 'transport'], ['bmtc', 'transport'], ['best bus', 'transport'], ['indian oil', 'transport'], ['iocl', 'transport'],
  ['hpcl', 'transport'], ['hindustan petroleum', 'transport'], ['bharat petroleum', 'transport'], ['bpcl', 'transport'],
  ['shell', 'transport'], ['fastag', 'transport'], ['yulu', 'transport'],
  // travel
  ['irctc', 'travel'], ['makemytrip', 'travel'], ['goibibo', 'travel'], ['cleartrip', 'travel'], ['indigo', 'travel'],
  ['interglobe', 'travel'], ['air india', 'travel'], ['vistara', 'travel'], ['akasa', 'travel'], ['spicejet', 'travel'],
  ['redbus', 'travel'], ['oyo', 'travel'], ['airbnb', 'travel'], ['booking com', 'travel'], ['ixigo', 'travel'], ['yatra', 'travel'],
  ['agoda', 'travel'], ['easemytrip', 'travel'],
  // bills & utilities
  ['airtel', 'bills'], ['jio', 'bills'], ['reliance jio', 'bills'], ['vodafone', 'bills'], ['vi prepaid', 'bills'], ['bsnl', 'bills'],
  ['bescom', 'bills'], ['tata power', 'bills'], ['adani electricity', 'bills'], ['msedcl', 'bills'], ['mahadiscom', 'bills'],
  ['bses', 'bills'], ['tangedco', 'bills'], ['electricity', 'bills'], ['mahanagar gas', 'bills'], ['indraprastha gas', 'bills'],
  ['igl', 'bills'], ['act fibernet', 'bills'], ['hathway', 'bills'], ['tata play', 'bills'], ['dish tv', 'bills'], ['bwssb', 'bills'],
  ['water board', 'bills'], ['indane', 'bills'], ['bharatgas', 'bills'], ['hp gas', 'bills'],
  // subscriptions
  ['netflix', 'subscriptions'], ['spotify', 'subscriptions'], ['hotstar', 'subscriptions'], ['disney', 'subscriptions'],
  ['jiohotstar', 'subscriptions'], ['prime video', 'subscriptions'], ['amazon prime', 'subscriptions'], ['youtube', 'subscriptions'],
  ['google one', 'subscriptions'], ['google play', 'subscriptions'], ['apple com', 'subscriptions'], ['icloud', 'subscriptions'],
  ['sonyliv', 'subscriptions'], ['zee5', 'subscriptions'], ['jiocinema', 'subscriptions'], ['audible', 'subscriptions'],
  ['kindle unlimited', 'subscriptions'], ['linkedin', 'subscriptions'], ['openai', 'subscriptions'], ['chatgpt', 'subscriptions'],
  ['notion', 'subscriptions'], ['canva', 'subscriptions'], ['github', 'subscriptions'], ['claude', 'subscriptions'],
  // shopping
  ['amazon', 'shopping'], ['amzn', 'shopping'], ['flipkart', 'shopping'], ['myntra', 'shopping'], ['ajio', 'shopping'],
  ['meesho', 'shopping'], ['tata cliq', 'shopping'], ['croma', 'shopping'], ['reliance digital', 'shopping'], ['decathlon', 'shopping'],
  ['ikea', 'shopping'], ['h&m', 'shopping'], ['zara', 'shopping'], ['uniqlo', 'shopping'], ['lenskart', 'shopping'],
  ['westside', 'shopping'], ['lifestyle', 'shopping'], ['pantaloons', 'shopping'], ['firstcry', 'shopping'], ['snitch', 'shopping'],
  // health & fitness
  ['apollo', 'health'], ['pharmeasy', 'health'], ['1mg', 'health'], ['tata 1mg', 'health'], ['netmeds', 'health'],
  ['medplus', 'health'], ['practo', 'health'], ['cult fit', 'health'], ['cult.fit', 'health'], ['cultfit', 'health'],
  ['curefit', 'health'], ['healthifyme', 'health'], ['lal pathlabs', 'health'], ['thyrocare', 'health'], ['manipal', 'health'],
  ['fortis', 'health'], ['star health', 'health'],
  // personal care
  ['urban company', 'personal'], ['urbanclap', 'personal'], ['nykaa', 'personal'], ['lakme salon', 'personal'],
  ['naturals salon', 'personal'], ['enrich salon', 'personal'],
  // entertainment
  ['bookmyshow', 'entertainment'], ['pvr', 'entertainment'], ['inox', 'entertainment'], ['cinepolis', 'entertainment'],
  ['district', 'entertainment'], ['steam', 'entertainment'], ['playstation', 'entertainment'], ['paytm insider', 'entertainment'],
  ['smaaash', 'entertainment'], ['timezone', 'entertainment'],
  // education
  ['udemy', 'education'], ['coursera', 'education'], ['unacademy', 'education'], ['byjus', 'education'], ['upgrad', 'education'],
  ['scaler', 'education'], ['physicswallah', 'education'], ['simplilearn', 'education'], ['duolingo', 'education'],
  // rent
  ['nobroker rent', 'rent'], ['nobroker', 'rent'], ['nestaway', 'rent'], ['housing com', 'rent'], ['magicbricks', 'rent'],
  ['cred rent', 'rent'], ['zolo', 'rent'], ['stanza living', 'rent'],
  // EMI / loans
  ['loan emi', 'emi'], ['bajaj finance', 'emi'], ['bajaj finserv', 'emi'], ['home credit', 'emi'], ['tata capital', 'emi'],
  ['hdfc loan', 'emi'], ['icici loan', 'emi'], ['emi', 'emi'],
  // investments
  ['zerodha coin', 'investment'], ['zerodha', 'investment'], ['groww', 'investment'], ['nextbillion', 'investment'],
  ['kuvera', 'investment'], ['upstox', 'investment'], ['angel one', 'investment'], ['paytm money', 'investment'],
  ['indmoney', 'investment'], ['etmoney', 'investment'], ['bse star', 'investment'], ['nsdl', 'investment'], ['ppf', 'investment'],
  ['nps', 'investment'], ['lic', 'investment'], ['mutual fund', 'investment'], ['clearing corp', 'investment'], ['iccl', 'investment'],
];
const MERCHANTS_SORTED = [...MERCHANTS].sort((a, b) => b[0].length - a[0].length);

/** Keyword patterns on merchant + narration (weaker than a known merchant). */
const KEYWORDS: [RegExp, CategoryId][] = [
  [/\bsalary\b|\bsal\b|payroll|\bstipend\b/, 'income'],
  [/self transfer|own account|to self\b|\bself\b/, 'transfer'],
  [/credit card (bill )?payment|card payment|cc payment|\bcred\b.*\bbill|card bill/, 'transfer'],
  [/\brent\b|landlord|house owner|\bpg\b/, 'rent'],
  [/\bsip\b|mutual fund|\bmf\b|\bnav\b|\bfd\b|fixed deposit|\brd\b|recurring deposit/, 'investment'],
  [/\bemi\b|\bloan\b|\bnach\b|\bach d\b/, 'emi'],
  [/restaurant|\bcafe\b|coffee|kitchen|dhaba|biryani|pizza|burger|bakery|sweets|food|\bdine\b|eatery|canteen|bhojanalaya/, 'food'],
  [/grocery|groceries|kirana|supermarket|hypermarket|vegetable|fruits|dairy|\bmilk\b|provision/, 'groceries'],
  [/petrol|diesel|\bfuel\b|\bcab\b|taxi|\bauto\b|\bmetro\b|\btoll\b|parking|\bbus\b|railway/, 'transport'],
  [/flight|airline|airways|hotel|resort|travels?\b|holiday/, 'travel'],
  [/electricity|\bpower\b|recharge|broadband|fibernet|\bdth\b|\bgas\b|water bill|postpaid|prepaid|mobile bill|internet/, 'bills'],
  [/subscription|membership|premium|\bmonthly plan\b/, 'subscriptions'],
  [/pharmacy|medical|chemist|hospital|clinic|doctor|diagnostic|\blab\b|dental|\bgym\b|fitness|yoga/, 'health'],
  [/salon|spa\b|barber|parlour|parlor|grooming|laundry|dry clean/, 'personal'],
  [/movie|cinema|concert|\bevent\b|gaming|\bclub\b/, 'entertainment'],
  [/school|college|tuition|course|\bfees?\b|academy|institute|books?\b|exam/, 'education'],
  [/fashion|apparel|clothing|garments|footwear|electronics|\bmall\b|store\b|retail|mart\b/, 'shopping'],
  [/\binterest\b|dividend|cashback|\bbonus\b|reimbursement/, 'income'],
];

/**
 * Weak hints: words that suggest a category but are not reliable enough to
 * apply automatically ("Rasoi Express" → maybe Food). Used only for `suggested`.
 */
const HINTS: [RegExp, CategoryId][] = [
  [/rasoi|tiffin|bhavan|bhojan|thali|mess\b|udupi|chaat|momos?|rolls?\b|shawarma|juice|tea\b|chai|darshini|kitchen|express/, 'food'],
  [/general store|traders|provision|stores?\b|bazaar|fresh/, 'groceries'],
  [/motors|automobile|service station/, 'transport'],
  [/medicos?|pharma|health/, 'health'],
];

/** Finds the newest active rule matching a transaction (merchant key + scope). */
export function matchRule(t: { merchant: string; narration?: string; amount: number; account?: string }, rules: Rule[]): Rule | null {
  if (!rules.length) return null;
  const k = merchantKey(t.merchant);
  const nk = t.narration ? merchantKey(t.narration) : '';
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.merchantKey !== k && r.merchantKey !== nk) continue;
    if (r.scope === 'amount') {
      if (r.minAmount != null && t.amount < r.minAmount) continue;
      if (r.maxAmount != null && t.amount > r.maxAmount) continue;
    }
    if (r.scope === 'account' && r.account && r.account !== t.account) continue;
    // Newest wins; on equal timestamps the later one in the list wins.
    if (!best || r.createdAt >= best.createdAt) best = r;
  }
  return best;
}

/** Dictionary lookup on a merchant key (word-boundary phrase match). */
export function dictionaryCategory(key: string): CategoryId | null {
  if (!key) return null;
  const padded = ` ${key} `;
  for (const [phrase, cat] of MERCHANTS_SORTED) {
    if (padded.includes(` ${phrase} `)) return cat;
    // glued forms: "zerodhacoin", "cultfit" etc.
    if (/[\s.]/.test(phrase) && ` ${key.replace(/\s/g, '')} `.includes(` ${phrase.replace(/[\s.]/g, '')} `)) return cat;
  }
  return null;
}

function keywordCategory(text: string): CategoryId | null {
  const s = text.toLowerCase();
  for (const [re, cat] of KEYWORDS) if (re.test(s)) return cat;
  return null;
}

/** A weak guess for a low-confidence row (shown as "Maybe Food?"), or undefined. */
export function hintCategory(merchant: string, narration?: string): CategoryId | undefined {
  const s = `${merchant} ${narration ?? ''}`.toLowerCase();
  for (const [re, cat] of HINTS) if (re.test(s)) return cat;
  return undefined;
}

/** Categorises one raw transaction on the device: rules → type → dictionary → keywords → Others. */
export function categorizeLocal(raw: RawTxn, rules: Rule[]): { category: CategoryId; catSource: CatSource; confidence: number } {
  const rule = matchRule(raw, rules);
  if (rule) return { category: rule.category, catSource: 'rule', confidence: 0.98 };

  const key = merchantKey(raw.merchant);
  const nkey = raw.narration ? merchantKey(raw.narration) : '';
  const dict = dictionaryCategory(key) ?? dictionaryCategory(nkey);
  const text = `${raw.merchant} ${raw.narration ?? ''}`;
  const kw = keywordCategory(text);

  if (raw.type === 'income') {
    if (kw === 'transfer' || dict === 'investment') return { category: kw === 'transfer' ? 'transfer' : 'income', catSource: 'keyword', confidence: 0.8 };
    return { category: 'income', catSource: kw === 'income' ? 'keyword' : 'merchant', confidence: kw === 'income' ? 0.95 : 0.85 };
  }
  if (raw.type === 'investment') return { category: 'investment', catSource: 'merchant', confidence: 0.95 };
  if (raw.type === 'transfer') return { category: 'transfer', catSource: 'merchant', confidence: 0.95 };

  if (raw.category && isCategoryId(raw.category)) return { category: raw.category, catSource: 'merchant', confidence: 0.85 };
  if (dict && !(raw.type === 'refund' && !categoryInfo(dict).spend)) return { category: dict, catSource: 'merchant', confidence: 0.92 };
  if (kw && !(raw.type === 'refund' && !categoryInfo(kw).spend) && kw !== 'income') return { category: kw, catSource: 'keyword', confidence: 0.7 };
  return { category: 'other', catSource: 'default', confidence: 0.3 };
}

/** Keeps the transaction type consistent with its category (e.g. an expense filed as Investment becomes type 'investment'). */
export function alignType(type: TxnType, cat: CategoryId): TxnType {
  if (cat === 'investment') return type === 'income' || type === 'refund' ? type : 'investment';
  if (cat === 'transfer') return 'transfer';
  if (cat === 'income') return type === 'expense' || type === 'transfer' || type === 'investment' ? 'income' : type;
  // a spend category
  if (type === 'investment' || type === 'transfer') return 'expense';
  if (type === 'income') return 'refund';
  return type;
}

// ------------------------------------------------------------------ learning from corrections (L3)

/** Rough size bucket of an amount. */
export function amountBand(amount: number): AmountBand {
  if (amount < 200) return 'under 200';
  if (amount < 1000) return '200-1k';
  if (amount < 5000) return '1k-5k';
  if (amount < 25000) return '5k-25k';
  return 'over 25k';
}

/** The example stored when the user sets a row's category. */
export function correctionExample(t: Pick<Txn, 'merchant' | 'narration' | 'amount' | 'account'>, cat: CategoryId): CorrectionExample {
  return {
    merchant: (t.merchant || '').trim().slice(0, 60),
    narration: (t.narration ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    band: amountBand(t.amount),
    account: t.account,
    category: cat,
    at: new Date().toISOString(),
  };
}

/** Category families: an example in the same family is a closer hint than an unrelated one. */
const FAMILY: Partial<Record<CategoryId, string>> = {
  food: 'eat', groceries: 'eat',
  transport: 'move', travel: 'move',
  bills: 'home', subscriptions: 'home', rent: 'home', emi: 'home',
  shopping: 'buy', personal: 'buy', entertainment: 'buy',
  health: 'health', education: 'learn',
  income: 'money', transfer: 'money', investment: 'money',
};

function tokens(s: string): Set<string> {
  return new Set(merchantKey(s).split(' ').filter((w) => w.length >= 3));
}

/**
 * Up to [max] of the user's past corrections most relevant to these rows:
 * same merchant words first, then the same category family, then the newest.
 */
export function pickExamples(rows: Pick<Txn, 'merchant' | 'narration' | 'category' | 'suggested'>[], examples: CorrectionExample[], max = 15): CorrectionExample[] {
  if (!examples.length || !rows.length) return [];
  const words = new Set<string>();
  const families = new Set<string>();
  for (const r of rows) {
    for (const w of tokens(r.merchant)) words.add(w);
    const guess = r.suggested ?? (r.category !== 'other' ? r.category : hintCategory(r.merchant, r.narration));
    const f = guess ? FAMILY[guess] : undefined;
    if (f) families.add(f);
  }
  const scored = examples.map((e, i) => {
    let tier = 2;
    for (const w of tokens(e.merchant)) if (words.has(w)) { tier = 0; break; }
    if (tier === 2 && families.has(FAMILY[e.category] ?? '')) tier = 1;
    return { e, tier, i };
  });
  scored.sort((a, b) => a.tier - b.tier || b.i - a.i);
  const seen = new Set<string>();
  const out: CorrectionExample[] = [];
  for (const s of scored) {
    const k = `${merchantKey(s.e.merchant)}|${s.e.category}|${s.e.band}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.e);
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ Gemini

const AI_CATEGORIES = CATEGORIES.map((c) => c.id);

interface AiItem {
  i?: unknown;
  category?: unknown;
  confidence?: unknown;
}

/**
 * Asks Gemini about low-confidence rows (confidence < 0.6, not user/rule), ≤ 25 per call.
 * Sends only merchant + a short narration + amount band, plus up to 15 of the user's own past
 * corrections as examples so the answers follow their habits. Returns updated copies of the rows
 * it looked at; never throws. Confidence < 0.6 → suggestion only.
 * mode 'suggest' only fills `suggested` (used by the demo so the correction loop stays visible).
 */
export async function categorizeWithAI(txns: Txn[], mode: 'apply' | 'suggest' = 'apply', examples?: CorrectionExample[]): Promise<Txn[]> {
  let past: CorrectionExample[] = examples ?? [];
  if (!examples) {
    try {
      past = useStore.getState().corrections ?? [];
    } catch {
      past = [];
    }
  }
  const todo = txns.filter((t) => t.confidence < 0.6 && t.catSource !== 'user' && t.catSource !== 'rule');
  if (!todo.length) return [];
  // One question per distinct merchant (13 Rasoi Express rows = 1 question).
  const groups = new Map<string, Txn[]>();
  for (const t of todo) {
    const k = merchantKey(t.merchant) || t.merchant.toLowerCase();
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const keys = [...groups.keys()];
  const out: Txn[] = [];
  for (let start = 0; start < keys.length; start += 25) {
    const batch = keys.slice(start, start + 25);
    const firsts = batch.map((k) => groups.get(k)![0]);
    const items = firsts.map((t, i) => ({
      i,
      merchant: t.merchant.slice(0, 60),
      narration: (t.narration ?? '').slice(0, 80),
      direction: t.type === 'expense' ? 'money out' : 'money in',
      amount: amountBand(t.amount),
      ...(t.account ? { account: t.account } : {}),
    }));
    const shots = pickExamples(firsts, past, 15).map((e) => ({
      merchant: e.merchant,
      narration: e.narration,
      amount: e.band,
      ...(e.account ? { account: e.account } : {}),
      category: e.category,
    }));
    const habits = shots.length
      ? 'This user corrected these transactions before. Follow their habits: the same or a similar merchant, narration, amount and account ' +
        'should get the category they chose, even if you would pick another one.\n' + dataBlock('User examples', JSON.stringify(shots)) + '\n'
      : '';
    let reply: AiItem[] | { items?: AiItem[] } | null = null;
    try {
      reply = await geminiJSON<AiItem[] | { items?: AiItem[] }>(
        'You categorise Indian bank transactions for a budgeting app. For each item pick ONE category id from: ' +
          AI_CATEGORIES.join(', ') +
          '. Use "other" when unsure. Return a JSON array [{"i": number, "category": string, "confidence": number 0..1}]. ' +
          'Confidence must be honest: below 0.6 when the name alone is ambiguous and no user example matches.\n' +
          habits +
          dataBlock('Items', JSON.stringify(items)),
        { agent: 'categoriser', temperature: 0, timeoutMs: 25000 },
      );
    } catch {
      reply = null;
    }
    const list = Array.isArray(reply) ? reply : reply && Array.isArray(reply.items) ? reply.items : [];
    for (const it of list) {
      const idx = typeof it.i === 'number' ? it.i : Number(it.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= batch.length) continue;
      if (!isCategoryId(it.category)) continue;
      const cat = it.category;
      let conf = typeof it.confidence === 'number' ? it.confidence : Number(it.confidence);
      if (!isFinite(conf)) conf = 0.5;
      conf = Math.max(0, Math.min(0.95, conf));
      for (const t of groups.get(batch[idx]) ?? []) {
        // Income stays income; money out can't become income.
        if (t.type === 'expense' && cat === 'income') continue;
        if (mode === 'apply' && conf >= 0.6 && cat !== 'other') {
          out.push({ ...t, category: cat, type: alignType(t.type, cat), catSource: 'ai', confidence: conf, needsReview: conf < 0.75, suggested: undefined });
        } else if (cat !== t.category && cat !== 'other') {
          out.push({ ...t, suggested: cat, needsReview: true });
        }
      }
    }
  }
  return out;
}
