import Papa from 'papaparse';
import type { RawTxn, TxnType } from '@/data/types';
import { displayName, merchantKey } from './merchant';
import { accountLabel, detectBank, parseAmount, parseDateLoose } from './parseUtil';

/*
 * Bank statement CSV → RawTxn[].
 * Finds the header row (exports often start with a preamble), then maps columns:
 *  HDFC:  Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
 *  ICICI: S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks, Withdrawal Amount (INR ), Deposit Amount (INR ), Balance (INR )
 *  SBI:   Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance
 *  Axis:  Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL
 *  Kotak: Sl. No., Transaction Date, Value Date, Description, Chq / Ref No., Amount, Dr / Cr, Balance
 *  Generic: Date, Description, Amount (+/−), Balance
 */

interface Cols {
  date: number;
  narration: number;
  debit: number;
  credit: number;
  amount: number;
  drcr: number;
  balance: number;
}

function norm(h: unknown): string {
  return String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Maps header cells to column indexes; null when the row isn't a header. */
function detectColumns(row: unknown[]): Cols | null {
  const h = row.map(norm);
  const find = (test: (s: string) => boolean, not: number[] = []) => h.findIndex((s, i) => !not.includes(i) && test(s));

  const balance = find((s) => /balance|^bal\.?$|closing bal/.test(s));
  const drcr = find((s) => /^(dr ?\/ ?cr|cr ?\/ ?dr|type|txn type|transaction type|debit\/credit)$/.test(s));
  const debit = find((s) => /withdrawal|debit|^dr\.?$|paid out|money out/.test(s) && !/credit/.test(s), [balance, drcr]);
  const credit = find((s) => /deposit|credit|^cr\.?$|paid in|money in/.test(s) && !/debit/.test(s), [balance, drcr, debit]);
  const amount = find((s) => /^(amount|amt|transaction amount|txn amount)\b|amount \(|^amount$/.test(s), [balance, debit, credit, drcr]);
  // Prefer the transaction date over the value date.
  let date = find((s) => /(txn|tran|transaction|posting|booking) ?date|^date$|^txn dt$|^tran dt$/.test(s));
  if (date < 0) date = find((s) => /date|\bdt\b/.test(s));
  const narration = find((s) => /narration|description|particulars|details|remarks|transaction remarks|merchant|payee/.test(s));

  if (date < 0 || narration < 0) return null;
  if (debit < 0 && credit < 0 && amount < 0) return null;
  return { date, narration, debit, credit, amount, drcr, balance };
}

/** Parses an Indian bank statement CSV export into raw transactions (skips preamble, totals and junk rows). */
export function parseCsv(text: string): RawTxn[] {
  if (!text?.trim()) return [];
  const parsed = Papa.parse<unknown[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r): r is unknown[] => Array.isArray(r));
  if (!rows.length) return [];

  let headerAt = -1;
  let cols: Cols | null = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const c = detectColumns(rows[i]);
    if (c) {
      headerAt = i;
      cols = c;
      break;
    }
  }
  if (!cols) return [];

  // Account from the preamble ("Account No : XXXXXXXX1123", bank name)
  const preamble = rows.slice(0, headerAt).map((r) => r.join(' ')).join(' ') + ' ' + text.slice(0, 600);
  const bank = detectBank(preamble);
  const acM = preamble.match(/(?:account|a\/c|acct)\s*(?:no\.?|number|#)?\s*[:.-]?\s*[x*\d\s-]*?(\d{4})\b/i);
  const account = accountLabel(bank, acM ? acM[1] : null, false);

  const out: RawTxn[] = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i];
    const cell = (k: number) => (k >= 0 ? String(r[k] ?? '').trim() : '');
    const date = parseDateLoose(cell(cols.date));
    const narration = cell(cols.narration).replace(/\s+/g, ' ');
    if (!date || !narration) continue;
    if (/^(opening|closing) balance|^total|^b\/f|brought forward|carried forward/i.test(narration)) continue;

    let amount = 0;
    let isCredit = false;
    const dr = parseAmount(cell(cols.debit));
    const cr = parseAmount(cell(cols.credit));
    if (dr && Math.abs(dr) > 0) {
      amount = Math.abs(dr);
      isCredit = false;
    } else if (cr && Math.abs(cr) > 0) {
      amount = Math.abs(cr);
      isCredit = true;
    } else if (cols.amount >= 0) {
      const rawAmt = cell(cols.amount);
      const a = parseAmount(rawAmt);
      if (!a) continue;
      amount = Math.abs(a);
      const flag = cell(cols.drcr).toLowerCase();
      if (flag) isCredit = /^c|credit|deposit/.test(flag);
      else if (/\bcr\b/i.test(rawAmt)) isCredit = true;
      else if (/\bdr\b/i.test(rawAmt)) isCredit = false;
      else isCredit = a > 0 && !/^-|\(/.test(rawAmt) ? guessCreditFromSign(rows, cols, headerAt) : false;
    } else continue;
    if (!amount || amount > 1e8) continue;

    const bal = parseAmount(cell(cols.balance));
    let type: TxnType = isCredit ? 'income' : 'expense';
    if (isCredit && /refund|reversal|reversed|rev\b|chargeback/i.test(narration)) type = 'refund';
    const name = displayName(narration) || narration.slice(0, 40);

    out.push({
      date,
      amount: Math.round(amount * 100) / 100,
      type,
      merchant: merchantKey(narration) ? name : narration.slice(0, 40),
      narration,
      account,
      balanceAfter: bal != null && isFinite(bal) ? Math.abs(bal) : undefined,
      source: 'csv',
      raw: r.map((x) => String(x ?? '')).join(' | '),
    });
  }
  return out;
}

/**
 * Single signed "Amount" column with no Dr/Cr flag: if the file has any
 * negative amounts, positives are credits; otherwise everything is a debit
 * (card statements list spends as positive numbers).
 */
function guessCreditFromSign(rows: unknown[][], cols: Cols, headerAt: number): boolean {
  for (let i = headerAt + 1; i < rows.length; i++) {
    const v = String(rows[i][cols.amount] ?? '').trim();
    if (/^-|^\(/.test(v)) return true;
  }
  return false;
}
