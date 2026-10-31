import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from '@/data/store';
import { money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { SettingsNote } from '@/ui/settings';
import { longDate } from './common';

/** Version history of "Your money" (newest first). */
export function HistoryPage() {
  const c = useColors();
  const history = useStore((s) => s.profile.history);
  if (!history.length) return <SettingsNote>No versions yet. Save "Your money" to start the history.</SettingsNote>;
  const rows = [...history].reverse();
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingHorizontal: 16 }}>
      {rows.map((h, i) => (
        <View key={h.at + i} style={{ paddingVertical: 12, gap: 2, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{longDate(h.at)}{i === 0 ? ' · current' : ''}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>
            {`Income ${money(h.snapshot.monthlyIncome)}${h.snapshot.irregularIncome ? ' (varies)' : ''} · Rent ${money(h.snapshot.rent)} · EMIs ${money(h.snapshot.emis)} · Other ${money(h.snapshot.otherFixed)} · Fund ${money(h.snapshot.emergencyFund)} / ${h.snapshot.emergencyMonths} mo`}
          </Text>
        </View>
      ))}
    </View>
  );
}
