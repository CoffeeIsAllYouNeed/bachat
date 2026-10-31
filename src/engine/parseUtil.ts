/**
 * Small parsing helpers shared by the SMS / CSV / PDF readers.
 * Pure functions, no React, no store.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function validDate(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null; // 31 Feb etc.
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Finds the first date in a string (Indian formats) and returns ISO yyyy-mm-dd, or null. */
export function parseDateLoose(s: string): string | null {
  if (!s) return null;
  const text = s.trim();
  // yyyy-mm-dd / yyyy/mm/dd
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const r = validDate(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  // dd-mm-yy(yy), dd/mm/yy(yy), dd.mm.yyyy  (Indian: day first)
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const r = validDate(fullYear(+m[3]), +m[2], +m[1]);
    if (r) return r;
  }
  // dd-MMM-yy, dd MMM yyyy, 30Oct26, 30-Oct-2026, 30 October 2026
  for (const x of text.matchAll(/(?:^|[^\d])(\d{1,2})[\s\-/.]?([A-Za-z]{3,9})[\s\-/.,]*'?(\d{2,4})(?!\d)/g)) {
    const mon = monthOf(x[2]);
    if (mon) {
      const r = validDate(fullYear(+x[3]), mon, +x[1]);
      if (r) return r;
    }
  }
  // MMM dd, yyyy
  for (const x of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mon = monthOf(x[1]);
    if (mon) {
      const r = validDate(+x[3], mon, +x[2]);
      if (r) return r;
    }
  }
  return null;
}

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const k = w.startsWith('sept') ? 'sep' : w.slice(0, 3);
  const n = MONTHS[k];
  if (!n) return null;
  // Accept "oct", "sept" or a prefix of the full month name ("octo" ok, "october" ok, "octane" not).
  return full[n - 1].startsWith(w) || w === 'sept' ? n : null;
}

/** "1,23,456.50", "₹ 499", "INR 1,299.00", "2,000.00 Dr", "(450.00)" → number (sign kept for "-"/parentheses), or null. */
export function parseAmount(s: unknown): number | null {
  if (typeof s === 'number') return isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;
  let t = s.trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/(rs\.?|inr|₹)/gi, '').replace(/\b(cr|dr)\b\.?/gi, '').replace(/[\s,]/g, '');
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  if (!isFinite(v)) return null;
  return neg ? -v : v;
}

const BANKS: [RegExp, string][] = [
  [/\bhdfc/i, 'HDFC'],
  [/\bicici/i, 'ICICI'],
  [/\bsbi\b|state bank|sbiinb|sbiupi|sbmsms/i, 'SBI'],
  [/\baxis|axisbk/i, 'Axis'],
  [/\bkotak|kotakb/i, 'Kotak'],
  [/\byes ?bank|yesbnk/i, 'Yes Bank'],
  [/\bidfc/i, 'IDFC First'],
  [/\bindusind|indusb/i, 'IndusInd'],
  [/\bpnb\b|punjab national/i, 'PNB'],
  [/\bbank of baroda|\bbob\b|bobtxn/i, 'BoB'],
  [/\bcanara/i, 'Canara'],
  [/\bfederal/i, 'Federal'],
  [/\bau (small finance )?bank|aubank/i, 'AU Bank'],
  [/\bunion bank/i, 'Union Bank'],
  [/\bpaytm payments bank|paytmb/i, 'Paytm Bank'],
  [/\bairtel payments bank/i, 'Airtel Bank'],
];

/** Detects a bank name in an SMS / statement header, or null. */
export function detectBank(text: string): string | null {
  for (const [re, name] of BANKS) if (re.test(text)) return name;
  return null;
}

/** "HDFC ••1123", "HDFC Card ••4521", "A/c ••1123". */
export function accountLabel(bank: string | null, last4: string | null, card: boolean): string | undefined {
  if (!last4) return bank ? (card ? `${bank} Card` : bank) : undefined;
  const tail = last4.slice(-4);
  if (card) return `${bank ?? ''}${bank ? ' ' : ''}Card ••${tail}`;
  return `${bank ?? 'A/c'} ••${tail}`;
}

/** Short stable string hash (djb2, base36). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Base64 (no data: prefix) of an ArrayBuffer, without relying on btoa/Buffer. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Decodes base64 into a latin-1 string (for sniffing PDF headers). Reads at most maxBytes. */
export function base64ToLatin1(b64: string, maxBytes = Infinity): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const LUT = new Int16Array(128).fill(-1);
  for (let k = 0; k < A.length; k++) LUT[A.charCodeAt(k)] = k;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const at = (k: number) => (k < clean.length ? LUT[clean.charCodeAt(k)] : -1);
  const parts: string[] = [];
  let chunk = '';
  let produced = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = Math.max(at(i), 0);
    const b = at(i + 1);
    const c = at(i + 2);
    const d = at(i + 3);
    const n = (a << 18) | (Math.max(b, 0) << 12) | (Math.max(c, 0) << 6) | Math.max(d, 0);
    chunk += String.fromCharCode((n >> 16) & 255);
    if (c >= 0) chunk += String.fromCharCode((n >> 8) & 255);
    if (d >= 0) chunk += String.fromCharCode(n & 255);
    produced += 3;
    if (chunk.length > 8192) {
      parts.push(chunk);
      chunk = '';
    }
    if (produced >= maxBytes) break;
  }
  parts.push(chunk);
  return parts.join('');
}
