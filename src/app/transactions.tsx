import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Txn } from '@/data/types';
import { category as categoryInfo, CATEGORIES } from '@/data/categories';
import { todayISO, useStore } from '@/data/store';
import { displayName } from '@/engine/merchant';
import { detectRecurring } from '@/engine/recurring';
import { learnCorrection, undoLast } from '@/engine/rules';
import { AddSheet, DetailSheet, FilterSheet, NO_FILTERS, Pill, TYPE_LABEL, type Filters } from '@/features/transactions/parts';
import { SwipeRow } from '@/features/transactions/SwipeRow';
import { dayHeader, dayMonth, money, monthYear } from '@/theme/format';
import { useColors } from '@/theme/theme';
import { Card, CategoryChip, EmptyState, Footer, GhostButton, IconButton, PrimaryButton, Screen, T } from '@/ui/kit';
import { MerchantLogo } from '@/ui/MerchantLogo';
import { showSnack } from '@/ui/Snackbar';

/*
 * Transactions: import bar, search pill + filter button,
 * active filter chips, day-grouped list, detail sheet with the correction loop.
 */

const PAGE = 150;

export default function TransactionsScreen() {
  const c = useColors();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const qParam = typeof params.q === 'string' ? params.q : Array.isArray(params.q) ? params.q[0] ?? '' : '';
  const txns = useStore((s) => s.txns);

  const [search, setSearch] = useState(qParam);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);
  useEffect(() => setLimit(PAGE), [search, filters]);

  const today = todayISO();

  const accounts = useMemo(() => [...new Set(txns.map((t) => t.account).filter((a): a is string => !!a))].sort(), [txns]);
  const months = useMemo(() => [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort().reverse(), [txns]);
  const categories = useMemo(() => {
    const have = new Set(txns.map((t) => t.category));
    return CATEGORIES.map((x) => x.id).filter((id) => have.has(id));
  }, [txns]);
  const reviewCount = useMemo(() => txns.filter((t) => t.needsReview).length, [txns]);

  const recurringIds = useMemo(() => {
    if (!filters.recurring) return null;
    try {
      return new Set(detectRecurring(txns, today).flatMap((r) => r.history.map((h) => h.txnId)));
    } catch {
      return new Set<string>();
    }
  }, [filters.recurring, txns, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const amountQ = q.replace(/[₹,\s]/g, '');
    const list = txns.filter((t) => {
      if (filters.account && t.account !== filters.account) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (filters.month && !t.date.startsWith(filters.month)) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.review === 'review' && !t.needsReview) return false;
      if (filters.review === 'reviewed' && t.needsReview) return false;
      if (recurringIds && !recurringIds.has(t.id)) return false;
      if (q) {
        const hay = `${t.merchant} ${displayName(t.merchant)} ${t.narration ?? ''} ${categoryInfo(t.category).label} ${t.account ?? ''}`.toLowerCase();
        const amountHit = /^\d+(\.\d+)?$/.test(amountQ) && String(Math.round(t.amount)).startsWith(amountQ.split('.')[0]);
        if (!hay.includes(q) && !amountHit) return false;
      }
      return true;
    });
    if (filters.sort === 'high') list.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date));
    else if (filters.sort === 'low') list.sort((a, b) => a.amount - b.amount || b.date.localeCompare(a.date));
    else list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [txns, search, filters, recurringIds]);

  const groups = useMemo(() => {
    const shown = filtered.slice(0, limit);
    if (filters.sort !== 'date') {
      return [{ key: 'sorted', title: filters.sort === 'high' ? 'HIGHEST FIRST' : 'LOWEST FIRST', rows: shown }];
    }
    const out: { key: string; title: string; rows: Txn[] }[] = [];
    for (const t of shown) {
      const last = out[out.length - 1];
      if (last && last.key === t.date) last.rows.push(t);
      else out.push({ key: t.date, title: dayHeader(t.date), rows: [t] });
    }
    return out;
  }, [filtered, limit, filters.sort]);

  const chips = useMemo(() => {
    const list: { key: string; label: string; clear: Partial<Filters> }[] = [];
    if (filters.review !== 'all') list.push({ key: 'review', label: filters.review === 'review' ? 'Needs a category' : 'Reviewed', clear: { review: 'all' } });
    if (filters.category) {
      const ci = categoryInfo(filters.category);
      list.push({ key: 'cat', label: `${ci.emoji} ${ci.label}`, clear: { category: null } });
    }
    if (filters.month) list.push({ key: 'month', label: monthYear(filters.month), clear: { month: null } });
    if (filters.account) list.push({ key: 'acct', label: filters.account, clear: { account: null } });
    if (filters.type) list.push({ key: 'type', label: TYPE_LABEL[filters.type], clear: { type: null } });
    if (filters.recurring) list.push({ key: 'rec', label: 'Recurring', clear: { recurring: false } });
    if (filters.sort !== 'date') list.push({ key: 'sort', label: filters.sort === 'high' ? 'Amount ↓' : 'Amount ↑', clear: { sort: 'date' } });
    return list;
  }, [filters]);

  const onUndo = () => {
    const msg = undoLast();
    if (msg) showSnack(msg, undefined, false);
  };
  const onLearned = (label: string) => showSnack(label, onUndo);
  const markReviewed = (t: Txn) => {
    try {
      learnCorrection(t.id, t.category, 'once');
      showSnack('Marked as reviewed', onUndo);
    } catch {
      // row may be gone; nothing to do
    }
  };

  return (
    <Screen maxWidth={760}>
      {/* Import bar */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="700">Add transactions</T>
          <T size={13} muted>Paste bank SMS, or upload a CSV / PDF statement.</T>
        </View>
        <PrimaryButton label="Add" icon="add" onPress={() => setShowAdd(true)} />
      </Card>

      {/* Search + filter */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 46,
            borderRadius: 999,
            backgroundColor: c.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingLeft: 14,
            gap: 8,
          }}
        >
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search merchant, category, amount"
            placeholderTextColor={c.textFaint}
            accessibilityLabel="Search transactions"
            returnKeyType="search"
            autoCorrect={false}
            style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 10 }}
          />
          {search ? <IconButton name="close-circle" label="Clear search" size={18} onPress={() => setSearch('')} /> : null}
        </View>
        <View>
          <Pressable
            onPress={() => setShowFilter(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter and sort"
            style={({ pressed }) => [
              {
                width: 46,
                height: 46,
                borderRadius: 23,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: chips.length ? c.accent : c.card,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="options-outline" size={20} color={chips.length ? c.onAccent : c.text} />
          </Pressable>
        </View>
      </View>

      {/* Active filters / quick review chip */}
      {chips.length || reviewCount ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((ch) => (
            <Pill key={ch.key} label={ch.label} on onRemove={() => setFilters({ ...filters, ...ch.clear })} />
          ))}
          {filters.review === 'all' && reviewCount ? (
            <Pill label={`● ${reviewCount} need${reviewCount === 1 ? 's' : ''} a category`} onPress={() => setFilters({ ...filters, review: 'review' })} />
          ) : null}
          {chips.length > 1 ? <Pill label="Clear all" onPress={() => setFilters(NO_FILTERS)} /> : null}
        </View>
      ) : null}

      {/* List */}
      {!txns.length ? (
        <Card>
          <EmptyState
            title="No transactions yet"
            body="Paste bank SMS or upload a statement."
            action="Add transactions"
            onAction={() => setShowAdd(true)}
          />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            title="Nothing matches"
            body="Try another search or filter."
            action="Clear filters"
            onAction={() => {
              setSearch('');
              setFilters(NO_FILTERS);
            }}
          />
        </Card>
      ) : (
        <>
          <T size={12} faint>
            {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
            {reviewCount ? ` · ${reviewCount} need${reviewCount === 1 ? 's' : ''} a category` : ''}
          </T>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: 8 }}>
              <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{g.title}</Text>
              <Card padded={false} style={{ gap: 0, overflow: 'hidden' }}>
                {g.rows.map((t, i) => (
                  <SwipeRow key={t.id} onCategory={() => setOpenId(t.id)} onReviewed={t.needsReview ? () => markReviewed(t) : undefined}>
                    <TxnRow t={t} first={i === 0} showDate={filters.sort !== 'date'} onPress={() => setOpenId(t.id)} />
                  </SwipeRow>
                ))}
              </Card>
            </View>
          ))}
          {filtered.length > limit ? (
            <GhostButton label={`Show more (${filtered.length - limit} left)`} onPress={() => setLimit(limit + PAGE)} />
          ) : null}
        </>
      )}

      <Footer />

      <FilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        value={filters}
        onChange={setFilters}
        accounts={accounts}
        months={months}
        categories={categories}
      />
      <AddSheet visible={showAdd} onClose={() => setShowAdd(false)} />
      <DetailSheet
        key={openId ?? 'none'}
        txnId={openId}
        onClose={() => setOpenId(null)}
        onLearned={onLearned}
      />
    </Screen>
  );
}

/** One transaction row: review dot, merchant + category chip, amount. */
function TxnRow({ t, first, showDate, onPress }: { t: Txn; first: boolean; showDate: boolean; onPress: () => void }) {
  const c = useColors();
  const info = categoryInfo(t.category);
  const inflow = t.type === 'income' || t.type === 'refund';
  const name = displayName(t.merchant) || t.merchant;
  const amountColor = inflow ? c.good : t.excluded ? c.textFaint : c.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${inflow ? 'plus ' : ''}${money(t.amount)}, ${info.label}${t.needsReview ? ', needs review' : ''}`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 60,
          paddingHorizontal: 14,
          paddingVertical: 10,
          gap: 10,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: c.border,
        },
        pressed && { backgroundColor: c.muted + '55' },
      ]}
    >
      <View style={{ width: 8, alignItems: 'center' }}>
        {t.needsReview ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : null}
      </View>
      <MerchantLogo name={t.merchant} size={32} />
      <View style={{ flex: 1, gap: 4 }}>
        <T weight="600" numberOfLines={1}>{name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <CategoryChip emoji={info.emoji} label={info.label} />
          {showDate ? <T size={12} faint>{dayMonth(t.date)}</T> : null}
          {t.excluded ? <T size={12} faint>Not counted</T> : t.refundOf ? <T size={12} faint>Refund</T> : null}
          {t.needsReview && t.suggested ? <T size={12} color={c.accent}>Maybe {categoryInfo(t.suggested).label}?</T> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: amountColor, fontSize: 15, fontWeight: '600' }}>
          {inflow ? '+' : ''}
          {money(t.amount, t.amount % 1 ? 2 : 0)}
        </Text>
        {t.account ? <T size={11} faint numberOfLines={1}>{t.account}</T> : null}
      </View>
    </Pressable>
  );
}
