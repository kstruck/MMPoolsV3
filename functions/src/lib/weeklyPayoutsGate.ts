// Update-path validation for the payout PLACE LISTS (PLAN-PAYMENT-LEDGER T1 / D1 / K9).
//
// The create schemas validate `payouts` and `weeklyPayouts` for the wizard;
// this covers `updatePoolSettings`, whose schema is permissive and whose
// flattener writes present keys as given — the same two-door shape as
// hybridSplitGate, and the same reason it cannot live in the UI.
//
// Pure. Judged against the pool read INSIDE the transaction that writes,
// merged with the incoming patch, so the judgement is over the settings AS
// THEY WOULD BE after the save: `weeklyPayouts` on a non-HYBRID mode is
// refused, and a mode change AWAY from HYBRID deletes any stored
// `weeklyPayouts` in the same write (the exact pattern `hybridSplit` uses) so
// the field is never stranded and the mode never deadlocks.

import { payoutsSchema, weeklyPayoutsSchema } from '../shared/schemas/common';
import { weeklyPayoutsProblem } from '../shared/schemas/nfl';

const KEYS = ['settings.payouts', 'settings.weeklyPayouts', 'settings.payoutMode'] as const;

export function touchesPayoutLists(patch: Record<string, unknown>): boolean {
  return KEYS.some((k) => k in patch);
}

function mergedSettings(pool: Record<string, unknown> | undefined, patch: Record<string, unknown>): { payoutMode?: unknown; payouts?: unknown; weeklyPayouts?: unknown } {
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (`settings.${key}` in patch ? patch[`settings.${key}`] : stored[key]);
  return { payoutMode: pick('payoutMode'), payouts: pick('payouts'), weeklyPayouts: pick('weeklyPayouts') };
}

/**
 * Should this save DELETE the stored `weeklyPayouts`? True when the patch moves
 * `payoutMode` away from HYBRID while a weekly list is stored and the patch
 * does not itself replace it. Switching back does not resurrect it.
 */
export function weeklyPayoutsNeedsClearing(pool: Record<string, unknown> | undefined, patch: Record<string, unknown>): boolean {
  if (!('settings.payoutMode' in patch)) return false;
  if (patch['settings.payoutMode'] === 'HYBRID') return false;
  if ('settings.weeklyPayouts' in patch) return false;
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  return stored.weeklyPayouts !== undefined && stored.weeklyPayouts !== null;
}

/** The refusal, or null to allow. Judged AFTER the clearing decision above. */
export function payoutListsRefusal(pool: Record<string, unknown> | undefined, patch: Record<string, unknown>): string | null {
  if (!touchesPayoutLists(patch)) return null;
  const merged = mergedSettings(pool, patch);
  if (weeklyPayoutsNeedsClearing(pool, patch)) merged.weeklyPayouts = undefined;
  // `payouts` — only when the patch carries it (a mode-only save must not be
  // refused for a legacy list it did not touch; the census says there are none,
  // but the gate is judged on what THIS save writes).
  if ('settings.payouts' in patch && merged.payouts !== undefined && merged.payouts !== null) {
    const r = payoutsSchema.safeParse(merged.payouts);
    if (!r.success) return `PAYOUTS_INVALID: ${r.error.issues[0]?.message ?? 'malformed payouts'}`;
  }
  if (merged.weeklyPayouts !== undefined && merged.weeklyPayouts !== null) {
    // Only Pick'em / Margin carry a payoutMode at all (same TYPE judgement as the split).
    if (pool?.type !== 'NFL_PICKEM' && pool?.type !== 'NFL_MARGIN') {
      return "WEEKLY_PAYOUTS_WRONG_TYPE: a weekly place list only exists on Pick'em and Margin pools.";
    }
    const r = weeklyPayoutsSchema.safeParse(merged.weeklyPayouts);
    if (!r.success) return `WEEKLY_PAYOUTS_INVALID: ${r.error.issues[0]?.message ?? 'malformed weeklyPayouts'}`;
    const wp = weeklyPayoutsProblem(merged);
    if (wp) return wp;
  }
  return null;
}
