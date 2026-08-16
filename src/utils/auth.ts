import type { User } from '../types';
import { POOLS_OPEN } from '../config/season';
import { normalizeRole, canCreatePools } from './roles';

/**
 * Centralized role-check utilities.
 * Use these instead of inline `user.role === 'SUPER_ADMIN'` checks
 * to keep authorization logic in one place and easy to audit.
 *
 * All role reads go through normalizeRole() so legacy stored values
 * (POOL_MANAGER/PARTICIPANT/…) fold to the canonical set — no legacy value
 * ever reaches a comparison, even before every write site is migrated.
 */

/** Check if a user has the SUPER_ADMIN role */
export const isSuperAdmin = (user: User | null | undefined): boolean => {
    return normalizeRole(user?.role) === 'SUPER_ADMIN';
};

/** Check if a user is the pool owner or designated manager */
export const isPoolOwner = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    if (!user || !pool) return false;
    return pool.ownerId === user.id || pool.managerUid === user.id;
};

/** Check if a user has management access to a pool (owner, manager, or super admin) */
export const isPoolManager = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    return isPoolOwner(user, pool) || isSuperAdmin(user);
};

/** The pool types on which co-commissioners exist (PLAN-CO-COMMISSIONERS C13). */
export const NFL_CO_COMMISSIONER_POOL_TYPES: readonly string[] = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

/**
 * The server-owned co-commissioner list, read defensively — the field is
 * absent on every non-NFL pool and on any pool where nobody has been named.
 * Never trust its shape blindly: it was client-writable before the T1 lock.
 */
export const poolCoManagers = (pool: { coManagers?: unknown } | null | undefined): string[] => {
    const raw = pool?.coManagers;
    return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
};

/**
 * Owner / manager / super admin, OR a named co-commissioner on an NFL pool
 * (PLAN-CO-COMMISSIONERS D3). This is the ONLY widened predicate on the client
 * and it is used ONLY where `PoolRoute` computes `isManager` for the three NFL
 * dashboards and where the Commissioner Hub decides what to list. `isPoolOwner`,
 * `isPoolManager` and `canManageEntries` stay strict — Bracket/Playoff/Squares
 * surfaces and the owner-only co-commissioner toggle read them.
 */
export const isNFLPoolCommissioner = (
    user: User | null | undefined,
    pool: { ownerId?: string; managerUid?: string; type?: string; coManagers?: unknown } | null | undefined,
): boolean => {
    if (isPoolManager(user, pool)) return true;
    if (!user || !pool) return false;
    return NFL_CO_COMMISSIONER_POOL_TYPES.includes(pool.type ?? '') && poolCoManagers(pool).includes(user.id);
};

/** Check if a user can create pools (COMMISSIONER and above, incl. legacy POOL_MANAGER) */
export const canCreatePool = (user: User | null | undefined): boolean => {
    if (!user) return false;
    return canCreatePools(user.role);
};

/**
 * Master switch for public pool creation, sourced from the season config
 * (`POOLS_OPEN`). Flip that flag to `true` when 2026 pool creation opens.
 * While closed, only super admins can reach creation flows (for internal
 * setup/testing); everyone else sees grayed-out, "coming soon" entry points.
 * Re-exported here so components have a single import for creation gating.
 */
export const POOL_CREATION_ENABLED = POOLS_OPEN;

/** Whether this user may access pool-creation flows given the master switch. */
export const canAccessPoolCreation = (user: User | null | undefined): boolean => {
    return POOLS_OPEN || isSuperAdmin(user);
};

/** Check if user can manage entries (owner or super admin, used in bracket/playoff pools) */
export const canManageEntries = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    return isPoolManager(user, pool);
};
