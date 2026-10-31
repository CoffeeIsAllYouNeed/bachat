import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { todayISO, uid, useStore } from '@/data/store';
import { inferProfile } from '@/engine/profile';
import { loadDemo } from '@/services/ingest';
import { Logo } from '@/shell/Logo';
import { SmsReadFlow } from '@/shell/SmsRead';
import { money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { Card, Footer, GhostButton, PrimaryButton, Segmented, T, ThinBar } from '@/ui/kit';

/*
 * First run: one question per screen (name + optional email, "Let Bachat read your bank SMS", income, irregular?, rent, EMIs, other
 * fixed bills, emergency fund), an optional first goal, then Start.
 * Prefilled from the transactions when there are any.
 */

const GOAL_EMOJIS = ['🛟', '✈️', '💻', '🏍️', '🎓', '💍', '🏠', '🎁'];
const MONTH_CHOICES = [3, 6, 9, 12];

function toNum(s: string): number {
  const n = Number(s.replace(/[^\d.]/g, ''));
  return isFinite(n) ? Math.round(n) : 0;
}

function toStr(n: number | undefined): string {
  return n && n > 0 ? String(Math.round(n)) : '';
}

function MoneyInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.muted + '88', borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16, minHeight: 60 }}>
      <Text style={{ color: c.textMuted, fontSize: 26, fontWeight: '700', marginRight: 6 }}>₹</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^\d]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        placeholder="0"
        placeholderTextColor={c.textFaint}
        accessibilityLabel={label}
        autoFocus={autoFocus}
        style={{ flex: 1, color: c.text, fontSize: 26, fontWeight: '700', paddingVertical: 10 }}
      />
      {value ? <T size={13} faint>{money(toNum(value))}</T> : null}
    </View>
  );
}

function TextField({ value, onChange, placeholder, label, keyboardType, autoCapitalize, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  autoFocus?: boolean;
}) {
  const c = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.textFaint}
      accessibilityLabel={label}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={keyboardType === 'email-address' ? false : undefined}
      autoFocus={autoFocus}
      style={{ color: c.text, fontSize: 16, backgroundColor: c.muted, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, minHeight: 48 }}
    />
  );
}

/** Full-screen first-run questions; saves the profile (onboarded: true) and an optional first goal. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const txns = useStore((s) => s.txns);
  const profile = useStore((s) => s.profile);
  // Prefill is best-effort: a failure here must never block first run.
  const inferred = useMemo(() => {
    if (!txns.length) return null;
    try {
      return inferProfile(txns, todayISO());
    } catch {
      return null;
    }
  }, [txns]);

  const info = useStore((s) => s.profileInfo);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(info.name);
  const [email, setEmail] = useState(info.email);
  const [income, setIncome] = useState(() => toStr(profile.monthlyIncome || inferred?.monthlyIncome));
  const [irregular, setIrregular] = useState<'yes' | 'no'>(() => ((profile.onboarded ? profile.irregularIncome : inferred?.irregularIncome) ? 'yes' : 'no'));
  const [rent, setRent] = useState(() => toStr(profile.rent || inferred?.rent));
  const [emis, setEmis] = useState(() => toStr(profile.emis || inferred?.emis));
  const [other, setOther] = useState(() => toStr(profile.otherFixed || inferred?.otherFixed));
  const [fund, setFund] = useState(() => toStr(profile.emergencyFund));
  const [months, setMonths] = useState(() => (MONTH_CHOICES.includes(profile.emergencyMonths) ? profile.emergencyMonths : 6));
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalEmoji, setGoalEmoji] = useState(GOAL_EMOJIS[1]);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  const fromData = inferred && inferred.monthlyIncome > 0 ? 'Filled in from your transactions. Change it if it looks off.' : null;
  const essentials = toNum(rent) + toNum(emis) + toNum(other);

  /** After reading bank SMS: fill the money questions from the new transactions (only fields still empty). */
  const prefillFromData = () => {
    try {
      const all = useStore.getState().txns;
      if (!all.length) return;
      const p = inferProfile(all, todayISO());
      if (!toNum(income) && p.monthlyIncome > 0) setIncome(toStr(p.monthlyIncome));
      if (!toNum(rent) && p.rent > 0) setRent(toStr(p.rent));
      if (!toNum(emis) && p.emis > 0) setEmis(toStr(p.emis));
      if (!toNum(other) && p.otherFixed > 0) setOther(toStr(p.otherFixed));
      if (p.irregularIncome) setIrregular('yes');
    } catch {
      // keep the empty fields
    }
  };

  const steps: { title: string; help: string; body: React.ReactNode; custom?: boolean }[] = [
    {
      title: 'What should we call you?',
      help: 'Your first name is enough. Email is optional; both stay on this device.',
      body: (
        <View style={{ gap: 12 }}>
          <TextField value={name} onChange={setName} placeholder="Your name" label="Your name" autoCapitalize="words" autoFocus={Platform.OS === 'web'} />
          <TextField value={email} onChange={setEmail} placeholder="Email (optional)" label="Email (optional)" keyboardType="email-address" autoCapitalize="none" />
        </View>
      ),
    },
    {
      title: 'Let Bachat read your bank SMS',
      help: '',
      custom: true,
      body: (
        <SmsReadFlow
          onSkip={() => setStep((s) => s + 1)}
          onFinished={(r) => {
            if (r && r.added) prefillFromData();
            setStep((s) => s + 1);
          }}
        />
      ),
    },
    {
      title: 'How much comes in each month?',
      help: fromData ?? 'Take-home pay after tax. A rough number is fine; you can change it any time.',
      body: <MoneyInput value={income} onChange={setIncome} label="Monthly income" />,
    },
    {
      title: 'Does it change month to month?',
      help: 'Freelance, commission or gig income usually does. Bachat then plans around a careful month.',
      body: <Segmented options={[{ value: 'no', label: 'Mostly the same' }, { value: 'yes', label: 'It varies' }]} value={irregular} onChange={setIrregular} />,
    },
    {
      title: "What's your monthly rent?",
      help: "Leave it at 0 if you don't pay rent.",
      body: <MoneyInput value={rent} onChange={setRent} label="Monthly rent" />,
    },
    {
      title: 'Any loan EMIs?',
      help: 'All of them together: home, car, phone, education, buy-now-pay-later.',
      body: <MoneyInput value={emis} onChange={setEmis} label="Monthly EMIs" />,
    },
    {
      title: 'Other fixed bills each month?',
      help: 'Phone, internet, electricity, subscriptions, insurance: things that arrive every month.',
      body: <MoneyInput value={other} onChange={setOther} label="Other fixed bills" />,
    },
    {
      title: 'Your emergency fund',
      help: 'Money set aside only for surprises (job loss, hospital, repairs). Most people aim for 3 to 6 months of expenses.',
      body: (
        <View style={{ gap: 12 }}>
          <T size={13} muted>How much do you have set aside today?</T>
          <MoneyInput value={fund} onChange={setFund} label="Emergency fund today" />
          <T size={13} muted>How many months of expenses should it cover?</T>
          <Segmented options={MONTH_CHOICES.map((m) => ({ value: String(m), label: `${m} mo` }))} value={String(months)} onChange={(v) => setMonths(Number(v))} />
          {essentials > 0 ? <T size={12} faint>{`Your fixed costs alone are ${money(essentials)} a month, so ${months} months of fixed costs is ${money(essentials * months)} (flexible spending adds to the target).`}</T> : null}
        </View>
      ),
    },
    {
      title: 'A first goal? (optional)',
      help: 'Something you are saving for. Bachat shows when you will get there. Skip it if you like.',
      body: (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {GOAL_EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => setGoalEmoji(e)} accessibilityRole="button" accessibilityLabel={`Icon ${e}`} accessibilityState={{ selected: goalEmoji === e }}
                style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: c.muted, borderWidth: goalEmoji === e ? 2 : 1, borderColor: goalEmoji === e ? c.accent : c.border }}>
                <Text style={{ fontSize: 20 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <TextField value={goalName} onChange={setGoalName} placeholder="e.g. Goa trip, new laptop" label="Goal name" />
          <MoneyInput value={goalTarget} onChange={setGoalTarget} label="Goal amount" />
        </View>
      ),
    },
  ];
  const last = step === steps.length - 1;
  const cur = steps[step];

  const saveInfo = () => {
    // Always save once so "Member since" gets a date, even without a name.
    useStore.getState().setProfileInfo({ name: name.trim(), email: email.trim() });
  };

  const finish = () => {
    const st = useStore.getState();
    saveInfo();
    st.saveProfile({
      monthlyIncome: toNum(income),
      irregularIncome: irregular === 'yes',
      rent: toNum(rent),
      emis: toNum(emis),
      otherFixed: toNum(other),
      emergencyFund: toNum(fund),
      emergencyMonths: months,
      onboarded: true,
    });
    const target = toNum(goalTarget);
    if (goalName.trim() && target > 0) {
      st.upsertGoal({
        id: uid('g_'), name: goalName.trim(), emoji: goalEmoji, target, priority: 1, archived: false,
        createdAt: todayISO(), contributions: [],
      });
    }
    onDone();
  };

  const tryDemo = async () => {
    setDemoBusy(true);
    setDemoNote(null);
    try {
      await loadDemo();
      // A name typed here wins over the demo profile (Vrushal More); otherwise the demo's stays.
      if (name.trim()) useStore.getState().setProfileInfo({ name: name.trim(), email: email.trim(), city: '' });
      const p = useStore.getState().profile;
      if (!p.onboarded) useStore.getState().saveProfile({ ...p, onboarded: true });
      onDone();
    } catch {
      setDemoNote("Couldn't load the demo. Try again, or answer the questions.");
      setDemoBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.page }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 520, paddingHorizontal: 16, gap: 18, flexGrow: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Logo size={36} />
            <T size={20} weight="700" style={{ flex: 1 }}>Bachat</T>
            <T size={12} faint>{`${step + 1} of ${steps.length}`}</T>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <ThinBar fraction={(step + 1) / steps.length} color={c.accent} height={4} />
          </View>

          {step === 0 ? (
            <View style={{ gap: 6 }}>
              <T size={26} weight="700">Let's set up your plan</T>
              <T muted>A few quick questions. Everything stays on this phone, and Bachat never tells you what to invest in.</T>
            </View>
          ) : null}

          {cur.custom ? (
            // Steps with their own buttons (Read bank SMS: Allow / Not now → progress → Continue).
            <>
              {cur.body}
              <GhostButton label="Back" icon="chevron-back" onPress={() => setStep(step - 1)} style={{ alignSelf: 'flex-start' }} />
            </>
          ) : (
            <>
              <Card style={{ gap: 14 }}>
                <T size={20} weight="700">{cur.title}</T>
                <T size={14} muted>{cur.help}</T>
                {cur.body}
              </Card>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                {step > 0 ? <GhostButton label="Back" icon="chevron-back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
                {last ? (
                  <PrimaryButton label={goalName.trim() && toNum(goalTarget) > 0 ? 'Start' : 'Skip goal & start'} icon="checkmark" onPress={finish} style={{ flex: 2 }} />
                ) : (
                  <PrimaryButton label="Next" icon="chevron-forward" onPress={() => setStep(step + 1)} style={{ flex: 2 }} />
                )}
              </View>
            </>
          )}

          {step === 0 ? (
            <Card style={{ gap: 10 }}>
              <T weight="700">Just looking around?</T>
              <T size={13} muted>Load 3 months of sample transactions, budgets and goals. You can clear it later in Settings.</T>
              <GhostButton label={demoBusy ? 'Loading the demo…' : 'Try with demo data'} icon="sparkles-outline" onPress={() => { if (!demoBusy) void tryDemo(); }} />
              {demoNote ? <T size={12} color={c.bad}>{demoNote}</T> : null}
            </Card>
          ) : null}

          <View style={{ flex: 1 }} />
          <Footer />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
