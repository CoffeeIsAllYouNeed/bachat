import { router, type Href } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { category } from '@/data/categories';
import type { CoachVoice, RecurringAlert, Txn } from '@/data/types';
import { drifts, nudgeText } from '@/engine/nudges';
import { learnCorrection, undoLast } from '@/engine/rules';
import { useAssistant } from '@/services/assistant';
import { openReport } from '@/shell/ui';
import { dayHeader, money, monthYear, parseISO } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { Card, CategoryChip, GhostButton, PrimaryButton, T, Tag } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { dismissWithUndo, showSnack } from '@/ui/Snackbar';

/*
 * Pieces of the Home screen (kept here so src/app/index.tsx stays small and
 * src/app only holds routes).
 */

export type Drift = ReturnType<typeof drifts>[number];

/** One review item (Home now shows only the monthly report reminder; the rest live in Transactions / Recurring). */
export type ReviewItem =
  | { kind: 'drift'; id: string; drift: Drift }
  | { kind: 'alert'; id: string; alert: RecurringAlert }
  | { kind: 'txns'; id: string; day: string; rows: Txn[] }
  | { kind: 'report'; id: string; ym: string };

/** Ranks review items: meaningful drift → price/trial alerts by yearly impact → review rows by day → monthly report (days 1–7). */
export function buildReviewItems(args: {
  txns: Txn[]; drifts: Drift[]; alerts: RecurringAlert[]; today: string; dismissed: string[];
  /** Settings → Notifications → Monthly review reminder (default on). */
  reviewReminder?: boolean;
}): ReviewItem[] {
  const { txns, today, dismissed } = args;
  const month = today.slice(0, 7);
  const gone = new Set(dismissed);
  const out: ReviewItem[] = [];

  args.drifts
    .filter((d) => d.meaningful)
    .sort((a, b) => b.ratio - a.ratio)
    .forEach((d) => {
      const id = `drift-${d.category}-${month}`;
      if (!gone.has(id)) out.push({ kind: 'drift', id, drift: d });
    });

  args.alerts
    .filter((a) => (a.kind === 'price' || a.kind === 'trial') && !gone.has(a.id))
    .sort((a, b) => Math.abs(b.yearlyImpact) - Math.abs(a.yearlyImpact))
    .forEach((a) => out.push({ kind: 'alert', id: a.id, alert: a }));

  const byDay = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!t.needsReview || t.excluded) continue;
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }
  [...byDay.keys()].sort((a, b) => b.localeCompare(a)).forEach((day) => {
    out.push({ kind: 'txns', id: `review-${day}`, day, rows: byDay.get(day) ?? [] });
  });

  const dom = Number(today.slice(8, 10));
  if (args.reviewReminder !== false && dom >= 1 && dom <= 7 && txns.length) {
    const d = parseISO(today);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const id = `report-${ym}`;
    if (!gone.has(id)) out.push({ kind: 'report', id, ym });
  }
  return out;
}

/** "TODAY" → "Today", "THU, OCT 29" → "Thu, Oct 29". */
export function niceDay(iso: string): string {
  return dayHeader(iso).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/** Opens Transactions filtered by a merchant name. */
export function openMerchant(merchant: string): void {
  router.navigate({ pathname: '/transactions', params: { q: merchant } } as Href);
}

/** Transaction row: merchant, category chip, amount (income/refund green with +), review dot. */
export function TxnRow({ t, onPress, maybe }: { t: Txn; onPress?: () => void; maybe?: boolean }) {
  const c = useColors();
  const cat = category(t.category);
  const plus = t.type === 'income' || t.type === 'refund';
  const sug = maybe && t.suggested && t.suggested !== t.category ? category(t.suggested) : null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }, pressed && { opacity: 0.7 }]}>
      <MerchantLogo name={t.merchant} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.excluded ? c.textMuted : c.text, fontSize: 15 }} numberOfLines={1}>{t.merchant}</Text>
        {sug ? <Text style={{ color: c.accent, fontSize: 12 }} numberOfLines={1}>Maybe {sug.label}?</Text> : null}
      </View>
      <CategoryChip emoji={cat.emoji} label={cat.label} />
      <Text style={{ minWidth: 76, textAlign: 'right', color: plus ? c.good : c.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {plus ? '+' : ''}{money(t.amount)}
      </Text>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.needsReview ? c.accent : 'transparent' }} />
    </Pressable>
  );
}

/** Renders one review item as a card. */
export function ReviewCard({ item, voice }: { item: ReviewItem; voice: CoachVoice }) {
  const c = useColors();
  const dismiss = (id: string) => dismissWithUndo(id);

  if (item.kind === 'drift') {
    const cat = category(item.drift.category);
    let text: string;
    try {
      text = nudgeText(item.drift, voice);
    } catch {
      text = `${cat.label}: ${money(item.drift.spent)} spent, ${money(item.drift.expectedByToday)} expected by today.`;
    }
    return (
      <Card>
        <T weight="700">{cat.emoji} {cat.label} is ahead of pace</T>
        <T size={14} muted>{text}</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="Dismiss" onPress={() => dismiss(item.id)} style={{ flex: 1 }} />
          <PrimaryButton label="What if?" icon="sparkles-outline" style={{ flex: 1 }}
            onPress={() => useAssistant.getState().run(`What if I cut ${cat.label.toLowerCase()} by 20%?`)} />
        </View>
      </Card>
    );
  }

  if (item.kind === 'alert') {
    const a = item.alert;
    const up = a.yearlyImpact > 0;
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MerchantLogo name={a.key || a.title} size={40} />
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="700" numberOfLines={2}>{a.title}</T>
            <T size={13} muted numberOfLines={2}>{a.detail}</T>
            {a.yearlyImpact ? (
              <Tag text={`${up ? '+' : '−'}${money(Math.abs(a.yearlyImpact))}/yr`} color={up ? c.bad : c.good} background={up ? c.badSoft : c.goodSoft} />
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="Dismiss" onPress={() => dismiss(a.id)} style={{ flex: 1 }} />
          <PrimaryButton label="Review" onPress={() => router.navigate('/recurring' as Href)} style={{ flex: 1 }} />
        </View>
      </Card>
    );
  }

  if (item.kind === 'report') {
    return (
      <Card>
        <T weight="700">Your {monthYear(item.ym)} review is ready</T>
        <T size={14} muted>Income vs spend, top changes, subscriptions to check and your goals — on one page.</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="Dismiss" onPress={() => dismiss(item.id)} style={{ flex: 1 }} />
          <PrimaryButton label="Open review" onPress={openReport} style={{ flex: 1 }} />
        </View>
      </Card>
    );
  }

  const shown = item.rows.slice(0, 4);
  const more = item.rows.length - shown.length;
  const markReviewed = () => {
    let n = 0;
    for (const t of shown) {
      try {
        learnCorrection(t.id, t.category, 'once');
        n++;
      } catch {
        // keep going: one bad row should not block the rest
      }
    }
    if (n) {
      showSnack('Marked as reviewed', () => {
        for (let i = 0; i < n; i++) undoLast();
      });
    }
  };
  return (
    <Card>
      <T center muted size={14} weight="600">{niceDay(item.day)}</T>
      <View>
        {shown.map((t) => <TxnRow key={t.id} t={t} maybe onPress={() => openMerchant(t.merchant)} />)}
      </View>
      {more > 0 ? <T size={12} faint center>+{more} more on this day</T> : null}
      <Pressable onPress={markReviewed} accessibilityRole="button"
        style={({ pressed }) => [{ minHeight: 48, borderRadius: 14, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
        <Text style={{ color: c.accent, fontWeight: '700', letterSpacing: 1, fontSize: 14 }}>MARK AS REVIEWED</Text>
      </Pressable>
    </Card>
  );
}
