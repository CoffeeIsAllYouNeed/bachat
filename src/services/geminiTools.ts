/**
 * Gemini function calling on top of geminiRequest (which does the proxy /
 * direct call, redaction, retry and model fallback).
 *
 * The loop: send the question with `tools: [{ functionDeclarations }]` →
 * the model answers with functionCall parts → each call runs on the device →
 * its result goes back as a functionResponse → … until the model writes text
 * (max 5 model calls; the last one is forced to answer in text).
 * Tools never see raw SMS; they return aggregated numbers computed on the device.
 */

import { aiAvailable, geminiRequest } from '@/services/gemini';

/** JSON-schema subset Gemini accepts for function parameters. */
export interface ParamSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, ParamSchema>;
  required?: string[];
  items?: ParamSchema;
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: ParamSchema;
}

/** One tool call the loop made (for the "Checked spending · ran what-if" line). */
export interface ToolStep {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ToolLoopOptions {
  system: string;
  prompt: string;
  declarations: FunctionDeclaration[];
  /** Runs one tool on the device; returns a JSON-safe object (errors as `{ error }`). Never throws on purpose. */
  execute: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Model calls, including the final text one (default and maximum 5). */
  maxSteps?: number;
  timeoutMs?: number;
  temperature?: number;
}

export interface ToolLoopResult {
  /** Final text, or null when the model gave none. */
  text: string | null;
  steps: ToolStep[];
}

const MAX_STEPS = 5;
/** Function calls handled per model turn (more are answered with an error). */
const MAX_CALLS_PER_TURN = 4;

interface Part {
  text?: string;
  functionCall?: { name?: unknown; args?: unknown; id?: unknown };
  [k: string]: unknown;
}

function partsOf(json: unknown): Part[] {
  const c = (json as { candidates?: { content?: { parts?: unknown } }[] } | null)?.candidates?.[0]?.content?.parts;
  return Array.isArray(c) ? (c.filter((p) => !!p && typeof p === 'object') as Part[]) : [];
}

function plainArgs(a: unknown): Record<string, unknown> {
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
}

/**
 * Runs the function-calling loop. Throws (GeminiError) only when the very
 * first request fails, so callers can tell "AI busy" from "no answer".
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  if (!aiAvailable()) throw new Error('AI not set up');
  const maxSteps = Math.max(1, Math.min(MAX_STEPS, opts.maxSteps ?? MAX_STEPS));
  const known = new Set(opts.declarations.map((d) => d.name));
  const contents: Record<string, unknown>[] = [{ role: 'user', parts: [{ text: opts.prompt }] }];
  const steps: ToolStep[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const last = step === maxSteps - 1;
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: opts.system }] },
      tools: [{ functionDeclarations: opts.declarations }],
      // The last turn must answer in words.
      toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : 'AUTO' } },
      generationConfig: { temperature: opts.temperature ?? 0.2 },
    };
    let json: unknown;
    try {
      json = await geminiRequest(body, { timeoutMs: opts.timeoutMs ?? 15000 });
    } catch (e) {
      if (step === 0) throw e;
      return { text: null, steps };
    }
    const parts = partsOf(json);
    const calls = parts.filter((p) => p.functionCall && typeof p.functionCall === 'object');
    if (!calls.length || last) {
      const text = parts
        .filter((p) => typeof p.text === 'string' && p.thought !== true)
        .map((p) => p.text as string)
        .join('')
        .trim();
      return { text: text || null, steps };
    }

    // Echo the model turn unchanged (keeps any thought signatures), then answer every call.
    contents.push({ role: 'model', parts });
    const responses: Record<string, unknown>[] = [];
    for (let i = 0; i < calls.length; i++) {
      const fc = calls[i].functionCall!;
      const name = typeof fc.name === 'string' ? fc.name : '';
      const args = plainArgs(fc.args);
      let response: Record<string, unknown>;
      let ok = false;
      if (!known.has(name)) response = { error: `Unknown tool "${name}".` };
      else if (i >= MAX_CALLS_PER_TURN) response = { error: 'Too many tool calls at once. Use the results you have.' };
      else {
        try {
          response = await opts.execute(name, args);
          ok = !('error' in response);
        } catch {
          response = { error: 'The tool failed on the device.' };
        }
      }
      if (known.has(name)) steps.push({ name, args, ok });
      const fr: Record<string, unknown> = { name: name || 'unknown', response };
      if (typeof fc.id === 'string') fr.id = fc.id;
      responses.push({ functionResponse: fr });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { text: null, steps };
}
