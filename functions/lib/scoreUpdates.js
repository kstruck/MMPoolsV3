"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncGameStatus = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
// Helper to generate random digits
const generateDigits = () => {
    const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
};
// Helper to generate AxisNumbers
const generateAxisNumbers = () => ({
    home: generateDigits(),
    away: generateDigits(),
});
exports.syncGameStatus = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    const db = admin.firestore();
    // 1. Fetch Active Pools
    const poolsSnap = await db.collection("pools")
        .where("isLocked", "==", true)
        .where("scores.gameStatus", "!=", "post")
        .get();
    if (poolsSnap.empty)
        return;
    // 2. Group by Game ID to batch ESPN calls
    const gameIds = new Set();
    poolsSnap.docs.forEach(doc => {
        const p = doc.data();
        if (p.gameId)
            gameIds.add(p.gameId);
    });
    // 3. Fetch Data for each Game
    const gameDataMap = {};
    for (const gid of Array.from(gameIds)) {
        try {
            const resp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gid}`);
            if (resp.ok) {
                gameDataMap[gid] = await resp.json();
            }
        }
        catch (e) {
            console.error(`Failed to fetch game ${gid}`, e);
        }
    }
    // 4. Process Each Pool
    for (const doc of poolsSnap.docs) {
        const pool = doc.data();
        const gameData = gameDataMap[pool.gameId || ""];
        if (!gameData || !gameData.header || !gameData.header.competitions)
            continue;
        const competition = gameData.header.competitions[0];
        const status = competition.status;
        const period = status.period; // 1, 2, 3, 4...
        const state = status.type.state; // 'pre', 'in', 'post'
        // Determine if quarters are final
        const isQ1Final = (period >= 2) || (state === "post");
        const isHalfFinal = (period >= 3) || (state === "post");
        const isQ3Final = (period >= 4) || (state === "post");
        // --- TRANSACTION WRAPPER for Safety ---
        await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(doc.ref);
            if (!freshDoc.exists)
                return;
            const freshPool = freshDoc.data();
            // Re-read 4-Sets Logic with fresh data
            let transactionUpdates = {};
            if (freshPool.numberSets === 4) {
                let qNums = freshPool.quarterlyNumbers || {};
                let updated = false;
                if (isQ1Final && !qNums.q2) {
                    qNums.q2 = generateAxisNumbers();
                    updated = true;
                }
                if (isHalfFinal && !qNums.q3) {
                    qNums.q3 = generateAxisNumbers();
                    updated = true;
                }
                if (isQ3Final && !qNums.q4) {
                    qNums.q4 = generateAxisNumbers();
                    updated = true;
                }
                if (updated) {
                    transactionUpdates.quarterlyNumbers = qNums;
                    // Sync current axis
                    if (qNums.q4 && (period >= 4))
                        transactionUpdates.axisNumbers = qNums.q4;
                    else if (qNums.q3 && (period >= 3))
                        transactionUpdates.axisNumbers = qNums.q3;
                    else if (qNums.q2 && (period >= 2))
                        transactionUpdates.axisNumbers = qNums.q2;
                    else if (qNums.q1)
                        transactionUpdates.axisNumbers = qNums.q1;
                }
            }
            // Apply updates if any
            if (Object.keys(transactionUpdates).length > 0) {
                transaction.update(doc.ref, Object.assign(Object.assign({}, transactionUpdates), { updatedAt: admin.firestore.Timestamp.now() }));
            }
        });
    }
});
//# sourceMappingURL=scoreUpdates.js.map