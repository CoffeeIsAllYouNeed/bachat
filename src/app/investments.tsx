import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import { investmentSummary, pathWindow, rangeStart } from '@/engine/investments';
import { useAssistant } from '@/services/assistant';
import { dayMonth, money, moneyShort, ordinal, pct } from '@/theme/format';
import { seriesColor, useColors } from '@/theme/theme';
import { LineChart } from '@/ui/charts';
import {
  Card, ChangeChip, Collapsible, Columns, EmptyState, Footer, GhostButton, Hero, ListRow, RangeChips, Screen, T, ThinBar,
} from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

const RANGES = ['1W', '1M', '3M', 'YTD', '1Y'] as const;
type Range = (typeof RANGES)[number];

export default function InvestmentsScreen() {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const today = useMemo(() => todayISO(), []);
  const [range, setRange] = useState<Range>('YTD');

  const inv = useMemo(() => investmentSummary(txns, today), [txns, today]);
  const points = useMemo(() => pathWindow(inv.path, rangeStart(range, today), today), [inv, range, today]);

  const askSip = () => { void useAssistant.getState().run('What if I add a SIP of ₹5,000?'); };

  const note = (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: c.accent }}>
      <T weight="700">At cost, never advice</T>
      <T size={13} muted>Bachat tracks what you put in. It never tells you what to buy.</T>
    </Card>
  );

  if (!inv.path.length) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState title="No investments found yet" body="SIPs and purchases (Zerodha, Groww, PPF, NPS…) show up here at the amount you put in." />
        </Card>
        {note}
        <GhostButton label="What if I add a SIP of ₹5,000?" icon="sparkles-outline" onPress={askSip} />
        <Footer />
      </Screen>
    );
  }

  const yoy = inv.lastYearSamePeriod > 0 ? (inv.thisYear - inv.lastYearSamePeriod) / inv.lastYearSamePeriod : null;

  const header = (
    <Card>
      <T size={12} muted center weight="600">INVESTED AT COST</T>
      <Hero value={money(inv.total)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <T size={13} muted>This year {money(inv.thisYear)}</T>
        <ChangeChip change={yoy} />
      </View>
      <LineChart
        series={[{ label: 'Invested (cumulative)', values: points.map((p) => p.cumulative), color: c.accent, fill: true }]}
        labels={points.map((p) => dayMonth(p.date))}
        format={moneyShort}
        showLegend={false}
      />
      <RangeChips options={RANGES} value={range} onChange={setRange} />
    </Card>
  );

  const accountsSection = (
    <Collapsible title="Accounts" trailing={money(inv.platforms.reduce((a, p) => a + p.total, 0))}>
      <Card>
        {inv.platforms.map((p) => (
          <ListRow key={p.name}
            left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MerchantLogo name={p.name} size={36} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{p.name}</T>
                <T size={11} faint>Last added {dayMonth(p.lastDate)}</T>
              </View>
            </View>}
            right={<T weight="600">{money(p.total)}</T>} />
        ))}
      </Card>
    </Collapsible>
  );

  const allocationSection = (
    <Collapsible title="Allocation" trailing={`${inv.allocation.length} type${inv.allocation.length === 1 ? '' : 's'}`}>
      <Card>
        {inv.allocation.map((a, i) => (
          <View key={a.bucket} style={{ gap: 6, minHeight: 44, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row' }}>
              <T style={{ flex: 1 }}>{a.bucket}</T>
              <T weight="600">{pct(a.share)}</T>
              <T muted> · {money(a.amount)}</T>
            </View>
            <View style={{ flexDirection: 'row' }}><ThinBar fraction={a.share} color={seriesColor(i, c.dark)} /></View>
          </View>
        ))}
        <T size={11} faint>Grouped by keywords in the transaction (fund, ELSS, gold, PPF…), at cost.</T>
      </Card>
    </Collapsible>
  );

  const holdingsSection = (
    <Collapsible title="Holdings (SIPs)" trailing={inv.sips.length ? `${money(inv.sips.reduce((a, s) => a + s.monthly, 0))}/mo` : undefined}>
      <Card>
        {inv.sips.length ? inv.sips.map((s) => (
          <ListRow key={s.name}
            left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MerchantLogo name={s.name} size={36} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{s.name}</T>
                <T size={11} faint>Monthly on the {ordinal(s.day)} · {s.months} months in a row</T>
              </View>
            </View>}
            right={<T weight="600">{money(s.monthly)}</T>} />
        )) : <T size={13} muted>No regular monthly investments found yet.</T>}
      </Card>
    </Collapsible>
  );

  return (
    <Screen>
      <Columns
        left={<>{header}{note}<GhostButton label="What if I add a SIP of ₹5,000?" icon="sparkles-outline" onPress={askSip} /></>}
        right={<>{accountsSection}{allocationSection}{holdingsSection}</>}
      />
      <Footer />
    </Screen>
  );
}
