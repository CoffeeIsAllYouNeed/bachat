import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { CategoryId, Txn } from '@/data/types';
import { CASH_RANGES, cashFlow, type CashFlow, type CashRange } from '@/engine/cashflow';
import { isCountedSpend } from '@/engine/clean';
import { displayName } from '@/engine/merchant';
import { isCountedIncome } from '@/engine/periods';
import { useAssistant } from '@/services/assistant';
import { dayMonth, money, moneyShort, monthYear, parseISO, pct, ym } from '@/theme/format';
import { seriesColor, useColors, useWide } from '@/theme/theme';
import { BarChart, Legend, type BarDatum } from '@/ui/charts';
import {
  Card, ChangeChip, Columns, EmptyState, Footer, GhostButton, Hero, ListRow, RangeChips, Screen, SectionTitle, Sheet, T,
} from '@/ui/kit';

type Detail = 'income' | 'spend' | null;

function periodLabel(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayMonth(from)}${sameYear ? '' : ' ' + from.slice(0, 4)} – ${dayMonth(to)} ${to.slice(0, 4)}`;
}

function changeVs(now: number, then: number): number | null {
  return then !== 0 ? (now - then) / Math.abs(then) : null;
}

export default function CashFlowScreen() {
  const c = useColors();
  const wide = useWide();
  const txns = useStore((s) => s.txns);
  const today = useMemo(() => todayISO(), []);
  const [range, setRange] = useState<CashRange>('YTD');
  const [detail, setDetail] = useState<Detail>(null);

  const flow = useMemo(() => cashFlow(txns, range, today), [txns, range, today]);

  // Stacked spend: the 4 biggest categories in the range + everything else.
  const { stackKeys, spendBars } = useMemo(() => {
    const totals = new Map<CategoryId, number>();
    for (const b of flow.buckets) {
      for (const [k, v] of Object.entries(b.spendByCat) as [CategoryId, number | undefined][]) {
        totals.set(k, (totals.get(k) ?? 0) + (v ?? 0));
      }
    }
    const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
    const keys = [...top.map((k) => ({ key: k as string, label: category(k).label })), { key: 'rest', label: 'Everything else' }];
    const bars: BarDatum[] = flow.buckets.map((b) => {
      const topSum = top.reduce((a, k) => a + (b.spendByCat[k] ?? 0), 0);
      const rest = Math.max(0, b.spend - topSum);
      return {
        label: b.label,
        faded: b.future,
        stack: [
          ...top.map((k, i) => ({ key: k, value: Math.max(0, b.spendByCat[k] ?? 0), color: seriesColor(i, c.dark) })),
          { key: 'rest', value: rest, color: seriesColor(4, c.dark) },
        ],
      };
    });
    return { stackKeys: keys, spendBars: bars };
  }, [flow, c.dark]);

  if (!txns.length) {
    return (
      <Screen maxWidth={760}>
        <Card><EmptyState title="No cash flow yet" body="Add transactions (SMS, CSV or a statement) to see money in vs money out." /></Card>
        <Footer />
      </Screen>
    );
  }

  const label = periodLabel(flow.from, flow.to);
  const lyLabel = periodLabel(`${Number(flow.from.slice(0, 4)) - 1}${flow.from.slice(4)}`, `${Number(flow.to.slice(0, 4)) - 1}${flow.to.slice(4)}`);
  const hasLastYear = flow.lastYear.income > 0 || flow.lastYear.spend > 0;
  const savingsRate = flow.income > 0 ? flow.net / flow.income : null;

  const netCard = (
    <Card>
      <T weight="700" center>Net income</T>
      <T size={12} muted center>{label}</T>
      <Hero value={(flow.net > 0 ? '+' : '') + money(flow.net)} color={flow.net >= 0 ? c.good : c.bad} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        {hasLastYear ? <ChangeChip change={changeVs(flow.net, flow.lastYear.net)} /> : null}
        <T size={12} muted center>{hasLastYear ? `vs ${money(flow.lastYear.net)} in ${lyLabel}` : 'No data from last year to compare'}</T>
      </View>
      <BarChart
        data={flow.buckets.map((b) => ({ label: b.label, value: b.net, compare: b.lastYearNet, faded: b.future }))}
        format={moneyShort}
        height={170}
      />
      {flow.buckets.some((b) => b.lastYearNet != null) ? <T size={11} faint center>- - - same period last year</T> : null}
    </Card>
  );

  const savingsCard = (
    <Card>
      <SectionTitle title="Savings rate" />
      <T size={22} weight="700">{savingsRate != null ? pct(savingsRate) : '—'}</T>
      <T size={13} muted>
        {savingsRate != null
          ? `You kept ${pct(Math.max(0, savingsRate))} of what you earned in this period.`
          : 'No income recorded in this period.'}
        {flow.invested > 0 ? ` ${money(flow.invested)} went to investments — tracked separately, not as spend.` : ''}
      </T>
      <GhostButton label="What if I save ₹5,000 more a month?" icon="sparkles-outline"
        onPress={() => { void useAssistant.getState().run('What if I save ₹5,000 more a month?'); }} />
    </Card>
  );

  const spendCard = (
    <Card onPress={() => setDetail('spend')}>
      <T weight="700" center>Spend</T>
      <T size={12} muted center>{label}</T>
      <Hero value={money(flow.spend)} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        {hasLastYear ? <ChangeChip change={changeVs(flow.spend, flow.lastYear.spend)} upIsGood={false} /> : null}
        {hasLastYear ? <T size={12} muted center>vs {money(flow.lastYear.spend)} in {lyLabel}</T> : null}
      </View>
      <BarChart data={spendBars} format={moneyShort} height={160} />
      <Legend items={stackKeys.map((k, i) => ({ label: k.label, color: seriesColor(k.key === 'rest' ? 4 : i, c.dark) }))} />
    </Card>
  );

  const incomeCard = (
    <Card onPress={() => setDetail('income')}>
      <T weight="700" center>Income</T>
      <T size={12} muted center>{label}</T>
      <Hero value={money(flow.income)} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        {hasLastYear ? <ChangeChip change={changeVs(flow.income, flow.lastYear.income)} /> : null}
        {hasLastYear ? <T size={12} muted center>vs {money(flow.lastYear.income)} in {lyLabel}</T> : null}
      </View>
      <BarChart data={flow.buckets.map((b) => ({ label: b.label, value: b.income, faded: b.future }))}
        positive={c.accent} format={moneyShort} height={140} />
    </Card>
  );

  return (
    <Screen>
      <RangeChips options={CASH_RANGES} value={range} onChange={setRange} />
      {wide ? (
        <Columns left={<>{netCard}{savingsCard}</>} right={<>{spendCard}{incomeCard}</>} />
      ) : (
        <>
          {netCard}
          {spendCard}
          {incomeCard}
          {savingsCard}
        </>
      )}
      <Footer />
      <FlowDetail kind={detail} onClose={() => setDetail(null)} txns={txns} today={today} />
    </Screen>
  );
}

/** Income or Spend detail: this month, 12 bars, key metrics, transactions by month. */
function FlowDetail({ kind, onClose, txns, today }: { kind: Detail; onClose: () => void; txns: Txn[]; today: string }) {
  const c = useColors();
  const year: CashFlow | null = useMemo(() => (kind ? cashFlow(txns, '1Y', today) : null), [kind, txns, today]);
  const ytd: CashFlow | null = useMemo(() => (kind ? cashFlow(txns, 'YTD', today) : null), [kind, txns, today]);
  const [selected, setSelected] = useState<number | undefined>(undefined);

  const rows = useMemo(() => {
    if (!kind) return [] as { ym: string; items: Txn[]; total: number }[];
    const pick = kind === 'income' ? isCountedIncome : isCountedSpend;
    const list = txns.filter((t) => t.date <= today && pick(t)).sort((a, b) => b.date.localeCompare(a.date));
    const groups: { ym: string; items: Txn[]; total: number }[] = [];
    for (const t of list) {
      const m = ym(t.date);
      let g = groups[groups.length - 1];
      if (!g || g.ym !== m) {
        if (groups.length >= 3) break;
        g = { ym: m, items: [], total: 0 };
        groups.push(g);
      }
      g.items.push(t);
      g.total += t.amount;
    }
    return groups;
  }, [kind, txns, today]);

  if (!kind || !year || !ytd) return null;

  const isIncome = kind === 'income';
  const val = (b: CashFlow['buckets'][number]) => (isIncome ? b.income : b.spend);
  const idx = selected ?? year.buckets.length - 1;
  const sel = year.buckets[idx];
  const active = year.buckets.filter((b) => !b.future && val(b) > 0);
  const avg = active.length ? active.reduce((a, b) => a + val(b), 0) / active.length : 0;

  return (
    <Sheet visible onClose={() => { setSelected(undefined); onClose(); }} title={isIncome ? 'Income' : 'Spend'}>
      <View style={{ alignItems: 'center' }}>
        <T size={12} muted>{sel ? monthYear(sel.from) : ''}</T>
        <Hero value={money(sel ? val(sel) : 0)} caption={isIncome ? 'earned' : 'spent'} color={isIncome ? c.good : undefined} />
      </View>
      <BarChart
        data={year.buckets.map((b) => ({ label: b.label.slice(0, 1), value: val(b), faded: b.future }))}
        positive={isIncome ? c.accent : c.warn}
        letterLabels
        selected={idx}
        onSelect={setSelected}
        format={moneyShort}
      />
      <SectionTitle title="Key metrics" />
      <Card>
        <ListRow left={<T>Total this year</T>} right={<T weight="700">{money(isIncome ? ytd.income : ytd.spend)}</T>} />
        <ListRow left={<T>Average per month</T>} right={<T weight="700">{money(avg)}</T>} />
        {isIncome && ytd.income > 0 ? (
          <ListRow left={<T>Kept after spending (this year)</T>} right={<T weight="700">{pct(Math.max(0, ytd.net) / ytd.income)}</T>} />
        ) : null}
      </Card>
      <SectionTitle title="Transactions" />
      {rows.length ? rows.map((g) => (
        <Card key={g.ym}>
          <View style={{ flexDirection: 'row' }}>
            <T size={12} muted weight="600" style={{ flex: 1 }}>{monthYear(g.ym).toUpperCase()}</T>
            <T size={12} muted weight="600">{money(g.total)}</T>
          </View>
          {g.items.slice(0, 8).map((t) => (
            <ListRow key={t.id}
              left={<T numberOfLines={1}>{displayName(t.merchant)}</T>}
              sub={<T size={11} faint>{dayMonth(t.date)} · {category(t.category).label}</T>}
              right={<T weight="600" color={isIncome ? c.good : undefined}>{isIncome ? '+' : ''}{money(t.amount)}</T>} />
          ))}
          {g.items.length > 8 ? <T size={12} faint>+{g.items.length - 8} more</T> : null}
        </Card>
      )) : <T muted>Nothing yet.</T>}
      <T size={11} faint center>Updated {dayMonth(today)} {parseISO(today).getFullYear()}</T>
    </Sheet>
  );
}
