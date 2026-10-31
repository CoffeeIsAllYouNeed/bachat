import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { orderedSections, SECTIONS } from '@/data/categories';
import { useStore } from '@/data/store';
import type { SectionId } from '@/data/types';
import { useColors } from '@/theme/theme';
import { GhostButton, IconButton } from '@/ui/kit';
import { SettingsGroup, SettingsNote } from '@/ui/settings';

/** Sections & layout: reorder list (handle · icon · label · ↑ ↓) and "Reset order". */
export function SectionsPage() {
  const c = useColors();
  const order = useStore((s) => s.settings.sectionOrder);
  const setSettings = useStore((s) => s.setSettings);
  const list = useMemo(() => orderedSections(order), [order]);

  const move = (i: number, dir: -1 | 1) => {
    const ids: SectionId[] = list.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSettings({ sectionOrder: ids });
  };

  return (
    <View style={{ gap: 16 }}>
      <SettingsNote>Your order is used in the top tab strip and the laptop sidebar.</SettingsNote>
      <SettingsGroup title="Order">
        {list.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, minHeight: 52 }}>
            <Ionicons name="reorder-three-outline" size={20} color={c.textFaint} />
            <Ionicons name={s.icon as keyof typeof Ionicons.glyphMap} size={18} color={c.textMuted} style={{ marginLeft: 10 }} />
            <Text style={{ flex: 1, marginLeft: 10, color: c.text, fontSize: 15 }}>{s.label}</Text>
            <View style={{ opacity: i === 0 ? 0.3 : 1 }} pointerEvents={i === 0 ? 'none' : 'auto'}>
              <IconButton name="arrow-up" label={`Move ${s.label} up`} onPress={() => move(i, -1)} size={18} />
            </View>
            <View style={{ opacity: i === list.length - 1 ? 0.3 : 1 }} pointerEvents={i === list.length - 1 ? 'none' : 'auto'}>
              <IconButton name="arrow-down" label={`Move ${s.label} down`} onPress={() => move(i, 1)} size={18} />
            </View>
          </View>
        ))}
      </SettingsGroup>
      <GhostButton label="Reset order" icon="refresh" onPress={() => setSettings({ sectionOrder: SECTIONS.map((s) => s.id) })} />
    </View>
  );
}
