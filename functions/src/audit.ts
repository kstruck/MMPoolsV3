import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { AuditLogEvent, AuditEventType } from "./types";

export interface AuditOptions {
    poolId: string;
    type: AuditEventType;
    message: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    actor: {
        uid: string;
        role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN' | 'GUEST';
        label?: string;
    };
    payload?: any;
    dedupeKey?: string;
    forceWriteDedupe?: boolean;
}

export const writeAuditEvent = async (options: AuditOptions, existingTransaction?: admin.firestore.Transaction) => {
    const db = admin.firestore();
    const { poolId, type, message, severity, actor, payload, dedupeKey, forceWriteDedupe } = options;

    const auditRef = db.collection("pools").doc(poolId).collection("audit");
    const eventId = auditRef.doc().id;

    // Logic to run operations with either existing transaction or a new one
    const runOps = async (t: admin.firestore.Transaction) => {
        // 1. Deduplication Check
        if (dedupeKey) {
            const dedupeRef = db.collection("pools").doc(poolId).collection("audit_dedupe").doc(dedupeKey);

            if (!forceWriteDedupe) {
                const doc = await t.get(dedupeRef);
                if (doc.exists) {
                    // Return false/special value to indicate dedupe happened
                    console.log(`[Audit] Dedupe hit for ${dedupeKey}`);
                    return "SKIPPED";
                }
            }
            t.set(dedupeRef, { timestamp: admin.firestore.Timestamp.now(), originalEventId: eventId });
        }

        const event: AuditLogEvent = {
            id: eventId,
            poolId,
            timestamp: Date.now(),
            type,
            message,
            severity,
            actor,
            ...(payload !== undefined && { payload }),
            ...(dedupeKey !== undefined && { dedupeKey })
        };

        t.set(auditRef.doc(eventId), {
            ...event,
            createdAt: admin.firestore.Timestamp.now()
        });
        return "WRITTEN";
    };

    if (existingTransaction) {
        return await runOps(existingTransaction);
    } else {
        try {
            return await db.runTransaction(async (t) => {
                return await runOps(t);
            });
        } catch (e: any) {
            console.error("[Audit] Transaction failed:", e);
            throw e;
        }
    }
};

// Helper to compute Commit Hash
export const computeDigitsHash = (data: any): string => {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
};
