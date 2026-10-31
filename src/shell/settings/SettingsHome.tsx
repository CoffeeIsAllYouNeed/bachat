import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SECTIONS } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import { geminiConfigured } from '@/services/gemini';
import { familySyncConfigured } from '@/services/familySync';
import { money, monthYear } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { PersonAvatar } from '@/ui/kit';
import { SettingsGroup, SettingsRow } from '@/ui/settings';
import type { SettingsPage } from '@/shell/ui';
import { PAGE_META, THEME_LABEL, voiceLabel } from './common';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

/** Short "v1.0" from "1.0.0". */
export function shortVersion(v: string): string {
  const parts = v.split('.');
  return `v${parts[0] ?? '1'}.${parts[1] ?? '0'}`;
}

/** Profile card: avatar (initials), name, email, "Edit profile ›". */
export function ProfileCard({ onPress, compact }: { onPress: () => void; compact?: boolean }) {
  const c = useColors();
  const name = useStore((s) => s.profileInfo.name);
  const email = useStore((s) => s.profileInfo.email);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Edit profile"
      style={({ pressed }) => [
        {
          flexDirection: 'row', alignItems: 'center', gap: 14, padding: compact ? 12 : 16, backgroundColor: c.card,
          borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
        },
        pressed && { backgroundColor: c.muted },
      ]}
    >
      <PersonAvatar name={name} size={compact ? 40 : 56} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: compact ? 15 : 18, fontWeight: '700' }} numberOfLines={1}>{name.trim() || 'Your name'}</Text>
        <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>{email.trim() || 'Add your email'}</Text>
        {!compact ? <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600', marginTop: 4 }}>Edit profile ›</Text> : null}
      </View>
      {compact ? <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>Edit ›</Text> : null}
    </Pressable>
  );
}

/**
 * Settings home: profile card + grouped rows (phone), or the laptop's left tab
 * list (same rows, the open tab highlighted). [onOpen] opens a page.
 */
export function SettingsHome({ onOpen, onClose, selected, compact }: {
  onOpen: (p: SettingsPage) => void;
  onClose: () => void;
  selected?: SettingsPage;
  compact?: boolean;
}) {
  const name = useStore((s) => s.profileInfo.name);
  const theme = useStore((s) => s.settings.theme);
  const nudges = useStore((s) => s.settings.nudgesEnabled);
  const voice = useStore((s) => s.settings.voice);
  const income = useStore((s) => s.profile.monthlyIncome);
  const customBudgets = useStore((s) => Object.keys(s.settings.budgets).length);
  const txnCount = useStore((s) => s.txns.length);
  const smsAllowed = useStore((s) => !!s.settings.smsAllowed);
  const ruleCount = useStore((s) => s.rules.filter((r) => r.active).length);
  const familyCount = useStore((s) => s.family.household?.members.length ?? 0);

  const row = (p: SettingsPage, value?: string) => (
    <SettingsRow
      key={p}
      icon={PAGE_META[p].icon}
      label={PAGE_META[p].title}
      value={compact ? undefined : value}
      selected={selected === p}
      onPress={() => onOpen(p)}
    />
  );

  const goBudgets = () => {
    onClose();
    router.navigate('/budgets' as Href);
  };

  return (
    <View style={{ gap: compact ? 16 : 22 }}>
      <ProfileCard onPress={() => onOpen('profile')} compact={compact} />

      <SettingsGroup title="General">
        {row('profile', name.trim() || 'Add name')}
        {row('appearance', THEME_LABEL[theme])}
        {row('sections', `${SECTIONS.length} sections`)}
        {row('notifications', nudges ? 'On' : 'Off')}
      </SettingsGroup>

      <SettingsGroup title="Money">
        {row('money', income > 0 ? `${money(income)}/mo income` : 'Not set')}
        <SettingsRow
          icon="pie-chart-outline"
          label="Budgets"
          value={compact ? undefined : customBudgets ? `${customBudgets} custom` : 'Suggested'}
          onPress={goBudgets}
        />
        {row('voice', voiceLabel(voice))}
        {row('family', !familySyncConfigured ? 'Sync off' : familyCount ? `${familyCount + 1} members` : undefined)}
      </SettingsGroup>

      <SettingsGroup title="Data">
        {row('import', txnCount ? `${txnCount} saved` : undefined)}
        {row('sms', Platform.OS !== 'android' ? 'Android app' : smsAllowed ? 'Allowed' : 'Off')}
        {row('rules', ruleCount ? `${ruleCount}` : undefined)}
        {row('export', 'CSV · PDF')}
        {row('review', monthYear(todayISO().slice(0, 7)))}
      </SettingsGroup>

      <SettingsGroup title="AI & privacy">
        {row('gemini', geminiConfigured ? 'Connected' : 'Not set up')}
        {row('privacy', 'On-device')}
      </SettingsGroup>

      <SettingsGroup title="About">
        {row('about', shortVersion(APP_VERSION))}
        {row('developer')}
      </SettingsGroup>
    </View>
  );
}
