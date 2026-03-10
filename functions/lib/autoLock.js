"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoLockPools = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const audit_1 = require("./audit");
const db = admin.firestore();
// --- HELPER: GENERATE DIGITS ---
function generateDigits() {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
}
// --- DEDICATED AUTO-LOCK SCHEDULER (Runs Every 1 Minute) ---
exports.autoLockPools = functions.scheduler.onSchedule("every 1 minutes", async (_event) => {
    var _a, _b, _c, _d, _e;
    const now = Date.now();
    console.log(`[AutoLock] Starting auto-lock check at ${new Date(now).toISOString()}`);
    try {
        // Query SQUARES pools (legacy path — reminders.lock.enabled)
        const squaresSnapshot = await db.collection("pools")
            .where("reminders.lock.enabled", "==", true)
            .where("isLocked", "==", false)
            .get();
        // Query BRACKET pools — these use a root-level lockAt field and status
        // They don't require reminders.lock.enabled; any pool with a lockAt should auto-lock.
        const bracketSnapshot = await db.collection("pools")
            .where("type", "==", "BRACKET")
            .where("status", "in", ["DRAFT", "OPEN"])
            .where("lockAt", "<=", now + 30000)
            .get();
        console.log(`[AutoLock] Found ${squaresSnapshot.size} SQUARES pools, ${bracketSnapshot.size} BRACKET pools ready to lock`);
        // Process SQUARES pools
        for (const doc of squaresSnapshot.docs) {
            try {
                const pool = Object.assign({ id: doc.id }, doc.data());
                if (!((_b = (_a = pool.reminders) === null || _a === void 0 ? void 0 : _a.lock) === null || _b === void 0 ? void 0 : _b.lockAt))
                    continue;
                // Robust handling of lockAt (could be number or Timestamp)
                const lockAtNum = typeof pool.reminders.lock.lockAt === 'number'
                    ? pool.reminders.lock.lockAt
                    : ((_d = (_c = pool.reminders.lock.lockAt) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) || new Date(pool.reminders.lock.lockAt).getTime();
                if (isNaN(lockAtNum)) {
                    console.warn(`[AutoLock] Invalid lockAt for pool ${pool.id}:`, pool.reminders.lock.lockAt);
                    continue;
                }
                const msUntilLock = lockAtNum - now;
                if (msUntilLock <= 30000) {
                    console.log(`[AutoLock] Locking SQUARES pool ${pool.id} (lockAt: ${new Date(lockAtNum).toISOString()})`);
                    await executeAutoLock(pool);
                }
            }
            catch (poolError) {
                console.error(`[AutoLock] Error processing SQUARES pool ${doc.id}:`, poolError);
            }
        }
        // Process BRACKET pools
        for (const doc of bracketSnapshot.docs) {
            try {
                const pool = Object.assign({ id: doc.id }, doc.data());
                // Read root-level lockAt (stored as ms timestamp)
                const rawLockAt = pool.lockAt;
                if (!rawLockAt)
                    continue;
                const lockAtNum = typeof rawLockAt === 'number'
                    ? rawLockAt
                    : ((_e = rawLockAt === null || rawLockAt === void 0 ? void 0 : rawLockAt.toMillis) === null || _e === void 0 ? void 0 : _e.call(rawLockAt)) || new Date(rawLockAt).getTime();
                if (isNaN(lockAtNum)) {
                    console.warn(`[AutoLock] Invalid lockAt for BRACKET pool ${pool.id}:`, rawLockAt);
                    continue;
                }
                const msUntilLock = lockAtNum - now;
                if (msUntilLock <= 30000) {
                    console.log(`[AutoLock] Locking BRACKET pool ${pool.id} (lockAt: ${new Date(lockAtNum).toISOString()})`);
                    await executeAutoLock(pool);
                }
            }
            catch (poolError) {
                console.error(`[AutoLock] Error processing BRACKET pool ${doc.id}:`, poolError);
            }
        }
        console.log(`[AutoLock] Completed auto-lock check`);
    }
    catch (error) {
        console.error(`[AutoLock] Critical error:`, error);
    }
});
// --- EXECUTE AUTO LOCK ---
async function executeAutoLock(pool) {
    const poolRef = db.collection('pools').doc(pool.id);
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists)
                return; // Deleted?
            const currentPool = doc.data();
            if (currentPool.isLocked) {
                console.log(`[AutoLock] Skipped - already locked: ${pool.id}`);
                return;
            }
            const updates = {
                isLocked: true,
                updatedAt: admin.firestore.Timestamp.now(),
            };
            const type = currentPool.type || 'SQUARES';
            // Specific logic per pool type
            if (type === 'SQUARES') {
                updates.lockGrid = true; // Legacy/UI sync
                // Generate Digits
                const axisNumbers = {
                    home: generateDigits(),
                    away: generateDigits(),
                };
                updates.axisNumbers = axisNumbers;
                // Handle 4-Set initialization
                if (currentPool.numberSets === 4) {
                    updates.quarterlyNumbers = {
                        q1: axisNumbers
                    };
                }
                // Log Digits Generation
                const digitsHash = (0, audit_1.computeDigitsHash)({ home: axisNumbers.home, away: axisNumbers.away, poolId: pool.id, period: 'q1' });
                await (0, audit_1.writeAuditEvent)({
                    poolId: pool.id,
                    type: 'DIGITS_GENERATED',
                    message: 'Auto-Generated Axis Numbers upon Auto-Lock',
                    severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' },
                    payload: { period: 'initial', commitHash: digitsHash, numberSets: currentPool.numberSets }
                    // NO dedupeKey - prevent read-after-write error
                }, t);
            }
            else if (type === 'BRACKET') {
                updates.status = 'LOCKED';
                updates.lockAt = admin.firestore.Timestamp.now(); // Ensure sync
            }
            // PROPS and NFL_PLAYOFFS just use isLocked: true
            t.update(poolRef, updates);
            // Generic Audit Log
            await (0, audit_1.writeAuditEvent)({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
                // NO dedupeKey - auto-lock should only happen once anyway
            }, t);
        });
        console.log(`[AutoLock] SUCCESSFULLY LOCKED: ${pool.id}`);
    }
    catch (e) {
        console.error(`[AutoLock] Failed to lock pool ${pool.id}:`, e);
    }
}
//# sourceMappingURL=autoLock.js.map