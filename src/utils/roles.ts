/**
 * Canonical user-role model (T6) — CLIENT MIRROR of functions/src/lib/roles.ts.
 * Keep the constants/maps identical; a root vitest parity test fails CI on drift.
 * Normalizing on read guarantees no legacy value (POOL_MANAGER/PARTICIPANT/…)
 * ever surfaces in the UI, even before every write site is migrated.
 */

export const CANONICAL_ROLES = [
  'SUPER_ADMIN',
  'MODERATOR',
  'COMMISSIONER',
  'MEMBER',
  'BANNED',
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

export const DEFAULT_ROLE: CanonicalRole = 'MEMBER';

const LEGACY_MAP: Record<string, CanonicalRole> = {
  POOL_MANAGER: 'COMMISSIONER',
  MANAGER: 'COMMISSIONER',
  PARTICIPANT: 'MEMBER',
  USER: 'MEMBER',
};

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

/** Display label + tailwind color for a role badge. */
export function roleBadge(role: string | null | undefined): { label: CanonicalRole; className: string } {
  const r = normalizeRole(role);
  const colors: Record<CanonicalRole, string> = {
    SUPER_ADMIN: 'bg-brandred-600/10 text-brandred-500 border-brandred-600/25',
    MODERATOR: 'bg-gold-500/10 text-gold-700 dark:text-gold-400 border-gold-500/25',
    COMMISSIONER: 'bg-navy-600/10 text-navy-700 dark:text-gold-400 border-navy-600/25',
    MEMBER: 'bg-surface text-muted border-line',
    BANNED: 'bg-brandred-900/20 text-brandred-500 border-brandred-700/40',
  };
  return { label: r, className: colors[r] };
}
