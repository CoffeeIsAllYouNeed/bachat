/**
 * Bachat data model. Everything lives on the device (AsyncStorage via the
 * zustand store in ./store.ts). Amounts are in rupees as plain numbers,
 * always positive; the direction is carried by `type`.
 */

/** Everyday budget categories + the non-spend kinds. */
export type CategoryId =
  | 'rent' | 'food' | 'groceries' | 'transport' | 'bills' | 'shopping' | 'entertainment'
  | 'health' | 'personal' | 'education' | 'travel' | 'emi' | 'subscriptions' | 'other'
  | 'income' | 'transfer' | 'investment';

export type TxnType = 'expense' | 'income' | 'transfer' | 'investment' | 'refund';
export type TxnSource = 'sms' | 'csv' | 'pdf' | 'manual' | 'demo';
/** Which step decided the category (shown as "why" + confidence). */
export type CatSource = 'user' | 'rule' | 'merchant' | 'keyword' | 'ai' | 'default';

export interface Txn {
  id: string;
  /** ISO date yyyy-mm-dd */
  date: string;
  amount: number;
  type: TxnType;
  merchant: string;
  narration?: string;
  category: CategoryId;
  /** e.g. "HDFC ••1123" */
  account?: string;
  /** Balance reported by the bank SMS/statement after this transaction, if any. */
  balanceAfter?: number;
  source: TxnSource;
  catSource: CatSource;
  /** 0..1 */
  confidence: number;
  needsReview: boolean;
  /** Model's guess when it wasn't sure enough to apply it. */
  suggested?: CategoryId;
  /** The other leg when money moved between the user's own accounts. */
  transferPairId?: string;
  /** For a refund: the purchase it reverses. */
  refundOf?: string;
  /** Left out of every total (user choice, transfer legs, card-bill payments). */
  excluded?: boolean;
  /** Original SMS / statement line, for "why". */
  raw?: string;
  /** Dedupe key (date + amount + account + merchant key). */
  hash: string;
}

export type RuleScope = 'merchant' | 'amount' | 'account';

/** A learned categorisation rule ("Always categorise Rasoi Express as Food"). Newest rule wins. */
export interface Rule {
  id: string;
  createdAt: string;
  merchantKey: string;
  scope: RuleScope;
  minAmount?: number;
  maxAmount?: number;
  account?: string;
  category: CategoryId;
  active: boolean;
}

/** Undo record for a correction (restores previous categories, deactivates the rule). */
export interface LearnLog {
  id: string;
  at: string;
  ruleId?: string;
  label: string;
  previous: { id: string; category: CategoryId; catSource: CatSource; confidence: number; needsReview: boolean }[];
}

export interface ProfileSnapshot {
  monthlyIncome: number;
  irregularIncome: boolean;
  rent: number;
  emis: number;
  otherFixed: number;
  emergencyFund: number;
  emergencyMonths: number;
}

export interface Profile extends ProfileSnapshot {
  onboarded: boolean;
  updatedAt?: string;
  /** Every save is versioned (newest last). */
  history: { at: string; snapshot: ProfileSnapshot }[];
}

/** Who the user is (Settings → Profile). Separate from the money profile above. */
export interface ProfileInfo {
  name: string;
  email: string;
  city: string;
  currency: 'INR';
  /** ISO timestamp of the first save ('' until then). */
  createdAt: string;
}

export interface GoalContribution {
  id: string;
  date: string;
  /** Negative = withdrawal. */
  amount: number;
  note?: string;
}

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  /** yyyy-mm-dd */
  dueDate?: string;
  /** 1 = highest */
  priority: number;
  archived: boolean;
  createdAt: string;
  contributions: GoalContribution[];
}

/** One change in a what-if scenario. All maths is deterministic (src/engine/scenario.ts). */
export type Adjustment =
  | { kind: 'categoryPct'; category: CategoryId; pct: number }
  | { kind: 'categoryAbs'; category: CategoryId; amount: number }
  | { kind: 'fixedChange'; what: 'rent' | 'emi' | 'other'; amount: number }
  | { kind: 'incomePct'; pct: number }
  | { kind: 'incomeAbs'; amount: number }
  | { kind: 'cancelSub'; name: string; monthly: number }
  | { kind: 'addSip'; amount: number }
  | { kind: 'oneOff'; amount: number; month: string /* yyyy-mm */ };

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  adjustments: Adjustment[];
}

export type CheckInAnswer = 'using' | 'not_using' | 'cancel' | 'rarely';

/** One "Still using it?" answer; `history` keeps the earlier answers (oldest first, last 6). */
export interface CheckInRecord {
  answer: CheckInAnswer;
  at: string;
  history?: { answer: CheckInAnswer; at: string }[];
}

/** Rough size of a transaction, so examples match similar spends. */
export type AmountBand = 'under 200' | '200-1k' | '1k-5k' | '5k-25k' | 'over 25k';

/** One user correction, kept as a few-shot example for the AI categoriser (newest last, last 200). */
export interface CorrectionExample {
  merchant: string;
  /** Narration trimmed to 80 characters. */
  narration: string;
  band: AmountBand;
  account?: string;
  category: CategoryId;
  at: string;
}

export type ThemeChoice = 'dark' | 'light' | 'system';
export type CoachVoice = 'supportive' | 'straight' | 'calm' | 'playful';
export type AccentChoice = 'gold' | 'white';
export type NumberFont = 'serif' | 'sans';

export type SectionId =
  | 'home' | 'budgets' | 'transactions' | 'spending' | 'cashflow'
  | 'rent' | 'recurring' | 'goals' | 'investments' | 'networth'
  | 'review' | 'emergency' | 'family';

export interface NudgeLog {
  at: string;
  category: CategoryId;
  text: string;
}

export interface Settings {
  theme: ThemeChoice;
  sectionOrder: SectionId[];
  voice: CoachVoice;
  /** User-set monthly budgets; missing = suggested (3-month average). */
  budgets: Partial<Record<CategoryId, number>>;
  quietStartHour: number;
  quietEndHour: number;
  nudgesEnabled: boolean;
  /** Most nudges shown in one day (1–3). */
  maxNudgesPerDay: number;
  /** Show the "Your month review is ready" card on days 1–7. */
  reviewReminder: boolean;
  /** Accent for links/buttons: gold (default) or plain white/black. */
  accent: AccentChoice;
  /** Font for big hero numbers (default 'sans'; 'serif' is an opt-in look). */
  numberFont: NumberFont;
  /** Tighter list rows. */
  compactRows: boolean;
  snoozeUntil?: string;
  /** "Read bank SMS" was allowed (Settings → Read bank SMS). */
  smsAllowed?: boolean;
  /** ISO time of the last bank SMS read. */
  smsReadAt?: string;
  /** Day the built-in SMS inbox was generated for (keeps "Read again" deduped). */
  smsAnchor?: string;
  /** Accuracy measured right after loading the demo, before learning (for the before/after demo). */
  evalBefore?: number;
  /** Header eye icon: show "₹••••" instead of amounts. */
  hideAmounts?: boolean;
  /** Settings → Privacy → App lock (biometric / device PIN on launch and after 60 s away). Phone only. */
  appLock?: boolean;
}

// ================================================================
// Shared shapes between engine modules and screens (the contracts).
// ================================================================

/** A transaction as read from SMS / CSV / PDF, before categorising. */
export interface RawTxn {
  date: string;
  amount: number;
  type: TxnType;
  merchant: string;
  narration?: string;
  account?: string;
  balanceAfter?: number;
  source: TxnSource;
  raw?: string;
  /** Pre-set category (demo data / bank-provided); still passes through rules. */
  category?: CategoryId;
}

/** One budget row for a month (src/engine/budgets.ts). */
export interface BudgetLine {
  category: CategoryId;
  budget: number;
  suggested: number;
  spent: number;
  /** User set the amount (vs suggested). */
  custom: boolean;
  left: number;
  over: boolean;
  /** spent / budget, 0..n */
  used: number;
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** A recurring payment found in the data (src/engine/recurring.ts). */
export interface Recurring {
  key: string;
  name: string;
  category: CategoryId;
  /** Latest charge amount */
  amount: number;
  /** Normalised to per month */
  monthly: number;
  cadence: Cadence;
  lastDate: string;
  nextDate: string;
  /** Charges oldest → newest */
  history: { date: string; amount: number; txnId: string }[];
  paidThisMonth: boolean;
  /** Next date passed with no charge */
  overdue: boolean;
}

export type AlertKind = 'price' | 'trial' | 'missed' | 'new' | 'unused' | 'renewal';

export interface RecurringAlert {
  /** Stable id (dismissals are stored by it) */
  id: string;
  key: string;
  kind: AlertKind;
  title: string;
  detail: string;
  /** + more per year / − saving per year; 0 if n/a */
  yearlyImpact: number;
}

/** Inputs to the planner (src/engine/scenario.ts). */
export interface Baseline {
  monthlyIncome: number;
  rent: number;
  emis: number;
  otherFixed: number;
  /** Average flexible spend per month by category (3 complete months). */
  categorySpend: Partial<Record<CategoryId, number>>;
  emergencyFund: number;
  emergencyTarget: number;
  goals: { id: string; name: string; target: number; saved: number; dueDate?: string; priority: number }[];
  /** yyyy-mm of the first projected month */
  startMonth: string;
}

export interface Projection {
  /** income − fixed − flexible (− SIPs) in the first month */
  monthlySurplus: number;
  monthlySpend: number;
  /** yyyy-mm when the emergency fund reaches target, null if > 60 months */
  emergencyEta: string | null;
  goalEta: Record<string, string | null>;
  /** Cumulative savings by month (60 values) */
  savingsPath: number[];
}

/** An account for net worth / sidebar (src/engine/networth.ts). */
export interface AccountSummary {
  key: string;
  name: string;
  kind: 'bank' | 'card' | 'loan' | 'wallet' | 'investment';
  /** Positive = what you have; for cards/loans positive = what you owe. */
  balance: number;
  updated: string;
  last4?: string;
  limit?: number;
}

/** What the assistant produced for one request (src/services/assistant.ts). */
export interface AssistantAnswer {
  /** Where the shell navigates. */
  section: SectionId | 'report' | 'settings';
  kind: 'info' | 'refusal' | 'scenario';
  title: string;
  body: string;
  /** For kind = 'scenario' */
  adjustments?: Adjustment[];
  current?: Projection;
  scenario?: Projection;
  /** Optional search term for Transactions */
  query?: string;
}

// ================================================================
// Family (src/services/family.ts + familySync.ts)
// ================================================================

/** What a member shares: monthly totals only, or totals + the last 90 days of transactions. */
export type FamilyShare = 'totals' | 'full';

export interface FamilyMember {
  /** Random id, stable per device + household. */
  id: string;
  name: string;
  /** Local label ("Spouse", "Parent" …). */
  relation: string;
  share: FamilyShare;
  color?: string;
  /** ISO time of the member's latest snapshot. */
  lastSync?: string;
}

/** A goal the whole family saves for; each member's own contribution travels in their snapshot. */
export interface SharedGoal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  /** yyyy-mm-dd */
  due?: string;
  updatedAt: string;
  /** Tombstone so a removal reaches every member. */
  deleted?: boolean;
}

/**
 * One member's monthly snapshot. This is the only thing that leaves the phone
 * (encrypted with the household secret). Never raw SMS / narrations.
 */
export interface FamilySnapshot {
  v: 1;
  memberId: string;
  name: string;
  share: FamilyShare;
  /** yyyy-mm the numbers are for (month to date). */
  month: string;
  updatedAt: string;
  income: number;
  spend: number;
  byCategory: Partial<Record<CategoryId, number>>;
  savings: number;
  emergencyFund: number;
  /** Rent + EMIs + other fixed costs per month. */
  fixedCosts: number;
  goals: { name: string; target: number; saved: number; due?: string }[];
  recurring: { name: string; monthly: number; category: CategoryId }[];
  /** Family budgets as this member last saw them (newest `budgetsAt` wins). */
  familyBudgets: Partial<Record<CategoryId, number>>;
  budgetsAt?: string;
  sharedGoals: SharedGoal[];
  /** This member's contribution per shared goal id. */
  contributions: Record<string, number>;
  /** Only when share = 'full': last 90 days, counted rows only. */
  txns?: { date: string; amount: number; type: TxnType; merchant: string; category: CategoryId }[];
}

export interface Household {
  /** 32 hex chars, derived from the secret. */
  id: string;
  name: string;
  /** 32-byte household secret, base64url. Never sent to the server. */
  secret: string;
  createdAt: string;
  /** This device's member id. */
  meId: string;
  /** Other members (from their snapshots + local labels). */
  members: FamilyMember[];
}

export interface FamilyState {
  household: Household | null;
  /** Latest decrypted snapshot per other member id. */
  snapshots: Record<string, FamilySnapshot>;
  /** Family budget per category (local copy, shared in the snapshot). */
  budgets: Partial<Record<CategoryId, number>>;
  budgetsAt?: string;
  sharedGoals: SharedGoal[];
  /** This user's contribution per shared goal id. */
  contributions: Record<string, number>;
  /** What this user shares. */
  share: FamilyShare;
  /** Demo family was removed by the user. */
  demoHidden?: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
}
