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
 * Are these two values of trio field `key` the same setting?
 *
 * `null` and `undefined` are the same absence (the clearing write stores
 * deletes; older docs simply lack the key). The split object compares by its
 * two NAMED numeric fields, never by serialization: `JSON.stringify` preserves
 * insertion order, so a Firestore read returning `{seasonPerEntry,
 * weeklyPerEntry}` against a UI object built the other way round would report
 * equal splits as different — and every ordinary save would re-enter exactly
 * the transaction path this module exists to avoid. (codex P2, gate-fix r1.)
 */
function sameTrioValue(key: string, a: unknown, b: unknown): boolean {
  const av = a === null || a === undefined ? null : a;
  const bv = b === null || b === undefined ? null : b;
  if (av === null || bv === null) return av === bv;
  if (key === 'hybridSplit') {
    const ao = av as { weeklyPerEntry?: unknown; seasonPerEntry?: unknown };
    const bo = bv as { weeklyPerEntry?: unknown; seasonPerEntry?: unknown };
    return ao.weeklyPerEntry === bo.weeklyPerEntry && ao.seasonPerEntry === bo.seasonPerEntry;
  }
  return av === bv;
}

/**
 * The trio keys this patch carries whose value EQUALS what is already stored —
 * the keys the caller should DELETE from the patch before writing.
 *
 * Why deletion, and not merely skipping the transaction for a no-op patch
 * (codex P1, gate-fix r1 — the first version of this fix did the latter and it
 * was wrong): the update schema permits SPARSE patches. A stale
 * `{settings.entryFee: 25}` that matches the pre-transaction read looks like a
 * no-op, but if a concurrent manager meanwhile committed `$30 = $20 + $10`,
 * plain-writing the fee back to 25 persists an invalid `25 ≠ 20 + 10` — and
 * routing it through the transaction does not help either, because the refusal
 * was skipped on the same stale comparison. A key that is NEVER WRITTEN cannot
 * clobber anything under any interleaving; that is the whole safety argument,
 * and it is stronger than the one it replaces.
 *
 * The perf win survives intact: the manager UI re-sends unchanged
 * `entryFee`/`payoutMode` on every save, those keys strip, and
 * `touchesHybridSplitSettings` over the STRIPPED patch becomes a change test —
 * presence-keying and change-keying collapse into the same predicate.
 */
export function hybridNoOpKeys(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): string[] {
  const stored = (pool?.settings ?? {}) as Record<string, unknown>;
  return KEYS.filter((k) => {
    if (!(k in patch)) return false;
    const key = k.slice('settings.'.length);
    return sameTrioValue(key, patch[k], stored[key]);
  });
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
