import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { overrideLockedSpreadInternal, handleFrozenSpreadChange } from "../../nflSpreadOverride";
import { FROZEN_SPREADS_COLLECTION, type FrozenSpread } from "../../shared/frozenSpread";
import { overrideAuditId } from "../../lib/frozenSpreadAudit";

/**
 * `overrideLockedSpread` and the frozen-store trigger, end to end against a real
 * Firestore (PLAN-NFL-SPREAD-FREEZE 2.1 / 2.4, Revision 1).
 *
 * The case that earns this file more than any other is `frozenAt` surviving an
 * override. Codex round 9 of the original found the obvious spelling —
 * `spread = { value, locked: true, overrideId }` — drops the marker, so the FIRST
 * legitimate override would blind the detector to every unauthorised change on
 * that game afterwards. An approved correction quietly disarming the alarm for
 * good is not something a type checker notices.
 */

const ACTOR = { uid: "admin-1", email: "kstruck@gmail.com" };
const SLATE = { season: "2026", seasonType: 1, week: 4 };
const RESCORE_QUEUE = "nfl_rescore_queue";

async function clearAll() {
    const db = admin.firestore();
    for (const col of ["nfl_games", FROZEN_SPREADS_COLLECTION, "admin_audit", RESCORE_QUEUE]) {
        const snap = await db.collection(col).get();
        await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
}

async function seedGame(id: string, over: Record<string, unknown> = {}) {
    await admin.firestore().collection("nfl_games").doc(id).set({
        id, ...SLATE, startTime: Date.now() + 2 * 86_400_000, status: "SCHEDULED",
        homeTeam: { abbreviation: "KC" }, awayTeam: { abbreviation: "DET" },
        spread: { value: -3.5, locked: false },
        ...over,
    });
}

async function seedFrozen(id: string, over: Partial<FrozenSpread> = {}) {
    const rec: FrozenSpread = {
        gameId: id, value: -3.5, frozenAt: 1_700_000_000_000, ...SLATE, source: "freeze", ...over,
    };
    await admin.firestore().collection(FROZEN_SPREADS_COLLECTION).doc(id).set(rec);
    return rec;
}

const frozenOf = async (id: string) =>
    (await admin.firestore().collection(FROZEN_SPREADS_COLLECTION).doc(id).get()).data() as FrozenSpread | undefined;

const auditRows = async () =>
    (await admin.firestore().collection("admin_audit").get()).docs.map((d) => d.data() as Record<string, unknown>);

const queueSize = async () => (await admin.firestore().collection(RESCORE_QUEUE).get()).size;

describe("overrideLockedSpreadInternal (emulator)", () => {
    beforeEach(clearAll);

    it("AMENDS a frozen record and LEAVES frozenAt WHERE IT IS", async () => {
        await seedGame("g1");
        const before = await seedFrozen("g1", { value: -3.5, frozenAt: 1_700_000_000_000 });

        const res = await overrideLockedSpreadInternal(admin.firestore(), ACTOR, {
            gameId: "g1", value: -7, reason: "ESPN published the wrong favourite",
        });

        expect(res).toMatchObject({ success: true, shape: "amend", previousValue: -3.5 });
        const after = await frozenOf("g1");
        expect(after).toMatchObject({
            value: -7, source: "override", overrideId: res.overrideId,
            // The whole point: untouched.
            frozenAt: before.frozenAt, season: "2026", seasonType: 1, week: 4,
        });
    });

    it("CREATES a frozen record for a game added to an ALREADY-FROZEN slate — R3's remediation path", async () => {
        // A flex or a late addition joins a slate after it froze. Without a create
        // shape the slate is permanently incomplete and ATS submissions are blocked
        // for good (codex round 5 on the revision).
        await seedGame("late");
        await seedGame("sibling");
        await seedFrozen("sibling");
        const res = await overrideLockedSpreadInternal(admin.firestore(), ACTOR, {
            gameId: "late", value: 2.5, reason: "Game flexed into this slate after the freeze",
        });

        expect(res).toMatchObject({ shape: "create", previousValue: null });
        expect(await frozenOf("late")).toMatchObject({
            gameId: "late", value: 2.5, source: "override", overrideId: res.overrideId, ...SLATE,
        });
    });

    it("REFUSES TO CREATE the first frozen record of an unfrozen slate", async () => {
        // Codex r1 on this PR. `slateAlreadyFrozen` reads "any record exists for
        // this slate", so one override on an untouched week would make the weekly
        // freeze skip it PERMANENTLY — the other fifteen games never freeze and
        // every ATS pool on the slate is blocked behind SPREADS_NOT_LOCKED with no
        // path back. It would also be a manual freeze before the stated cutoff, by
        // the one door built to bypass that rule legitimately.
        await seedGame("g1");
        await expect(
            overrideLockedSpreadInternal(admin.firestore(), ACTOR, {
                gameId: "g1", value: -7, reason: "trying to freeze one game early",
            }),
        ).rejects.toThrow(/no frozen lines at all/);
        expect(await frozenOf("g1")).toBeUndefined();
        expect(await auditRows()).toEqual([]);
    });

    it("writes the audit row IN THE SAME TRANSACTION, carrying the same overrideId", async () => {
        // The alternative — the trigger goes looking for a recent audit record —
        // races in both directions, and writeAdminAudit swallows its own write
        // failures so the row may never appear at all (codex round 3).
        await seedGame("g1");
        await seedFrozen("g1");
        const res = await overrideLockedSpreadInternal(admin.firestore(), ACTOR, {
            gameId: "g1", value: -7, reason: "Corrected against the closing line",
        });

        const rows = await auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "OVERRIDE_LOCKED_SPREAD", targetId: "g1", actorUid: ACTOR.uid });
        expect((rows[0].metadata as Record<string, unknown>).overrideId).toBe(res.overrideId);
        expect((rows[0].metadata as Record<string, unknown>).reason).toBe("Corrected against the closing line");
    });

    it("leaves an audit record the TRIGGER can verify, under the derived id", async () => {
        // The two halves of r6 meet here: the callable writes the proof, and the
        // trigger reads it. If this id ever drifts, every legitimate override is
        // filed as a forgery.
        await seedGame("g1");
        await seedFrozen("g1");
        const res = await overrideLockedSpreadInternal(admin.firestore(), ACTOR, {
            gameId: "g1", value: -7, reason: "Corrected against the closing line",
        });
        const proof = await admin.firestore().collection("admin_audit").doc(overrideAuditId(res.overrideId)).get();
        expect(proof.exists).toBe(true);

        await handleFrozenSpreadChange(admin.firestore(), {
            gameId: "g1", eventId: "ev-real",
            before: { gameId: "g1", value: -3.5, frozenAt: 1, ...SLATE, source: "freeze" },
            after: (await frozenOf("g1"))!,
        });
        const rows = await auditRows();
        expect(rows.filter(r => r.action === "UNAPPROVED_FROZEN_SPREAD_CHANGE")).toEqual([]);
    });

    it("does NOT enqueue a rescore itself — the trigger owns that, because it covers every writer", async () => {
        await seedGame("g1");
        await seedFrozen("g1");
        await overrideLockedSpreadInternal(admin.firestore(), ACTOR, { gameId: "g1", value: -7, reason: "a good reason here" });
        expect(await queueSize()).toBe(0);
    });

    it("refuses a game that does not exist, and writes nothing", async () => {
        await expect(
            overrideLockedSpreadInternal(admin.firestore(), ACTOR, { gameId: "ghost", value: -7, reason: "a good reason here" }),
        ).rejects.toThrow();
        expect(await auditRows()).toEqual([]);
    });

    it("refuses to create a frozen line for a game with a malformed slate", async () => {
        await seedGame("bad", { week: null });
        await expect(
            overrideLockedSpreadInternal(admin.firestore(), ACTOR, { gameId: "bad", value: -7, reason: "a good reason here" }),
        ).rejects.toThrow(/slate key/);
        expect(await frozenOf("bad")).toBeUndefined();
    });

    it("does NOT touch nfl_games", async () => {
        await seedGame("g1");
        await seedFrozen("g1");
        await overrideLockedSpreadInternal(admin.firestore(), ACTOR, { gameId: "g1", value: -7, reason: "a good reason here" });
        const game = (await admin.firestore().collection("nfl_games").doc("g1").get()).data();
        expect(game?.spread).toEqual({ value: -3.5, locked: false });
    });
});

describe("handleFrozenSpreadChange (emulator) — the detector and the handoff", () => {
    beforeEach(clearAll);

    const change = (before: FrozenSpread | undefined, after: FrozenSpread | undefined, eventId = "ev-1") =>
        handleFrozenSpreadChange(admin.firestore(), { gameId: "g1", eventId, before, after });

    const rec = (over: Partial<FrozenSpread> = {}): FrozenSpread => ({
        gameId: "g1", value: -3.5, frozenAt: 1_700_000_000_000, ...SLATE, source: "freeze", ...over,
    });

    it("enqueues a rescore for a normal freeze create, and files NO unapproved row", async () => {
        await change(undefined, rec());
        expect(await queueSize()).toBe(1);
        expect(await auditRows()).toEqual([]);
    });

    it("ENQUEUES AND AUDITS a console edit — value moved with no provenance", async () => {
        await change(rec(), rec({ value: -9 }));
        expect(await queueSize()).toBe(1);
        const rows = await auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "UNAPPROVED_FROZEN_SPREAD_CHANGE", targetId: "g1", status: "error" });
    });

    it("ENQUEUES BUT DOES NOT AUDIT an override whose audit record actually exists", async () => {
        // Both halves matter. Exempting an approved override from the RESCORE would
        // leave finalized ATS standings on the old number because the change was
        // properly approved (codex round 11).
        await admin.firestore().collection("admin_audit").doc(overrideAuditId("o2")).set({ action: "OVERRIDE_LOCKED_SPREAD" });
        await change(rec({ overrideId: "o1" }), rec({ value: -9, overrideId: "o2", source: "override" }));
        expect(await queueSize()).toBe(1);
        // Only the seeded proof row; no unapproved row was added.
        const rows = await auditRows();
        expect(rows.filter(r => r.action === "UNAPPROVED_FROZEN_SPREAD_CHANGE")).toEqual([]);
    });

    it("AUDITS A FORGED overrideId — a claim on the document is not a proof (codex r6)", async () => {
        // A console or Admin-SDK writer can set `source: 'override'` and any fresh
        // UUID by hand, which the self-declared table waves straight through. The
        // callable commits its audit row in the SAME transaction under an id derived
        // from the override id, so a real override always has one and a forged id
        // never does.
        await change(rec({ overrideId: "o1" }), rec({ value: -9, overrideId: "forged", source: "override" }));
        expect(await queueSize()).toBe(1);
        const rows = await auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "UNAPPROVED_FROZEN_SPREAD_CHANGE" });
        expect((rows[0].metadata as Record<string, unknown>).detail).toContain("not written by overrideLockedSpread");
    });

    it("handles a DELETE, taking the slate key from `before`", async () => {
        // A Firestore delete has no `after` document at all, and the slate key lives
        // only in the deleted record (codex round 6 on the revision).
        await change(rec(), undefined);
        expect(await queueSize()).toBe(1);
        const rows = await auditRows();
        expect(rows[0]).toMatchObject({ action: "UNAPPROVED_FROZEN_SPREAD_CHANGE" });
        expect((rows[0].metadata as Record<string, unknown>).kind).toBe("delete");
    });

    it("does nothing at all for a write that changed nothing", async () => {
        await change(rec(), rec());
        expect(await queueSize()).toBe(0);
        expect(await auditRows()).toEqual([]);
    });

    it("STILL ENQUEUES THE REAL WEEK when a write mangles the slate key (codex r3)", async () => {
        // A console write that changes the slate fields along with the value would,
        // on an `after`-only key, enqueue the wrong week — or none — while the game
        // itself is still in its original slate in `nfl_games` and grading resolves
        // the frozen record by GAME ID regardless of what the record claims.
        await change(rec(), rec({ value: -9, week: NaN as unknown as number }));
        expect(await queueSize()).toBe(1);
        const queued = (await admin.firestore().collection(RESCORE_QUEUE).get()).docs[0].data();
        expect(queued).toMatchObject({ season: "2026", seasonType: 1, week: 4 });
        const rows = await auditRows();
        expect(rows[0]).toMatchObject({ action: "UNAPPROVED_FROZEN_SPREAD_CHANGE", status: "error" });
    });

    it("enqueues BOTH weeks when a write moves the record to a different slate", async () => {
        await change(rec(), rec({ value: -9, week: 5 }));
        expect(await queueSize()).toBe(2);
    });

    it("ENQUEUES THE WEEK THE GAME IS IN NOW, not only the one its record remembers", async () => {
        // Codex r4 on this PR. A game re-scheduled into a different week after its
        // slate froze keeps the OLD key on its frozen record — the override
        // preserves it on purpose. But scoring selects games from `nfl_games` and
        // resolves the frozen line by GAME ID, so the week that actually needs
        // repairing is the one the game is in now.
        await seedGame("g1", { week: 6 });
        await change(rec({ week: 4 }), rec({ value: -9, week: 4, overrideId: "o1", source: "override" }));
        const weeks = (await admin.firestore().collection(RESCORE_QUEUE).get()).docs
            .map((d) => d.data().week)
            .sort();
        expect(weeks).toEqual([4, 6]);
    });

    it("alerts rather than silently returning when NEITHER side has a usable slate key", async () => {
        const broken = rec({ week: NaN as unknown as number });
        await change(broken, { ...broken, value: -9 });
        expect(await queueSize()).toBe(0);
        const rows = await auditRows();
        expect(rows[0]).toMatchObject({ action: "FROZEN_SPREAD_SLATE_KEY_MISSING", status: "error" });
    });

    it("IS IDEMPOTENT ACROSS A RETRY — the same event id writes one audit row", async () => {
        // Triggers are delivered at-least-once, and an auto-id append from a retry
        // is an indistinguishable duplicate in a forensic log.
        await change(rec(), rec({ value: -9 }), "ev-retry");
        await change(rec(), rec({ value: -9 }), "ev-retry");
        expect(await auditRows()).toHaveLength(1);
    });
});
