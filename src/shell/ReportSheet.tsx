import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import { monthlyReport, exportReportPdf, type FocusArea, type ReportLine } from '@/engine/report';
import { plusMonths } from '@/engine/periods';
import { useAssistant } from '@/services/assistant';
import { useShellUI } from '@/shell/ui';
import { money, monthYear, pct, ym as ymOf } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { ChangeChip, GhostButton, IconButton, PrimaryButton, SectionTitle, Sheet, T } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

/*
 * Monthly review: month switcher, KPIs, focus areas and the rest, all as
 * plain cards with clean list rows (GOLD_SPEC "Monthly review"): no tinted
 * boxes, no emoji in focus areas.
 */

/** Closes the shell sheet / Settings and asks the assistant (focus "Try it ›"). */
function tryIt(q: string): void {
  useShellUI.getState().close();
  setTimeout(() => {
    void useAssistant.getState().run(q);
  }, 300);
}

/** In-app monthly review content with a month switcher and "Export PDF" (sheet and Settings → Monthly review). */
export function ReportBody({ onClose }: { onClose?: () => void }) {
  const c = useColors();
  const current = useMemo(() => ymOf(todayISO()), []);
  const [month, setMonth] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Recompute when the data behind the report changes.
  const txns = useStore((s) => s.txns);
  const goals = useStore((s) => s.goals);
  const checkIns = useStore((s) => s.checkIns);
  const rules = useStore((s) => s.rules);
  const profile = useStore((s) => s.profile);
  const report = useMemo(
    () => {
      try {
        return monthlyReport(month);
      } catch {
        return null;
      }
    },
    // monthlyReport() reads the store; these are the inputs it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month, txns, goals, checkIns, rules, profile],
  );

  const oldest = plusMonths(current, -11);
  const go = (n: number) => {
    setMsg(null);
    setMonth((m) => {
      const next = plusMonths(m, n);
      return next > current || next < oldest ? m : next;
    });
  };

  const onExport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await exportReportPdf(month));
    } catch {
      setMsg("Couldn't make the PDF — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <IconButton name="chevron-back" label="Previous month" onPress={() => go(-1)} color={month <= oldest ? c.textFaint : c.text} />
        <T size={16} weight="700" style={{ minWidth: 110, textAlign: 'center' }}>{monthYear(month)}</T>
        <IconButton name="chevron-forward" label="Next month" onPress={() => go(1)} color={month >= current ? c.textFaint : c.text} />
      </View>

      {report ? (
        <>
          {report.partial ? <T size={12} muted center>Month to date, compared with the same days of {report.prevLabel}.</T> : null}

          <ListCard>
            <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}>
              <Kpi label="Income" value={money(report.income)} change={report.prev.income > 0 ? (report.income - report.prev.income) / report.prev.income : null} />
              <Kpi label="Spent" value={money(report.spend)} change={report.prev.spend > 0 ? (report.spend - report.prev.spend) / report.prev.spend : null} upIsGood={false} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}>
              <Kpi label="Net" value={money(report.net)} color={report.net >= 0 ? c.good : c.bad} />
              <Kpi label="Savings rate" value={report.savingsRate != null ? pct(report.savingsRate) : '—'} />
            </View>
            {report.invested > 0 ? <Row title={`${money(report.invested)} went to investments`} line="At cost, not counted as spend." /> : null}
          </ListCard>

          <SectionTitle title="Focus for next month" />
          <FocusList items={report.focus} />

          <SectionTitle title="Top categories" />
          <Lines rows={report.topCategories} prevLabel={report.prevLabel} />

          <SectionTitle title="Top merchants" />
          <Lines rows={report.topMerchants} prevLabel={report.prevLabel} logos />

          {report.overBudget.length ? (
            <>
              <SectionTitle title="Over budget" />
              <ListCard>
                {report.overBudget.map((o) => (
                  <Row key={o.category} title={o.name} line={`${money(o.spent)} of ${money(o.budget)}`}
                    right={<T color={c.bad} weight="600">+{money(o.spent - o.budget)}</T>} />
                ))}
              </ListCard>
            </>
          ) : null}

          <SectionTitle title="Subscriptions" />
          <ListCard>
            {report.subscriptionChanges.map((a) => (
              <Row key={a.id} leading={<MerchantLogo name={a.key || a.title} size={32} />} title={a.title} line={a.detail}
                right={a.yearlyImpact ? <T weight="600" color={a.yearlyImpact > 0 ? c.bad : c.good}>{a.yearlyImpact > 0 ? '+' : '−'}{money(Math.abs(a.yearlyImpact))}/yr</T> : undefined} />
            ))}
            {report.cancelCandidates.map((cc) => (
              <Row key={cc.key} leading={<MerchantLogo name={cc.name} size={32} />} title={cc.name}
                line={cc.answer === 'cancel' ? 'You plan to cancel' : 'You said you are not using it'}
                right={<T color={c.good} weight="600">save {money(cc.yearly)}/yr</T>} />
            ))}
            {!report.subscriptionChanges.length && !report.cancelCandidates.length ? (
              <Row title="No changes" line="No price changes, trials or new subscriptions." />
            ) : null}
          </ListCard>

          <SectionTitle title="Goals & emergency fund" />
          <ListCard>
            <Row
              title="Emergency fund"
              line={report.emergency.monthlyNeed > 0
                ? `${money(report.emergency.fund)} covers ${report.emergency.monthsCovered.toFixed(1)} of ${report.emergency.targetMonths} months${report.emergency.eta ? ` · target around ${monthYear(report.emergency.eta)}` : ''}.`
                : `${money(report.emergency.fund)} saved.`}
            />
            {report.goals.map((g) => (
              <Row key={g.id} title={g.name} line={`${money(g.saved)} of ${money(g.target)} · ${g.eta ? monthYear(g.eta) : '5+ yrs'}`} />
            ))}
          </ListCard>

          <SectionTitle title="What Bachat learned" />
          <ListCard>
            <Row title={`${report.rulesLearned.count} new rule${report.rulesLearned.count === 1 ? '' : 's'} this month`}
              line={report.rulesLearned.count ? 'Learned from your category corrections.' : 'No corrections this month.'} />
            {report.rulesLearned.labels.map((l, i) => <Row key={i} n={i + 1} title={l} />)}
          </ListCard>
        </>
      ) : (
        <T size={13} muted center>Not enough data for this month yet.</T>
      )}

      <PrimaryButton label={busy ? 'Preparing PDF…' : 'Export PDF'} icon="document-text-outline" onPress={onExport} disabled={busy} />
      {msg ? <T size={12} muted center>{msg}</T> : null}
      {onClose ? <GhostButton label="Close" onPress={onClose} /> : null}
      <T size={11} faint center>Educational information only, not financial advice.</T>
    </View>
  );
}

/** Monthly review as a sheet (Home review card, assistant, openReport()). */
export function ReportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Monthly review">
      {visible ? <ReportBody onClose={onClose} /> : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------- pieces

/** One plain card holding list rows separated by hairlines. */
function ListCard({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingHorizontal: 16, paddingVertical: 4 }}>
      {rows.map((r, i) => (
        <View key={i} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : undefined}>{r}</View>
      ))}
    </View>
  );
}

/** 24px number badge (fill colour, white number). */
function NumberBadge({ n }: { n: number }) {
  const c = useColors();
  return (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
      <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{n}</Text>
    </View>
  );
}

/** List row: [number badge | leading] · bold title · one muted line · [right]. */
function Row({ n, leading, title, line, right, action }: {
  n?: number; leading?: React.ReactNode; title: string; line?: string; right?: React.ReactNode; action?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: n != null ? 'flex-start' : 'center', gap: 12, paddingVertical: 12, minHeight: 48 }}>
      {n != null ? <NumberBadge n={n} /> : leading ?? null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
        {line ? <Text style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>{line}</Text> : null}
        {action}
      </View>
      {right}
    </View>
  );
}

/** Focus areas: clean numbered list in one card, optional "Try it ›" (asks the assistant). */
function FocusList({ items }: { items: FocusArea[] }) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <ListCard>
      {items.map((f, i) => (
        <Row
          key={f.title + i}
          n={i + 1}
          title={f.title}
          line={f.body}
          action={f.ask ? (
            <Pressable onPress={() => tryIt(f.ask ?? '')} accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-start', paddingTop: 4 }}>
              <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>Try it ›</Text>
            </Pressable>
          ) : undefined}
        />
      ))}
    </ListCard>
  );
}

function Kpi({ label, value, change, upIsGood = true, color }: {
  label: string; value: string; change?: number | null; upIsGood?: boolean; color?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T size={11} muted weight="600">{label.toUpperCase()}</T>
      <T size={18} weight="700" color={color}>{value}</T>
      {change != null ? <ChangeChip change={change} upIsGood={upIsGood} /> : null}
    </View>
  );
}

function Lines({ rows, prevLabel, logos }: { rows: (ReportLine & { emoji?: string })[]; prevLabel: string; logos?: boolean }) {
  if (!rows.length) {
    return (
      <ListCard>
        <Row title="Nothing yet" />
      </ListCard>
    );
  }
  return (
    <ListCard>
      {rows.map((r, i) => (
        <Row
          key={r.name + i}
          leading={logos ? <MerchantLogo name={r.name} size={32} /> : r.emoji ? <Text style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{r.emoji}</Text> : undefined}
          title={r.name}
          line={`${prevLabel}: ${money(r.prev)}`}
          right={
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <T weight="600">{money(r.amount)}</T>
              <ChangeChip change={r.change} upIsGood={false} />
            </View>
          }
        />
      ))}
    </ListCard>
  );
}
