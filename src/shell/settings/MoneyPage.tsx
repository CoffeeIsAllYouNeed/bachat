import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/store';
import { PrimaryButton, T } from '@/ui/kit';
import { FieldRow, Select, SettingsGroup, SettingsRow, SwitchRow } from '@/ui/settings';
import type { SettingsNav } from './common';

const TARGETS = [3, 4, 6, 9, 12].map((m) => ({ value: m, label: `${m} months` }));

function toStr(n: number): string {
  return n > 0 ? String(Math.round(n)) : '';
}

function toNum(s: string): number {
  const v = Number(s.replace(/[^\d.]/g, ''));
  return isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/** Your money: income, irregular, rent, EMIs, other fixed, emergency fund, target; Save; "Version history ›". */
export function MoneyPage({ nav }: { nav: SettingsNav }) {
  const profile = useStore((s) => s.profile);
  const saveProfile = useStore((s) => s.saveProfile);
  const [income, setIncome] = useState(() => toStr(profile.monthlyIncome));
  const [irregular, setIrregular] = useState(profile.irregularIncome);
  const [rent, setRent] = useState(() => toStr(profile.rent));
  const [emis, setEmis] = useState(() => toStr(profile.emis));
  const [other, setOther] = useState(() => toStr(profile.otherFixed));
  const [fund, setFund] = useState(() => toStr(profile.emergencyFund));
  const [months, setMonths] = useState(() => (TARGETS.some((t) => t.value === profile.emergencyMonths) ? profile.emergencyMonths : 6));
  const [saved, setSaved] = useState(false);

  const dirty =
    toNum(income) !== profile.monthlyIncome || irregular !== profile.irregularIncome || toNum(rent) !== profile.rent ||
    toNum(emis) !== profile.emis || toNum(other) !== profile.otherFixed || toNum(fund) !== profile.emergencyFund ||
    months !== profile.emergencyMonths;

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v.replace(/[^\d]/g, ''));
    setSaved(false);
  };

  const save = () => {
    saveProfile({
      monthlyIncome: toNum(income),
      irregularIncome: irregular,
      rent: toNum(rent),
      emis: toNum(emis),
      otherFixed: toNum(other),
      emergencyFund: toNum(fund),
      emergencyMonths: months,
      onboarded: true,
    });
    setSaved(true);
  };

  const versions = profile.history.length;

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Income">
        <FieldRow icon="wallet-outline" label="Income" value={income} onChange={edit(setIncome)} placeholder="₹ per month" keyboardType="number-pad" prefix="₹" />
        <SwitchRow icon="pulse-outline" label="Irregular income" sub="Freelance, commission or gig" value={irregular} onChange={(v) => { setIrregular(v); setSaved(false); }} />
      </SettingsGroup>

      <SettingsGroup title="Fixed costs (per month)">
        <FieldRow icon="business-outline" label="Rent" value={rent} onChange={edit(setRent)} placeholder="0" keyboardType="number-pad" prefix="₹" />
        <FieldRow icon="card-outline" label="EMIs" value={emis} onChange={edit(setEmis)} placeholder="0" keyboardType="number-pad" prefix="₹" />
        <FieldRow icon="receipt-outline" label="Other fixed" value={other} onChange={edit(setOther)} placeholder="0" keyboardType="number-pad" prefix="₹" />
      </SettingsGroup>

      <SettingsGroup title="Safety net">
        <FieldRow icon="shield-checkmark-outline" label="Emergency fund" value={fund} onChange={edit(setFund)} placeholder="0" keyboardType="number-pad" prefix="₹" />
        <Select<number> icon="flag-outline" label="Target" value={months} options={TARGETS} onChange={(v) => { setMonths(v); setSaved(false); }} />
      </SettingsGroup>

      <PrimaryButton label={saved && !dirty ? 'Saved' : 'Save'} icon={saved && !dirty ? 'checkmark' : undefined} onPress={save} disabled={!dirty} />

      <SettingsGroup>
        <SettingsRow icon="time-outline" label="Version history" value={versions ? `${versions} saved` : 'None yet'} onPress={() => nav.push('history')} />
      </SettingsGroup>
      <T size={12} faint>Every save is kept as a new version; older ones are never overwritten.</T>
    </View>
  );
}
