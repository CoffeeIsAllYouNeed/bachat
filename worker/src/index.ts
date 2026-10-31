/**
 * Bachat AI proxy (Cloudflare Worker).
 *
 * POST /v1/generate  { model, body }  →  Gemini generateContent, with the key
 * added here (secret GEMINI_API_KEY), so the app never ships a key.
 *
 * Checks, in order: route + method → CORS origin allowlist (browsers) →
 * x-app-token (when APP_TOKEN is set) → per-IP rate limit → body size →
 * JSON shape → model allowlist → only known request fields forwarded.
 * Request and response bodies are never logged or stored.
 */

export interface Env {
  GEMINI_API_KEY: string;
  /** Optional shared token; the app sends it as x-app-token. */
  APP_TOKEN?: string;
  /** Comma-separated browser origins, e.g. "https://bachat.example,http://localhost:8081". */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated model ids. */
  ALLOWED_MODELS?: string;
  RATE_LIMIT_PER_MIN?: string;
  MAX_BODY_MB?: string;
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
/** Top-level generateContent fields the app uses; anything else is dropped. */
const BODY_FIELDS = ['contents', 'systemInstruction', 'generationConfig', 'tools', 'toolConfig', 'safetySettings'];
const UPSTREAM_TIMEOUT_MS = 90_000;

function list(v: string | undefined, fallback: string[] = []): string[] {
  const xs = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xs.length ? xs : fallback;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Constant-time string compare (token check). */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ------------------------------------------------------------------ rate limit (in memory, per instance)

const hits = new Map<string, number[]>();

function limited(ip: string, perMinute: number): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    // Drop the oldest entries so memory stays small.
    for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
  }
  return false;
}

// ------------------------------------------------------------------ responses

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-app-token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function reply(status: number, data: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
    },
  });
}

const fail = (status: number, message: string, cors: Record<string, string>) => reply(status, { error: { message } }, cors);

// ------------------------------------------------------------------ handler

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const origins = list(env.ALLOWED_ORIGINS);
  // Browsers send Origin; phones don't. A browser origin must be on the list.
  if (origin && !origins.includes(origin)) return fail(403, 'Origin not allowed', {});
  const cors = corsHeaders(origin);

  if (url.pathname !== '/v1/generate') return fail(404, 'Not found', cors);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail(405, 'Method not allowed', cors);

  if (env.APP_TOKEN && !same(request.headers.get('x-app-token') ?? '', env.APP_TOKEN)) return fail(401, 'Unauthorized', cors);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (limited(ip, num(env.RATE_LIMIT_PER_MIN, 30))) return fail(429, 'Rate limit: try again later', cors);

  const maxBytes = num(env.MAX_BODY_MB, 10) * 1024 * 1024;
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) return fail(413, 'Request too large', cors);
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) return fail(415, 'JSON only', cors);

  const raw = await request.arrayBuffer();
  if (raw.byteLength > maxBytes) return fail(413, 'Request too large', cors);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, 'Bad JSON', cors);
  }
  if (!payload || typeof payload !== 'object') return fail(400, 'Bad request', cors);
  const { model, body } = payload as { model?: unknown; body?: unknown };
  const models = list(env.ALLOWED_MODELS, DEFAULT_MODELS);
  if (typeof model !== 'string' || !/^[a-z0-9.\-]{3,64}$/.test(model) || !models.includes(model)) {
    return fail(404, 'Model not allowed', cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Bad request', cors);
  const src = body as Record<string, unknown>;
  if (!Array.isArray(src.contents) || !src.contents.length) return fail(400, 'Bad request', cors);
  const forward: Record<string, unknown> = {};
  for (const k of BODY_FIELDS) if (k in src) forward[k] = src[k];
  // Only the app's own function declarations: server-side tools (URL fetch, search, code execution)
  // would let a caller make Google fetch arbitrary URLs on this key.
  if ('tools' in forward) {
    const tools = Array.isArray(forward.tools) ? forward.tools : [];
    const ok = tools.every((t) => !!t && typeof t === 'object' && Object.keys(t as object).every((k) => k === 'functionDeclarations'));
    if (!ok) return fail(400, 'Tool not allowed', cors);
  }

  if (!env.GEMINI_API_KEY) return fail(503, 'Proxy not configured', cors);

  let upstream: Response;
  try {
    upstream = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(forward),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return fail(504, 'Upstream timeout', cors);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Pass the status (the app retries/falls back on 429/5xx/404) and Google's short message, nothing else.
    let message = `Upstream error ${upstream.status}`;
    try {
      const j = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof j?.error?.message === 'string') message = j.error.message.slice(0, 200);
    } catch {
      // keep the generic message
    }
    return fail(upstream.status, message, cors);
  }
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      return fail(500, 'Proxy error', {});
    }
  },
};
