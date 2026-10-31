import { cleanTxns } from '@/engine/clean';
import { useStore } from '@/data/store';
import { runAutopilot, watchImports } from '@/services/autopilot';
import { familySyncConfigured, syncFamily } from '@/services/familySync';
import { showSnack } from '@/ui/Snackbar';

// Imports (SMS, CSV, PDF, demo) trigger the autopilot once they settle.
watchImports();

/**
 * Header "Refresh": re-run cleaning (transfers / card bills / refunds), then the
 * autopilot (AI-sorts rows waiting for review, re-checks recurring, Save more,
 * goals, maybe nudges). Never throws. Returns a short status line; the
 * autopilot line also goes to the snackbar.
 */
export async function refreshAll(): Promise<string> {
  try {
    const s = useStore.getState();
    if (!s.txns.length) return 'Nothing to refresh yet';
    s.updateTxns(cleanTxns(s.txns));
    if (familySyncConfigured) void syncFamily().catch(() => undefined);
    const run = await runAutopilot('refresh');
    const left = useStore.getState().txns.filter((t) => t.needsReview).length;
    const tail = left ? ` · ${left} need${left === 1 ? 's' : ''} a category` : '';
    if (run.summary) {
      showSnack(run.summary, undefined, false);
      return run.summary;
    }
    return `Refreshed${tail}`;
  } catch {
    return 'Refresh failed — your data is unchanged';
  }
}
