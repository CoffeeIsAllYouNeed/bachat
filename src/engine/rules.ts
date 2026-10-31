import type { CategoryId, LearnLog, Rule, RuleScope, Txn } from '@/data/types';
import { category as categoryInfo } from '@/data/categories';
import { useStore, uid } from '@/data/store';
import { money } from '@/theme/format';
import { alignType, correctionExample, matchRule } from './categorize';
import { cleanTxns } from './clean';
import { displayName, merchantKey } from './merchant';

/*
 * The correction loop: the user fixes one row, Bachat asks "Always?",
 * learns a rule, re-applies it to past rows and keeps an undo record.
 */

/** Re-categorises non-user rows with the newest matching rule; returns only the rows that changed. */
export function applyRules(txns: Txn[], rules: Rule[]): Txn[] {
  const active = rules.filter((r) => r.active);
  if (!active.length) return [];
  const changed: Txn[] = [];
  for (const t of txns) {
    if (t.catSource === 'user') continue;
    const r = matchRule(t, active);
    if (!r) continue;
    if (t.category === r.category && t.catSource === 'rule' && !t.needsReview) continue;
    changed.push({
      ...t,
      category: r.category,
      type: alignType(t.type, r.category),
      catSource: 'rule',
      confidence: 0.98,
      needsReview: false,
      suggested: undefined,
    });
  }
  return changed;
}

function snapshot(t: Txn): LearnLog['previous'][number] {
  return { id: t.id, category: t.category, catSource: t.catSource, confidence: t.confidence, needsReview: t.needsReview };
}

/**
 * Applies a user's correction. scope 'once' changes just this row; otherwise a Rule is
 * created (merchant / ±25% amount band / same account), re-applied to past rows, and an undo record pushed.
 */
export function learnCorrection(txnId: string, category: CategoryId, scope: RuleScope | 'once'): { changed: number; label: string } {
  const st = useStore.getState();
  const t = st.txns.find((x) => x.id === txnId);
  if (!t) return { changed: 0, label: 'That transaction is no longer here.' };

  const name = displayName(t.merchant) || t.merchant;
  const catLabel = categoryInfo(category).label;
  // L3: every real correction (or confirmation of an unsure guess) becomes an example for the AI.
  if (t.category !== category || t.needsReview || t.confidence < 0.6) {
    st.addCorrection(correctionExample(t, category));
  }
  const previous: LearnLog['previous'] = [snapshot(t)];
  const updated = new Map<string, Txn>();
  updated.set(t.id, {
    ...t,
    category,
    type: alignType(t.type, category),
    catSource: 'user',
    confidence: 1,
    needsReview: false,
    suggested: undefined,
  });

  let rule: Rule | undefined;
  let others = 0;
  if (scope !== 'once') {
    const key = merchantKey(t.merchant);
    rule = {
      id: uid('r_'),
      createdAt: new Date().toISOString(),
      merchantKey: key,
      scope,
      category,
      active: true,
      ...(scope === 'amount' ? { minAmount: Math.floor(t.amount * 0.75), maxAmount: Math.ceil(t.amount * 1.25) } : {}),
      ...(scope === 'account' && t.account ? { account: t.account } : {}),
    };
    st.addRule(rule);
    const past = applyRules(st.txns.filter((x) => x.id !== t.id), [rule]);
    for (const p of past) {
      const before = st.txns.find((x) => x.id === p.id);
      if (before) previous.push(snapshot(before));
      updated.set(p.id, p);
    }
    others = past.length;
  }

  // Write back, then re-run cleaning (a category change can create/undo transfers).
  const merged = st.txns.map((x) => updated.get(x.id) ?? x);
  useStore.getState().setTxns(cleanTxns(merged));

  let label: string;
  if (scope === 'once') label = `${name} → ${catLabel}, just this one.`;
  else {
    const scopeNote =
      scope === 'amount' && rule?.minAmount != null && rule.maxAmount != null
        ? ` (${money(rule.minAmount)}–${money(rule.maxAmount)})`
        : scope === 'account' && t.account
          ? ` on ${t.account}`
          : '';
    label =
      others > 0
        ? `Rule learned — ${name}${scopeNote} → ${catLabel}. Updated ${others} past transaction${others === 1 ? '' : 's'}.`
        : `Rule learned — ${name}${scopeNote} → ${catLabel}. New ones will follow it.`;
  }

  useStore.getState().pushLearnLog({ id: uid('l_'), at: new Date().toISOString(), ruleId: rule?.id, label, previous });
  return { changed: 1 + others, label };
}

/** Changes a learned rule's category (it becomes the newest rule) and re-applies it to past rows. Returns rows changed. */
export function changeRuleCategory(ruleId: string, category: CategoryId): number {
  const st = useStore.getState();
  const r = st.rules.find((x) => x.id === ruleId);
  if (!r || r.category === category) return 0;
  const next: Rule = { ...r, category, active: true, createdAt: new Date().toISOString() };
  st.setRules(st.rules.map((x) => (x.id === ruleId ? next : x)));
  const changed = applyRules(useStore.getState().txns, useStore.getState().rules);
  if (changed.length) {
    const byId = new Map(changed.map((t) => [t.id, t]));
    useStore.getState().setTxns(cleanTxns(useStore.getState().txns.map((t) => byId.get(t.id) ?? t)));
  }
  return changed.length;
}

/** Deletes a learned rule. Rows it already filed keep their category. */
export function deleteRule(ruleId: string): void {
  const st = useStore.getState();
  st.setRules(st.rules.filter((r) => r.id !== ruleId));
}

/** Undoes the newest correction: restores rows, deactivates its rule; returns a message or null if nothing to undo. */
export function undoLast(): string | null {
  const st = useStore.getState();
  const log = st.popLearnLog();
  if (!log) return null;
  const prev = new Map(log.previous.map((p) => [p.id, p]));
  const restored = useStore.getState().txns.map((t) => {
    const p = prev.get(t.id);
    if (!p) return t;
    return {
      ...t,
      category: p.category,
      type: alignType(t.type, p.category),
      catSource: p.catSource,
      confidence: p.confidence,
      needsReview: p.needsReview,
    };
  });
  if (log.ruleId) {
    const rules = useStore.getState().rules.map((r) => (r.id === log.ruleId ? { ...r, active: false } : r));
    useStore.getState().setRules(rules);
  }
  useStore.getState().setTxns(cleanTxns(restored));
  const n = log.previous.length;
  return log.ruleId
    ? `Undone — rule removed, ${n} transaction${n === 1 ? '' : 's'} restored.`
    : 'Undone — category restored.';
}
