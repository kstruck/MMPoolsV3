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
