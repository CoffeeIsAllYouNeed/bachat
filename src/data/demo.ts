import type { CategoryId, RawTxn, TxnType } from './types';
import type { FamilyMember, FamilySnapshot } from './types';
import { todayISO } from './store';
import { money } from '@/theme/format';

/*
 * Deterministic demo data: 3 full months + the current month to date,
 * generated relative to today with a seeded PRNG (no Math.random).
 *
 * Story it supports (3-minute demo):
 *  - Salary ₹85,000 on the 1st, rent ₹22,000 to NoBroker on the 3rd, HDFC loan EMI ₹6,200.
 *  - Netflix ₹499 → ₹649 on the latest charge (price alert), YouTube Premium ₹2 trial → ₹149 (trial alert).
 *  - Rasoi Express (truth: Food) is NOT in the merchant dictionary → lands in Others with low
 *    confidence → user fixes one → "Rule learned … Updated N past transactions".
 *  - Food runs ~30% hotter this month (drift nudge).
 *  - SIPs to Zerodha Coin ₹3,000 and Groww ₹1,200, an HDFC → SBI self transfer every month,
 *    a credit-card bill payment (excluded), an Amazon refund linked to its order,
 *    balances from SMS-style "Avl Bal" rows.
 */

export type DemoRaw = RawTxn & { truth: CategoryId };

const HDFC = 'HDFC ••1123';
const SBI = 'SBI ••7781';
const CARD = 'HDFC Card ••4521';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const Mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** mulberry32: tiny seeded PRNG → [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function iso(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}
/** "30-10-26" */
function ddmmyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y.slice(2)}`;
}
/** "30-Oct-26" */
function ddMonyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${pad(d)}-${Mon[m - 1]}-${String(y).slice(2)}`;
}
function rs(v: number): string {
  return money(v, 2).replace('₹', 'Rs.');
}
function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

interface Ev extends DemoRaw {
  seq: number;
}

interface Pick {
  name: string;
  account: string;
  min: number;
  max: number;
  weight: number;
  narr: (ref: string) => string;
}

/** Builds the demo rows for a given "today" (ISO). Same input → same output. */
export function buildDemo(today: string = todayISO()): DemoRaw[] {
  const rnd = seeded(20261031);
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const ref = () => String(400000000000 + Math.floor(rnd() * 99999999999));
  const [ty, tm, td] = today.split('-').map(Number);
  const events: Ev[] = [];
  let seq = 0;
  const push = (e: DemoRaw) => events.push({ ...e, seq: seq++ });

  // months: 3 back … current
  const months: { y: number; m0: number; dim: number; limit: number; i: number; current: boolean }[] = [];
  for (let k = 3; k >= 0; k--) {
    const d = new Date(ty, tm - 1 - k, 1);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    months.push({ y: d.getFullYear(), m0: d.getMonth(), dim, limit: k === 0 ? td : dim, i: 3 - k, current: k === 0 });
  }

  // Netflix: the latest charge is the new price.
  const netflixDates = months.filter((mo) => 7 <= mo.limit).map((mo) => iso(mo.y, mo.m0, 7));
  const lastNetflix = netflixDates[netflixDates.length - 1];

  let prevCardSpend = 13480;

  for (const mo of months) {
    const { y, m0, limit, dim, i } = mo;
    const at = (day: number): string | null => (day <= limit ? iso(y, m0, Math.min(day, dim)) : null);
    const monthTag = `${MON[m0]} ${y}`;
    let cardSpend = 0;
    const card = (e: Omit<DemoRaw, 'account' | 'source'>) => {
      if (e.type === 'expense') cardSpend += e.amount;
      if (e.type === 'refund') cardSpend -= e.amount;
      push({ ...e, account: CARD, source: 'demo' });
    };
    const bank = (acct: string, e: Omit<DemoRaw, 'account' | 'source'>) => push({ ...e, account: acct, source: 'demo' });

    // ---- fixed / scheduled
    let d = at(1);
    if (d) bank(HDFC, { date: d, amount: 85000, type: 'income', merchant: 'Acme Technologies', narration: `NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY ${monthTag}`, truth: 'income' });
    d = at(3);
    if (d) bank(HDFC, { date: d, amount: 22000, type: 'expense', merchant: 'NoBroker Rent', narration: `UPI/${ref()}/NoBroker Rent/nobroker.rent@hdfcbank/Rent ${Mon[m0]}`, truth: 'rent' });
    d = at(5);
    if (d) bank(HDFC, { date: d, amount: 6200, type: 'expense', merchant: 'HDFC Loan EMI', narration: 'ACH D- HDFC BANK LTD-PERSONAL LOAN EMI 88213407', truth: 'emi' });
    d = at(7);
    if (d) card({ date: d, amount: d === lastNetflix ? 649 : 499, type: 'expense', merchant: 'Netflix', narration: 'NETFLIX.COM*SUBSCRIPTION MUMBAI', truth: 'subscriptions' });
    d = at(9);
    if (d) bank(HDFC, { date: d, amount: 599, type: 'expense', merchant: 'Airtel', narration: `UPI/${ref()}/Airtel Postpaid/airtelpostpaid@okicici/Bill`, truth: 'bills' });
    d = at(10);
    if (d) bank(HDFC, { date: d, amount: 3000, type: 'expense', merchant: 'Zerodha Coin', narration: 'ACH D- ZERODHA BROKING LTD-COIN SIP 7731', truth: 'investment' });
    d = at(12);
    if (d) card({ date: d, amount: 119, type: 'expense', merchant: 'Spotify', narration: 'SPOTIFY INDIA*PREMIUM', truth: 'subscriptions' });
    d = at(14);
    if (d) card({ date: d, amount: 1248, type: 'expense', merchant: 'Cult.fit', narration: 'CUREFIT HEALTHCARE*CULTPASS ELITE', truth: 'health' });
    d = at(15);
    if (d) bank(HDFC, { date: d, amount: 1200, type: 'expense', merchant: 'Groww', narration: 'ACH D- NEXTBILLION TECH-GROWW SIP 55120', truth: 'investment' });
    d = at(16);
    if (d) bank(HDFC, { date: d, amount: Math.round(prevCardSpend), type: 'expense', merchant: 'HDFC Credit Card Bill', narration: 'BILLDESK-HDFC CREDIT CARD PAYMENT XX4521', truth: 'transfer' });
    d = at(18);
    if (d && i >= 1) card({ date: d, amount: i === 1 ? 2 : 149, type: 'expense', merchant: 'YouTube Premium', narration: i === 1 ? 'GOOGLE*YOUTUBE PREMIUM TRIAL' : 'GOOGLE*YOUTUBE PREMIUM', truth: 'subscriptions' });
    d = at(20);
    if (d) bank(HDFC, { date: d, amount: between(1320, 2150), type: 'expense', merchant: 'Adani Electricity', narration: `BIL/ONL/${ref().slice(0, 9)}/ADANI ELECTRICITY MUMBAI LTD`, truth: 'bills' });
    d = at(25);
    if (d) {
      bank(HDFC, { date: d, amount: 10000, type: 'expense', merchant: 'Transfer to SBI ••7781', narration: 'IMPS-SELF TRANSFER-SBIN0001234-VRUSHAL MORE', truth: 'transfer' });
      bank(SBI, { date: d, amount: 10000, type: 'income', merchant: 'Transfer from HDFC ••1123', narration: 'IMPS-SELF TRANSFER-HDFC0000123-VRUSHAL MORE', truth: 'transfer' });
    }
    // One freelance invoice (irregular income) and one Amazon return.
    if (i === 1) {
      d = at(22);
      if (d) bank(SBI, { date: d, amount: 12000, type: 'income', merchant: 'Studio Pixel', narration: 'NEFT CR-ICIC0000104-STUDIO PIXEL LLP-INVOICE 014', truth: 'income' });
      d = at(8);
      if (d) card({ date: d, amount: 2499, type: 'expense', merchant: 'Amazon', narration: 'AMAZON PAY INDIA*ORDER 402-7781234', truth: 'shopping' });
      d = at(14);
      if (d) card({ date: d, amount: 2499, type: 'refund', merchant: 'Amazon', narration: 'REFUND AMAZON PAY INDIA*ORDER 402-7781234', truth: 'shopping' });
    }

    // ---- Rasoi Express: the unknown local restaurant (correction-loop demo)
    let rasoiTotal = 0;
    for (const day of [6, 16, 26]) {
      d = at(day);
      if (!d) continue;
      const amt = between(240, 420);
      rasoiTotal += amt;
      bank(day === 16 ? SBI : HDFC, { date: d, amount: amt, type: 'expense', merchant: 'Rasoi Express', narration: `UPI/${ref()}/RASOI EXPRESS/rasoiexpress@okaxis/Lunch`, truth: 'food' });
    }

    // ---- flexible spending, target-driven so the story is exact
    const share = limit / dim;
    const jitter = () => 0.94 + rnd() * 0.12;
    const spend = (cat: CategoryId, monthly: number, picks: Pick[], already = 0) => {
      const target = monthly * jitter() * share - already;
      if (target <= 0) return;
      const totalW = picks.reduce((s, p) => s + p.weight, 0);
      const orders: { p: Pick; amount: number }[] = [];
      let sum = 0;
      while (sum < target && orders.length < 60) {
        let x = rnd() * totalW;
        let p = picks[0];
        for (const c of picks) {
          x -= c.weight;
          if (x <= 0) {
            p = c;
            break;
          }
        }
        const amount = between(p.min, p.max);
        orders.push({ p, amount });
        sum += amount;
      }
      const n = orders.length;
      orders.forEach((o, j) => {
        const day = Math.max(1, Math.min(limit, 1 + Math.floor(((j + rnd() * 0.85) * limit) / n)));
        const date = iso(y, m0, day);
        const e = { date, amount: o.amount, type: 'expense' as TxnType, merchant: o.p.name, narration: o.p.narr(ref()), truth: cat };
        if (o.p.account === CARD) card(e);
        else bank(o.p.account, e);
      });
    };

    const foodBoost = mo.current ? 1.3 : 1;
    spend('food', 7600 * foodBoost, [
      { name: 'Swiggy', account: HDFC, min: 220, max: 680, weight: 45, narr: (r) => `UPI-SWIGGY-swiggy@icici-ICIC0DC0099-${r}-ORDER` },
      { name: 'Zomato', account: HDFC, min: 250, max: 720, weight: 30, narr: (r) => `UPI/${r}/Zomato Ltd/zomato@hdfcbank/Food order` },
      { name: 'Third Wave Coffee', account: CARD, min: 180, max: 420, weight: 12, narr: () => 'THIRD WAVE COFFEE*BANDRA MUMBAI' },
      { name: 'Chaayos', account: SBI, min: 120, max: 300, weight: 13, narr: (r) => `UPI/${r}/CHAAYOS/chaayos.andheri@ybl/Payment` },
    ], rasoiTotal);
    spend('groceries', 6200, [
      { name: 'BigBasket', account: CARD, min: 900, max: 2200, weight: 25, narr: () => 'BIGBASKET*INNOVATIVE RETAIL MUMBAI' },
      { name: 'Zepto', account: HDFC, min: 250, max: 900, weight: 30, narr: (r) => `UPI/${r}/Zepto/zeptonow@axisbank/Order` },
      { name: 'Blinkit', account: HDFC, min: 200, max: 800, weight: 25, narr: (r) => `UPI/${r}/Blinkit/blinkit.payu@hdfcbank/Order` },
      { name: 'DMart', account: SBI, min: 1200, max: 2400, weight: 10, narr: (r) => `UPI/${r}/AVENUE SUPERMARTS LTD/dmart@ybl/DMart` },
      { name: 'Sharma Kirana Store', account: SBI, min: 150, max: 500, weight: 10, narr: (r) => `UPI/${r}/SHARMA KIRANA STORE/sharmakirana@okicici/Payment` },
    ]);
    spend('transport', 3400, [
      { name: 'Uber', account: CARD, min: 180, max: 520, weight: 35, narr: () => 'UBER INDIA*TRIP HELP.UBER.COM' },
      { name: 'Ola', account: HDFC, min: 150, max: 420, weight: 20, narr: (r) => `UPI/${r}/ANI TECHNOLOGIES/olacabs@ybl/Ride` },
      { name: 'Rapido', account: HDFC, min: 60, max: 180, weight: 25, narr: (r) => `UPI/${r}/Rapido/rapido.bike@axl/Ride` },
      { name: 'Indian Oil', account: CARD, min: 1000, max: 1800, weight: 20, narr: () => 'INDIAN OIL*SAI FUELS ANDHERI MUMBAI' },
    ]);
    spend('shopping', i === 1 ? 1800 : 3800, [
      { name: 'Amazon', account: CARD, min: 299, max: 1899, weight: 45, narr: (r) => `AMAZON PAY INDIA*ORDER ${r.slice(0, 3)}-${r.slice(3, 10)}` },
      { name: 'Flipkart', account: CARD, min: 399, max: 1999, weight: 30, narr: () => 'FLIPKART INTERNET PVT LTD MUMBAI' },
      { name: 'Myntra', account: CARD, min: 799, max: 2299, weight: 25, narr: () => 'MYNTRA DESIGNS PVT LTD*ORDER' },
    ]);
    spend('health', 900, [
      { name: 'Apollo Pharmacy', account: HDFC, min: 180, max: 650, weight: 60, narr: (r) => `UPI/${r}/APOLLO PHARMACY/apollopharmacy@icici/Medicines` },
      { name: 'PharmEasy', account: CARD, min: 250, max: 900, weight: 40, narr: () => 'PHARMEASY*AXELIA SOLUTIONS' },
    ]);
    spend('entertainment', i % 2 === 0 ? 1100 : 600, [
      { name: 'BookMyShow', account: CARD, min: 350, max: 900, weight: 70, narr: () => 'BOOKMYSHOW*BIGTREE ENTERTAINMENT' },
      { name: 'PVR INOX', account: HDFC, min: 300, max: 700, weight: 30, narr: (r) => `UPI/${r}/PVR INOX LTD/pvrinox@icici/Tickets` },
    ]);
    if (i !== 2) {
      spend('personal', 700, [
        { name: 'Urban Company', account: CARD, min: 499, max: 1299, weight: 100, narr: () => 'URBANCLAP TECHNOLOGIES*SALON AT HOME' },
      ]);
    }

    prevCardSpend = Math.max(0, cardSpend);
  }

  // ---- chronological balances + SMS-style raw text
  events.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.seq - b.seq);
  const bal: Record<string, number> = { [HDFC]: 152340.5, [SBI]: 41200 };
  const out: DemoRaw[] = [];
  for (const e of events) {
    const { seq: _seq, ...row } = e;
    const inflow = row.type === 'income' || row.type === 'refund';
    if (row.account === HDFC || row.account === SBI) {
      const acct = row.account;
      bal[acct] = Math.round((bal[acct] + (inflow ? row.amount : -row.amount)) * 100) / 100;
      row.balanceAfter = bal[acct];
      const bankName = acct === HDFC ? 'HDFC Bank' : 'SBI';
      const last4 = acct === HDFC ? '1123' : '7781';
      row.raw = inflow
        ? `${bankName}: ${rs(row.amount)} credited to A/c XX${last4} on ${ddmmyy(row.date)} by ${row.narration}. Avl Bal ${rs(row.balanceAfter)}`
        : `${bankName}: ${rs(row.amount)} debited from A/c XX${last4} on ${ddmmyy(row.date)} to ${row.merchant} (${row.narration}). Avl Bal ${rs(row.balanceAfter)}`;
    } else {
      row.raw = inflow
        ? `HDFC Bank Card XX4521: ${rs(row.amount)} refund credited from ${row.merchant} on ${ddMonyy(row.date)}.`
        : `HDFC Bank Card XX4521: ${rs(row.amount)} spent at ${row.narration} on ${ddMonyy(row.date)}.`;
    }
    out.push(row);
  }
  return out;
}

function rank(e: DemoRaw): number {
  return e.type === 'income' ? 0 : 1;
}

/** The demo rows (rebuilt relative to today when the app starts). */
export const DEMO_RAWS: DemoRaw[] = buildDemo();

/** True category for each demo merchant (stable across days; used by accuracy()). */
export function demoTruthByMerchant(): Map<string, CategoryId> {
  const m = new Map<string, CategoryId>();
  for (const r of DEMO_RAWS) m.set(r.merchant, r.truth);
  return m;
}

function lastBalance(account: string): number {
  for (let i = DEMO_RAWS.length - 1; i >= 0; i--) {
    const r = DEMO_RAWS[i];
    if (r.account === account && r.balanceAfter != null) return r.balanceAfter;
  }
  return 50000;
}

function buildSmsSample(): string {
  const today = todayISO();
  const yday = addDays(today, -1);
  const d2 = addDays(today, -2);
  const [y, m, d] = today.split('-').map(Number);
  const compact = `${pad(d)}${Mon[m - 1]}${String(y).slice(2)}`;
  const hdfc = lastBalance(HDFC) - 349;
  const sbi = lastBalance(SBI) - 2000;
  return [
    `VM-HDFCBK: Rs.349.00 debited from A/c XX1123 on ${ddmmyy(today)} to VPA swiggy@icici (UPI Ref No 430212345678). Not you? Call 18002586161. Avl Bal ${rs(hdfc)}`,
    `AD-HDFCBK: Rs.1,299.00 spent on HDFC Bank Card XX4521 at MYNTRA DESIGNS on ${ddMonyy(yday)}. Avl Lmt: Rs.1,48,701.00. To dispute, call 18002586161`,
    `JD-SBIUPI: Dear UPI user A/C X7781 debited by 420.0 on date ${compact} trf to Rasoi Express Refno 430398765432. If not u? call 1800111109. -SBI`,
    `JM-SBIINB: Received Rs.2,500.00 in your SBI A/c X7781 from priya.s@okaxis on ${ddmmyy(d2)}. UPI Ref 430187654321.`,
    `VM-SBIINB: Rs 2,000.00 withdrawn at ATM S1AW0123 from A/c no. XX7781 on ${ddmmyy(yday)}. Avl Bal: ${rs(sbi)}`,
    `BZ-HDFCBK: 482913 is your OTP for a transaction of Rs.5,000.00 at AMAZON. Valid for 5 mins. Do not share it with anyone.`,
  ].join('\n\n');
}

/** Five realistic Indian bank SMS (plus one OTP that is skipped) for the "Paste SMS" demo. */
export const DEMO_SMS_SAMPLE: string = buildSmsSample();

function buildCsvSample(): string {
  const today = todayISO();
  const rows: [number, string, number | null, number | null][] = [
    [-11, 'UPI/430112233445/CHAI POINT/chaipoint@ybl/Payment', 180, null],
    [-10, 'UPI/430198877665/CROMA RETAIL/croma@hdfcbank/Earphones', 3499, null],
    [-8, 'NEFT CR-SBIN0004411-MEERA SINGH-BIRTHDAY GIFT', null, 5000],
    [-7, 'UPI/430155544433/SHARMA KIRANA STORE/sharmakirana@okicici/Payment', 640, null],
    [-5, 'UPI/430166677788/INDIAN OIL/iocl.fuel@icici/Fuel', 1500, null],
    [-4, 'UPI/430177788899/URBAN COMPANY/urbancompany@ybl/Cleaning', 899, null],
    [-2, 'UPI/430188899900/LAKEVIEW TIFFIN CENTRE/lakeviewtiffin@okaxis/Lunch', 160, null],
    [-1, 'SB INTEREST CREDIT XXXXXXXX6620', null, 412],
  ];
  let bal = 64210.35;
  const lines = [
    'ICICI Bank Limited,,,,,,,',
    'Detailed Statement,,,,,,,',
    'Account Number,XXXXXXXX6620,,,,,,',
    ',,,,,,,',
    'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )',
  ];
  rows.forEach(([off, remark, wd, dep], i) => {
    const date = addDays(today, off);
    const [y, m, d] = date.split('-');
    const dmy = `${d}/${m}/${y}`;
    bal = Math.round((bal - (wd ?? 0) + (dep ?? 0)) * 100) / 100;
    const fmt = (v: number | null) => (v == null ? '0.00' : `"${money(v, 2).replace('₹', '')}"`);
    lines.push([i + 1, dmy, dmy, '-', remark, fmt(wd), fmt(dep), `"${money(bal, 2).replace('₹', '')}"`].join(','));
  });
  return lines.join('\n');
}

/** A small ICICI-style statement CSV (preamble + header + 8 rows) for trying the CSV importer. */
export const DEMO_CSV_SAMPLE: string = buildCsvSample();

/** The demo user (set by loadDemo when the user hasn't typed their own name). */
export const DEMO_PROFILE = { name: 'Vrushal More', email: 'vrushal.more@example.com', city: 'Mumbai' };

/**
 * The bundled bank SMS inbox (~40 messages over 3 months, oldest first), generated
 * relative to [today] and deterministic for a given day. Used by "Read bank SMS"
 * when the build has no native SMS reader. Every message goes through the normal
 * parser (src/engine/sms.ts); the one OTP is skipped there.
 * Salary, rent, EMI, Swiggy/Zomato (some late at night), Netflix ₹499 → ₹649,
 * YouTube Premium ₹2 trial → ₹149, Spotify, Uber, Amazon, BigBasket, a UPI credit.
 */
export function buildDemoSms(today: string = todayISO()): string[] {
  const rnd = seeded(20261101);
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const ref = () => String(430000000000 + Math.floor(rnd() * 999999999));
  const [ty, tm, td] = today.split('-').map(Number);
  const events: { date: string; seq: number; hdfc: number; render: (bal: number) => string }[] = [];
  let seq = 0;
  const add = (date: string, hdfc: number, render: (bal: number) => string) => events.push({ date, seq: seq++, hdfc, render });

  const upi = (date: string, amount: number, vpa: string, time?: string) =>
    add(date, -amount, (bal) =>
      `VM-HDFCBK: ${rs(amount)} debited from A/c XX1123 on ${ddmmyy(date)}${time ? ` ${time}` : ''} to VPA ${vpa} (UPI Ref No ${ref()}). Not you? Call 18002586161. Avl Bal ${rs(bal)}`);
  const cardSpend = (date: string, amount: number, at: string) =>
    add(date, 0, () => `AD-HDFCBK: ${rs(amount)} spent on HDFC Bank Card XX4521 at ${at} on ${ddMonyy(date)}. Avl Lmt: Rs.1,48,701.00. To dispute, call 18002586161`);

  const months: { y: number; m0: number; dim: number; limit: number; k: number }[] = [];
  for (let k = 2; k >= 0; k--) {
    const d = new Date(ty, tm - 1 - k, 1);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    months.push({ y: d.getFullYear(), m0: d.getMonth(), dim, limit: k === 0 ? td : dim, k });
  }
  const netflixDays = months.filter((mo) => mo.limit >= 7).map((mo) => iso(mo.y, mo.m0, 7));
  const lastNetflix = netflixDays[netflixDays.length - 1];
  const LATE = ['22:47', '13:05', '23:18', '20:31', '23:52', '21:10', '22:15'];
  let food = 0;

  for (const mo of months) {
    const at = (day: number): string | null => (day <= mo.limit ? iso(mo.y, mo.m0, Math.min(day, mo.dim)) : null);
    let d = at(1);
    if (d) {
      const date = d;
      add(date, 85000, (bal) =>
        `VM-HDFCBK: Rs.85,000.00 credited to A/c XX1123 on ${ddmmyy(date)} by NEFT from ACME TECHNOLOGIES PVT LTD - SALARY ${MON[mo.m0]}. Avl Bal ${rs(bal)}`);
    }
    d = at(3);
    if (d) upi(d, 22000, 'nobroker.rent@hdfcbank');
    d = at(5);
    if (d) {
      const date = d;
      add(date, -6200, (bal) => `VM-HDFCBK: Rs.6,200.00 debited from A/c XX1123 on ${ddmmyy(date)} towards HDFC LOAN EMI 88213407. Avl Bal ${rs(bal)}`);
    }
    d = at(7);
    if (d) cardSpend(d, d === lastNetflix ? 649 : 499, 'NETFLIX COM');
    d = at(9);
    if (d) cardSpend(d, between(499, 1899), 'AMAZON PAY INDIA');
    d = at(11);
    if (d) cardSpend(d, between(900, 2200), 'BIGBASKET');
    d = at(12);
    if (d) cardSpend(d, 119, 'SPOTIFY INDIA');
    d = at(16);
    if (d) cardSpend(d, between(180, 420), 'UBER INDIA');
    d = at(18);
    if (d) cardSpend(d, mo.k === 2 ? 2 : 149, 'YOUTUBE PREMIUM');
    d = at(24);
    if (d) cardSpend(d, between(180, 420), 'UBER INDIA');
    if (mo.k === 1) {
      d = at(22);
      if (d) {
        const date = d;
        add(date, 0, () => `JM-SBIINB: Received Rs.2,500.00 in your SBI A/c X7781 from priya.s@okaxis on ${ddmmyy(date)}. UPI Ref ${ref()}.`);
      }
    }
    // Food delivery picks up this month (more orders, several late at night).
    for (const day of mo.k === 0 ? [2, 6, 10, 14, 20, 26] : [6, 15, 27]) {
      d = at(day);
      if (!d) continue;
      const time = LATE[food % LATE.length];
      upi(d, between(280, 620), food % 2 === 0 ? 'swiggy@icici' : 'zomato@hdfcbank', time);
      food++;
    }
  }
  // One OTP (skipped by the parser).
  add(today, 0, () => `BZ-HDFCBK: 482913 is your OTP for a transaction of Rs.5,000.00 at AMAZON. Valid for 5 mins. Do not share it with anyone.`);

  events.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  let bal = 96500.4;
  return events.map((e) => {
    bal = Math.round((bal + e.hdfc) * 100) / 100;
    return e.render(bal);
  });
}

/** Today's bundled bank SMS inbox (see buildDemoSms). */
export const DEMO_SMS: string[] = buildDemoSms();

// ------------------------------------------------------------------ demo family

/** Id of the demo shared goal (contributions from the demo members). */
export const DEMO_FAMILY_GOAL_ID = 'demo-family-goa';

export interface DemoFamily {
  members: FamilyMember[];
  snapshots: Record<string, FamilySnapshot>;
}

/**
 * Two demo family members shown while the demo is loaded and no real household
 * exists: Priya More (spouse, shares transactions) and Suresh More (father,
 * totals only). Deterministic for a given day. Netflix (×3) and Spotify (×2)
 * overlap with the demo user, so "Duplicates across family" has something to show.
 */
export function buildDemoFamily(today: string = todayISO()): DemoFamily {
  const rnd = seeded(20261102);
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const [ty, tm, td] = today.split('-').map(Number);
  const month = today.slice(0, 7);
  const dim = new Date(ty, tm, 0).getDate();
  const share = td / dim;
  const at = `${today}T07:30:00.000Z`;
  const due = (() => {
    const d = new Date(ty, tm - 1 + 4, 1);
    return iso(d.getFullYear(), d.getMonth(), 15);
  })();
  const sharedGoal = { id: DEMO_FAMILY_GOAL_ID, name: 'Goa trip', emoji: '🏖️', target: 60000, due, updatedAt: at };
  const familyBudgets: Partial<Record<CategoryId, number>> = { food: 16000, groceries: 9000, shopping: 8000 };

  // ---- Priya: 90 days of transactions (share = full); her month totals come from them.
  type Row = NonNullable<FamilySnapshot['txns']>[number];
  const rows: Row[] = [];
  const add = (date: string | null, amount: number, merchant: string, category: CategoryId, type: TxnType = 'expense') => {
    if (date) rows.push({ date, amount, merchant, category, type });
  };
  for (let k = 3; k >= 0; k--) {
    const first = new Date(ty, tm - 1 - k, 1);
    const y = first.getFullYear();
    const m0 = first.getMonth();
    const days = new Date(y, m0 + 1, 0).getDate();
    const limit = k === 0 ? td : days;
    const on = (day: number): string | null => (day <= limit ? iso(y, m0, Math.min(day, days)) : null);
    add(on(1), 72000, 'Brightline Design', 'income', 'income');
    add(on(8), 399, 'Jio', 'bills');
    add(on(11), 649, 'Netflix', 'subscriptions');
    add(on(12), 119, 'Spotify', 'subscriptions');
    add(on(20), 299, 'Disney+ Hotstar', 'subscriptions');
    const spread = (n: number, fn: (day: number) => void) => {
      for (let j = 0; j < n; j++) fn(Math.max(1, Math.min(days, 1 + Math.floor(((j + rnd() * 0.9) * days) / n))));
    };
    spread(12, (d) => add(on(d), between(240, 640), rnd() < 0.55 ? 'Swiggy' : 'Zomato', 'food'));
    spread(8, (d) => add(on(d), between(150, 460), 'Uber', 'transport'));
    spread(3, (d) => add(on(d), between(650, 2400), rnd() < 0.5 ? 'Myntra' : 'Nykaa', 'shopping'));
    spread(4, (d) => add(on(d), between(280, 820), 'Zepto', 'groceries'));
    spread(2, (d) => add(on(d), between(400, 1100), 'Urban Company', 'personal'));
  }
  const cutoff = (() => {
    const d = new Date(ty, tm - 1, td - 90);
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  })();
  const priyaTxns = rows.filter((r) => r.date >= cutoff && r.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const priyaBy: Partial<Record<CategoryId, number>> = {};
  let priyaIncome = 0;
  for (const r of priyaTxns) {
    if (r.date.slice(0, 7) !== month) continue;
    if (r.type === 'income') priyaIncome += r.amount;
    else priyaBy[r.category] = (priyaBy[r.category] ?? 0) + r.amount;
  }
  const priyaSpend = Object.values(priyaBy).reduce<number>((s, v) => s + (v ?? 0), 0);

  // ---- Suresh: totals only.
  const sureshBy: Partial<Record<CategoryId, number>> = {};
  const monthly: [CategoryId, number][] = [['groceries', 6500], ['health', 3200], ['bills', 2400], ['transport', 900], ['subscriptions', 324], ['other', 1000]];
  for (const [cat, v] of monthly) sureshBy[cat] = Math.round(v * share * (0.92 + rnd() * 0.16));
  const sureshSpend = Object.values(sureshBy).reduce<number>((s, v) => s + (v ?? 0), 0);

  const priya: FamilySnapshot = {
    v: 1, memberId: 'demo-priya', name: 'Priya More', share: 'full', month, updatedAt: at,
    income: priyaIncome, spend: priyaSpend, byCategory: priyaBy, savings: priyaIncome - priyaSpend,
    emergencyFund: 60000, fixedCosts: 2000,
    goals: [{ name: 'Europe trip', target: 250000, saved: 60000 }],
    recurring: [
      { name: 'Netflix', monthly: 649, category: 'subscriptions' },
      { name: 'Spotify', monthly: 119, category: 'subscriptions' },
      { name: 'Disney+ Hotstar', monthly: 299, category: 'subscriptions' },
      { name: 'Jio', monthly: 399, category: 'bills' },
    ],
    familyBudgets, budgetsAt: at,
    sharedGoals: [sharedGoal], contributions: { [DEMO_FAMILY_GOAL_ID]: 10000 },
    txns: priyaTxns,
  };
  const suresh: FamilySnapshot = {
    v: 1, memberId: 'demo-suresh', name: 'Suresh More', share: 'totals', month, updatedAt: at,
    income: 45000, spend: sureshSpend, byCategory: sureshBy, savings: 45000 - sureshSpend,
    emergencyFund: 300000, fixedCosts: 4000,
    goals: [{ name: 'Health cover top-up', target: 50000, saved: 20000 }],
    recurring: [
      { name: 'Netflix', monthly: 199, category: 'subscriptions' },
      { name: 'Amazon Prime', monthly: 125, category: 'subscriptions' },
      { name: 'Airtel DTH', monthly: 450, category: 'bills' },
    ],
    familyBudgets: {}, sharedGoals: [sharedGoal], contributions: { [DEMO_FAMILY_GOAL_ID]: 5000 },
  };
  return {
    members: [
      { id: priya.memberId, name: priya.name, relation: 'Spouse', share: 'full', lastSync: at },
      { id: suresh.memberId, name: suresh.name, relation: 'Father', share: 'totals', lastSync: at },
    ],
    snapshots: { [priya.memberId]: priya, [suresh.memberId]: suresh },
  };
}
