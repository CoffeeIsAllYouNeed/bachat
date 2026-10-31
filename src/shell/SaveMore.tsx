import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { category } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import { drifts } from '@/engine/nudges';
import { savingIdeas, savingsSummary, type SavingIdea, type SavingsSummary } from '@/engine/savings';
import { useAssistant } from '@/services/assistant';
import { familySavingIdeas } from '@/services/family';
import { offPlanAsk, offPlanFacts, overPace, requestWhy, shown, usePlanCoach, whyFallback, type OffPlanFacts } from '@/services/planCoach';
import { coachKey, fallbackReasoning, requestReasoning, useSavingsCoach, type SavingReason } from '@/services/savingsCoach';
import { openMerchant } from '@/shell/HomeParts';
import { money } from '@/theme/format';
import { useColors, useHeroFont } from '@/theme/theme';
import { Card, GhostButton, PrimaryButton, Sheet, T } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { dismissWithUndo } from '@/ui/Snackbar';

/*
 * "Save more" (Home's first card section + the full list): deterministic
 * saving ideas from src/engine/savings.ts, explained by the AI coach
 * (src/services/savingsCoach.ts) or by deterministic text when the AI is off.
 */

export const SAVE_MORE_EMPTY = "You're spending in line with your plan. Nothing to trim right now.";

export interface SaveMoreData {
  /** Not dismissed, best first (the AI's order when it answered, else monthly × confidence). */
  ideas: SavingIdea[];
  reasons: Record<string, SavingReason>;
  totalMonthly: number;
  totalYearly: number;
  /** True while Gemini is thinking (fallback text is already shown). */
  thinking: boolean;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Saving ideas + reasoning for the current data. Gemini runs once per day + data change. */
export function useSaveMore(): SaveMoreData {
  const txns = useStore((s) => s.txns);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const checkIns = useStore((s) => s.checkIns);
  const checkInShown = useStore((s) => s.checkInShown);
  const goals = useStore((s) => s.goals);
  const family = useStore((s) => s.family);
  const dismissed = useStore((s) => s.dismissedAlerts);
  const today = todayISO();

  // All ideas, ignoring dismissals, so dismissing one doesn't trigger a new AI call.
  const all = useMemo(
    () => [
      ...safe(() => savingIdeas({ txns, settings, profile, checkIns, checkInShown, dismissedAlerts: [] }, today), [] as SavingIdea[]),
      ...safe(() => familySavingIdeas(today), [] as SavingIdea[]),
    ],
    [txns, settings, profile, checkIns, checkInShown, family, today],
  );
  const summary = useMemo<SavingsSummary | null>(
    () => safe(() => savingsSummary({ txns, settings, profile, checkIns, dismissedAlerts: [], goals }, all, today), null),
    [txns, settings, profile, checkIns, goals, all, today],
  );
  const key = useMemo(() => (summary && all.length ? coachKey(all, summary, today) : ''), [all, summary, today]);

  useEffect(() => {
    if (!key || !summary) return;
    void requestReasoning(key, all, summary);
    // `key` captures every input that matters (ideas + facts + day).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const coachFor = useSavingsCoach((s) => s.key);
  const status = useSavingsCoach((s) => s.status);
  const lines = useSavingsCoach((s) => s.lines);

  return useMemo(() => {
    const gone = new Set(dismissed);
    const mine = coachFor === key ? lines : null;
    const reasons: Record<string, SavingReason> = {};
    for (const i of all) {
      const fb = fallbackReasoning(i, summary);
      reasons[i.id] = { why: fb.why, fix: fb.fix, ai: false };
    }
    let ordered = all;
    if (mine && mine.length) {
      // AI lines carry amounts inline: mask them while "Hide amounts" is on.
      for (const l of mine) reasons[l.id] = { why: shown(l.why), fix: shown(l.fix), ai: true };
      const rank = new Map(mine.map((l, i) => [l.id, i]));
      ordered = [...all].sort((a, b) => (rank.get(a.id) ?? 99 + all.indexOf(a)) - (rank.get(b.id) ?? 99 + all.indexOf(b)));
    }
    const ideas = ordered.filter((i) => !gone.has(i.id));
    return {
      ideas,
      reasons,
      totalMonthly: ideas.reduce((s, i) => s + i.monthly, 0),
      totalYearly: ideas.reduce((s, i) => s + i.yearly, 0),
      thinking: coachFor === key && status === 'loading',
    };
  }, [all, summary, key, coachFor, status, lines, dismissed]);
}

/** Small "AI" label shown only when Gemini wrote the reasoning line. */
function AiTag() {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2 }}>
      <Text style={{ color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>AI</Text>
    </View>
  );
}

/** One saving idea: "Save ₹1,240/mo" (₹14,880/yr), title, reasoning, Why? (evidence), Try it / Dismiss. */
export function SavingCard({ idea, reason, onAction }: { idea: SavingIdea; reason?: SavingReason; onAction?: () => void }) {
  const c = useColors();
  const hero = useHeroFont();
  const [open, setOpen] = useState(false);
  const r = reason ?? { ...fallbackReasoning(idea), ai: false };
  const ask = idea.ask;
  const firstMerchant = idea.evidence.length ? idea.evidence[0].merchant : null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 }}>
        <Text style={[{ color: c.good, fontSize: 26 }, hero]}>{`Save ${money(idea.monthly)}/mo`}</Text>
        <Text style={{ color: c.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`${money(idea.yearly)}/yr`}</Text>
      </View>
      <T weight="700">{idea.title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        {r.ai ? <AiTag /> : null}
        <T size={14} muted style={{ flex: 1 }}>{`${r.why} ${r.fix}`}</T>
      </View>

      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}
      >
        <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600' }}>Why?</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={c.accent} />
      </Pressable>
      {open ? (
        <View style={{ gap: 2 }}>
          <T size={13} muted>{idea.detail}</T>
          {idea.evidence.map((e) => (
            <Pressable
              key={e.merchant}
              onPress={() => {
                onAction?.();
                openMerchant(e.merchant);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${e.merchant}, ${e.count} payments, ${money(e.amount)}`}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, pressed && { opacity: 0.7 }]}
            >
              <MerchantLogo name={e.merchant} size={28} />
              <T style={{ flex: 1 }} numberOfLines={1}>{e.merchant}</T>
              <T size={13} muted>{e.count === 1 ? '1 payment' : `${e.count} payments`}</T>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600', minWidth: 72, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{money(e.amount)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GhostButton label="Dismiss" onPress={() => dismissWithUndo(idea.id)} style={{ flex: 1 }} />
        {ask ? (
          <PrimaryButton
            label="Try it"
            icon="sparkles-outline"
            style={{ flex: 1 }}
            onPress={() => {
              onAction?.();
              void useAssistant.getState().run(ask);
            }}
          />
        ) : firstMerchant ? (
          <PrimaryButton
            label="See them"
            style={{ flex: 1 }}
            onPress={() => {
              onAction?.();
              openMerchant(firstMerchant);
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * "You're going off plan": ONE compact banner when flexible categories run
 * meaningfully ahead of their budget pace (nudges.drifts). Tap → why (AI,
 * guarded; deterministic fallback) + Try it. Renders nothing when on plan.
 */
export function OffPlanBanner({ onAction }: { onAction?: () => void }) {
  const c = useColors();
  const txns = useStore((s) => s.txns);
  const budgets = useStore((s) => s.settings.budgets);
  const profile = useStore((s) => s.profile);
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const facts = useMemo<OffPlanFacts | null>(
    () => safe(() => offPlanFacts(txns, drifts(txns, budgets, profile, today), today), null),
    [txns, budgets, profile, today],
  );
  const key = facts?.key ?? '';
  const ai = usePlanCoach((s) => (key ? s.why[key] : undefined));

  useEffect(() => {
    if (open && facts && facts.drifts.length) requestWhy(facts);
    // `key` captures the facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!facts || !facts.drifts.length) return null;
  const why = ai ?? whyFallback(facts);
  const top = facts.drifts[0];

  return (
    <Card onPress={() => setOpen(!open)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="trending-up-outline" size={18} color={c.warn} />
        <T weight="700" style={{ flex: 1 }}>You're going off plan</T>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textFaint} />
      </View>
      {facts.drifts.map((d) => (
        <View key={d.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T size={14} style={{ flex: 1 }} numberOfLines={1}>{`${category(d.category).emoji} ${category(d.category).label}`}</T>
          <T size={14} weight="600" color={c.warn}>{`${money(overPace(d))} over pace`}</T>
        </View>
      ))}
      {open ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            {ai ? <AiTag /> : null}
            <T size={14} muted style={{ flex: 1 }}>{shown(why)}</T>
          </View>
          <PrimaryButton
            label="Try it"
            icon="sparkles-outline"
            onPress={() => {
              onAction?.();
              void useAssistant.getState().run(offPlanAsk(top));
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

/** Empty state card ("Nothing to trim right now"). */
export function SaveMoreEmpty() {
  return (
    <Card>
      <T size={14} muted>{SAVE_MORE_EMPTY}</T>
    </Card>
  );
}

/** The full "Save more" list (bottom sheet on phone, centred panel on laptop). */
export function SaveMoreSheet({ visible, onClose, data }: { visible: boolean; onClose: () => void; data: SaveMoreData }) {
  const c = useColors();
  const hero = useHeroFont();
  return (
    <Sheet visible={visible} onClose={onClose} title="Save more">
      <OffPlanBanner onAction={onClose} />
      {data.ideas.length ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: c.textMuted, fontSize: 14 }}>You could save</Text>
          <Text style={[{ color: c.text, fontSize: 28 }, hero]}>{`${money(data.totalMonthly)} a month`}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`${money(data.totalYearly)} a year`}</Text>
          {data.thinking ? <T size={12} faint>Bachat is thinking about these…</T> : null}
        </View>
      ) : null}
      {data.ideas.map((i) => <SavingCard key={i.id} idea={i} reason={data.reasons[i.id]} onAction={onClose} />)}
      {!data.ideas.length ? <T muted center>{SAVE_MORE_EMPTY}</T> : null}
    </Sheet>
  );
}
