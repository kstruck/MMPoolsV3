// Update-path validation for the HYBRID entry-fee split (PLAN-HYBRID-SPLIT).
//
// The create schema's superRefine covers the wizard; this covers
// `updatePoolSettings`, whose schema is permissive and whose flattener writes
// present keys as given (the same two-door shape as weeklyTiebreakerGate, and
// the same reason it cannot live in the UI).
//
// Pure. The caller evaluates it against the pool read inside the transaction
// that writes, merged with the incoming patch, so the judgement is over the
// settings AS THEY WOULD BE after the save — three different fields can break
// the invariant (the split, payoutMode, entryFee) and any of the three can
// arrive alone.

import { hybridSplitProblem } from '../shared/hybridSplit';

const KEYS = ['settings.hybridSplit', 'settings.payoutMode', 'settings.entryFee'] as const;

export function touchesHybridSplitSettings(patch: Record<string, unknown>): boolean {
  return KEYS.some((k) => k in patch);
}

/**
 * The settings as they would stand after this patch lands. Patch wins per key;
 * absent keys carry the stored value through — exactly what the per-key dotted
 * write will do.
 */
function mergedSettings(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): { payoutMode?: unknown; entryFee?: unknown; hybridSplit?: unknown } {
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (`settings.${key}` in patch ? patch[`settings.${key}`] : stored[key]);
  return { payoutMode: pick('payoutMode'), entryFee: pick('entryFee'), hybridSplit: pick('hybridSplit') };
}

/**
 * Should this save DELETE the stored split?
 *
 * True when the patch moves `payoutMode` away from HYBRID while a split is
 * stored (and the patch does not itself replace the split). Without this the
 * per-key merge leaves the old split behind, `hybridSplitProblem` then refuses
 * the save as "split on a non-hybrid pool", and the payout mode becomes
 * impossible to change — a validation deadlock. (codex P2 on the plan.)
 * Switching back to HYBRID does not resurrect it; the manager re-enters.
 */
export function hybridSplitNeedsClearing(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (!('settings.payoutMode' in patch)) return false;
  if (patch['settings.payoutMode'] === 'HYBRID') return false;
  if ('settings.hybridSplit' in patch) return false; // caller is already deciding its fate
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  return stored.hybridSplit !== undefined && stored.hybridSplit !== null;
}

/** The refusal, or null to allow. Judged AFTER the clearing decision above. */
export function hybridSplitRefusal(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): string | null {
  if (!touchesHybridSplitSettings(patch)) return null;
  // The split exists on the two types that carry payoutMode. Judged on TYPE,
  // not on values: a balanced split written to a Survivor pool would persist a
  // money configuration no Survivor UI or create schema can represent.
  // (codex P2, split r2.) Only refuses when the patch actually carries a
  // split — entryFee edits on other types stay this gate's non-business.
  if (pool?.type !== 'NFL_PICKEM' && pool?.type !== 'NFL_MARGIN') {
    const incoming = 'settings.hybridSplit' in patch ? patch['settings.hybridSplit'] : undefined;
    if (incoming !== undefined && incoming !== null) {
      return "HYBRID_SPLIT_WRONG_TYPE: an entry-fee split only exists on Pick'em and Margin pools.";
    }
    return null;
  }
  const merged = mergedSettings(pool, patch);
  // A save the caller will clear the split on is judged WITHOUT the split —
  // that is the state the write produces.
  if (hybridSplitNeedsClearing(pool, patch)) merged.hybridSplit = undefined;
  return hybridSplitProblem(merged);
}
