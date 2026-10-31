import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import type { Goal, RawTxn, Rule, Txn } from '@/data/types';
import { todayISO, uid, useStore } from '@/data/store';
import { DEMO_PROFILE, DEMO_RAWS, demoTruthByMerchant } from '@/data/demo';
import { alignType, categorizeLocal, categorizeWithAI, hintCategory } from '@/engine/categorize';
import { cleanTxns } from '@/engine/clean';
import { parseCsv } from '@/engine/csv';
import { merchantKey } from '@/engine/merchant';
import { arrayBufferToBase64, hashString } from '@/engine/parseUtil';
import { pdfIsEncrypted, readPdfStatement } from '@/engine/pdf';
import { extractPdfText, looksScanned, ocrAvailable, ocrPages } from '@/engine/pdfText';
import { parseStatementTable, tableLooksGood } from '@/engine/statementTable';
import { inferProfile } from '@/engine/profile';
import { parseSmsBatch } from '@/engine/sms';
import { geminiConfigured } from '@/services/gemini';

/*
 * Ingestion pipeline: raw rows → local categorisation → store (deduped by hash)
 * → cleaning pass over everything → Gemini only for the new low-confidence rows.
 */

export interface ImportResult {
  added: number;
  toReview: number;
  message: string;
}

/** Dedupe key: date + amount + account + merchant key + original text. */
export function txnHash(r: RawTxn): string {
  return hashString(`${r.date}|${r.amount.toFixed(2)}|${r.type}|${r.account ?? ''}|${merchantKey(r.merchant)}|${(r.raw ?? r.narration ?? '').trim()}`);
}

function buildTxn(raw: RawTxn, rules: Rule[]): Txn {
  const c = categorizeLocal(raw, rules);
  const needsReview = c.confidence < 0.6;
  return {
    id: uid('t_'),
    date: raw.date,
    amount: Math.round(raw.amount * 100) / 100,
    type: alignType(raw.type, c.category),
    merchant: raw.merchant.trim() || 'Unknown',
    narration: raw.narration,
    category: c.category,
    account: raw.account,
    balanceAfter: raw.balanceAfter,
    source: raw.source,
    catSource: c.catSource,
    confidence: c.confidence,
    needsReview,
    suggested: needsReview ? hintCategory(raw.merchant, raw.narration) : undefined,
    raw: raw.raw,
    hash: txnHash(raw),
  };
}

function validRaw(r: RawTxn | null | undefined): r is RawTxn {
  return !!r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && typeof r.amount === 'number' && isFinite(r.amount) && r.amount > 0 && typeof r.merchant === 'string';
}

/** Merge Gemini results into the CURRENT rows (the user may have corrected some meanwhile). */
function mergeAi(updates: Txn[], mode: 'apply' | 'suggest') {
  if (!updates.length) return;
  const st = useStore.getState();
  const cur = new Map(st.txns.map((t) => [t.id, t]));
  const merged: Txn[] = [];
  for (const u of updates) {
    const c = cur.get(u.id);
    if (!c || c.catSource === 'user' || c.catSource === 'rule') continue;
    if (mode === 'suggest' || u.catSource !== 'ai') merged.push({ ...c, suggested: u.suggested ?? c.suggested });
    else merged.push({ ...c, category: u.category, type: u.type, catSource: u.catSource, confidence: u.confidence, needsReview: u.needsReview, suggested: u.suggested });
  }
  if (!merged.length) return;
  st.updateTxns(merged);
  useStore.getState().setTxns(cleanTxns(useStore.getState().txns));
}

/**
 * Imports raw rows: categorise locally → add (deduped) → clean all → Gemini for new low-confidence rows.
 * opts.ai: 'apply' (default) waits for Gemini; 'suggest' only adds "Maybe X?" in the background; 'off' skips it.
 */
export async function importRaw(raws: RawTxn[], opts: { ai?: 'apply' | 'suggest' | 'off' } = {}): Promise<{ added: number; toReview: number }> {
  const st = useStore.getState();
  const built = raws.filter(validRaw).map((r) => buildTxn(r, st.rules));
  const added = st.addTxns(built);
  if (!added) return { added: 0, toReview: 0 };
  const ids = new Set(built.map((t) => t.id));
  useStore.getState().setTxns(cleanTxns(useStore.getState().txns));
  const fresh = () => useStore.getState().txns.filter((t) => ids.has(t.id));

  const mode = opts.ai ?? 'apply';
  if (mode !== 'off') {
    const low = fresh().filter((t) => t.needsReview && t.confidence < 0.6);
    if (low.length) {
      const aiMode = mode === 'suggest' ? 'suggest' : 'apply';
      const run = async () => {
        try {
          mergeAi(await categorizeWithAI(low, aiMode), aiMode);
        } catch {
          // Gemini offline: local categories stay.
        }
      };
      if (mode === 'suggest') void run();
      else await run();
    }
  }
  return { added, toReview: fresh().filter((t) => t.needsReview).length };
}

function summary(found: number, added: number, toReview: number, what: string): string {
  if (!found) return `No transactions found in that ${what}.`;
  const dupes = found - added;
  const parts = [`Added ${added} transaction${added === 1 ? '' : 's'}`];
  if (dupes > 0) parts.push(`${dupes} already here`);
  if (toReview > 0) parts.push(`${toReview} need${toReview === 1 ? 's' : ''} a category`);
  return parts.join(' · ') + '.';
}

/** Import size limits (security: no unbounded parsing of pasted text or files). */
const MAX_IMPORT_CHARS = 5 * 1024 * 1024;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 11 * 1024 * 1024;
const TOO_BIG: ImportResult = { added: 0, toReview: 0, message: 'That is too large to import. Try a shorter period.' };

/** Parses pasted bank SMS (OTPs/offers skipped) and imports them. */
export async function importSmsText(text: string): Promise<ImportResult> {
  if (text.length > MAX_IMPORT_CHARS) return TOO_BIG;
  const raws = parseSmsBatch(text);
  if (!raws.length) return { added: 0, toReview: 0, message: 'No bank transactions found. OTPs, offers and failed payments are skipped.' };
  const r = await importRaw(raws);
  return { ...r, message: summary(raws.length, r.added, r.toReview, 'text') };
}

/** Imports CSV text that is already in memory (e.g. the sample statement). */
export async function importCsvText(text: string): Promise<ImportResult> {
  if (text.length > MAX_IMPORT_CHARS) return TOO_BIG;
  const raws = parseCsv(text);
  if (!raws.length) return { added: 0, toReview: 0, message: "Couldn't find a date, description and amount columns in that CSV." };
  const r = await importRaw(raws);
  return { ...r, message: summary(raws.length, r.added, r.toReview, 'CSV') };
}

type Asset = DocumentPicker.DocumentPickerAsset;

async function pickOne(types: string[]): Promise<Asset | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0];
}

async function readAssetText(a: Asset): Promise<string> {
  if (Platform.OS === 'web') {
    if (a.file) return await a.file.text();
    const res = await fetch(a.uri);
    return await res.text();
  }
  return await new FsFile(a.uri).text();
}

async function readAssetBase64(a: Asset): Promise<string> {
  if (Platform.OS === 'web') {
    if (a.base64 && a.base64.startsWith('data:')) return a.base64.replace(/^data:[^,]*,/, '');
    const buf = a.file ? await a.file.arrayBuffer() : await (await fetch(a.uri)).arrayBuffer();
    return arrayBufferToBase64(buf);
  }
  return await new FsFile(a.uri).base64();
}

/** Opens the file picker for a bank statement CSV and imports it. */
export async function pickAndImportCsv(): Promise<ImportResult> {
  try {
    const a = await pickOne(Platform.OS === 'web' ? ['.csv', 'text/csv', 'text/plain', 'application/vnd.ms-excel'] : ['*/*']);
    if (!a) return { added: 0, toReview: 0, message: 'No file chosen.' };
    if (/\.xlsx?$/i.test(a.name)) return { added: 0, toReview: 0, message: 'Excel files aren’t supported yet — save the statement as CSV and upload that.' };
    if (/\.pdf$/i.test(a.name)) return { added: 0, toReview: 0, message: 'That’s a PDF — use “Upload PDF” instead.' };
    if (typeof a.size === 'number' && a.size > MAX_CSV_BYTES) return TOO_BIG;
    const text = await readAssetText(a);
    return await importCsvText(text);
  } catch {
    return { added: 0, toReview: 0, message: 'Couldn’t read that file. Try exporting the statement as CSV again.' };
  }
}

const PDF_PASSWORD_MSG = 'This PDF is password-protected. Remove the password first (open it and “Save as PDF” / print to PDF), then upload again.';

/**
 * PDF statement → rows, cheapest reliable path first:
 *  1. text layer on the device (pdf.js) → table parser;
 *  2. scanned PDF → ML Kit OCR of the page images (only when that native module is in the build) → table parser;
 *  3. anything unread or messy → Gemini.
 */
export async function readPdfRows(b64: string): Promise<{ raws: RawTxn[]; path: 'text' | 'ocr' | 'ai' | null; password?: boolean }> {
  const text = await extractPdfText(b64, ocrAvailable());
  if (!text.ok && text.reason === 'password') return { raws: [], path: null, password: true };
  if (text.ok) {
    if (!looksScanned(text.result)) {
      const p = parseStatementTable(text.result.pages);
      if (tableLooksGood(p)) return { raws: p.rows, path: 'text' };
    } else if (text.result.images.length) {
      const pages = await ocrPages(text.result.images);
      if (pages) {
        const p = parseStatementTable(pages);
        if (tableLooksGood(p)) return { raws: p.rows, path: 'ocr' };
      }
    }
  }
  if (!geminiConfigured) return { raws: [], path: null };
  const raws = await readPdfStatement(b64);
  return { raws, path: raws.length ? 'ai' : null };
}

/** Opens the file picker for a PDF statement, reads it (device first, Gemini last) and imports it. */
export async function pickAndImportPdf(): Promise<ImportResult> {
  try {
    const a = await pickOne(['application/pdf']);
    if (!a) return { added: 0, toReview: 0, message: 'No file chosen.' };
    if (typeof a.size === 'number' && a.size > MAX_PDF_BYTES) return TOO_BIG;
    const b64 = await readAssetBase64(a);
    if (pdfIsEncrypted(b64)) return { added: 0, toReview: 0, message: PDF_PASSWORD_MSG };
    const { raws, path, password } = await readPdfRows(b64);
    if (password) return { added: 0, toReview: 0, message: PDF_PASSWORD_MSG };
    if (!raws.length) {
      return {
        added: 0,
        toReview: 0,
        message: geminiConfigured
          ? 'Couldn’t read transactions from this PDF. Try the CSV export from your bank.'
          : 'Couldn’t read this PDF on the device. Upload the CSV export, or add Gemini to read it.',
      };
    }
    const r = await importRaw(raws);
    const how = path === 'ocr' ? ' from the scan' : path === 'ai' ? ' with Gemini' : '';
    return { ...r, message: `Read ${raws.length} row${raws.length === 1 ? '' : 's'}${how} · ${summary(raws.length, r.added, r.toReview, 'PDF')}` };
  } catch {
    return { added: 0, toReview: 0, message: 'Couldn’t read that PDF. Try again, or upload the CSV export.' };
  }
}

function shiftMonths(today: string, months: number, day: number): string {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

function demoGoals(today: string): Goal[] {
  const lastDay = (iso: string) => shiftMonths(iso, 0, 31);
  const c = (date: string, amount: number, note?: string) => ({ id: uid('c_'), date, amount, note });
  const thisMonth2 = shiftMonths(today, 0, 2) <= today ? shiftMonths(today, 0, 2) : today;
  return [
    {
      id: uid('g_'),
      name: 'Goa trip',
      emoji: '🏖️',
      target: 40000,
      dueDate: lastDay(shiftMonths(today, 5, 1)),
      priority: 2,
      archived: false,
      createdAt: shiftMonths(today, -3, 2),
      contributions: [c(shiftMonths(today, -3, 2), 5000), c(shiftMonths(today, -2, 2), 5000), c(shiftMonths(today, -1, 2), 4000, 'Smaller month')],
    },
    {
      id: uid('g_'),
      name: 'New laptop',
      emoji: '💻',
      target: 120000,
      dueDate: lastDay(shiftMonths(today, 11, 1)),
      priority: 1,
      archived: false,
      createdAt: shiftMonths(today, -1, 5),
      contributions: [c(shiftMonths(today, -1, 5), 10000), c(thisMonth2, 8000)],
    },
  ];
}

/** Resets the store and loads 3 months of demo data, an inferred profile and 2 goals; returns a status message. */
export async function loadDemo(): Promise<string> {
  const st = useStore.getState();
  const { theme, sectionOrder, voice, accent, numberFont, compactRows } = st.settings;
  // The user's own name/email survive a demo load (only Clear all data removes them);
  // with no name typed yet, the demo comes with its own profile (Vrushal More, Mumbai).
  const info = st.profileInfo;
  st.resetAll();
  useStore.getState().setSettings({ theme, sectionOrder, voice, accent, numberFont, compactRows });
  if (info.name.trim()) useStore.setState({ profileInfo: info });
  else useStore.getState().setProfileInfo({ ...DEMO_PROFILE, createdAt: info.createdAt });

  const raws: RawTxn[] = DEMO_RAWS.map(({ truth: _truth, ...r }) => r);
  const { added, toReview } = await importRaw(raws, { ai: 'suggest' });

  const today = todayISO();
  const snap = inferProfile(useStore.getState().txns, today);
  useStore.getState().saveProfile({ ...snap, emergencyFund: 75000, onboarded: true });
  for (const g of demoGoals(today)) useStore.getState().upsertGoal(g);

  const before = accuracy();
  useStore.getState().setSettings({ evalBefore: before });
  return `Demo loaded — ${added} transactions over 3 months. ${toReview} need${toReview === 1 ? 's' : ''} a category. Categories right before learning: ${Math.round(before * 100)}%.`;
}

/** Share of demo rows whose category equals the demo's true category (1 when no demo rows). */
export function accuracy(): number {
  const rows = useStore.getState().txns.filter((t) => t.source === 'demo');
  if (!rows.length) return 1;
  const truth = demoTruthByMerchant();
  let n = 0;
  let ok = 0;
  for (const t of rows) {
    const want = truth.get(t.merchant);
    if (!want) continue;
    n++;
    if (t.category === want) ok++;
  }
  return n ? ok / n : 1;
}
