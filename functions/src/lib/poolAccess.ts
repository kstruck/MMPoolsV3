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
    // The exotic DOTTED form — a top-level field whose NAME contains a dot.
    // `set()` writes object keys literally, so before the create-schema strip
    // (codex r3 P1) a caller could mint one. Read here so such a pool still
    // verifies and so the migration counts it instead of walking past it.
    const dotted = poolData[DOTTED_ACCESS_PASSWORD_FIELD];
    if (typeof dotted === "string" && dotted.length > 0) return dotted;
    return null;
}

/**
 * A LITERAL top-level field name containing a dot. Naming it needs a
 * `FieldPath`: a string field — object key or varargs — is parsed as a PATH
 * into the nested map and misses this field entirely.
 */
export const DOTTED_ACCESS_PASSWORD_FIELD = "accessControl.password";

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
 * THE ONE SCRUB SHAPE. Every path that touches a pool's password state —
 * `writePoolSecret`, `publishBracketPool`, the migration — goes through this,
 * and it returns a single `update()` argument list so the scrub, the marker and
 * any accompanying fields land in ONE write.
 *
 * ## Why varargs and not an object
 *
 * An object-form `update({ "accessControl.password": FieldValue.delete() })`
 * deletes the NESTED field. It cannot express the deletion of a top-level field
 * whose NAME contains a dot, because every string key is parsed as a path. Only
 * a `FieldPath` can name that field, and a `FieldPath` cannot be an object key.
 * Both targets are emitted here, because both shapes exist in the wild.
 *
 * ## Why ONE shape and not two
 *
 * There were two: an object `scrubPatch()` that every caller used, plus a
 * separate `scrubDottedLegacyField()` that only the migration called. Codex
 * then found the two paths that leaked — publish, and every password change
 * through `writePoolSecret` — in a single round (r6). A partial scrub that
 * three of four callers apply is worse than no scrub, because it reads as
 * complete. One list, nothing optional.
 *
 * ⚠️ `extra` KEYS MUST NOT CONTAIN DOTS — in the varargs form a string field is
 * a field PATH, so a dotted key would silently write a NESTED field instead of
 * the one named. Enforced with a throw rather than a comment.
 */
export function scrubUpdateArgs(
    hasPassword: boolean,
    extra: Record<string, unknown> = {},
): [string | admin.firestore.FieldPath, unknown, ...unknown[]] {
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(extra)) {
        if (k.includes(".")) {
            throw new Error(`scrubUpdateArgs: dotted key "${k}" would be read as a path`);
        }
        args.push(k, v);
    }
    args.push("gridPassword", FieldValue.delete());
    // The NESTED `accessControl.password`.
    args.push(DOTTED_ACCESS_PASSWORD_FIELD, FieldValue.delete());
    args.push(LEGACY_HASH_FIELD, FieldValue.delete());
    args.push(HAS_POOL_PASSWORD_FIELD, hasPassword);
    // The LITERAL top-level field of the same name. A different target.
    args.push(new admin.firestore.FieldPath(DOTTED_ACCESS_PASSWORD_FIELD), FieldValue.delete());
    return args as [string | admin.firestore.FieldPath, unknown, ...unknown[]];
}

/**
 * Store (or clear) a pool's password. `null` CLEARS it.
 *
 * ⚠️ ONE BATCH, NOT TWO WRITES (codex r4, P1). The secret and the marker live on
 * different documents, and an earlier version wrote them sequentially with a
 * comment claiming a partial failure was "no worse than before". It was not: on
 * a pool with no legacy plaintext, a private hash landing while
 * `hasPoolPassword` stayed false leaves a pool that HAS a password and renders
 * UNGATED — the squares route decides purely from the marker. A `WriteBatch`
 * commits both or neither.
 *
 * The batch also carries the legacy-field scrub, so the plaintext never outlives
 * the switchover either.
 */
export async function writePoolSecret(
    db: admin.firestore.Firestore,
    poolId: string,
    password: string | null,
): Promise<{ hasPassword: boolean }> {
    const now = Date.now();
    const hasPassword = password !== null;
    const batch = db.batch();
    batch.set(
        accessDocRef(db, poolId),
        { passwordHash: hasPassword ? hashPoolPassword(password) : FieldValue.delete(), updatedAt: now },
        { merge: true },
    );
    batch.update(db.collection("pools").doc(poolId), ...scrubUpdateArgs(hasPassword));
    await batch.commit();
    return { hasPassword };
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
