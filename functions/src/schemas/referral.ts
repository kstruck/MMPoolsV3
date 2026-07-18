/**
 * Input schemas for the referral.ts SWEEP-LATER callables:
 * generateReferralToken, resolveReferralToken. PURE: zod only, no firebase imports.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

/**
 * generateReferralToken (AUTHED) — the handler takes NO meaningful input: it
 * derives the owner from request.auth.uid and ignores the body entirely.
 *
 * But referralService.ts sends `{ userId }`. That field is DEAD server-side
 * (trusting it would be an IDOR — the caller could mint a token attributed to
 * someone else), yet a schema omitting it would reject the real call with
 * invalid-argument. So it is accepted and ignored, exactly like
 * createBracketEntry's tiebreakerScore. Do NOT start reading it.
 *
 * Keeps the null->{} preprocess for any no-arg caller.
 */
export const generateReferralTokenSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject({
        userId: nullish(z.string().max(200)),
    }),
);

/**
 * resolveReferralToken (PUBLIC/ANON — a signed-out visitor lands on ?ref=...
 * before creating an account) — { token }.
 *
 * token is NOT trimmed: it is used directly as a Firestore document id
 * (referralTokens/{token}) and matched exactly, so it is a lookup key. Server
 * generated values are clean hex, and the previous code matched request.data
 * byte-for-byte; keep that semantics rather than silently widening it here.
 */
export const resolveReferralTokenSchema = z.strictObject({
    token: z.string().min(1).max(200),
});

export type GenerateReferralTokenInput = z.infer<typeof generateReferralTokenSchema>;
export type ResolveReferralTokenInput = z.infer<typeof resolveReferralTokenSchema>;
