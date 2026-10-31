import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { category, SPEND_CATEGORIES } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { CategoryId, Txn } from '@/data/types';
import { addMonthsYm, daysInMonth, monthRange } from '@/engine/budgets';
import { isCountedSpend, netSpend, spendByCategory } from '@/engine/clean';
import { displayName, merchantKey } from '@/engine/merchant';
import { useAssistant } from '@/services/assistant';
import { money, moneyShort, monthName, pct } from '@/theme/format';
import { seriesColor, useColors, useWide } from '@/theme/theme';
import { BarChart, Donut, LineChart, SplitHeader } from '@/ui/charts';
import {
  Card, ChangeChip, Columns, EmptyState, Footer, GhostButton, Hero, IconButton, Screen, SectionTitle, Sheet, T,
} from '@/ui/kit';

/** Fixed monthly commitments (the rest is flexible), matching the planner's split. */
const FIXED: CategoryId[] = ['rent', 'emi', 'bills', 'subscriptions'];

function dayISO(ym: string, day: number): string {
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** Cumulative net spend per day of a month, up to `lastDay`. */
function cumulative(txns: Txn[], ym: string, lastDay: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= lastDay; d++) out.push(Math.max(0, Math.round(netSpend(txns, `${ym}-01`, dayISO(ym, d)))));
  return out;
}

function monthLabel(ym: string, long = false): string {
  return monthName(Number(ym.slice(5, 7)) - 1, long);
}

/** Spending by month: total vs last month, daily pace, fixed vs flexible, categories, 6-month trend. */
export default function SpendingScreen() {
  const c = useColors();
  const wide = useWide();
  const txns = useStore((s) => s.txns);
  const today = useMemo(() => todayISO(), []);
  const curYm = today.slice(0, 7);
  const [ym, setYm] = useState(curYm);
  const [picked, setPicked] = useState<CategoryId | null>(null);

  const isCurrent = ym === curYm;
  const prevYm = addMonthsYm(ym, -1);
  // Current month: compare like-for-like (same number of days into last month).
  const dayCount = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(ym);
  const prevDays = Math.min(dayCount, daysInMonth(prevYm));

  const data = useMemo(() => {
    const { from } = monthRange(ym);
    const to = dayISO(ym, dayCount);
    const prevTo = dayISO(prevYm, isCurrent ? prevDays : daysInMonth(prevYm));
    const total = Math.round(netSpend(txns, from, to));
    const prevTotal = Math.round(netSpend(txns, `${prevYm}-01`, prevTo));
    const byCat = spendByCategory(txns, from, to);
    const prevByCat = spendByCategory(txns, `${prevYm}-01`, prevTo);
    const cats = SPEND_CATEGORIES
      .map((ci) => ({ id: ci.id, value: Math.max(0, Math.round(byCat[ci.id] ?? 0)) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    const catTotal = cats.reduce((a, x) => a + x.value, 0);
    const fixed = cats.filter((x) => FIXED.includes(x.id)).reduce((a, x) => a + x.value, 0);
    const line = cumulative(txns, ym, dayCount);
    const prevLine = cumulative(txns, prevYm, daysInMonth(prevYm));
    const six: { ym: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonthsYm(ym, -i);
      const r = monthRange(m);
      const end = m === curYm ? today : r.to;
      six.push({ ym: m, value: Math.max(0, Math.round(netSpend(txns, r.from, end))) });
    }
    return { total, prevTotal, byCat, prevByCat, cats, catTotal, fixed, line, prevLine, six, from, to, prevTo };
  }, [txns, ym, prevYm, dayCount, prevDays, isCurrent, curYm, today]);

  const change = data.prevTotal > 0 ? (data.total - data.prevTotal) / data.prevTotal : null;
  const flexible = Math.max(0, data.catTotal - data.fixed);
  const earliest = useMemo(() => txns.reduce((m, t) => (t.date < m ? t.date : m), today).slice(0, 7), [txns, today]);

  if (!txns.length) {
    return (
      <Screen maxWidth={760}>
        <Card><EmptyState title="No spending yet" body="Add transactions to see where your money goes each month." /></Card>
        <Footer />
      </Screen>
    );
  }

  const switcher = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <IconButton name="chevron-back" label="Previous month" onPress={() => { if (ym > earliest) setYm(prevYm); }}
        color={ym > earliest ? c.text : c.textFaint} />
      <T size={17} weight="700" style={{ minWidth: 110, textAlign: 'center' }}>{`${monthLabel(ym)} ${ym.slice(0, 4)}`}</T>
      <IconButton name="chevron-forward" label="Next month" onPress={() => { if (!isCurrent) setYm(addMonthsYm(ym, 1)); }}
        color={isCurrent ? c.textFaint : c.text} />
    </View>
  );

  const maxLen = Math.max(data.line.length, data.prevLine.length);
  const hero = (
    <Card>
      {switcher}
      <Hero value={money(data.total)} caption={isCurrent ? `spent so far in ${monthLabel(ym, true)}` : `spent in ${monthLabel(ym, true)}`} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <ChangeChip change={change} upIsGood={false} />
        <T size={12} muted>{isCurrent ? `vs first ${dayCount} days of ${monthLabel(prevYm)}` : `vs ${monthLabel(prevYm)}`}</T>
      </View>
      <LineChart
        series={[
          { label: monthLabel(ym), values: data.line, color: c.accent, fill: true },
          { label: monthLabel(prevYm), values: data.prevLine, color: c.textMuted, muted: true },
        ]}
        labels={Array.from({ length: maxLen }, (_, i) => String(i + 1))}
        format={moneyShort}
      />
    </Card>
  );

  const split = (
    <SplitHeader
      leftValue={money(data.fixed)}
      leftCaption="fixed bills"
      rightValue={money(flexible)}
      rightCaption="flexible"
      fraction={data.catTotal > 0 ? data.fixed / data.catTotal : 0}
      color={c.accent}
    />
  );

  const catCard = (
    <Card>
      <SectionTitle title="By category" />
      {data.cats.length ? (
        <>
          <View style={{ alignItems: 'center' }}>
            <Donut size={120} stroke={14}
              slices={data.cats.map((x, i) => ({ label: x.id, value: x.value, color: seriesColor(i, c.dark) }))}
              onSlice={(l) => setPicked(l as CategoryId)} />
          </View>
          {data.cats.map((x, i) => {
            const info = category(x.id);
            return (
              <Pressable key={x.id} onPress={() => setPicked(x.id)} accessibilityRole="button" accessibilityLabel={`${info.label} ${money(x.value)}`}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46 }, pressed && { opacity: 0.8 }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: seriesColor(i, c.dark) }} />
                <T size={18}>{info.emoji}</T>
                <T style={{ flex: 1 }} numberOfLines={1}>{info.label}</T>
                <T size={12} faint>{pct(data.catTotal > 0 ? x.value / data.catTotal : 0)}</T>
                <T weight="600" style={{ minWidth: 76, textAlign: 'right' }}>{money(x.value)}</T>
              </Pressable>
            );
          })}
        </>
      ) : <T muted>No spending in this month.</T>}
    </Card>
  );

  const trend = (
    <Card>
      <SectionTitle title="Last 6 months" />
      <BarChart
        data={data.six.map((m) => ({ label: monthLabel(m.ym), value: m.value, color: c.accent }))}
        selected={5}
        letterLabels
        format={moneyShort}
        onSelect={(i) => { const m = data.six[i]; if (m && m.ym >= earliest) setYm(m.ym); }}
      />
    </Card>
  );

  const sheet = (
    <Sheet visible={!!picked} onClose={() => setPicked(null)} title={picked ? `${category(picked).emoji} ${category(picked).label}` : ''}>
      {picked ? <WhyChanged cat={picked} ym={ym} prevYm={prevYm} txns={txns}
        range={{ from: data.from, to: data.to, prevFrom: `${prevYm}-01`, prevTo: data.prevTo }}
        now={Math.round(data.byCat[picked] ?? 0)} before={Math.round(data.prevByCat[picked] ?? 0)} /> : null}
    </Sheet>
  );

  return (
    <Screen maxWidth={wide ? 1100 : 760}>
      {wide ? (
        <Columns left={<>{hero}{split}</>} right={<>{catCard}{trend}</>} />
      ) : (
        <>{hero}{split}{catCard}{trend}</>
      )}
      <Footer />
      {sheet}
    </Screen>
  );
}

/** Deterministic "why did it change": per-merchant deltas vs the previous month. */
interface Ranges { from: string; to: string; prevFrom: string; prevTo: string }

function merchantDeltas(txns: Txn[], cat: CategoryId, r: Ranges) {
  const agg = new Map<string, { name: string; now: number; before: number; nNow: number; nBefore: number }>();
  for (const t of txns) {
    if (t.category !== cat || t.type !== 'expense' || !isCountedSpend(t)) continue;
    const inNow = t.date >= r.from && t.date <= r.to;
    const inBefore = t.date >= r.prevFrom && t.date <= r.prevTo;
    if (!inNow && !inBefore) continue;
    const k = merchantKey(t.merchant) || t.merchant;
    const a = agg.get(k) ?? { name: displayName(t.merchant), now: 0, before: 0, nNow: 0, nBefore: 0 };
    if (inNow) { a.now += t.amount; a.nNow++; } else { a.before += t.amount; a.nBefore++; }
    agg.set(k, a);
  }
  return [...agg.values()]
    .map((a) => ({ ...a, delta: Math.round(a.now - a.before) }))
    .filter((a) => a.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);
}

function WhyChanged({ cat, ym, prevYm, txns, now, before, range }: {
  cat: CategoryId; ym: string; prevYm: string; txns: Txn[]; now: number; before: number; range: Ranges;
}) {
  const c = useColors();
  const info = category(cat);
  const { from, to, prevFrom, prevTo } = range;
  const deltas = useMemo(() => merchantDeltas(txns, cat, { from, to, prevFrom, prevTo }), [txns, cat, from, to, prevFrom, prevTo]);
  const diff = now - before;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T size={12} muted>{monthLabel(ym, true)}</T>
          <T size={22} weight="700">{money(now)}</T>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <T size={12} muted>{monthLabel(prevYm, true)}</T>
          <T size={22} weight="700" muted>{money(before)}</T>
        </View>
      </View>
      <SectionTitle title="Why did it change?" />
      <T muted>
        {diff === 0
          ? `${info.label} spend is the same as ${monthLabel(prevYm)}.`
          : `${info.label} is ${diff > 0 ? 'up' : 'down'} ${money(Math.abs(diff))} vs ${monthLabel(prevYm)}${deltas.length ? ', mostly from:' : '.'}`}
      </T>
      {deltas.map((d, i) => (
        <View key={d.name + i}style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
          <T style={{ flex: 1 }} numberOfLines={1}>{d.name}</T>
          <T size={12} faint>{d.nBefore} → {d.nNow} payments</T>
          <T weight="600" color={d.delta > 0 ? c.bad : c.good} style={{ minWidth: 80, textAlign: 'right' }}>
            {d.delta > 0 ? '+' : '−'}{money(Math.abs(d.delta))}
          </T>
        </View>
      ))}
      <GhostButton icon="sparkles-outline" label={`What if I cut ${info.label} by 20%?`}
        onPress={() => { void useAssistant.getState().run(`What if I cut ${info.label.toLowerCase()} by 20%?`); }} />
    </View>
  );
}
