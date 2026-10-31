import { router, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import type { BudgetLine, Recurring, Txn } from '@/data/types';
import { budgetLines, monthRange } from '@/engine/budgets';
import { cashFlow } from '@/engine/cashflow';
import { netSpend } from '@/engine/clean';
import { netWorth, netWorthHistory } from '@/engine/networth';
import { detectRecurring } from '@/engine/recurring';
import { baseline, project } from '@/engine/scenario';
import { niceDay, openMerchant, ReviewCard, TxnRow, type ReviewItem } from '@/shell/HomeParts';
import { greeting } from '@/shell/greeting';
import { OffPlanBanner, SaveMoreEmpty, SaveMoreSheet, SavingCard, useSaveMore } from '@/shell/SaveMore';
import { loadDemoInApp, openImport } from '@/shell/ui';
import { dayMonth, money, moneyShort, monthYear, parseISO } from '@/theme/format';
import { seriesColor, useColors, useHeroFont, useWide } from '@/theme/theme';
import { LineChart, PaceChart, Ring } from '@/ui/charts';
import {
  Card, ChangeChip, Columns, DotLabel, EmptyState, Footer, RangeChips, Rail, Screen,
  SectionTitle, T, ThinBar, useBudgetColor,
} from '@/ui/kit';
import { Segmented } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { useFamilySummary } from '@/services/family';

/** Runs an engine call; a failure in one card never blanks the whole Home screen. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** income − net spend between two dates (counted rows only). */
function netBetween(txns: Txn[], from: string, to: string): number {
  let income = 0;
  for (const t of txns) if (t.type === 'income' && !t.excluded && t.date >= from && t.date <= to) income += t.amount;
  return income - safe(() => netSpend(txns, from, to), 0);
}

function inDays(n: number): string {
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${n} days`;
}

const NW_RANGES = ['1W', '1M', '3M', 'YTD', '1Y'] as const;
type NwRange = (typeof NW_RANGES)[number];

/** Home: monthly spending, the biggest saving idea, budgets, upcoming, net, net worth, goals. */
export default function Home() {
  const c = useColors();
  const wide = useWide();
  const budgetColor = useBudgetColor();
  const txns = useStore((s) => s.txns);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const goals = useStore((s) => s.goals);
  const dismissed = useStore((s) => s.dismissedAlerts);
  const userName = useStore((s) => s.profileInfo.name);
  const hero = useHeroFont();
  const save = useSaveMore();
  const [seeAll, setSeeAll] = useState(false);
  const [nwRange, setNwRange] = useState<NwRange>('3M');
  const [demoBusy, setDemoBusy] = useState(false);
  // "Me · Family" switch (only when the family has at least one other member).
  const fam = useFamilySummary();
  const [scope, setScope] = useState<'me' | 'family'>('me');
  const famOn = scope === 'family' && !!fam;

  const today = todayISO();
  const month = today.slice(0, 7);

  // ---- monthly spending
  const lines = useMemo<BudgetLine[]>(
    () => safe(() => budgetLines(txns, settings.budgets, profile, month, today), []),
    [txns, settings.budgets, profile, month, today],
  );
  const totalBudget = lines.reduce((s, l) => s + l.budget, 0);
  const pace = useMemo(() => {
    const from = safe(() => monthRange(month).from, `${month}-01`);
    const d = parseISO(today);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const cumulative: number[] = [];
    for (let day = 1; day <= d.getDate(); day++) cumulative.push(safe(() => netSpend(txns, from, `${month}-${pad2(day)}`), 0));
    return { cumulative, dim, dayN: d.getDate() };
  }, [txns, month, today]);
  const spent = pace.cumulative[pace.cumulative.length - 1] ?? 0;
  const left = totalBudget - spent;
  const planToday = (totalBudget * pace.dayN) / Math.max(1, pace.dim);
  const overPace = spent - planToday;

  const recs = useMemo<Recurring[]>(() => safe(() => detectRecurring(txns, today), []), [txns, today]);

  // ---- "Your month review is ready" (days 1–7; Settings → Notifications → Monthly review reminder)
  const reportItem = useMemo<ReviewItem | null>(() => {
    const dom = Number(today.slice(8, 10));
    if (!settings.reviewReminder || dom > 7 || !txns.length) return null;
    const d = parseISO(today);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const ym = `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
    const id = `report-${ym}`;
    return dismissed.includes(id) ? null : { kind: 'report', id, ym };
  }, [settings.reviewReminder, txns.length, today, dismissed]);

  // ---- upcoming
  const upcoming = useMemo(() => {
    const end = addDays(today, 14);
    return recs.filter((r) => r.nextDate >= today && r.nextDate <= end).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  }, [recs, today]);

  // ---- net this month vs last month same days
  const net = useMemo(() => {
    const cf = safe<ReturnType<typeof cashFlow> | null>(() => cashFlow(txns, 'MTD', today), null);
    const d = parseISO(today);
    const prevFirst = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prevDim = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    const pf = `${prevFirst.getFullYear()}-${pad2(prevFirst.getMonth() + 1)}-01`;
    const pt = `${pf.slice(0, 8)}${pad2(Math.min(d.getDate(), prevDim))}`;
    const nowNet = netBetween(txns, `${month}-01`, today);
    const prevNet = netBetween(txns, pf, pt);
    return {
      value: cf ? cf.net : nowNet,
      income: cf ? cf.income : 0,
      spend: cf ? cf.spend : 0,
      change: prevNet !== 0 ? (nowNet - prevNet) / Math.abs(prevNet) : null,
    };
  }, [txns, today, month]);

  // ---- net worth
  const nw = useMemo(() => safe(() => netWorth(txns), { assets: 0, debts: 0, net: 0 }), [txns]);
  const nwDays = nwRange === '1W' ? 7 : nwRange === '1M' ? 30 : nwRange === '3M' ? 90 : nwRange === '1Y' ? 365 : Math.max(7, daysBetween(`${today.slice(0, 4)}-01-01`, today));
  const nwHistory = useMemo(
    () => (wide ? safe(() => netWorthHistory(txns, nwDays, today), []) : []),
    [txns, nwDays, today, wide],
  );

  // ---- goals
  const topGoals = useMemo(() => {
    const active = goals.filter((g) => !g.archived).sort((a, b) => a.priority - b.priority).slice(0, 2);
    if (!active.length) return [];
    const proj = safe<ReturnType<typeof project> | null>(() => project(baseline()), null);
    return active.map((g) => {
      const saved = g.contributions.reduce((s, x) => s + x.amount, 0);
      const eta = proj ? proj.goalEta[g.id] : undefined;
      return { g, saved, eta: eta ? monthYear(eta) : eta === null ? 'Over 5 years' : null };
    });
  }, [goals, txns, profile]);

  // ---------------------------------------------------------------- empty
  if (!txns.length) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <EmptyState title="Add your first transactions" body="Paste bank SMS or upload a statement." action="Add transactions" onAction={openImport} />
          <Text
            onPress={async () => {
              if (demoBusy) return;
              setDemoBusy(true);
              try { await loadDemoInApp(); } catch { /* demo is best-effort */ } finally { setDemoBusy(false); }
            }}
            accessibilityRole="button"
            suppressHighlighting
            style={{ color: c.accent, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 12, marginTop: -12 }}
          >
            {demoBusy ? 'Loading demo…' : 'Try the demo'}
          </Text>
        </Card>
        <Footer />
      </Screen>
    );
  }

  // ---------------------------------------------------------------- cards
  const monthLabel = monthYear(month).split(' ')[0];

  // Family scope: merged month totals (family budget when one is set).
  const famBudget = fam ? Object.values(fam.budgets).reduce<number>((a, v) => a + (v ?? 0), 0) : 0;
  const famLeft = fam ? famBudget - fam.spend : 0;
  const scopeSwitch = fam ? (
    <View style={{ alignSelf: 'center', width: 220 }}>
      <Segmented options={[{ value: 'me', label: 'Me' }, { value: 'family', label: 'Family' }]} value={scope} onChange={setScope} />
    </View>
  ) : null;

  const spendingCard = (
    <Card onPress={() => router.navigate((famOn ? '/family' : '/transactions') as Href)}>
      {wide ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T weight="700" style={{ flex: 1 }}>{famOn ? 'Family spending' : 'Monthly spending'}</T>
          <T size={13} weight="600" color={c.accent}>{famOn ? 'Family ›' : 'Transactions ›'}</T>
        </View>
      ) : null}
      {famOn && fam ? (
        <View style={{ alignItems: 'center' }}>
          <Text style={[{ color: famBudget > 0 && famLeft < 0 ? c.bad : c.text, fontSize: 34 }, hero]}>
            {famBudget > 0 ? (famLeft >= 0 ? `${money(famLeft)} left` : `${money(-famLeft)} over`) : `${money(fam.spend)} spent`}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>
            {famBudget > 0 ? `out of ${money(famBudget)} family budget` : `family · ${money(fam.income)} income`}
          </Text>
        </View>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Text style={[{ color: left < 0 ? c.bad : c.text, fontSize: 34 }, hero]}>
            {left >= 0 ? `${money(left)} left` : `${money(-left)} over`}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>
            {totalBudget > 0 ? `out of ${money(totalBudget)} budgeted` : `${money(spent)} spent in ${monthLabel}`}
          </Text>
        </View>
      )}
      {!famOn ? (
        <PaceChart cumulative={pace.cumulative} plan={totalBudget} daysInMonth={pace.dim}
          overLabel={overPace > 0 ? `${money(overPace)} over` : undefined} height={wide ? 170 : 130} />
      ) : null}
    </Card>
  );

  const topIdea = save.ideas.length ? save.ideas[0] : null;
  const review = (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Save more" action={topIdea ? `See all (${save.ideas.length}) ›` : undefined} onAction={() => setSeeAll(true)} />
      <OffPlanBanner />
      {topIdea ? <SavingCard idea={topIdea} reason={save.reasons[topIdea.id]} /> : <SaveMoreEmpty />}
      {reportItem ? <ReviewCard item={reportItem} voice={settings.voice} /> : null}
    </View>
  );

  const budgetsRow = lines.some((l) => l.budget > 0) ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Budgets" action="All budgets ›" onAction={() => router.navigate('/budgets' as Href)} />
      <Rail itemWidth={80} gap={8} seeAll="All budgets" onSeeAll={() => router.navigate('/budgets' as Href)}>
        {lines.filter((l) => l.budget > 0).map((l) => {
          const cat = category(l.category);
          const fixed = !!cat.fixed;
          const paid = fixed && l.spent >= l.budget * 0.95;
          return (
            <Pressable key={l.category} onPress={() => router.navigate('/budgets' as Href)} accessibilityRole="button"
              accessibilityLabel={`${cat.label} budget`} style={({ pressed }) => [{ paddingVertical: 4, alignItems: 'center' }, pressed && { opacity: 0.7 }]}>
              <Ring
                fraction={l.used}
                color={budgetColor(l.used, l.over, fixed)}
                center={<Text style={{ fontSize: 24 }}>{cat.emoji}</Text>}
                label={paid ? money(l.spent) : money(Math.abs(l.left))}
                labelColor={l.over && !fixed ? c.bad : undefined}
                sublabel={paid ? 'paid' : l.over ? 'over' : 'left'}
              />
            </Pressable>
          );
        })}
      </Rail>
    </View>
  ) : null;

  const upcomingPhone = upcoming.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Upcoming" action="Recurring ›" onAction={() => router.navigate('/recurring' as Href)} />
      <Rail itemWidth={168} gap={10} onSeeAll={() => router.navigate('/recurring' as Href)}>
        {upcoming.map((r) => (
          <Card key={r.key} onPress={() => router.navigate('/recurring' as Href)}>
            <T size={12} muted>{inDays(daysBetween(today, r.nextDate))}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MerchantLogo name={r.name} size={32} />
              <View style={{ flex: 1 }}>
                <T weight="600" numberOfLines={1}>{r.name}</T>
                <T size={12} muted numberOfLines={1}>{money(r.amount)} · {dayMonth(r.nextDate)}</T>
              </View>
            </View>
          </Card>
        ))}
      </Rail>
    </View>
  ) : null;

  const upcomingList = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Next two weeks</T>
        <GhostLink label="Recurring ›" href="/recurring" />
      </View>
      {upcoming.length ? upcoming.slice(0, 6).map((r) => (
        <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 10 }}>
          <MerchantLogo name={r.name} size={32} />
          <T style={{ flex: 1 }} numberOfLines={1}>{r.name}</T>
          <T muted size={13} style={{ width: 64 }}>{dayMonth(r.nextDate)}</T>
          <T weight="600" style={{ minWidth: 72, textAlign: 'right' }}>{money(r.amount)}</T>
        </View>
      )) : <T size={13} muted>Nothing due in the next 14 days.</T>}
    </Card>
  );

  const netCard = (
    <Card onPress={() => router.navigate('/cashflow' as Href)}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Net this month</T>
        <T size={13} weight="600" color={c.accent}>Cash flow ›</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={[{ color: net.value < 0 ? c.bad : c.text, fontSize: 26 }, hero]}>{money(net.value)}</Text>
        <ChangeChip change={net.change} />
      </View>
      <T size={12} muted>{money(net.income)} in · {money(net.spend)} out · vs the same days last month</T>
    </Card>
  );

  const nwMini = (
    <Card onPress={() => router.navigate('/networth' as Href)}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Net worth <T muted>{money(nw.net)}</T></T>
        <T size={13} weight="600" color={c.accent}>Accounts ›</T>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <DotLabel text="Assets" color={c.accent} />
          <T size={20} weight="700">{money(nw.assets)}</T>
        </View>
        <View style={{ flex: 1, gap: 2, alignItems: 'flex-end' }}>
          <DotLabel text="Debts" color={c.warn} />
          <T size={20} weight="700">{money(nw.debts)}</T>
        </View>
      </View>
    </Card>
  );

  const nwWide = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Net worth <T muted>{money(nw.net)}</T></T>
        <GhostLink label="Accounts ›" href="/networth" />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <DotLabel text="Assets" color={c.accent} />
          <T size={22} weight="700">{money(nw.assets)}</T>
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <DotLabel text="Debts" color={c.warn} />
          <T size={22} weight="700">{money(nw.debts)}</T>
        </View>
      </View>
      <LineChart
        series={[
          { label: 'Assets', values: nwHistory.map((h) => h.assets), color: c.accent, fill: true },
          { label: 'Debts', values: nwHistory.map((h) => h.debts), color: c.warn },
        ]}
        labels={nwHistory.map((h) => dayMonth(h.date))}
        format={moneyShort}
        showLegend={false}
      />
      <RangeChips options={NW_RANGES} value={nwRange} onChange={setNwRange} />
    </Card>
  );

  const goalsMini = topGoals.length ? (
    <Card onPress={() => router.navigate('/goals' as Href)}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Goals</T>
        <T size={13} weight="600" color={c.accent}>Goals ›</T>
      </View>
      {topGoals.map(({ g, saved, eta }) => (
        <View key={g.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16 }}>{g.emoji}</Text>
            <T style={{ flex: 1 }} numberOfLines={1}>{g.name}</T>
            <T size={13} muted>{money(saved)} / {money(g.target)}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ThinBar fraction={g.target > 0 ? saved / g.target : 0} color={c.good} />
            {eta ? <T size={12} muted>⚑ {eta}</T> : null}
          </View>
        </View>
      ))}
    </Card>
  ) : null;

  const topCats = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Top categories</T>
        <GhostLink label="View all ›" href="/budgets" />
      </View>
      {lines.filter((l) => l.budget > 0 || l.spent > 0).slice(0, 4).map((l, i) => {
        const cat = category(l.category);
        return (
          <View key={l.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: seriesColor(i, c.dark) }} />
            <T numberOfLines={1} style={{ width: 120 }}>{cat.emoji} {cat.label}</T>
            <T weight="600" color={l.over ? c.bad : c.text} style={{ width: 80, textAlign: 'right' }}>{money(l.spent)}</T>
            <ThinBar fraction={l.used} color={budgetColor(l.used, l.over, !!cat.fixed)} />
            <T muted size={13} style={{ width: 72, textAlign: 'right' }}>{money(l.budget)}</T>
          </View>
        );
      })}
    </Card>
  );

  const latest = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T weight="700" style={{ flex: 1 }}>Latest transactions</T>
        <GhostLink label="Transactions ›" href="/transactions" />
      </View>
      {groupByDay(txns.slice(0, 8)).map(([day, rows]) => (
        <View key={day}>
          <T size={11} weight="600" muted style={{ letterSpacing: 0.6, marginTop: 6 }}>{niceDay(day).toUpperCase()}</T>
          {rows.map((t) => <TxnRow key={t.id} t={t} onPress={() => openMerchant(t.merchant)} />)}
        </View>
      ))}
    </Card>
  );

  const seeAllSheet = <SaveMoreSheet visible={seeAll} onClose={() => setSeeAll(false)} data={save} />;

  if (wide) {
    return (
      <Screen>
        <Columns
          left={<>{scopeSwitch}{spendingCard}{review}{latest}</>}
          right={<>{nwWide}{topCats}{upcomingList}{netCard}{goalsMini}</>}
        />
        <Footer />
        {seeAllSheet}
      </Screen>
    );
  }

  const hello = greeting(userName);
  return (
    <Screen>
      {hello ? <T size={14} muted style={{ marginBottom: -6 }}>{hello}</T> : null}
      {scopeSwitch}
      {spendingCard}
      {review}
      {budgetsRow}
      {upcomingPhone}
      {netCard}
      {nwMini}
      {goalsMini}
      <Footer />
      {seeAllSheet}
    </Screen>
  );
}

function groupByDay(rows: Txn[]): [string, Txn[]][] {
  const out: [string, Txn[]][] = [];
  for (const t of rows) {
    const last = out[out.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else out.push([t.date, [t]]);
  }
  return out;
}

function GhostLink({ label, href }: { label: string; href: string }) {
  const c = useColors();
  return (
    <Text onPress={() => router.navigate(href as Href)} accessibilityRole="link" suppressHighlighting
      style={{ color: c.accent, fontSize: 13, fontWeight: '600', paddingVertical: 12, paddingLeft: 12 }}>
      {label}
    </Text>
  );
}
