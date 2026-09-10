// `settings.lockRuleVersion` — the server-written stamp that says a pool's stored
// `lockMode` is the truth (PLAN-CONFIDENCE-PER-GAME-LOCK, codex r1 #3/#4).
//
// Before that plan a confidence Pick'em pool played WEEKLY whatever `lockMode`
// said, and the wizard's default `PER_GAME` was routinely stored on pools that
// played weekly. `nflLockMode` keeps that legacy reading for any confidence pool
// NOT stamped, so the functions deploy is safe before the backfill has run:
// nothing changes mode for any caller until the backfill stamps it.
//
// Two writers, on purpose:
//   - BOTH pool creators (`createNFLPool`, and the generic `createPool`, which
//     accepts NFL types) stamp every new NFL pool — codex r2 #2;
//   - `backfillConfidenceLockMode` stamps legacy confidence pools.
// No manager path may write it: it is in SERVER_OWNED_SETTINGS_KEYS.
import { LOCK_RULE_VERSION, isLegacyLockRule } from '../shared/nflLockMode';
import { NFL_SEASON_TYPES } from '../shared/poolTypes';

export { LOCK_RULE_VERSION };

/** Stamp a pool document being CREATED. Idempotent; non-NFL pools untouched. */
export function stampLockRuleVersion(newPool: { type?: string; settings?: Record<string, unknown> }): void {
  if (!newPool.type || !(NFL_SEASON_TYPES as readonly string[]).includes(newPool.type)) return;
  newPool.settings = { ...(newPool.settings ?? {}), lockRuleVersion: LOCK_RULE_VERSION };
}

/**
 * Does the backfill need to touch this pool? EVERY unstamped Pick'em pool —
 * confidence or not (codex r14 #3): a straight pool that later enables
 * confidence mode and picks PER_GAME must not be stuck on the legacy weekly
 * rule with no path to the stamp (managers cannot write it). A confidence pool
 * that already stores `WEEKLY` still matches — it needs the stamp; its
 * lockMode write is a no-op (codex r2 #3). Re-evaluated inside the write
 * transaction so a pool stamped between pages is skipped.
 */
export function needsConfidenceLockModeBackfill(pool: Record<string, unknown> | undefined): boolean {
  if (!pool || pool.type !== 'NFL_PICKEM') return false;
  const settings = (pool.settings ?? {}) as { lockRuleVersion?: unknown };
  return isLegacyLockRule(settings as { lockRuleVersion?: number });
}

/** What the backfill writes for `lockMode`: WEEKLY for a confidence pool (what it has always played); a straight pool keeps its stored value. */
export function backfillLockModeFor(pool: Record<string, unknown> | undefined): 'WEEKLY' | undefined {
  const settings = (pool?.settings ?? {}) as { confidenceMode?: unknown };
  return settings.confidenceMode === true ? 'WEEKLY' : undefined;
}
