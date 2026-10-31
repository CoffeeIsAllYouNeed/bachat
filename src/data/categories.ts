import type { CategoryId, SectionId } from './types';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  emoji: string;
  /** Counts toward spending and budgets. */
  spend: boolean;
  /** Fixed bills (rent, EMI): expected to be fully used, so their ring stays calm. */
  fixed?: boolean;
}

/** Everyday budgets first, in the order people look for them. */
export const CATEGORIES: CategoryInfo[] = [
  { id: 'rent', label: 'Rent', emoji: '🏠', spend: true, fixed: true },
  { id: 'food', label: 'Food', emoji: '🍔', spend: true },
  { id: 'groceries', label: 'Groceries', emoji: '🥑', spend: true },
  { id: 'transport', label: 'Transport', emoji: '🚗', spend: true },
  { id: 'bills', label: 'Bills', emoji: '💡', spend: true },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️', spend: true },
  { id: 'entertainment', label: 'Entertainment', emoji: '🎟️', spend: true },
  { id: 'subscriptions', label: 'Subscriptions', emoji: '🔁', spend: true },
  { id: 'health', label: 'Health', emoji: '💊', spend: true },
  { id: 'personal', label: 'Personal', emoji: '💇', spend: true },
  { id: 'education', label: 'Education', emoji: '📚', spend: true },
  { id: 'travel', label: 'Travel', emoji: '✈️', spend: true },
  { id: 'emi', label: 'EMI', emoji: '🏦', spend: true, fixed: true },
  { id: 'other', label: 'Others', emoji: '🧾', spend: true },
  { id: 'income', label: 'Income', emoji: '💰', spend: false },
  { id: 'transfer', label: 'Transfer', emoji: '🔄', spend: false },
  { id: 'investment', label: 'Investment', emoji: '📈', spend: false },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: CategoryId): CategoryInfo {
  return BY_ID.get(id) ?? BY_ID.get('other')!;
}

export const SPEND_CATEGORIES = CATEGORIES.filter((c) => c.spend);

export function isCategoryId(x: unknown): x is CategoryId {
  return typeof x === 'string' && BY_ID.has(x as CategoryId);
}

export interface SectionInfo {
  id: SectionId;
  label: string;
  /** Ionicons name (outline style). */
  icon: string;
  /** expo-router path */
  href: string;
}

/** Default order; the user can rearrange in Settings → Rearrange sections. */
export const SECTIONS: SectionInfo[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', href: '/' },
  { id: 'review', label: 'Review', icon: 'calendar-outline', href: '/review' },
  { id: 'budgets', label: 'Budgets', icon: 'pie-chart-outline', href: '/budgets' },
  { id: 'transactions', label: 'Transactions', icon: 'receipt-outline', href: '/transactions' },
  { id: 'spending', label: 'Spending', icon: 'cart-outline', href: '/spending' },
  { id: 'cashflow', label: 'Cash flow', icon: 'bar-chart-outline', href: '/cashflow' },
  { id: 'rent', label: 'Rent', icon: 'business-outline', href: '/rent' },
  { id: 'recurring', label: 'Recurring', icon: 'repeat-outline', href: '/recurring' },
  { id: 'emergency', label: 'Emergency fund', icon: 'shield-checkmark-outline', href: '/emergency' },
  { id: 'goals', label: 'Goals', icon: 'flag-outline', href: '/goals' },
  { id: 'family', label: 'Family', icon: 'people-outline', href: '/family' },
  { id: 'investments', label: 'Investments', icon: 'trending-up-outline', href: '/investments' },
  { id: 'networth', label: 'Net worth', icon: 'wallet-outline', href: '/networth' },
];

export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/**
 * Saved order, plus any section the saved order doesn't mention (e.g. one added
 * in a later version), placed right after its default predecessor
 * (Review after Home, Emergency fund before Goals).
 */
export function orderedSections(saved: SectionId[] | undefined): SectionInfo[] {
  const out: SectionInfo[] = [];
  const seen = new Set<SectionId>();
  for (const id of saved ?? []) {
    const s = SECTION_BY_ID.get(id);
    if (s && !seen.has(s.id)) {
      out.push(s);
      seen.add(s.id);
    }
  }
  SECTIONS.forEach((s, i) => {
    if (seen.has(s.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === SECTIONS[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, s);
    seen.add(s.id);
  });
  return out;
}
