import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from '../utils/logger';

/** Read side of the append-only money ledger (pools/{poolId}/payments). */

export interface PaymentLedgerEvent {
    id: string;
    type: 'MARKED_PAID' | 'MARKED_UNPAID' | 'REBUY_DUE' | 'PAYOUT_PAID' | 'PAYOUT_UNPAID';
    uid: string;
    entryId?: string;
    entryName?: string;
    amount?: number;
    note?: string;
    actorUid: string;
    at: number;
}

export function subscribeToPaymentLedger(
    poolId: string,
    callback: (events: PaymentLedgerEvent[]) => void,
): () => void {
    const q = query(collection(db, 'pools', poolId, 'payments'), orderBy('at', 'desc'), limit(50));
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as PaymentLedgerEvent)));
    }, err => {
        logger.error('subscribeToPaymentLedger failed', poolId, err);
        callback([]);
    });
}
