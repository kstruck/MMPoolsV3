import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Append-only money ledger: pools/{poolId}/payments/{autoId}.
 *
 * Every payment-state change (mark paid/unpaid, rebuy owed, payout marked)
 * writes one immutable event with actor + timestamp. Members read their own
 * pool's ledger (Firestore rules: participant read, client write denied), so
 * "I paid you at the bar" disputes have a shared record instead of memory.
 */

export type LedgerEventType =
    | 'MARKED_PAID'      // commissioner confirmed dues received
    | 'MARKED_UNPAID'    // commissioner reversed a paid mark
    | 'REBUY_DUE'        // survivor rebuy purchased — amount owed to commissioner
    | 'PAYOUT_PAID'      // commissioner marked a prize as paid out
    | 'PAYOUT_UNPAID'    // commissioner reversed a payout mark
    | 'ENTRY_DELETED';   // commissioner removed an unpaid, unscored entry (DUES D12)

export interface LedgerEvent {
    type: LedgerEventType;
    uid: string;          // the member the money event concerns
    entryId?: string;
    entryName?: string;
    amount?: number;      // dollars; omit when unknown
    note?: string;
    actorUid: string;     // who performed the action
    actorName?: string;
}

export async function writeLedgerEvent(
    db: admin.firestore.Firestore,
    poolId: string,
    event: LedgerEvent,
): Promise<void> {
    try {
        await db.collection('pools').doc(poolId).collection('payments').add({
            ...event,
            at: Date.now(),
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
        // Ledger is an audit trail, not a gate — never block the money action itself
        console.error(`Failed to write ledger event for pool ${poolId}:`, err);
    }
}
