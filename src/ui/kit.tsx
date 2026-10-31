import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/data/store';
import { refreshAll } from '@/shell/actions';
import { chipTint, selectedPill, useColors, useHeroFont, useWide } from '@/theme/theme';
import { showSnack } from '@/ui/Snackbar';

/*
 * Bachat design kit: card-based money layout in the Bachat palette.
 * One idea per card. Every screen uses only these pieces.
 */

// ---------------------------------------------------------------- page

/**
 * Scrollable page body: centred, max 1100 wide, 16/24 px gutters,
 * bottom padding so the floating assistant button never hides content.
 */
export function Screen({ children, maxWidth = 1100, refresh = true }: { children: React.ReactNode; maxWidth?: number; refresh?: boolean }) {
  const wide = useWide();
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  // Pull to refresh on phones only (the laptop keeps the header icon).
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    let msg = '';
    try {
      msg = await refreshAll();
    } finally {
      setRefreshing(false);
    }
    if (msg) showSnack(msg, undefined, false);
  };
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ alignItems: 'center', paddingBottom: 120, paddingTop: 8 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        refresh && !wide && Platform.OS !== 'web'
          ? <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.card} />
          : undefined
      }
    >
      <View style={{ width: '100%', maxWidth, paddingHorizontal: wide ? 24 : 16, gap: 16 }}>{children}</View>
    </ScrollView>
  );
}

/** Two columns on wide screens, stacked on phones. */
export function Columns({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const wide = useWide();
  if (!wide) return <View style={{ gap: 16 }}>{left}{right}</View>;
  return (
    <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
      <View style={{ flex: 1.15, gap: 16 }}>{left}</View>
      <View style={{ flex: 1, gap: 16 }}>{right}</View>
    </View>
  );
}

// ---------------------------------------------------------------- text

export function T({
  children, size = 15, weight = '400', color, muted, faint, style, numberOfLines, center,
}: {
  children: React.ReactNode;
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  muted?: boolean;
  faint?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
}) {
  const c = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { fontSize: size, fontWeight: weight, color: color ?? (faint ? c.textFaint : muted ? c.textMuted : c.text) },
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** "SAVE MORE ............ See all (3) ›" */
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <Text style={{ flex: 1, color: c.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" style={{ paddingVertical: 8, paddingLeft: 8 }}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Big number + caption ("₹8,742 left / out of ₹46,310 budgeted"). Bold sans, tabular digits (useHeroFont). */
export function Hero({ value, caption, color }: { value: string; caption?: string; color?: string }) {
  const c = useColors();
  const hero = useHeroFont();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[{ color: color ?? c.text, fontSize: 34 }, hero]}>{value}</Text>
      {caption ? <Text style={{ color: c.textMuted, fontSize: 13, textAlign: 'center' }}>{caption}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- cards

export function Card({
  children, onPress, style, padded = true,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const c = useColors();
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: padded ? 16 : 0,
    gap: 10,
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]} accessibilityRole="button">
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

// ---------------------------------------------------------------- controls

export function PrimaryButton({ label, onPress, disabled, style, icon }: {
  label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        { minHeight: 46, borderRadius: 999, backgroundColor: c.accent, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.85 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={c.onAccent} /> : null}
      <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, onPress, style, icon, danger }: {
  label: string; onPress: () => void; style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap; danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { minHeight: 46, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.muted + '55', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={danger ? c.bad : c.text} /> : null}
      <Text style={{ color: danger ? c.bad : c.text, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** Dismiss / Approve pair: the coach never acts without approval. */
export function DecisionRow({ approve = 'Approve', dismiss = 'Dismiss', onApprove, onDismiss }: {
  approve?: string; dismiss?: string; onApprove: () => void; onDismiss: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <GhostButton label={dismiss} onPress={onDismiss} style={{ flex: 1 }} />
      <PrimaryButton label={approve} onPress={onApprove} style={{ flex: 1 }} />
    </View>
  );
}

export function IconButton({ name, onPress, label, color, size = 22 }: {
  name: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string; color?: string; size?: number;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, pressed && { backgroundColor: c.muted + '66' }]}>
      <Ionicons name={name} size={size} color={color ?? c.textMuted} />
    </Pressable>
  );
}

/** Small coloured pill ("+₹1,800/yr", "Overdue"). */
export function Tag({ text, color, background }: { text: string; color: string; background: string }) {
  return (
    <View style={{ backgroundColor: background, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** "↗ 42.0%" — [upIsGood] false for spend and debts. */
export function ChangeChip({ change, upIsGood = true }: { change: number | null | undefined; upIsGood?: boolean }) {
  const c = useColors();
  if (change == null || !isFinite(change)) return null;
  const flat = Math.abs(change) < 0.0005;
  const good = flat ? null : (change > 0) === upIsGood;
  const fg = good === null ? c.textMuted : good ? c.good : c.bad;
  const bg = good === null ? c.muted : good ? c.goodSoft : c.badSoft;
  const arrow = flat ? '=' : change > 0 ? '↗' : '↘';
  const p = Math.abs(change * 100);
  return <Tag text={`${arrow} ${p >= 999.5 ? '999+' : p.toFixed(1)}%`} color={fg} background={bg} />;
}

/** Transaction category pill: "🍔 FOOD". */
export function CategoryChip({ emoji, label }: { emoji: string; label: string }) {
  const tint = chipTint(label);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: tint + '2E', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 140 }}>
      <Text style={{ fontSize: 11 }}>{emoji}</Text>
      <Text numberOfLines={1} style={{ color: tint, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** Thin progress bar. */
export function ThinBar({ fraction, color, height = 6 }: { fraction: number; color: string; height?: number }) {
  const c = useColors();
  const f = Math.max(0, Math.min(1, isFinite(fraction) ? fraction : 0));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.muted, overflow: 'hidden', flex: 1 }}>
      <View style={{ width: `${f * 100}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

/** Bar colour for spent-vs-budget: red over, orange ≥ 80%, green otherwise (calm = fixed bills). */
export function useBudgetColor() {
  const c = useColors();
  return (fraction: number, over: boolean, calm = false) => (over ? c.bad : !calm && fraction >= 0.8 ? c.warn : c.good);
}

/** "• Assets" with a coloured dot. */
export function DotLabel({ text, color }: { text: string; color: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: c.textMuted, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

/** Range picker: 1W · 1M · 3M · YTD · 1Y (or 4W · 3M · 1Y · MTD · YTD). */
export function RangeChips<R extends string>({ options, value, onChange }: { options: readonly R[]; value: R; onChange: (r: R) => void }) {
  const c = useColors();
  const sel = selectedPill(c);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', backgroundColor: on ? sel.bg : 'transparent' }}>
            <Text style={{ color: on ? sel.fg : c.textMuted, fontSize: 12, fontWeight: on ? '700' : '500' }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pill segmented control (Dark · Light · System). */
export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  const c = useColors();
  const sel = selectedPill(c);
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.muted, borderRadius: 999, padding: 4, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? sel.bg : 'transparent' }}>
            <Text style={{ color: on ? sel.fg : c.textMuted, fontWeight: on ? '700' : '500', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "▾ CREDIT CARDS   -₹14,700" — folds open/closed. */
export function Collapsible({ title, trailing, initiallyOpen = true, children }: {
  title: string; trailing?: string; initiallyOpen?: boolean; children: React.ReactNode;
}) {
  const c = useColors();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={c.textMuted} />
        <Text style={{ flex: 1, marginLeft: 6, color: c.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>
        {trailing ? <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{trailing}</Text> : null}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/**
 * Horizontal card rail: snaps item by item, small page dots when it overflows,
 * and an optional "See all" tile at the end. Scrolls inside the vertical page
 * on Android (nestedScrollEnabled) and on the web (overflow-x).
 */
export function Rail({ itemWidth, gap = 10, children, seeAll = 'See all', onSeeAll }: {
  itemWidth: number; gap?: number; children: React.ReactNode; seeAll?: string; onSeeAll?: () => void;
}) {
  const c = useColors();
  const items = React.Children.toArray(children);
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [page, setPage] = useState(0);
  const overflow = viewW > 0 && contentW > viewW + 2;
  const pages = overflow ? Math.min(8, Math.ceil(contentW / viewW)) : 1;
  const tileW = Math.min(itemWidth, 88);

  return (
    <View style={{ gap: 8 }}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemWidth + gap}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={32}
        onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setContentW(w)}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const max = Math.max(1, contentW - viewW);
          const p = x >= max - 2 ? pages - 1 : Math.min(pages - 1, Math.round((x / max) * (pages - 1)));
          if (p !== page) setPage(p);
        }}
        style={Platform.OS === 'web' ? ({ overflowX: 'auto' } as unknown as ViewStyle) : undefined}
        contentContainerStyle={{ gap, paddingRight: 8 }}
      >
        {items.map((child, i) => (
          <View key={i} style={{ width: itemWidth }}>{child}</View>
        ))}
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={seeAll}
            style={({ pressed }) => [{ width: tileW, alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-forward" size={18} color={c.accent} />
            </View>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>{seeAll}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {pages > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: pages }, (_, i) => (
            <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: i === page ? c.textMuted : c.muted }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 6 }}>
      <Text style={{ color: c.accent, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: c.textMuted, fontSize: 13, textAlign: 'center' }}>{body}</Text>
      {action && onAction ? <PrimaryButton label={action} onPress={onAction} style={{ marginTop: 10 }} /> : null}
    </View>
  );
}

export function Footer() {
  return <T size={11} faint center style={{ paddingVertical: 12 }}>Educational information only, not financial advice.</T>;
}

/** A row: left content, right content, min 48 tall, optional press. */
export function ListRow({ left, right, onPress, sub }: { left: React.ReactNode; right?: React.ReactNode; onPress?: () => void; sub?: React.ReactNode }) {
  const compact = useStore((s) => s.settings.compactRows);
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: compact ? 40 : 48, gap: 10 }}>
      <View style={{ flex: 1 }}>{left}{sub}</View>
      {right}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{inner}</Pressable> : inner;
}

/**
 * Letter avatar for merchants/accounts. Default: tinted circle. [plain]: white
 * letter on the fill colour (#1F1F1F) — the merchant-logo fallback. [square]:
 * rounded square (radius 25% of size) instead of a circle.
 */
export function Avatar({ label, size = 36, color, plain, square }: {
  label: string; size?: number; color?: string; plain?: boolean; square?: boolean;
}) {
  const c = useColors();
  const tint = color ?? chipTint(label);
  const letter = (label.trim()[0] ?? '?').toUpperCase();
  return (
    <View
      style={{
        width: size, height: size, borderRadius: square ? Math.round(size * 0.25) : size / 2,
        backgroundColor: plain ? c.muted : tint + '33', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: plain ? c.text : tint, fontWeight: '700', fontSize: size * 0.42 }}>{letter}</Text>
    </View>
  );
}

/** Initials of a person's name ("Vrushal More" → "VM", "vrushal" → "V"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Round profile avatar: initials (white on the fill colour), or a person icon when there is no name. */
export function PersonAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const c = useColors();
  const ini = initials(name);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
      {ini ? (
        <Text allowFontScaling={false} style={{ color: c.text, fontWeight: '700', fontSize: Math.round(size * (ini.length > 1 ? 0.38 : 0.44)) }}>{ini}</Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.5)} color={c.textMuted} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- sheets

/**
 * Bottom sheet (phone) / centred dialog (wide). Tap outside to close.
 * Uses React Native's Modal, so it works in Expo Go and on the web.
 */
export function Sheet({ visible, onClose, title, children, scroll = true }: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; scroll?: boolean;
}) {
  const c = useColors();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, maxHeight: '88%' },
          wide
            ? { position: 'absolute', alignSelf: 'center', top: '8%', width: 560, borderRadius: 24 }
            : { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + 12 },
        ]}
      >
        {!wide ? <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.muted, marginTop: 10 }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 }}>
          <Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '700' }}>{title ?? ''}</Text>
          <IconButton name="close" label="Close" onPress={onClose} />
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        ) : (
          <View style={{ padding: 20, paddingTop: 8, gap: 14 }}>{children}</View>
        )}
      </View>
    </Modal>
  );
}
