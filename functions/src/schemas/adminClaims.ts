/**
 * Input schemas for the adminClaims TARGET-NOW callables: setUserRole,
 * setSuperAdminClaim. PURE: zod + lib/roles only, no firebase imports.
 */

import { z } from "zod";
import { CANONICAL_ROLES } from "../lib/roles";

const targetUid = z.string().trim().min(1).max(200);

/** setUserRole — role must be canonical (same set the old hand check allowed). */
export const setUserRoleSchema = z.strictObject({
    targetUid,
    role: z.enum(CANONICAL_ROLES),
});

/** setSuperAdminClaim — deprecated passthrough; grant/revoke SUPER_ADMIN. */
export const setSuperAdminClaimSchema = z.strictObject({
    targetUid,
    isSuperAdmin: z.boolean(),
});

/** syncMyClaims — self-service claim resync, takes NO input. */
export const syncMyClaimsSchema = z.strictObject({});

/** backfillUserRoles (SUPER_ADMIN) — one optional dryRun flag (default true). */
export const backfillUserRolesSchema = z.strictObject({
    dryRun: z.boolean().optional(),
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;
export type SetSuperAdminClaimInput = z.infer<typeof setSuperAdminClaimSchema>;
export type SyncMyClaimsInput = z.infer<typeof syncMyClaimsSchema>;
export type BackfillUserRolesInput = z.infer<typeof backfillUserRolesSchema>;
