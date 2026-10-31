# Security

Bachat is a privacy-first money app. The maths runs on your phone; the AI only sees what it must, with identifiers masked.

## Reporting a vulnerability

- Please report privately through GitHub's **Report a vulnerability** (Security tab → Advisories) on this repository.
- Include steps to reproduce, the affected version or commit, and the impact.
- Please don't open a public issue for security problems. We aim to reply within 7 days.

## What stays on the device

- Bank SMS, CSV and PDF statements, every transaction row, rules, goals, profile and settings.
- All numbers: totals, budgets, recurring payments, savings ideas, what-if plans, goal plans.
- The storage key (Android Keystore / iOS Keychain).

## What leaves the device

| Where | What | Protection |
|---|---|---|
| AI proxy → Google Gemini | Short facts (category totals, merchant names, amounts), one merchant/narration to categorise, a typed question, a voice note, or a PDF only when the on-device reader can't read it | Card/account numbers, UPI IDs, phones, emails, PAN, Aadhaar, IFSC, OTPs and reference numbers are masked first (`src/services/redact.ts`). No key in the app. |
| Family sync (Supabase, optional) | A monthly snapshot of totals (or 90 days of rows if you choose "full") | End-to-end encrypted with the household secret; the server stores ciphertext only. |
| jsDelivr CDN | Download of pdf.js 4.10.38 (no user data) | Pinned version, SHA-384 integrity check before it runs. |

## Threat model

**Assets:** transaction history, statements, income and goals; account/card identifiers; the Gemini API key; the household secret.

| Threat | Mitigation |
|---|---|
| Stolen or shared phone | Optional **App lock** (fingerprint, face or phone PIN) on launch and after 60 s away; cover over the app-switcher snapshot (iOS). "Hide amounts" eye icon. |
| Data read from storage (backup, rooted device, file copy) | Store encrypted with XSalsa20-Poly1305 (tweetnacl secretbox); random 32-byte key in the OS keystore, this device only. Android auto-backup off. |
| API key extracted from the app | Key lives only in the Cloudflare Worker (`worker/`). The app sends no key when `EXPO_PUBLIC_AI_PROXY_URL` is set. A direct key is for local development only. |
| Proxy abuse | Model allowlist, body size limit, browser origin allowlist, optional app token, per-IP rate limit, only known request fields forwarded, no logging of bodies. |
| Personal identifiers sent to the AI | Central redaction of every outgoing text part and tool result. Merchant names and amounts stay so answers are useful. |
| Prompt injection (a crafted SMS, narration or PDF) | Bank text is wrapped as data with "data, not instructions" delimiters, and a security rule is added to every system instruction. AI output is schema-checked JSON or text that passes the output guard (no links, no asks for OTP/PIN/password, no investment picks, only numbers the device computed). The AI can only *propose* changes; writes need your tap. |
| Investment picks or invented numbers | Guardrail refuses security picks before any AI call; `guardOutput` rejects tickers, fund names, predictions and any number the device didn't compute. |
| Tampered CDN script | pdf.js is fetched, hashed (SHA-384) and only then run from a `blob:` URL; a mismatch is refused. |
| Malicious content in the PDF reader WebView | Strict Content-Security-Policy, origin whitelist (the CDN only), all navigation blocked, no file access, no new windows, no cookies or DOM storage, base64-only input with a size limit, `isEvalSupported: false`. |
| Oversized imports (memory / freeze) | Limits: 5 MB of pasted/CSV text, 11 MB PDF, 8 MB base64 for the on-device reader. |
| Lock-screen leaks | Nudge notifications use neutral text (no amounts) while Hide amounts or App lock is on. |
| Deep links | The `bachat://` scheme only opens screens; it never triggers an action without a tap. |
| Code injection | No `eval` / `new Function`; AI replies are parsed with `JSON.parse` and validated. No logging of user data. |

## Known limits

- **Web build:** data is kept in the browser's localStorage without encryption (a browser has no hardware-backed key store) and App lock isn't available.
- **App-switcher snapshot on Android:** fully hiding it needs `FLAG_SECURE`, which needs a native module that isn't in Expo Go.
- **Files sent to the AI** (a PDF the device couldn't read, a voice note) can't be redacted. They're sent only when you import them, and never stored by Bachat.
- `EXPO_PUBLIC_*` values are bundled into the app. `EXPO_PUBLIC_AI_APP_TOKEN` slows down casual abuse of the proxy but is not a secret; rely on the rate limit and a Cloudflare rate-limiting rule.
- If the phone's keystore is wiped (or the app data is restored to another phone), the encrypted store can't be read and the app starts empty.

## Secrets

- `.env` is git-ignored; `.env.example` lists every variable.
- `GEMINI_API_KEY` and `APP_TOKEN` are Worker secrets (`npx wrangler secret put …`), never in `wrangler.toml` or `app.json`.
