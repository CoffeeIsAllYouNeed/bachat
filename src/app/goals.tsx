import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import type { Goal } from '@/data/types';
import { addMonths, describeAdjustment, etaLabel, goalSaved, project } from '@/engine/scenario';
import { useAssistant } from '@/services/assistant';
import { GoalDetail, GoalForm, GoalWizard, MonthCircles, monthlyNeed, monthsLeft } from '@/shell/goals/GoalParts';
import { GoalPlanView, usePlanContext } from '@/shell/goals/GoalPlan';
import { ReplanBox } from '@/shell/goals/Replan';
import { money, monthName, monthYear } from '@/theme/format';
import { useColors, useWide } from '@/theme/theme';
import { SplitHeader } from '@/ui/charts';
import { Card, Collapsible, Columns, EmptyState, Footer, GhostButton, IconButton, Screen, SectionTitle, Sheet, T, ThinBar } from '@/ui/kit';

type SheetState = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'detail'; id: string } | null;

/** Goals: savings goals with projected ETAs and an action plan each; the emergency fund fills first. */
export default function GoalsScreen() {
  const c = useColors();
  const wide = useWide();
  const goals = useStore((s) => s.goals);
  const profile = useStore((s) => s.profile);
  const scenarios = useStore((s) => s.scenarios);
  const [sheet, setSheet] = useState<SheetState>(null);
  const today = todayISO();
  const cur = today.slice(0, 7);
  const monthLabel = monthName(Number(cur.slice(5, 7)) - 1);
  const ctx = usePlanContext();

  const plan = useMemo(() => {
    if (!ctx) return null;
    try {
      return { base: ctx.base, proj: project(ctx.base) };
    } catch {
      return null;
    }
  }, [ctx]);

  const active = goals.filter((g) => !g.archived && goalSaved(g) < g.target);
  const ready = goals.filter((g) => !g.archived && goalSaved(g) >= g.target);
  const archived = goals.filter((g) => g.archived);

  const efFund = plan?.base.emergencyFund ?? profile.emergencyFund;
  const efTarget = plan?.base.emergencyTarget ?? 0;
  const efRemaining = Math.max(0, efTarget - efFund);
  const surplus = plan?.proj.monthlySurplus ?? 0;

  const savedThisMonth = goals.reduce((a, g) => a + g.contributions.filter((k) => k.date.slice(0, 7) === cur).reduce((x, k) => x + k.amount, 0), 0);
  const neededThisMonth = active.reduce((a, g) => a + monthlyNeed(g, plan?.proj.goalEta[g.id], today), 0) + Math.min(efRemaining, Math.max(0, surplus));
  const toGo = Math.max(0, neededThisMonth - Math.max(0, savedThisMonth));

  // Emergency fund circles from the versioned profile (3 months back … 2 ahead).
  const efStart = addMonths(cur, -3);
  const efFractions = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(efStart, i);
    if (m > cur) return null;
    if (!efTarget) return 1;
    const snaps = profile.history.filter((h) => h.at.slice(0, 7) <= m);
    const value = m === cur ? efFund : snaps.length ? snaps[snaps.length - 1].snapshot.emergencyFund : 0;
    return Math.min(1, value / efTarget);
  });

  const selected = sheet && sheet.kind !== 'new' ? goals.find((g) => g.id === sheet.id) : undefined;
  const openNew = () => setSheet({ kind: 'new' });

  const goalRow = (g: Goal) => {
    const saved = goalSaved(g);
    const left = monthsLeft(g, today);
    const eta = plan?.proj.goalEta[g.id];
    const done = saved >= g.target;
    return (
      <Card key={g.id} onPress={() => setSheet({ kind: 'detail', id: g.id })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted + '88', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20 }}>{g.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <T weight="700" numberOfLines={1}>{g.name}</T>
            <T size={12} muted>{`${money(saved)} of ${money(g.target)}`}</T>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          <ThinBar fraction={g.target ? saved / g.target : 0} color={c.good} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <T size={12} muted>{done ? 'Ready to spend' : left != null ? `${left} month${left === 1 ? '' : 's'} left` : 'No due date'}</T>
          {!done ? (
            <T size={12} color={eta ? (g.dueDate && eta > g.dueDate.slice(0, 7) ? c.warn : c.text) : c.textFaint}>{`⚑ ${etaLabel(eta ?? null)}`}</T>
          ) : null}
        </View>
        {!done && !g.archived ? <GoalPlanView goal={g} ctx={ctx} collapsible onAsk={(q) => { void useAssistant.getState().run(q); }} /> : null}
      </Card>
    );
  };

  const efRow = (
    <Card onPress={() => router.navigate('/emergency' as Href)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted + '88', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 20 }}>🛟</Text>
        </View>
        <View style={{ flex: 1 }}>
          <T weight="700">Emergency fund</T>
          <T size={12} muted>{efTarget ? `${money(efFund)} of ${money(efTarget)} · ${profile.emergencyMonths} months of expenses` : 'Add transactions or your income to set a target'}</T>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
      </View>
      <MonthCircles fractions={efFractions} start={efStart} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <T size={12} muted>{efRemaining ? `${money(efRemaining)} to go` : 'Target met'}</T>
        {efRemaining ? <T size={12}>{`⚑ ${etaLabel(plan?.proj.emergencyEta ?? null)}`}</T> : null}
      </View>
    </Card>
  );

  const lists = (
    <View style={{ gap: 16 }}>
      <SplitHeader
        leftValue={money(Math.max(0, savedThisMonth))}
        leftCaption={`saved in ${monthLabel}`}
        rightValue={money(toGo)}
        rightCaption={`to go in ${monthLabel}`}
        fraction={neededThisMonth > 0 ? Math.max(0, savedThisMonth) / neededThisMonth : savedThisMonth > 0 ? 1 : 0}
        color={c.good}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <T size={13} muted>{`Monthly surplus ${money(surplus)} · fills the emergency fund, then goals by priority`}</T>
        </View>
        <IconButton name="add" label="New goal" color={c.accent} onPress={openNew} />
      </View>

      <Collapsible title="Active" trailing={String(active.length + 1)}>
        <View style={{ gap: 12 }}>
          {efRow}
          {active.map(goalRow)}
          {!goals.length ? (
            <Card>
              <EmptyState title="No goals yet" body="Add one and see when you'll get there." action="Add goal" onAction={openNew} />
            </Card>
          ) : null}
        </View>
      </Collapsible>
      {ready.length ? (
        <Collapsible title="Ready to spend" trailing={String(ready.length)}>
          <View style={{ gap: 12 }}>{ready.map(goalRow)}</View>
        </Collapsible>
      ) : null}
      {archived.length ? (
        <Collapsible title="Archived" trailing={String(archived.length)} initiallyOpen={false}>
          <View style={{ gap: 12 }}>{archived.map(goalRow)}</View>
        </Collapsible>
      ) : null}
    </View>
  );

  const side = (
    <View style={{ gap: 16 }}>
      <SectionTitle title="Re-plan" />
      <ReplanBox />
      <SectionTitle title="Saved scenarios" />
      <Card>
        {scenarios.length ? (
          scenarios.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" onPress={() => useAssistant.getState().openScenario(s)}>
                <T weight="600" numberOfLines={2}>{s.name || s.adjustments.map(describeAdjustment).join(' · ')}</T>
                <T size={11} faint>{`Saved ${monthYear(s.createdAt.slice(0, 7))}`}</T>
              </Pressable>
              <IconButton name="trash-outline" label="Delete scenario" onPress={() => useStore.getState().removeScenario(s.id)} />
            </View>
          ))
        ) : (
          <T size={13} muted>Ask a what-if (“What if I cut food by 20%?”) and save it here to compare later. Up to 3.</T>
        )}
      </Card>
      <SectionTitle title="How the plan works" />
      <Card>
        <T size={13} muted>{`Surplus = income − fixed costs − your 3-month average flexible spending. Each month it fills the emergency fund to ${profile.emergencyMonths} months of expenses, then your goals in priority order. ETAs assume nothing grows or shrinks; investment returns are never assumed.`}</T>
        <GhostButton label="Try a what-if" icon="flash-outline" onPress={() => { void useAssistant.getState().run('What if I save ₹5,000 more a month?'); }} />
      </Card>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        {wide ? <Columns left={lists} right={side} /> : (
          <>
            {lists}
            {side}
          </>
        )}
        <Footer />
      </Screen>

      {/* ＋ floating above the content (above the assistant button), Goals only */}
      <Pressable
        onPress={openNew}
        accessibilityRole="button"
        accessibilityLabel="New goal"
        style={({ pressed }) => [
          { position: 'absolute', right: 22, bottom: 88, width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Ionicons name="add" size={24} color={c.accent} />
      </Pressable>

      <Sheet visible={sheet?.kind === 'new'} onClose={() => setSheet(null)} title="New goal">
        {sheet?.kind === 'new' ? <GoalWizard onDone={(id) => setSheet({ kind: 'detail', id })} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === 'edit' && !!selected} onClose={() => setSheet(null)} title="Edit goal">
        {sheet?.kind === 'edit' && selected ? <GoalForm goal={selected} onDone={(id) => setSheet({ kind: 'detail', id })} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === 'detail' && !!selected} onClose={() => setSheet(null)} title={selected?.name ?? 'Goal'}>
        {sheet?.kind === 'detail' && selected ? (
          <GoalDetail
            goal={selected}
            eta={plan?.proj.goalEta[selected.id]}
            plan={ctx}
            onEdit={() => setSheet({ kind: 'edit', id: selected.id })}
            onClose={() => setSheet(null)}
          />
        ) : null}
      </Sheet>
    </View>
  );
}
