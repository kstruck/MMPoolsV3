import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { settlePoolSchema } from "./schemas/poolSettlement";
import { assertPoolOwnerOrManagerNoCo } from "./poolOps";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { isSimPool } from "./shared/testPool";
import { withScoringLease, fencedWrite } from "./lib/scoringLease";
import { maybeFinalizeNFLPool } from "./nflFinalize";
import { writeAdminAudit } from "./lib/adminAudit";
import { sendEmail } from "./reminders";
import { renderEmailHtml, escapeHtml } from "./emailStyles";
import { resolveMemberEmails } from "./poolExceptions";
import {
    settlementPhase,
    aliveSetMismatch,
    settlementMoney,
    rebuyDuesOf,
    throughWeekOf,
} from "./lib/settlement";
import { SETTLED, joinNames, type PoolSettlement } from "./shared/settlement";
import type { AuditLogEvent } from "./types";

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

        let settlement: PoolSettlement;
        if (phase.kind === "FULL") {
            const result = await withScoringLease(db, poolId, Date.now(), (fence) =>
                runFullSettlement(db, poolId, pool.name, fence, { uid, entryIds, note, notifyMembers }));
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

        if (owed.adminAudit) {
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
        if (owed.email) {
            const { subject, html } = settlementEmail(String(pool.name || "Your pool"), settlement);
            for (const email of await resolveMemberEmails(db, poolRef)) {
                await sendEmail(db, email, subject, html, { poolId, reason: "pool_settled" });
                emailed++;
            }
            await poolRef.update({ "settlement.emailedAt": Date.now() });
        }

        return { success: true, settlement, emailed };
    },
);

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

/** Exported for the unit test: the email must say only what the record knows. */
export function settlementEmail(poolName: string, s: PoolSettlement): { subject: string; html: string } {
    const names = escapeHtml(joinNames(s.winnerNames));
    const subject = `${poolName} is over — the pot was split`;
    const week = s.throughWeek !== null ? ` after week ${s.throughWeek}` : "";
    const lines = [
        `<p><strong>${escapeHtml(poolName)}</strong> is over${week}. The remaining players agreed to split the pot: <strong>${names}</strong>.</p>`,
        s.prizePerEntry !== null
            ? `<p>Each of them is recorded as sharing 1st place, $${s.prizePerEntry} each.</p>`
            : `<p>Each of them is recorded as sharing 1st place.</p>`,
        s.rebuyDuesExcluded > 0
            ? `<p>$${s.rebuyDuesExcluded} of rebuy dues are not included in the recorded prize.</p>`
            : "",
        s.note ? `<p><strong>Note from the commissioner:</strong> ${escapeHtml(s.note)}</p>` : "",
        `<p>No more picks can be made in this pool. Money is settled between the commissioner and the players.</p>`,
    ];
    return { subject, html: renderEmailHtml("Pool Settled", lines.filter(Boolean).join("\n")) };
}
