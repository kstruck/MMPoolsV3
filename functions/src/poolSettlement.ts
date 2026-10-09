import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
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
 * Crash recovery: the finalizer stamps `finalizedVia: 'SETTLED'` with
 * `finalizedAt`, which lets a FULL settlement re-run after the finalizer
 * committed (and only then — a natural season end is refused); the FOLLOW_UP phase completes the Super-Admin audit and
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
        let adminAuditFailed = false;
        if (owed.adminAudit && await claimFollowUp(db, poolRef, "adminAudit")) {
            // `writeAdminAudit` returns false rather than throwing when it cannot
            // persist (codex code-review r3): stamp only on success, otherwise
            // release the claim so the follow-up stays owed and retryable.
            const audited = await writeAdminAudit({
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
            adminAuditFailed = !audited;
            await poolRef.update(audited
                ? { "settlement.adminAuditedAt": Date.now() }
                : { "settlement.adminAuditClaimedAt": FieldValue.delete() });
        }

        // 🛑 Delivery is tracked PER MEMBER, by uid (codex code-review r2 P1).
        // `sendEmail` does not throw on a failed enqueue — it returns 'failed' —
        // so stamping `emailedAt` unconditionally would mark a transient failure
        // as delivered for ever. `notifiedUids` records who is done (queued, or
        // skipped for a reason a retry cannot fix: no address, opted out);
        // `emailedAt` is stamped only when nobody failed. On a failure the claim
        // is released so a retry reaches ONLY the members who were missed.
        // Uids, never addresses: the pool document is readable by its members.
        let emailed = 0;
        let emailFailed = 0;
        if (owed.email && await claimFollowUp(db, poolRef, "email")) {
            const { subject, html } = settlementEmail(String(pool.name || "Your pool"), settlement);
            // The roster as it stands AFTER the flip (codex code-review r2 P2): a
            // member who joined between the first read and the lease is on it.
            const fresh = (await poolRef.get()).data() ?? {};
            const done = new Set<string>(Array.isArray(fresh.settlement?.notifiedUids) ? fresh.settlement.notifiedUids : []);
            const newlyDone: string[] = [];
            for (const { uid: memberUid, email } of await settlementRecipients(db, poolRef, fresh.participantIds)) {
                if (done.has(memberUid)) continue;
                const outcome = email
                    ? await sendEmail(db, email, subject, html, { poolId, reason: "pool_settled" })
                    : "skipped";
                if (outcome === "failed") { emailFailed++; continue; }
                if (outcome === "queued") emailed++;
                newlyDone.push(memberUid);
            }
            await poolRef.update({
                ...(newlyDone.length > 0 ? { "settlement.notifiedUids": FieldValue.arrayUnion(...newlyDone) } : {}),
                ...(emailFailed === 0
                    ? { "settlement.emailedAt": Date.now() }
                    : { "settlement.emailClaimedAt": FieldValue.delete() }),
            });
        }

        return { success: true, settlement, emailed, emailFailed, adminAuditFailed };
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
 * Everyone on the roster, not only entry owners (`resolveMemberEmails`, shared
 * with cancelPool, reads entry owners alone and misses roster members who never
 * made a pick — the help text promises EVERY member hears the pool is over).
 * Union of `participantIds` and the entry owners, one row per uid, and one row
 * per address: a second uid sharing an address is marked done without a send.
 */
async function settlementRecipients(
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference,
    participantIds: unknown,
): Promise<Array<{ uid: string; email: string | null }>> {
    const uids = new Set<string>(
        Array.isArray(participantIds) ? participantIds.filter((u): u is string => typeof u === "string" && u.length > 0) : [],
    );
    for (const d of (await poolRef.collection("entries").get()).docs) {
        const owner = (d.data().ownerUid as string | undefined) || d.id;
        if (owner) uids.add(owner);
    }
    const seen = new Set<string>();
    const out: Array<{ uid: string; email: string | null }> = [];
    for (const uid of uids) {
        const snap = await db.collection("users").doc(uid).get();
        const email = snap.exists ? ((snap.data() as User).email || null) : null;
        out.push({ uid, email: email && !seen.has(email) ? email : null });
        if (email) seen.add(email);
    }
    return out;
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

    // Step 5 — re-judge the phase on the pool as read under the lease. Nothing is
    // written until the winners are validated below (codex code-review r5: a
    // refused attempt must leave no state behind).
    const underLease = (await poolRef.get()).data() ?? {};
    const phaseNow = settlementPhase(underLease as any);
    if (phaseNow.kind !== "FULL") throw refusal(phaseNow.kind === "REFUSE" ? phaseNow.code : "ALREADY_SETTLED");

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
