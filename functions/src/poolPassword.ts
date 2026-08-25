/**
 * Pool-password callables (PLAN-AUDIT-AUTH-HARDENING Phase B; audit items 1
 * and 13a/13b/13c).
 *
 * `setPoolPassword`   — commissioner sets or clears the password. The ONLY
 *                       client path that can write password material, and it
 *                       writes a PBKDF2 hash to `pools/{id}/private/access`.
 * `verifyPoolAccess`  — the join/unlock gate. Replaces the string compare that
 *                       ran in the browser (PoolRoute.tsx). Public, because a
 *                       squares share link works logged-out; throttled per
 *                       (pool, principal) because a public verify endpoint is
 *                       an online guessing oracle.
 *
 * ## What this deliberately does NOT do
 *
 * It does not make the password a real credential. It is a share-link speed
 * bump chosen by a commissioner and typed into a group chat; the fix here is
 * that it is no longer READABLE off a world-readable document, and no longer
 * checkable in devtools. Members who know it can still pass it around — that is
 * the feature, not a hole.
 *
 * `migratePoolPasswords` is re-exported at the bottom so `index.ts` needs one
 * export clause for the whole phase.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { validated } from "./lib/validated";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { setPoolPasswordSchema, verifyPoolAccessSchema } from "./schemas/poolPassword";
import { hasSecret, verifyPoolPassword } from "./lib/poolPassword";
import { readPoolSecret, rehashOnVerify, writePoolSecret } from "./lib/poolAccess";
import { attemptsRemaining, chargeAccessAttempt, refundAccessAttempt } from "./lib/poolAttempts";

/**
 * SUPER_ADMIN with CLAIM AND DOC agreement (the C5 shape). `assertCallerRole`
 * THROWS, which is wrong here: a non-admin commissioner is a legitimate caller,
 * so the role is resolved to a value and handed to `assertPoolOwnerOrSuperAdmin`
 * instead. A claim that the user document does not corroborate resolves to
 * `undefined`, i.e. "not an admin" — a demoted admin holding an un-expired token
 * falls back to the ordinary commissioner check.
 */
async function effectiveSuperAdminRole(
    db: admin.firestore.Firestore,
    uid: string,
    claimRole: string | undefined,
): Promise<string | undefined> {
    if (claimRole !== "SUPER_ADMIN") return undefined;
    const snap = await db.collection("users").doc(uid).get();
    return (snap.data()?.role as string | undefined) === "SUPER_ADMIN" ? "SUPER_ADMIN" : undefined;
}

// ---------------------------------------------------------------------------
// setPoolPassword
// ---------------------------------------------------------------------------
export const setPoolPassword = validated(
    { schema: setPoolPasswordSchema, label: "setPoolPassword", appCheck: "monitor" },
    async (data, request) => {
        const { poolId, password } = data;
        const uid = request.auth!.uid;
        const db = admin.firestore();

        const poolSnap = await db.collection("pools").doc(poolId).get();
        if (!poolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = poolSnap.data() as Record<string, unknown>;

        const role = await effectiveSuperAdminRole(db, uid, request.auth!.token.role as string | undefined);
        assertPoolOwnerOrSuperAdmin(pool, uid, role);

        const { hasPassword } = await writePoolSecret(db, poolId, password);
        // No password material in the log line — only whether one now exists.
        logger.info("[poolPassword] setPoolPassword", { poolId, uid, hasPassword });
        return { success: true, hasPassword };
    },
);

// ---------------------------------------------------------------------------
// verifyPoolAccess
// ---------------------------------------------------------------------------
export const verifyPoolAccess = validated(
    { schema: verifyPoolAccessSchema, label: "verifyPoolAccess", auth: "public", appCheck: "monitor" },
    async (data, request) => {
        const { poolId, password } = data;
        const db = admin.firestore();

        const poolSnap = await db.collection("pools").doc(poolId).get();
        if (!poolSnap.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = poolSnap.data() as Record<string, unknown>;

        const secret = await readPoolSecret(db, poolId, pool);
        // An unprotected pool answers `ok` without consuming an attempt: the
        // gate does not render for it, so a call here is a stale client, not a
        // guess.
        if (!hasSecret(secret)) return { ok: true, protected: false };

        // Throttle key: uid when signed in, else the request IP. `unknown` is
        // the shared bucket for the case where neither is available — it
        // throttles harder than it should rather than not at all. The same
        // helper guards `joinBracketPool` (codex r4 P2).
        const ip = (request.rawRequest as { ip?: string } | undefined)?.ip;
        const principal = request.auth?.uid || ip || "unknown";
        const decision = await chargeAccessAttempt(db, poolId, principal);

        const result = verifyPoolPassword(password, secret);
        if (!result.ok) {
            return { ok: false, protected: true, attemptsRemaining: attemptsRemaining(decision) };
        }

        // Refund the charged slot — only FAILURES should count toward the cap.
        await refundAccessAttempt(db, poolId, principal);

        if (result.needsRehash) {
            // Item 13c: a legacy bare-sha256 hash or a plaintext still on the
            // public doc is upgraded the one moment we hold the plaintext.
            // Best-effort: a failure here must never turn a correct password
            // into a rejected one.
            try {
                await rehashOnVerify(db, poolId, password);
                logger.info("[poolPassword] rehashed legacy pool password", { poolId, from: result.matched });
            } catch (err) {
                logger.error("[poolPassword] rehash-on-verify failed", { poolId, error: String(err) });
            }
        }

        return { ok: true, protected: true };
    },
);

export { migratePoolPasswords } from "./migrations/migratePoolPasswords";
