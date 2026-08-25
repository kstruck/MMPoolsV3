/**
 * Pool-password crypto + the shape of where the material lives.
 * PLAN-AUDIT-AUTH-HARDENING Phase B (NEXT-SESSION-AUDIT-FIXES items 1 / 13).
 *
 * PURE: node `crypto` only, no Admin SDK — so every branch here is unit-testable
 * without an emulator. The Firestore side lives in `poolAccess.ts`.
 *
 * ## What was wrong
 *
 * A user-chosen POOL password was stored in THREE places, two of them plaintext
 * on a world-readable document (`pools/{id}` is `allow get: if true`):
 *   - `pool.gridPassword`            — squares/props wizards, PLAINTEXT
 *   - `pool.accessControl.password`  — bracket dashboard save, PLAINTEXT
 *   - `pool.passwordHash`            — publishBracketPool, PBKDF2 but still on
 *                                      the public doc, i.e. offline-crackable
 *                                      material handed to anyone with a link.
 * The squares gate then compared the plaintext IN THE BROWSER
 * (PoolRoute.tsx), so it stopped nobody who opened devtools.
 *
 * ## What replaces it
 *
 * ONE home: `pools/{poolId}/private/access`, `allow read/write: if false`, only
 * ever touched by the Admin SDK. The public doc carries a non-secret boolean
 * marker (`hasPoolPassword`) so the UI can render a lock without learning
 * anything. Verification is a callable.
 *
 * ## Format
 *
 * `salt:hash` — PBKDF2-HMAC-SHA512, 10 000 iterations, 64-byte key, both halves
 * hex. Identical parameters to the pattern already in publishBracketPool so
 * existing `passwordHash` values verify unchanged after they are moved.
 *
 * Iteration count is LOW by 2026 standards. It is kept at 10 000 deliberately:
 * changing it would invalidate every stored bracket hash, and this is a
 * throwaway pool password (not an account credential) whose realistic threat is
 * "anyone with the share link reads it off the document", which the move to a
 * closed subcollection ends outright. `PBKDF2_ITERATIONS` is a named constant so
 * a future raise is a one-line change plus a rehash-on-verify, which the
 * `needsRehash` return already supports.
 */

import * as crypto from "crypto";

export const PBKDF2_ITERATIONS = 10_000;
export const PBKDF2_KEYLEN = 64;
export const PBKDF2_DIGEST = "sha512";
export const SALT_BYTES = 16;

/** Subcollection + doc id of the ONLY place password material may live. */
export const POOL_PRIVATE_SUBCOLLECTION = "private";
export const POOL_ACCESS_DOC_ID = "access";

/** Non-secret marker on the public pool doc: "this pool has a password". */
export const HAS_POOL_PASSWORD_FIELD = "hasPoolPassword";

/**
 * The legacy plaintext fields this phase evacuates. Kept as data so the
 * migration, the create-schema strip and the tests all agree on one list.
 */
export const LEGACY_PLAINTEXT_FIELDS = ["gridPassword", "accessControl.password"] as const;
/** The legacy HASH field on the public pool doc (bracket publish path). */
export const LEGACY_HASH_FIELD = "passwordHash";

/** Longest password we will hash. Bounded so a huge body cannot burn CPU. */
export const MAX_POOL_PASSWORD_LENGTH = 200;

export type PoolSecretFormat = "pbkdf2" | "sha256" | "plaintext";

/**
 * Everything we could find for a pool, in trust order. `hash` is the private
 * doc's canonical value; the two legacy members are read ONLY while the
 * migration has not reached this pool, and a successful match on either one
 * triggers a rehash (item 13c).
 */
export interface StoredPoolSecret {
    /** Canonical `salt:hash`, or a legacy bare sha256 hex digest. */
    hash?: string | null;
    /** Legacy PLAINTEXT still sitting on the world-readable pool doc. */
    plaintext?: string | null;
}

export interface VerifyResult {
    ok: boolean;
    /** Which stored form matched. `null` when nothing matched. */
    matched: PoolSecretFormat | null;
    /**
     * True when the match came from something that must not stay stored as it
     * is — a legacy bare sha256, or plaintext on the public doc.
     */
    needsRehash: boolean;
}

/** True when the pool has any password material at all. */
export function hasSecret(stored: StoredPoolSecret | null | undefined): boolean {
    return Boolean(
        (typeof stored?.hash === "string" && stored.hash.length > 0) ||
        (typeof stored?.plaintext === "string" && stored.plaintext.length > 0),
    );
}

/**
 * Constant-time string compare.
 *
 * `crypto.timingSafeEqual` THROWS on length mismatch, which would itself be a
 * length oracle if the throw escaped — so unequal lengths return false here
 * instead of propagating. The lengths being compared are hex digests of a fixed
 * width in every non-legacy path, so this only bites the plaintext branch,
 * where the password's length is already knowable by the person who set it.
 */
export function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

/** `true` for a value shaped like our PBKDF2 record (`salt:hash`). */
export function isPbkdf2(stored: string): boolean {
    const idx = stored.indexOf(":");
    return idx > 0 && idx < stored.length - 1;
}

/** Derive `salt:hash` for a NEW password. Throws on an empty/oversize input. */
export function hashPoolPassword(password: string): string {
    if (typeof password !== "string" || password.length === 0) {
        throw new Error("hashPoolPassword: empty password");
    }
    if (password.length > MAX_POOL_PASSWORD_LENGTH) {
        throw new Error("hashPoolPassword: password too long");
    }
    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    const hash = crypto
        .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
        .toString("hex");
    return `${salt}:${hash}`;
}

/**
 * Verify a candidate against whatever we hold.
 *
 * Order is deliberate: the private-doc hash wins, and the plaintext legacy is
 * consulted ONLY when there is no hash. Otherwise a pool mid-migration (hash
 * written, plaintext not yet deleted) would still accept the value the
 * commissioner has since changed.
 */
export function verifyPoolPassword(
    password: string,
    stored: StoredPoolSecret | null | undefined,
): VerifyResult {
    const miss: VerifyResult = { ok: false, matched: null, needsRehash: false };
    if (typeof password !== "string" || password.length === 0) return miss;
    // Bounded before any KDF work — an unbounded body must not buy CPU time.
    if (password.length > MAX_POOL_PASSWORD_LENGTH) return miss;

    const hash = typeof stored?.hash === "string" && stored.hash.length > 0 ? stored.hash : null;
    if (hash) {
        if (isPbkdf2(hash)) {
            const idx = hash.indexOf(":");
            const salt = hash.slice(0, idx);
            const expected = hash.slice(idx + 1);
            const actual = crypto
                .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
                .toString("hex");
            return safeEqual(expected, actual)
                ? { ok: true, matched: "pbkdf2", needsRehash: false }
                : miss;
        }
        // Legacy unsalted SHA-256 (item 13c). Matches are accepted so nobody is
        // locked out, and the caller rehashes to PBKDF2 on the way through.
        const digest = crypto.createHash("sha256").update(password).digest("hex");
        return safeEqual(hash, digest)
            ? { ok: true, matched: "sha256", needsRehash: true }
            : miss;
    }

    const plain = typeof stored?.plaintext === "string" && stored.plaintext.length > 0
        ? stored.plaintext
        : null;
    if (plain) {
        return safeEqual(plain, password)
            ? { ok: true, matched: "plaintext", needsRehash: true }
            : miss;
    }
    return miss;
}

// ---------------------------------------------------------------------------
// Failed-attempt throttle
// ---------------------------------------------------------------------------

/**
 * The squares gate is GUEST-facing (a share link works logged-out), so the
 * verify callable is `auth: "public"` and is therefore an online guessing
 * oracle. It is bounded per (pool, principal) rather than per pool: a per-pool
 * counter would let one attacker lock every member out of a pool they can
 * reach, trading a guessing bound for a denial-of-service.
 */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const ATTEMPT_MAX_FAILURES = 10;

export interface AttemptRecord {
    failures?: number;
    windowStartedAt?: number;
}

export interface AttemptDecision {
    allowed: boolean;
    /** The record to persist after a FAILED verify. */
    next: { failures: number; windowStartedAt: number };
    /** ms until the window rolls over; 0 when allowed. */
    retryAfterMs: number;
}

/**
 * Pure predicate — given the stored record and `now`, may this principal try?
 *
 * A window that has expired resets to a fresh one, so the throttle is a rolling
 * cap rather than a permanent ban.
 */
export function evaluateAttempt(
    record: AttemptRecord | null | undefined,
    now: number,
): AttemptDecision {
    const startedAt = typeof record?.windowStartedAt === "number" ? record.windowStartedAt : 0;
    const failures = typeof record?.failures === "number" && record.failures > 0 ? record.failures : 0;
    const expired = now - startedAt >= ATTEMPT_WINDOW_MS;
    if (expired || failures === 0) {
        return { allowed: true, next: { failures: 1, windowStartedAt: expired ? now : (startedAt || now) }, retryAfterMs: 0 };
    }
    if (failures >= ATTEMPT_MAX_FAILURES) {
        return {
            allowed: false,
            next: { failures, windowStartedAt: startedAt },
            retryAfterMs: Math.max(0, startedAt + ATTEMPT_WINDOW_MS - now),
        };
    }
    return { allowed: true, next: { failures: failures + 1, windowStartedAt: startedAt }, retryAfterMs: 0 };
}

/**
 * Throttle key. Hashed so neither an IP address nor a uid is readable off the
 * document id — the counter store is server-only, but the id ends up in logs
 * and error messages, which this keeps clean.
 */
export function attemptKey(poolId: string, principal: string): string {
    return crypto.createHash("sha256").update(`${poolId} ${principal}`).digest("hex").slice(0, 40);
}
