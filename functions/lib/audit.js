"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDigitsHash = exports.writeAuditEvent = void 0;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const writeAuditEvent = async (options, existingTransaction) => {
    const db = admin.firestore();
    const { poolId, type, message, severity, actor, payload, dedupeKey, forceWriteDedupe } = options;
    const auditRef = db.collection("pools").doc(poolId).collection("audit");
    const eventId = auditRef.doc().id;
    // Logic to run operations with either existing transaction or a new one
    const runOps = async (t) => {
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
        const event = Object.assign(Object.assign({ id: eventId, poolId, timestamp: Date.now(), type,
            message,
            severity,
            actor }, (payload !== undefined && { payload })), (dedupeKey !== undefined && { dedupeKey }));
        t.set(auditRef.doc(eventId), Object.assign(Object.assign({}, event), { createdAt: admin.firestore.Timestamp.now() }));
        return "WRITTEN";
    };
    if (existingTransaction) {
        return await runOps(existingTransaction);
    }
    else {
        try {
            return await db.runTransaction(async (t) => {
                return await runOps(t);
            });
        }
        catch (e) {
            console.error("[Audit] Transaction failed:", e);
            throw e;
        }
    }
};
exports.writeAuditEvent = writeAuditEvent;
// Helper to compute Commit Hash
const computeDigitsHash = (data) => {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
};
exports.computeDigitsHash = computeDigitsHash;
//# sourceMappingURL=audit.js.map