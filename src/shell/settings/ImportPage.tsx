import React, { useState } from 'react';
import { View } from 'react-native';
import { refreshAll } from '@/shell/actions';
import { ImportBody } from '@/shell/ImportSheet';
import { T } from '@/ui/kit';
import { SettingsGroup, SettingsRow } from '@/ui/settings';

/** Add transactions: Paste SMS / CSV / PDF (ImportBody) + re-check existing rows. */
export function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await refreshAll());
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 22 }}>
      <ImportBody />
      <SettingsGroup title="Already added" footer="Re-runs cleaning (transfers, card bills, refunds) and asks the AI about rows still waiting for review.">
        <SettingsRow icon="refresh" label={busy ? 'Refreshing…' : 'Refresh'} onPress={() => void refresh()} chevron={false} />
      </SettingsGroup>
      {msg ? <T size={13} muted center>{msg}</T> : null}
    </View>
  );
}
