import { router, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import { exportReportPdf } from '@/engine/report';
import { netChange, recapText, requestRecap, reviewFacts, type ReviewFacts, type ReviewKind, type ReviewLine } from '@/services/reviewCoach';
import { openImport } from '@/shell/ui';
import { money } from '@/theme/format';
import { useColors, useHeroFont } from '@/theme/theme';
import { Card, ChangeChip, Columns, EmptyState, Footer, IconButton, Screen, SectionTitle, Segmented, T } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { showSnack } from '@/ui/Snackbar';

/*
 * Review: Day · Week · Month · Year. Spent / earned / net vs the period before,
 * top categories, top merchants, notable changes and a short recap.
 */

const KINDS: { value: ReviewKind; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

function safeFacts(fn: () => ReviewFacts): ReviewFacts | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function openSearch(q: string) {
  router.navigate({ pathname: '/transactions', params: { q } } as Href);
}

export default function ReviewScreen() {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const [kind, setKind] = useState<ReviewKind>('month');
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [, setRecapTick] = useState(0);
  const today = todayISO();

  const facts = useMemo(() => safeFacts(() => reviewFacts(txns, kind, offset, today)), [txns, kind, offset, today]);
  const earliest = useMemo(() => txns.reduce((m, t) => (t.date < m ? t.date : m), today), [txns, today]);

  // AI recap: asked once per period (cached); re-render when it lands.
  useEffect(() => {
    if (!facts) return;
    let alive = true;
    void requestRecap(facts).then((r) => {
      if (alive && r) setRecapTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [facts]);

  if (!txns.length) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState title="Nothing to review yet" body="Add transactions to see your review." action="Add transactions" onAction={openImport} />
        </Card>
        <Footer />
      </Screen>
    );
  }

  const pick = (k: ReviewKind) => {
    setKind(k);
    setOffset(0);
  };
  const canBack = !!facts && facts.from > earliest;
  const empty = !facts || (facts.spent <= 0 && facts.earned <= 0);
  const recap = facts ? recapText(facts) : '';

  const exportPdf = async () => {
    if (!facts || exporting) return;
    setExporting(true);
    try {
      showSnack(await exportReportPdf(facts.from.slice(0, 7)), undefined, false);
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <View style={{ gap: 8 }}>
      <Segmented options={KINDS} value={kind} onChange={pick} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ opacity: canBack ? 1 : 0.3 }}>
          <IconButton name="chevron-back" label="Previous" onPress={() => canBack && setOffset(offset - 1)} />
        </View>
        <T weight="700" center style={{ flex: 1 }}>{facts?.label ?? ''}</T>
        <View style={{ opacity: offset < 0 ? 1 : 0.3 }}>
          <IconButton name="chevron-forward" label="Next" onPress={() => offset < 0 && setOffset(offset + 1)} />
        </View>
      </View>
    </View>
  );

  if (empty || !facts) {
    return (
      <Screen maxWidth={760}>
        {header}
        <Card>
          {offset < 0 ? (
            <EmptyState title="Nothing here" body="No spending or income in this period." action="Back to now" onAction={() => setOffset(0)} />
          ) : (
            <EmptyState title="Nothing here yet" body="No spending or income in this period." action="Add transactions" onAction={openImport} />
          )}
        </Card>
        <Footer />
      </Screen>
    );
  }

  const summary = (
    <Card>
      <View style={{ flexDirection: 'row' }}>
        <Stat label="Spent" value={facts.spent} change={changeOf(facts.spent, facts.prev.spent)} upIsGood={false} />
        <Stat label="Earned" value={facts.earned} change={changeOf(facts.earned, facts.prev.earned)} />
        <Stat label="Net" value={facts.net} change={netChange(facts)} bad={facts.net < 0} />
      </View>
      <T size={12} faint center>vs {facts.prevLabel}</T>
    </Card>
  );

  const categories = facts.topCategories.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Top categories" />
      <Card style={{ gap: 0 }}>
        {facts.topCategories.map((l) => (
          <Row key={l.name} line={l} lead={<Text style={{ fontSize: 18, width: 32, textAlign: 'center' }}>{l.emoji}</Text>} onPress={() => openSearch(l.name)} />
        ))}
      </Card>
    </View>
  ) : null;

  const merchants = facts.topMerchants.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Top merchants" />
      <Card style={{ gap: 0 }}>
        {facts.topMerchants.map((l) => (
          <Row key={l.name} line={l} lead={<MerchantLogo name={l.name} size={32} />}
            sub={l.count === 1 ? '1 payment' : `${l.count ?? 0} payments`} onPress={() => openSearch(l.name)} />
        ))}
      </Card>
    </View>
  ) : null;

  const changes = facts.changes.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Notable changes" />
      <Card style={{ gap: 0 }}>
        {facts.changes.map((l) => (
          <View key={l.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
            <Text style={{ fontSize: 18, width: 32, textAlign: 'center' }}>{l.emoji}</Text>
            <T style={{ flex: 1 }} numberOfLines={1}>{l.name}</T>
            <T weight="600" color={l.delta > 0 ? c.bad : c.good}>{l.delta > 0 ? '+' : '−'}{money(Math.abs(l.delta))}</T>
            <ChangeChip change={l.change} upIsGood={false} />
          </View>
        ))}
      </Card>
    </View>
  ) : null;

  const exportLink = kind === 'month' ? (
    <Text onPress={() => void exportPdf()} accessibilityRole="button" suppressHighlighting
      style={{ color: c.accent, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 10 }}>
      {exporting ? 'Exporting…' : 'Export PDF'}
    </Text>
  ) : null;

  return (
    <Screen>
      {header}
      {recap ? <T size={14} muted>{recap}</T> : null}
      <Columns
        left={<>{summary}{categories}</>}
        right={<>{merchants}{changes}</>}
      />
      {exportLink}
      <Footer />
    </Screen>
  );
}

function changeOf(a: number, b: number): number | null {
  return b > 0 ? (a - b) / b : null;
}

function Stat({ label, value, change, upIsGood = true, bad }: { label: string; value: number; change: number | null; upIsGood?: boolean; bad?: boolean }) {
  const c = useColors();
  const hero = useHeroFont();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <T size={12} muted>{label}</T>
      <Text style={[{ color: bad ? c.bad : c.text, fontSize: 18 }, hero]} numberOfLines={1} adjustsFontSizeToFit>{money(value)}</Text>
      <ChangeChip change={change} upIsGood={upIsGood} />
    </View>
  );
}

function Row({ line, lead, sub, onPress }: { line: ReviewLine; lead: React.ReactNode; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }, pressed && { opacity: 0.7 }]}>
      {lead}
      <View style={{ flex: 1 }}>
        <T numberOfLines={1}>{line.name}</T>
        {sub ? <T size={12} faint>{sub}</T> : null}
      </View>
      <T weight="600">{money(line.amount)}</T>
    </Pressable>
  );
}
