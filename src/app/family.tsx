import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, Text, TextInput, View } from 'react-native';
import { category, SPEND_CATEGORIES } from '@/data/categories';
import { useStore } from '@/data/store';
import type { CategoryId } from '@/data/types';
import {
  addSharedGoal, contributeToSharedGoal, removeSharedGoal, setFamilyBudget, setSharedGoalContribution, useFamilySummary,
  type FamilyGoalView, type FamilySummary,
} from '@/services/family';
import { createHousehold, joinHousehold, syncFamily } from '@/services/familySync';
import { openSettings } from '@/shell/ui';
import { money, moneyShort, pct } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { SplitHeader } from '@/ui/charts';
import {
  Card, Columns, EmptyState, Footer, GhostButton, ListRow, PersonAvatar, PrimaryButton, Screen, SectionTitle, Sheet, T,
  ThinBar, useBudgetColor,
} from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { Select } from '@/ui/settings';
import { showSnack } from '@/ui/Snackbar';

type SheetState =
  | { kind: 'invite' }
  | { kind: 'join' }
  | { kind: 'budget'; category: CategoryId }
  | { kind: 'goal' }
  | { kind: 'contribute'; goal: FamilyGoalView }
  | null;

const CATEGORY_OPTIONS = SPEND_CATEGORIES.map((c) => ({ value: c.id, label: `${c.emoji} ${c.label}` }));

/** Family: merged month, members, combined categories, shared goals, duplicates and Invite. */
export default function FamilyScreen() {
  const sum = useFamilySummary();
  const hasHousehold = useStore((s) => !!s.family.household);
  const [sheet, setSheet] = useState<SheetState>(null);

  // Pull the family's latest snapshots when the screen opens (no-op when sync is off).
  useEffect(() => {
    void syncFamily();
  }, []);

  const close = () => setSheet(null);

  if (!sum) {
    return (
      <>
        <Screen maxWidth={760}>
          <Card>
            <EmptyState
              title={hasHousehold ? 'No one joined yet' : 'No family yet'}
              body={hasHousehold ? 'Share your code to invite family.' : 'Plan money together, privately.'}
              action="Invite"
              onAction={() => setSheet({ kind: 'invite' })}
            />
            {!hasHousehold ? <JoinLink onPress={() => setSheet({ kind: 'join' })} /> : null}
          </Card>
          <Footer />
        </Screen>
        <FamilySheets sheet={sheet} onClose={close} />
      </>
    );
  }

  return (
    <>
      <FamilyBody sum={sum} onSheet={setSheet} />
      <FamilySheets sheet={sheet} onClose={close} budgets={sum.budgets} />
    </>
  );
}

function JoinLink({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Text onPress={onPress} accessibilityRole="button" suppressHighlighting
      style={{ color: c.accent, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 12, marginTop: -12 }}>
      Join with a code
    </Text>
  );
}

function FamilyBody({ sum, onSheet }: { sum: FamilySummary; onSheet: (s: SheetState) => void }) {
  const c = useColors();
  const budgetColor = useBudgetColor();
  const over = sum.spend > sum.income && sum.income > 0;
  const topCats = sum.byCategory.slice(0, 5);
  const maxCat = Math.max(1, ...topCats.map((l) => l.amount));
  const months = sum.emergencyMonths >= 10 ? Math.round(sum.emergencyMonths).toString() : sum.emergencyMonths.toFixed(1).replace(/\.0$/, '');

  const header = (
    <SplitHeader
      leftValue={money(sum.income)}
      leftCaption="family income"
      rightValue={money(sum.spend)}
      rightCaption="family spend"
      fraction={sum.income > 0 ? sum.spend / sum.income : 0}
      over={over}
    />
  );

  const members = (
    <View style={{ gap: 10 }}>
      <SectionTitle title={sum.demo ? 'Members · demo' : 'Members'} action="Manage" onAction={() => openSettings('family')} />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
          {sum.members.map((m) => (
            <Pressable key={m.id} onPress={() => openSettings('family')} accessibilityRole="button" accessibilityLabel={`${m.name}, ${m.relation}`}
              style={({ pressed }) => [{ alignItems: 'center', gap: 4, width: 72 }, pressed && { opacity: 0.7 }]}>
              <PersonAvatar name={m.name} size={44} />
              <T size={13} weight="600" numberOfLines={1}>{m.isMe ? 'You' : m.name.split(' ')[0]}</T>
              <T size={11} muted numberOfLines={1}>{m.share === 'full' ? 'Full' : 'Totals'}</T>
            </Pressable>
          ))}
        </View>
        <ListRow left={<T muted>Saved this month</T>} right={<T weight="600" color={sum.savings < 0 ? c.bad : c.text}>{`${money(sum.savings)} · ${pct(Math.max(0, sum.savingsRate))}`}</T>} />
        <ListRow left={<T muted>Emergency fund</T>} right={<T weight="600">{sum.fixedCosts > 0 ? `${months} months` : money(sum.emergencyFund)}</T>} />
      </Card>
    </View>
  );

  const categories = (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Family spending" action="Set budget" onAction={() => onSheet({ kind: 'budget', category: topCats[0]?.category ?? 'food' })} />
      <Card>
        {topCats.length ? topCats.map((l) => {
          const cat = category(l.category);
          const used = l.budget > 0 ? l.amount / l.budget : 0;
          const isOver = l.budget > 0 && l.amount > l.budget;
          return (
            <Pressable key={l.category} onPress={() => onSheet({ kind: 'budget', category: l.category })} accessibilityRole="button"
              accessibilityLabel={`${cat.label} family budget`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
              <T numberOfLines={1} style={{ width: 120 }}>{cat.emoji} {cat.label}</T>
              <ThinBar fraction={l.budget > 0 ? used : l.amount / maxCat} color={l.budget > 0 ? budgetColor(used, isOver, !!cat.fixed) : c.accent} />
              <T weight="600" color={isOver ? c.bad : c.text} style={{ minWidth: 72, textAlign: 'right' }}>{money(l.amount)}</T>
            </Pressable>
          );
        }) : <T size={13} muted>No spending yet this month.</T>}
      </Card>
    </View>
  );

  const goals = (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Shared goals" action="＋ New" onAction={() => onSheet({ kind: 'goal' })} />
      <Card>
        {sum.sharedGoals.length ? sum.sharedGoals.map((g) => (
          <Pressable key={g.id} onPress={() => onSheet({ kind: 'contribute', goal: g })} accessibilityRole="button" accessibilityLabel={`${g.name}, add money`}
            style={({ pressed }) => [{ gap: 6, paddingVertical: 4 }, pressed && { opacity: 0.7 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 16 }}>{g.emoji}</Text>
              <T style={{ flex: 1 }} numberOfLines={1}>{g.name}</T>
              <T size={13} muted>{money(g.saved)} / {money(g.target)}</T>
            </View>
            <ThinBar fraction={g.target > 0 ? g.saved / g.target : 0} color={c.good} />
            {g.contributions.length ? (
              <T size={12} muted numberOfLines={1}>{g.contributions.map((x) => `${x.name} ${moneyShort(x.amount)}`).join(' · ')}</T>
            ) : null}
          </Pressable>
        )) : <T size={13} muted>No shared goals yet.</T>}
      </Card>
    </View>
  );

  const duplicates = sum.duplicates.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Duplicates across family" />
      <Card>
        {sum.duplicates.slice(0, 5).map((d) => (
          <ListRow
            key={d.key}
            left={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MerchantLogo name={d.name} size={32} />
                <View style={{ flex: 1 }}>
                  <T weight="600" numberOfLines={1}>{d.name}</T>
                  <T size={12} muted numberOfLines={1}>{`${d.members.length} plans · ${d.members.map((m) => m.name).join(', ')}`}</T>
                </View>
              </View>
            }
            right={d.saving > 0 ? <T size={13} weight="600" color={c.good}>{`Save ${money(d.saving)}/mo`}</T> : undefined}
          />
        ))}
        <T size={12} muted>Share one plan.</T>
      </Card>
    </View>
  ) : null;

  const invite = <PrimaryButton label="Invite" icon="person-add-outline" onPress={() => onSheet({ kind: 'invite' })} />;

  return (
    <Screen>
      <Columns
        left={<>{header}{members}{categories}</>}
        right={<>{goals}{duplicates}{invite}</>}
      />
      <Footer />
    </Screen>
  );
}

// ---------------------------------------------------------------- sheets

function useInputStyle() {
  const c = useColors();
  return { color: c.text, fontSize: 16, backgroundColor: c.muted + '88', borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, minHeight: 48 };
}

const NO_BUDGETS: Partial<Record<CategoryId, number>> = {};

function FamilySheets({ sheet, onClose, budgets = NO_BUDGETS }: { sheet: SheetState; onClose: () => void; budgets?: Partial<Record<CategoryId, number>> }) {
  return (
    <>
      <InviteSheet visible={sheet?.kind === 'invite'} onClose={onClose} />
      <JoinSheet visible={sheet?.kind === 'join'} onClose={onClose} />
      <BudgetSheet key={sheet?.kind === 'budget' ? `open-${sheet.category}` : 'closed'} visible={sheet?.kind === 'budget'} initial={sheet?.kind === 'budget' ? sheet.category : 'food'} budgets={budgets} onClose={onClose} />
      <GoalSheet visible={sheet?.kind === 'goal'} onClose={onClose} />
      <ContributeSheet goal={sheet?.kind === 'contribute' ? sheet.goal : null} onClose={onClose} />
    </>
  );
}

function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setNote('');
    void createHousehold().then((r) => {
      if (!live) return;
      setCode(r.code);
      setNote(r.message);
    }).catch(() => {
      if (live) setNote('Could not create a code');
    });
    return () => {
      live = false;
    };
  }, [visible]);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      showSnack('Code copied');
    } catch {
      showSnack('Could not copy', undefined, false);
    }
  };
  const share = async () => {
    try {
      await Share.share({ message: `Join my family on Bachat with this code:\n${code}` });
    } catch {
      await copy();
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Invite family">
      <Text selectable style={{ color: c.text, fontSize: 15, fontWeight: '600', letterSpacing: 0.5, lineHeight: 22, textAlign: 'center' }}>
        {code || '…'}
      </Text>
      <T size={12} muted center>{note || 'Anyone with this code can join.'}</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GhostButton label="Copy" icon="copy-outline" onPress={() => void copy()} style={{ flex: 1 }} />
        <PrimaryButton label="Share" icon="share-outline" onPress={() => void share()} style={{ flex: 1 }} disabled={!code} />
      </View>
    </Sheet>
  );
}

function JoinSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const input = useInputStyle();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await joinHousehold(code);
      if (!r.ok) setError(r.message);
      else {
        setCode('');
        onClose();
        showSnack(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Join family">
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.slice(0, 120))}
        placeholder="BACHAT-XXXX-XXXX-…"
        placeholderTextColor={c.textFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        multiline
        accessibilityLabel="Invite code"
        style={[input, { paddingVertical: 12 }]}
      />
      {error ? <T size={13} color={c.bad}>{error}</T> : null}
      <PrimaryButton label={busy ? 'Joining…' : 'Join'} onPress={() => void join()} disabled={!code.trim() || busy} />
    </Sheet>
  );
}

function BudgetSheet({ visible, initial, budgets, onClose }: {
  visible: boolean; initial: CategoryId; budgets: Partial<Record<CategoryId, number>>; onClose: () => void;
}) {
  const c = useColors();
  const input = useInputStyle();
  const [cat, setCat] = useState<CategoryId>(initial);
  const current = budgets[cat] ?? 0;
  const [amount, setAmount] = useState(current ? String(current) : '');

  const pick = (v: CategoryId) => {
    setCat(v);
    const b = budgets[v] ?? 0;
    setAmount(b ? String(b) : '');
  };
  const save = (v: number) => {
    const before = current;
    setFamilyBudget(cat, v);
    onClose();
    showSnack(v > 0 ? `${category(cat).label} family budget set` : 'Family budget cleared', () => setFamilyBudget(cat, before));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Family budget">
      <Card padded={false}>
        <Select label="Category" value={cat} options={CATEGORY_OPTIONS} onChange={pick} />
      </Card>
      <TextInput
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/[^\d]/g, '').slice(0, 9))}
        placeholder="Monthly amount in ₹"
        placeholderTextColor={c.textFaint}
        keyboardType="number-pad"
        accessibilityLabel="Monthly family budget"
        style={input}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GhostButton label="Clear" onPress={() => save(0)} style={{ flex: 1 }} />
        <PrimaryButton label="Save" onPress={() => save(Number(amount) || 0)} style={{ flex: 1 }} disabled={!(Number(amount) > 0)} />
      </View>
    </Sheet>
  );
}

function GoalSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const input = useInputStyle();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const ok = !!name.trim() && Number(amount) > 0;

  const save = () => {
    if (!ok) return;
    const id = addSharedGoal(name, Number(amount));
    setName('');
    setAmount('');
    onClose();
    showSnack('Shared goal added', () => removeSharedGoal(id));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Shared goal">
      <TextInput value={name} onChangeText={(t) => setName(t.slice(0, 40))} placeholder="Name (e.g. Goa trip)" placeholderTextColor={c.textFaint}
        accessibilityLabel="Goal name" style={input} />
      <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d]/g, '').slice(0, 10))} placeholder="Target in ₹"
        placeholderTextColor={c.textFaint} keyboardType="number-pad" accessibilityLabel="Goal target" style={input} />
      <PrimaryButton label="Add goal" onPress={save} disabled={!ok} />
    </Sheet>
  );
}

function ContributeSheet({ goal, onClose }: { goal: FamilyGoalView | null; onClose: () => void }) {
  const c = useColors();
  const input = useInputStyle();
  const [amount, setAmount] = useState('');
  const v = Number(amount) || 0;

  const change = (sign: 1 | -1) => {
    if (!goal || v <= 0) return;
    const prev = contributeToSharedGoal(goal.id, sign * v);
    setAmount('');
    onClose();
    showSnack(sign > 0 ? `Added ${money(v)}` : `Took out ${money(Math.min(v, prev))}`, () => setSharedGoalContribution(goal.id, prev));
  };
  const remove = () => {
    if (!goal) return;
    removeSharedGoal(goal.id);
    onClose();
    showSnack('Shared goal removed');
  };

  return (
    <Sheet visible={!!goal} onClose={onClose} title={goal ? `${goal.emoji} ${goal.name}` : ''}>
      <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d]/g, '').slice(0, 9))} placeholder="Your amount in ₹"
        placeholderTextColor={c.textFaint} keyboardType="number-pad" accessibilityLabel="Your contribution" style={input} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GhostButton label="Take out" icon="remove" onPress={() => change(-1)} style={{ flex: 1 }} />
        <PrimaryButton label="Add" icon="add" onPress={() => change(1)} style={{ flex: 1 }} disabled={!(v > 0)} />
      </View>
      <Text onPress={remove} accessibilityRole="button" suppressHighlighting style={{ color: c.bad, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 8 }}>
        Remove goal
      </Text>
    </Sheet>
  );
}
