import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '@/data/store';
import type { AssistantAnswer, Projection } from '@/data/types';
import { FOOTER } from '@/engine/guard';
import { baseline, breakdown, describeAdjustment, etaLabel, type Breakdown } from '@/engine/scenario';
import type { PendingAction } from '@/services/agentTools';
import { useAssistant } from '@/services/assistant';
import { money, moneyShort, monthName } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { LineChart } from '@/ui/charts';
import { Card, DecisionRow, GhostButton, IconButton, PrimaryButton, T } from '@/ui/kit';
import { showSnack } from '@/ui/Snackbar';

/** The assistant's latest answer, pinned at the top of the page (info, refusal or before/after scenario). */
export function AnswerPanel() {
  const answer = useAssistant((s) => s.answer);
  const query = useAssistant((s) => s.query);
  const busy = useAssistant((s) => s.busy);
  const c = useColors();

  if (!answer) {
    if (!busy || !query) return null;
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="sparkles-outline" size={18} color={c.accent} />
          <T muted style={{ flex: 1 }} numberOfLines={2}>Working on “{query}”…</T>
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ borderColor: c.accent + '66' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={answer.kind === 'refusal' ? 'shield-checkmark-outline' : answer.kind === 'scenario' ? 'git-compare-outline' : 'sparkles-outline'} size={16} color={c.accent} />
        <T size={13} muted style={{ flex: 1 }} numberOfLines={2}>“{query}”{busy ? '  · updating…' : ''}</T>
        <IconButton name="close" label="Close answer" onPress={() => useAssistant.getState().dismiss()} />
      </View>
      {answer.steps ? <T size={12} faint numberOfLines={1}>{answer.steps}</T> : null}
      {answer.kind === 'refusal' ? <Refusal body={answer.body} /> : answer.kind === 'scenario' ? <ScenarioView answer={answer} /> : <InfoView answer={answer} />}
      {answer.pending?.map((p) => <ConfirmRow key={p.id} action={p} />)}
    </Card>
  );
}

/** One proposed change: nothing happens until Confirm; then a snackbar with Undo. */
function ConfirmRow({ action }: { action: PendingAction }) {
  const c = useColors();
  const decide = (confirm: boolean) => {
    const p = useAssistant.getState().takePending(action.id);
    if (!p || !confirm) return;
    try {
      p.run();
    } catch {
      showSnack("Couldn't apply that");
      return;
    }
    const undo = p.undo;
    showSnack(`Done · ${p.title}`, undo ? () => undo() : undefined);
  };
  return (
    <View style={{ gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
      <View style={{ gap: 2 }}>
        <T size={14} weight="700" numberOfLines={2}>{action.title}</T>
        {action.detail ? <T size={13} muted numberOfLines={1}>{action.detail}</T> : null}
      </View>
      <DecisionRow approve="Confirm" dismiss="Cancel" onApprove={() => decide(true)} onDismiss={() => decide(false)} />
    </View>
  );
}

function InfoView({ answer }: { answer: AssistantAnswer }) {
  return (
    <View style={{ gap: 4 }}>
      <T size={18} weight="700">{answer.title}</T>
      <T muted>{answer.body}</T>
    </View>
  );
}

function Refusal({ body }: { body: string }) {
  const c = useColors();
  const lines = body.split('\n');
  return (
    <View style={{ gap: 8 }}>
      <T size={18} weight="700">I can't pick investments for you</T>
      {lines.map((l, i) => {
        const bullet = l.startsWith('•');
        const text = bullet ? l.slice(1).trim() : l;
        const [head, ...rest] = bullet ? text.split(':') : [text];
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {bullet ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent, marginTop: 7 }} /> : null}
            <Text style={{ flex: 1, color: c.textMuted, fontSize: 14, lineHeight: 20 }}>
              {bullet && rest.length ? <Text style={{ color: c.text, fontWeight: '700' }}>{head}:</Text> : null}
              {bullet && rest.length ? rest.join(':') : text}
            </Text>
          </View>
        );
      })}
      <T size={11} faint>{FOOTER}</T>
    </View>
  );
}

function sign(v: number): string {
  return v > 0 ? '+' : v < 0 ? '−' : '';
}

function NowThen({ label, now, then, better }: { label: string; now: string; then: string; better: boolean | null }) {
  const c = useColors();
  const changed = now !== then;
  const col = !changed || better === null ? c.text : better ? c.good : c.bad;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 8 }}>
      <T size={14} muted style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      <T size={14} faint numberOfLines={1}>{now}</T>
      <Ionicons name="arrow-forward" size={14} color={c.textFaint} />
      <T size={14} weight="700" color={col} numberOfLines={1}>{then}</T>
    </View>
  );
}

function etaBetter(now: string | null, then: string | null): boolean | null {
  if (now === then) return null;
  if (now === null) return true;
  if (then === null) return false;
  return then < now;
}

function ScenarioView({ answer }: { answer: AssistantAnswer }) {
  const c = useColors();
  const scenarios = useStore((s) => s.scenarios);
  const goals = useStore((s) => s.goals);
  const [showMaths, setShowMaths] = useState(false);
  const [saved, setSaved] = useState(false);
  const adjustments = answer.adjustments ?? [];
  const current = answer.current as Projection | undefined;
  const scenario = answer.scenario as Projection | undefined;

  useEffect(() => setSaved(false), [answer]);

  const maths = useMemo((): { base: Breakdown; then: Breakdown; start: string } | null => {
    try {
      const b = baseline();
      return { base: breakdown(b), then: breakdown(b, adjustments), start: b.startMonth };
    } catch {
      return null;
    }
  }, [answer]);

  if (!current || !scenario) return <InfoView answer={answer} />;

  const labels = Array.from({ length: 24 }, (_, i) => {
    if (!maths) return String(i + 1);
    const [y, m] = maths.start.split('-').map(Number);
    const idx = y * 12 + (m - 1) + i;
    return `${monthName(idx % 12)} ’${String(Math.floor(idx / 12)).slice(2)}`;
  });
  const goalNames = goals.filter((g) => !g.archived && g.id in scenario.goalEta);
  const full = scenarios.length >= 3;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {adjustments.map((a, i) => (
          <Pressable
            key={i + describeAdjustment(a)}
            onPress={() => useAssistant.getState().removeAdjustment(i)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${describeAdjustment(a)}`}
            style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent + '55' }}
          >
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{describeAdjustment(a)}</Text>
            <Ionicons name="close" size={14} color={c.textMuted} />
          </Pressable>
        ))}
        {!adjustments.length ? <T size={13} muted>No changes. Ask another what-if.</T> : null}
      </View>

      <View>
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 2 }}>
          <T size={11} faint style={{ flex: 1 }}>WHAT CHANGES</T>
          <T size={11} faint>NOW → THEN</T>
        </View>
        <NowThen label="Monthly surplus" now={money(current.monthlySurplus)} then={money(scenario.monthlySurplus)} better={scenario.monthlySurplus === current.monthlySurplus ? null : scenario.monthlySurplus > current.monthlySurplus} />
        <NowThen label="Monthly spend" now={money(current.monthlySpend)} then={money(scenario.monthlySpend)} better={scenario.monthlySpend === current.monthlySpend ? null : scenario.monthlySpend < current.monthlySpend} />
        <NowThen label="Emergency fund ready" now={etaLabel(current.emergencyEta)} then={etaLabel(scenario.emergencyEta)} better={etaBetter(current.emergencyEta, scenario.emergencyEta)} />
        {goalNames.map((g) => (
          <NowThen key={g.id} label={`${g.emoji} ${g.name}`} now={etaLabel(current.goalEta[g.id] ?? null)} then={etaLabel(scenario.goalEta[g.id] ?? null)} better={etaBetter(current.goalEta[g.id] ?? null, scenario.goalEta[g.id] ?? null)} />
        ))}
      </View>

      <LineChart
        series={[
          { label: 'Now', values: current.savingsPath.slice(0, 24), color: c.textMuted, muted: true, dashed: true },
          { label: 'With these changes', values: scenario.savingsPath.slice(0, 24), color: c.accent, fill: true },
        ]}
        labels={labels}
        format={moneyShort}
        height={150}
        showLegend
      />
      <T size={11} faint>Savings over the next 24 months (what you have now + each month's surplus).</T>

      <T muted>{answer.body}</T>

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <PrimaryButton
          label={saved ? 'Saved' : full ? 'Save (replaces oldest)' : `Save scenario (${scenarios.length}/3)`}
          icon={saved ? 'checkmark' : 'bookmark-outline'}
          disabled={saved || !adjustments.length}
          onPress={() => { useAssistant.getState().saveCurrent(); setSaved(true); }}
          style={{ flexGrow: 1 }}
        />
        <GhostButton label={showMaths ? 'Hide the maths' : 'Show the maths'} icon="calculator-outline" onPress={() => setShowMaths(!showMaths)} style={{ flexGrow: 1 }} />
      </View>

      {showMaths && maths ? <Maths base={maths.base} then={maths.then} /> : null}
      <T size={11} faint>{FOOTER}</T>
    </View>
  );
}

function Maths({ base, then }: { base: Breakdown; then: Breakdown }) {
  const c = useColors();
  const rows: { label: string; now: number; then: number; op: string }[] = [
    { label: 'Income', now: base.income, then: then.income, op: '' },
    { label: 'Fixed (rent, EMIs, bills)', now: base.fixed, then: then.fixed, op: '−' },
    { label: 'Flexible spending', now: base.flexible, then: then.flexible, op: '−' },
  ];
  if (base.sip || then.sip) rows.push({ label: 'New SIPs', now: base.sip, then: then.sip, op: '−' });
  return (
    <View style={{ backgroundColor: c.muted + '55', borderRadius: 14, padding: 12, gap: 6 }}>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', gap: 8 }}>
          <T size={13} muted style={{ width: 14 }}>{r.op}</T>
          <T size={13} muted style={{ flex: 1 }}>{r.label}</T>
          <T size={13}>{money(r.now)}</T>
          <T size={13} faint>→</T>
          <T size={13} weight="600">{money(r.then)}</T>
        </View>
      ))}
      <View style={{ height: 1, backgroundColor: c.border }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <T size={13} weight="700" style={{ width: 14 }}>=</T>
        <T size={13} weight="700" style={{ flex: 1 }}>Monthly surplus</T>
        <T size={13} weight="700">{money(base.surplus)}</T>
        <T size={13} faint>→</T>
        <T size={13} weight="700" color={then.surplus >= base.surplus ? c.good : c.bad}>{money(then.surplus)}</T>
      </View>
      <T size={11} faint>
        {`Change ${sign(then.surplus - base.surplus)}${money(Math.abs(then.surplus - base.surplus))} a month. Flexible = your 3-month average outside rent, EMIs, bills and subscriptions. Surplus fills the emergency fund first, then goals by priority. Every number is computed on this device.`}
      </T>
    </View>
  );
}
