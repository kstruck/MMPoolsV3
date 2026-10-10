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
    type SettleablePool,
    aliveSetMismatch,
    settlementMoney,
    rebuyDuesOf,
    throughWeekOf,
    followUpClaimable,
    settlementMailKey,
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
/** A Firestore document as read: shape unknown until a field is narrowed. */
type Doc = Record<string, unknown>;
/** An entry document with its id; only the fields this file reads are named. */
type EntryRow = Doc & { id: string; status?: unknown; entryName?: unknown; userName?: unknown };

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
        const pool: Doc = { id: snap.id, ...snap.data() };

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
                runFullSettlement(db, poolId, pool.name, fence, {
                    uid, entryIds: entryIds ?? [], note, notifyMembers,
                    expectedPot: input.expectedPot, expectedPrizePerEntry: input.expectedPrizePerEntry,
                }));
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
        let auditBusy = false;
        const auditClaimed = owed.adminAudit ? await claimFollowUp(db, poolRef, "adminAudit") : false;
        if (owed.adminAudit && !auditClaimed) auditBusy = true;
        if (auditClaimed) {
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
            // qodo #3 on #715: ONE record per settlement. A retry after a lost
            // `adminAuditedAt` stamp finds this id and is a no-op success.
            }, { id: `pool-settled-${poolId}-${settlement.settledAt}` });
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
        // qodo #4 on #715: say when another attempt holds a step, so the panel
        // does not report "Done." for work this call did not do.
        let followUpInProgress = false;
        const emailClaimed = owed.email ? await claimFollowUp(db, poolRef, "email") : false;
        if (auditBusy || (owed.email && !emailClaimed)) followUpInProgress = true;
        if (emailClaimed) {
            const { subject, html } = settlementEmail(String(pool.name || "Your pool"), settlement);
            // The roster as it stands AFTER the flip (codex code-review r2 P2): a
            // member who joined between the first read and the lease is on it.
            const fresh = (await poolRef.get()).data() ?? {};
            const done = new Set<string>(Array.isArray(fresh.settlement?.notifiedUids) ? fresh.settlement.notifiedUids : []);
            for (const { uid: memberUid, email } of await settlementRecipients(db, poolRef, fresh.participantIds)) {
                if (done.has(memberUid)) continue;
                const outcome = email
                    // One mail doc per (settlement, member): a crash between this enqueue
                    // and the notifiedUids stamp below cannot send a second copy.
                    ? await sendEmail(db, email, subject, html, {
                        poolId, reason: "pool_settled",
                        idempotencyKey: settlementMailKey(poolId, settlement.settledAt, memberUid),
                    })
                    : "skipped";
                if (outcome === "failed") { emailFailed++; continue; }
                if (outcome === "queued") emailed++;
                // Recorded per recipient, as it happens (qodo #4 on #715): a crash
                // mid-loop re-sends at most the one email in flight, not the batch.
                await poolRef.update({ "settlement.notifiedUids": FieldValue.arrayUnion(memberUid) });
            }
            await poolRef.update({
                ...(emailFailed === 0
                    ? { "settlement.emailedAt": Date.now() }
                    : { "settlement.emailClaimedAt": FieldValue.delete() }),
            });
        }

        return { success: true, settlement, emailed, emailFailed, adminAuditFailed, followUpInProgress };
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
/** The money a settlement of this pool would record — one definition for the preview and the check. */
function quoteFor(pool: Doc, entries: EntryRow[], aliveIds: string[]): { pot: number | null; prizePerEntry: number | null; entryCount: number | null } {
    const ranked = computeFinalRanks("NFL_SURVIVOR", entries);
    const pub = seasonPlacesPublication(pool, ranked, entries.length);
    const money = settlementMoney({ seasonPlaces: pub.seasonPlaces, seasonPrize: pub.seasonPrize }, aliveIds);
    return { ...money, entryCount: pub.seasonPrize ? pub.seasonPrize.entryCount : null };
}

async function buildPreview(
    db: admin.firestore.Firestore,
    poolRef: admin.firestore.DocumentReference,
    pool: Doc,
): Promise<SettlementPreview> {
    const entriesSnap = await poolRef.collection("entries").get();
    const entries: EntryRow[] = entriesSnap.docs.map(d => ({ ...d.data(), id: d.id }));
    const alive = entries.filter(e => e.status !== "ELIMINATED").sort((a, b) => a.id.localeCompare(b.id));
    const membersSnap = await poolRef.collection("members").get();
    const quote = quoteFor(pool, entries, alive.map(e => e.id));
    return {
        alive: alive.map(e => ({ id: e.id, name: String(e.entryName || e.userName || "Player") })),
        pot: quote.pot,
        prizePerEntry: quote.prizePerEntry,
        entryCount: quote.entryCount,
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
    args: { uid: string; entryIds: string[]; note: string | null; notifyMembers: boolean; expectedPot: number | null | undefined; expectedPrizePerEntry: number | null | undefined },
): Promise<PoolSettlement> {
    const poolRef = db.collection("pools").doc(poolId);

    // Step 5 — re-judge the phase on the pool as read under the lease. Nothing is
    // written until the winners are validated below (codex code-review r5: a
    // refused attempt must leave no state behind).
    const underLease = (await poolRef.get()).data() ?? {};
    const phaseNow = settlementPhase(underLease as SettleablePool);
    if (phaseNow.kind !== "FULL") throw refusal(phaseNow.kind === "REFUSE" ? phaseNow.code : "ALREADY_SETTLED");

    // Step 6 — the ALIVE set, read AFTER the lease is held. Picks and rebuys are
    // lease-checked, so it cannot move until the lease is released. "Alive" is
    // the finalizer's own definition (`status !== 'ELIMINATED'`), so the set
    // checked here is exactly the set it will rank 1st.
    const entriesSnap = await poolRef.collection("entries").get();
    const entries: EntryRow[] = entriesSnap.docs.map(d => ({ ...d.data(), id: d.id }));
    const alive = entries.filter(e => e.status !== "ELIMINATED");
    const mismatch = aliveSetMismatch(args.entryIds, alive.map(e => e.id));
    if (mismatch === "NO_SURVIVORS") {
        throw new HttpsError("failed-precondition", "NO_SURVIVORS: Nobody is still alive in this pool, so there is no pot to split.");
    }
    if (mismatch) {
        throw new HttpsError("failed-precondition", "WINNERS_MUST_BE_ALIVE_SET: The players still alive have changed since this page loaded. Reload and try again.");
    }

    // Step 6b — the money must be what the owner confirmed (codex code-review
    // r11). Same functions the preview used, on the pool as read under the lease.
    const quote = quoteFor(underLease, entries, alive.map(e => e.id));
    if (quote.pot !== (args.expectedPot ?? null) || quote.prizePerEntry !== (args.expectedPrizePerEntry ?? null)) {
        throw new HttpsError("failed-precondition", "QUOTE_CHANGED: The pot has changed since this page loaded (someone joined or left). Reload, check the new amount, and try again.");
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
