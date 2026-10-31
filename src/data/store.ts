import { secureStorage } from '@/services/secureStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SECTIONS } from './categories';
import type {
  CheckInAnswer, CheckInRecord, CorrectionExample, Goal, LearnLog, NudgeLog, Profile, ProfileInfo, ProfileSnapshot, Rule,
  SavedScenario, SectionId, Settings, Txn,
} from './types';
import type { FamilyState } from './types';

/** No household yet; nothing shared. */
export const EMPTY_FAMILY: FamilyState = {
  household: null,
  snapshots: {},
  budgets: {},
  sharedGoals: [],
  contributions: {},
  share: 'totals',
};

/**
 * The one on-device store. Plain data + simple setters only; all derived
 * numbers come from pure functions in src/engine. Persisted to AsyncStorage
 * (phone) / localStorage (web).
 */

export const EMPTY_PROFILE: Profile = {
  onboarded: false,
  monthlyIncome: 0,
  irregularIncome: false,
  rent: 0,
  emis: 0,
  otherFixed: 0,
  emergencyFund: 0,
  emergencyMonths: 6,
  history: [],
};

export const EMPTY_PROFILE_INFO: ProfileInfo = {
  name: '',
  email: '',
  city: '',
  currency: 'INR',
  createdAt: '',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  sectionOrder: SECTIONS.map((s) => s.id),
  voice: 'supportive',
  budgets: {},
  quietStartHour: 22,
  quietEndHour: 8,
  nudgesEnabled: true,
  maxNudgesPerDay: 1,
  reviewReminder: true,
  accent: 'gold',
  numberFont: 'sans',
  compactRows: false,
  hideAmounts: false,
};

export interface BachatState {
  hydrated: boolean;
  txns: Txn[];
  rules: Rule[];
  learnLog: LearnLog[];
  profile: Profile;
  /** Name / email / city (Settings → Profile). */
  profileInfo: ProfileInfo;
  goals: Goal[];
  scenarios: SavedScenario[];
  settings: Settings;
  /** Subscription "Still using it?" answers by merchant key. */
  checkIns: Record<string, CheckInRecord>;
  /** Days the check-in was shown without an answer since the last answer, by merchant key. */
  checkInShown: Record<string, string[]>;
  /** User corrections kept as AI examples (newest last, last 200). */
  corrections: CorrectionExample[];
  /** Alert ids the user dismissed. */
  dismissedAlerts: string[];
  nudges: NudgeLog[];
  /** Family household, member snapshots, family budgets and shared goals (src/services/family.ts). */
  family: FamilyState;

  // ---- setters (no business logic here)
  setHydrated: (v: boolean) => void;
  /** Adds new transactions, skipping any whose `hash` is already stored. Returns how many were added. */
  addTxns: (list: Txn[]) => number;
  /** Replaces matching transactions by id (used by categorise / clean / learn). */
  updateTxns: (list: Txn[]) => void;
  setTxns: (list: Txn[]) => void;
  removeTxn: (id: string) => void;
  addRule: (r: Rule) => void;
  setRules: (list: Rule[]) => void;
  pushLearnLog: (l: LearnLog) => void;
  popLearnLog: () => LearnLog | undefined;
  saveProfile: (p: ProfileSnapshot & { onboarded?: boolean }) => void;
  /** Merges name / email / city; stamps createdAt on the first save. */
  setProfileInfo: (patch: Partial<ProfileInfo>) => void;
  upsertGoal: (g: Goal) => void;
  removeGoal: (id: string) => void;
  /** Keeps the newest 3. */
  saveScenario: (s: SavedScenario) => void;
  removeScenario: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setCheckIn: (merchantKey: string, answer: CheckInAnswer) => void;
  dismissAlert: (id: string) => void;
  logNudge: (n: NudgeLog) => void;
  /** Records the check-in as shown today (only once per 30 days while unanswered). */
  markCheckInShown: (merchantKey: string, day: string) => void;
  addCorrection: (e: CorrectionExample) => void;
  clearCorrections: () => void;
  /** Merges a patch into the family slice. */
  setFamily: (patch: Partial<FamilyState>) => void;
  /** Wipes everything (Settings → Developer → Clear all data). */
  resetAll: () => void;
}

const initial = {
  txns: [] as Txn[],
  rules: [] as Rule[],
  learnLog: [] as LearnLog[],
  profile: EMPTY_PROFILE,
  profileInfo: EMPTY_PROFILE_INFO,
  goals: [] as Goal[],
  scenarios: [] as SavedScenario[],
  settings: DEFAULT_SETTINGS,
  checkIns: {} as BachatState['checkIns'],
  dismissedAlerts: [] as string[],
  nudges: [] as NudgeLog[],
  checkInShown: {} as Record<string, string[]>,
  corrections: [] as CorrectionExample[],
  family: EMPTY_FAMILY,
};

export const useStore = create<BachatState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ...initial,

      setHydrated: (v) => set({ hydrated: v }),

      addTxns: (list) => {
        const have = new Set(get().txns.map((t) => t.hash));
        const fresh: Txn[] = [];
        for (const t of list) {
          if (have.has(t.hash)) continue;
          have.add(t.hash);
          fresh.push(t);
        }
        if (fresh.length) set({ txns: [...get().txns, ...fresh].sort((a, b) => b.date.localeCompare(a.date)) });
        return fresh.length;
      },
      updateTxns: (list) => {
        if (!list.length) return;
        const byId = new Map(list.map((t) => [t.id, t]));
        set({ txns: get().txns.map((t) => byId.get(t.id) ?? t) });
      },
      setTxns: (list) => set({ txns: [...list].sort((a, b) => b.date.localeCompare(a.date)) }),
      removeTxn: (id) => set({ txns: get().txns.filter((t) => t.id !== id) }),

      addRule: (r) => set({ rules: [...get().rules, r] }),
      setRules: (list) => set({ rules: list }),
      pushLearnLog: (l) => set({ learnLog: [...get().learnLog, l].slice(-50) }),
      popLearnLog: () => {
        const log = get().learnLog;
        const last = log[log.length - 1];
        if (last) set({ learnLog: log.slice(0, -1) });
        return last;
      },

      saveProfile: (p) => {
        const prev = get().profile;
        const snapshot: ProfileSnapshot = {
          monthlyIncome: p.monthlyIncome,
          irregularIncome: p.irregularIncome,
          rent: p.rent,
          emis: p.emis,
          otherFixed: p.otherFixed,
          emergencyFund: p.emergencyFund,
          emergencyMonths: p.emergencyMonths,
        };
        const at = new Date().toISOString();
        set({
          profile: {
            ...snapshot,
            onboarded: p.onboarded ?? prev.onboarded,
            updatedAt: at,
            history: [...prev.history, { at, snapshot }].slice(-100),
          },
        });
      },

      setProfileInfo: (patch) => {
        const prev = get().profileInfo;
        const next: ProfileInfo = { ...prev, ...patch, currency: 'INR' };
        if (!next.createdAt) next.createdAt = new Date().toISOString();
        set({ profileInfo: next });
      },

      upsertGoal: (g) => {
        const goals = get().goals;
        set({ goals: goals.some((x) => x.id === g.id) ? goals.map((x) => (x.id === g.id ? g : x)) : [...goals, g] });
      },
      removeGoal: (id) => set({ goals: get().goals.filter((g) => g.id !== id) }),

      saveScenario: (s) => set({ scenarios: [...get().scenarios.filter((x) => x.id !== s.id), s].slice(-3) }),
      removeScenario: (id) => set({ scenarios: get().scenarios.filter((s) => s.id !== id) }),

      setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      setCheckIn: (merchantKey, answer) => {
        const prev = get().checkIns[merchantKey];
        const history = prev ? [...(prev.history ?? []), { answer: prev.answer, at: prev.at }].slice(-6) : [];
        const shown = { ...get().checkInShown };
        delete shown[merchantKey];
        set({
          checkIns: { ...get().checkIns, [merchantKey]: { answer, at: new Date().toISOString(), history } },
          checkInShown: shown,
        });
      },
      markCheckInShown: (merchantKey, day) => {
        const list = get().checkInShown[merchantKey] ?? [];
        const last = list[list.length - 1];
        if (last) {
          const gap = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000;
          if (!(gap >= 30)) return;
        }
        set({ checkInShown: { ...get().checkInShown, [merchantKey]: [...list, day].slice(-4) } });
      },
      addCorrection: (e) => set({ corrections: [...get().corrections, e].slice(-200) }),
      clearCorrections: () => set({ corrections: [] }),
      setFamily: (patch) => set({ family: { ...get().family, ...patch } }),
      dismissAlert: (id) => set({ dismissedAlerts: [...new Set([...get().dismissedAlerts, id])] }),
      logNudge: (n) => set({ nudges: [...get().nudges, n].slice(-200) }),

      resetAll: () => set({ ...initial }),
    }),
    {
      name: 'bachat-store-v1',
      // Encrypted on the phone (key in the OS keystore); plain localStorage on the web. See src/services/secureStorage.ts.
      storage: createJSONStorage(() => secureStorage),
      // v1: big numbers default to the sans (the serif default was dropped), so older saves move to sans once.
      version: 1,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<BachatState>;
        if (version < 1 && p.settings && p.settings.numberFont === 'serif') {
          return { ...p, settings: { ...p.settings, numberFont: 'sans' } } as BachatState;
        }
        return p as BachatState;
      },
      partialize: (s) => ({
        txns: s.txns,
        rules: s.rules,
        learnLog: s.learnLog,
        profile: s.profile,
        profileInfo: s.profileInfo,
        goals: s.goals,
        scenarios: s.scenarios,
        settings: s.settings,
        checkIns: s.checkIns,
        dismissedAlerts: s.dismissedAlerts,
        nudges: s.nudges,
        checkInShown: s.checkInShown,
        corrections: s.corrections,
        family: s.family,
      }),
      // New settings keys added in later versions get their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BachatState>;
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          profile: { ...EMPTY_PROFILE, ...(p.profile ?? {}) },
          profileInfo: { ...EMPTY_PROFILE_INFO, ...(p.profileInfo ?? {}) },
          family: { ...EMPTY_FAMILY, ...(p.family ?? {}) },
        };
      },
      // Mark hydrated even when reading storage failed (state is undefined then),
      // otherwise the app would sit on the loading spinner forever.
      onRehydrateStorage: () => (state) => {
        if (state) state.setHydrated(true);
        else useStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Small id helper (no crypto dependency). */
export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayISO(): string {
  return isoDate(new Date());
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Re-export for convenience. */
export type { SectionId };
