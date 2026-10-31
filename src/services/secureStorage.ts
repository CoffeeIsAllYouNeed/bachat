import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import { AppState, Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/**
 * Encrypted storage for the zustand store (persist middleware).
 *
 * Phone: the persisted JSON is sealed with XSalsa20-Poly1305 (tweetnacl
 * secretbox) before it reaches AsyncStorage. The 32-byte key is random
 * (expo-crypto getRandomBytes) and lives in the OS keystore (expo-secure-store:
 * Android Keystore / iOS Keychain, this device only). A fresh 24-byte nonce
 * per write. Stored value: "bachat:enc:v1:<nonce b64>:<box b64>".
 *
 * Web: plain AsyncStorage (= localStorage). A browser has no hardware-backed
 * key store, so a key kept next to the data would add nothing. Documented in
 * SECURITY.md.
 *
 * Migration: a plaintext JSON value from an older version is read as is and
 * saved encrypted right away.
 *
 * Fail safe, never crash:
 *  - key missing but data encrypted (app data restored without the keystore,
 *    keystore wiped) → the data can't be read: start empty (the old ciphertext
 *    is copied once to "<name>.unreadable" before anything new is written);
 *  - keystore unreachable (error, after short retries) → start empty AND don't
 *    write this session, so the encrypted data on disk is not overwritten;
 *    an error while writing only skips that write (retried on the next change);
 *  - a value that fails to decrypt → start empty (copy kept as above).
 * Writes are coalesced (latest wins, ~300 ms) and flushed when the app goes to
 * the background, so big stores aren't re-encrypted on every keystroke.
 */

const PREFIX = 'bachat:enc:v1:';
const KEY_NAME = 'bachat.storeKey.v1';
const WRITE_DELAY_MS = 300;

const native = Platform.OS !== 'web';

// ------------------------------------------------------------------ bytes ⇄ text

function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b);
  let s = '';
  let chunk: number[] = [];
  const flush = () => {
    s += String.fromCharCode(...chunk);
    chunk = [];
  };
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c < 0xf0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    if (cp > 0xffff) {
      cp -= 0x10000;
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    } else chunk.push(cp);
    if (chunk.length > 8000) flush();
  }
  flush();
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

function toBase64(b: Uint8Array): string {
  const parts: string[] = [];
  let line = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    line +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < b.length ? B64[n & 63] : '=');
    if (line.length >= 8192) {
      parts.push(line);
      line = '';
    }
  }
  parts.push(line);
  return parts.join('');
}

function fromBase64(s: string): Uint8Array | null {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INDEX[clean.charCodeAt(i)];
    const b = B64_INDEX[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_INDEX[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? B64_INDEX[clean.charCodeAt(i + 3)] : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

// ------------------------------------------------------------------ key

type KeyState = { kind: 'ok'; key: Uint8Array } | { kind: 'missing' } | { kind: 'error' };

async function randomBytes(n: number): Promise<Uint8Array> {
  const Crypto = await import('expo-crypto');
  const b = Crypto.getRandomBytes(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error('random');
  return b;
}

async function readKey(): Promise<KeyState> {
  try {
    const SecureStore = await import('expo-secure-store');
    const v = await SecureStore.getItemAsync(KEY_NAME);
    if (!v) return { kind: 'missing' };
    const key = fromBase64(v);
    return key && key.length === nacl.secretbox.keyLength ? { kind: 'ok', key } : { kind: 'missing' };
  } catch {
    return { kind: 'error' };
  }
}

async function createKey(): Promise<Uint8Array | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const key = await randomBytes(nacl.secretbox.keyLength);
    await SecureStore.setItemAsync(KEY_NAME, toBase64(key), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return key;
  } catch {
    return null;
  }
}

let keyPromise: Promise<KeyState> | null = null;
/** True when the stored data could not be read this session: writes are skipped so the encrypted data on disk survives. */
let readOnly = false;

/** Reads the key, retrying a transient keystore error a few times. Only an 'ok' or 'missing' answer is cached. */
function getKeyState(): Promise<KeyState> {
  if (!keyPromise) {
    keyPromise = (async () => {
      let st = await readKey();
      for (let i = 0; i < 2 && st.kind === 'error'; i++) {
        await new Promise<void>((r) => setTimeout(r, 400));
        st = await readKey();
      }
      if (st.kind === 'error') keyPromise = null; // try again on the next read/write
      return st;
    })();
  }
  return keyPromise;
}

async function keyForWrite(): Promise<Uint8Array | null> {
  if (readOnly) return null;
  const st = await getKeyState();
  if (st.kind === 'ok') return st.key;
  if (st.kind === 'error') return null;
  const key = await createKey();
  if (key) keyPromise = Promise.resolve({ kind: 'ok', key });
  return key;
}

// ------------------------------------------------------------------ seal / open

async function seal(plain: string, key: Uint8Array): Promise<string> {
  const nonce = await randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(utf8Encode(plain), nonce, key);
  return `${PREFIX}${toBase64(nonce)}:${toBase64(box)}`;
}

function open(stored: string, key: Uint8Array): string | null {
  const body = stored.slice(PREFIX.length);
  const sep = body.indexOf(':');
  if (sep < 0) return null;
  const nonce = fromBase64(body.slice(0, sep));
  const box = fromBase64(body.slice(sep + 1));
  if (!nonce || !box || nonce.length !== nacl.secretbox.nonceLength) return null;
  const plain = nacl.secretbox.open(box, nonce, key);
  return plain ? utf8Decode(plain) : null;
}

// ------------------------------------------------------------------ coalesced writes

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();

async function writeNow(name: string, value: string): Promise<void> {
  if (!native) {
    await AsyncStorage.setItem(name, value);
    return;
  }
  const key = await keyForWrite();
  if (!key) return; // keystore unavailable: keep what's on disk, try again on the next change
  await AsyncStorage.setItem(name, await seal(value, key));
}

function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = [...pending.entries()];
  pending.clear();
  if (!batch.length) return flushing;
  flushing = flushing.then(async () => {
    for (const [name, value] of batch) {
      try {
        await writeNow(name, value);
      } catch {
        // storage full / unavailable: the in-memory state stays; the next change retries
      }
    }
  });
  return flushing;
}

let appStateHooked = false;
function hookAppState(): void {
  if (appStateHooked || !native) return;
  appStateHooked = true;
  try {
    AppState.addEventListener('change', (s) => {
      if (s !== 'active') void flush();
    });
  } catch {
    // no AppState (tests): writes still flush on the timer
  }
}

// ------------------------------------------------------------------ StateStorage

export const secureStorage: StateStorage<Promise<void>> = {
  getItem: async (name) => {
    if (pending.has(name)) return pending.get(name) ?? null;
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(name);
    } catch {
      return null;
    }
    if (raw == null || !native) return raw;
    if (!raw.startsWith(PREFIX)) {
      // Plaintext from an older version: use it and save it encrypted now.
      try {
        JSON.parse(raw);
      } catch {
        return null;
      }
      void secureStorage.setItem(name, raw);
      return raw;
    }
    const st = await getKeyState();
    if (st.kind === 'error') {
      readOnly = true; // don't overwrite data we couldn't read
      return null;
    }
    let plain: string | null = null;
    if (st.kind === 'ok') {
      try {
        plain = open(raw, st.key);
      } catch {
        plain = null;
      }
    }
    if (plain == null) {
      // Key lost or data unreadable: start empty, but first set the old ciphertext aside once,
      // so a new key's first write can't destroy it (it can be opened again if the key comes back).
      try {
        const backup = `${name}.unreadable`;
        if ((await AsyncStorage.getItem(backup)) == null) await AsyncStorage.setItem(backup, raw);
      } catch {
        readOnly = true; // couldn't keep a copy: don't overwrite the original either
      }
    }
    return plain;
  },
  setItem: async (name, value) => {
    hookAppState();
    pending.set(name, value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, WRITE_DELAY_MS);
  },
  removeItem: async (name) => {
    pending.delete(name);
    try {
      await flush();
      await AsyncStorage.removeItem(name);
    } catch {
      // nothing to remove
    }
  },
};

/** Writes anything waiting (e.g. before "Clear all data" or an export). */
export function flushSecureStorage(): Promise<void> {
  return flush();
}

/** Removes copies of unreadable data kept by getItem (Settings → Clear all data). Never throws. */
export async function discardUnreadableCopies(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const old = keys.filter((k) => k.endsWith('.unreadable'));
    if (old.length) await AsyncStorage.multiRemove(old);
  } catch {
    // nothing kept
  }
}

/** True when the store is encrypted on this device (phone); false on the web. */
export const storageEncrypted = native;
