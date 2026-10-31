import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { applyReplan, keepAsWhatIf, replan, type ReplanResult } from '@/services/planCoach';
import { useColors } from '@/theme/theme';
import { Card, GhostButton, PrimaryButton, T } from '@/ui/kit';

/*
 * Adaptive re-planning (AI B): one "What if…" line inside Goals and
 * Emergency fund. A life change ("my income dropped 20%", "rent goes up
 * ₹5,000", "lost my job for 3 months") → rules first, Gemini fallback →
 * before → after for the emergency fund and every goal → Apply (saves to the
 * versioned profile) or Just exploring (kept as a saved what-if).
 */

export function ReplanBox() {
  const c = useColors();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplanResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const ask = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote(null);
    setResult(null);
    const r = await replan(q);
    setBusy(false);
    if ('error' in r) setNote(r.error);
    else setResult(r);
  };

  const done = (msg: string) => {
    setResult(null);
    setText('');
    setNote(msg);
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.muted + '88', borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingLeft: 14, minHeight: 48 }}>
        <TextInput
          value={text}
          onChangeText={(t) => { setText(t); if (note) setNote(null); }}
          onSubmitEditing={() => { void ask(); }}
          placeholder="What if…"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="What if, for example my income dropped 20%"
          returnKeyType="send"
          style={{ flex: 1, color: c.text, fontSize: 16, minHeight: 46 }}
        />
        {busy ? (
          <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textMuted} />
          </View>
        ) : (
          <Pressable onPress={() => { void ask(); }} accessibilityRole="button" accessibilityLabel="Re-plan" disabled={!text.trim()}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: text.trim() ? 1 : 0.4 }}>
            <Ionicons name="arrow-up-circle" size={26} color={c.accent} />
          </Pressable>
        )}
      </View>

      {note ? <T size={13} muted>{note}</T> : null}

      {result ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {result.chips.map((chip, i) => (
              <View key={i + chip} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: c.accentSoft }}>
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>{chip}</Text>
              </View>
            ))}
          </View>
          <View>
            {result.rows.map((r) => {
              const col = r.better === null ? c.text : r.better ? c.good : c.bad;
              return (
                <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 34, gap: 8 }}>
                  <T size={14} muted style={{ flex: 1 }} numberOfLines={1}>{r.label}</T>
                  <T size={14} faint numberOfLines={1}>{r.before}</T>
                  <Ionicons name="arrow-forward" size={14} color={c.textFaint} />
                  <T size={14} weight="700" color={col} numberOfLines={1}>{r.after}</T>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <GhostButton label="Just exploring" onPress={() => { keepAsWhatIf(result); done('Saved as a what-if.'); }} style={{ flex: 1 }} />
            {result.lasting ? (
              <PrimaryButton label="Apply" icon="checkmark" onPress={() => { done(applyReplan(result.adjustments) ? 'Plan updated.' : 'Couldn’t apply that.'); }} style={{ flex: 1 }} />
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}
