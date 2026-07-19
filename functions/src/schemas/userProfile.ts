/**
 * Input schema for recomputeMyProfile (functions/src/userProfile.ts).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * recomputeMyProfile - SWEEP-LATER batch 17. Any authenticated user.
 *
 * uid IS OPTIONAL AND ITS OMISSION IS A MEANING, not a mistake: the handler does
 * `request.data?.uid || request.auth.uid`, so omitting it recomputes the
 * CALLER'S OWN profile. Passing someone else's uid is the SUPER_ADMIN-only path,
 * enforced in-handler. A required schema would break the common case.
 */
export const recomputeMyProfileSchema = z.strictObject({
    uid: z.string().trim().min(1).max(200).optional(),
});
