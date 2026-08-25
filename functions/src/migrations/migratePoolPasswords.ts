/**
 * Evacuation sweep for pool passwords (PLAN-AUDIT-AUTH-HARDENING Phase B).
 *
 * Moves every EXISTING pool's password material off the world-readable
 * `pools/{id}` document and into `pools/{id}/private/access`, then deletes the
 * public copies. New pools never acquire them (the create schema strips them and
 * `firestore.rules` denies a client write), so this closes the legacy window
 * only.
 *
 * Rule 1 (mmp-change-control) — this writes production data:
 *   - a kill-switch, OFF by default (`system/config.poolPasswordMigration`);
 *   - dry-run DEFAULT, declared at the SCHEMA layer, not a handler `=== true`;
 *   - a per-run cap and a cursor;
 *   - an `admin_audit` summary on every run, dry or live;
 *   - SUPER_ADMIN only.
 *
 * ⚠️ RUN IT DRY FIRST AND READ THE PLAN. Deleting `gridPassword` from a pool
 * whose members are mid-season is only safe because the replacement gate reads
 * the private doc; a live run against a deploy that does NOT yet carry
 * `verifyPoolAccess` would leave those pools with a marker and no verifier.
 * Deploy order is therefore functions → rules → frontend → sweep, and the
 * checklist in PLAN-AUDIT-AUTH-HARDENING-SWEEPS.md is the authority.
 *
 * ## Why it does not rehash bracket's `passwordHash`
 *
 * A hash cannot be re-derived without the plaintext. Legacy `passwordHash`
 * values are MOVED verbatim into the private doc and keep verifying (both
 * formats are supported); a legacy bare-sha256 value is upgraded to PBKDF2 the
 * next time somebody successfully verifies it (item 13c, in verifyPoolAccess).
 */

import * as admin from "firebase-admin";
import { validated } from "../lib/validated";
import { writeAdminAudit } from "../lib/adminAudit";
import { migratePoolPasswordsSchema } from "../schemas/poolPassword";
import { hashPoolPassword } from "../lib/poolPassword";
import {
    DOTTED_ACCESS_PASSWORD_FIELD,
    accessDocRef,
    legacyHashOf,
    legacyPlaintextOf,
    scrubUpdateArgs,
} from "../lib/poolAccess";
import { readJobGate } from "../nflSchedule";

/** What the sweep would do to one pool. `null` = nothing to do. */
export type PoolPasswordAction = "hash-plaintext" | "move-hash" | "scrub-only";
export type PoolPasswordPlan = { poolId: string; action: PoolPasswordAction } | null;

/**
 * PURE planner, so every branch is testable without an emulator.
 *
 * `hasPrivate` is whether `pools/{id}/private/access` already holds a hash — a
 * re-run must not overwrite a NEWER password with the stale plaintext still
 * sitting on the public doc, so an existing private hash downgrades the plan to
 * a scrub of the public copies.
 */
export function planForPool(
    poolId: string,
    poolData: Record<string, unknown> | undefined,
    hasPrivate: boolean,
): PoolPasswordPlan {
    const plaintext = legacyPlaintextOf(poolData);
    const legacyHash = legacyHashOf(poolData);
    const marker = poolData?.hasPoolPassword;
    if (!plaintext && !legacyHash) {
        // Nothing public to remove. Only touch the doc if the marker is missing
        // or wrong for a pool that DOES have a private secret.
        return hasPrivate && marker !== true ? { poolId, action: "scrub-only" } : null;
    }
    if (hasPrivate) return { poolId, action: "scrub-only" };
    if (plaintext) return { poolId, action: "hash-plaintext" };
    return { poolId, action: "move-hash" };
}

export const migratePoolPasswords = validated(
    {
        schema: migratePoolPasswordsSchema,
        label: "migratePoolPasswords",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
    },
    async (input, request) => {
        const db = admin.firestore();

        // Kill-switch, same gate shape and the same fail-safe default as every
        // other guarded job: a config read that THROWS must not be read as
        // "enabled". `enabled !== true` stops here.
        const cfg = (await db.doc("system/config").get()).data()?.poolPasswordMigration as
            | { enabled?: boolean; dryRun?: boolean }
            | undefined;
        const gate = readJobGate(cfg);

        // The run is DRY if EITHER the caller asked for dry (schema default true)
        // OR the config still says dry. Both have to be deliberately turned off
        // for a write to happen — the config is Kevin's arming step, the
        // parameter is the operator's.
        const dryRun = input.dryRun || gate.dryRun;

        if (!gate.enabled) {
            // Audited even though nothing ran (codex r4, P2). The doc header
            // promises an `admin_audit` row on EVERY run, and the arming
            // checklist's step 1 is deliberately a disarmed call whose whole
            // purpose is to watch the gate refuse — evidence that lives only in
            // a returned object nobody kept is not evidence.
            await writeAdminAudit({
                actorUid: request.auth!.uid,
                actorEmail: request.auth!.token.email as string | undefined,
                action: "MIGRATE_POOL_PASSWORDS",
                targetType: "pool",
                metadata: { skipped: "kill-switch off", dryRun: true, poolsScanned: 0, poolsChanged: 0 },
                status: "success",
            });
            return {
                skipped: "kill-switch off (system/config.poolPasswordMigration.enabled !== true)",
                dryRun: true,
                poolsScanned: 0,
                poolsChanged: 0,
            };
        }

        const limit = Math.min(input.limit ?? 100, 500);
        const startAfter = input.startAfter;

        let q = db
            .collection("pools")
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(limit);
        if (startAfter) q = q.startAfter(startAfter);
        const snap = await q.get();

        const report = {
            dryRun,
            poolsScanned: snap.docs.length,
            poolsChanged: 0,
            hashedPlaintext: 0,
            movedHash: 0,
            scrubbedOnly: 0,
            dottedFieldsRemoved: 0,
            // Per-pool plan so a dry run is reviewable evidence. NEVER carries a
            // password or a hash — only the pool id and the verb.
            plannedWrites: [] as { poolId: string; action: string }[],
            failures: [] as { poolId: string; error: string }[],
            nextCursor: null as string | null,
        };

        /** One place that maps an action to its counters, so dry and live agree. */
        const countPlan = (poolId: string, action: PoolPasswordAction) => {
            report.poolsChanged++;
            if (action === "hash-plaintext") report.hashedPlaintext++;
            else if (action === "move-hash") report.movedHash++;
            else report.scrubbedOnly++;
            if (report.plannedWrites.length < 200) report.plannedWrites.push({ poolId, action });
        };

        for (const doc of snap.docs) {
            try {
                const accessRef = accessDocRef(db, doc.id);

                if (dryRun) {
                    const data = doc.data() as Record<string, unknown>;
                    const privateSnap = await accessRef.get();
                    const existing = privateSnap.exists ? privateSnap.data()?.passwordHash : undefined;
                    const plan = planForPool(doc.id, data, typeof existing === "string" && existing.length > 0);
                    if (!plan) continue;
                    countPlan(doc.id, plan.action);
                    if (typeof data[DOTTED_ACCESS_PASSWORD_FIELD] === "string") report.dottedFieldsRemoved++;
                    continue;
                }

                // ⚠️ A TRANSACTION, NOT A BATCH (codex r7, P1). The plan is a
                // function of two documents, and a commissioner can call
                // `setPoolPassword` between the read and the write. A batch
                // would then overwrite their BRAND-NEW password with the stale
                // public plaintext and delete the only other copy — the sweep
                // silently rolling a live password back. Re-reading inside the
                // transaction makes a concurrent write a retry, not a loss.
                //
                // It also keeps r6's atomicity: the private secret, the legacy
                // scrub and the marker still commit together or not at all.
                const applied = await db.runTransaction(async (t) => {
                    const [poolSnap, accessSnap] = await t.getAll(doc.ref, accessRef);
                    if (!poolSnap.exists) return null;
                    const fresh = poolSnap.data() as Record<string, unknown>;
                    const stored = accessSnap.exists ? accessSnap.data()?.passwordHash : undefined;
                    const hasPrivate = typeof stored === "string" && stored.length > 0;

                    const plan = planForPool(doc.id, fresh, hasPrivate);
                    if (!plan) return null;

                    if (plan.action === "hash-plaintext") {
                        t.set(
                            accessRef,
                            { passwordHash: hashPoolPassword(legacyPlaintextOf(fresh)!), migratedAt: Date.now() },
                            { merge: true },
                        );
                    } else if (plan.action === "move-hash") {
                        t.set(
                            accessRef,
                            { passwordHash: legacyHashOf(fresh)!, migratedAt: Date.now() },
                            { merge: true },
                        );
                    }
                    // `scrub-only` writes no secret: one already exists (or only
                    // the marker was wrong). The marker follows what IS stored.
                    const willBeProtected = plan.action === "scrub-only" ? hasPrivate : true;
                    t.update(doc.ref, ...scrubUpdateArgs(willBeProtected));
                    return {
                        action: plan.action,
                        dotted: typeof fresh[DOTTED_ACCESS_PASSWORD_FIELD] === "string",
                    };
                });

                // Counted from what the transaction ACTUALLY did, never from the
                // pre-read plan — otherwise the report describes a world that
                // may have moved under it.
                if (!applied) continue;
                countPlan(doc.id, applied.action);
                if (applied.dotted) report.dottedFieldsRemoved++;
            } catch (err: any) {
                report.failures.push({ poolId: doc.id, error: String(err?.message || err) });
            }
        }

        if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;

        await writeAdminAudit({
            actorUid: request.auth!.uid,
            actorEmail: request.auth!.token.email as string | undefined,
            action: "MIGRATE_POOL_PASSWORDS",
            targetType: "pool",
            metadata: {
                dryRun,
                poolsScanned: report.poolsScanned,
                poolsChanged: report.poolsChanged,
                hashedPlaintext: report.hashedPlaintext,
                movedHash: report.movedHash,
                scrubbedOnly: report.scrubbedOnly,
                dottedFieldsRemoved: report.dottedFieldsRemoved,
                plannedWrites: report.plannedWrites.slice(0, 100),
                failures: report.failures.slice(0, 50),
                nextCursor: report.nextCursor,
            },
            status: report.failures.length > 0 ? "error" : "success",
        });

        return report;
    },
);
