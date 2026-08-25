/**
 * Failed-attempt throttle for pool-password verification
 * (PLAN-AUDIT-AUTH-HARDENING Phase B).
 *
 * The pure predicate and the key derivation live in `poolPassword.ts`; this is
 * the Firestore side, in its own module because BOTH verification paths need it
 * and neither should own it:
 *
 *   - `verifyPoolAccess` — the squares/props gate. PUBLIC, so it is an
 *     unauthenticated online guessing oracle.
 *   - `joinBracketPool`  — authenticated, but "authenticated" is a free
 *     account, so it is the SAME oracle behind a signup form (codex r4 P2).
 *     Moving the hash off the public document accomplishes nothing if either
 *     endpoint will grade unlimited guesses against it — and each guess costs a
 *     PBKDF2 derivation, so it is a CPU amplifier as well as a password oracle.
 *
 * Scoped per (pool, principal), never per pool: a per-pool counter would let one
 * attacker lock every member out of a pool they can reach, trading a guessing
 * bound for a denial of service.
 *
 * Only FAILURES are charged. The slot is taken BEFORE the compare (so a caller
 * who hangs up mid-verify still pays for the guess) and refunded on success.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import {
    ATTEMPT_MAX_FAILURES,
    attemptKey,
    evaluateAttempt,
    type AttemptDecision,
} from "./poolPassword";

/** Server-only throttle store. `firestore.rules` closes it both ways. */
export const ATTEMPTS_COLLECTION = "pool_access_attempts";

export function attemptRef(
    db: admin.firestore.Firestore,
    poolId: string,
    principal: string,
): admin.firestore.DocumentReference {
    return db.collection(ATTEMPTS_COLLECTION).doc(attemptKey(poolId, principal));
}

/**
 * Take a slot, or throw `resource-exhausted`. Call BEFORE verifying; call
 * `refundAccessAttempt` after a SUCCESSFUL verify.
 */
export async function chargeAccessAttempt(
    db: admin.firestore.Firestore,
    poolId: string,
    principal: string,
): Promise<AttemptDecision> {
    const ref = attemptRef(db, poolId, principal);
    const decision = await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const d = evaluateAttempt(snap.exists ? snap.data() : null, Date.now());
        if (d.allowed) t.set(ref, { ...d.next, updatedAt: Date.now() }, { merge: true });
        return d;
    });
    if (!decision.allowed) {
        throw new HttpsError(
            "resource-exhausted",
            `Too many attempts. Try again in ${Math.ceil(decision.retryAfterMs / 60000)} minute(s).`,
        );
    }
    return decision;
}

/** Give the slot back after a correct password. Best-effort. */
export async function refundAccessAttempt(
    db: admin.firestore.Firestore,
    poolId: string,
    principal: string,
): Promise<void> {
    await attemptRef(db, poolId, principal).delete().catch(() => undefined);
}

/** How many guesses are left after `decision`, for a client-facing message. */
export function attemptsRemaining(decision: AttemptDecision): number {
    return Math.max(0, ATTEMPT_MAX_FAILURES - decision.next.failures);
}
