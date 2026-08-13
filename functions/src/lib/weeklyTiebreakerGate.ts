// Once-submitted rejection for the weekly tie-breaker rule
// (PLAN-WEEKLY-TIEBREAKERS §5).
//
// WHY A SERVER GATE AND NOT UI GATING. Same reason as its sibling
// `survivorSettingsGate.ts`: the callable stays reachable regardless of what
// the UI offers, and a super-admin bypasses the UI entirely. The refusal has to
// live where the write happens.
//
// WHY THE LINE IS **SUBMISSION**, NOT **SCORING**. This is where it differs
// from the survivor gate it is modelled on, and the difference is the whole
// point (codex P1, plan rounds 11a/11b — recorded as R1.1 and R2.1 in
// PLAN-WEEKLY-TIEBREAKERS-REVIEW-LOG.md).
//
// `poolHasScoredWeek` asks "has the scorer published anything". That is exactly
// right for the survivor parity settings, because the scorer RE-APPLIES them on
// every rescore. It is the wrong question here. This setting changes what a
// number a member ALREADY TYPED means, and that harm lands the moment they type
// it — a whole weekend before anything is scored:
//
//   * MNF_COMBINED -> MNF_LAST_GAME after submissions: a guess at a two-game
//     total is silently re-read as a guess at one game.
//   * NONE -> either MNF rule after submissions: members were NEVER ASKED, so
//     nobody has a prediction at all, and the scorer's `?? 0` read would score
//     everyone as having predicted 0.
//
// The second case is why the evidence test is an OR: under NONE the sheet sends
// no `tiebreakerPrediction`, so a gate keyed only on stored tiebreaker values is
// vacuously satisfied on exactly the pools where the switch does most damage.
//
// Pure, so every refusal is unit-testable rather than inferred from a
// transaction. The caller evaluates it INSIDE the transaction that writes, with
// the pool and the entries read in that same transaction.

import { effectiveWeeklyTiebreaker } from '../shared/nflTiebreaker';
import { poolHasScoredWeek } from './survivorSettingsGate';

/** The field this gate protects, as it appears in a dotted patch. */
export const WEEKLY_TIEBREAKER_SETTING_KEY = 'settings.weeklyTiebreaker';

export function touchesWeeklyTiebreakerSetting(patch: Record<string, unknown>): boolean {
  return WEEKLY_TIEBREAKER_SETTING_KEY in patch;
}

/**
 * Is the patch actually CHANGING the effective rule?
 *
 * By effective value, not raw: the manager UI submits a complete settings
 * object on every save, so a pool that has always been on the default must not
 * be refused for re-saving `undefined -> 'MNF_COMBINED'`, which changes nothing.
 */
function changesRule(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  const incoming = effectiveWeeklyTiebreaker({ weeklyTiebreaker: patch[WEEKLY_TIEBREAKER_SETTING_KEY] });
  const current = effectiveWeeklyTiebreaker((pool?.settings ?? {}) as { weeklyTiebreaker?: unknown });
  return incoming !== current;
}

/**
 * Does judging this patch require reading the pool's entries?
 *
 * Only when the rule is genuinely moving AND the cheap scored-week check has
 * not already settled it. Without this, every ordinary settings save on a
 * pick'em pool would read every entry inside a transaction — hundreds of reads
 * to confirm nothing changed. (Same shape, and same reason, as
 * `parityEditNeedsEntries`.)
 *
 * Call it with the pool read inside the transaction, BEFORE reading entries;
 * Firestore allows sequential reads, it forbids a read after a write.
 */
export function tiebreakerEditNeedsEntries(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (pool?.type !== 'NFL_PICKEM') return false;
  if (!touchesWeeklyTiebreakerSetting(patch)) return false;
  if (!changesRule(pool, patch)) return false;
  // Already refused on the cheap check — no entries needed to say no.
  return !poolHasScoredWeek(pool);
}

export type WeeklyTiebreakerRefusal = {
  code: 'TIEBREAKER_LOCKED_AFTER_SUBMISSIONS' | 'SETTINGS_LOCKED_AFTER_SCORING';
  field: 'weeklyTiebreaker';
  message: string;
};

/**
 * Has anybody in this pool committed to a sheet yet?
 *
 * TWO conditions, OR'd, and both are needed:
 *
 *  - a non-empty `picks` map — the general case, and the ONLY one that fires on
 *    a `NONE` pool, whose sheet stores no prediction at all;
 *  - any `weeklyTiebreakers` value — the direct evidence, and the one that
 *    survives an entry whose picks were somehow cleared.
 *
 * Short-circuits on the first hit, so the common answer costs one entry.
 */
export function poolHasSubmission(
  entries: ReadonlyArray<{ picks?: Record<string, unknown>; weeklyTiebreakers?: Record<string, unknown> } | undefined>,
): boolean {
  return entries.some(e =>
    Object.keys(e?.picks ?? {}).length > 0 ||
    Object.keys(e?.weeklyTiebreakers ?? {}).length > 0,
  );
}

/**
 * May this settings patch change the weekly tie-breaker rule right now?
 *
 * Returns the refusal, or null to allow.
 *
 * Present-only and by EFFECTIVE value (see `changesRule`) — a scored pool
 * saving unrelated fields is never refused over a key it did not mention, and a
 * legacy pool saving the UI's default is never refused over
 * `undefined -> 'MNF_COMBINED'`.
 */
export function weeklyTiebreakerRefusal(
  pool: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  entries: ReadonlyArray<{ picks?: Record<string, unknown>; weeklyTiebreakers?: Record<string, unknown> } | undefined>,
): WeeklyTiebreakerRefusal | null {
  if (pool?.type !== 'NFL_PICKEM') return null;
  if (!touchesWeeklyTiebreakerSetting(patch)) return null;
  if (!changesRule(pool, patch)) return null;

  if (poolHasScoredWeek(pool)) {
    return {
      code: 'SETTINGS_LOCKED_AFTER_SCORING',
      field: 'weeklyTiebreaker',
      message:
        'SETTINGS_LOCKED_AFTER_SCORING: this pool has already published a scored week, so the tiebreaker rule can no longer be changed — it would rewrite what that week reported.',
    };
  }

  if (poolHasSubmission(entries)) {
    return {
      code: 'TIEBREAKER_LOCKED_AFTER_SUBMISSIONS',
      field: 'weeklyTiebreaker',
      message:
        'TIEBREAKER_LOCKED_AFTER_SUBMISSIONS: members have already submitted picks in this pool, so the tiebreaker rule can no longer be changed — they answered the old question, or were never asked the new one.',
    };
  }

  return null;
}
