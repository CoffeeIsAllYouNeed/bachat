import { File as FsFile, Paths } from 'expo-file-system';
import React, { useEffect, useRef } from 'react';
import { NativeModules, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import type { PdfCell, PdfLine } from './statementTable';

/**
 * The class is declared `WebView<P = undefined> extends Component<WebViewProps & P>`, so its
 * default props type is `WebViewProps & undefined` (= never) and createElement can't take it.
 * Re-typed once here with the real props + ref.
 */
const HiddenWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebView> }>;

/*
 * PDF text layer on the device with pdf.js:
 *  - web: the pdfjs-dist legacy build loaded from the CDN (verified, see below);
 *  - phone: the same code inside a hidden WebView (<PdfTextHost/>, mounted once at the root).
 * Returns the text as lines of positioned cells for the table parser.
 * For a scanned PDF (no text layer) it can also return page images, which
 * are read with ML Kit text recognition when that native module is in the build.
 */

/*
 * Security (pinned + verified code, locked-down WebView):
 *  - pdf.js is pinned to one exact version and both files are checked against
 *    Subresource Integrity hashes (sha384 of the files in the npm tarball
 *    pdfjs-dist@4.10.38, which jsDelivr serves byte for byte) before they run:
 *    fetched → hashed with crypto.subtle → only then imported from a blob: URL.
 *    A changed or tampered CDN file is refused (the import falls back to Gemini/CSV).
 *  - pdf.js runs with isEvalSupported:false (no eval / new Function).
 *  - The WebView: a strict Content-Security-Policy, origin whitelist limited to
 *    the CDN, every navigation blocked, no file access, no new windows, no
 *    cookies or DOM storage; input is checked to be plain base64 and size-limited
 *    before it is injected.
 */
const PDFJS_VERSION = '4.10.38';
const CDN_ORIGIN = 'https://cdn.jsdelivr.net';
const CDN = `${CDN_ORIGIN}/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build`;
const LIB_URL = `${CDN}/pdf.min.mjs`;
const WORKER_URL = `${CDN}/pdf.worker.min.mjs`;
const LIB_SRI = 'sha384-z/XbAtvhBXJoK+yvYimnFuTCF6/2wTCDSIFD09/HtIfwFtvDKOMdAe5Z3wOChkmW';
const WORKER_SRI = 'sha384-vbNBYP03jHFPlgtK4qSXtazEmGfmpTWlSsfq9OiU20MroW/Q9TbaEXiM7PpeWg+6';
/** Largest base64 PDF read on the device (~6 MB file). */
const MAX_DEVICE_BASE64 = 8 * 1024 * 1024;
/** The WebView's document URL (its origin is the only one whitelisted). */
const HOST_BASE_URL = `${CDN_ORIGIN}/`;

export interface PdfTextResult {
  pages: PdfLine[][];
  /** Characters in the text layer (≈0 for a scanned PDF). */
  chars: number;
  /** JPEG base64 per page, only for a scanned PDF when asked for. */
  images: string[];
}

export type PdfTextOutcome =
  | { ok: true; result: PdfTextResult }
  | { ok: false; reason: 'password' | 'unavailable' | 'error' };

/** Runs in the browser / WebView with `pdfjsLib` in scope. Plain JS (shipped as text). */
const PAGE_JS = `
function bachatB64(b64) {
  var bin = atob(b64); var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function bachatExtract(pdfjsLib, b64, render) {
  var doc = await pdfjsLib.getDocument({ data: bachatB64(b64), isEvalSupported: false, useSystemFonts: true }).promise;
  var n = Math.min(doc.numPages, 60);
  var pages = []; var chars = 0; var images = [];
  for (var p = 1; p <= n; p++) {
    var page = await doc.getPage(p);
    var tc = await page.getTextContent();
    var rows = [];
    for (var k = 0; k < tc.items.length; k++) {
      var it = tc.items[k];
      if (!it || typeof it.str !== 'string') continue;
      var s = it.str.replace(/\\s+/g, ' ').trim();
      if (!s) continue;
      var x = it.transform[4], y = it.transform[5], w = it.width || 0;
      chars += s.length;
      var row = null;
      for (var r = 0; r < rows.length; r++) if (Math.abs(rows[r].y - y) <= 2.5) { row = rows[r]; break; }
      if (!row) { row = { y: y, cells: [] }; rows.push(row); }
      row.cells.push({ x: Math.round(x * 10) / 10, w: Math.round(w * 10) / 10, s: s });
    }
    rows.sort(function (a, b) { return b.y - a.y; });
    pages.push(rows.map(function (r) {
      r.cells.sort(function (a, b) { return a.x - b.x; });
      return { y: Math.round(r.y), cells: r.cells };
    }));
  }
  if (render && chars < 40 * n) {
    for (var q = 1; q <= Math.min(n, 6); q++) {
      var pg = await doc.getPage(q);
      var vp = pg.getViewport({ scale: 1.6 });
      var canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || '');
    }
  }
  return { pages: pages, chars: chars, images: images };
}
`;

/** Fetches a pinned file, checks its SRI hash, and returns a blob: URL of the verified bytes (throws otherwise). */
const LOADER_JS = `
async function bachatVerified(url, sri) {
  var res = await fetch(url, { credentials: 'omit', mode: 'cors', redirect: 'error' });
  if (!res.ok) throw new Error('load');
  var buf = await res.arrayBuffer();
  var d = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
  var s = ''; for (var i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
  if ('sha384-' + btoa(s) !== sri) throw new Error('integrity');
  return URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
}
async function bachatPdfjs() {
  var lib = await bachatVerified(${JSON.stringify(LIB_URL)}, ${JSON.stringify(LIB_SRI)});
  var worker = await bachatVerified(${JSON.stringify(WORKER_URL)}, ${JSON.stringify(WORKER_SRI)});
  var pdfjsLib = await import(lib);
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(worker, { type: 'module' });
  return pdfjsLib;
}
`;

const MODULE_HEAD = `${LOADER_JS}
${PAGE_JS}`;

/** Only the verified pdf.js may run: inline bootstrap, blob: modules/worker, fetches to the CDN only. */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src blob:; " +
  `connect-src ${CDN_ORIGIN} blob: data:; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; ` +
  "form-action 'none'; base-uri 'none'";

const WEBVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script type="module">
${MODULE_HEAD}
var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
var libP = null;
window.__bachatRun = async function (id, b64, render) {
  var pdfjsLib;
  try { if (!libP) libP = bachatPdfjs(); pdfjsLib = await libP; }
  catch (e) { libP = null; post({ id: id, ok: false, error: 'unavailable' }); return; }
  try { var r = await bachatExtract(pdfjsLib, b64, render); post({ id: id, ok: true, r: r }); }
  catch (e) { post({ id: id, ok: false, error: (e && e.name) || 'error' }); }
};
post({ ready: true });
</script></body></html>`;

function errReason(name: unknown): 'password' | 'error' {
  return name === 'PasswordException' ? 'password' : 'error';
}

function asResult(v: unknown): PdfTextResult | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { pages?: unknown; chars?: unknown; images?: unknown };
  if (!Array.isArray(o.pages)) return null;
  const pages: PdfLine[][] = [];
  for (const pg of o.pages) {
    if (!Array.isArray(pg)) continue;
    const lines: PdfLine[] = [];
    for (const l of pg as { y?: unknown; cells?: unknown }[]) {
      if (!l || !Array.isArray(l.cells)) continue;
      const cells: PdfCell[] = [];
      for (const c of l.cells as { x?: unknown; w?: unknown; s?: unknown }[]) {
        if (c && typeof c.s === 'string' && typeof c.x === 'number') cells.push({ x: c.x, w: typeof c.w === 'number' ? c.w : 0, s: c.s });
      }
      if (cells.length) lines.push({ y: typeof l.y === 'number' ? l.y : 0, cells });
    }
    pages.push(lines);
  }
  return {
    pages,
    chars: typeof o.chars === 'number' ? o.chars : 0,
    images: Array.isArray(o.images) ? o.images.filter((x): x is string => typeof x === 'string' && x.length > 0) : [],
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

// ---------------------------------------------------------------- web

type WebRun = (b64: string, render: boolean) => Promise<unknown>;
let webLoader: Promise<WebRun | null> | null = null;

function loadWeb(): Promise<WebRun | null> {
  if (webLoader) return webLoader;
  webLoader = new Promise<WebRun | null>((resolve) => {
    const g = globalThis as any;
    if (!g.document) {
      resolve(null);
      return;
    }
    if (typeof g.__bachatWebRun === 'function') {
      resolve(g.__bachatWebRun as WebRun);
      return;
    }
    const done = () => resolve(typeof g.__bachatWebRun === 'function' ? (g.__bachatWebRun as WebRun) : null);
    g.addEventListener?.('bachat-pdfjs-ready', done, { once: true });
    const s = g.document.createElement('script');
    s.type = 'module';
    // Same verified loader as the WebView: nothing runs unless both files match their SRI hashes.
    s.textContent = `${MODULE_HEAD}
try {
  const pdfjsLib = await bachatPdfjs();
  window.__bachatWebRun = function (b64, render) { return bachatExtract(pdfjsLib, b64, render); };
} catch (e) {}
window.dispatchEvent(new Event('bachat-pdfjs-ready'));`;
    s.onerror = () => resolve(null);
    g.document.head.appendChild(s);
    setTimeout(() => resolve(null), 30000);
  });
  // A failed load can be retried on the next import.
  void webLoader.then((r) => {
    if (!r) webLoader = null;
  });
  return webLoader;
}

// ---------------------------------------------------------------- phone (hidden WebView)

interface HostApi {
  run: (id: string, b64: string, render: boolean) => void;
}
let host: HostApi | null = null;
let hostReady = false;
const readyWaiters: (() => void)[] = [];
const jobs = new Map<string, (v: { ok: boolean; r?: unknown; error?: unknown }) => void>();

/** Navigation guard: the host page (and about:blank) only; links, redirects and frames elsewhere are refused. */
function allowHostOnly(e: WebViewNavigation): boolean {
  const url = typeof e?.url === 'string' ? e.url : '';
  return url === HOST_BASE_URL || url === CDN_ORIGIN || url === 'about:blank';
}

function waitReady(ms: number): Promise<boolean> {
  if (host && hostReady) return Promise.resolve(true);
  return withTimeout(new Promise<boolean>((resolve) => readyWaiters.push(() => resolve(true))), ms, false);
}

/**
 * Hidden WebView that runs pdf.js on the phone. Mount once near the root
 * (renders nothing on the web). Without it the phone skips straight to Gemini.
 */
export function PdfTextHost(): React.ReactElement | null {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    host = {
      run: (id, b64, render) => {
        ref.current?.injectJavaScript(`window.__bachatRun && window.__bachatRun(${JSON.stringify(id)}, "${b64}", ${render ? 'true' : 'false'}); true;`);
      },
    };
    return () => {
      host = null;
      hostReady = false;
    };
  }, []);
  if (Platform.OS === 'web') return null;
  const onMessage = (e: WebViewMessageEvent) => {
    // Only messages from the host page itself (navigation elsewhere is blocked anyway).
    const from = typeof e.nativeEvent.url === 'string' ? e.nativeEvent.url : '';
    if (from && !from.startsWith(HOST_BASE_URL) && from !== CDN_ORIGIN && from !== 'about:blank') return;
    let m: { ready?: boolean; id?: string; ok?: boolean; r?: unknown; error?: unknown } | null = null;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      m = null;
    }
    if (!m) return;
    if (m.ready) {
      hostReady = true;
      readyWaiters.splice(0).forEach((f) => f());
      return;
    }
    if (typeof m.id === 'string') {
      const cb = jobs.get(m.id);
      jobs.delete(m.id);
      cb?.({ ok: !!m.ok, r: m.r, error: m.error });
    }
  };
  return React.createElement(
    View,
    { style: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, pointerEvents: 'none' } },
    React.createElement(HiddenWebView, {
      ref,
      source: { html: WEBVIEW_HTML, baseUrl: HOST_BASE_URL },
      originWhitelist: [CDN_ORIGIN],
      // Only the host document itself may load; any other navigation is refused.
      onShouldStartLoadWithRequest: allowHostOnly,
      javaScriptEnabled: true,
      javaScriptCanOpenWindowsAutomatically: false,
      setSupportMultipleWindows: false,
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      allowsLinkPreview: false,
      domStorageEnabled: false,
      geolocationEnabled: false,
      thirdPartyCookiesEnabled: false,
      sharedCookiesEnabled: false,
      mixedContentMode: 'never',
      dataDetectorTypes: 'none',
      onMessage,
      style: { width: 1, height: 1 },
    }),
  );
}

// ---------------------------------------------------------------- API

/** Reads the PDF's text layer on the device. [render] also returns page images when the PDF looks scanned. */
export async function extractPdfText(base64: string, render = false): Promise<PdfTextOutcome> {
  const data = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!data || data.length > MAX_DEVICE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(data)) return { ok: false, reason: 'unavailable' };
  try {
    if (Platform.OS === 'web') {
      const run = await loadWeb();
      if (!run) return { ok: false, reason: 'unavailable' };
      const out = await withTimeout<{ r?: unknown; err?: unknown }>(
        run(data, render).then(
          (r) => ({ r }),
          (e: unknown) => ({ err: (e as { name?: unknown } | null)?.name ?? 'error' }),
        ),
        60000,
        { err: 'timeout' },
      );
      if (out.err) return { ok: false, reason: errReason(out.err) };
      const r = asResult(out.r);
      return r ? { ok: true, result: r } : { ok: false, reason: 'error' };
    }
    // No host mounted → no on-device reader; a mounted host gets a moment to load pdf.js.
    if (!host || !(await waitReady(10000)) || !host) return { ok: false, reason: 'unavailable' };
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const reply = await withTimeout(
      new Promise<{ ok: boolean; r?: unknown; error?: unknown }>((resolve) => {
        jobs.set(id, resolve);
        host?.run(id, data, render);
      }),
      60000,
      { ok: false, error: 'timeout' },
    );
    jobs.delete(id);
    if (!reply.ok) return { ok: false, reason: errReason(reply.error) };
    const r = asResult(reply.r);
    return r ? { ok: true, result: r } : { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** True when the PDF has (almost) no text layer — a scanned statement. */
export function looksScanned(r: PdfTextResult): boolean {
  const n = Math.max(1, r.pages.length);
  return r.chars < 40 * n;
}

// ---------------------------------------------------------------- OCR (optional native module)

interface OcrFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface OcrResult {
  blocks?: { lines?: { text?: string; frame?: OcrFrame; elements?: { text?: string; frame?: OcrFrame }[] }[] }[];
}
interface OcrModule {
  recognize: (url: string, script: string) => Promise<OcrResult>;
}

/** ML Kit text recognition when a dev build includes it (not in Expo Go); null otherwise. */
function ocrModule(): OcrModule | null {
  try {
    const m = (NativeModules as Record<string, unknown>).TextRecognition as Partial<OcrModule> | undefined;
    return m && typeof m.recognize === 'function' ? (m as OcrModule) : null;
  } catch {
    return null;
  }
}

export function ocrAvailable(): boolean {
  return Platform.OS !== 'web' && ocrModule() !== null;
}

/** OCR of page images (JPEG base64) into the same lines/cells shape; null when OCR isn't available. */
export async function ocrPages(images: string[]): Promise<PdfLine[][] | null> {
  const mod = Platform.OS === 'web' ? null : ocrModule();
  if (!mod || !images.length) return null;
  const pages: PdfLine[][] = [];
  for (let i = 0; i < images.length; i++) {
    let file: FsFile | null = null;
    try {
      file = new FsFile(Paths.cache, `bachat-ocr-${Date.now()}-${i}.jpg`);
      await file.write(images[i], { encoding: 'base64' });
      const res = await mod.recognize(file.uri, 'Latin');
      pages.push(ocrToLines(res));
    } catch {
      pages.push([]);
    } finally {
      try {
        file?.delete();
      } catch {
        // cache files are cleaned up by the system anyway
      }
    }
  }
  return pages;
}

/** Groups OCR words by vertical centre into lines; joins words that sit close together into cells. */
function ocrToLines(res: OcrResult): PdfLine[] {
  const words: { x: number; w: number; cy: number; h: number; s: string }[] = [];
  for (const b of res.blocks ?? []) {
    for (const l of b.lines ?? []) {
      const els = l.elements?.length ? l.elements : [{ text: l.text, frame: l.frame }];
      for (const e of els) {
        const s = (e.text ?? '').trim();
        const f = e.frame;
        if (!s || !f) continue;
        words.push({ x: f.left, w: f.width, cy: f.top + f.height / 2, h: f.height, s });
      }
    }
  }
  words.sort((a, b) => a.cy - b.cy);
  const rows: { cy: number; h: number; ws: typeof words }[] = [];
  for (const w of words) {
    const row = rows.find((r) => Math.abs(r.cy - w.cy) <= Math.max(4, Math.min(r.h, w.h) * 0.5));
    if (row) row.ws.push(w);
    else rows.push({ cy: w.cy, h: w.h, ws: [w] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  return rows.map((r) => {
    const ws = [...r.ws].sort((a, b) => a.x - b.x);
    const cells: PdfCell[] = [];
    for (const w of ws) {
      const last = cells[cells.length - 1];
      if (last && w.x - (last.x + last.w) <= r.h * 0.8) {
        last.s = `${last.s} ${w.s}`;
        last.w = w.x + w.w - last.x;
      } else cells.push({ x: w.x, w: w.w, s: w.s });
    }
    return { y: Math.round(-r.cy), cells };
  });
}
