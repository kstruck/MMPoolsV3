/**
 * Input schemas for the userManagement TARGET-NOW callables:
 * deleteUserAccount, sendAdminPasswordReset, sendSecuritySMSAlert,
 * sendUserEmail. PURE: zod only, no firebase imports.
 */

import { z } from "zod";

const targetUid = z.string().trim().min(1).max(200);

/** deleteUserAccount — { targetUid } (dbService). */
export const deleteUserAccountSchema = z.strictObject({ targetUid });

/** sendAdminPasswordReset — { email } (dbService). Loose format check; Auth resolves it. */
export const sendAdminPasswordResetSchema = z.strictObject({
    email: z.string().trim().min(3).max(320),
});

/**
 * sendSecuritySMSAlert — the client calls httpsCallable()() with NO payload,
 * which arrives as null. Normalize null/undefined to {}; reject anything else.
 */
export const sendSecuritySMSAlertSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject({}),
);

/** sendUserEmail — { targetUid, subject, body } (dbService). Non-empty after trim, like the old hand check. */
export const sendUserEmailSchema = z.strictObject({
    targetUid,
    subject: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(50_000),
});

export type DeleteUserAccountInput = z.infer<typeof deleteUserAccountSchema>;
export type SendAdminPasswordResetInput = z.infer<typeof sendAdminPasswordResetSchema>;
export type SendUserEmailInput = z.infer<typeof sendUserEmailSchema>;

/**
 * searchUsersByEmail - SWEEP-LATER batch 17. SUPER_ADMIN or MODERATOR.
 *
 * `prefix` is a RANGE LOOKUP KEY: the handler feeds it to
 * orderBy("searchEmail").startAt(p).endAt(p + "\uf8ff"). It already applies
 * .trim().toLowerCase() itself, so this schema deliberately does NOT normalise
 * - doing it in two places invites the two from drifting apart, and normalising
 * a lookup key at the boundary is the #194/#195 regression class.
 */
export const searchUsersByEmailSchema = z.strictObject({
    prefix: z.string().min(1).max(200),
    // Handler clamps to <=50 and defaults 25; mirrored here so an absurd value
    // is rejected at the boundary rather than silently clamped.
    limit: z.number().int().positive().max(50).optional(),
});
