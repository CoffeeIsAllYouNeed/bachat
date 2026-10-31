import React, { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { DEMO_SMS_SAMPLE } from '@/data/demo';
import { importSmsText, pickAndImportCsv, pickAndImportPdf } from '@/services/ingest';
import { useColors } from '@/theme/theme';
import { Card, GhostButton, PrimaryButton, Sheet, T } from '@/ui/kit';

/** "Add transactions" content: Paste SMS / Upload CSV / Upload PDF (used by the sheet and Settings → Add transactions). */
export function ImportBody() {
  const c = useColors();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ message: string }>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.message);
    } catch {
      setMsg('Import failed — nothing was changed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <T size={13} muted>Everything is read on this phone. Only unknown merchant names (or one PDF) go to the AI for labelling.</T>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T weight="700" style={{ flex: 1 }}>Paste bank SMS</T>
          <Pressable onPress={() => setText(DEMO_SMS_SAMPLE)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <T size={13} weight="600" color={c.accent}>Use sample</T>
          </Pressable>
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Paste one or more bank SMS here…"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Bank SMS text"
          style={{
            minHeight: 120, maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: c.border,
            backgroundColor: c.muted, color: c.text, padding: 12, fontSize: 14, textAlignVertical: 'top',
          }}
        />
        <PrimaryButton
          label="Import SMS"
          icon="chatbox-ellipses-outline"
          disabled={busy || !text.trim()}
          onPress={() => run(async () => {
            const r = await importSmsText(text);
            if (r.added) setText('');
            return r;
          })}
        />
      </Card>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <GhostButton label="Upload CSV" icon="document-text-outline" onPress={() => run(pickAndImportCsv)} style={{ flex: 1 }} />
        <GhostButton label="Upload PDF" icon="document-outline" onPress={() => run(pickAndImportPdf)} style={{ flex: 1 }} />
      </View>
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {msg ? <T size={14} center>{msg}</T> : null}
    </View>
  );
}

/** "Add transactions" sheet (Home empty state, openImport()). */
export function ImportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Add transactions">
      <ImportBody />
    </Sheet>
  );
}
