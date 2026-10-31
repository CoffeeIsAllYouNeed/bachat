import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { todayISO } from '@/data/store';
import { exportReportPdf } from '@/engine/report';
import { pickAndImportCsv, pickAndImportPdf } from '@/services/ingest';
import { monthYear, ym } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { T } from '@/ui/kit';
import { SettingsGroup, SettingsRow } from '@/ui/settings';
import type { SettingsNav } from './common';

/** Import & export: paste SMS, upload CSV / PDF statements, export this month's review as a PDF. */
export function ExportPage({ nav }: { nav: SettingsNav }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const month = ym(todayISO());

  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch {
      setMsg('That did not work — nothing was changed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 22 }}>
      <SettingsGroup title="Import" footer="Statements are read on this device. Only unknown merchant names (or one PDF) go to the AI for labelling.">
        <SettingsRow icon="chatbox-ellipses-outline" label="Paste bank SMS" onPress={() => nav.push('import')} />
        <SettingsRow icon="document-text-outline" label="Upload CSV statement" chevron={false} onPress={() => void run(async () => (await pickAndImportCsv()).message)} />
        <SettingsRow icon="document-outline" label="Upload PDF statement" chevron={false} onPress={() => void run(async () => (await pickAndImportPdf()).message)} />
      </SettingsGroup>

      <SettingsGroup title="Export">
        <SettingsRow icon="share-outline" label="Monthly review (PDF)" value={monthYear(month)} chevron={false} onPress={() => void run(() => exportReportPdf(month))} />
        <SettingsRow icon="calendar-outline" label="Another month" onPress={() => nav.push('review')} />
      </SettingsGroup>

      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {msg ? <T size={13} muted center>{msg}</T> : null}
    </View>
  );
}
