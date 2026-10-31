import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useStore } from '@/data/store';
import { useAssistant } from '@/services/assistant';
import { testGemini } from '@/services/gemini';
import { accuracy } from '@/services/ingest';
import { discardUnreadableCopies } from '@/services/secureStorage';
import { loadDemoInApp, useShellUI } from '@/shell/ui';
import { pct } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { T } from '@/ui/kit';
import { SettingsGroup, SettingsRow } from '@/ui/settings';

/** Developer: load the 3-month demo, accuracy before/after, test Gemini, clear all data (confirm). */
export function DeveloperPage() {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const rules = useStore((s) => s.rules);
  const before = useStore((s) => s.settings.evalBefore);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const now = useMemo(() => {
    try {
      return accuracy();
    } catch {
      return null;
    }
    // accuracy() reads the store; recompute when rows or rules change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, rules]);

  const run = async (key: string, fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch {
      setMsg('That did not work — nothing was changed');
    } finally {
      setBusy(null);
    }
  };

  const clearAll = () => {
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setConfirm(false);
    useAssistant.getState().dismiss();
    // Close Settings first: resetAll() swaps the app for Onboarding, and a still-"open"
    // Settings screen would pop up again once onboarding finishes.
    useShellUI.getState().close();
    useStore.getState().resetAll();
    void discardUnreadableCopies();
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Demo">
        <SettingsRow icon="albums-outline" label={busy === 'demo' ? 'Loading demo…' : 'Load 3-month demo'} chevron={false}
          onPress={() => void run('demo', loadDemoInApp)} />
      </SettingsGroup>

      <SettingsGroup title="Categorisation accuracy">
        {before != null ? (
          <View style={{ flexDirection: 'row', paddingVertical: 14 }}>
            <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <T size={12} muted>Before learning</T>
              <T size={20} weight="700">{pct(before)}</T>
            </View>
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
            <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <T size={12} muted>Now</T>
              <T size={20} weight="700" color={now != null && now > before ? c.good : c.text}>{now != null ? pct(now) : '—'}</T>
            </View>
          </View>
        ) : (
          <View style={{ padding: 16 }}>
            <T size={13} muted>Load the demo to see accuracy before and after your corrections.</T>
          </View>
        )}
      </SettingsGroup>

      <SettingsGroup title="AI">
        <SettingsRow icon="pulse-outline" label={busy === 'gemini' ? 'Testing…' : 'Test Gemini'} chevron={false}
          onPress={() => void run('gemini', async () => {
            const r = await testGemini();
            return (r.ok ? '✓ ' : '✕ ') + r.message;
          })} />
      </SettingsGroup>

      <SettingsGroup title="Danger zone" footer="Removes every transaction, rule, goal, your profile and settings from this device.">
        <SettingsRow icon="trash-outline" label={confirm ? 'Tap again to erase everything' : 'Clear all data'} danger chevron={false} onPress={clearAll} />
      </SettingsGroup>

      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {msg ? <Text style={{ color: c.text, fontSize: 14, textAlign: 'center' }}>{msg}</Text> : null}
    </View>
  );
}
