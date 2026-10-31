/**
 * Pace nudges: a flexible category running well ahead of where its budget
 * says it should be by today. At most one local notification a day, never
 * in quiet hours or while snoozed. Text is deterministic (4 coach voices).
 */

import { Platform } from 'react-native';
import { category } from '@/data/categories';
import { isoDate, useStore } from '@/data/store';
import type { CategoryId, CoachVoice, Profile, Settings, Txn } from '@/data/types';
import { budgetLines } from '@/engine/budgets';
import { monthDays } from '@/engine/periods';
import { money, ym } from '@/theme/format';

export interface Drift {
  category: CategoryId;
  spent: number;
  budget: number;
  /** Budget × (day of month / days in month) */
  expectedByToday: number;
  /** spent / expectedByToday */
  ratio: number;
  /** used − expected share ≥ 15 points and ≥ ₹500 over pace */
  meaningful: boolean;
}

/** Lumpy or fixed categories: paid once a month, so "pace" means nothing. */
const NO_PACE: CategoryId[] = ['rent', 'emi', 'bills', 'subscriptions'];

/** Spend vs budget pace for each flexible category this month (most over pace first). */
export function drifts(txns: Txn[], overrides: Settings['budgets'], profile: Profile, today: string): Drift[] {
  const m = ym(today);
  const day = Number(today.slice(8, 10));
  const share = day / monthDays(m);
  const out: Drift[] = [];
  for (const line of budgetLines(txns, overrides, profile, m, today)) {
    if (NO_PACE.includes(line.category) || category(line.category).fixed) continue;
    if (line.budget <= 0) continue;
    const expectedByToday = line.budget * share;
    const used = line.spent / line.budget;
    const overPace = line.spent - expectedByToday;
    out.push({
      category: line.category,
      spent: line.spent,
      budget: line.budget,
      expectedByToday: Math.round(expectedByToday),
      ratio: expectedByToday > 0 ? line.spent / expectedByToday : 0,
      meaningful: used - share >= 0.15 && overPace >= 500,
    });
  }
  return out.sort((a, b) => (b.spent - b.expectedByToday) - (a.spent - a.expectedByToday));
}

/** The nudge sentence for one drift, in the chosen coach voice. */
export function nudgeText(d: Drift, voice: CoachVoice): string {
  const name = category(d.category).label;
  const lower = name.toLowerCase();
  const ahead = money(Math.max(0, d.spent - d.expectedByToday));
  const spent = money(d.spent);
  const pace = money(d.expectedByToday);
  switch (voice) {
    case 'straight':
      return `${name}: ${spent} spent, pace says ${pace}. That's ${ahead} over pace with the month still running.`;
    case 'calm':
      return `A gentle heads-up: ${lower} is about ${ahead} ahead of its usual pace this month. No rush — just worth a look.`;
    case 'playful':
      return `Your ${lower} budget is sprinting 🏃 — ${spent} already, when the pace was ${pace}. Time for a slower lap?`;
    case 'supportive':
    default:
      return `${name} is running a bit ahead: ${spent} so far vs about ${pace} expected by today. A few lighter days will bring it back on track.`;
  }
}

function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

type NotificationsModule = typeof import('expo-notifications');
let handlerSet = false;

/** Loads expo-notifications lazily (not on web) so a missing native module can't crash startup. */
async function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    const N = await import('expo-notifications');
    if (!handlerSet) {
      handlerSet = true;
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    }
    return N;
  } catch {
    return null;
  }
}

/** Asks for permission to show local nudges (false on web or when declined). */
export async function requestNotificationPermission(): Promise<boolean> {
  const N = await loadNotifications();
  if (!N) return false;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('nudges', {
        name: 'Spending nudges',
        importance: N.AndroidImportance.DEFAULT,
      });
    }
    const now = await N.getPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    const asked = await N.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Checks pace once (max settings.maxNudgesPerDay a day, respects quiet hours and snooze),
 * shows a local notification when permitted, logs it and returns the text.
 */
export async function maybeNudge(): Promise<string | null> {
  const s = useStore.getState();
  const { settings } = s;
  if (!settings.nudgesEnabled || !s.txns.length) return null;
  const now = new Date();
  if (settings.snoozeUntil && settings.snoozeUntil > now.toISOString()) return null;
  if (inQuietHours(now.getHours(), settings.quietStartHour, settings.quietEndHour)) return null;
  const today = isoDate(now);
  const sameDay = (iso: string) => {
    const d = new Date(iso);
    return !isNaN(d.getTime()) && isoDate(d) === today;
  };
  const maxPerDay = Math.max(1, Math.min(3, settings.maxNudgesPerDay || 1));
  if (s.nudges.filter((n) => sameDay(n.at)).length >= maxPerDay) return null;

  // Don't repeat a category nudged in the last 7 days.
  const weekAgo = now.getTime() - 7 * 86400000;
  const recent = new Set(s.nudges.filter((n) => new Date(n.at).getTime() >= weekAgo).map((n) => n.category));
  const pick = drifts(s.txns, settings.budgets, s.profile, today).find((d) => d.meaningful && !recent.has(d.category));
  if (!pick) return null;

  const text = nudgeText(pick, settings.voice);
  const N = await loadNotifications();
  if (N) {
    try {
      const perm = await N.getPermissionsAsync();
      if (perm.granted) {
        if (Platform.OS === 'android') {
          await N.setNotificationChannelAsync('nudges', { name: 'Spending nudges', importance: N.AndroidImportance.DEFAULT });
        }
        // Lock screen: no amounts while "Hide amounts" or App lock is on (the in-app log keeps the full text).
        const quiet = !!settings.hideAmounts || !!settings.appLock;
        const body = quiet ? `${category(pick.category).label} is ahead of its usual pace. Open Bachat to see.` : text;
        await N.scheduleNotificationAsync({
          content: { title: `${category(pick.category).emoji} ${category(pick.category).label} pace`, body },
          // Immediate; on Android it goes to the "nudges" channel made in requestNotificationPermission.
          trigger: Platform.OS === 'android' ? { channelId: 'nudges' } : null,
        });
      }
    } catch {
      // Notification failed: Budgets and Save more still show the drift in the app.
    }
  }
  useStore.getState().logNudge({ at: now.toISOString(), category: pick.category, text });
  return text;
}
