/**
 * Input schemas for the pool-core TARGET-NOW callables (sweep #20, #21, #34,
 * #36): createPool, updatePoolSettings, createNFLPool, submitNFLPicks.
 * PURE: zod + zodHelpers only.
 *
 * createPool / createNFLPool are TARGET-NOW-PERMISSIVE (ADR-0001): they get
 * the wrapper (auth + App Check monitor + object envelope) but the payload
 * stays an open record — stripPrivilegedPoolFields + the shared
 * validateCreateInput gate keep doing the field-level work in the handler.
 * Tightening the create envelope is its own future change.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";
import { ENTRY_NAME_MAX, MAX_ENTRIES_PER_USER_CAP } from "../shared/multiEntry";

const poolId = z.string().trim().min(1).max(200);

/**
 * Strip every pool-password field out of a permissive payload
 * (PLAN-AUDIT-AUTH-HARDENING Phase B, NEXT-SESSION-AUDIT-FIXES item 13b).
 *
 * ⚠️ THIS IS THE CHOKE POINT, ON PURPOSE. `gridPassword` reached the
 * world-readable pool document because BOTH squares wizards put it in the
 * create payload and the create envelope is an open `z.record` — so the
 * per-wizard fix would have been two edits that the third wizard, and every
 * future one, silently skips. `validated()` hands the handler the PARSED data
 * (lib/validated.ts), and `createPool` / `createNFLPool` consume exactly that
 * (poolOps.ts:326, nflPools.ts:104), so a transform here removes the field from
 * what the handler can possibly persist, no matter who sent it.
 *
 * It STRIPS rather than hashes: a transform cannot write to Firestore, and the
 * hash's only legitimate home is `pools/{id}/private/access`. The client's
 * `dbService.createPool` calls `setPoolPassword` after the pool exists, which is
 * the one path that can write that document.
 *
 * `accessControl` keeps its non-secret members (requireEmail, requirePhone,
 * customFields) — only `password` is removed.
 *
 * Exported for the unit test; the schema below is the only production caller.
 */
export function stripPoolPasswordFields(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    delete out.gridPassword;
    // Server-owned: the bracket publish path writes it to the private doc now,
    // and a client-supplied value would be an attacker-chosen hash.
    delete out.passwordHash;
    delete out.hasPoolPassword;
    // ⚠️ THE DOTTED FORM IS A REAL BYPASS, NOT A CURIOSITY (codex r3, P1). The
    // create handlers SPREAD this payload into the pool document with `set()`,
    // and `set()` treats an object key as a LITERAL field name — dots and all.
    // So `{"accessControl.password": "secret"}` sailed past a strip that only
    // looked at the nested form and landed on the world-readable doc as a
    // top-level field literally named `accessControl.password`. It is also the
    // exact shape the old bracket dashboard used, so it is the first thing a
    // reader of that code would try.
    delete out["accessControl.password"];
    const ac = out.accessControl;
    if (ac && typeof ac === "object" && !Array.isArray(ac) && "password" in (ac as object)) {
        const copy: Record<string, unknown> = { ...(ac as Record<string, unknown>) };
        delete copy.password;
        out.accessControl = copy;
    }
    return out;
}

/** Permissive create envelope: any object (arrays/primitives rejected). */
export const createPoolPermissiveSchema = z
    .record(z.string(), z.unknown())
    .transform(stripPoolPasswordFields);

/**
 * updatePoolSettings — updates stays open: buildPoolSettingsUpdate enforces the
 * editability matrix. Password fields are stripped for the same reason as on
 * create: this callable holds an Admin SDK handle, so rules do not protect the
 * pool document from it.
 */
export const updatePoolSettingsSchema = z.strictObject({
    poolId,
    updates: z.record(z.string(), z.unknown()).transform(stripPoolPasswordFields),
});

/** submitNFLPicks — the exact dbService payload; per-pick validation needs pool/week context (handler). */
export const submitNFLPicksSchema = z.strictObject({
    poolId,
    week: z.number().int().min(1).max(23),
    picks: z
        .record(z.string().min(1).max(100), z.string().min(1).max(100))
        .refine((o) => Object.keys(o).length <= 50, { message: "too many picks" }),
    confidence: nullish(
        z.record(z.string().min(1).max(100), z.number().int().min(0).max(1000))
            .refine((o) => Object.keys(o).length <= 50, { message: "too many confidence entries" }),
    ),
    tiebreakerPrediction: nullish(z.number().finite()),
    requestId: nullish(z.string().max(200)),
    // PLAN-MULTI-ENTRY T2 (D1/D7). Which of the caller's entries this write
    // addresses — 1..max, default 1 — and an optional display name for it (K5).
    // The server derives the entry id from ctx.subjectUid + entryIndex; the
    // client only ever sends a small integer, so the id is not forgeable.
    entryIndex: nullish(z.number().int().min(1).max(MAX_ENTRIES_PER_USER_CAP)),
    entryName: nullish(z.string().trim().min(1).max(ENTRY_NAME_MAX)),
    // PLAN-WEEKLY-PRIZES §2b / §9 A6. The tiebreak target game id(s) the pick
    // sheet DISPLAYED. The server never stores this list — it computes the
    // canonical target in the transaction and requires equality (frozen value
    // first, else canonical), refusing with TIEBREAK_TARGET_STALE otherwise.
    // Optional: proxy, sim and legacy clients send nothing and are judged
    // against the (then-frozen) canonical target.
    displayedTiebreakTargetIds: nullish(z.array(z.string().min(1).max(100)).max(10)),
});

export type UpdatePoolSettingsInput = z.infer<typeof updatePoolSettingsSchema>;
export type SubmitNFLPicksInput = z.infer<typeof submitNFLPicksSchema>;
