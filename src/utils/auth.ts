import type { User } from '../types';
import { POOLS_OPEN, SQUARES_CREATION_OPEN } from '../config/season';
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
export const poolCoManagers = (pool: object | null | undefined): string[] => {
    // `object`, not `{ coManagers?: unknown }` — the `Pool` union's non-NFL
    // members declare no such field and weak-type checking refuses them (tsc -b).
    const raw = (pool as { coManagers?: unknown } | null | undefined)?.coManagers;
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
    pool: { ownerId?: string; managerUid?: string; type?: string } | null | undefined,
): boolean => isPoolManager(user, pool) || isNamedNFLCoCommissioner(user, pool);

/**
 * True ONLY for a uid actually named in `coManagers` on an NFL pool — no owner,
 * manager or SUPER_ADMIN implication. This is what the Commissioner Hub and its
 * "Co-Commissioner" chip key on: the Hub lists pools you OWN or are NAMED on,
 * never every pool a super admin could administer (codex r6 on PR-B).
 */
export const isNamedNFLCoCommissioner = (
    user: User | null | undefined,
    pool: { type?: string } | null | undefined,
): boolean => {
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

/**
 * Whether SQUARES creation may be reached. Closed for everyone while
 * `SQUARES_CREATION_OPEN` is false — including super admins, which is the one
 * way this differs from `canAccessPoolCreation` and is deliberate
 * (see `config/season.ts`). Takes the user so every call site reads the same
 * whether or not the switch ever grows a per-user exemption.
 */
export const canAccessSquaresCreation = (user: User | null | undefined): boolean => {
    return SQUARES_CREATION_OPEN && canAccessPoolCreation(user);
};

/** Check if user can manage entries (owner or super admin, used in bracket/playoff pools) */
export const canManageEntries = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    return isPoolManager(user, pool);
};
