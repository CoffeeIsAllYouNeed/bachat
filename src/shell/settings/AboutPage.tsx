import React from 'react';
import { Text, View } from 'react-native';
import { Logo } from '@/shell/Logo';
import { useColors } from '@/theme/theme';
import { SettingsGroup, SettingsNote, SettingsRow } from '@/ui/settings';
import { APP_VERSION } from './SettingsHome';

/** About Bachat: mark, version, what it is. */
export function AboutPage() {
  const c = useColors();
  return (
    <View style={{ gap: 22 }}>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <Logo size={64} />
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>Bachat</Text>
        <Text style={{ color: c.textMuted, fontSize: 13 }}>A calm money coach that lives on your phone.</Text>
      </View>
      <SettingsGroup>
        <SettingsRow icon="information-circle-outline" label="Version" value={APP_VERSION} chevron={false} />
        <SettingsRow icon="lock-closed-outline" label="Data" value="On-device" chevron={false} />
      </SettingsGroup>
      <SettingsNote>Educational information only, not financial advice. For personal investment choices, talk to a SEBI-registered investment adviser.</SettingsNote>
    </View>
  );
}
