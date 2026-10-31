import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import type { CheckInAnswer, Recurring, RecurringAlert } from '@/data/types';
import { monthRange } from '@/engine/budgets';
import {
  cadenceLabel, checkInDue, daysBetween, detectRecurring, likelyUnused, recurringAlerts, yearlyCost,
} from '@/engine/recurring';
import { useAssistant } from '@/services/assistant';
import { openImport } from '@/shell/ui';
import { dayMonth, money, monthName, ordinal } from '@/theme/format';
import { useColors, useHeroFont, useWide } from '@/theme/theme';
import { SplitHeader } from '@/ui/charts';
import { MerchantLogo } from '@/ui/MerchantLogo';
import {
  Card, Collapsible, DecisionRow, EmptyState, Footer, GhostButton, Screen, SectionTitle, Segmented,
  Sheet, T, Tag,
} from '@/ui/kit';

/** Recurring: left to pay vs paid this month, alerts, this-month and future tiles, check-ins. */
export default function RecurringScreen() {
  const c = useColors();
  const wide = useWide();
  const txns = useStore((s) => s.txns);
  const dismissed = useStore((s) => s.dismissedAlerts);
  const checkIns = useStore((s) => s.checkIns);
  const shown = useStore((s) => s.checkInShown);
  const dismissAlert = useStore((s) => s.dismissAlert);
  const today = useMemo(() => todayISO(), []);
  const ym = today.slice(0, 7);
  const { from, to } = monthRange(ym);

  const recs = useMemo(() => detectRecurring(txns, today), [txns, today]);
  const unusedKeys = useMemo(
    () => new Set(recs.filter((r) => likelyUnused(r, checkIns, shown, today)).map((r) => r.key)),
    [recs, checkIns, shown, today],
  );
  const alerts = useMemo(() => {
    const list = recurringAlerts(recs, today, dismissed);
    const gone = new Set(dismissed);
    const unused: RecurringAlert[] = [];
    for (const r of recs) {
      const ci = checkIns[r.key];
      if (!ci || ci.answer !== 'not_using') continue;
      const id = `unused:${r.key}:${ci.at.slice(0, 10)}`;
      if (gone.has(id)) continue;
      unused.push({
        id, key: r.key, kind: 'unused',
        title: `You're not using ${r.name}`,
        detail: `Cancelling saves ${money(yearlyCost(r))} a year.`,
        yearlyImpact: -yearlyCost(r),
      });
    }
    return [...unused, ...list];
  }, [recs, today, dismissed, checkIns]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = recs.find((r) => r.key === openKey) ?? null;

  const thisMonth = recs.filter((r) => r.paidThisMonth || r.overdue || r.nextDate <= to);
  const future = recs.filter((r) => !thisMonth.includes(r));
  const paidSoFar = Math.round(thisMonth.reduce((a, r) => a + r.history.filter((h) => h.date >= from && h.date <= to).reduce((s, h) => s + h.amount, 0), 0));
  const leftToPay = Math.round(thisMonth.filter((r) => !r.paidThisMonth).reduce((a, r) => a + r.amount, 0));
  const cols = wide ? 5 : 3;

  if (!recs.length) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState title="No recurring payments yet"
            body="They appear after two regular charges."
            action="Add transactions" onAction={openImport} />
        </Card>
        <Footer />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={wide ? 1100 : 760}>
      <SplitHeader
        leftValue={money(leftToPay)}
        leftCaption="left to pay"
        rightValue={money(paidSoFar)}
        rightCaption={`paid so far in ${monthName(Number(ym.slice(5, 7)) - 1)}`}
        fraction={paidSoFar + leftToPay > 0 ? paidSoFar / (paidSoFar + leftToPay) : 0}
        color={c.accent}
      />

      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} onDismiss={() => dismissAlert(a.id)} onReview={() => setOpenKey(a.key)} />
      ))}

      <Collapsible title="This month" trailing={`${thisMonth.length}`}>
        <TileGrid recs={thisMonth} cols={cols} today={today} onPress={setOpenKey} unused={unusedKeys} />
      </Collapsible>
      <Collapsible title="In the future" trailing={`${future.length}`} initiallyOpen={future.length > 0 && future.length <= cols * 2}>
        {future.length ? <TileGrid recs={future} cols={cols} today={today} onPress={setOpenKey} unused={unusedKeys} future />
          : <T muted size={13}>Nothing else due after this month.</T>}
      </Collapsible>

      <Footer />

      <Sheet visible={!!open} onClose={() => setOpenKey(null)} title={open?.name ?? ''}>
        {open ? <RecurringDetail rec={open} today={today} due={checkInDue(open, checkIns, today)} answer={checkIns[open.key]?.answer ?? null} /> : null}
      </Sheet>
    </Screen>
  );
}

function AlertCard({ alert, onDismiss, onReview }: { alert: RecurringAlert; onDismiss: () => void; onReview: () => void }) {
  const c = useColors();
  const saving = alert.yearlyImpact < 0;
  const icon: keyof typeof Ionicons.glyphMap =
    alert.kind === 'missed' ? 'time-outline' : alert.kind === 'new' ? 'sparkles-outline' : alert.kind === 'unused' ? 'pause-circle-outline'
      : alert.kind === 'renewal' ? 'calendar-outline' : 'warning-outline';
  return (
    <Card style={{ backgroundColor: c.warnSoft, borderColor: c.warn }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Ionicons name={icon} size={22} color={c.warn} />
        <View style={{ flex: 1, gap: 4 }}>
          <T weight="700">{alert.title}</T>
          <T size={13} muted>{alert.detail}</T>
          {alert.yearlyImpact !== 0 ? (
            <Tag text={`${saving ? '−' : '+'}${money(Math.abs(alert.yearlyImpact))}/yr`}
              color={saving ? c.good : c.warn} background={saving ? c.goodSoft : c.card} />
          ) : null}
        </View>
      </View>
      <DecisionRow dismiss="Dismiss" approve={alert.kind === 'unused' || alert.kind === 'renewal' ? 'Review' : 'Still using it?'} onDismiss={onDismiss} onApprove={onReview} />
    </Card>
  );
}

function TileGrid({ recs, cols, today, onPress, future, unused }: {
  recs: Recurring[]; cols: number; today: string; onPress: (key: string) => void; future?: boolean; unused: Set<string>;
}) {
  const gap = 10;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {recs.map((r) => (
        <View key={r.key} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
          <Tile rec={r} today={today} onPress={() => onPress(r.key)} future={!!future} unused={unused.has(r.key)} />
        </View>
      ))}
    </View>
  );
}

function Tile({ rec, today, onPress, future, unused }: { rec: Recurring; today: string; onPress: () => void; future: boolean; unused: boolean }) {
  const c = useColors();
  const ym = today.slice(0, 7);
  const paidCharge = [...rec.history].reverse().find((h) => h.date.slice(0, 7) === ym);
  let dayText: string;
  let dayColor: string = c.textMuted;
  if (rec.paidThisMonth && paidCharge) dayText = ordinal(Number(paidCharge.date.slice(8, 10)));
  else if (rec.overdue) { dayText = 'Overdue'; dayColor = c.bad; }
  else if (future) {
    const d = daysBetween(today, rec.nextDate);
    dayText = d <= 45 ? `In ${d} days` : dayMonth(rec.nextDate);
  } else dayText = ordinal(Number(rec.nextDate.slice(8, 10)));
  const dim = rec.paidThisMonth;
  const priceUp = rec.history.length >= 2 && rec.history[rec.history.length - 2].amount > 10
    && Math.round(rec.amount) > Math.round(rec.history[rec.history.length - 2].amount);
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${rec.name}, ${money(rec.amount)}, ${rec.paidThisMonth ? 'paid' : dayText}`}
      style={({ pressed }) => [{
        backgroundColor: c.card, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
        paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 4, minHeight: 118,
      }, pressed && { opacity: 0.8 }]}>
      <View style={{ alignItems: 'center', gap: 4, opacity: dim ? 0.6 : 1 }}>
        <MerchantLogo name={rec.name} size={34} />
        <T size={13} weight="700" numberOfLines={1}>{rec.name}</T>
        <T size={13} color={priceUp ? c.warn : c.textMuted}>{money(rec.amount)}</T>
        <T size={12} color={dayColor} weight={rec.overdue ? '700' : '400'}>{dayText}</T>
      </View>
      {rec.paidThisMonth ? (
        <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: c.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="checkmark" size={14} color={c.good} />
        </View>
      ) : null}
      {unused ? (
        <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: c.warnSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
          <T size={10} weight="700" color={c.warn}>Unused?</T>
        </View>
      ) : null}
    </Pressable>
  );
}

const ANSWERS: { value: CheckInAnswer; label: string }[] = [
  { value: 'using', label: 'Using' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'not_using', label: 'Not using' },
  { value: 'cancel', label: "I'll cancel" },
];

function RecurringDetail({ rec, today, due, answer }: { rec: Recurring; today: string; due: boolean; answer: CheckInAnswer | null }) {
  const c = useColors();
  const hero = useHeroFont();
  const setCheckIn = useStore((s) => s.setCheckIn);
  const markShown = useStore((s) => s.markCheckInShown);
  const yearly = yearlyCost(rec);
  const d = daysBetween(today, rec.nextDate);
  // A due check-in that is seen but not answered counts toward "ignored twice".
  useEffect(() => {
    if (due) markShown(rec.key, today);
  }, [due, rec.key, today, markShown]);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <MerchantLogo name={rec.name} size={52} />
        <Text style={[{ color: c.text, fontSize: 26 }, hero]}>{money(rec.amount)}</Text>
        <T muted>{cadenceLabel(rec.cadence)} · {rec.overdue ? 'overdue' : d >= 0 ? `next ${dayMonth(rec.nextDate)}` : dayMonth(rec.nextDate)}</T>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
        <T muted style={{ flex: 1 }}>Costs per year</T>
        <T weight="700">{money(yearly)}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
        <T muted style={{ flex: 1 }}>Per month</T>
        <T weight="600">{money(rec.monthly)}</T>
      </View>

      <SectionTitle title={due ? 'Still using it? · check-in due' : 'Still using it?'} />
      <Segmented<CheckInAnswer | 'none'>
        options={ANSWERS}
        value={answer ?? 'none'}
        onChange={(v) => { if (v !== 'none') setCheckIn(rec.key, v); }}
      />
      {answer === 'cancel' || answer === 'not_using' ? (
        <Card style={{ backgroundColor: c.goodSoft, borderColor: c.good }}>
          <T weight="700" color={c.good}>Cancelling saves {money(yearly)} a year</T>
          <T size={13} muted>That's {money(rec.monthly)} a month back in your plan. Cancel it in the app or with your bank — Bachat never does it for you.</T>
        </Card>
      ) : answer === 'using' || answer === 'rarely' ? <T size={13} muted>Got it — we'll ask again next month.</T> : null}

      <GhostButton icon="sparkles-outline" label={`What if I cancel ${rec.name}?`}
        onPress={() => { void useAssistant.getState().run(`What if I cancel ${rec.name}?`); }} />

      <SectionTitle title="History" />
      {[...rec.history].reverse().map((h, i, arr) => {
        const older = arr[i + 1];
        return (
          <View key={h.txnId + i} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 8 }}>
            <T muted style={{ flex: 1 }}>{dayMonth(h.date)} {h.date.slice(0, 4)}</T>
            {older && Math.round(older.amount) !== Math.round(h.amount) ? <T size={12} color={h.amount > older.amount ? c.warn : c.good}>{h.amount > older.amount ? '↗' : '↘'} from {money(older.amount)}</T> : null}
            <T weight="600">{money(h.amount)}</T>
          </View>
        );
      })}
    </View>
  );
}
