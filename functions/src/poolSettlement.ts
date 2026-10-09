import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { settlePoolSchema } from "./schemas/poolSettlement";
import { assertPoolOwnerOrManagerNoCo } from "./poolOps";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { isSimPool } from "./shared/testPool";
import { withScoringLease, fencedWrite } from "./lib/scoringLease";
import { maybeFinalizeNFLPool, computeFinalRanks, seasonPlacesPublication } from "./nflFinalize";
import { writeAdminAudit } from "./lib/adminAudit";
import { sendEmail } from "./reminders";
import { settlementEmail } from "./lib/settlementEmail";
import { resolveMemberEmails } from "./poolExceptions";
import {
    settlementPhase,
    aliveSetMismatch,
    settlementMoney,
    rebuyDuesOf,
    throughWeekOf,
    followUpClaimable,
} from "./lib/settlement";
import { SETTLED, joinNames, type PoolSettlement, type SettlementPreview } from "./shared/settlement";
import type { AuditLogEvent, User } from "./types";

/**
 * settlePool — end a Survivor pool early because its remaining players agreed to
 * split the pot (PLAN-SPLIT-POT-SETTLEMENT §2.2, Kevin 2026-10-08).
 *
 * The settlement IS a season finalization, run now: `maybeFinalizeNFLPool` with
 * `force: 'SETTLED'` ranks every ALIVE entry 1st (co-champions), splits the 1st
 * place prize between them, and writes season history, profiles and Season
 * Places exactly as a natural season end would — so My Prizes and the payout
 * ledger need no change. Only then is the pool retired.
 *
 * 🛑 ORDER IS AN INVARIANT (review r1 #6). `status`/`closedVia` are not touched
 * until every finalizer write has committed: the finalizer and `checkFence` both
 * refuse a COMPLETED pool, so the other order can never finish.
 *
 * 🛑 NOT `isLocked` / `isFinal` / `scores.gameStatus` (sweep S1). `closePool`
 * dual-writes those; here they would fire `onPoolLocked` (stats) and
 * `onGameComplete` (a SQUARES post-game email) on an NFL pool.
 *
 * Crash recovery: `settlementStartedAt` lets a FULL settlement re-run after the
 * finalizer committed; the FOLLOW_UP phase completes the Super-Admin audit and
 * the member emails after the flip committed (`lib/settlement.ts`).
 */
export const settlePool = validated(
    { schema: settlePoolSchema, label: "settlePool", appCheck: "monitor" },
    async (input, request) => {
        const uid = request.auth!.uid;
        const db = admin.firestore();
        const { poolId, entryIds, notifyMembers } = input;
        const note = input.note ? input.note : null;

        const poolRef = db.collection("pools").doc(poolId);
        const snap = await poolRef.get();
        if (!snap.exists) throw new HttpsError("not-found", "Pool not found.");
        const pool = { id: snap.id, ...snap.data() } as Record<string, any>;

        // D2: owner / managerUid / SUPER_ADMIN — never a co-commissioner. Same gate
        // as cancelPool and closePool: this records who the money goes to.
        assertPoolOwnerOrManagerNoCo(pool, uid, await confirmedAdminClaim(request));
        if (pool.type !== "NFL_SURVIVOR") {
            throw new HttpsError("failed-precondition", "NOT_SURVIVOR: Only a Survivor pool can be settled by splitting the pot.");
        }
        if (isSimPool(pool, poolId)) {
            throw new HttpsError("failed-precondition", "SIM_POOL: Test pools cannot be settled.");
        }

        const phase = settlementPhase(pool);
        if (phase.kind === "REFUSE") throw refusal(phase.code);

        // Read-only preview (codex code-review r1 P1). Writes nothing and takes no
        // lease; the real call re-reads and re-checks everything under the lease.
        if (input.preview) {
            if (phase.kind !== "FULL") throw refusal("ALREADY_SETTLED");
            return { success: true, preview: await buildPreview(db, poolRef, pool) };
        }

        let settlement: PoolSettlement;
        if (phase.kind === "FULL") {
            const result = await withScoringLease(db, poolId, Date.now(), (fence) =>
                runFullSettlement(db, poolId, pool.name, fence, { uid, entryIds: entryIds ?? [], note, notifyMembers }));
            if (result === "LEASE_BUSY") {
                throw new HttpsError("failed-precondition", "SCORING_IN_PROGRESS: The pool is being scored right now. Try again in a minute.");
            }
            settlement = result;
        } else {
            settlement = pool.settlement as PoolSettlement;
        }

        // ---- Follow-up: runs after the flip, and alone on a FOLLOW_UP retry ----
        const owed = phase.kind === "FULL"
            ? { adminAudit: true, email: settlement.notifyMembers }
            : { adminAudit: phase.adminAudit, email: phase.email };

        // Each step is CLAIMED in a transaction first (codex code-review r1 P2), so
        // overlapping retries cannot both run it. A lost claim is not an error:
        // another attempt is doing, or has done, that step.
        if (owed.adminAudit && await claimFollowUp(db, poolRef, "adminAudit")) {
            await writeAdminAudit({
                actorUid: uid,
                actorEmail: request.auth!.token.email as string | undefined,
                action: "POOL_SETTLED",
                targetType: "pool",
                targetId: poolId,
                metadata: {
                    name: pool.name ?? null,
                    winners: settlement.entryIds,
                    prizePerEntry: settlement.prizePerEntry,
                    pot: settlement.pot,
                    rebuyDuesExcluded: settlement.rebuyDuesExcluded,
                },
                status: "success",
            });
            await poolRef.update({ "settlement.adminAuditedAt": Date.now() });
        }

        let emailed = 0;
        if (owed.email && await claimFollowUp(db, poolRef, "email")) {
            const { subject, html } = settlementEmail(String(pool.name || "Your pool"), settlement);
            for (const email of await settlementRecipients(db, poolRef, pool.participantIds)) {
                await sendEmail(db, email, subject, html, { poolId, reason: "pool_settled" });
                emailed++;
            }
            await poolRef.update({ "settlement.emailedAt": Date.now() });
        }

        return { success: true, settlement, emailed };
    },
);

/** Take the claim on one follow-up step, or report that it is not ours to run. */
async function claimFollowUp(
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference,
    step: "adminAudit" | "email",
): Promise<boolean> {
    return db.runTransaction(async (tx) => {
        const now = Date.now();
        const settlement = (await tx.get(poolRef)).data()?.settlement as Partial<PoolSettlement> | undefined;
        if (!followUpClaimable(settlement, step, now)) return false;
        tx.update(poolRef, { [`settlement.${step === "email" ? "emailClaimedAt" : "adminAuditClaimedAt"}`]: now });
        return true;
    });
}

/**
 * What the settlement WOULD record, from the finalizer's own functions — the
 * same `computeFinalRanks` + `seasonPlacesPublication` it runs — so the panel
 * cannot show a different field, pot or share than the write produces (unless
 * the pool changes in between, which the real call re-checks and refuses).
 */
async function buildPreview(
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference,
    pool: Record<string, any>,
): Promise<SettlementPreview> {
    const entriesSnap = await poolRef.collection("entries").get();
    const entries: Array<Record<string, any> & { id: string }> =
        entriesSnap.docs.map(d => ({ ...(d.data() as Record<string, any>), id: d.id }));
    const alive = entries.filter(e => e.status !== "ELIMINATED").sort((a, b) => a.id.localeCompare(b.id));
    const membersSnap = await poolRef.collection("members").get();
    const ranked = computeFinalRanks("NFL_SURVIVOR", entries);
    const pub = seasonPlacesPublication(pool, ranked, entries.length);
    const money = settlementMoney({ seasonPlaces: pub.seasonPlaces, seasonPrize: pub.seasonPrize }, alive.map(e => e.id));
    return {
        alive: alive.map(e => ({ id: e.id, name: String(e.entryName || e.userName || "Player") })),
        pot: money.pot,
        prizePerEntry: money.prizePerEntry,
        entryCount: pub.seasonPrize ? pub.seasonPrize.entryCount : null,
        rebuyDuesExcluded: rebuyDuesOf(membersSnap.docs.map(d => d.data())),
    };
}

/**
 * Everyone on the roster, not only entry owners. `resolveMemberEmails` (shared
 * with cancelPool) reads entry owners alone, which misses roster members who
 * never made a pick — and the help text promises EVERY member hears the pool is
 * over. Union of `participantIds` and the entry owners, deduplicated by uid
 * then by address.
 */
async function settlementRecipients(
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference,
    participantIds: unknown,
): Promise<string[]> {
    const fromEntries = await resolveMemberEmails(db, poolRef);
    const uids = Array.isArray(participantIds) ? [...new Set(participantIds.filter((u): u is string => typeof u === "string" && u.length > 0))] : [];
    const emails = new Set(fromEntries);
    for (const uid of uids) {
        const snap = await db.collection("users").doc(uid).get();
        const email = snap.exists ? (snap.data() as User).email : undefined;
        if (email) emails.add(email);
    }
    return [...emails];
}

function refusal(code: "ALREADY_SETTLED" | "ALREADY_CLOSED" | "ALREADY_FINALIZED"): HttpsError {
    const text = {
        ALREADY_SETTLED: "This pool has already been settled.",
        ALREADY_CLOSED: "This pool is already closed or cancelled.",
        ALREADY_FINALIZED: "This pool's season has already been finalized.",
    }[code];
    return new HttpsError("failed-precondition", `${code}: ${text}`);
}

async function runFullSettlement(
    db: admin.firestore.Firestore,
    poolId: string,
    poolName: unknown,
    fence: Parameters<typeof fencedWrite>[2],
    args: { uid: string; entryIds: string[]; note: string | null; notifyMembers: boolean },
): Promise<PoolSettlement> {
    const poolRef = db.collection("pools").doc(poolId);

    // Step 5 — crash-recovery marker, under the fence. Re-judged on the pool as
    // read in this transaction: a cancel that committed since the outer read is
    // refused here (checkFence), anything else that moved is refused below.
    await fencedWrite(db, poolRef, fence, (_tx, poolData) => {
        const p = settlementPhase((poolData ?? {}) as any);
        if (p.kind !== "FULL") throw refusal(p.kind === "REFUSE" ? p.code : "ALREADY_SETTLED");
        return poolData?.settlementStartedAt ? {} : { settlementStartedAt: Date.now() };
    });

    // Step 6 — the ALIVE set, read AFTER the lease is held. Picks and rebuys are
    // lease-checked, so it cannot move until the lease is released. "Alive" is
    // the finalizer's own definition (`status !== 'ELIMINATED'`), so the set
    // checked here is exactly the set it will rank 1st.
    const entriesSnap = await poolRef.collection("entries").get();
    const entries: Array<Record<string, any> & { id: string }> =
        entriesSnap.docs.map(d => ({ ...(d.data() as Record<string, any>), id: d.id }));
    const alive = entries.filter(e => e.status !== "ELIMINATED");
    const mismatch = aliveSetMismatch(args.entryIds, alive.map(e => e.id));
    if (mismatch === "NO_SURVIVORS") {
        throw new HttpsError("failed-precondition", "NO_SURVIVORS: Nobody is still alive in this pool, so there is no pot to split.");
    }
    if (mismatch) {
        throw new HttpsError("failed-precondition", "WINNERS_MUST_BE_ALIVE_SET: The players still alive have changed since this page loaded. Reload and try again.");
    }

    const membersSnap = await poolRef.collection("members").get();
    const rebuyDuesExcluded = rebuyDuesOf(membersSnap.docs.map(d => d.data()));

    // Step 7 — the season-end finalizer, now.
    const outcome = await maybeFinalizeNFLPool(db, poolId, { fence, force: "SETTLED" });
    if (!outcome.finalized) {
        throw new HttpsError("failed-precondition", `FINALIZE_DECLINED: ${outcome.reason ?? "the season could not be finalized"}`);
    }

    // Step 8 — the flip, with the pool audit row IN THE SAME TRANSACTION, so the
    // row exists if and only if the flip committed (review r2 #3).
    const winnerIds = alive.map(e => e.id).sort();
    const winnerNames = winnerIds.map(id => {
        const e = alive.find(x => x.id === id)!;
        return String(e.entryName || e.userName || "Player");
    });
    let record: PoolSettlement | undefined;
    await fencedWrite(db, poolRef, fence, (tx, poolData) => {
        const now = Date.now();
        const money = settlementMoney(poolData ?? {}, winnerIds);
        record = {
            kind: "SPLIT",
            entryIds: winnerIds,
            winnerNames,
            settledAt: now,
            settledBy: args.uid,
            note: args.note,
            throughWeek: throughWeekOf(poolData?.scoredWeeks),
            notifyMembers: args.notifyMembers,
            prizePerEntry: money.prizePerEntry,
            pot: money.pot,
            rebuyDuesExcluded,
        };
        const auditRef = poolRef.collection("audit").doc();
        const event: AuditLogEvent = {
            id: auditRef.id,
            poolId,
            timestamp: now,
            type: "POOL_SETTLED",
            message: `Pool "${String(poolName ?? "")}" was settled: the pot was split between ${joinNames(winnerNames)}.`,
            severity: "WARNING",
            actor: { uid: args.uid, role: "ADMIN", label: "Commissioner" },
            payload: {
                winners: winnerIds,
                prizePerEntry: record.prizePerEntry,
                pot: record.pot,
                rebuyDuesExcluded,
                throughWeek: record.throughWeek,
            },
        };
        tx.set(auditRef, { ...event, createdAt: Timestamp.now() });
        return { status: "COMPLETED", closedVia: SETTLED, closedAt: now, settlement: record };
    });
    return record!;
}
