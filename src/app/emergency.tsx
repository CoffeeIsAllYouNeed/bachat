import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { todayISO, useStore } from '@/data/store';
import type { ProfileSnapshot } from '@/data/types';
import { emergencyMonthsOf, etaLabel, monthsBetween, project } from '@/engine/scenario';
import { usePlanContext } from '@/shell/goals/GoalPlan';
import { ReplanBox } from '@/shell/goals/Replan';
import { openSettings } from '@/shell/ui';
import { dayMonth, money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { SplitHeader } from '@/ui/charts';
import { Card, Collapsible, Columns, EmptyState, Footer, GhostButton, ListRow, PrimaryButton, Screen, SectionTitle, Sheet, T } from '@/ui/kit';
import { Select } from '@/ui/settings';
import { showSnack } from '@/ui/Snackbar';

const MONTH_OPTIONS = [3, 6, 9, 12].map((n) => ({ value: n, label: `${n} months` }));

/** Saves one change into the versioned profile, keeping everything else. */
function saveProfilePatch(patch: Partial<ProfileSnapshot>): void {
  const p = useStore.getState().profile;
  useStore.getState().saveProfile({
    monthlyIncome: p.monthlyIncome,
    irregularIncome: p.irregularIncome,
    rent: p.rent,
    emis: p.emis,
    otherFixed: p.otherFixed,
    emergencyFund: p.emergencyFund,
    emergencyMonths: p.emergencyMonths,
    ...patch,
  });
}

/** Emergency fund: saved vs target, months covered, monthly amount, ETA, history, Add money and re-planning. */
export default function EmergencyScreen() {
  const c = useColors();
  const profile = useStore((s) => s.profile);
  const ctx = usePlanContext();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const today = todayISO();
  const cur = today.slice(0, 7);

  const months = emergencyMonthsOf(profile.emergencyMonths);
  const proj = useMemo(() => {
    if (!ctx) return null;
    try {
      return project(ctx.base);
    } catch {
      return null;
    }
  }, [ctx]);

  const fund = ctx?.base.emergencyFund ?? Math.max(0, profile.emergencyFund);
  const target = ctx?.base.emergencyTarget ?? 0;
  const perMonth = target > 0 ? target / months : 0;
  const covered = perMonth > 0 ? fund / perMonth : 0;
  const remaining = Math.max(0, target - fund);
  const eta = proj?.emergencyEta ?? null;
  const needed = !remaining ? 0 : eta ? Math.ceil(remaining / Math.max(1, monthsBetween(cur, eta) + 1)) : Math.ceil(remaining / 12);

  // Contribution history = changes of the fund between profile versions (newest first).
  const history = useMemo(() => {
    const out: { at: string; delta: number }[] = [];
    let prev = 0;
    for (const h of profile.history) {
      const d = Math.round(h.snapshot.emergencyFund - prev);
      if (d !== 0) out.push({ at: h.at, delta: d });
      prev = h.snapshot.emergencyFund;
    }
    return out.reverse().slice(0, 12);
  }, [profile.history]);

  const change = (sign: 1 | -1) => {
    const v = Number(amount) || 0;
    if (v <= 0) return;
    const before = Math.max(0, profile.emergencyFund);
    const next = sign > 0 ? before + v : Math.max(0, before - v);
    if (next === before) return;
    saveProfilePatch({ emergencyFund: next });
    setAmount('');
    setAdding(false);
    showSnack(sign > 0 ? `Added ${money(v)}` : `Withdrew ${money(before - next)}`, () => saveProfilePatch({ emergencyFund: before }));
  };

  const fmtCovered = covered >= 10 ? Math.round(covered).toString() : covered.toFixed(1).replace(/\.0$/, '');

  const main = target > 0 ? (
    <View style={{ gap: 16 }}>
      <SplitHeader
        leftValue={money(fund)}
        leftCaption="saved"
        rightValue={money(target)}
        rightCaption="target"
        fraction={target ? fund / target : 0}
        color={c.good}
      />
      <Card padded={false}>
        <Select<number> label="Target" value={months} options={MONTH_OPTIONS} onChange={(v) => saveProfilePatch({ emergencyMonths: v })} />
      </Card>
      <Card>
        <ListRow left={<T muted>Months covered</T>} right={<T weight="600">{`${fmtCovered} of ${months}`}</T>} />
        <ListRow left={<T muted>Still to save</T>} right={<T weight="600">{money(remaining)}</T>} />
        {remaining ? <ListRow left={<T muted>Needed a month</T>} right={<T weight="600">{money(needed)}</T>} /> : null}
        <ListRow left={<T muted>Ready by</T>} right={<T weight="600" color={remaining ? (eta ? c.text : c.warn) : c.good}>{remaining ? etaLabel(eta) : 'Target met'}</T>} />
        <PrimaryButton label="Add money" icon="add" onPress={() => setAdding(true)} />
      </Card>
      <Collapsible title="History" trailing={history.length ? String(history.length) : undefined} initiallyOpen={false}>
        <Card>
          {history.length ? (
            history.map((h, i) => (
              <ListRow key={h.at + i} left={<T>{`${dayMonth(h.at.slice(0, 10))} ${h.at.slice(0, 4)}`}</T>}
                right={<T weight="600" color={h.delta < 0 ? c.bad : c.good}>{`${h.delta < 0 ? '−' : '+'}${money(Math.abs(h.delta))}`}</T>} />
            ))
          ) : (
            <T size={13} muted>No changes yet.</T>
          )}
        </Card>
      </Collapsible>
    </View>
  ) : (
    <Card>
      <EmptyState title="No target yet" body="Add your income and costs to set one." action="Add details" onAction={() => openSettings('money')} />
    </Card>
  );

  const side = (
    <View style={{ gap: 16 }}>
      <SectionTitle title="Re-plan" />
      <ReplanBox />
    </View>
  );

  return (
    <>
      <Screen>
        <Columns left={main} right={side} />
        <Footer />
      </Screen>
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Emergency fund">
        <TextInput
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d]/g, ''))}
          placeholder="Amount in ₹"
          placeholderTextColor={c.textFaint}
          keyboardType="number-pad"
          accessibilityLabel="Amount to add or withdraw"
          style={{ color: c.text, fontSize: 16, backgroundColor: c.muted + '88', borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, minHeight: 48 }}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GhostButton label="Withdraw" icon="remove" onPress={() => change(-1)} style={{ flex: 1 }} />
          <PrimaryButton label="Add" icon="add" onPress={() => change(1)} style={{ flex: 1 }} disabled={!(Number(amount) > 0)} />
        </View>
      </Sheet>
    </>
  );
}
