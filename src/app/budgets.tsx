import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { BudgetLine, CategoryId, Txn } from '@/data/types';
import { budgetLines, monthlyHistory, monthRange, suggestedBudgets } from '@/engine/budgets';
import { isCountedSpend } from '@/engine/clean';
import { displayName } from '@/engine/merchant';
import { daysBetween, detectRecurring } from '@/engine/recurring';
import { useAssistant } from '@/services/assistant';
import { dayMonth, money, monthName, monthYear } from '@/theme/format';
import { seriesColor, useColors, useHeroFont, useWide } from '@/theme/theme';
import { BarChart, SplitHeader } from '@/ui/charts';
import {
  Card, CategoryChip, Columns, EmptyState, Footer, GhostButton, PrimaryButton, Screen, SectionTitle,
  Sheet, T, Tag, ThinBar, useBudgetColor,
} from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

/** Budgets by category: spent vs budget per category, with a category detail (sheet on phone, right column on wide). */
export default function BudgetsScreen() {
  const c = useColors();
  const wide = useWide();
  const txns = useStore((s) => s.txns);
  const overrides = useStore((s) => s.settings.budgets);
  const profile = useStore((s) => s.profile);
  const today = useMemo(() => todayISO(), []);
  const ym = today.slice(0, 7);
  const monthShort = monthName(Number(ym.slice(5, 7)) - 1);

  const lines = useMemo(() => budgetLines(txns, overrides, profile, ym, today), [txns, overrides, profile, ym, today]);
  const totalSpent = lines.reduce((a, l) => a + l.spent, 0);
  const totalBudget = lines.reduce((a, l) => a + l.budget, 0);
  const excluded = useMemo(() => excludedTotal(txns, ym), [txns, ym]);

  const [selected, setSelected] = useState<CategoryId | null>(null);
  const shown: CategoryId | null = selected ?? (wide && lines.length ? lines[0].category : null);

  if (!txns.length) {
    return (
      <Screen maxWidth={760}>
        <Card><EmptyState title="No budgets yet" body="Add transactions and Bachat suggests a budget for each category from your last 3 months." /></Card>
        <Footer />
      </Screen>
    );
  }

  const list = (
    <View style={{ gap: 16 }}>
      <SplitHeader
        leftValue={money(totalSpent)}
        leftCaption={`spent in ${monthShort}`}
        rightValue={money(totalBudget)}
        rightCaption="total budget"
        slices={lines.filter((l) => l.spent > 0).map((l) => ({ label: l.category, value: l.spent, color: seriesColor(lines.indexOf(l), c.dark) }))}
        over={totalSpent > totalBudget && totalBudget > 0}
      />
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 4 }}>
          <View style={{ flex: 1 }} />
          <T size={11} weight="600" muted style={{ letterSpacing: 0.6 }}>SPENT</T>
          <View style={{ flex: 1 }} />
          <T size={11} weight="600" muted style={{ letterSpacing: 0.6 }}>BUDGET</T>
        </View>
        {lines.map((l, i) => (
          <BudgetRow key={l.category} line={l} color={seriesColor(i, c.dark)} active={wide && shown === l.category}
            onPress={() => setSelected(l.category)} />
        ))}
      </View>
      {excluded > 0 ? (
        <View>
          <SectionTitle title="Excluded" />
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.textFaint }} />
            <T size={18}>🔄</T>
            <T style={{ flex: 1 }} numberOfLines={1}>Transfers & card bills</T>
            <T weight="600">{money(excluded)}</T>
            <T size={12} faint>not counted</T>
          </View>
        </View>
      ) : null}
    </View>
  );

  const shownLine = lines.find((l) => l.category === shown) ?? null;

  if (wide) {
    return (
      <Screen>
        <Columns
          left={list}
          right={shownLine ? <Card><CategoryDetail line={shownLine} today={today} /></Card> : <Card><T muted>Pick a category.</T></Card>}
        />
        <Footer />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={760}>
      {list}
      <Footer />
      <Sheet visible={!!shownLine} onClose={() => setSelected(null)} title="Category">
        {shownLine ? <CategoryDetail line={shownLine} today={today} /> : null}
      </Sheet>
    </Screen>
  );
}

/** Excluded money this month (transfer pairs counted once, card bills, user-excluded). */
function excludedTotal(txns: Txn[], ym: string): number {
  const { from, to } = monthRange(ym);
  let sum = 0;
  for (const t of txns) {
    if (!t.excluded || t.date < from || t.date > to) continue;
    if (t.type === 'income' || t.type === 'refund') continue;
    if (t.transferPairId && t.id > t.transferPairId) continue;
    sum += t.amount;
  }
  return Math.round(sum);
}

function BudgetRow({ line, color, onPress, active }: { line: BudgetLine; color: string; onPress: () => void; active: boolean }) {
  const c = useColors();
  const budgetColor = useBudgetColor();
  const info = category(line.category);
  const paid = !!info.fixed && line.budget > 0 && line.spent >= line.budget * 0.95;
  const showSuggested = !line.custom && line.budget > 0 && line.budget === line.suggested;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${info.label}: ${money(line.spent)} of ${money(line.budget)}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 8, borderRadius: 12, paddingHorizontal: 4 },
        active && { backgroundColor: c.muted + '55' }, pressed && { opacity: 0.8 }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <T size={18}>{info.emoji}</T>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <T numberOfLines={1} style={{ flexShrink: 1 }}>{info.label}</T>
        {paid ? <T size={11} weight="700" color={c.good}>PAID</T> : showSuggested ? <T size={11} faint numberOfLines={1}>· suggested</T> : null}
      </View>
      <T weight="600" color={line.over ? c.bad : c.text} style={{ minWidth: 64, textAlign: 'right' }}>{money(line.spent)}</T>
      <View style={{ width: 64, flexDirection: 'row' }}>
        <ThinBar fraction={line.used} color={budgetColor(line.used, line.over, !!info.fixed)} />
      </View>
      <T muted style={{ minWidth: 64, textAlign: 'right' }}>{line.budget > 0 ? money(line.budget) : '—'}</T>
    </Pressable>
  );
}

/** Category detail: spent, 12-month bars vs budget, key metrics, recurrings, latest transactions, budget settings. */
function CategoryDetail({ line, today }: { line: BudgetLine; today: string }) {
  const c = useColors();
  const hero = useHeroFont();
  const txns = useStore((s) => s.txns);
  const overrides = useStore((s) => s.settings.budgets);
  const profile = useStore((s) => s.profile);
  const setSettings = useStore((s) => s.setSettings);
  const info = category(line.category);
  const cat = line.category;

  const history = useMemo(() => monthlyHistory(txns, cat, 12, today), [txns, cat, today]);
  const recs = useMemo(() => detectRecurring(txns, today).filter((r) => r.category === cat), [txns, cat, today]);
  const suggested = useMemo(() => suggestedBudgets(txns, today)[cat] ?? 0, [txns, cat, today]);
  const byMonth = useMemo(() => latestByMonth(txns, cat), [txns, cat]);

  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const year = today.slice(0, 4);
  const thisYear = history.filter((h) => h.ym.startsWith(year));
  const yearTotal = thisYear.reduce((a, h) => a + h.spent, 0);
  const activeMonths = Math.max(1, thisYear.filter((h) => h.spent > 0).length);

  const bars = history.map((h) => ({
    label: monthName(Number(h.ym.slice(5, 7)) - 1).slice(0, 1),
    value: h.spent,
    color: line.budget > 0 && h.spent > line.budget ? c.bad : c.good,
    mark: line.budget > 0 ? line.budget : undefined,
  }));

  const save = () => {
    const n = Math.round(Number(draft.replace(/[₹,\s]/g, '')));
    if (!isFinite(n) || n < 0) { setSaved('Enter an amount in rupees.'); return; }
    setSettings({ budgets: { ...overrides, [cat]: n } });
    setDraft('');
    setSaved(`${info.label} budget set to ${money(n)}.`);
  };
  const applySuggested = () => {
    const next = { ...overrides };
    const profileDefault = (cat === 'rent' && profile.rent > 0) || (cat === 'emi' && profile.emis > 0);
    if (profileDefault) next[cat] = suggested;
    else delete next[cat];
    setSettings({ budgets: next });
    setSaved(`${info.label} budget back to the suggested ${money(suggested)}.`);
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <T size={40}>{info.emoji}</T>
        <T size={24} weight="700" color={c.accent}>{info.label}</T>
        <T size={11} weight="600" muted style={{ letterSpacing: 0.6, marginTop: 8 }}>SPENT</T>
        <T size={30} color={line.over ? c.bad : c.text} style={hero}>{money(line.spent)}</T>
        {line.budget > 0 ? (
          <T muted color={line.over ? c.bad : undefined}>{line.over ? `${money(-line.left)} over` : `${money(line.left)} left`} of {money(line.budget)}</T>
        ) : <T muted>No budget set</T>}
      </View>

      <BarChart data={bars} letterLabels selected={bars.length - 1} format={(v) => money(v)} />

      <SectionTitle title="Key metrics" />
      <Metric label={`Total spend in ${year}`} value={money(yearTotal)} />
      <Metric label="Average per month" value={money(Math.round(yearTotal / activeMonths))} />

      {recs.length ? (
        <>
          <SectionTitle title="Recurrings" />
          {recs.map((r) => {
            const d = daysBetween(today, r.nextDate);
            return (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                <T muted style={{ minWidth: 84 }}>{d > 0 ? `In ${d} day${d === 1 ? '' : 's'}` : d === 0 ? 'Today' : 'Overdue'}</T>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.muted + '55', borderRadius: 12, paddingHorizontal: 12, minHeight: 44 }}>
                  <T>{info.emoji}</T>
                  <T style={{ flex: 1 }} numberOfLines={1}>{r.name}</T>
                  <T weight="600">{money(r.amount)}</T>
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      <SectionTitle title="Transactions" />
      {byMonth.length ? byMonth.map((g) => (
        <View key={g.ym} style={{ gap: 4 }}>
          <T weight="700" muted center>{monthYear(g.ym)}</T>
          {g.rows.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <T size={13} faint style={{ width: 52 }}>{dayMonth(t.date)}</T>
              <MerchantLogo name={t.merchant} size={32} />
              <T style={{ flex: 1 }} numberOfLines={1}>{displayName(t.merchant)}</T>
              <CategoryChip emoji={info.emoji} label={info.label} />
              <T weight="600" style={{ minWidth: 70, textAlign: 'right' }}>{money(t.amount)}</T>
            </View>
          ))}
        </View>
      )) : <T muted>No transactions in this category yet.</T>}

      <SectionTitle title="Category settings" />
      <T size={13} muted>Edit the budget</T>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={line.budget > 0 ? String(line.budget) : 'Amount in ₹'}
          placeholderTextColor={c.textFaint}
          keyboardType="numeric"
          accessibilityLabel={`${info.label} budget in rupees`}
          onSubmitEditing={save}
          style={{ flex: 1, minHeight: 46, borderRadius: 12, paddingHorizontal: 14, backgroundColor: c.muted + '88', color: c.text, fontSize: 16, borderWidth: 1, borderColor: c.border }}
        />
        <PrimaryButton label="Save" onPress={save} disabled={!draft.trim()} />
      </View>
      {suggested > 0 ? <GhostButton label={`Use suggested · ${money(suggested)}`} onPress={applySuggested} /> : null}
      {line.custom ? <Tag text="Custom budget" color={c.text} background={c.muted} /> : null}
      {saved ? <T size={13} color={c.good}>{saved}</T> : null}
      <GhostButton icon="sparkles-outline" label={`What if I cut ${info.label} by 20%?`}
        onPress={() => { void useAssistant.getState().run(`What if I cut ${info.label.toLowerCase()} by 20%?`); }} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
      <T muted style={{ flex: 1 }}>{label}</T>
      <T weight="600">{value}</T>
    </View>
  );
}

/** Latest counted transactions in a category, grouped by month (3 months, ≤ 15 rows). */
function latestByMonth(txns: Txn[], cat: CategoryId): { ym: string; rows: Txn[] }[] {
  const rows = txns
    .filter((t) => t.category === cat && t.type === 'expense' && isCountedSpend(t))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);
  const groups: { ym: string; rows: Txn[] }[] = [];
  for (const t of rows) {
    const m = t.date.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.ym === m) g.rows.push(t);
    else if (groups.length < 3) groups.push({ ym: m, rows: [t] });
  }
  return groups;
}
