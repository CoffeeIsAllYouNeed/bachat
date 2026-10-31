/**
 * Merchant name normalisation.
 * merchantKey("UPI-SWIGGY*ORDER 123/BLR") → "swiggy"
 * displayName("UPI/412345678901/RASOI EXPRESS/rasoiexp@okaxis") → "Rasoi Express"
 */

/** Payment-rail prefixes and filler words that never identify a merchant. */
const NOISE = new Set([
  'upi', 'pos', 'imps', 'neft', 'rtgs', 'ach', 'nach', 'ecs', 'ecom', 'txn', 'trxn', 'tran', 'ref', 'refno', 'rrn', 'utr',
  'payment', 'payments', 'paid', 'pay', 'to', 'at', 'via', 'by', 'from', 'info', 'bil', 'onl', 'mob', 'mb', 'ib', 'inb', 'net',
  'debit', 'credit', 'dr', 'cr', 'purchase', 'trf', 'transfer', 'p2a', 'p2m', 'p2p', 'collect', 'request', 'order', 'orders',
  'the', 'of', 'and', 'for', 'on', 'no', 'vpa', 'a/c', 'ac', 'acct', 'xx', 'card', 'visa', 'mastercard', 'rupay', 'ltd', 'pvt',
  'private', 'limited', 'llp', 'inc', 'co', 'corp', 'company', 'india', 'ind', 'in', 'www', 'com', 'http', 'https',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

/** City / location suffixes banks append to card and POS narrations. */
const CITIES = new Set([
  'blr', 'bangalore', 'bengaluru', 'bengaluu', 'mumbai', 'mum', 'bom', 'delhi', 'ndl', 'del', 'hyd', 'hyderabad', 'chennai',
  'maa', 'pune', 'pnq', 'gurgaon', 'gurugram', 'ggn', 'noida', 'kolkata', 'ccu', 'thane', 'navi', 'ahmedabad', 'amd',
  'jaipur', 'kochi', 'cochin', 'chandigarh', 'lucknow', 'indore', 'bhopal', 'nagpur', 'goa', 'mysore', 'mysuru',
]);

/** UPI handle suffixes ("@okaxis") that are bank names, not merchants. */
const HANDLES = new Set([
  'okaxis', 'oksbi', 'okicici', 'okhdfcbank', 'ybl', 'ibl', 'axl', 'paytm', 'apl', 'upi', 'icici', 'hdfcbank', 'sbi',
  'axisbank', 'kotak', 'yesbank', 'airtel', 'jio', 'freecharge', 'ptyes', 'ptsbi', 'pthdfc', 'ptaxis', 'idfcbank', 'axisb',
]);

/** Pretty spellings for well-known names (keys are merchant keys). */
const PRETTY: Record<string, string> = {
  nobroker: 'NoBroker', 'nobroker rent': 'NoBroker Rent', irctc: 'IRCTC', youtube: 'YouTube', 'youtube premium': 'YouTube Premium',
  bigbasket: 'BigBasket', pharmeasy: 'PharmEasy', 'cult fit': 'Cult.fit', cultfit: 'Cult.fit', 'cult.fit': 'Cult.fit',
  bescom: 'BESCOM', lic: 'LIC', hdfc: 'HDFC', sbi: 'SBI', icici: 'ICICI', makemytrip: 'MakeMyTrip', bookmyshow: 'BookMyShow',
  dmart: 'DMart', jiomart: 'JioMart', phonepe: 'PhonePe', gpay: 'GPay', 'amazon pay': 'Amazon Pay', ola: 'Ola', kfc: 'KFC',
  jio: 'Jio', 'jio fiber': 'Jio Fiber', zomato: 'Zomato', uber: 'Uber', dominos: "Domino's", 'swiggy instamart': 'Swiggy Instamart',
  pvr: 'PVR','pvr inox': 'PVR INOX', atm: 'ATM', emi: 'EMI', 'zerodha coin': 'Zerodha Coin', iocl: 'IOCL', hpcl: 'HPCL', bpcl: 'BPCL',
};

/** Normalised merchant key: lowercase, no rails/refs/cities/legal suffixes; e.g. "UPI-SWIGGY*ORDER 123/BLR" → "swiggy". */
export function merchantKey(name: string): string {
  if (!name) return '';
  let s = name.toLowerCase();
  // "swiggy*order 123" → keep what is before the star (POS descriptors)
  s = s.replace(/\*[^\s/|-]*/g, ' ');
  // Drop URLs and e-mail-ish noise but keep UPI handles to inspect.
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/[|/\\_:;,#()[\]{}"'`~!=+<>?]/g, ' ').replace(/\s-\s|-/g, ' ');
  const raw = s.split(/\s+/).filter(Boolean);

  const words: string[] = [];
  const vpaNames: string[] = [];
  for (let tok of raw) {
    tok = tok.replace(/^\.+|\.+$/g, '');
    if (!tok) continue;
    if (tok.includes('@')) {
      const [user, host] = tok.split('@');
      const clean = (user ?? '').replace(/[0-9]+/g, '').replace(/[._]+/g, ' ').trim();
      if (clean && (!host || HANDLES.has(host) || host.length <= 12)) vpaNames.push(clean);
      continue;
    }
    if (/\d/.test(tok)) {
      // digits-only, refs, IFSC (HDFC0001234), masked account numbers (xx1123)
      const letters = tok.replace(/[^a-z]/g, '');
      if (/^\d+$/.test(tok) || /^[a-z]{4}0[a-z0-9]{6}$/.test(tok) || /^x+\d+$/.test(tok) || letters.length < 3 || tok.length - letters.length >= 3) continue;
    }
    if (tok.includes('.') && !/^[a-z]+\.[a-z]+$/.test(tok)) tok = tok.replace(/\./g, '');
    if (NOISE.has(tok) || CITIES.has(tok)) continue;
    if (tok.length === 1 && !/[a-z]/.test(tok)) continue;
    if (/^x+$/.test(tok)) continue;
    words.push(tok);
  }

  let picked = dedupe(words).slice(0, 3);
  if (!picked.length && vpaNames.length) picked = dedupe(vpaNames.join(' ').split(' ')).slice(0, 3);
  // Lone single letters left over ("s" from "priya s") are fine only next to a word.
  const key = picked.join(' ').replace(/\s+/g, ' ').trim();
  return key || name.toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 30);
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const w of list) if (!out.includes(w)) out.push(w);
  return out;
}

/** Title-cased clean name for display ("swiggy" → "Swiggy", "nobroker rent" → "NoBroker Rent"). */
export function displayName(name: string): string {
  const key = merchantKey(name);
  if (!key) return name.trim();
  if (PRETTY[key]) return PRETTY[key];
  return key
    .split(' ')
    .map((w) => PRETTY[w] ?? (w.length <= 3 && /^[a-z]+$/.test(w) && !COMMON_SHORT.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Short words that are real words, not acronyms. */
const COMMON_SHORT = new Set(['ola', 'cab', 'car', 'bar', 'tea', 'pay', 'the', 'one', 'max', 'zip', 'box', 'bus', 'gym', 'kfc', 'spa', 'dr', 'mr', 'mrs', 'ms', 'sri', 'shri', 'pet', 'oil', 'gas', 'fit', 'go', 'my', 'big', 'new', 'fun', 'zoo', 'auto', 'mom', 'dad', 'son', 'ram', 'ali', 'raj', 'dev', 'sai', 'om', 's']);
