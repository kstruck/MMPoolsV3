/**
 * Firestore side of the pool-password move (PLAN-AUDIT-AUTH-HARDENING Phase B).
 * The crypto and every pure predicate live in `poolPassword.ts`.
 *
 * INVARIANT THIS FILE EXISTS TO HOLD: password material is written to exactly
 * one path, `pools/{poolId}/private/access`, which `firestore.rules` closes to
 * every client (`allow read, write: if false`). Nothing else in the codebase may
 * write `gridPassword`, `accessControl.password` or `passwordHash` onto the
 * world-readable pool document — the create schema strips the first two
 * (schemas/poolCore.ts), the rules deny a client write of any of them, and the
 * helpers here DELETE them whenever they touch a pool.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
    HAS_POOL_PASSWORD_FIELD,
    LEGACY_HASH_FIELD,
    POOL_ACCESS_DOC_ID,
    POOL_PRIVATE_SUBCOLLECTION,
    hashPoolPassword,
    type StoredPoolSecret,
} from "./poolPassword";

/** `pools/{poolId}/private/access` */
export function accessDocRef(
    db: admin.firestore.Firestore,
    poolId: string,
): admin.firestore.DocumentReference {
    return db
        .collection("pools")
        .doc(poolId)
        .collection(POOL_PRIVATE_SUBCOLLECTION)
        .doc(POOL_ACCESS_DOC_ID);
}

/**
 * The legacy plaintext a pool document may still be carrying, pulled out of an
 * already-fetched snapshot so callers do not pay a second read.
 *
 * PURE (takes data, not a ref) so the precedence is unit-testable.
 */
export function legacyPlaintextOf(poolData: Record<string, unknown> | undefined): string | null {
    if (!poolData) return null;
    const grid = poolData.gridPassword;
    if (typeof grid === "string" && grid.length > 0) return grid;
    const ac = poolData.accessControl as { password?: unknown } | undefined;
    if (ac && typeof ac.password === "string" && ac.password.length > 0) return ac.password;
    return null;
}

/** The legacy hash a pool document may still be carrying (bracket publish path). */
export function legacyHashOf(poolData: Record<string, unknown> | undefined): string | null {
    const h = poolData?.[LEGACY_HASH_FIELD];
    return typeof h === "string" && h.length > 0 ? h : null;
}

/**
 * Everything we hold for this pool, private doc first.
 *
 * One extra read per verify. Deliberate: the alternative is keeping a copy of
 * the hash on the public document, which is the thing this phase removes.
 */
export async function readPoolSecret(
    db: admin.firestore.Firestore,
    poolId: string,
    poolData: Record<string, unknown> | undefined,
): Promise<StoredPoolSecret> {
    const snap = await accessDocRef(db, poolId).get();
    const privateHash = snap.exists ? (snap.data()?.passwordHash as unknown) : undefined;
    const hash = typeof privateHash === "string" && privateHash.length > 0
        ? privateHash
        : legacyHashOf(poolData);
    return { hash, plaintext: legacyPlaintextOf(poolData) };
}

/**
 * What `publishBracketPool` should do with the pool's password.
 *
 * `keep` writes NOTHING to the access doc — it is the "leave it alone" branch,
 * and it exists because publish must never delete a password (codex r2 P1).
 */
export type PublishPasswordPlan =
    | { source: "supplied"; plaintext: string; willBeProtected: true }
    | { source: "legacy-plaintext"; plaintext: string; willBeProtected: true }
    | { source: "legacy-hash"; hash: string; willBeProtected: true }
    | { source: "keep"; willBeProtected: boolean };

/**
 * PURE decision for the publish path, so its four branches are testable without
 * a transaction.
 *
 * ⚠️ PUBLISH NEVER CLEARS. The old code was
 * `passwordHash: passwordHash || FieldValue.delete()`, which was harmless while
 * publish was the ONLY writer — a DRAFT could not hold a stored hash. Phase B
 * adds `setPoolPassword`, which a commissioner CAN call on a draft, so an
 * omitted `password` on publish would have deleted it and opened the pool. An
 * omitted password now means "leave it alone", the same
 * empty-is-not-a-clear rule the client seam and the rules predicate follow.
 * Removing a password is one explicit act: `setPoolPassword(poolId, null)`.
 *
 * The legacy branches matter for a draft written by the PRE-Phase-B dashboard,
 * which could put a plaintext `accessControl.password` on the public doc. The
 * scrub deletes that field on publish either way, so without adopting it here
 * the publish would destroy the commissioner's setting rather than migrate it.
 */
export function publishPasswordPlan(
    supplied: string | null | undefined,
    hasExistingSecret: boolean,
    poolData: Record<string, unknown> | undefined,
): PublishPasswordPlan {
    if (typeof supplied === "string" && supplied.length > 0) {
        return { source: "supplied", plaintext: supplied, willBeProtected: true };
    }
    if (hasExistingSecret) return { source: "keep", willBeProtected: true };
    const legacyPlain = legacyPlaintextOf(poolData);
    if (legacyPlain) return { source: "legacy-plaintext", plaintext: legacyPlain, willBeProtected: true };
    const legacy = legacyHashOf(poolData);
    if (legacy) return { source: "legacy-hash", hash: legacy, willBeProtected: true };
    return { source: "keep", willBeProtected: false };
}

/**
 * The patch that scrubs every legacy password field off the PUBLIC pool doc and
 * sets the non-secret marker. Exported so the migration and the runtime paths
 * provably write the same thing (and so a dry run can print it).
 */
export function scrubPatch(hasPassword: boolean): Record<string, unknown> {
    return {
        gridPassword: FieldValue.delete(),
        "accessControl.password": FieldValue.delete(),
        [LEGACY_HASH_FIELD]: FieldValue.delete(),
        [HAS_POOL_PASSWORD_FIELD]: hasPassword,
    };
}

/**
 * Store (or clear) a pool's password. `null` CLEARS it.
 *
 * Order matters: the private doc is written FIRST, then the public doc is
 * scrubbed. If the second write fails the pool is still gated (the private hash
 * exists) and the legacy plaintext is still there — no worse than before. The
 * reverse order would leave a window where the gate is armed with nothing
 * behind it.
 */
export async function writePoolSecret(
    db: admin.firestore.Firestore,
    poolId: string,
    password: string | null,
): Promise<{ hasPassword: boolean }> {
    const ref = accessDocRef(db, poolId);
    const now = Date.now();
    if (password === null) {
        await ref.set({ passwordHash: FieldValue.delete(), updatedAt: now }, { merge: true });
        await db.collection("pools").doc(poolId).update(scrubPatch(false));
        return { hasPassword: false };
    }
    await ref.set({ passwordHash: hashPoolPassword(password), updatedAt: now }, { merge: true });
    await db.collection("pools").doc(poolId).update(scrubPatch(true));
    return { hasPassword: true };
}

/**
 * Rehash-on-successful-verify (item 13c). Called only after a match against a
 * legacy form — a bare sha256 hash, or plaintext on the public doc — so the
 * plaintext is in hand exactly once and is upgraded on the way through.
 *
 * Best-effort by design: a failure here must never turn a correct password into
 * a rejected one, so the caller logs and continues.
 */
export async function rehashOnVerify(
    db: admin.firestore.Firestore,
    poolId: string,
    password: string,
): Promise<void> {
    await writePoolSecret(db, poolId, password);
}
