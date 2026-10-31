import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@/data/store';
import type { FamilyShare } from '@/data/types';
import { hideDemoFamily, isDemoFamily, RELATIONS, setMemberRelation, setMyShare, useFamilySummary } from '@/services/family';
import { currentInviteCode, familySyncConfigured, joinHousehold, leaveHousehold, removeMember, syncFamily } from '@/services/familySync';
import { GhostButton, Sheet, T } from '@/ui/kit';
import { FieldRow, Select, SettingsGroup, SettingsNote, SettingsRow } from '@/ui/settings';
import { showSnack } from '@/ui/Snackbar';
import { longDate } from './common';

const SHARE_OPTIONS: { value: FamilyShare; label: string; sub: string }[] = [
  { value: 'totals', label: 'Totals only', sub: 'Monthly totals, goals, subscriptions' },
  { value: 'full', label: 'Totals + transactions', sub: 'Also the last 90 days' },
];

const RELATION_OPTIONS = RELATIONS.map((r) => ({ value: r as string, label: r }));

/** Settings → Family: sync status, what you share, members, join / leave. */
export function FamilyPage() {
  const sum = useFamilySummary();
  const household = useStore((s) => s.family.household);
  const share = useStore((s) => s.family.share);
  const lastSyncAt = useStore((s) => s.family.lastSyncAt);
  const lastSyncError = useStore((s) => s.family.lastSyncError);
  const demo = useStore((s) => isDemoFamily(s));
  const [editing, setEditing] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const others = (sum?.members ?? []).filter((m) => !m.isMe);
  const member = others.find((m) => m.id === editing) ?? null;
  const status = !familySyncConfigured ? 'Sync off' : !household ? 'Not set up' : lastSyncError ? 'Failed' : lastSyncAt ? longDate(lastSyncAt) : 'Not yet';

  const copyCode = async () => {
    const c = currentInviteCode();
    if (!c) return;
    try {
      await Clipboard.setStringAsync(c);
      showSnack('Code copied');
    } catch {
      showSnack('Could not copy', undefined, false);
    }
  };
  const syncNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const msg = await syncFamily();
      if (msg) showSnack(msg, undefined, false);
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    try {
      const r = await joinHousehold(code);
      if (r.ok) setCode('');
      showSnack(r.message, undefined, r.ok);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!member) return;
    setEditing(null);
    if (demo) hideDemoFamily();
    else await removeMember(member.id);
    showSnack(demo ? 'Demo family removed' : `${member.name} removed`);
  };
  const leave = async () => {
    setLeaving(false);
    await leaveHousehold();
    showSnack('You left the family');
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Sync">
        <SettingsRow icon="cloud-outline" label="Family sync" value={busy ? 'Syncing…' : status}
          onPress={familySyncConfigured && household ? () => void syncNow() : undefined} chevron={false} />
        {household ? <SettingsRow icon="key-outline" label="Invite code" value="Copy" onPress={() => void copyCode()} chevron={false} /> : null}
      </SettingsGroup>

      <SettingsGroup title="You share">
        <Select icon="eye-outline" label="What you share" value={share} options={SHARE_OPTIONS} onChange={setMyShare} />
      </SettingsGroup>

      {others.length ? (
        <SettingsGroup title={demo ? 'Members · demo' : 'Members'}>
          {others.map((m) => (
            <SettingsRow key={m.id} icon="person-outline" label={m.name} value={`${m.relation} · ${m.share === 'full' ? 'Full' : 'Totals'}`} onPress={() => setEditing(m.id)} />
          ))}
        </SettingsGroup>
      ) : null}

      {!household ? (
        <SettingsGroup title="Join">
          <FieldRow icon="enter-outline" label="Code" value={code} onChange={(t) => setCode(t.slice(0, 120))} placeholder="BACHAT-…" autoCapitalize="characters" />
          <SettingsRow icon="people-outline" label={busy ? 'Joining…' : 'Join family'} onPress={code.trim() ? () => void join() : undefined} chevron={false} />
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          <SettingsRow icon="exit-outline" label="Leave family" danger onPress={() => setLeaving(true)} chevron={false} />
        </SettingsGroup>
      )}

      <SettingsNote>Encrypted on your phone. Only family can read it.</SettingsNote>
      {!familySyncConfigured ? (
        <SettingsNote>To sync, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.</SettingsNote>
      ) : null}

      <Sheet visible={!!member} onClose={() => setEditing(null)} title={member?.name ?? ''}>
        {member && !demo ? (
          <SettingsGroup>
            <Select label="Relation" value={member.relation} options={RELATION_OPTIONS} onChange={(v) => setMemberRelation(member.id, v)} />
          </SettingsGroup>
        ) : null}
        <GhostButton label={demo ? 'Remove demo family' : 'Remove from family'} icon="person-remove-outline" danger onPress={() => void remove()} />
      </Sheet>

      <Sheet visible={leaving} onClose={() => setLeaving(false)} title="Leave family?">
        <T size={13} muted>Your shared numbers are deleted. You can join again with a code.</T>
        <GhostButton label="Leave family" icon="exit-outline" danger onPress={() => void leave()} />
      </Sheet>
    </View>
  );
}
