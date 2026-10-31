import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import type { AccountSummary } from '@/data/types';
import { rangeStart } from '@/engine/investments';
import { accounts, netWorth, netWorthHistory } from '@/engine/networth';
import { dayDiff } from '@/engine/periods';
import { dayMonth, money, moneyShort, pct } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { LineChart } from '@/ui/charts';
import {
  Card, ChangeChip, Collapsible, Columns, DotLabel, EmptyState, Footer, ListRow, RangeChips, Screen, T,
} from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

const RANGES = ['1W', '1M', '3M', 'YTD', '1Y'] as const;
type Range = (typeof RANGES)[number];

function change(first: number, last: number): number | null {
  return first > 0 ? (last - first) / first : null;
}

export default function NetWorthScreen() {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const today = useMemo(() => todayISO(), []);
  const [range, setRange] = useState<Range>('YTD');

  const list = useMemo(() => accounts(txns), [txns]);
  const totals = useMemo(() => netWorth(txns), [txns]);
  const history = useMemo(() => {
    const days = dayDiff(rangeStart(range, today), today) + 1;
    return netWorthHistory(txns, days, today);
  }, [txns, range, today]);

  const hasBalances = list.some((a) => a.kind !== 'investment' && a.kind !== 'card') || list.some((a) => a.kind === 'card' && a.balance > 0);

  if (!list.length) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState
            title="No balances yet"
            body="Balances come from bank SMS 'Avl Bal' lines or statements"
            action="Add transactions"
            onAction={() => router.navigate('/transactions')}
          />
        </Card>
        <Footer />
      </Screen>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];
  const cards = list.filter((a) => a.kind === 'card');
  const banks = list.filter((a) => a.kind === 'bank' || a.kind === 'wallet');
  const invest = list.filter((a) => a.kind === 'investment');
  const loans = list.filter((a) => a.kind === 'loan');
  const sum = (xs: AccountSummary[]) => xs.reduce((a, x) => a + x.balance, 0);

  const header = (
    <Card>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <DotLabel text="Assets" color={c.accent} />
          <T size={22} weight="700">{money(totals.assets)}</T>
          <ChangeChip change={first && last ? change(first.assets, last.assets) : null} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <DotLabel text="Debts" color={c.warn} />
          <T size={22} weight="700">{money(totals.debts)}</T>
          <ChangeChip change={first && last ? change(first.debts, last.debts) : null} upIsGood={false} />
        </View>
      </View>
      <T size={13} muted center>Net worth {money(totals.net)}</T>
      <LineChart
        series={[
          { label: 'Assets', values: history.map((h) => h.assets), color: c.accent, fill: true },
          { label: 'Debts', values: history.map((h) => h.debts), color: c.warn },
        ]}
        labels={history.map((h) => dayMonth(h.date))}
        format={moneyShort}
      />
      <RangeChips options={RANGES} value={range} onChange={setRange} />
      {!hasBalances ? <T size={11} faint center>Balances come from bank SMS 'Avl Bal' lines or statements.</T> : null}
    </Card>
  );

  const cardSection = cards.length ? (
    <Collapsible title="Credit cards" trailing={'-' + money(sum(cards))}>
      {cards.map((a) => <CreditCardRow key={a.key} a={a} />)}
    </Collapsible>
  ) : null;

  const plainSection = (title: string, xs: AccountSummary[], negative = false, note?: string) =>
    xs.length ? (
      <Collapsible title={title} trailing={(negative ? '-' : '') + money(sum(xs))}>
        <Card>
          {xs.map((a) => (
            <ListRow key={a.key}
              left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MerchantLogo name={a.name} size={36} />
                <View style={{ flex: 1 }}>
                  <T numberOfLines={1}>{a.name}</T>
                  <T size={11} faint>{note ?? `Updated ${dayMonth(a.updated)}`}</T>
                </View>
              </View>}
              right={<T weight="600">{(negative ? '-' : '') + money(a.balance)}</T>} />
          ))}
        </Card>
      </Collapsible>
    ) : null;

  return (
    <Screen>
      <Columns
        left={header}
        right={<>
          {cardSection}
          {plainSection('Bank accounts', banks)}
          {plainSection('Investments (at cost)', invest, false, 'What you put in · not market value')}
          {plainSection('Loans', loans, true)}
        </>}
      />
      <Footer />
    </Screen>
  );
}

/** Card tile (accent → warn gradient) + balance + utilisation when a limit is known. */
function CreditCardRow({ a }: { a: AccountSummary }) {
  const c = useColors();
  const util = a.limit && a.limit > 0 ? a.balance / a.limit : null;
  const utilColor = util == null ? c.textMuted : util > 0.3 ? (util > 0.7 ? c.bad : c.warn) : c.good;
  const short = a.name.replace(/(?:••|•|xx+|\*+)\s*\d{4}\s*$/i, '').trim() || a.name;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 88 }}>
      <LinearGradient
        colors={[c.accent, c.warn]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 132, height: 80, borderRadius: 12, padding: 10, justifyContent: 'space-between' }}
      >
        <T size={12} weight="700" color={c.onAccent} numberOfLines={2}>{short}</T>
        {a.last4 ? <T size={12} weight="600" color={c.onAccent} style={{ textAlign: 'right' }}>••{a.last4}</T> : null}
      </LinearGradient>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={11} muted weight="600">BALANCE</T>
        <T size={18} weight="700">{money(a.balance)}</T>
        <T size={11} faint>Updated {dayMonth(a.updated)}</T>
      </View>
      {util != null ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <T size={11} muted weight="600">UTILIZED</T>
          <T size={16} weight="700" color={utilColor}>{pct(util, 1)}</T>
        </View>
      ) : null}
    </View>
  );
}
