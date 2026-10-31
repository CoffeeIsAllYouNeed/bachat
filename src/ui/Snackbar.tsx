import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useStore } from '@/data/store';
import { useColors } from '@/theme/theme';

/*
 * One small global snackbar (bottom, above the assistant button) with an
 * optional Undo, plus a light haptic tap for the actions that use it.
 * Call showSnack() from anywhere; <SnackbarHost/> lives in the Shell.
 */

interface Snack {
  id: number;
  text: string;
  undo?: () => void;
}

interface SnackState {
  snack: Snack | null;
}

const useSnackbar = create<SnackState>()(() => ({ snack: null }));

let nextId = 1;

/** Light impact haptic (no-op on web or when unavailable). */
export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  } catch {
    // haptics not available on this device
  }
}

/**
 * Shows the snackbar (replaces any current one). [undo] adds an "Undo" button.
 * [haptic] (default true) plays a light tap.
 */
export function showSnack(text: string, undo?: () => void, haptic = true): void {
  if (haptic) tapHaptic();
  useSnackbar.setState({ snack: { id: nextId++, text, undo } });
}

export function hideSnack(): void {
  useSnackbar.setState({ snack: null });
}

/** Dismisses an alert / idea / card by id, with Undo in the snackbar. */
export function dismissWithUndo(id: string, text = 'Dismissed'): void {
  useStore.getState().dismissAlert(id);
  showSnack(text, () => {
    useStore.setState((s) => ({ dismissedAlerts: s.dismissedAlerts.filter((x) => x !== id) }));
  });
}

const SHOW_MS = 4500;

/** Renders the current snackbar; mount once (the Shell does). */
export function SnackbarHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const snack = useSnackbar((s) => s.snack);

  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => {
      if (useSnackbar.getState().snack?.id === snack.id) hideSnack();
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [snack]);

  if (!snack) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 88 }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[styles.bar, { backgroundColor: c.card, borderColor: c.border }]}
      >
        <Text style={{ flex: 1, color: c.text, fontSize: 14 }} numberOfLines={2}>{snack.text}</Text>
        {snack.undo ? (
          <Pressable
            onPress={() => {
              const u = snack.undo;
              hideSnack();
              tapHaptic();
              try {
                u?.();
              } catch {
                // nothing to undo
              }
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  bar: {
    width: '100%', maxWidth: 520, minHeight: 48, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 4,
  },
});
