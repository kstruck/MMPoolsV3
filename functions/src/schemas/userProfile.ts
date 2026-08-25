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

/**
 * getProfilePoolDetail - PLAN-AUDIT-BACKEND-RESIDUE 17f. The callable was a raw
 * onCall with hand-rolled `typeof x !== 'string'` checks; this replaces them.
 *
 * BOTH ids are REQUIRED and BOTH are server-generated document ids, so trimming
 * them is safe (contrast the squares lookup-key regression, #194/#195 - never
 * trim a user-supplied string matched against stored data).
 *
 * The viewer authorization - subject / co-member of THAT pool / admin - stays
 * in-handler and is NOT expressible here: it needs the pool doc, which the gate
 * stage has not read. `auth: "required"` only establishes that someone is
 * signed in.
 *
 * Strict is safe against the live caller: dbService.getProfilePoolDetail sends
 * `withCorrelationId({ subjectId, poolId })`, and validated() strips
 * `_correlationId` before the schema ever sees the payload.
 */
export const getProfilePoolDetailSchema = z.strictObject({
    subjectId: z.string().trim().min(1).max(200),
    poolId: z.string().trim().min(1).max(200),
});
