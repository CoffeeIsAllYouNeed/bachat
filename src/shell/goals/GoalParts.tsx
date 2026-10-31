import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { todayISO, uid, useStore } from '@/data/store';
import type { Goal } from '@/data/types';
import { addMonths, durationText, goalSaved, monthsBetween } from '@/engine/scenario';
import { useAssistant } from '@/services/assistant';
import type { PlanContext } from '@/services/planCoach';
import { GoalPlanView } from '@/shell/goals/GoalPlan';
import { showSnack } from '@/ui/Snackbar';
import { dayMonth, money, monthName, monthYear } from '@/theme/format';
import { useColors, useHeroFont } from '@/theme/theme';
import { Donut } from '@/ui/charts';
import { GhostButton, ListRow, PrimaryButton, SectionTitle, Segmented, T, ThinBar } from '@/ui/kit';

/*
 * Pieces of the Goals screen: month circles, goal form (new/edit) and the
 * goal detail sheet body. Kept here because files in src/app are routes.
 */

export const GOAL_EMOJIS = ['🛟', '✈️', '💻', '🏍️', '🚗', '🎓', '💍', '🏠', '🎁', '📱', '🏖️', '🎯'];

/** Months left until a due date (inclusive of this month), or null without one. */
export function monthsLeft(g: Goal, today: string): number | null {
  if (!g.dueDate) return null;
  return Math.max(1, monthsBetween(today.slice(0, 7), g.dueDate.slice(0, 7)) + 1);
}

/** What the goal needs per month: by due date if set, else by the projected ETA (fallback 12 months). */
export function monthlyNeed(g: Goal, eta: string | null | undefined, today: string): number {
  const remaining = Math.max(0, g.target - goalSaved(g));
  if (!remaining) return 0;
  const left = monthsLeft(g, today) ?? (eta ? Math.max(1, monthsBetween(today.slice(0, 7), eta) + 1) : 12);
  return Math.ceil(remaining / left);
}

/** Net contributions in one month. */
export function contributedIn(g: Goal, ym: string): number {
  return g.contributions.filter((c) => c.date.slice(0, 7) === ym).reduce((a, c) => a + c.amount, 0);
}

function shortMonth(ym: string): string {
  return monthName(Number(ym.slice(5, 7)) - 1);
}

// ------------------------------------------------------------------ month circles

/** Six small circles (3 months back … 2 ahead): ✓ when met, partial arc, empty future. */
export function MonthCircles({ fractions, start }: { fractions: (number | null)[]; start: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
      {fractions.map((f, i) => {
        const ym = addMonths(start, i);
        const met = f != null && f >= 0.999;
        return (
          <View key={ym} style={{ alignItems: 'center', gap: 4, opacity: f == null ? 0.45 : 1 }}
            accessible accessibilityLabel={`${monthYear(ym)}: ${f == null ? 'upcoming' : met ? 'met' : `${Math.round(f * 100)} percent`}`}>
            <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute' }}>
                <Donut slices={[]} size={30} stroke={4} single={{ fraction: f ?? 0, color: c.good }} />
              </View>
              {met ? <Ionicons name="checkmark" size={15} color={c.good} /> : null}
            </View>
            <T size={10} faint>{shortMonth(ym)}</T>
          </View>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ form

function Field({ value, onChange, placeholder, label, numeric }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; numeric?: boolean }) {
  const c = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(numeric ? t.replace(/[^\d]/g, '') : t)}
      placeholder={placeholder}
      placeholderTextColor={c.textFaint}
      accessibilityLabel={label}
      keyboardType={numeric ? 'number-pad' : 'default'}
      style={{ color: c.text, fontSize: 16, backgroundColor: c.muted + '88', borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, minHeight: 48 }}
    />
  );
}

/** Month stepper for a due date (‹ Mar 2027 › · No date) + "about ₹X a month". */
function DuePicker({ due, setDue, amount }: { due: string | null; setDue: (v: string | null) => void; amount: number }) {
  const c = useColors();
  const cur = todayISO().slice(0, 7);
  const left = due ? Math.max(1, monthsBetween(cur, due) + 1) : 0;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable onPress={() => due && setDue(addMonths(due, -1) < cur ? cur : addMonths(due, -1))} accessibilityRole="button" accessibilityLabel="Earlier month"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: c.muted + '55' }}>
          <Ionicons name="chevron-back" size={18} color={c.text} />
        </Pressable>
        <T size={16} weight="700" center style={{ flex: 1 }}>{due ? monthYear(due) : 'No date'}</T>
        <Pressable onPress={() => setDue(addMonths(due ?? cur, 1))} accessibilityRole="button" accessibilityLabel="Later month"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: c.muted + '55' }}>
          <Ionicons name="chevron-forward" size={18} color={c.text} />
        </Pressable>
        <GhostButton label={due ? 'No date' : 'Set date'} onPress={() => setDue(due ? null : addMonths(cur, 12))} />
      </View>
      {due ? <T size={12} faint>{`${durationText(left)} from now${amount > 0 ? ` · about ${money(Math.ceil(amount / left))} a month` : ''}`}</T> : null}
    </>
  );
}

/** New goal in 3 steps: name + emoji → amount → target date. Creates it and hands back the id (the detail shows the plan). */
export function GoalWizard({ onDone }: { onDone: (id: string) => void }) {
  const c = useColors();
  const today = todayISO();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(GOAL_EMOJIS[1]);
  const [target, setTarget] = useState('');
  const [due, setDue] = useState<string | null>(addMonths(today.slice(0, 7), 12));
  const amount = Number(target) || 0;
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? amount > 0 : true;

  const create = () => {
    if (!name.trim() || !(amount > 0)) return;
    const id = uid('g_');
    useStore.getState().upsertGoal({
      id, name: name.trim(), emoji, target: amount, dueDate: due ? `${due}-28` : undefined,
      priority: 2, archived: false, createdAt: today, contributions: [],
    });
    onDone(id);
  };

  return (
    <View style={{ gap: 14 }}>
      <T size={12} faint>{`Step ${step + 1} of 3`}</T>
      {step === 0 ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {GOAL_EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => setEmoji(e)} accessibilityRole="button" accessibilityLabel={`Icon ${e}`} accessibilityState={{ selected: e === emoji }}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: e === emoji ? c.accentSoft : c.muted + '55', borderWidth: 1, borderColor: e === emoji ? c.accent : c.border }}>
                <Text style={{ fontSize: 20 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <Field value={name} onChange={setName} placeholder="Goal name (e.g. Goa trip)" label="Goal name" />
        </>
      ) : step === 1 ? (
        <>
          <Field value={target} onChange={setTarget} placeholder="Target amount in ₹" label="Target amount" numeric />
          {amount > 0 ? <T size={12} faint>{money(amount)}</T> : null}
        </>
      ) : (
        <>
          <SectionTitle title="Target date" />
          <DuePicker due={due} setDue={setDue} amount={amount} />
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {step > 0 ? <GhostButton label="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        {step < 2 ? (
          <PrimaryButton label="Next" onPress={() => canNext && setStep(step + 1)} disabled={!canNext} style={{ flex: 1 }} />
        ) : (
          <PrimaryButton label="Create goal" icon="checkmark" onPress={create} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

/** New / edit goal form (inside a Sheet). */
export function GoalForm({ goal, onDone }: { goal?: Goal; onDone: (id: string) => void }) {
  const c = useColors();
  const today = todayISO();
  const [name, setName] = useState(goal?.name ?? '');
  const [emoji, setEmoji] = useState(goal?.emoji ?? GOAL_EMOJIS[1]);
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const [due, setDue] = useState<string | null>(goal?.dueDate ? goal.dueDate.slice(0, 7) : addMonths(today.slice(0, 7), 12));
  const [priority, setPriority] = useState(String(Math.min(3, Math.max(1, goal?.priority ?? 2))));
  const amount = Number(target) || 0;
  const ok = name.trim().length > 0 && amount > 0;

  const save = () => {
    if (!ok) return;
    const id = goal?.id ?? uid('g_');
    useStore.getState().upsertGoal({
      id,
      name: name.trim(),
      emoji,
      target: amount,
      dueDate: due ? `${due}-28` : undefined,
      priority: Number(priority),
      archived: goal?.archived ?? false,
      createdAt: goal?.createdAt ?? today,
      contributions: goal?.contributions ?? [],
    });
    onDone(id);
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GOAL_EMOJIS.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e)} accessibilityRole="button" accessibilityLabel={`Icon ${e}`} accessibilityState={{ selected: e === emoji }}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: e === emoji ? c.accentSoft : c.muted + '55', borderWidth: 1, borderColor: e === emoji ? c.accent : c.border }}>
            <Text style={{ fontSize: 20 }}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <Field value={name} onChange={setName} placeholder="Goal name (e.g. Goa trip)" label="Goal name" />
      <Field value={target} onChange={setTarget} placeholder="Target amount in ₹" label="Target amount" numeric />
      {amount > 0 ? <T size={12} faint>{money(amount)}</T> : null}

      <SectionTitle title="Due by" />
      <DuePicker due={due} setDue={setDue} amount={amount} />

      <SectionTitle title="Priority" />
      <Segmented options={[{ value: '1', label: 'High' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Low' }]} value={priority} onChange={setPriority} />
      <T size={12} faint>The emergency fund always fills first; then goals get money in priority order.</T>

      <PrimaryButton label={goal ? 'Save changes' : 'Create goal'} icon="checkmark" onPress={save} disabled={!ok} />
    </View>
  );
}

// ------------------------------------------------------------------ detail

/** Goal detail sheet body: circles, ETA, summary, contributions, transactions, update progress, reach it sooner. */
export function GoalDetail({ goal, eta, plan, onEdit, onClose }: {
  goal: Goal; eta: string | null | undefined; plan: PlanContext | null; onEdit: () => void; onClose: () => void;
}) {
  const c = useColors();
  const hero = useHeroFont();
  const txns = useStore((s) => s.txns);
  const today = todayISO();
  const cur = today.slice(0, 7);
  const saved = goalSaved(goal);
  const remaining = Math.max(0, goal.target - saved);
  const need = monthlyNeed(goal, eta, today);
  const [amount, setAmount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const start = addMonths(cur, -3);
  const fractions = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(start, i);
    if (m > cur) return null;
    if (!need) return remaining ? 0 : 1;
    return Math.max(0, contributedIn(goal, m) / need);
  });

  const linked = useMemo(() => {
    const key = goal.name.toLowerCase().trim();
    if (key.length < 3) return [];
    return txns.filter((t) => t.merchant.toLowerCase().includes(key) || (t.narration ?? '').toLowerCase().includes(key)).slice(0, 10);
  }, [txns, goal.name]);

  const change = (sign: 1 | -1) => {
    const v = Number(amount) || 0;
    if (v <= 0) return;
    const delta = sign < 0 ? -Math.min(v, saved) : v;
    if (!delta) return;
    useStore.getState().upsertGoal({
      ...goal,
      contributions: [...goal.contributions, { id: uid('c_'), date: today, amount: delta, note: sign < 0 ? 'Withdrawal' : undefined }],
    });
    setAmount('');
  };

  const etaMonths = eta ? monthsBetween(cur, eta) : null;
  const contributions = [...goal.contributions].sort((a, b) => b.date.localeCompare(a.date));
  const ask = (q: string) => {
    onClose();
    void useAssistant.getState().run(q);
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={{ fontSize: 40 }}>{goal.emoji}</Text>
        <T size={26} style={hero}>{money(saved)}</T>
        <T size={13} muted>{`of ${money(goal.target)}${goal.dueDate ? ` · due ${monthYear(goal.dueDate)}` : ''}`}</T>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <ThinBar fraction={goal.target ? saved / goal.target : 0} color={c.good} height={8} />
      </View>
      <MonthCircles fractions={fractions} start={start} />

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.muted, borderRadius: 14, padding: 12 }}>
        <T color={c.accent} weight="700">✳</T>
        <T style={{ flex: 1 }}>
          {!remaining
            ? 'Goal reached. It is ready to spend.'
            : etaMonths == null
              ? "At today's surplus you won't reach this within 5 years. Try the ideas below."
              : etaMonths <= 0
                ? "You'll reach your goal this month."
                : `You'll reach your goal in ${durationText(etaMonths)} (${monthYear(eta as string)}).`}
        </T>
      </View>

      <SectionTitle title="Update progress" />
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

      <SectionTitle title="Summary" />
      <ListRow left={<T muted>Goal amount</T>} right={<T weight="600">{money(goal.target)}</T>} />
      <ListRow left={<T muted>Still to save</T>} right={<T weight="600">{money(remaining)}</T>} />
      <ListRow left={<T muted>Monthly contribution needed</T>} right={<T weight="600">{money(need)}</T>} />
      <ListRow left={<T muted>Priority</T>} right={<T weight="600">{goal.priority <= 1 ? 'High' : goal.priority === 2 ? 'Medium' : 'Low'}</T>} />

      {remaining > 0 && !goal.archived ? <GoalPlanView goal={goal} ctx={plan} onAsk={ask} /> : null}

      <SectionTitle title="Contributions" />
      {contributions.length ? (
        contributions.slice(0, 12).map((k) => (
          <ListRow key={k.id} left={<T>{dayMonth(k.date)} {k.date.slice(0, 4)}</T>} sub={k.note ? <T size={12} faint>{k.note}</T> : undefined}
            right={<T weight="600" color={k.amount < 0 ? c.bad : c.good}>{`${k.amount < 0 ? '−' : '+'}${money(Math.abs(k.amount))}`}</T>} />
        ))
      ) : (
        <T size={13} muted>No contributions yet. Use “Update progress” when you move money to this goal.</T>
      )}

      <SectionTitle title="Transactions" />
      {linked.length ? (
        linked.map((t) => (
          <ListRow key={t.id} left={<T numberOfLines={1}>{t.merchant}</T>} sub={<T size={12} faint>{dayMonth(t.date)}</T>} right={<T weight="600">{money(t.amount)}</T>} />
        ))
      ) : (
        <T size={13} muted>{`Transactions that mention “${goal.name}” show up here.`}</T>
      )}

      <SectionTitle title="Goal settings" />
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <GhostButton label="Edit" icon="create-outline" onPress={onEdit} style={{ flexGrow: 1 }} />
        <GhostButton label={goal.archived ? 'Unarchive' : 'Archive'} icon="archive-outline"
          onPress={() => { useStore.getState().upsertGoal({ ...goal, archived: !goal.archived }); onClose(); }} style={{ flexGrow: 1 }} />
        <GhostButton label={confirmDelete ? 'Tap again to delete' : 'Delete'} icon="trash-outline" danger
          onPress={() => {
            if (!confirmDelete) { setConfirmDelete(true); return; }
            const copy = goal;
            useStore.getState().removeGoal(goal.id);
            onClose();
            showSnack('Goal deleted', () => useStore.getState().upsertGoal(copy));
          }} style={{ flexGrow: 1 }} />
      </View>
    </View>
  );
}
