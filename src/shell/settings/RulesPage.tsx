import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CATEGORIES, category } from '@/data/categories';
import { useStore } from '@/data/store';
import type { CategoryId, Rule } from '@/data/types';
import { displayName } from '@/engine/merchant';
import { changeRuleCategory, deleteRule } from '@/engine/rules';
import { money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { Sheet } from '@/ui/kit';
import { showSnack } from '@/ui/Snackbar';
import { SettingsGroup, SettingsNote, SettingsRow } from '@/ui/settings';
import { longDate } from './common';

function scopeText(r: Rule): string {
  if (r.scope === 'amount' && r.minAmount != null && r.maxAmount != null) return `${money(r.minAmount)}–${money(r.maxAmount)}`;
  if (r.scope === 'account' && r.account) return `On ${r.account}`;
  return 'Always';
}

/** Settings → Data → Learned rules: rules from "Always" corrections, and the AI's example count. */
export function RulesPage() {
  const c = useColors();
  const rules = useStore((s) => s.rules);
  const examples = useStore((s) => s.corrections.length);
  const clear = useStore((s) => s.clearCorrections);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const list = useMemo(
    () => rules.filter((r) => r.active).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rules],
  );
  const open = list.find((r) => r.id === openId) ?? null;

  const pick = (cat: CategoryId) => {
    if (open) changeRuleCategory(open.id, cat);
    setOpenId(null);
  };
  const remove = () => {
    if (open) {
      const before = useStore.getState().rules;
      deleteRule(open.id);
      showSnack('Rule deleted', () => useStore.getState().setRules(before));
    }
    setOpenId(null);
  };
  const onClear = () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setConfirm(false);
    clear();
  };

  return (
    <View style={{ gap: 22 }}>
      {list.length ? (
        <SettingsGroup title="Rules">
          {list.map((r) => {
            const cat = category(r.category);
            return (
              <SettingsRow
                key={r.id}
                label={displayName(r.merchantKey) || r.merchantKey}
                sub={`${scopeText(r)} · ${longDate(r.createdAt)}`}
                value={`${cat.emoji} ${cat.label}`}
                onPress={() => setOpenId(r.id)}
              />
            );
          })}
        </SettingsGroup>
      ) : (
        <SettingsNote>No rules yet. Choose “Always” when you fix a category.</SettingsNote>
      )}

      <SettingsGroup>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, gap: 12 }}>
          <Ionicons name="sparkles-outline" size={20} color={c.textMuted} />
          <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
            Examples the AI learns from: {examples}
          </Text>
          {examples > 0 ? (
            <Pressable onPress={onClear} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: confirm ? c.bad : c.accent, fontSize: 14, fontWeight: '600' }}>{confirm ? 'Tap to confirm' : 'Clear'}</Text>
            </Pressable>
          ) : null}
        </View>
      </SettingsGroup>

      <Sheet visible={!!open} onClose={() => setOpenId(null)} title={open ? displayName(open.merchantKey) || open.merchantKey : ''}>
        {open ? (
          <View style={{ gap: 14 }}>
            <SettingsGroup>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.id}
                  onPress={() => pick(cat.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: cat.id === open.category }}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 16, gap: 10 }, pressed && { backgroundColor: c.muted }]}
                >
                  <Text style={{ fontSize: 16 }}>{cat.emoji}</Text>
                  <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: cat.id === open.category ? '700' : '500' }}>{cat.label}</Text>
                  {cat.id === open.category ? <Ionicons name="checkmark" size={20} color={c.accent} /> : null}
                </Pressable>
              ))}
            </SettingsGroup>
            <SettingsGroup>
              <SettingsRow icon="trash-outline" label="Delete rule" danger chevron={false} onPress={remove} />
            </SettingsGroup>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
