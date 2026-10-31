import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import type { Goal } from '@/data/types';
import { savingIdeas } from '@/engine/savings';
import { baseline, etaLabel } from '@/engine/scenario';
import { buildGoalPlan, feasibilityLine, requestGoalMoves, shown, usePlanCoach, withAiMoves, type PlanContext } from '@/services/planCoach';
import { money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { SectionTitle, T } from '@/ui/kit';

/*
 * Goal action plan (AI A): feasibility from the planner + 2–3 concrete moves
 * from the user's own spending. Numbers are device maths; the AI only words
 * the moves (guarded). Collapsed on the goal card, open in the goal detail.
 */

/** Planner inputs + Save more ideas, computed once per screen. */
export function usePlanContext(): PlanContext | null {
  const txns = useStore((s) => s.txns);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const checkIns = useStore((s) => s.checkIns);
  const goals = useStore((s) => s.goals);
  const dismissed = useStore((s) => s.dismissedAlerts);
  const today = todayISO();
  return useMemo(() => {
    try {
      const base = baseline();
      let ideas: PlanContext['ideas'] = [];
      try {
        ideas = savingIdeas({ txns, settings, profile, checkIns, dismissedAlerts: dismissed }, today);
      } catch {
        ideas = [];
      }
      return { base, ideas, today };
    } catch {
      return null;
    }
    // baseline() reads the store; these are the inputs it depends on.
  }, [txns, settings, profile, checkIns, goals, dismissed, today]);
}

/** The plan under a goal. `collapsible` = goal card (closed until tapped); otherwise open with a title (detail). */
export function GoalPlanView({ goal, ctx, collapsible, onAsk }: {
  goal: Goal; ctx: PlanContext | null; collapsible?: boolean; onAsk?: (q: string) => void;
}) {
  const c = useColors();
  const [open, setOpen] = useState(!collapsible);
  const plan = useMemo(() => {
    if (!ctx) return null;
    try {
      return buildGoalPlan(goal, ctx);
    } catch {
      return null;
    }
  }, [goal, ctx]);
  const key = plan?.key ?? '';
  const ai = usePlanCoach((s) => (key ? s.moves[key] : undefined));

  useEffect(() => {
    if (open && plan && plan.moves.length) requestGoalMoves(plan, goal);
    // `key` captures the goal and the plan numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!plan || !plan.feas.remaining) return null;
  const moves = withAiMoves(plan.moves, ai);
  if (collapsible && !moves.length) return null;

  const body = (
    <View style={{ gap: 2 }}>
      {moves.map((m) => (
        <Pressable
          key={m.id}
          disabled={!m.ask || !onAsk}
          onPress={() => m.ask && onAsk?.(m.ask)}
          accessibilityRole={m.ask && onAsk ? 'button' : undefined}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }, pressed && { opacity: 0.7 }]}
        >
          <T size={14} style={{ flex: 1 }}>{shown(m.text)}</T>
          <Text style={{ color: c.good, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{`+${money(m.monthly)}/mo`}</Text>
        </Pressable>
      ))}
      {moves.length > 1 && plan.total > 0 ? (
        <T size={12} faint>{`Together ${money(plan.total)}/mo → ${etaLabel(plan.etaWithMoves)}`}</T>
      ) : null}
    </View>
  );

  if (collapsible) {
    return (
      <View style={{ gap: 4 }}>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, alignSelf: 'flex-start' }}
        >
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>{plan.feas.onTrack ? 'Reach it sooner' : 'How to get there'}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={c.accent} />
        </Pressable>
        {open ? body : null}
      </View>
    );
  }

  return (
    <>
      <SectionTitle title="Plan" />
      <T size={14} weight="600" color={plan.feas.onTrack ? c.good : c.warn}>{feasibilityLine(plan.feas)}</T>
      {moves.length ? body : null}
    </>
  );
}
