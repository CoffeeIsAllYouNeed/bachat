/**
 * Family sync: invite codes, end-to-end encryption and the Supabase transport.
 *
 * - The household secret (32 random bytes) never leaves the phones. The invite
 *   code carries it; the household id and the join token are derived from it
 *   (SHA-512), so the server only ever sees the id, a hash of the token and
 *   ciphertext.
 * - Each member's monthly snapshot is sealed with tweetnacl secretbox
 *   (XSalsa20-Poly1305) under a key derived from the secret.
 * - Supabase (free tier): anonymous sign-in, table rows guarded by RLS
 *   (supabase/schema.sql). Without EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY the
 *   family still works on this phone ("Sync off").
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import { EMPTY_FAMILY, useStore } from '@/data/store';
import type { FamilyMember, FamilySnapshot, Household } from '@/data/types';
import { buildMySnapshot, cleanSnapshot } from '@/services/family';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when the Supabase env vars are set (otherwise the family lives on this phone only). */
export const familySyncConfigured: boolean = !!(SUPABASE_URL.trim() && SUPABASE_ANON_KEY.trim());

/** Largest sealed snapshot we send or accept (base64 characters). */
const MAX_CIPHERTEXT = 1_500_000;

// ------------------------------------------------------------------ bytes

function randomBytes(n: number): Uint8Array {
  try {
    const b = Crypto.getRandomBytes(n);
    if (b && b.length === n) return b;
  } catch {
    /* fall through */
  }
  return nacl.randomBytes(n);
}

function utf8Encode(s: string): Uint8Array {
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
  let s = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i++];
    let c: number;
    if (x < 0x80) c = x;
    else if (x < 0xe0) c = ((x & 31) << 6) | (b[i++] & 63);
    else if (x < 0xf0) c = ((x & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else c = ((x & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    if (c >= 0x10000) {
      c -= 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else s += String.fromCharCode(c);
  }
  return s;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function hex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < b.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < b.length ? B64[n & 63] : '=';
  }
  return s;
}

function fromBase64(s: string): Uint8Array | null {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(b: Uint8Array): string {
  let s = '';
  let bits = 0;
  let acc = 0;
  for (const x of b) {
    acc = (acc << 8) | x;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      s += B32[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) s += B32[(acc << (5 - bits)) & 31];
  return s;
}

function fromBase32(s: string): Uint8Array | null {
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
    acc &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------ keys & codes

const SECRET_BYTES = 32;
const CHECK_BYTES = 3;

/** Household id (32 hex) and join token (64 hex) derived from the secret. */
export function deriveIds(secret: Uint8Array): { householdId: string; joinToken: string } {
  const h = nacl.hash(concat(secret, utf8Encode('bachat-family-v1')));
  return { householdId: hex(h.subarray(0, 16)), joinToken: hex(h.subarray(16, 48)) };
}

function boxKey(secret: Uint8Array): Uint8Array {
  return nacl.hash(concat(secret, utf8Encode('bachat-family-box-v1'))).subarray(0, nacl.secretbox.keyLength);
}

function secretBytes(h: Household): Uint8Array | null {
  const b = fromBase64(h.secret);
  return b && b.length === SECRET_BYTES ? b : null;
}

/**
 * Invite code for a household: "BACHAT-XXXX-XXXX-…" — the 32-byte secret plus a
 * 3-byte check, base32 in groups of 4 (14 groups). Anyone with the code can join,
 * so it is shared only by the user (share sheet / copy).
 */
export function inviteCodeFor(h: Household): string | null {
  const s = secretBytes(h);
  if (!s) return null;
  const check = nacl.hash(s).subarray(0, CHECK_BYTES);
  const body = toBase32(concat(s, check));
  return `BACHAT-${(body.match(/.{1,4}/g) ?? []).join('-')}`;
}

/** The secret inside an invite code, or null when the code is mistyped. */
export function parseInviteCode(code: string): Uint8Array | null {
  let s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('BACHAT')) s = s.slice(6);
  // Common look-alikes (base32 has no 0, 1 or 8).
  s = s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  const bytes = fromBase32(s);
  if (!bytes || bytes.length !== SECRET_BYTES + CHECK_BYTES) return null;
  const secret = bytes.subarray(0, SECRET_BYTES);
  const want = nacl.hash(secret).subarray(0, CHECK_BYTES);
  for (let i = 0; i < CHECK_BYTES; i++) if (want[i] !== bytes[SECRET_BYTES + i]) return null;
  return Uint8Array.from(secret);
}

/** Seals a snapshot for the household (secretbox, fresh 24-byte nonce). */
export function sealSnapshot(snap: FamilySnapshot, secret: Uint8Array): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(utf8Encode(JSON.stringify(snap)), nonce, boxKey(secret));
  return { ciphertext: toBase64(box), nonce: toBase64(nonce) };
}

/** Opens and validates a sealed snapshot; null when it was tampered with or is not ours. */
export function openSnapshot(ciphertext: string, nonce: string, secret: Uint8Array): FamilySnapshot | null {
  if (!ciphertext || ciphertext.length > MAX_CIPHERTEXT) return null;
  const box = fromBase64(ciphertext);
  const n = fromBase64(nonce);
  if (!box || !n || n.length !== nacl.secretbox.nonceLength) return null;
  const plain = nacl.secretbox.open(box, n, boxKey(secret));
  if (!plain) return null;
  try {
    return cleanSnapshot(JSON.parse(utf8Decode(plain)));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ supabase

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!familySyncConfigured) return null;
  if (client) return client;
  try {
    client = createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
      auth: {
        storage: AsyncStorage,
        storageKey: 'bachat-family-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    client = null;
  }
  return client;
}

/** Signs in anonymously once (session kept in AsyncStorage). */
async function ensureSignedIn(c: SupabaseClient): Promise<void> {
  const { data } = await c.auth.getSession();
  if (data.session?.user) return;
  const res = await c.auth.signInAnonymously();
  if (res.error || !res.data.user) throw new Error('Sign-in failed');
}

/** Registers this phone as a member (creates the household on first use). */
async function registerMember(c: SupabaseClient, h: Household): Promise<void> {
  const secret = secretBytes(h);
  if (!secret) throw new Error('Bad household secret');
  const { joinToken } = deriveIds(secret);
  const { error } = await c.rpc('join_household', { p_household: h.id, p_token: joinToken, p_member: h.meId });
  if (error) throw new Error('Could not join');
}

async function push(c: SupabaseClient, h: Household): Promise<void> {
  const secret = secretBytes(h);
  if (!secret) throw new Error('Bad household secret');
  const snap = buildMySnapshot(useStore.getState(), undefined, h.meId);
  const sealed = sealSnapshot(snap, secret);
  if (sealed.ciphertext.length > MAX_CIPHERTEXT) throw new Error('Snapshot too large');
  const { error } = await c
    .from('snapshots')
    .upsert(
      { household_id: h.id, member_id: h.meId, ciphertext: sealed.ciphertext, nonce: sealed.nonce, updated_at: new Date().toISOString() },
      { onConflict: 'household_id,member_id' },
    );
  if (error) throw new Error('Upload failed');
}

interface SnapshotRow {
  member_id: string;
  ciphertext: string;
  nonce: string;
  updated_at: string;
}

async function pull(c: SupabaseClient, h: Household): Promise<number> {
  const secret = secretBytes(h);
  if (!secret) throw new Error('Bad household secret');
  const { data, error } = await c.from('snapshots').select('member_id, ciphertext, nonce, updated_at').eq('household_id', h.id);
  if (error) throw new Error('Download failed');
  const rows = (Array.isArray(data) ? data : []) as unknown as SnapshotRow[];
  const st = useStore.getState();
  const cur = st.family.household;
  if (!cur || cur.id !== h.id) return 0; // left or switched while downloading
  const known = new Map(cur.members.map((m) => [m.id, m]));
  const snapshots: Record<string, FamilySnapshot> = {};
  const members: FamilyMember[] = [];
  for (const r of rows) {
    if (!r || typeof r.member_id !== 'string' || r.member_id === cur.meId) continue;
    const snap = openSnapshot(String(r.ciphertext ?? ''), String(r.nonce ?? ''), secret);
    if (!snap || snap.memberId !== r.member_id) continue;
    snapshots[r.member_id] = snap;
    const prev = known.get(r.member_id);
    members.push({ id: r.member_id, name: snap.name, relation: prev?.relation ?? 'Family', share: snap.share, color: prev?.color, lastSync: String(r.updated_at ?? snap.updatedAt) });
  }
  st.setFamily({ household: { ...cur, members }, snapshots, lastSyncAt: new Date().toISOString(), lastSyncError: undefined });
  return members.length;
}

// ------------------------------------------------------------------ public actions

let running: Promise<string> | null = null;

/**
 * Push this user's snapshot, then pull the family's. Call on open of the Family
 * screen and after a refresh. Returns a short status line ('' when there is no
 * household or sync is off). Never throws.
 */
export function syncFamily(): Promise<string> {
  if (running) return running;
  running = (async () => {
    const h = useStore.getState().family.household;
    const c = getClient();
    if (!h || !c) return '';
    try {
      await ensureSignedIn(c);
      try {
        await push(c, h);
      } catch {
        // Member row missing (removed, or first sync failed): register again, then retry once.
        await registerMember(c, h);
        await push(c, h);
      }
      const n = await pull(c, h);
      return `Family synced · ${n + 1} member${n ? 's' : ''}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      useStore.getState().setFamily({ lastSyncError: msg });
      return 'Family sync failed — saved on this phone';
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

function newHousehold(secret: Uint8Array, name: string): Household {
  return {
    id: deriveIds(secret).householdId,
    name,
    secret: toBase64Url(secret),
    createdAt: new Date().toISOString(),
    meId: hex(randomBytes(8)),
    members: [],
  };
}

/** Creates the household on first Invite (or returns the existing one) and gives its invite code. */
export async function createHousehold(name?: string): Promise<{ code: string; message: string }> {
  const st = useStore.getState();
  let h = st.family.household;
  if (!h) {
    const first = st.profileInfo.name.trim().split(/\s+/)[0] ?? '';
    h = newHousehold(randomBytes(SECRET_BYTES), (name ?? '').trim() || `${first || 'My'} family`);
    st.setFamily({ household: h, snapshots: {}, lastSyncError: undefined });
  }
  const code = inviteCodeFor(h) ?? '';
  const c = getClient();
  if (!c) return { code, message: 'Sync off — saved on this phone' };
  try {
    await ensureSignedIn(c);
    await registerMember(c, h);
    await push(c, h);
    return { code, message: '' };
  } catch (e) {
    useStore.getState().setFamily({ lastSyncError: e instanceof Error ? e.message : 'Sync failed' });
    return { code, message: 'Code ready · sync will retry' };
  }
}

/** Joins a household from an invite code. */
export async function joinHousehold(code: string): Promise<{ ok: boolean; message: string }> {
  const secret = parseInviteCode(code);
  if (!secret) return { ok: false, message: 'That code is not valid' };
  const st = useStore.getState();
  const { householdId } = deriveIds(secret);
  const cur = st.family.household;
  if (cur && cur.id !== householdId) return { ok: false, message: 'Leave your current family first' };
  if (!cur) st.setFamily({ household: newHousehold(secret, 'Family'), snapshots: {}, lastSyncError: undefined });
  const h = useStore.getState().family.household;
  const c = getClient();
  if (!h) return { ok: false, message: 'Could not join' };
  if (!c) return { ok: true, message: 'Joined · sync off' };
  try {
    await ensureSignedIn(c);
    await registerMember(c, h);
    await push(c, h);
    const n = await pull(c, h);
    return { ok: true, message: n ? `Joined · ${n + 1} members` : 'Joined' };
  } catch (e) {
    useStore.getState().setFamily({ lastSyncError: e instanceof Error ? e.message : 'Sync failed' });
    return { ok: true, message: 'Joined · sync will retry' };
  }
}

/** The current household's invite code (null without a household). */
export function currentInviteCode(): string | null {
  const h = useStore.getState().family.household;
  return h ? inviteCodeFor(h) : null;
}

/** Leaves the household: removes this phone's member row (and its snapshot) and forgets the secret. */
export async function leaveHousehold(): Promise<void> {
  const st = useStore.getState();
  const h = st.family.household;
  const c = getClient();
  if (h && c) {
    try {
      await ensureSignedIn(c);
      await c.from('members').delete().eq('household_id', h.id).eq('member_id', h.meId);
    } catch {
      /* best effort: the local copy is forgotten either way */
    }
  }
  useStore.getState().setFamily({ ...EMPTY_FAMILY, share: st.family.share, demoHidden: true });
}

/**
 * Removes a member: their member row (and snapshot) on the server and the local
 * copy. They still hold the code, so they could join again until a new family is made.
 */
export async function removeMember(memberId: string): Promise<void> {
  const st = useStore.getState();
  const h = st.family.household;
  if (!h) return;
  const c = getClient();
  if (c) {
    try {
      await ensureSignedIn(c);
      await c.from('members').delete().eq('household_id', h.id).eq('member_id', memberId);
    } catch {
      /* best effort */
    }
  }
  const snapshots = { ...useStore.getState().family.snapshots };
  delete snapshots[memberId];
  useStore.getState().setFamily({ household: { ...h, members: h.members.filter((m) => m.id !== memberId) }, snapshots });
}
