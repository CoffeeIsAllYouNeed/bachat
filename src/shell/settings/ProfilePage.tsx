import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/store';
import { useColors } from '@/theme/theme';
import { PersonAvatar, PrimaryButton, T } from '@/ui/kit';
import { FieldRow, Select, SettingsGroup } from '@/ui/settings';
import { longDate } from './common';

/** Profile: initials, name, email, city, currency, member since; Save. */
export function ProfilePage() {
  const c = useColors();
  const info = useStore((s) => s.profileInfo);
  const setProfileInfo = useStore((s) => s.setProfileInfo);
  const [name, setName] = useState(info.name);
  const [email, setEmail] = useState(info.email);
  const [city, setCity] = useState(info.city);
  const [saved, setSaved] = useState(false);

  const dirty = name !== info.name || email !== info.email || city !== info.city;
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const save = () => {
    if (!emailOk) return;
    setProfileInfo({ name: name.trim(), email: email.trim(), city: city.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <View style={{ gap: 22 }}>
      <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
        <PersonAvatar name={name} size={72} />
        <T size={13} muted>Your initials are your photo for now.</T>
      </View>

      <SettingsGroup title="About you">
        <FieldRow icon="person-outline" label="Name" value={name} onChange={(v) => { setName(v); setSaved(false); }} placeholder="Your name" autoCapitalize="words" />
        <FieldRow icon="mail-outline" label="Email" value={email} onChange={(v) => { setEmail(v); setSaved(false); }} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
        <FieldRow icon="location-outline" label="City" value={city} onChange={(v) => { setCity(v); setSaved(false); }} placeholder="Optional" autoCapitalize="words" />
      </SettingsGroup>
      {!emailOk ? <T size={12} color={c.bad}>That email doesn't look right.</T> : null}

      <SettingsGroup title="Account" footer="Everything stays on this device. Bachat has no account server.">
        <Select icon="cash-outline" label="Currency" value={info.currency} options={[{ value: 'INR', label: '₹ INR' }]} onChange={() => undefined} />
        <FieldRow icon="calendar-outline" label="Member since" value={info.createdAt ? longDate(info.createdAt) : 'Not saved yet'} editable={false} />
      </SettingsGroup>

      <PrimaryButton label={saved ? 'Saved' : 'Save'} icon={saved ? 'checkmark' : undefined} onPress={save} disabled={!dirty || !emailOk} />
    </View>
  );
}
