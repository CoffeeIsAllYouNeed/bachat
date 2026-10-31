import type { RawTxn, TxnType } from '@/data/types';
import { todayISO } from '@/data/store';
import { displayName, merchantKey } from './merchant';
import { accountLabel, detectBank, parseAmount, parseDateLoose } from './parseUtil';

/*
 * Indian bank SMS → RawTxn. Handles the common shapes:
 *  "Rs.349.00 debited from A/c XX1123 on 30-10-26 to VPA swiggy@icici. Avl Bal Rs.84,210.55"
 *  "INR 1,299.00 spent on ICICI Bank Card XX9012 on 29-Oct-26 at MYNTRA. Avl Lmt: INR 1,48,701"
 *  "A/C X7781 debited by 420.0 on date 30Oct26 trf to Rasoi Express Refno 4303..."
 *  "Received Rs.2,500.00 in your Kotak Bank A/c X4410 from priya.s@okaxis on 28-10-26"
 * OTPs, offers, failed / declined transactions are ignored.
 */

const IGNORE = [
  /\botp\b|one[\s-]?time password|verification code|\bpin\b.*\bshare\b|do not share/i,
  /\b(failed|declined|unsuccessful|could not be processed|not been processed|insufficient (funds|balance)|rejected)\b/i,
  /pre-?approved|apply now|offer\b|offers\b|eligible for|congratulations|you have won|win (rs|₹|a )|limited period|click here|loan of up ?to|cashback of up ?to|upgrade your/i,
  /\b(will be|is due|due on|due date|minimum (amount )?due|total (amount )?due|payment reminder|requested money|collect request|has requested)\b/i,
];

const CUR = '(?:\\brs\\.?|\\binr|₹)';
// Comma-grouped ("1,48,701.00") or plain ("85000.00"); comma groups are required in the first branch
// so "85000" isn't cut to "850".
const NUM = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';

const DEBIT_WORDS = /\b(debited|spent|sent|withdrawn|withdrawal|paid|purchase|purchased|deducted|transferred|txn of|used)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|added|refunded|reversed|reversal)\b/i;
const REFUND_WORDS = /\b(refund|refunded|reversal|reversed|returned|chargeback)\b/i;

/** Parses one Indian bank SMS; null when it isn't a completed transaction. */
export function parseSms(text: string, receivedAt?: string): RawTxn | null {
  const raw = text.trim();
  if (raw.length < 12) return null;
  const body = stripSender(raw);
  if (IGNORE.some((re) => re.test(body))) return null;

  // ---- balance (so it is not taken as the amount)
  const balRe = new RegExp(`(?:avl\\.?\\s*bal(?:ance)?|available\\s+bal(?:ance)?|a\\/c\\s+bal(?:ance)?|clear\\s+bal|\\bbal(?:ance)?)\\s*(?:is|:|-)?\\s*(?:${CUR})?\\s*:?\\s*${NUM}`, 'i');
  const balM = body.match(balRe);
  const balanceAfter = balM ? parseAmount(balM[1]) ?? undefined : undefined;
  const balStart = balM?.index ?? -1;
  const balEnd = balM ? balStart + balM[0].length : -1;
  // card limit lines are not balances / amounts either
  const lmtM = body.match(new RegExp(`(?:avl\\.?\\s*(?:lmt|limit)|available\\s+(?:credit\\s+)?limit)\\s*:?\\s*(?:${CUR})?\\s*${NUM}`, 'i'));
  const lmtStart = lmtM?.index ?? -1;
  const lmtEnd = lmtM ? lmtStart + lmtM[0].length : -1;
  const inside = (i: number) => (i >= balStart && i < balEnd) || (i >= lmtStart && i < lmtEnd);

  // ---- amount: first currency amount outside the balance/limit; else "debited by 420.0"
  let amount: number | null = null;
  for (const m of body.matchAll(new RegExp(`${CUR}\\s*:?\\s*${NUM}`, 'gi'))) {
    if (inside(m.index ?? 0)) continue;
    amount = parseAmount(m[1]);
    if (amount) break;
  }
  if (!amount) {
    const m = body.match(new RegExp(`(?:debited|credited|withdrawn|spent|sent|received|paid)\\s+(?:by|with|for|of)?\\s*${NUM}`, 'i'));
    if (m) amount = parseAmount(m[1]);
  }
  if (!amount || amount <= 0 || amount > 1e8) return null;

  // ---- direction: whichever verb comes first
  const dI = firstIndex(body, DEBIT_WORDS);
  const cI = firstIndex(body, CREDIT_WORDS);
  if (dI < 0 && cI < 0) return null;
  let type: TxnType = cI >= 0 && (dI < 0 || cI < dI) ? 'income' : 'expense';
  if (type === 'income' && REFUND_WORDS.test(body)) type = 'refund';

  // ---- account
  const bank = detectBank(raw);
  const cardM = body.match(/(?:credit\s+card|debit\s+card|\bcard\b)[^.\d]{0,30}?(?:ending|no\.?|number|xx+|\*+|x+)?\s*(?:with\s+)?(?:in\s+)?[x*]*\s*(\d{4})\b/i);
  const acM = body.match(/(?:a\/c|acct|account|\bac)\s*(?:no\.?|number)?\s*[:.]?\s*(?:[x*.]+)?\s*(\d{3,6})\b/i);
  const isCard = !!cardM && (!acM || (cardM.index ?? 0) <= (acM.index ?? 0));
  const last4 = isCard ? cardM![1] : acM ? acM[1] : null;
  const account = accountLabel(bank, last4, isCard);

  // ---- merchant / counterparty
  const merchantText = findCounterparty(body, type);
  let merchant = merchantText ? displayName(merchantText) : '';
  if (!merchant || !merchantKey(merchant)) {
    if (/\batm\b|cash withdrawal|withdrawn/i.test(body)) merchant = 'ATM Withdrawal';
    else if (/salary|sal\b/i.test(body)) merchant = 'Salary';
    else if (/neft|imps|rtgs/i.test(body)) merchant = type === 'expense' ? 'Bank transfer out' : 'Bank transfer in';
    else merchant = isCard ? 'Card spend' : type === 'expense' ? 'Payment' : 'Money received';
  }
  if (/\batm\b/i.test(body) && type === 'expense') merchant = 'ATM Withdrawal';

  const date = parseDateLoose(body) ?? (receivedAt ? receivedAt.slice(0, 10) : todayISO());

  return {
    date,
    amount: Math.round(amount * 100) / 100,
    type,
    merchant,
    narration: merchantText ?? undefined,
    account,
    balanceAfter: !isCard && balanceAfter != null ? balanceAfter : undefined,
    source: 'sms',
    raw,
  };
}

function firstIndex(s: string, re: RegExp): number {
  const m = s.match(re);
  return m?.index ?? -1;
}

/** "VM-HDFCBK: Rs.." → "Rs.." (sender ids like AD-ICICIT, JD-SBIUPI, HDFCBK:) */
function stripSender(s: string): string {
  return s.replace(/^\s*(?:[A-Z]{2}-[A-Z0-9]{3,9}(?:-[A-Z])?|[A-Z]{6})\s*[:>-]\s*/, '');
}

const STOP = '(?=\\s+on\\s|\\s+dated?\\b|\\s+ref|\\s+upi|\\s+avl|\\s+bal|\\s+not\\s+you|\\s+if\\s+not|\\s+via\\b|\\s+using\\b|\\s+for\\s+upi|\\s*\\(|\\.\\s|\\.$|,|;|\\s+-\\s*[A-Z]{2,}|\\s+txn|\\s+imps|\\s+neft|$)';

/** Finds the merchant / counterparty phrase in the SMS body. */
function findCounterparty(body: string, type: TxnType): string | null {
  // Info: UPI/123/MERCHANT/...
  const info = body.match(/\binfo[:\s-]+([^\n]+?)(?:\.\s|\.$|$)/i);
  if (info) {
    const k = merchantKey(info[1]);
    if (k) return info[1].trim();
  }
  const preps = type === 'expense' ? ['at', 'to', 'towards', 'in favour of', 'for'] : ['from', 'by', 'frm'];
  for (const p of preps) {
    const re = new RegExp(`\\b${p}\\s+(?:vpa\\s+|merchant\\s+|beneficiary\\s+)?([A-Za-z0-9@&.'_\\- ]{2,60}?)${STOP}`, 'gi');
    for (const m of body.matchAll(re)) {
      const cand = m[1].trim();
      if (looksLikeAccount(cand)) continue;
      if (!merchantKey(cand) || /^(rs|inr|your|you|the|a|an)$/i.test(cand)) continue;
      return cand;
    }
  }
  // Bare UPI handle anywhere
  const vpa = body.match(/\b([a-z0-9._-]{3,}@[a-z]{2,})\b/i);
  if (vpa) return vpa[1];
  return null;
}

function looksLikeAccount(s: string): boolean {
  return /^(your\s+)?(a\/c|ac\b|acct|account|card|bank|savings|sb\b|[x*]+\d|\d)/i.test(s) || /\b(a\/c|account|card)\s*(no\.?)?\s*[x*]*\d{3,}/i.test(s) || /\bbank\b.*\b(a\/c|account)\b/i.test(s);
}

/** Splits pasted text into messages (blank lines or sender-like line starts) and returns the parsed transactions. */
export function parseSmsBatch(text: string): RawTxn[] {
  if (!text?.trim()) return [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const messages: string[] = [];
  const senderLine = /^\s*(?:[A-Z]{2}-[A-Z0-9]{3,9}\b|(?:Dear|Your|Rs\.?|INR|₹|Sent|Received|Spent|Txn|Acct|A\/c|Alert|Money|Thank you)\b)/;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      messages.push(block);
      continue;
    }
    // Several messages pasted without blank lines: break on sender-like starts.
    const parts: string[] = [];
    let cur = '';
    for (const l of lines) {
      if (cur && senderLine.test(l) && parseSms(cur)) {
        parts.push(cur);
        cur = l;
      } else {
        cur = cur ? `${cur} ${l}` : l;
      }
    }
    if (cur) parts.push(cur);
    messages.push(...parts);
  }
  const out: RawTxn[] = [];
  for (const m of messages) {
    const t = parseSms(m.replace(/\s*\n\s*/g, ' '));
    if (t) out.push(t);
  }
  return out;
}
