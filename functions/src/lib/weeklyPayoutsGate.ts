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

/** Two place lists are the same setting when their (rank, percentage) rows match, order-insensitively; bonuses compared by (name, percentage). null/undefined = the same absence. */
function sameList(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const o = v as { places?: Array<{ rank?: unknown; percentage?: unknown }>; bonuses?: Array<{ name?: unknown; percentage?: unknown }> };
    const places = [...(o.places ?? [])].map(p => `${p.rank}:${p.percentage}`).sort();
    const bonuses = [...(o.bonuses ?? [])].map(b => `${b.name ?? ''}:${b.percentage}`).sort();
    return JSON.stringify([places, bonuses]);
  };
  return norm(a) === norm(b);
}

/**
 * The list keys this patch carries whose value EQUALS what is stored — the
 * keys the caller should DELETE from the patch before writing (the manager UI
 * re-sends the whole settings map on every save; an unchanged `payouts` must
 * not route a contact-email edit through the transaction — same reasoning as
 * `hybridNoOpKeys`, and a key never written cannot clobber anything).
 */
export function payoutListsNoOpKeys(pool: Record<string, unknown> | undefined, patch: Record<string, unknown>): string[] {
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  return (['settings.payouts', 'settings.weeklyPayouts'] as const).filter(k => k in patch && sameList(patch[k], stored[k.slice('settings.'.length)]));
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

/**
 * Replace the list values in the patch with their PARSED shape (defaults
 * applied, unknown keys stripped) so what is stored is exactly what was
 * validated — `weeklyPayouts: {}` becomes `{ places: [] }`, never a shapeless
 * object that `weeklyPlacesFor` would fall through to `payouts` on (codex r3
 * on #470). Call AFTER `payoutListsRefusal` returned null; invalid values are
 * left alone (the refusal already threw).
 */
export function normalizePayoutListsPatch(patch: Record<string, unknown>): void {
  if ('settings.payouts' in patch && patch['settings.payouts'] !== null && patch['settings.payouts'] !== undefined) {
    const r = payoutsSchema.safeParse(patch['settings.payouts']);
    if (r.success) patch['settings.payouts'] = r.data;
  }
  if ('settings.weeklyPayouts' in patch && patch['settings.weeklyPayouts'] !== null && patch['settings.weeklyPayouts'] !== undefined) {
    const r = weeklyPayoutsSchema.safeParse(patch['settings.weeklyPayouts']);
    if (r.success) patch['settings.weeklyPayouts'] = r.data;
  }
}

/**
 * The create-path twin (codex r4 on #470): createNFLPool persists the create
 * envelope as given after `validateCreateInput` GATES it, so the parsed
 * defaults/stripping never reach the document. Normalize the two lists on the
 * settings object in place, and drop `weeklyPayouts` on the types whose schema
 * strips it (everything but Pick'em / Margin).
 */
export function normalizeCreatePayoutLists(type: unknown, settings: Record<string, unknown> | undefined): void {
  if (!settings || typeof settings !== 'object') return;
  if (settings.payouts !== undefined && settings.payouts !== null) {
    const r = payoutsSchema.safeParse(settings.payouts);
    if (r.success) settings.payouts = r.data;
  }
  if (type !== 'NFL_PICKEM' && type !== 'NFL_MARGIN') {
    delete settings.weeklyPayouts;
    return;
  }
  if (settings.weeklyPayouts !== undefined && settings.weeklyPayouts !== null) {
    const r = weeklyPayoutsSchema.safeParse(settings.weeklyPayouts);
    if (r.success) settings.weeklyPayouts = r.data;
  }
}
