/**
 * Writing squares winner records (PLAN-SQUARES-REOPEN B2, D12).
 *
 * The DECISION — which records the scores call for, and how they differ from
 * what is stored — is `planWinnerWrites` in `shared/squaresWinnerPlan.ts`, pure
 * and shared with the commissioner's page. This file is the thin part that
 * touches Firestore, and re-exports the planner so the server has one import.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { writeAuditEvent, type AuditOptions } from "../audit";
import { finalScoresOf as finalScores, planWinnerWrites as planWrites, type StoredWinner as Stored, type WinnerWrite } from "../shared/squaresWinnerPlan";
import { usesCurrentWinnerRules, type PayoutPool } from "../shared/squaresPayouts";
import { WINNERS_HELD_FIELD, squaresWinnersPausedHint, squaresWinnersPausedIn } from "./squaresPause";

export {
    PERIOD_WINNER_IDS,
    describeWinnerDrift,
    finalScoresOf,
    isEventWinnerId,
    parseEventWinnerId,
    planWinnerWrites,
    recordedEntry,
    type AuditSpec,
    type StoredWinner,
    type WinnerWrite,
} from "../shared/squaresWinnerPlan";

/** Write a plan. Makes NO reads, so it is safe after other writes in a transaction. */
export async function applyWinnerPlan(
    transaction: admin.firestore.Transaction,
    poolId: string,
    writes: ReadonlyArray<WinnerWrite>,
    actor: AuditOptions['actor'],
): Promise<void> {
    const winners = admin.firestore().collection('pools').doc(poolId).collection('winners');
    for (const w of writes) {
        if (w.kind === 'create') {
            transaction.set(winners.doc(w.id), w.doc);
        } else if (w.kind === 'delete') {
            transaction.delete(winners.doc(w.id));
        } else if (w.kind === 'update') {
            // `set(merge)` not `update`: an event document created earlier in this
            // same transaction does not exist yet as far as `update` is concerned.
            transaction.set(winners.doc(w.id), w.fields, { merge: true });
        }
        if (w.audit) await writeAuditEvent({ poolId, actor, ...w.audit }, transaction);
    }
}

/**
 * Record the winners the pause switch held back (see lib/squaresPause.ts).
 *
 * The score sync only revisits a game for a few hours after it ends. A pause
 * that outlasted that would have left the game's winners unrecorded for good —
 * "nothing is lost" would have been true only for short pauses (qodo, round 4).
 * So a pool whose winners were held is MARKED, and this finds the marked pools
 * once the switch is clear, whatever state their game is in by then.
 *
 * Each pool is its own transaction and reads the switch again inside it: a
 * pause set again part-way through leaves the rest marked and untouched.
 *
 * Returns how many pools were brought up to date.
 */
export async function reconcileHeldPools(
    db: FirebaseFirestore.Firestore = admin.firestore(),
    limit = 25,
): Promise<number> {
    if (await squaresWinnersPausedHint(db)) return 0;
    const held = await db.collection("pools").where(WINNERS_HELD_FIELD, "==", true).limit(limit).get();
    let reconciled = 0;
    for (const doc of held.docs) {
        try {
            const done = await db.runTransaction(async (t) => {
                const snap = await t.get(doc.ref);
                const pool = snap.data() as (PayoutPool & { type?: string; scores?: { gameStatus?: string; final?: unknown } }) | undefined;
                if (!pool || (pool as Record<string, unknown>)[WINNERS_HELD_FIELD] !== true) return false;
                if (await squaresWinnersPausedIn(t, db)) return false;

                const winnersSnap = await t.get(doc.ref.collection("winners"));
                // A pool that is not squares, or is on the old rules, has no
                // records for this to write. The mark is simply taken off.
                //
                // So is the mark on a pool whose scores are now typed BY HAND
                // (Manual Score Override). Those winners are recorded by the
                // commissioner's "Record winners" button and never on their
                // own — a half-typed score must not pay, or email, anybody.
                // The manage page shows them what is waiting to be recorded.
                const byHand = (pool as { manualScoreOverride?: unknown }).manualScoreOverride === true;
                if ((!pool.type || pool.type === "SQUARES") && usesCurrentWinnerRules(pool as { createdAt?: unknown }) && !byHand) {
                    const stored: Stored[] = winnersSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
                    const gameFinal = pool.scores?.gameStatus === "post" || !!pool.scores?.final;
                    const plan = planWrites(pool, finalScores(pool.scores), stored, { gameFinal });
                    await applyWinnerPlan(t, doc.id, plan, { uid: "system", role: "SYSTEM", label: "Winners held by the pause switch" });
                }
                t.update(doc.ref, { [WINNERS_HELD_FIELD]: FieldValue.delete() });
                return true;
            });
            if (done) reconciled++;
        } catch (e) {
            // One pool failing must not stop the others; it stays marked and is tried again.
            console.error(`[squaresWinners] catch-up failed for pool ${doc.id}`, e);
        }
    }
    return reconciled;
}
