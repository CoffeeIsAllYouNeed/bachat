import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from '@/data/store';
import type { CoachVoice } from '@/data/types';
import { useColors } from '@/theme/theme';
import { Select, SettingsGroup, SettingsNote } from '@/ui/settings';
import { VOICES } from './common';

/** Coach voice: ▾ Supportive / Straight talk / Calm / Playful, with a sample line. */
export function VoicePage() {
  const c = useColors();
  const voice = useStore((s) => s.settings.voice);
  const setSettings = useStore((s) => s.setSettings);
  const current = VOICES.find((v) => v.id === voice) ?? VOICES[0];
  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Voice" footer="Used for nudges and the assistant's replies. The numbers never change, only the tone.">
        <Select<CoachVoice>
          icon="chatbubble-ellipses-outline"
          label="Coach voice"
          value={voice}
          options={VOICES.map((v) => ({ value: v.id, label: v.label, sub: v.sample }))}
          onChange={(v) => setSettings({ voice: v })}
        />
      </SettingsGroup>
      <View style={{ gap: 8 }}>
        <SettingsNote>Sample</SettingsNote>
        <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 16 }}>
          <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>“{current.sample}”</Text>
        </View>
      </View>
    </View>
  );
}
