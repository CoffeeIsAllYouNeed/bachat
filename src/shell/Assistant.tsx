import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputInstance,
} from 'react-native';
import { SECTION_BY_ID } from '@/data/categories';
import { useAssistant, type AgentAnswer } from '@/services/assistant';
import { transcribeAudio } from '@/services/gemini';
import { Logo, LOGO_GOLD, LOGO_INK } from '@/shell/Logo';
import { useColors, useWide } from '@/theme/theme';
import { IconButton } from '@/ui/kit';

/*
 * The only chat UI in the app: a floating Bachat button → Speak / Type.
 * The chat box shows ONLY the latest exchange; the real answer is pinned at the
 * top of the page it opens (AnswerPanel). Never a scrolling history.
 */

const EXAMPLES = [
  'Where can I save money?',
  'Can I afford a ₹30,000 trip in March?',
  'What if rent goes up ₹5,000?',
  'Am I over budget?',
  'Netflix',
  "What's my net worth?",
  'How much did I earn this year?',
  'Monthly review',
];

const HEARD_FAIL = "Couldn't hear that — try typing";

/** Floating assistant button with Speak / Type menu, voice recording and the docked chat box. */
export function Assistant() {
  const c = useColors();
  const wide = useWide();
  const [menu, setMenu] = useState(false);
  const [chat, setChat] = useState(false);
  const [input, setInput] = useState('');
  const [lastUser, setLastUser] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // RN 0.88 strict types: TextInput is a value; its ref type is TextInputInstance.
  const inputRef = useRef<TextInputInstance>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);

  const busy = useAssistant((s) => s.busy);
  const answer = useAssistant((s) => s.answer);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setLastUser(text);
    setNote(null);
    setInput('');
    setChat(true);
    setMenu(false);
    useAssistant.getState().run(text).catch(() => setNote('Something went wrong — try again'));
  };

  const startRecording = async () => {
    setMenu(false);
    setNote(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setChat(true);
        setNote('Microphone is off for Bachat — allow it in settings, or type instead');
        return;
      }
      if (Platform.OS !== 'web') await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setChat(true);
      setNote("Couldn't start the microphone — try typing");
    }
  };

  const stopRecording = async () => {
    setRecording(false);
    setTranscribing(true);
    setChat(true);
    try {
      await recorder.stop();
      if (Platform.OS !== 'web') setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      const uri = recorder.uri ?? recState.url ?? null;
      if (!uri) throw new Error('no recording');
      const audio = await readRecording(uri);
      const text = await transcribeAudio(audio);
      setTranscribing(false);
      if (!text || !text.trim()) {
        setNote(HEARD_FAIL);
        setTimeout(() => inputRef.current?.focus(), 100);
        return;
      }
      send(text);
    } catch {
      setTranscribing(false);
      setNote(HEARD_FAIL);
    }
  };

  const closeChat = () => {
    setChat(false);
    setNote(null);
  };

  const reply = replyLine(busy, answer, lastUser);
  const seconds = Math.floor((recState.durationMillis || 0) / 1000);

  return (
    <>
      {/* recording pill */}
      {recording ? (
        <View pointerEvents="box-none" style={[styles.recWrap, { bottom: chat ? 200 : 92 }]}>
          <View style={[styles.recPill, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.bad }} />
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] }}>
              Listening… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </Text>
            <Pressable onPress={stopRecording} accessibilityRole="button" accessibilityLabel="Stop recording"
              style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: c.accent, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="stop" size={14} color={c.onAccent} />
              <Text style={{ color: c.onAccent, fontWeight: '700' }}>Stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* menu */}
      {menu && !chat ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} accessibilityLabel="Close menu" />
          <View style={[styles.menu, { backgroundColor: c.card, borderColor: c.border }]}>
            <MenuItem icon="mic-outline" label="Speak" onPress={startRecording} />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
            <MenuItem icon="create-outline" label="Type" onPress={() => { setMenu(false); setChat(true); setTimeout(() => inputRef.current?.focus(), 150); }} />
          </View>
        </>
      ) : null}

      {/* floating button */}
      {!chat ? (
        <Pressable
          onPress={() => (recording ? stopRecording() : setMenu(!menu))}
          accessibilityRole="button"
          accessibilityLabel={menu ? 'Close assistant menu' : 'Ask Bachat'}
          style={({ pressed }) => [styles.fab, { backgroundColor: LOGO_GOLD, shadowColor: c.scrim }, pressed && { opacity: 0.9 }]}
        >
          {menu ? <Ionicons name="close" size={26} color={LOGO_INK} /> : <Logo size={56} round />}
        </Pressable>
      ) : null}

      {/* docked chat box */}
      {chat ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'web' ? undefined : 'padding'}
          pointerEvents="box-none"
          style={[styles.chatDock, wide ? { alignItems: 'center', paddingHorizontal: 24, bottom: 16 } : { paddingHorizontal: 12, bottom: 12 }]}
        >
          <View style={[styles.chat, { backgroundColor: c.card, borderColor: c.border, maxWidth: wide ? 720 : undefined, shadowColor: c.scrim }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '700' }}>Ask Bachat</Text>
              <IconButton name="close" label="Close chat" onPress={closeChat} />
            </View>

            {lastUser ? (
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ backgroundColor: c.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '85%' }}>
                  <Text style={{ color: c.onAccent, fontSize: 14, fontWeight: '600' }}>{lastUser}</Text>
                </View>
              </View>
            ) : null}

            {lastUser || note || transcribing ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Logo size={24} round />
                <Text style={{ flex: 1, color: c.textMuted, fontSize: 14, lineHeight: 20 }}>
                  {transcribing ? 'Listening back…' : note ?? reply}
                </Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                {EXAMPLES.map((e) => (
                  <Pressable key={e} onPress={() => send(e)} accessibilityRole="button"
                    style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.muted + '55', justifyContent: 'center' }}>
                    <Text style={{ color: c.text, fontSize: 13 }}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TextInput
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                placeholder="Ask Bachat or tell it what to do…"
                placeholderTextColor={c.textFaint}
                accessibilityLabel="Ask Bachat"
                style={{ flex: 1, minHeight: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: c.muted + '66', color: c.text, fontSize: 15 }}
              />
              <IconButton
                name={recording ? 'stop-circle' : 'mic-outline'}
                label={recording ? 'Stop recording' : 'Speak'}
                color={recording ? c.bad : c.textMuted}
                onPress={() => (recording ? stopRecording() : startRecording())}
              />
              <Pressable
                onPress={() => send(input)}
                disabled={!input.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [
                  { width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
                  (!input.trim() || busy) && { opacity: 0.45 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Ionicons name="arrow-up" size={20} color={c.onAccent} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 }, pressed && { backgroundColor: c.muted + '66' }]}>
      <Ionicons name={icon} size={20} color={c.accent} />
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** One line from Bachat about where the answer went. */
function replyLine(busy: boolean, answer: AgentAnswer | null, lastUser: string | null): string {
  if (busy) return 'Working on it…';
  if (!answer || !lastUser) return 'Working on it…';
  if (answer.section === 'report') return 'Opened your monthly review.';
  if (answer.section === 'settings') return 'Opened Settings.';
  const where = SECTION_BY_ID.get(answer.section)?.label ?? 'Home';
  if (answer.kind === 'refusal') return `Opened ${where} — I can't pick investments for you; the reason is pinned at the top.`;
  if (answer.kind === 'scenario') return `Opened ${where} — the before and after for "${answer.title}" is pinned at the top.`;
  if (answer.pending?.length) return `Opened ${where} — tap Confirm at the top to apply.`;
  return `Opened ${where} — ${answer.title}: the answer is pinned at the top.`;
}

/** Reads a finished recording as base64 + mime type (native m4a file, or a web blob: URL). */
async function readRecording(uri: string): Promise<{ mimeType: string; data: string }> {
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) {
    const res = await fetch(uri);
    const type = (res.headers.get('content-type') || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const buf = await res.arrayBuffer();
    return { mimeType: type.startsWith('audio/') ? type : 'audio/webm', data: toBase64(new Uint8Array(buf)) };
  }
  const data = await new File(uri).base64();
  return { mimeType: 'audio/mp4', data };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes → base64 (no btoa dependency). */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 16, bottom: 20, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  menu: {
    position: 'absolute', right: 16, bottom: 86, width: 180, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden', elevation: 8,
  },
  recWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  recPill: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, elevation: 8,
  },
  chatDock: { position: 'absolute', left: 0, right: 0 },
  chat: {
    width: '100%', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 14, paddingTop: 6, gap: 10,
    shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
});
