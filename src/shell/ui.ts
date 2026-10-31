import { create } from 'zustand';
import { loadDemo } from '@/services/ingest';

/**
 * Shell-level UI state (not persisted): which shell sheet is open.
 * Only one shell sheet is open at a time (React Native Modals don't stack well).
 */
export type ShellSheet = 'settings' | 'report' | 'import' | null;

/** Settings sub-pages (src/shell/settings). 'home' is the phone list / laptop default. */
export type SettingsPage =
  | 'home'
  | 'profile'
  | 'appearance'
  | 'sections'
  | 'notifications'
  | 'money'
  | 'history'
  | 'voice'
  | 'import'
  | 'sms'
  | 'rules'
  | 'export'
  | 'review'
  | 'gemini'
  | 'privacy'
  | 'about'
  | 'developer'
  | 'family';

const SETTINGS_PAGES: readonly SettingsPage[] = [
  'home', 'profile', 'appearance', 'sections', 'notifications', 'money', 'history', 'voice',
  'import', 'sms', 'rules', 'export', 'review', 'gemini', 'privacy', 'about', 'developer',
  'family',
];

export function isSettingsPage(x: unknown): x is SettingsPage {
  return typeof x === 'string' && (SETTINGS_PAGES as readonly string[]).includes(x);
}

export interface ShellUI {
  sheet: ShellSheet;
  /** Page Settings should show when it opens (or jump to while open). */
  settingsPage: SettingsPage;
  /** Bumped on every openSettings() so asking for the same page again still navigates. */
  settingsNonce: number;
  /**
   * True while the demo loads from inside the app (Home / Settings). loadDemo()
   * resets the store first (profile.onboarded → false), and the root layout
   * would otherwise swap the whole app for Onboarding until it finishes.
   */
  keepShell: boolean;
  /** Opens one shell sheet (closes any other). */
  open: (s: Exclude<ShellSheet, null>) => void;
  /** Closes the open shell sheet. */
  close: () => void;
}

/** Shell sheet store: Settings, Monthly review (ReportSheet) and Add transactions. */
export const useShellUI = create<ShellUI>()((set) => ({
  sheet: null,
  settingsPage: 'home',
  settingsNonce: 0,
  keepShell: false,
  open: (s) => set({ sheet: s }),
  close: () => set({ sheet: null }),
}));

/**
 * Opens Settings from anywhere, optionally on a sub-page
 * (`openSettings('profile')`). Call it as `() => openSettings()` from onPress;
 * an unknown argument still falls back to Settings home at runtime.
 */
export function openSettings(page?: SettingsPage): void {
  const target: SettingsPage = isSettingsPage(page) ? page : 'home';
  useShellUI.setState((s) => ({ sheet: 'settings', settingsPage: target, settingsNonce: s.settingsNonce + 1 }));
}

/** Opens the monthly review (ReportSheet) from anywhere. */
export function openReport(): void {
  useShellUI.getState().open('report');
}

/** Opens the "Add transactions" sheet (Paste SMS / CSV / PDF) from anywhere. */
export function openImport(): void {
  useShellUI.getState().open('import');
}

/** Loads the demo while keeping the app shell on screen (see `keepShell`). */
export async function loadDemoInApp(): Promise<string> {
  useShellUI.setState({ keepShell: true });
  try {
    return await loadDemo();
  } finally {
    useShellUI.setState({ keepShell: false });
  }
}

/**
 * Switches from one sheet to another with a short gap, so the closing Modal
 * finishes before the next one opens (iOS can drop a Modal opened mid-dismiss).
 */
export function switchSheet(to: Exclude<ShellSheet, null>): void {
  useShellUI.getState().close();
  setTimeout(() => useShellUI.getState().open(to), 350);
}
