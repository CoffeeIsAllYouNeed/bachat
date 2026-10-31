import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { useStore } from '@/data/store';
import { requestNotificationPermission } from '@/engine/nudges';
import { GhostButton, T } from '@/ui/kit';
import { Select, SettingsGroup, SettingsNote, SwitchRow } from '@/ui/settings';
import { hourLabel } from './common';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }));
const PER_DAY = [1, 2, 3].map((n) => ({ value: n, label: String(n) }));

/** Notifications: spending nudges, quiet hours, max per day, monthly review reminder, OS permission. */
export function NotificationsPage() {
  const nudges = useStore((s) => s.settings.nudgesEnabled);
  const quietStart = useStore((s) => s.settings.quietStartHour);
  const quietEnd = useStore((s) => s.settings.quietEndHour);
  const perDay = useStore((s) => s.settings.maxNudgesPerDay);
  const reminder = useStore((s) => s.settings.reviewReminder);
  const setSettings = useStore((s) => s.setSettings);
  const [msg, setMsg] = useState<string | null>(null);

  const allow = async () => {
    setMsg(null);
    try {
      setMsg((await requestNotificationPermission()) ? 'Notifications allowed' : 'Notifications are off — you can allow them in system settings');
    } catch {
      setMsg('Could not ask for permission');
    }
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Spending nudges" footer="A nudge appears when a flexible category runs well ahead of its budget pace.">
        <SwitchRow icon="notifications-outline" label="Spending nudges" value={nudges} onChange={(v) => setSettings({ nudgesEnabled: v })} />
        <Select<number> icon="moon-outline" label="Quiet hours from" value={quietStart} options={HOURS} onChange={(v) => setSettings({ quietStartHour: v })} />
        <Select<number> icon="sunny-outline" label="Quiet hours to" value={quietEnd} options={HOURS} onChange={(v) => setSettings({ quietEndHour: v })} />
        <Select<number> icon="speedometer-outline" label="Max per day" value={perDay || 1} options={PER_DAY} onChange={(v) => setSettings({ maxNudgesPerDay: v })} />
      </SettingsGroup>

      <SettingsGroup title="Reminders">
        <SwitchRow icon="document-text-outline" label="Monthly review reminder" sub="A card on Home in the first week of each month" value={reminder} onChange={(v) => setSettings({ reviewReminder: v })} />
      </SettingsGroup>

      {Platform.OS !== 'web' ? (
        <GhostButton label="Allow notifications" icon="notifications-outline" onPress={() => void allow()} />
      ) : (
        <SettingsNote>On the web, nudges show inside the app only.</SettingsNote>
      )}
      {msg ? <T size={13} muted center>{msg}</T> : null}
    </View>
  );
}
