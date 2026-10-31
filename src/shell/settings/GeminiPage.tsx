import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GEMINI_MODEL, aiAvailable, testGemini } from '@/services/gemini';
import { AGENT_LIST, useAgentRuns } from '@/services/aiAgents';
import { useAutopilot } from '@/services/autopilot';
import { useColors } from '@/theme/theme';
import { T } from '@/ui/kit';
import { SettingsGroup, SettingsNote, SettingsRow } from '@/ui/settings';

/** Gemini AI: status (Connected · model), Test connection, what is sent. */
export function GeminiPage() {
  const c = useColors();
  const runs = useAgentRuns((s) => s.runs);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const autopilot = useAutopilot((s) => s.last);

  const test = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await testGemini());
    } catch {
      setResult({ ok: false, message: 'Failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Status">
        <SettingsRow icon={aiAvailable() ? "checkmark-circle-outline" : "close-circle-outline"} label="Gemini" value={aiAvailable() ? 'Connected' : 'Not set up'} chevron={false} />
        <SettingsRow icon="hardware-chip-outline" label="Model" value={GEMINI_MODEL} chevron={false} />
        <SettingsRow icon="pulse-outline" label={busy ? 'Testing…' : 'Test connection'} onPress={() => void test()} chevron={false} />
        <SettingsRow
          icon="sparkles-outline"
          label="Last autopilot run"
          value={autopilot ? new Date(autopilot.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}
          sub={autopilot ? autopilot.lines.join(' · ') : undefined}
          chevron={false}
        />
      </SettingsGroup>
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {result ? <T size={13} color={result.ok ? c.good : c.bad}>{result.message}</T> : null}
      {!aiAvailable() ? <SettingsNote>Set EXPO_PUBLIC_AI_PROXY_URL (or a dev key) in .env and restart to turn the AI on. Everything else works without it.</SettingsNote> : null}

      <SettingsGroup title="AI agents">
        {AGENT_LIST.map((a) => {
          const r = runs[a.id];
          return (
            <SettingsRow
              key={a.id}
              icon="sparkles-outline"
              label={a.name}
              sub={a.job}
              value={r ? (r.ok ? 'Ran ' : 'Failed ') + new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined}
              chevron={false}
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="What's sent">
        <SettingsRow icon="pricetag-outline" label="Unknown merchant names" sub="With the short bank description, to suggest a category. No amounts or balances." chevron={false} />
        <SettingsRow icon="chatbubble-outline" label="Your questions" sub="Plus monthly totals (income, fixed costs, surplus) when the device can't answer on its own." chevron={false} />
        <SettingsRow icon="mic-outline" label="Voice clips" sub="Only while you hold Speak, to turn speech into text." chevron={false} />
        <SettingsRow icon="document-outline" label="One PDF statement" sub="Only when you upload a PDF the device can't read itself." chevron={false} />
      </SettingsGroup>
    </View>
  );
}
