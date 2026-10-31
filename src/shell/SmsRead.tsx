import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useStore } from '@/data/store';
import type { RawTxn } from '@/data/types';
import { nativeSmsReaderAvailable, readBankSms, requestSmsPermission, smsSupported, type SmsReadResult } from '@/services/smsReader';
import { dayMonth, money } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { Card, GhostButton, PrimaryButton, T } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

/*
 * "Let Bachat read your bank SMS": the ask (icon, 3 promises, Allow / Not now),
 * Android's permission dialog, then the "Reading your bank SMS…" progress
 * screen. Used by onboarding (after the name) and Settings → Read bank SMS.
 * Web / iOS: "Available on the Android app".
 */

type Phase = 'ask' | 'reading' | 'done' | 'denied';

const PROMISES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'card-outline', text: 'Only bank and card messages' },
  { icon: 'phone-portrait-outline', text: 'Stays on this phone' },
  { icon: 'key-outline', text: 'OTPs are ignored' },
];

function BigIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const c = useColors();
  return (
    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={30} color={c.accent} />
    </View>
  );
}

function PreviewRow({ r }: { r: RawTxn }) {
  const c = useColors();
  const plus = r.type === 'income' || r.type === 'refund';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <MerchantLogo name={r.merchant} size={30} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14 }} numberOfLines={1}>{r.merchant}</Text>
        <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>{`${dayMonth(r.date)}${r.account ? ` · ${r.account}` : ''}`}</Text>
      </View>
      <Text style={{ color: plus ? c.good : c.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {`${plus ? '+' : ''}${money(r.amount)}`}
      </Text>
    </View>
  );
}

/**
 * The whole flow in one card. [onSkip] shows "Not now" (onboarding);
 * [onFinished] is called with the result (or null when skipped / unavailable).
 */
export function SmsReadFlow({ onSkip, onFinished, continueLabel = 'Continue' }: {
  onSkip?: () => void;
  onFinished?: (r: SmsReadResult | null) => void;
  continueLabel?: string;
}) {
  const c = useColors();
  const allowedBefore = useStore((s) => !!s.settings.smsAllowed);
  const [phase, setPhase] = useState<Phase>('ask');
  const [found, setFound] = useState(0);
  const [preview, setPreview] = useState<RawTxn[]>([]);
  const [result, setResult] = useState<SmsReadResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!smsSupported) {
    return (
      <Card style={{ gap: 14, alignItems: 'center', paddingVertical: 24 }}>
        <BigIcon name="phone-portrait-outline" />
        <T size={20} weight="700" center>Read your bank SMS</T>
        <T size={14} muted center>Available on the Android app. Here you can paste bank SMS or upload a statement in Add transactions.</T>
        {onSkip || onFinished ? (
          <PrimaryButton label={continueLabel} icon="chevron-forward" style={{ alignSelf: 'stretch' }}
            onPress={() => (onSkip ? onSkip() : onFinished?.(null))} />
        ) : null}
      </Card>
    );
  }

  const start = async () => {
    setNote(null);
    const perm = await requestSmsPermission();
    // A build with a real SMS reader needs the permission; Expo Go has no reader and uses Bachat's inbox.
    if (nativeSmsReaderAvailable() && perm !== 'granted') {
      if (!alive.current) return;
      setPhase('denied');
      setNote(perm === 'blocked'
        ? 'SMS access is turned off for Bachat. You can turn it on in Android Settings → Apps → Bachat → Permissions.'
        : 'No problem. You can allow it any time in Settings → Read bank SMS, or paste SMS in Add transactions.');
      return;
    }
    if (!alive.current) return;
    setPhase('reading');
    setFound(0);
    setPreview([]);
    let r: SmsReadResult;
    try {
      r = await readBankSms((p) => {
        if (!alive.current) return;
        setFound(p.found);
        setPreview(p.preview);
      });
    } catch {
      // Never leave the spinner up: back to the ask with a note.
      if (!alive.current) return;
      setPhase('ask');
      setNote("Couldn't read your messages. Try again, or paste SMS in Add transactions.");
      return;
    }
    if (!alive.current) return;
    setResult(r);
    setFound(r.found);
    setPhase('done');
  };

  if (phase === 'reading' || phase === 'done') {
    const r = result;
    return (
      <Card style={{ gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
          {phase === 'reading' ? <ActivityIndicator size="large" color={c.accent} /> : <BigIcon name="checkmark" />}
          <T size={20} weight="700" center>{phase === 'reading' ? 'Reading your bank SMS…' : 'Your bank SMS are in'}</T>
          <T size={14} muted center>
            {`Found ${found} bank message${found === 1 ? '' : 's'}${r && r.months ? ` · ${r.months} month${r.months === 1 ? '' : 's'}` : ''}`}
          </T>
        </View>
        {preview.length ? (
          <View>
            {preview.map((p, i) => <PreviewRow key={`${p.date}-${p.merchant}-${p.amount}-${i}`} r={p} />)}
          </View>
        ) : null}
        {phase === 'done' && r ? (
          <>
            <T size={13} muted center>
              {r.added
                ? `Added ${r.added} transaction${r.added === 1 ? '' : 's'}${r.toReview ? ` · ${r.toReview} need${r.toReview === 1 ? 's' : ''} a category` : ''}. OTPs and offers were skipped.`
                : r.parsed
                  ? 'Everything from these messages is already in Bachat.'
                  : 'No bank transactions found in your messages yet.'}
            </T>
            {onFinished ? (
              <PrimaryButton label={continueLabel} icon="chevron-forward" onPress={() => onFinished(r)} />
            ) : (
              <GhostButton label="Read again" icon="refresh" onPress={() => void start()} />
            )}
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={{ gap: 16, paddingVertical: 22 }}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <BigIcon name="chatbubbles-outline" />
        <T size={22} weight="700" center>Let Bachat read your bank SMS</T>
        <T size={14} muted center>Your spending fills in by itself — no typing, no statements.</T>
      </View>
      <View style={{ gap: 10 }}>
        {PROMISES.map((p) => (
          <View key={p.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name={p.icon} size={20} color={c.accent} />
            <T size={15} style={{ flex: 1 }}>{p.text}</T>
          </View>
        ))}
      </View>
      {note ? <T size={13} muted>{note}</T> : null}
      <PrimaryButton label={phase === 'denied' ? 'Try again' : allowedBefore && !onSkip ? 'Read again' : 'Allow'} icon="checkmark" onPress={() => void start()} />
      {onSkip ? <GhostButton label="Not now" onPress={onSkip} /> : null}
    </Card>
  );
}
