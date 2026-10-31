import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import { displayName } from '@/engine/merchant';
import { rentCsv, rentPayments, rentStatus, rentSummary } from '@/engine/rent';
import { useAssistant } from '@/services/assistant';
import { dayMonth, money, moneyShort, monthName, monthYear, parseISO, pct } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { BarChart, SplitHeader } from '@/ui/charts';
import {
  Card, Columns, EmptyState, Footer, GhostButton, ListRow, PrimaryButton, Screen, SectionTitle, T, Tag,
} from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

/** Writes the CSV and opens the share sheet (native) or downloads it (web). */
async function shareCsv(filename: string, text: string): Promise<string> {
  if (Platform.OS === 'web') {
    const g = globalThis as any;
    if (!g.document || !g.URL || !g.Blob) return 'Download is not available in this browser.';
    const blob = new g.Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = filename;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => g.URL.revokeObjectURL(url), 2000);
    return `Downloaded ${filename}.`;
  }
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.writeSync(text);
  if (!(await Sharing.isAvailableAsync())) return `Saved to ${file.uri}`;
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Rent summary for HRA' });
  return 'Rent summary ready to share.';
}

export default function RentScreen() {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const profile = useStore((s) => s.profile);
  const today = useMemo(() => todayISO(), []);
  const [msg, setMsg] = useState<string | null>(null);

  const s = useMemo(() => rentSummary(txns, profile, today), [txns, profile, today]);
  const payments = useMemo(() => rentPayments(txns).filter((t) => t.date <= today).slice(0, 12), [txns, today]);

  if (!payments.length && profile.rent <= 0) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState title="No rent found yet" body="Rent payments show up here once a transaction is categorised as Rent (for example a transfer to your landlord or NoBroker)." />
        </Card>
        <Footer />
      </Screen>
    );
  }

  const share = s.shareOfIncome;
  const heavy = share != null && share > 0.4;
  const thisMonth = s.paidThisMonth?.amount ?? 0;
  const monthLabel = monthName(parseISO(today).getMonth());

  const onShare = async () => {
    setMsg(null);
    try {
      const fy = s.fyLabel.replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '');
      setMsg(await shareCsv(`bachat-rent-${fy}.csv`, rentCsv(txns, today)));
    } catch (e: unknown) {
      setMsg(`Couldn't share the file (${e instanceof Error ? e.message : String(e)}).`);
    }
  };

  const header = (
    <>
      <SplitHeader
        leftValue={money(thisMonth || s.monthly)}
        leftCaption={thisMonth ? `rent paid in ${monthLabel}` : 'rent per month'}
        rightValue={share != null ? pct(share) : '—'}
        rightCaption="of income"
        fraction={share ?? 0}
        color={heavy ? c.warn : c.accent}
      />
      <Card>
        <T size={14}>{rentStatus(s, today)}</T>
        {heavy ? (
          <Tag text={`Rent is ${pct(share ?? 0)} of income — above the 40% comfort line`} color={c.warn} background={c.warnSoft} />
        ) : null}
        {s.changeNote ? <T size={13} muted>{s.changeNote}</T> : null}
      </Card>
    </>
  );

  const chart = (
    <Card>
      <SectionTitle title="Last 12 months" />
      <BarChart
        data={s.months.map((m) => ({ label: monthYear(m.ym).slice(0, 1), value: m.amount, color: c.accent, mark: s.monthly > 0 ? s.monthly : undefined }))}
        letterLabels
        format={moneyShort}
      />
      <T size={11} faint>Dashed tick = your usual rent ({money(s.monthly)}).</T>
    </Card>
  );

  const list = (
    <Card>
      <SectionTitle title="Payments" />
      {payments.length ? payments.map((t) => (
        <ListRow key={t.id}
          left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MerchantLogo name={t.merchant} size={36} />
            <View style={{ flex: 1 }}>
              <T numberOfLines={1}>{displayName(t.merchant)}</T>
              <T size={11} faint>{dayMonth(t.date)} {t.date.slice(0, 4)}{t.account ? ` · ${t.account}` : ''}</T>
            </View>
          </View>}
          right={<T weight="600">{money(t.amount)}</T>} />
      )) : <T muted>No payments recorded yet.</T>}
    </Card>
  );

  const hra = (
    <Card>
      <SectionTitle title="Landlord & HRA" />
      <ListRow left={<T>Paid to</T>} right={<T weight="600">{s.payee ?? '—'}</T>} />
      <ListRow left={<T>Total in {s.fyLabel}</T>} right={<T weight="700">{money(s.fyTotal)}</T>} />
      <T size={12} muted>
        Claiming HRA? Your employer usually asks for rent receipts. If the rent for the year is above ₹1,00,000, your landlord's PAN is also needed.
      </T>
      <PrimaryButton label="Share CSV for HRA" icon="share-outline" onPress={onShare} />
      {msg ? <T size={12} muted center>{msg}</T> : null}
      <GhostButton label="What if rent goes up ₹5,000?" icon="sparkles-outline"
        onPress={() => { void useAssistant.getState().run('What if rent goes up ₹5,000?'); }} />
    </Card>
  );

  return (
    <Screen>
      <Columns left={<>{header}{chart}</>} right={<>{list}{hra}</>} />
      <Footer />
    </Screen>
  );
}
