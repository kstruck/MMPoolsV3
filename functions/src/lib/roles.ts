/**
 * Canonical user-role model (T6). SOURCE OF TRUTH (functions side); the client
 * mirror is src/utils/roles.ts (kept in parity by a root vitest test). Pure —
 * no firebase-admin — so it can be imported from the client-side test context.
 *
 * The codebase historically wrote a mix of legacy values (POOL_MANAGER,
 * MANAGER, PARTICIPANT, USER) for the global user role. normalizeRole() folds
 * every legacy value into the canonical set so no legacy value ever surfaces in
 * the UI or a permission check, even before every write site is migrated.
 *
 * NOTE: the per-pool participation-index `role` (users/{uid}/joinedPools,
 * managedPools, participations — values MANAGER/PARTICIPANT) is a DIFFERENT
 * taxonomy and is intentionally NOT touched by this module.
 */

export const CANONICAL_ROLES = [
  'SUPER_ADMIN',
  'MODERATOR',
  'COMMISSIONER',
  'MEMBER',
  'BANNED',
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

/** The default role for a brand-new account. */
export const DEFAULT_ROLE: CanonicalRole = 'MEMBER';

const LEGACY_MAP: Record<string, CanonicalRole> = {
  POOL_MANAGER: 'COMMISSIONER',
  MANAGER: 'COMMISSIONER',
  PARTICIPANT: 'MEMBER',
  USER: 'MEMBER',
};

/** Fold any stored/claimed role value into the canonical set. */
export function normalizeRole(raw: string | null | undefined): CanonicalRole {
  if (!raw) return DEFAULT_ROLE;
  if ((CANONICAL_ROLES as readonly string[]).includes(raw)) return raw as CanonicalRole;
  return LEGACY_MAP[raw] ?? DEFAULT_ROLE;
}

export function isCanonicalRole(r: string): r is CanonicalRole {
  return (CANONICAL_ROLES as readonly string[]).includes(r);
}

/** COMMISSIONER (or above) may create pools. */
export function canCreatePools(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'COMMISSIONER' || r === 'MODERATOR' || r === 'SUPER_ADMIN';
}
