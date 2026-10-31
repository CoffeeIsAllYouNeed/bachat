import React from 'react';
import { Platform, View } from 'react-native';
import { useStore } from '@/data/store';
import { aiMode } from '@/services/gemini';
import { storageEncrypted } from '@/services/secureStorage';
import { appLockAvailable, confirmIdentity } from '@/shell/AppLock';
import { SettingsGroup, SettingsNote, SettingsRow, SwitchRow } from '@/ui/settings';
import { showSnack } from '@/ui/Snackbar';
import type { SettingsNav } from './common';

const AI_ROUTE = aiMode === 'proxy' ? 'Private proxy' : aiMode === 'direct' ? 'Direct (dev)' : 'Off';

/** Privacy: what stays on the device, encryption, app lock and where to look for AI details. */
export function PrivacyPage({ nav }: { nav: SettingsNav }) {
  const appLock = useStore((s) => !!s.settings.appLock);

  const toggleLock = async (on: boolean) => {
    if (on && !(await appLockAvailable())) {
      showSnack('Set a screen lock on your phone first');
      return;
    }
    if (!(await confirmIdentity(on ? 'Turn on app lock' : 'Turn off app lock'))) return;
    useStore.getState().setSettings({ appLock: on });
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Storage">
        <SettingsRow icon="phone-portrait-outline" label="Where your data lives" value="On-device" chevron={false} />
        <SettingsRow icon="shield-checkmark-outline" label="Encryption" value={storageEncrypted ? 'On' : 'Off on web'} chevron={false} />
        <SettingsRow icon="cloud-offline-outline" label="Bachat servers" value="None" chevron={false} />
        <SettingsRow icon="eye-off-outline" label="Ads & tracking" value="None" chevron={false} />
      </SettingsGroup>
      {Platform.OS !== 'web' ? (
        <SettingsGroup title="Security">
          <SwitchRow icon="finger-print-outline" label="App lock" sub="Fingerprint, face or phone PIN" value={appLock} onChange={(v) => void toggleLock(v)} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="AI">
        <SettingsRow icon="sparkles-outline" label="What's sent to Gemini" onPress={() => nav.push('gemini')} />
        <SettingsRow icon="git-network-outline" label="Connection" value={AI_ROUTE} chevron={false} />
        <SettingsRow icon="card-outline" label="Card, UPI & phone numbers" value="Masked" chevron={false} />
      </SettingsGroup>
      <SettingsGroup title="Your data">
        <SettingsRow icon="trash-outline" label="Clear all data" onPress={() => nav.push('developer')} danger />
      </SettingsGroup>
      <SettingsNote>
        {storageEncrypted
          ? 'Transactions, rules, goals and settings are saved only on this phone, encrypted with a key kept in its secure storage. Uninstalling the app removes them.'
          : 'Transactions, rules, goals and settings are saved only in this browser. Clearing site data removes them.'}
      </SettingsNote>
    </View>
  );
}
