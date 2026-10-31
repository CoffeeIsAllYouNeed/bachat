/**
 * Gemini API client (REST, no SDK needed — works in Expo Go and on the web).
 *
 * Where requests go (.env):
 *  - EXPO_PUBLIC_AI_PROXY_URL set → every call goes to the app's AI proxy
 *    (worker/, a Cloudflare Worker that holds the Gemini key as a secret).
 *    No key is sent from the app; EXPO_PUBLIC_AI_APP_TOKEN, when set, is sent
 *    as `x-app-token` so the proxy can turn away other callers.
 *  - otherwise EXPO_PUBLIC_GEMINI_API_KEY → Google directly. Development only:
 *    an EXPO_PUBLIC_ value is bundled into the app and can be read from it.
 * EXPO_PUBLIC_GEMINI_MODEL picks the first model.
 *
 * Rules this app follows:
 *  - Gemini is used for language only (categorising a merchant, reading a PDF
 *    statement, transcribing speech, understanding a what-if, phrasing a reply).
 *    Every number shown is computed on the device in src/engine.
 *  - Send the minimum, and redact it: every outgoing user text part passes
 *    redact() (src/services/redact.ts) — card/account numbers, UPI IDs, phones,
 *    emails, PAN, Aadhaar, IFSC, OTPs and reference numbers are masked.
 *  - Bank text is data, not instructions: a security rule is added to every
 *    system instruction, and callers wrap raw text with dataBlock().
 *  - Every call can fail (offline, bad key, quota): callers always have a
 *    deterministic fallback, so the app keeps working without Gemini.
 *  - Nothing here logs request or response bodies.
 */

import { AGENTS, agentSystem, recordAgentRun, type AgentId } from '@/services/aiAgents';
import { DATA_RULE, redact, redactDeep } from '@/services/redact';

export { dataBlock, redact } from '@/services/redact';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROXY_URL = normaliseProxy(process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '');
const APP_TOKEN = process.env.EXPO_PUBLIC_AI_APP_TOKEN ?? '';

function normaliseProxy(u: string): string {
  const t = u.trim().replace(/\/+$/, '');
  if (!t) return '';
  // Only https (http allowed for a local dev worker).
  if (!/^https:\/\//i.test(t) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(t)) return '';
  return /\/v1\/generate$/.test(t) ? t : `${t}/v1/generate`;
}

/** True when the AI can be reached: proxy URL set, or (dev) a direct key. */
export function aiAvailable(): boolean {
  return PROXY_URL.length > 0 || API_KEY.length > 10;
}

/** 'proxy' | 'direct' | 'off' — for Settings. */
export const aiMode: 'proxy' | 'direct' | 'off' = PROXY_URL ? 'proxy' : API_KEY.length > 10 ? 'direct' : 'off';

/** Kept for existing callers: same as aiAvailable() (the env doesn't change at runtime). */
export const geminiConfigured = aiAvailable();

export interface InlineFile {
  mimeType: string;
  /** base64 without the data: prefix */
  data: string;
}

interface GenerateOptions {
  /** Which AI agent runs this task (its role is prepended to the system instruction). */
  agent?: AgentId;
  system?: string;
  files?: InlineFile[];
  json?: boolean;
  temperature?: number;
  timeoutMs?: number;
  /** false = try only the main model once (for optional extras like rephrasing). Default true. */
  fallback?: boolean;
}

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** Last error, for Settings → Developer → "Test Gemini". */
export let lastGeminiError: string | null = null;

/**
 * When a model is overloaded ("high demand", HTTP 429/500/503) we retry once and
 * then fall back through these models, so a busy model never breaks the app.
 * The first entry is the one from .env. (The proxy's model allowlist must include them.)
 */
const FALLBACK_MODELS = [MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
  .filter((m, i, a) => !!m && a.indexOf(m) === i);

/** Model that answered most recently (shown in Settings → Developer). */
export let lastGeminiModel: string = MODEL;

function isBusy(status?: number, message?: string): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return /high demand|overloaded|unavailable|try again later|resource.?exhausted|rate limit/i.test(message ?? '');
}

/** Model doesn't exist / isn't enabled for this key: skip to the next one. */
function isMissingModel(status?: number, message?: string): boolean {
  return status === 404 || /not found|is not supported|unknown model|model not allowed/i.test(message ?? '');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One HTTP call (proxy or direct). Returns the parsed response JSON. */
async function callModel(model: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = PROXY_URL
      ? await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(APP_TOKEN ? { 'x-app-token': APP_TOKEN } : {}) },
          body: JSON.stringify({ model, body }),
          signal: controller.signal,
        })
      : await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof json?.error?.message === 'string' ? json.error.message : typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
      throw new GeminiError(String(msg).slice(0, 200), res.status);
    }
    if (!json || typeof json !== 'object') throw new GeminiError('Unreadable reply');
    return json;
  } catch (e: any) {
    // Our own timer fired. On React Native this surfaces as "Fetch request has been
    // cancelled" (not always an AbortError), so check the signal itself.
    if (controller.signal.aborted || e?.name === 'AbortError' || /cancel|abort/i.test(String(e?.message ?? ''))) {
      throw new GeminiError('Gemini was too slow to answer (busy)', 504);
    }
    if (e instanceof GeminiError) throw e;
    // Network failure (offline, DNS): not worth trying other models.
    throw new GeminiError(e?.message ?? 'Network error', 0);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Outgoing body with every user text part redacted (text + function results),
 * and the data-not-instructions rule added to the system instruction.
 * Model turns are passed through untouched (they may carry thought signatures).
 * Never mutates the caller's objects.
 */
function secureBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const contents = Array.isArray(body.contents) ? (body.contents as unknown[]) : [];
  out.contents = contents.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const turn = c as { role?: unknown; parts?: unknown };
    if (turn.role === 'model' || !Array.isArray(turn.parts)) return c;
    return {
      ...turn,
      parts: (turn.parts as unknown[]).map((p) => {
        if (!p || typeof p !== 'object') return p;
        const part = p as Record<string, unknown>;
        if (typeof part.text === 'string') return { ...part, text: redact(part.text) };
        if (part.functionResponse && typeof part.functionResponse === 'object') {
          const fr = part.functionResponse as Record<string, unknown>;
          return { ...part, functionResponse: { ...fr, response: redactDeep(fr.response) } };
        }
        return part; // inlineData (audio / PDF): sent as is — see SECURITY.md
      }),
    };
  });
  const sys = body.systemInstruction as { parts?: unknown } | undefined;
  const sysParts = sys && Array.isArray(sys.parts) ? (sys.parts as unknown[]) : [];
  out.systemInstruction = { ...(sys ?? {}), parts: [...sysParts, { text: DATA_RULE }] };
  return out;
}

/**
 * Raw generateContent call: proxy-or-direct, redaction of every text part,
 * retry + model fallback. Returns the parsed response JSON or throws GeminiError.
 */
export async function geminiRequest(body: Record<string, unknown>, opts: { timeoutMs?: number; fallback?: boolean } = {}): Promise<any> {
  if (!aiAvailable()) throw new GeminiError('AI is not set up. Add EXPO_PUBLIC_AI_PROXY_URL to .env');
  const safe = secureBody(body);
  const timeoutMs = opts.timeoutMs ?? 30000;
  let last: GeminiError | null = null;
  const models = opts.fallback === false ? [MODEL] : FALLBACK_MODELS;
  for (const model of models) {
    // Busy → one short retry on the same model, then move to the next model.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await callModel(model, safe, timeoutMs);
        lastGeminiError = null;
        lastGeminiModel = model;
        return json;
      } catch (e: any) {
        last = e instanceof GeminiError ? e : new GeminiError(String(e?.message ?? e));
        lastGeminiError = last.message;
        if (last.status === 0) throw last; // offline
        if (isMissingModel(last.status, last.message)) break; // try next model
        if (isBusy(last.status, last.message)) {
          // Slow/busy: retry once quickly on a fast model; a timeout moves straight on.
          if (attempt === 0 && last.status !== 504) { await sleep(800); continue; }
          break; // still busy → next model
        }
        throw last; // bad key, blocked prompt, bad request: other models won't help
      }
    }
  }
  throw last ?? new GeminiError('Gemini unavailable');
}

/** Text of the first candidate (thought parts skipped). */
function replyText(json: any): string {
  const parts: unknown[] = Array.isArray(json?.candidates?.[0]?.content?.parts) ? json.candidates[0].content.parts : [];
  return parts
    .map((p: any) => (typeof p?.text === 'string' && p?.thought !== true ? p.text : ''))
    .join('')
    .trim();
}

async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const f of opts.files ?? []) parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: opts.temperature ?? (opts.agent ? AGENTS[opts.agent].temperature : 0.2),
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const system = opts.agent ? agentSystem(opts.agent, opts.system) : opts.system;
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let json: any;
  try {
    json = await geminiRequest(body, { timeoutMs: opts.timeoutMs ?? 30000, fallback: opts.fallback });
  } catch (e) {
    recordAgentRun(opts.agent, false);
    throw e;
  }
  const text = replyText(json);
  recordAgentRun(opts.agent, !!text);
  if (!text) {
    const reason = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason ?? 'empty reply';
    const err = new GeminiError(`Gemini returned no text (${reason})`);
    lastGeminiError = err.message;
    throw err;
  }
  return text;
}

/** Free-text reply, or null on any failure. */
export async function geminiText(prompt: string, opts: Omit<GenerateOptions, 'json'> = {}): Promise<string | null> {
  try {
    return await generate(prompt, opts);
  } catch {
    return null;
  }
}

/** JSON reply parsed into T, or null on any failure / unparseable output. Callers validate the shape. */
export async function geminiJSON<T>(prompt: string, opts: Omit<GenerateOptions, 'json'> = {}): Promise<T | null> {
  try {
    const text = await generate(prompt, { ...opts, json: true });
    return extractJSON<T>(text);
  } catch {
    return null;
  }
}

/** Pulls the first JSON object/array out of a reply (handles ```json fences). JSON.parse only — never eval. */
export function extractJSON<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.search(/[[{]/);
    if (start < 0) return null;
    const open = candidate[start];
    const close = open === '[' ? ']' : '}';
    const end = candidate.lastIndexOf(close);
    if (end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/** Speech → text (Indian English / Hinglish), cleaned of "umm"s. Null on failure. */
export async function transcribeAudio(audio: InlineFile): Promise<string | null> {
  return geminiText(
    'Transcribe this voice note from an Indian user talking to a personal finance app. ' +
      'It may mix English and Hindi (Hinglish). Return ONLY the cleaned request as one line of plain text: ' +
      'remove filler words (umm, like, matlab), keep numbers as digits with ₹ for rupees (e.g. "five thousand" → "₹5,000"). ' +
      'If there is no speech, return an empty line.',
    { agent: 'voice', files: [audio], temperature: 0 },
  );
}

/** Quick connectivity check for Settings → Developer. */
export async function testGemini(): Promise<{ ok: boolean; message: string }> {
  if (!aiAvailable()) return { ok: false, message: 'AI not set up in .env' };
  try {
    const t = await generate('Reply with the single word: ready', { temperature: 0, timeoutMs: 25000 });
    const via = aiMode === 'proxy' ? 'proxy' : 'direct';
    return { ok: true, message: `Connected via ${via} (${lastGeminiModel}): ${t.slice(0, 40)}` };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'Failed' };
  }
}

export const GEMINI_MODEL = MODEL;
