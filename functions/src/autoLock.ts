
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { GameState } from "./types";
import { writeAuditEvent, computeDigitsHash } from "./audit";

const db = admin.firestore();

// --- HELPER: GENERATE DIGITS ---
function generateDigits(): number[] {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
}

// --- DEDICATED AUTO-LOCK SCHEDULER (Runs Every 1 Minute) ---
export const autoLockPools = functions.scheduler.onSchedule("every 1 minutes", async (event) => {
    const now = Date.now();
    console.log(`[AutoLock] Starting auto-lock check at ${new Date(now).toISOString()}`);

    try {
        // Query only pools that:
        // 1. Have auto-lock enabled
        // 2. Are not yet locked
        // 3. Have a lockAt time
        const poolsSnapshot = await db.collection("pools")
            .where("reminders.lock.enabled", "==", true)
            .where("isLocked", "==", false)
            .get();

        console.log(`[AutoLock] Found ${poolsSnapshot.size} unlocked pools with auto-lock enabled`);

        for (const doc of poolsSnapshot.docs) {
            try {
                const pool = { id: doc.id, ...doc.data() } as GameState;

                if (!pool.reminders?.lock?.lockAt) continue;

                // Robust handling of lockAt (could be number or Timestamp)
                const lockAtNum = typeof pool.reminders.lock.lockAt === 'number'
                    ? pool.reminders.lock.lockAt
                    : (pool.reminders.lock.lockAt as any)?.toMillis?.() || new Date(pool.reminders.lock.lockAt as any).getTime();

                if (isNaN(lockAtNum)) {
                    console.warn(`[AutoLock] Invalid lockAt for pool ${pool.id}:`, pool.reminders.lock.lockAt);
                    continue;
                }

                // Check if it's time to lock (with 30 second buffer to handle any delays)
                const msUntilLock = lockAtNum - now;
                if (msUntilLock <= 30000) { // Lock if within 30 seconds or past
                    console.log(`[AutoLock] Locking pool ${pool.id} (lockAt: ${new Date(lockAtNum).toISOString()}, now: ${new Date(now).toISOString()})`);
                    await executeAutoLock(pool);
                }
            } catch (poolError: any) {
                console.error(`[AutoLock] Error processing pool ${doc.id}:`, poolError);
            }
        }

        console.log(`[AutoLock] Completed auto-lock check`);
    } catch (error) {
        console.error(`[AutoLock] Critical error:`, error);
    }
});

// --- EXECUTE AUTO LOCK ---
async function executeAutoLock(pool: GameState) {
    const poolRef = db.collection('pools').doc(pool.id);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists) return; // Deleted?
            const currentPool = doc.data() as GameState;

            if (currentPool.isLocked) {
                console.log(`[AutoLock] Skipped - already locked: ${pool.id}`);
                return;
            }

            // Generate Digits
            const axisNumbers = {
                home: generateDigits(),
                away: generateDigits(),
            };

            let updates: any = {
                isLocked: true,
                lockGrid: true, // Legacy/UI sync
                axisNumbers,
                updatedAt: admin.firestore.Timestamp.now(),
            };

            // Handle 4-Set initialization
            if (currentPool.numberSets === 4) {
                updates.quarterlyNumbers = {
                    q1: axisNumbers
                };
            }

            t.update(poolRef, updates);

            // CRITICAL FIX: Skip dedupe to avoid read-after-write transaction errors
            // Audit Logs
            await writeAuditEvent({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
                // NO dedupeKey - auto-lock should only happen once anyway
            }, t);

            const digitsHash = computeDigitsHash({ home: axisNumbers.home, away: axisNumbers.away, poolId: pool.id, period: 'q1' });
            await writeAuditEvent({
                poolId: pool.id,
                type: 'DIGITS_GENERATED',
                message: 'Auto-Generated Axis Numbers upon Auto-Lock',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' },
                payload: { period: 'initial', commitHash: digitsHash, numberSets: currentPool.numberSets }
                // NO dedupeKey - prevent read-after-write error
            }, t);
        });

        console.log(`[AutoLock] SUCCESSFULLY LOCKED: ${pool.id}`);
    } catch (e) {
        console.error(`[AutoLock] Failed to lock pool ${pool.id}:`, e);
    }
}
