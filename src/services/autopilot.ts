/**
 * Autopilot: after each refresh / import Bachat does the safe chores on its own.
 *  (a) AI-categorises low-confidence rows with the user's own corrections as examples (refresh only;
 *      imports already do this in ingest),
 *  (b) re-detects recurring payments and their alerts,
 *  (c) recomputes Save more ideas and off-plan categories,
 *  (d) re-checks goal plans,
 *  (e) fires at most the allowed nudges (maybeNudge keeps the daily cap, quiet hours, snooze).
 * It never changes user-owned data (budgets, goals, profile): a goal falling behind is only a
 * suggestion line. The result is one short line ("Autopilot: sorted 6 · 2 ideas"), or null when
 * nothing happened. The last run is kept in memory for Settings → AI.
 */

import { create } from 'zustand';
import { todayISO, useStore } from '@/data/store';
import type { Txn } from '@/data/types';
import { categorizeWithAI } from '@/engine/categorize';
import { cleanTxns } from '@/engine/clean';
import { drifts, maybeNudge } from '@/engine/nudges';
import { detectRecurring, recurringAlerts } from '@/engine/recurring';
import { savingIdeas } from '@/engine/savings';
import { baseline, goalFeasibility, goalSaved } from '@/engine/scenario';
import { aiAvailable } from '@/services/gemini';
import { showSnack } from '@/ui/Snackbar';
import { recordAgentRun } from '@/services/aiAgents';

export interface AutopilotRun {
  /** ISO time */
  at: string;
  /** Up to 3 short lines, no amounts. */
  lines: string[];
  summary: string | null;
}

/** Last run (not persisted). */
export const useAutopilot = create<{ last: AutopilotRun | null }>()(() => ({ last: null }));

const seenIdeas = new Set<string>();
const seenAlerts = new Set<string>();
const behindGoals = new Set<string>();
let primed = false;
let running: Promise<AutopilotRun> | null = null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Snapshot {
  ideas: string[];
  alerts: string[];
  behind: { id: string; name: string }[];
  offPlan: number;
}

function snapshot(today: string): Snapshot {
  const s = useStore.getState();
  let ideas: string[] = [];
  let alerts: string[] = [];
  let behind: { id: string; name: string }[] = [];
  let offPlan = 0;
  try {
    ideas = savingIdeas(
      { txns: s.txns, settings: s.settings, profile: s.profile, checkIns: s.checkIns, dismissedAlerts: s.dismissedAlerts, checkInShown: s.checkInShown },
      today,
    ).map((i) => i.id);
  } catch {
    ideas = [];
  }
  try {
    alerts = recurringAlerts(detectRecurring(s.txns, today), today, s.dismissedAlerts).map((a) => a.id);
  } catch {
    alerts = [];
  }
  try {
    offPlan = drifts(s.txns, s.settings.budgets, s.profile, today).filter((d) => d.meaningful).length;
  } catch {
    offPlan = 0;
  }
  try {
    const goals = s.goals.filter((g) => !g.archived && g.dueDate);
    if (goals.length) {
      const base = baseline();
      behind = goals
        .filter((g) => !goalFeasibility(base, { id: g.id, target: g.target, saved: goalSaved(g), dueDate: g.dueDate }).onTrack)
        .map((g) => ({ id: g.id, name: g.name }));
    }
  } catch {
    behind = [];
  }
  return { ideas, alerts, behind, offPlan };
}

/** Remembers what already exists, so the first run only reports what is new. */
function prime(): void {
  if (primed) return;
  primed = true;
  const snap = snapshot(todayISO());
  snap.ideas.forEach((id) => seenIdeas.add(id));
  snap.alerts.forEach((id) => seenAlerts.add(id));
  snap.behind.forEach((g) => behindGoals.add(g.id));
}

/** (a) Asks the AI about rows still waiting for review; merges onto the current rows. Returns rows changed. */
async function sortRows(): Promise<number> {
  if (!aiAvailable()) return 0;
  const review = useStore.getState().txns.filter((t) => t.needsReview && t.catSource !== 'user' && t.catSource !== 'rule');
  if (!review.length) return 0;
  let out: Txn[] = [];
  try {
    out = await categorizeWithAI(review);
  } catch {
    out = [];
  }
  if (!out.length) return 0;
  // The user may have corrected rows meanwhile: never overwrite those.
  const cur = new Map(useStore.getState().txns.map((t) => [t.id, t]));
  const merged = out.filter((u) => {
    const c = cur.get(u.id);
    return !!c && c.catSource !== 'user' && c.catSource !== 'rule' && (u.category !== c.category || u.suggested !== c.suggested);
  });
  if (!merged.length) return 0;
  useStore.getState().updateTxns(merged);
  useStore.getState().setTxns(cleanTxns(useStore.getState().txns));
  return merged.length;
}

async function runOnce(reason: 'refresh' | 'import'): Promise<AutopilotRun> {
  const today = todayISO();
  prime();
  const sorted = reason === 'refresh' ? await sortRows().catch(() => 0) : 0;

  const snap = snapshot(today);
  const newIdeas = snap.ideas.filter((id) => !seenIdeas.has(id));
  const newAlerts = snap.alerts.filter((id) => !seenAlerts.has(id));
  const newBehind = snap.behind.filter((g) => !behindGoals.has(g.id));
  newIdeas.forEach((id) => seenIdeas.add(id));
  newAlerts.forEach((id) => seenAlerts.add(id));
  behindGoals.clear();
  snap.behind.forEach((g) => behindGoals.add(g.id));

  let nudged = false;
  try {
    nudged = !!(await maybeNudge());
  } catch {
    nudged = false;
  }

  const parts: string[] = [];
  if (sorted) parts.push(`sorted ${sorted}`);
  if (newIdeas.length) parts.push(plural(newIdeas.length, 'idea'));
  if (newAlerts.length) parts.push(plural(newAlerts.length, 'alert'));
  if (newBehind.length) parts.push(plural(newBehind.length, 'goal behind', 'goals behind'));
  const summary = parts.length ? `Autopilot: ${parts.join(' · ')}` : null;

  const lines: string[] = [];
  if (sorted) lines.push(`Sorted ${plural(sorted, 'transaction')}`);
  if (newIdeas.length || newAlerts.length) {
    lines.push([newIdeas.length ? plural(newIdeas.length, 'new idea') : '', newAlerts.length ? plural(newAlerts.length, 'new alert') : ''].filter(Boolean).join(' · '));
  }
  // Suggestion only: re-planning a goal is the user's call.
  if (newBehind.length) lines.push(`${newBehind[0].name} is behind plan · see Goals`);
  else if (snap.offPlan) lines.push(`Off plan in ${plural(snap.offPlan, 'category', 'categories')}`);
  if (nudged && lines.length < 3) lines.push('Sent a nudge');
  if (!lines.length) lines.push('Nothing new');

  const run: AutopilotRun = { at: new Date().toISOString(), lines: lines.slice(0, 3), summary };
  useAutopilot.setState({ last: run });
  return run;
}

/** Runs the autopilot once (concurrent calls share the run). Never throws. */
export async function runAutopilot(reason: 'refresh' | 'import'): Promise<AutopilotRun> {
  if (running) return running;
  running = runOnce(reason)
    .then((r) => {
      recordAgentRun('autopilot', true);
      return r;
    })
    .catch((): AutopilotRun => ({ at: new Date().toISOString(), lines: ['Skipped (error)'], summary: null }))
    .finally(() => {
      running = null;
    });
  return running;
}

let watching = false;

/**
 * After new transactions land (any import: SMS, CSV, PDF, demo), run the autopilot once the
 * import settles and show its line in the snackbar. Ignores hydration and deletions.
 */
export function watchImports(): void {
  if (watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s, prev) => {
    if (!s.hydrated) return;
    if (!prev.hydrated) {
      prime();
      return;
    }
    if (s.txns.length <= prev.txns.length) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runAutopilot('import').then((r) => {
        if (r.summary) showSnack(r.summary, undefined, false);
      });
    }, 2000);
  });
  if (useStore.getState().hydrated) prime();
}
