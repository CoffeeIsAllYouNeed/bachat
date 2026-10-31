import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { orderedSections, SECTION_BY_ID, SECTIONS, type SectionInfo } from '@/data/categories';
import { useStore } from '@/data/store';
import type { AccountSummary } from '@/data/types';
import { accounts } from '@/engine/networth';
import { useAssistant } from '@/services/assistant';
import { AnswerPanel } from '@/shell/AnswerPanel';
import { Assistant } from '@/shell/Assistant';
import { ImportSheet } from '@/shell/ImportSheet';
import { Logo } from '@/shell/Logo';
import { ReportSheet } from '@/shell/ReportSheet';
import { SettingsScreen } from '@/shell/settings/SettingsScreen';
import { refreshAll } from '@/shell/actions';
import { openReport, openSettings, useShellUI } from '@/shell/ui';
import { money, setAmountsHidden } from '@/theme/format';
import { selectedPill, useColors, useWide } from '@/theme/theme';
import { Collapsible, IconButton, PersonAvatar } from '@/ui/kit';
import { SnackbarHost, tapHaptic } from '@/ui/Snackbar';
import { greeting } from '@/shell/greeting';

/** 32px initials avatar in the header; tap → Settings → Profile. */
function HeaderAvatar() {
  const c = useColors();
  const name = useStore((s) => s.profileInfo.name);
  return (
    <Pressable
      onPress={() => openSettings('profile')}
      accessibilityRole="button"
      accessibilityLabel="Profile"
      hitSlop={6}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, pressed && { backgroundColor: c.muted }]}
    >
      <PersonAvatar name={name} size={32} />
    </Pressable>
  );
}

/** Section that owns a pathname ("/" → home, "/budgets/x" → budgets). */
export function sectionForPath(pathname: string): SectionInfo {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return SECTIONS[0];
  return SECTIONS.find((s) => s.href !== '/' && (p === s.href || p.startsWith(s.href + '/'))) ?? SECTIONS[0];
}

/**
 * App shell: phone header + scrolling tab strip, or laptop sidebar + top bar.
 * Pins the assistant's answer above the page and hosts the floating assistant
 * and the shell sheets (Settings, Monthly review, Add transactions).
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const order = useStore((s) => s.settings.sectionOrder);
  const sections = useMemo(() => orderedSections(order), [order]);
  const current = sectionForPath(pathname);

  const sheet = useShellUI((s) => s.sheet);
  const closeSheet = useShellUI((s) => s.close);
  const userName = useStore((s) => s.profileInfo.name);
  // Recomputed on each render (navigation re-renders the shell), so the part of day stays current.
  const hello = greeting(userName);

  // "Hide amounts": money()/moneyShort() read a module flag; set it before the children render,
  // and remount the page (key) so every amount on it is drawn again.
  const hideAmounts = useStore((s) => !!s.settings.hideAmounts);
  setAmountsHidden(hideAmounts);
  const toggleHide = () => {
    tapHaptic();
    useStore.getState().setSettings({ hideAmounts: !hideAmounts });
  };

  // The header shows only icons (refresh · eye · avatar · gear); the refresh result is announced to screen readers.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const msg = await refreshAll();
    setRefreshing(false);
    try {
      AccessibilityInfo.announceForAccessibility(msg);
    } catch {
      // not available on this platform
    }
  };

  // Follow the assistant: each new answer opens its section (or sheet).
  const nonce = useAssistant((s) => s.nonce);
  const seen = useRef(nonce);
  useEffect(() => {
    if (nonce === seen.current) return;
    seen.current = nonce;
    const a = useAssistant.getState().answer;
    if (!a) return;
    if (a.section === 'report') return openReport();
    if (a.section === 'settings') return openSettings();
    const target = SECTION_BY_ID.get(a.section);
    if (!target) return;
    if (a.section === 'transactions' && a.query) {
      router.navigate({ pathname: '/transactions', params: { q: a.query } } as Href);
    } else if (sectionForPath(pathname).id !== target.id) {
      router.navigate(target.href as Href);
    }
  }, [nonce, pathname]);

  const go = (s: SectionInfo) => {
    if (s.id !== current.id) router.navigate(s.href as Href);
  };

  const main = (
    <View style={{ flex: 1 }}>
      <PinnedAnswer />
      <View key={hideAmounts ? 'amounts-hidden' : 'amounts-shown'} style={{ flex: 1 }}>{children}</View>
      <Assistant />
      <SnackbarHost />
    </View>
  );

  const actions = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {refreshing ? (
        <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.textMuted} />
        </View>
      ) : (
        <IconButton name="refresh" label="Refresh" onPress={onRefresh} />
      )}
      <IconButton name={hideAmounts ? 'eye-off-outline' : 'eye-outline'} label={hideAmounts ? 'Show amounts' : 'Hide amounts'} onPress={toggleHide} />
      <HeaderAvatar />
      <IconButton name="settings-outline" label="Settings" onPress={() => openSettings()} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Sidebar sections={sections} current={current.id} onGo={go} topInset={insets.top} />
          <View style={{ flex: 1, paddingTop: insets.top }}>
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', paddingLeft: 24, paddingRight: 12, minHeight: 60,
                borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }} numberOfLines={1}>{current.label}</Text>
                {current.id === 'home' && hello ? <Text style={{ color: c.textMuted, fontSize: 14 }} numberOfLines={1}>{hello}</Text> : null}
              </View>
              {actions}
            </View>
            {main}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, minHeight: 56 }}>
            <Logo size={32} />
            <Text style={{ flex: 1, marginLeft: 10, color: c.text, fontSize: 22, fontWeight: '800' }}>Bachat</Text>
            {actions}
          </View>
          <TabStrip sections={sections} current={current.id} onGo={go} />
          {main}
        </View>
      )}

      <SettingsScreen visible={sheet === 'settings'} onClose={closeSheet} />
      <ReportSheet visible={sheet === 'report'} onClose={closeSheet} />
      <ImportSheet visible={sheet === 'import'} onClose={closeSheet} />
    </View>
  );
}

/** The assistant's latest answer, pinned above the page (max 760, centred, scrolls if tall). */
function PinnedAnswer() {
  const wide = useWide();
  const has = useAssistant((s) => s.answer !== null);
  if (!has) return null;
  return (
    <View style={{ maxHeight: wide ? 520 : 380, width: '100%' }}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: 8 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 760, paddingHorizontal: wide ? 24 : 16 }}>
          <AnswerPanel />
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- phone tab strip

function TabStrip({ sections, current, onGo }: { sections: SectionInfo[]; current: string; onGo: (s: SectionInfo) => void }) {
  const c = useColors();
  const sel = selectedPill(c);
  // RN 0.88 strict types: ScrollView is a function component; its ref is ScrollViewInstance.
  const ref = useRef<ScrollViewInstance>(null);
  const xs = useRef<Record<string, { x: number; w: number }>>({});
  const [viewW, setViewW] = useState(0);

  // Keep the selected tab in view.
  useEffect(() => {
    const pos = xs.current[current];
    if (!pos || !viewW) return;
    ref.current?.scrollTo({ x: Math.max(0, pos.x - (viewW - pos.w) / 2), animated: true });
  }, [current, viewW]);

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4, alignItems: 'center' }}
    >
      {sections.map((s) => {
        const on = s.id === current;
        return (
          <Pressable
            key={s.id}
            onPress={() => onGo(s)}
            onLayout={(e) => {
              xs.current[s.id] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
              if (on && viewW) {
                const { x, width } = e.nativeEvent.layout;
                ref.current?.scrollTo({ x: Math.max(0, x - (viewW - width) / 2), animated: false });
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              minHeight: 44, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center',
              backgroundColor: on ? sel.bg : 'transparent',
            }}
          >
            <Text style={{ color: on ? sel.fg : c.textMuted, fontSize: 15, fontWeight: on ? '700' : '500' }}>{s.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- laptop sidebar

function Sidebar({ sections, current, onGo, topInset }: {
  sections: SectionInfo[]; current: string; onGo: (s: SectionInfo) => void; topInset: number;
}) {
  const c = useColors();
  const sel = selectedPill(c);
  const txns = useStore((s) => s.txns);
  const accts = useMemo<AccountSummary[]>(() => {
    try {
      return accounts(txns);
    } catch {
      return [];
    }
  }, [txns]);
  const debts = accts.filter((a) => a.kind === 'card' || a.kind === 'loan');
  const banks = accts.filter((a) => a.kind === 'bank' || a.kind === 'wallet');
  const debtTotal = debts.reduce((s, a) => s + a.balance, 0);
  const bankTotal = banks.reduce((s, a) => s + a.balance, 0);

  return (
    <View style={{ width: 248, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border, paddingTop: topInset, backgroundColor: c.page }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, minHeight: 60 }}>
        <Logo size={32} />
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>Bachat</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 2 }}>
        {sections.map((s) => {
          const on = s.id === current;
          return (
            <Pressable
              key={s.id}
              onPress={() => onGo(s)}
              accessibilityRole="link"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? sel.bg : 'transparent' },
                pressed && !on && { backgroundColor: c.muted },
              ]}
            >
              <Ionicons name={s.icon as keyof typeof Ionicons.glyphMap} size={19} color={on ? sel.fg : c.textMuted} />
              <Text style={{ color: on ? sel.fg : c.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{s.label}</Text>
            </Pressable>
          );
        })}

        {debts.length || banks.length ? (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 12 }} />
        ) : null}
        {debts.length ? (
          <Collapsible title="Credit cards & loans" trailing={money(-debtTotal)}>
            {debts.map((a) => <AccountLine key={a.key} a={a} color={c.warn} negative />)}
          </Collapsible>
        ) : null}
        {banks.length ? (
          <Collapsible title="Bank accounts" trailing={money(bankTotal)}>
            {banks.map((a) => <AccountLine key={a.key} a={a} color={c.good} />)}
          </Collapsible>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="lock-closed-outline" size={14} color={c.textFaint} />
        <Text style={{ color: c.textFaint, fontSize: 12 }}>On-device · your data stays here</Text>
      </View>
    </View>
  );
}

function AccountLine({ a, color, negative }: { a: AccountSummary; color: string; negative?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.navigate('/networth' as Href)}
      accessibilityRole="link"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingLeft: 8 }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ flex: 1, color: c.text, fontSize: 13 }} numberOfLines={1}>{a.name}</Text>
      <Text style={{ color: c.textMuted, fontSize: 13 }}>{money(negative ? -a.balance : a.balance)}</Text>
    </Pressable>
  );
}
