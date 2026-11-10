/**
 * Writing squares winner records (PLAN-SQUARES-REOPEN B2, D12).
 *
 * The DECISION — which records the scores call for, and how they differ from
 * what is stored — is `planWinnerWrites` in `shared/squaresWinnerPlan.ts`, pure
 * and shared with the commissioner's page. This file is the thin part that
 * touches Firestore, and re-exports the planner so the server has one import.
 */
import * as admin from "firebase-admin";
import { writeAuditEvent, type AuditOptions } from "../audit";
import type { WinnerWrite } from "../shared/squaresWinnerPlan";

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
