import type { User } from '../types';

/**
 * Centralized role-check utilities.
 * Use these instead of inline `user.role === 'SUPER_ADMIN'` checks
 * to keep authorization logic in one place and easy to audit.
 */

/** Check if a user has the SUPER_ADMIN role */
export const isSuperAdmin = (user: User | null | undefined): boolean => {
    return user?.role === 'SUPER_ADMIN';
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

/** Check if a user can create pools (managers and above) */
export const canCreatePool = (user: User | null | undefined): boolean => {
    if (!user) return false;
    return user.role === 'POOL_MANAGER' || user.role === 'SUPER_ADMIN';
};

/**
 * Master switch for public pool creation. Flip to `true` when ready to let
 * users create their own pools. While `false`, only super admins can reach
 * creation flows (for internal setup/testing); everyone else sees grayed-out,
 * "coming soon" creation entry points.
 */
export const POOL_CREATION_ENABLED = false;

/** Whether this user may access pool-creation flows given the master switch. */
export const canAccessPoolCreation = (user: User | null | undefined): boolean => {
    return POOL_CREATION_ENABLED || isSuperAdmin(user);
};

/** Check if user can manage entries (owner or super admin, used in bracket/playoff pools) */
export const canManageEntries = (user: User | null | undefined, pool: { ownerId?: string; managerUid?: string } | null | undefined): boolean => {
    return isPoolManager(user, pool);
};
