import type { RawTxn } from '@/data/types';
import { displayName, merchantKey } from './merchant';
import { accountLabel, detectBank, parseAmount, parseDateLoose } from './parseUtil';

/*
 * Deterministic table parser for text taken from a bank statement PDF
 * (pdf.js text layer or OCR). Built for the common Indian layouts
 * (HDFC, ICICI, SBI, Axis, Kotak): date · narration · [ref] · [value date] ·
 * debit · credit · balance, or date · narration · amount · Dr/Cr · balance.
 * Multi-line narrations are joined. Rows it can't place are left out, and the
 * caller falls back to Gemini when too few rows come out.
 */

/** One piece of text on a line: left x, width, text. */
export interface PdfCell {
  x: number;
  w: number;
  s: string;
}

/** One visual line (cells left → right). Lines in a page are ordered top → bottom. */
export interface PdfLine {
  y: number;
  cells: PdfCell[];
}

export interface TableParse {
  rows: RawTxn[];
  bank: string | null;
  /** Lines that start with a date (possible transactions). */
  datedLines: number;
  /** True when a column header was found. */
  header: boolean;
}

type Col = 'date' | 'valueDate' | 'narration' | 'ref' | 'debit' | 'credit' | 'amount' | 'drcr' | 'balance';

interface HeaderCol {
  col: Col;
  x0: number;
  x1: number;
}

const HEAD: [RegExp, Col][] = [
  [/^value\s*(dt|date)$/, 'valueDate'],
  [/^(txn|tran|transaction|post(ing)?|book(ing)?)?\s*(dt|date)$/, 'date'],
  [/narration|description|particulars|details|remarks|transaction\s*details/, 'narration'],
  [/chq|cheque|ref(erence)?|instr/, 'ref'],
  [/withdrawal|debit|^dr\.?$|paid\s*out|debits/, 'debit'],
  [/deposit|credit|^cr\.?$|paid\s*in|credits/, 'credit'],
  [/^(dr\s*\/\s*cr|cr\s*\/\s*dr|type)$/, 'drcr'],
  [/^amount(\s*\(?(inr|rs\.?|₹)\)?)?$/, 'amount'],
  [/balance/, 'balance'],
];

/** A narration wraps onto at most this many lines; more is page footer text. */
const MAX_NARRATION_LINES = 4;

const SKIP =/^(opening|closing) balance|^total|brought forward|carried forward|^b\/f|^c\/f|statement summary|^page \d|end of statement/i;

/** "1,23,456.50", "450.00 Cr", "(450.00)" — an amount with paise, the way statements print them. */
const AMOUNT_RE = /^\(?-?(?:₹|rs\.?|inr)?\s*\d[\d,]*\.\d{2}\)?\s*(?:cr|dr)?\.?$/i;

function isAmount(s: string): boolean {
  return AMOUNT_RE.test(s.trim());
}

function amountOf(s: string): number {
  const v = parseAmount(s.replace(/\s*(cr|dr)\.?$/i, ''));
  return v != null && isFinite(v) ? Math.abs(v) : 0;
}

function suffixOf(s: string): 'cr' | 'dr' | null {
  const m = s.trim().match(/(cr|dr)\.?$/i);
  return m ? (m[1].toLowerCase() as 'cr' | 'dr') : null;
}

const DATE_START = /^(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,9})[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[A-Za-z]{3}\d{2,4})/;

/** Date at the very start of a text, or null. */
function leadingDate(s: string): { iso: string; len: number } | null {
  const m = s.trim().match(DATE_START);
  if (!m) return null;
  const iso = parseDateLoose(m[1]);
  return iso ? { iso, len: m[0].length } : null;
}

function lineText(l: PdfLine): string {
  return l.cells.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
}

/** Merges cells that touch (split words) so columns hold whole values. */
function mergeCells(cells: PdfCell[], gap: number): PdfCell[] {
  const out: PdfCell[] = [];
  for (const c of [...cells].sort((a, b) => a.x - b.x)) {
    const last = out[out.length - 1];
    if (last && c.x - (last.x + last.w) <= gap && !(isAmount(last.s) || isAmount(c.s))) {
      last.s = `${last.s} ${c.s}`.replace(/\s+/g, ' ');
      last.w = Math.max(last.w, c.x + c.w - last.x);
    } else out.push({ ...c });
  }
  return out;
}

function findHeader(line: PdfLine): HeaderCol[] | null {
  const cols: HeaderCol[] = [];
  for (const c of line.cells) {
    const t = c.s.toLowerCase().replace(/[^a-z/ .₹()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const hit = HEAD.find(([re]) => re.test(t));
    if (!hit) continue;
    if (cols.some((k) => k.col === hit[1])) continue;
    cols.push({ col: hit[1], x0: c.x, x1: c.x + Math.max(c.w, 1) });
  }
  const has = (k: Col) => cols.some((c) => c.col === k);
  const money = (has('debit') && has('credit')) || has('amount');
  if (!has('date') || !has('narration') || !money) return null;
  return cols.sort((a, b) => a.x0 - b.x0);
}

/** Column for a cell: amounts line up by their right edge, text by its left edge. */
function columnOf(cell: PdfCell, header: HeaderCol[]): Col | null {
  const numeric = isAmount(cell.s);
  let best: HeaderCol | null = null;
  let bestD = Infinity;
  for (const h of header) {
    const isNumCol = h.col === 'debit' || h.col === 'credit' || h.col === 'amount' || h.col === 'balance';
    if (numeric !== isNumCol && h.col !== 'drcr') continue;
    const d = numeric ? Math.abs(cell.x + cell.w - h.x1) : cell.x >= h.x0 - 4 ? Math.abs(cell.x - h.x0) : (h.x0 - cell.x) * 2;
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (!best) return null;
  // Narration cells that drift right of their header still belong to the nearest text column on their left.
  if (!numeric) {
    const left = header.filter((h) => h.x0 <= cell.x + 4 && h.col !== 'debit' && h.col !== 'credit' && h.col !== 'amount' && h.col !== 'balance');
    if (left.length) return left[left.length - 1].col;
  }
  return best.col;
}

interface Pending {
  date: string;
  text: string[];
  debit: number;
  credit: number;
  amount: number;
  drcr: 'cr' | 'dr' | null;
  balance: number;
}

/** Builds a RawTxn from statement columns; null for junk (both/neither side, out of range). */
export function statementRow(
  date: string,
  description: string,
  debit: number,
  credit: number,
  balance: number,
  account: string | undefined,
  isCard: boolean,
): RawTxn | null {
  const desc = description.replace(/\s+/g, ' ').trim();
  if (!date || !desc) return null;
  const [y, m, d] = date.split('-').map(Number);
  const now = new Date();
  const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (new Date(y, m - 1, d) > maxDate || y < 2000) return null;
  if (SKIP.test(desc)) return null;
  let amount = 0;
  let isCredit = false;
  if (debit > 0 && credit <= 0) amount = debit;
  else if (credit > 0 && debit <= 0) {
    amount = credit;
    isCredit = true;
  } else return null;
  if (amount > 1e8) return null;
  const type = isCredit ? (/refund|reversal|reversed|chargeback/i.test(desc) ? 'refund' : 'income') : 'expense';
  return {
    date,
    amount: Math.round(amount * 100) / 100,
    type,
    merchant: merchantKey(desc) ? displayName(desc) : desc.slice(0, 40),
    narration: desc,
    account,
    balanceAfter: !isCard && balance > 0 ? balance : undefined,
    source: 'pdf',
    raw: `${date} | ${desc} | ${isCredit ? 'Cr' : 'Dr'} ${amount}${balance > 0 ? ` | Bal ${balance}` : ''}`,
  };
}

/** Parses statement lines (all pages, top → bottom) into rows. Never throws. */
export function parseStatementTable(pages: PdfLine[][]): TableParse {
  const empty: TableParse = { rows: [], bank: null, datedLines: 0, header: false };
  try {
    return parse(pages);
  } catch {
    return empty;
  }
}

function parse(pages: PdfLine[][]): TableParse {
  const firstText = (pages[0] ?? []).slice(0, 40).map(lineText).join(' ');
  const allHead = pages.slice(0, 2).flat().slice(0, 80).map(lineText).join(' ');
  const bank = detectBank(allHead);
  const isCard = /credit card/i.test(firstText);
  const accMatch = allHead.match(/(?:a\/?c|account|card)\s*(?:no\.?|number|num)?\s*[:.\-]?\s*[0-9xX*•\s-]{0,20}?(\d{4})\b/i);
  const account = accountLabel(bank, accMatch ? accMatch[1] : null, isCard);

  const rows: RawTxn[] = [];
  let header: HeaderCol[] | null = null;
  let sawHeader = false;
  let datedLines = 0;
  let pending: Pending | null = null;
  let lastBalance = 0;

  const flush = () => {
    const p = pending;
    pending = null;
    if (!p) return;
    let debit = p.debit;
    let credit = p.credit;
    if (!debit && !credit && p.amount) {
      if (p.drcr === 'cr') credit = p.amount;
      else if (p.drcr === 'dr') debit = p.amount;
      else if (lastBalance > 0 && p.balance > 0) {
        if (Math.abs(lastBalance - p.amount - p.balance) < 0.02) debit = p.amount;
        else if (Math.abs(lastBalance + p.amount - p.balance) < 0.02) credit = p.amount;
      } else if (isCard) debit = p.amount;
    }
    const r = statementRow(p.date, p.text.join(' '), debit, credit, p.balance, account, isCard);
    if (r) rows.push(r);
    if (p.balance > 0) lastBalance = p.balance;
  };

  for (const page of pages) {
    for (const raw of page) {
      const line: PdfLine = { y: raw.y, cells: mergeCells(raw.cells, 2) };
      if (!line.cells.length) continue;
      const text = lineText(line);
      const h = findHeader(line);
      if (h) {
        flush();
        header = h;
        sawHeader = true;
        continue;
      }
      if (/^(opening|closing) balance/i.test(text)) {
        flush();
        const nums = line.cells.filter((c) => isAmount(c.s));
        if (/^opening/i.test(text) && nums.length) lastBalance = amountOf(nums[nums.length - 1].s);
        continue;
      }
      if (SKIP.test(text)) {
        flush();
        continue;
      }

      const lead = leadingDate(text);
      if (lead) datedLines++;

      if (header) {
        // Column mode.
        const byCol = new Map<Col, string[]>();
        for (const c of line.cells) {
          const col = columnOf(c, header);
          if (!col) continue;
          const list = byCol.get(col) ?? [];
          list.push(c.s);
          byCol.set(col, list);
        }
        const dateCell = (byCol.get('date') ?? []).join(' ');
        const rowDate = leadingDate(dateCell) ?? lead;
        const narr = (byCol.get('narration') ?? []).join(' ');
        const num = (k: Col) => {
          const v = (byCol.get(k) ?? []).find((s) => isAmount(s));
          return v ? amountOf(v) : 0;
        };
        const drcrText = (byCol.get('drcr') ?? []).join(' ').toLowerCase();
        const amtText = (byCol.get('amount') ?? []).find((s) => isAmount(s)) ?? '';
        const drcr: 'cr' | 'dr' | null = /\bcr\b|credit/.test(drcrText) ? 'cr' : /\bdr\b|debit/.test(drcrText) ? 'dr' : suffixOf(amtText);
        if (rowDate) {
          flush();
          pending = {
            date: rowDate.iso,
            text: narr ? [narr] : [],
            debit: num('debit'),
            credit: num('credit'),
            amount: num('amount'),
            drcr,
            balance: num('balance'),
          };
        } else if (pending) {
          // Continuation line: more narration, or the amounts printed on a later line.
          if (narr && pending.text.length < MAX_NARRATION_LINES) pending.text.push(narr);
          if (!pending.debit && !pending.credit && !pending.amount) {
            pending.debit = num('debit');
            pending.credit = num('credit');
            pending.amount = num('amount');
            pending.drcr = pending.drcr ?? drcr;
          }
          if (!pending.balance) pending.balance = num('balance');
        }
        continue;
      }

      // No header: "date … narration … amounts" lines.
      if (lead) {
        flush();
        const amounts = line.cells.filter((c) => isAmount(c.s));
        let rest = text.slice(lead.len).trim();
        const second = leadingDate(rest);
        if (second) rest = rest.slice(second.len).trim(); // value date
        for (const a of amounts) rest = rest.replace(a.s, ' ');
        const p: Pending = { date: lead.iso, text: [rest.replace(/\s+/g, ' ').trim()], debit: 0, credit: 0, amount: 0, drcr: null, balance: 0 };
        if (amounts.length >= 3) {
          // debit · credit · balance (one of the first two is usually 0.00)
          const [a, b, c] = amounts.slice(-3).map((x) => amountOf(x.s));
          p.debit = a > 0 && b === 0 ? a : 0;
          p.credit = b > 0 && a === 0 ? b : 0;
          p.balance = c;
          if (!p.debit && !p.credit) p.amount = Math.max(a, b);
        } else if (amounts.length === 2) {
          p.amount = amountOf(amounts[0].s);
          p.drcr = suffixOf(amounts[0].s);
          p.balance = amountOf(amounts[1].s);
        } else if (amounts.length === 1) {
          p.amount = amountOf(amounts[0].s);
          p.drcr = suffixOf(amounts[0].s);
        }
        pending = p;
      } else if (pending) {
        const p: Pending = pending;
        const amounts = line.cells.filter((c) => isAmount(c.s));
        const words = line.cells.filter((c) => !isAmount(c.s)).map((c) => c.s).join(' ').trim();
        if (words && p.text.length < MAX_NARRATION_LINES) p.text.push(words);
        if (!p.amount && !p.debit && !p.credit && amounts.length) {
          p.amount = amountOf(amounts[0].s);
          p.drcr = suffixOf(amounts[0].s);
          if (amounts.length >= 2) p.balance = amountOf(amounts[amounts.length - 1].s);
        }
      }
    }
    // A row never continues across a page's footer into the next page's header.
    flush();
  }
  flush();
  return { rows, bank, datedLines, header: sawHeader };
}

/** True when the parse is clean enough to trust without Gemini. */
export function tableLooksGood(p: TableParse): boolean {
  if (!p.rows.length) return false;
  if (p.datedLines === 0) return false;
  return p.rows.length >= Math.max(1, Math.floor(p.datedLines * 0.6));
}
