import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

import { assertPoolOwnerOrSuperAdmin } from "./poolOps";


export const lockPool = onCall(async (request) => {
    // 0. Ensure Admin Init (Lazy)
    const db = admin.firestore();

    // 1. Auth Check - Must be logged in
    if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "User must be logged in to lock a pool."
        );
    }

    const { poolId, forceAxis } = request.data;
    if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool ID is required.");
    }

    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();

    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const poolData = poolSnap.data() as any;


    // 2. Permission Check - Owner or Super Admin
    assertPoolOwnerOrSuperAdmin(poolData, request.auth.uid, request.auth.token.role);

    // 3. Generate Digits (Random or Fixed for Testing) - ONLY FOR SQUARES
    let axisNumbers;
    const type = poolData.type || 'SQUARES';

    let updates: any = {
        isLocked: true,
        updatedAt: admin.firestore.Timestamp.now(),
    };

    if (type === 'SQUARES') {
        updates.lockGrid = true; // Legacy support

        if (forceAxis === true) {
            // Deterministic mode for testing - use fixed 0-9 sequence
            console.log(`[lockPool] Using FIXED axis numbers for pool ${poolId} (testing mode)`);
            axisNumbers = {
                home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            };
        } else {
            // Production mode - random shuffle
            const generateDigits = () => {
                const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
                // Fisher-Yates Shuffle
                for (let i = nums.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [nums[i], nums[j]] = [nums[j], nums[i]];
                }
                return nums;
            };
            axisNumbers = {
                home: generateDigits(),
                away: generateDigits(),
            };
        }

        updates.axisNumbers = axisNumbers;

        // Initialize 4-Sets if applicable
        if (poolData.numberSets === 4) {
            updates.quarterlyNumbers = {
                q1: axisNumbers
            };
        }
    } else if (type === 'BRACKET') {
        updates.status = 'LOCKED';
    }
    // PROPS and PLAYOFFS just use isLocked: true

    await poolRef.update(updates);

    // --- AUDIT LOGGING ---
    const { writeAuditEvent, computeDigitsHash } = await import("./audit");

    // 1. Log Lock
    await writeAuditEvent({
        poolId,
        type: 'POOL_LOCKED',
        message: 'Pool locked by owner',
        severity: 'INFO',
        actor: { uid: request.auth.uid, role: 'ADMIN', label: request.auth.token.name || 'Owner' }
    });

    // 2. Log Digits Generation (Initial) - Only for Squares
    if (type === 'SQUARES' && axisNumbers) {
        const digitsHash = computeDigitsHash({ home: axisNumbers.home, away: axisNumbers.away, poolId, period: 'q1' });
        await writeAuditEvent({
            poolId,
            type: 'DIGITS_GENERATED',
            message: 'Initial Axis Numbers Generated',
            severity: 'INFO',
            actor: { uid: 'system', role: 'SYSTEM', label: 'Cloud RNG' },
            payload: { period: 'initial', commitHash: digitsHash, numberSets: poolData.numberSets },
            // Use hash as dedupe key to ensure we log this specific generation once (though lockPool is transactional usually)
            dedupeKey: `DIGITS_GENERATED:${poolId}:initial:${digitsHash}`
        });
    }

    return { success: true, axisNumbers };
});
