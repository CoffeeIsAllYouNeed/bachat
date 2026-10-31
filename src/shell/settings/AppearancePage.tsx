import React from 'react';
import { Text, View } from 'react-native';
import { useStore } from '@/data/store';
import type { AccentChoice, NumberFont, ThemeChoice } from '@/data/types';
import { money } from '@/theme/format';
import { useColors, useHeroFont } from '@/theme/theme';
import { Select, SettingsGroup, SwitchRow } from '@/ui/settings';

/** Appearance: Theme ▾ · Accent ▾ · Large numbers ▾ · Compact rows. */
export function AppearancePage() {
  const c = useColors();
  const hero = useHeroFont();
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  const numberFont = useStore((s) => s.settings.numberFont);
  const compact = useStore((s) => s.settings.compactRows);
  const setSettings = useStore((s) => s.setSettings);

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Look">
        <Select<ThemeChoice>
          icon="contrast-outline"
          label="Theme"
          value={theme}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]}
          onChange={(v) => setSettings({ theme: v })}
        />
        <Select<AccentChoice>
          icon="color-fill-outline"
          label="Accent"
          value={accent}
          options={[{ value: 'gold', label: 'Gold' }, { value: 'white', label: c.dark ? 'White' : 'Black' }]}
          onChange={(v) => setSettings({ accent: v })}
        />
        <Select<NumberFont>
          icon="text-outline"
          label="Large numbers"
          value={numberFont}
          options={[{ value: 'sans', label: 'Sans (default)' }, { value: 'serif', label: 'Serif' }]}
          onChange={(v) => setSettings({ numberFont: v })}
        />
        <SwitchRow icon="list-outline" label="Compact rows" sub="Fit more rows on screen" value={compact} onChange={(v) => setSettings({ compactRows: v })} />
      </SettingsGroup>

      <SettingsGroup title="Preview">
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 4 }}>
          <Text style={[{ color: c.text, fontSize: 34 }, hero]}>{`${money(8742)} left`}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>{`out of ${money(46310)} budgeted`}</Text>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600', marginTop: 6 }}>Transactions ›</Text>
        </View>
      </SettingsGroup>
    </View>
  );
}
