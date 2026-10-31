import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View,
  type KeyboardTypeOptions, type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/data/store';
import { useColors, useWide } from '@/theme/theme';

/*
 * Standard settings building blocks (GOLD_SPEC "Settings"):
 * grouped rows (icon · label · value · chevron), dropdown selects,
 * gold switches and inline text fields. Cards are plain (card + hairline
 * border); no tinted fills anywhere.
 */

type IconName = keyof typeof Ionicons.glyphMap;

/** Row height: 52, or 44 with Appearance → Compact rows. */
function useRowHeight(): number {
  const compact = useStore((s) => s.settings.compactRows);
  return compact ? 44 : 52;
}

// ---------------------------------------------------------------- group

/** "GENERAL" label + one card of rows with hairline dividers between them. */
export function SettingsGroup({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: string }) {
  const c = useColors();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, paddingHorizontal: 4 }}>{title.toUpperCase()}</Text>
      ) : null}
      <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 16 }} /> : null}
            {r}
          </View>
        ))}
      </View>
      {footer ? <Text style={{ color: c.textFaint, fontSize: 12, paddingHorizontal: 4 }}>{footer}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- rows

/** Navigation / action row: line icon (muted) · label · value (muted) · chevron. */
export function SettingsRow({ icon, label, value, onPress, danger, chevron = true, selected, sub }: {
  icon?: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  /** Laptop tab list: the open tab (white pill, black text in dark). */
  selected?: boolean;
  sub?: string;
}) {
  const c = useColors();
  const h = useRowHeight();
  const fg = selected ? c.page : danger ? c.bad : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={selected ? { selected: true } : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', minHeight: h, paddingHorizontal: 16, gap: 12, backgroundColor: selected ? c.text : 'transparent' },
        pressed && !selected && { backgroundColor: c.muted },
      ]}
    >
      {icon ? <Ionicons name={icon} size={20} color={selected ? c.page : danger ? c.bad : c.textMuted} /> : null}
      <View style={{ flex: 1, paddingVertical: 8 }}>
        <Text style={{ color: fg, fontSize: 15, fontWeight: selected ? '700' : '500' }} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={{ color: selected ? c.page : c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {value ? (
        <Text style={{ color: selected ? c.page : c.textMuted, fontSize: 14, maxWidth: '45%' }} numberOfLines={1}>{value}</Text>
      ) : null}
      {chevron && onPress ? <Ionicons name="chevron-forward" size={18} color={selected ? c.page : c.textFaint} /> : null}
    </Pressable>
  );
}

/** Label + gold-tinted RN Switch. */
export function SwitchRow({ icon, label, sub, value, onChange }: {
  icon?: IconName; label: string; sub?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  const c = useColors();
  const h = useRowHeight();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: h, paddingHorizontal: 16, gap: 12 }}>
      {icon ? <Ionicons name={icon} size={20} color={c.textMuted} /> : null}
      <View style={{ flex: 1, paddingVertical: 8 }}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{label}</Text>
        {sub ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.accent, false: c.muted }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={c.muted}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Label + inline text input (right-aligned). */
export function FieldRow({ icon, label, value, onChange, placeholder, keyboardType, prefix, autoCapitalize, editable = true }: {
  icon?: IconName;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  prefix?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
}) {
  const c = useColors();
  const h = useRowHeight();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: h, paddingHorizontal: 16, gap: 12 }}>
      {icon ? <Ionicons name={icon} size={20} color={c.textMuted} /> : null}
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '500', minWidth: 90 }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        {prefix && value ? <Text style={{ color: c.textMuted, fontSize: 15 }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          editable={editable && !!onChange}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          accessibilityLabel={label}
          style={{ flex: 1, color: editable ? c.text : c.textMuted, fontSize: 15, textAlign: 'right', paddingVertical: 10, paddingLeft: 4, minHeight: 40 }}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- select

export interface SelectOption<V extends string | number> {
  value: V;
  label: string;
  /** Extra line in the menu (e.g. a coach-voice sample). */
  sub?: string;
}

/**
 * Dropdown select row: label · current value ▾. Tap → a small menu anchored
 * under the row (laptop / wide) or an action-sheet-like list from the bottom
 * (phone). The current option has a checkmark.
 */
export function Select<V extends string | number>({ icon, label, value, options, onChange }: {
  icon?: IconName;
  label: string;
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
}) {
  const c = useColors();
  const wide = useWide();
  const h = useRowHeight();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const anchor = useRef<ViewInstance>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const current = options.find((o) => o.value === value);

  const show = () => {
    if (!wide || !anchor.current) {
      setPos(null);
      setOpen(true);
      return;
    }
    anchor.current.measureInWindow((x, y, w, hh) => {
      setPos({ x, y, w, h: hh });
      setOpen(true);
    });
  };
  const pick = (v: V) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  const MENU_W = 260;
  const menuH = Math.min(options.length * 46 + 12, 360);
  const anchored = wide && pos != null;
  const left = anchored ? Math.max(8, Math.min(pos.x + pos.w - MENU_W - 8, win.width - MENU_W - 8)) : 0;
  const below = anchored ? pos.y + pos.h : 0;
  const top = anchored ? (below + menuH > win.height - 8 ? Math.max(8, pos.y - menuH) : below) : 0;

  const list = (
    <ScrollView style={{ maxHeight: anchored ? 360 : win.height * 0.6 }} contentContainerStyle={{ paddingVertical: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => pick(o.value)}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 16, gap: 10 },
              pressed && { backgroundColor: c.muted },
            ]}
          >
            <View style={{ flex: 1, paddingVertical: 6 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
              {o.sub ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{o.sub}</Text> : null}
            </View>
            {on ? <Ionicons name="checkmark" size={20} color={c.accent} /> : <View style={{ width: 20 }} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View ref={anchor} collapsable={false}>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityHint="Opens a list of choices"
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', minHeight: h, paddingHorizontal: 16, gap: 12 },
          pressed && { backgroundColor: c.muted },
        ]}
      >
        {icon ? <Ionicons name={icon} size={20} color={c.textMuted} /> : null}
        <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>{label}</Text>
        <Text style={{ color: c.textMuted, fontSize: 14, maxWidth: '50%' }} numberOfLines={1}>{current?.label ?? '—'}</Text>
        <Ionicons name="chevron-down" size={16} color={c.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType={anchored ? 'none' : 'fade'} onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, backgroundColor: anchored ? 'transparent' : c.scrim }} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
        {anchored ? (
          <View
            style={{
              position: 'absolute', left, top, width: MENU_W, backgroundColor: c.card, borderRadius: 12,
              borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, shadowColor: '#000', shadowOpacity: 0.4,
              shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8, overflow: 'hidden',
            }}
          >
            {list}
          </View>
        ) : (
          <View style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, gap: 8 }}>
            <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' }}>
              <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingTop: 14, paddingBottom: 4 }}>{label}</Text>
              {list}
            </View>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              style={({ pressed }) => [
                { minHeight: 52, borderRadius: 16, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------- misc

/** Small muted paragraph inside settings pages. */
export function SettingsNote({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: 4 }}>{children}</Text>;
}
