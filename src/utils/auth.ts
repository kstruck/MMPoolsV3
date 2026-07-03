import type { User } from '../types';
import { normalizeRole, canCreatePools } from './roles';

/**
 * Centralized role-check utilities.
 * Use these instead of inline `user.role === 'SUPER_ADMIN'` checks
 * to keep authorization logic in one place and easy to audit.
 * All comparisons normalize the role so legacy values (POOL_MANAGER/
 * PARTICIPANT) resolve to their canonical equivalents.
 */

/** Check if a user has the SUPER_ADMIN role */
export const isSuperAdmin = (user: User | null | undefined): boolean => {
    return normalizeRole(user?.role) === 'SUPER_ADMIN';
};

/** Check if a user has the MODERATOR role (read-only oversight). */
export const isModerator = (user: User | null | undefined): boolean => {
    return normalizeRole(user?.role) === 'MODERATOR';
};

/** Check if a user is BANNED. */
export const isBanned = (user: User | null | undefined): boolean => {
    return normalizeRole(user?.role) === 'BANNED';
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

/** Check if a user can create pools (COMMISSIONER and above; legacy-tolerant) */
export const canCreatePool = (user: User | null | undefined): boolean => {
    if (!user) return false;
    return canCreatePools(user.role);
};

/** Check if user can manage entries (owner or super admin, used in bracket/playoff pools) */
export const canManageEntries = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    return isPoolManager(user, pool);
};
