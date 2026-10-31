import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { buildDemoSms } from '@/data/demo';
import { todayISO, useStore } from '@/data/store';
import type { RawTxn } from '@/data/types';
import { detectBank } from '@/engine/parseUtil';
import { parseSms } from '@/engine/sms';
import { importRaw } from '@/services/ingest';

/*
 * "Let Bachat read your bank SMS" (onboarding step + Settings → Read bank SMS).
 *  - Android only: asks for READ_SMS with PermissionsAndroid.
 *  - If the build ships a native SMS reader (a custom dev build with an SMS
 *    module registered as NativeModules.Sms / SmsAndroid), the inbox is read
 *    from the phone. Otherwise (Expo Go) Bachat imports its bundled bank SMS
 *    inbox. Either way every message goes through the normal SMS parser
 *    (OTPs, offers and failed payments are skipped) and importRaw.
 *  - Messages never leave the phone.
 */

/** Only Android can read the SMS inbox. */
export const smsSupported: boolean = Platform.OS === 'android';

export type SmsPermission = 'granted' | 'denied' | 'blocked' | 'unavailable';

/** Shape of the common community SMS module (list(filterJson, onFail, onSuccess(count, json))). */
interface NativeSmsModule {
  list: (filter: string, fail: (e: unknown) => void, success: (count: number, smsList: string) => void) => void;
}

function nativeModule(): NativeSmsModule | null {
  if (!smsSupported) return null;
  try {
    const mods = NativeModules as Record<string, unknown>;
    for (const name of ['Sms', 'SmsAndroid', 'BachatSms']) {
      const m = mods[name] as Partial<NativeSmsModule> | undefined;
      if (m && typeof m.list === 'function') return m as NativeSmsModule;
    }
  } catch {
    // no native modules (web)
  }
  return null;
}

/** True when this build can read the real inbox (not Expo Go). */
export function nativeSmsReaderAvailable(): boolean {
  return nativeModule() !== null;
}

/** Shows Android's "Allow Bachat to send and view SMS messages?" dialog. */
export async function requestSmsPermission(): Promise<SmsPermission> {
  if (!smsSupported) return 'unavailable';
  try {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
      title: 'Let Bachat read your bank SMS',
      message: 'Bachat reads only bank and card messages to track your spending. OTPs are ignored and nothing leaves your phone.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    if (r === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Reads up to [max] inbox messages from the past ~100 days with the native module. */
function readNative(mod: NativeSmsModule, max = 2000): Promise<{ body: string; date?: string }[]> {
  const minDate = Date.now() - 100 * 86400000;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { body: string; date?: string }[]) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    setTimeout(() => finish([]), 20000);
    try {
      mod.list(
        JSON.stringify({ box: 'inbox', minDate, maxCount: max }),
        () => finish([]),
        (_count, json) => {
          try {
            const arr = JSON.parse(json) as { body?: unknown; date?: unknown }[];
            finish(
              (Array.isArray(arr) ? arr : [])
                .filter((m) => typeof m?.body === 'string')
                .map((m) => {
                  const ms = typeof m.date === 'number' ? m.date : Number(m.date);
                  return { body: m.body as string, date: isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined };
                }),
            );
          } catch {
            finish([]);
          }
        },
      );
    } catch {
      finish([]);
    }
  });
}

export interface SmsProgress {
  /** Bank / card messages found so far. */
  found: number;
  /** Transactions read from them so far. */
  parsed: number;
  /** The first few parsed rows (for the progress list). */
  preview: RawTxn[];
}

export interface SmsReadResult {
  found: number;
  parsed: number;
  added: number;
  toReview: number;
  /** 'device' = the phone's inbox; 'bundled' = Bachat's built-in inbox (no native reader in this build). */
  source: 'device' | 'bundled';
  /** Months covered by the messages read. */
  months: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reads the bank SMS (native inbox or the bundled one), parses them in small
 * batches (reporting progress) and imports the transactions. Never throws.
 */
export async function readBankSms(onProgress?: (p: SmsProgress) => void): Promise<SmsReadResult> {
  const mod = nativeModule();
  let messages: { body: string; date?: string }[] = [];
  let source: SmsReadResult['source'] = 'bundled';
  if (mod) {
    messages = await readNative(mod);
    source = 'device';
  } else {
    // Keep the same inbox on "Read again" (dedupe works by message text), anchored to the first read.
    const st = useStore.getState();
    const anchor = st.settings.smsAnchor ?? todayISO();
    if (!st.settings.smsAnchor) st.setSettings({ smsAnchor: anchor });
    messages = buildDemoSms(anchor).map((body) => ({ body }));
  }

  const raws: RawTxn[] = [];
  let found = 0;
  const step = 6;
  for (let i = 0; i < messages.length; i += step) {
    for (const m of messages.slice(i, i + step)) {
      let t: RawTxn | null = null;
      try {
        t = parseSms(m.body, m.date);
      } catch {
        t = null;
      }
      if (t) raws.push(t);
      if (t || detectBank(m.body)) found++;
    }
    onProgress?.({ found, parsed: raws.length, preview: raws.slice(-5).reverse() });
    // Small pause so the progress screen can show the count climbing.
    await sleep(source === 'bundled' ? 140 : 0);
  }

  let added = 0;
  let toReview = 0;
  // The built-in inbox describes the same months as the demo data: never add it on top of the demo.
  const demoLoaded = source === 'bundled' && useStore.getState().txns.some((t) => t.source === 'demo');
  if (raws.length && !demoLoaded) {
    try {
      const r = await importRaw(raws, { ai: 'suggest' });
      added = r.added;
      toReview = r.toReview;
    } catch {
      // parsing worked; the store write failed — report nothing added
    }
  }
  const dates = raws.map((r) => r.date).sort();
  const months = dates.length ? new Set(dates.map((d) => d.slice(0, 7))).size : 0;
  useStore.getState().setSettings({ smsAllowed: true, smsReadAt: new Date().toISOString() });
  return { found, parsed: raws.length, added, toReview, source, months };
}
