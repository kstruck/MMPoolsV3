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
exports.backfillPools = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
exports.backfillPools = (0, https_1.onCall)(async (request) => {
    if (!request.auth || request.auth.token.role !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Only Super Admin can run migration.');
    }
    const db = admin.firestore();
    const poolsRef = db.collection('pools');
    const usersRef = db.collection('users');
    const poolsSnap = await poolsRef.get();
    let updatedCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    for (const poolDoc of poolsSnap.docs) {
        const pool = poolDoc.data();
        const ownerId = pool.ownerId;
        const poolId = poolDoc.id;
        if (!ownerId)
            continue;
        // 1. Set createdByUid if missing
        if (!pool.createdByUid) {
            batch.update(poolDoc.ref, {
                createdByUid: ownerId,
                status: pool.isLocked ? 'LOCKED' : (pool.isFinal ? 'FINAL' : 'DRAFT')
            });
            batchCount++;
        }
        // 2. Create Managed Pool Index
        const indexRef = usersRef.doc(ownerId).collection('managedPools').doc(poolId);
        batch.set(indexRef, {
            poolId,
            createdAt: pool.createdAt || admin.firestore.Timestamp.now(),
            name: pool.name,
            type: pool.type
        }, { merge: true });
        batchCount++;
        // 3. Historical Data Migration (For COMPLETED pools)
        if (pool.status === 'COMPLETED' || pool.status === 'ARCHIVED') {
            const entriesSnap = await poolDoc.ref.collection('entries').get();
            for (const entryDoc of entriesSnap.docs) {
                const entry = entryDoc.data();
                if (!entry.ownerUid)
                    continue;
                const userRef = usersRef.doc(entry.ownerUid);
                // Aggregate basic stats
                const isWinner = entry.rank === 1;
                const pointsEarned = entry.totalScore || entry.seasonTotal || entry.totalPoints || 0;
                const payoutEarned = entry.payoutAmount || 0;
                // Update user's historical stats safely using FieldValue increments
                batch.set(userRef, {
                    historicalStats: {
                        poolsEntered: admin.firestore.FieldValue.increment(1),
                        poolsWon: admin.firestore.FieldValue.increment(isWinner ? 1 : 0),
                        totalPoints: admin.firestore.FieldValue.increment(pointsEarned),
                        totalEarnings: admin.firestore.FieldValue.increment(payoutEarned)
                    }
                }, { merge: true });
                batchCount++;
                if (batchCount >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }
        updatedCount++;
        if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) {
        await batch.commit();
    }
    return { success: true, updatedCount };
});
//# sourceMappingURL=backfill.js.map