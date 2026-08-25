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
