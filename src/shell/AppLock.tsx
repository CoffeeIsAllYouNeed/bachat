import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, StyleSheet, View } from 'react-native';
import { useStore } from '@/data/store';
import { Logo } from '@/shell/Logo';
import { useColors } from '@/theme/theme';
import { PrimaryButton, T } from '@/ui/kit';

/*
 * Optional app lock (Settings → Privacy → App lock, default off; phone only).
 *  - On launch and after 60 s in the background, a full-screen cover asks for
 *    the phone's own lock: fingerprint / face, or the device PIN as fallback
 *    (expo-local-authentication). Nothing of the app shows until it passes.
 *  - While the app is inactive / in the background, a plain cover hides the
 *    content from the app switcher snapshot (iOS takes the snapshot after
 *    "inactive"; Android may still show it — it needs FLAG_SECURE, which needs
 *    a native module not in Expo Go).
 *  - If the phone has no screen lock at all, the lock can't be enforced and
 *    the app opens (the Privacy page only lets you turn it on with one).
 */

const RELOCK_AFTER_MS = 60_000;

type LocalAuth = typeof import('expo-local-authentication');

async function localAuth(): Promise<LocalAuth | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-local-authentication');
  } catch {
    return null;
  }
}

/** True when the phone has a screen lock (PIN / pattern / biometrics) the app can use. */
export async function appLockAvailable(): Promise<boolean> {
  const LA = await localAuth();
  if (!LA) return false;
  try {
    return (await LA.getEnrolledLevelAsync()) !== LA.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** Asks for the phone's lock. True when it passed (or when the phone has no lock to ask for). */
export async function confirmIdentity(promptMessage = 'Unlock Bachat'): Promise<boolean> {
  const LA = await localAuth();
  if (!LA) return true;
  try {
    if ((await LA.getEnrolledLevelAsync()) === LA.SecurityLevel.NONE) return true;
    const r = await LA.authenticateAsync({ promptMessage, cancelLabel: 'Cancel', disableDeviceFallback: false });
    return r.success;
  } catch {
    return false;
  }
}

/** Full-screen lock / privacy cover. Mount once at the root, after the store is hydrated. */
export function AppLock() {
  const c = useColors();
  const enabled = useStore((s) => !!s.settings.appLock) && Platform.OS !== 'web';
  const [locked, setLocked] = useState(enabled);
  const [cover, setCover] = useState(false);
  const busy = useRef(false);
  const awayAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await confirmIdentity()) setLocked(false);
    } finally {
      busy.current = false;
    }
  }, []);

  // Turned off in Settings → nothing to unlock.
  useEffect(() => {
    if (!enabled) setLocked(false);
  }, [enabled]);

  // Ask as soon as the lock shows.
  useEffect(() => {
    if (enabled && locked) void unlock();
  }, [enabled, locked, unlock]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (s) => {
      // The system prompt itself sends the app to inactive/background: ignore that.
      if (busy.current) return;
      if (s === 'active') {
        setCover(false);
        const away = awayAt.current;
        awayAt.current = null;
        if (away != null && Date.now() - away >= RELOCK_AFTER_MS) setLocked(true);
      } else {
        if (awayAt.current == null) awayAt.current = Date.now();
        setCover(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  if (!enabled || (!locked && !cover)) return null;
  const body = (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: c.page, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, zIndex: 1000, elevation: 1000 }]}
      accessibilityViewIsModal
    >
      <Logo size={64} />
      {locked ? (
        <>
          <T weight="700" size={17}>Bachat is locked</T>
          <PrimaryButton label="Unlock" icon="lock-open-outline" onPress={() => void unlock()} style={{ alignSelf: 'stretch', maxWidth: 320, width: '100%' }} />
        </>
      ) : null}
    </View>
  );
  // Locked: a Modal is its own native window, so it also sits above any open sheet or the
  // full-screen Settings modal (a plain View would stay underneath them). Back does nothing.
  if (locked) {
    return (
      <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => undefined}>
        {body}
      </Modal>
    );
  }
  return body;
}
