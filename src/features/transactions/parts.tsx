import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CategoryId, CatSource, Txn, TxnType } from '@/data/types';
import { CATEGORIES, category as categoryInfo } from '@/data/categories';
import { useStore } from '@/data/store';
import { DEMO_CSV_SAMPLE, DEMO_SMS_SAMPLE } from '@/data/demo';
import { displayName } from '@/engine/merchant';
import { learnCorrection } from '@/engine/rules';
import { importCsvText, importSmsText, pickAndImportCsv, pickAndImportPdf } from '@/services/ingest';
import { dayMonth, money, monthYear } from '@/theme/format';
import { useColors, useHeroFont, useWide } from '@/theme/theme';
import { CategoryChip, GhostButton, PrimaryButton, Segmented, Sheet, T, Tag } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';

/*
 * Pieces of the Transactions screen (src/app/transactions.tsx):
 * filter/sort sheet, "Add transactions" sheet and the transaction detail sheet
 * with the correction loop ("Always categorise X as Y?").
 */

export type SortKey = 'date' | 'high' | 'low';
export type ReviewFilter = 'all' | 'review' | 'reviewed';

export interface Filters {
  account: string | null;
  category: CategoryId | null;
  month: string | null;
  recurring: boolean;
  review: ReviewFilter;
  type: TxnType | null;
  sort: SortKey;
}

export const NO_FILTERS: Filters = { account: null, category: null, month: null, recurring: false, review: 'all', type: null, sort: 'date' };

export const TYPE_LABEL: Record<TxnType, string> = {
  expense: 'Spend',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
  investment: 'Investment',
};

/** Selectable pill used in the filter sheet and the active-filter row. */
export function Pill({ label, on, onPress, onRemove }: { label: string; on?: boolean; onPress?: () => void; onRemove?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onRemove ?? onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={onRemove ? `Remove filter ${label}` : label}
      style={({ pressed }) => [
        {
          minHeight: 36,
          paddingHorizontal: 12,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: on ? c.accent : c.border,
          backgroundColor: on ? c.accentSoft : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={{ color: on ? c.accent : c.text, fontSize: 13, fontWeight: on ? '700' : '500' }}>{label}</Text>
      {onRemove ? <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>✕</Text> : null}
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T size={12} weight="600" muted style={{ letterSpacing: 0.6 }}>{title.toUpperCase()}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

// ------------------------------------------------------------------ filter sheet

/** Filter + sort sheet (account, category, month, recurring, review status, type; sort). */
export function FilterSheet({ visible, onClose, value, onChange, accounts, months, categories }: {
  visible: boolean;
  onClose: () => void;
  value: Filters;
  onChange: (f: Filters) => void;
  accounts: string[];
  months: string[];
  categories: CategoryId[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <Sheet visible={visible} onClose={onClose} title="Filter & sort">
      <View style={{ gap: 8 }}>
        <T size={12} weight="600" muted style={{ letterSpacing: 0.6 }}>SORT BY</T>
        <Segmented<SortKey>
          options={[{ value: 'date', label: 'Date' }, { value: 'high', label: 'High → low' }, { value: 'low', label: 'Low → high' }]}
          value={value.sort}
          onChange={(sort) => set({ sort })}
        />
      </View>
      <Group title="Review status">
        {(['all', 'review', 'reviewed'] as ReviewFilter[]).map((r) => (
          <Pill key={r} label={r === 'all' ? 'All' : r === 'review' ? 'Needs review' : 'Reviewed'} on={value.review === r} onPress={() => set({ review: r })} />
        ))}
      </Group>
      <Group title="Type">
        <Pill label="All" on={!value.type} onPress={() => set({ type: null })} />
        {(Object.keys(TYPE_LABEL) as TxnType[]).map((k) => (
          <Pill key={k} label={TYPE_LABEL[k]} on={value.type === k} onPress={() => set({ type: value.type === k ? null : k })} />
        ))}
      </Group>
      <Group title="Recurring">
        <Pill label="All" on={!value.recurring} onPress={() => set({ recurring: false })} />
        <Pill label="Recurring only" on={value.recurring} onPress={() => set({ recurring: true })} />
      </Group>
      {accounts.length ? (
        <Group title="Account">
          <Pill label="All" on={!value.account} onPress={() => set({ account: null })} />
          {accounts.map((a) => (
            <Pill key={a} label={a} on={value.account === a} onPress={() => set({ account: value.account === a ? null : a })} />
          ))}
        </Group>
      ) : null}
      {months.length ? (
        <Group title="Month">
          <Pill label="All" on={!value.month} onPress={() => set({ month: null })} />
          {months.map((m) => (
            <Pill key={m} label={monthYear(m)} on={value.month === m} onPress={() => set({ month: value.month === m ? null : m })} />
          ))}
        </Group>
      ) : null}
      <Group title="Category">
        <Pill label="All" on={!value.category} onPress={() => set({ category: null })} />
        {categories.map((id) => {
          const info = categoryInfo(id);
          return <Pill key={id} label={`${info.emoji} ${info.label}`} on={value.category === id} onPress={() => set({ category: value.category === id ? null : id })} />;
        })}
      </Group>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <GhostButton label="Reset" onPress={() => onChange(NO_FILTERS)} style={{ flex: 1 }} />
        <PrimaryButton label="Done" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}

// ------------------------------------------------------------------ add sheet

/** "Add transactions": paste SMS (with a sample), upload CSV, upload PDF. */
export function AddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'sms' | 'csv' | 'pdf'>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (kind: 'sms' | 'csv' | 'pdf', job: () => Promise<{ added: number; message: string }>) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      const r = await job();
      setMessage(r.message);
      if (kind === 'sms' && r.added > 0) setText('');
    } catch {
      setMessage('Something went wrong while importing. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add transactions">
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T weight="700" style={{ flex: 1 }}>Paste bank SMS</T>
          <Pressable onPress={() => setText(DEMO_SMS_SAMPLE)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 8 }}>
            <Text style={{ color: c.accent, fontWeight: '600', fontSize: 13 }}>Use sample</Text>
          </Pressable>
        </View>
        <T size={13} muted>Copy one or many bank messages and paste them here. OTPs, offers and failed payments are skipped.</T>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Rs.349.00 debited from A/c XX1123 on 30-10-26 to VPA swiggy@icici…"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Paste bank SMS"
          style={{
            minHeight: 130,
            maxHeight: 260,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.muted + '55',
            color: c.text,
            padding: 12,
            fontSize: 14,
            textAlignVertical: 'top',
          }}
        />
        <PrimaryButton label={busy === 'sms' ? 'Reading…' : 'Import SMS'} icon="chatbox-ellipses-outline" disabled={!text.trim() || !!busy} onPress={() => run('sms', () => importSmsText(text))} />
      </View>

      <View style={{ height: 1, backgroundColor: c.border }} />

      <View style={{ gap: 10 }}>
        <T weight="700">Upload a statement</T>
        <GhostButton label={busy === 'csv' ? 'Reading CSV…' : 'Upload CSV'} icon="document-text-outline" onPress={() => run('csv', pickAndImportCsv)} />
        <GhostButton label={busy === 'pdf' ? 'Reading PDF…' : 'Upload PDF'} icon="document-outline" onPress={() => run('pdf', pickAndImportPdf)} />
        <T size={12} faint>
          CSV exports from HDFC, ICICI, SBI, Axis and Kotak work as they are. PDFs are read by Gemini — remove the password first.
        </T>
        <Pressable onPress={() => run('csv', () => importCsvText(DEMO_CSV_SAMPLE))} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: c.accent, fontWeight: '600', fontSize: 13 }}>Try a sample CSV statement</Text>
        </Pressable>
      </View>

      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={c.accent} />
          <T size={13} muted>Working on it…</T>
        </View>
      ) : null}
      {message ? (
        <View style={{ backgroundColor: c.muted, borderRadius: 14, padding: 12 }}>
          <T size={14}>{message}</T>
        </View>
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ detail sheet

const WHY: Record<CatSource, string> = {
  user: 'You chose this category.',
  rule: 'A rule you taught Bachat.',
  merchant: 'Known merchant in Bachat’s built-in list.',
  keyword: 'A word in the description matched.',
  ai: 'Gemini guessed from the merchant name.',
  default: 'Nothing matched, so it went to Others.',
};

const PICKABLE: CategoryId[] = CATEGORIES.map((x) => x.id);

/** Transaction detail + the correction loop. Remount it per transaction (key = id). */
export function DetailSheet({ txnId, onClose, onLearned }: { txnId: string | null; onClose: () => void; onLearned: (label: string) => void }) {
  const c = useColors();
  const wide = useWide();
  const hero = useHeroFont();
  const txns = useStore((s) => s.txns);
  const t = useMemo(() => (txnId ? txns.find((x) => x.id === txnId) ?? null : null), [txns, txnId]);
  const related = useMemo(() => {
    if (!t) return null;
    const id = t.transferPairId ?? t.refundOf;
    return id ? txns.find((x) => x.id === id) ?? null : null;
  }, [t, txns]);
  const [picked, setPicked] = useState<CategoryId | null>(null);

  if (!t) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const name = displayName(t.merchant) || t.merchant;
  const info = categoryInfo(t.category);
  const inflow = t.type === 'income' || t.type === 'refund';
  const learn = (scope: 'merchant' | 'amount' | 'account' | 'once') => {
    if (!picked) return;
    const r = learnCorrection(t.id, picked, scope);
    onLearned(r.label);
    onClose();
  };
  const lo = Math.floor(t.amount * 0.75);
  const hi = Math.ceil(t.amount * 1.25);

  return (
    <Sheet visible={!!txnId} onClose={onClose} title={name}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <MerchantLogo name={t.merchant} size={44} />
        <Text style={[{ color: inflow ? c.good : c.text, fontSize: 34 }, hero]}>
          {inflow ? '+' : ''}
          {money(t.amount, t.amount % 1 ? 2 : 0)}
        </Text>
        <T size={13} muted>
          {dayMonth(t.date)} {t.date.slice(0, 4)}
          {t.account ? ` · ${t.account}` : ''} · {TYPE_LABEL[t.type]}
        </T>
        {t.balanceAfter != null ? <T size={12} faint>Balance after: {money(t.balanceAfter)}</T> : null}
      </View>

      {t.excluded || t.refundOf ? (
        <View style={{ backgroundColor: c.muted + '66', borderRadius: 14, padding: 12, gap: 2 }}>
          <T size={13} weight="600">{t.refundOf ? 'Refund linked' : 'Not counted in spending'}</T>
          <T size={13} muted>
            {t.transferPairId && related
              ? `Money moved between your own accounts (${related.account ?? 'other account'} on ${dayMonth(related.date)}).`
              : t.refundOf && related
                ? `Reverses ${displayName(related.merchant)} ${money(related.amount)} on ${dayMonth(related.date)}, so it’s taken off that month’s ${categoryInfo(related.category).label}.`
                : t.category === 'transfer'
                  ? 'Credit-card bill or transfer — the card spends themselves were already counted.'
                  : 'Left out of totals.'}
          </T>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <T size={12} weight="600" muted style={{ letterSpacing: 0.6 }}>WHY THIS CATEGORY</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CategoryChip emoji={info.emoji} label={info.label} />
          <Tag
            text={`${Math.round(t.confidence * 100)}% sure`}
            color={t.confidence >= 0.75 ? c.good : t.confidence >= 0.6 ? c.warn : c.bad}
            background={t.confidence >= 0.75 ? c.goodSoft : t.confidence >= 0.6 ? c.warnSoft : c.badSoft}
          />
        </View>
        <T size={13} muted>{WHY[t.catSource]}</T>
        {t.suggested && t.suggested !== t.category ? (
          <Pressable onPress={() => setPicked(t.suggested ?? null)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: c.accent, fontWeight: '600', fontSize: 14 }}>
              Maybe {categoryInfo(t.suggested).emoji} {categoryInfo(t.suggested).label}? Tap to use it
            </Text>
          </Pressable>
        ) : null}
      </View>

      {t.raw || t.narration ? (
        <View style={{ gap: 6 }}>
          <T size={12} weight="600" muted style={{ letterSpacing: 0.6 }}>ORIGINAL TEXT</T>
          <View style={{ backgroundColor: c.muted + '55', borderRadius: 12, padding: 10 }}>
            <T size={12} muted style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{t.raw ?? t.narration}</T>
          </View>
        </View>
      ) : null}

      {picked ? (
        <View style={{ gap: 10, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 18, padding: 14 }}>
          <T weight="700" size={16}>
            Always categorise {name} as {categoryInfo(picked).emoji} {categoryInfo(picked).label}?
          </T>
          <T size={13} muted>Bachat will apply it to past and future transactions. You can undo.</T>
          <PrimaryButton label="Yes, this merchant" onPress={() => learn('merchant')} />
          <GhostButton label={`Similar amounts (${money(lo)}–${money(hi)})`} onPress={() => learn('amount')} />
          {t.account ? <GhostButton label={`Only on ${t.account}`} onPress={() => learn('account')} /> : null}
          <GhostButton label="Just this one" onPress={() => learn('once')} />
          <Pressable onPress={() => setPicked(null)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: c.textMuted, fontSize: 13 }}>Back to categories</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <T size={12} weight="600" muted style={{ letterSpacing: 0.6 }}>CHANGE CATEGORY</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PICKABLE.map((id) => {
              const ci = categoryInfo(id);
              const on = id === t.category;
              return (
                <Pressable
                  key={id}
                  onPress={() => (on && t.catSource === 'user' ? null : setPicked(id))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Categorise as ${ci.label}`}
                  style={({ pressed }) => [
                    {
                      width: wide ? '23%' : '31%',
                      minHeight: 64,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: on ? c.accent : c.border,
                      backgroundColor: on ? c.accentSoft : c.muted + '33',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 8,
                      gap: 2,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={{ fontSize: 20 }}>{ci.emoji}</Text>
                  <Text numberOfLines={1} style={{ color: on ? c.accent : c.text, fontSize: 12, fontWeight: on ? '700' : '500' }}>{ci.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </Sheet>
  );
}
