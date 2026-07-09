// Achievement contract — the frozen extension point the future achievements engine fills.
// See docs/adr/0005-player-profile-data-model.md (decision 5) and PLAN-PLAYER-PROFILES.md.
//
// Earned achievements live at publicProfiles/{subjectId}/achievements/{achievementId} —
// world-readable, server-write-only (same rule pattern as the parent projection doc).
// The awarding engine is a SEPARATE future feature: v1 ships only this contract and an
// honest empty state on the profile page. The engine ships later without touching
// functions/src/userProfile.ts or the projection doc.
//
// LEAK RULE (same as the projection): the public achievement doc carries NO pool
// identifiers, and `meta` is contractually forbidden from carrying pool identity
// (poolId, poolName, slug, or anything derivable to one). A future engine keeps pool
// linkage in its own private store and surfaces it only via the viewer-gated
// getProfilePoolDetail path.
// This file is framework-free (no firebase imports) so both client and functions import it.

export const ACHIEVEMENT_SCHEMA_VERSION = 1;

export type AchievementTier = 'BRONZE' | 'SILVER' | 'GOLD';

export interface Achievement {
  /** Stable machine code, e.g. 'PERFECT_WEEK'. Doc id should be `${code}_${earnedAt}` or similar. */
  code: string;
  title: string;
  description: string;
  /** Key into the client icon registry — never a URL. */
  iconKey: string;
  tier?: AchievementTier;
  /** Epoch millis. */
  earnedAt: number;
  /** NFL season the achievement was earned in, when season-scoped. */
  season?: string;
  /** Engine-defined extras. MUST NOT contain pool identifiers (see leak rule above). */
  meta?: Record<string, string | number | boolean>;
  schemaVersion: number;
}
