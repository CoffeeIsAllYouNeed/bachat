import type { Ionicons } from '@expo/vector-icons';
import type { CoachVoice, ThemeChoice } from '@/data/types';
import type { SettingsPage } from '@/shell/ui';

/** Navigation handed to every settings page. */
export interface SettingsNav {
  /** Opens a sub-page on top of the current one (phone stack / laptop content pane). */
  push: (p: SettingsPage) => void;
  /** Back one page (closes Settings from the home page). */
  back: () => void;
  /** Closes Settings. */
  close: () => void;
}

type IconName = keyof typeof Ionicons.glyphMap;

/** Title + line icon per page. */
export const PAGE_META: Record<SettingsPage, { title: string; icon: IconName }> = {
  home: { title: 'Settings', icon: 'settings-outline' },
  profile: { title: 'Profile', icon: 'person-circle-outline' },
  appearance: { title: 'Appearance', icon: 'color-palette-outline' },
  sections: { title: 'Sections & layout', icon: 'grid-outline' },
  notifications: { title: 'Notifications', icon: 'notifications-outline' },
  money: { title: 'Your money', icon: 'cash-outline' },
  history: { title: 'Version history', icon: 'time-outline' },
  voice: { title: 'Coach voice', icon: 'chatbubble-ellipses-outline' },
  import: { title: 'Add transactions', icon: 'add-circle-outline' },
  sms: { title: 'Read bank SMS', icon: 'chatbubbles-outline' },
  rules: { title: 'Learned rules', icon: 'bulb-outline' },
  export: { title: 'Import & export', icon: 'swap-vertical-outline' },
  review: { title: 'Monthly review', icon: 'document-text-outline' },
  gemini: { title: 'Gemini AI', icon: 'sparkles-outline' },
  privacy: { title: 'Privacy', icon: 'lock-closed-outline' },
  about: { title: 'About Bachat', icon: 'information-circle-outline' },
  developer: { title: 'Developer', icon: 'code-slash-outline' },
  family: { title: 'Family', icon: 'people-outline' },
};

/** Sub-pages that live under another page (laptop tab highlight + back target). */
export const PAGE_PARENT: Partial<Record<SettingsPage, SettingsPage>> = {
  history: 'money',
};

export const THEME_LABEL: Record<ThemeChoice, string> = { dark: 'Dark', light: 'Light', system: 'System' };

export const VOICES: { id: CoachVoice; label: string; sample: string }[] = [
  { id: 'supportive', label: 'Supportive', sample: "You're doing well — food is a little ahead of plan this week." },
  { id: 'straight', label: 'Straight talk', sample: 'Food is ₹1,200 over pace. Ease off for 5 days.' },
  { id: 'calm', label: 'Calm', sample: 'Food is running a bit ahead. No rush — just a heads-up.' },
  { id: 'playful', label: 'Playful', sample: 'Your biryani budget is sprinting ahead — slow it down?' },
];

export function voiceLabel(v: CoachVoice): string {
  return VOICES.find((x) => x.id === v)?.label ?? 'Supportive';
}

/** 22 → "10 PM", 8 → "8 AM", 0 → "12 AM". */
export function hourLabel(h: number): string {
  const n = ((h % 24) + 24) % 24;
  const twelve = n % 12 === 0 ? 12 : n % 12;
  return `${twelve} ${n < 12 ? 'AM' : 'PM'}`;
}

/** "2026-10-31T…" → "31 Oct 2026". */
export function longDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '—';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${d.getDate()} ${m} ${d.getFullYear()}`;
}
