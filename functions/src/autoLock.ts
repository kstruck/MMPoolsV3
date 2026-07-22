
import * as functions from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { GameState } from "./types";
import { writeAuditEvent, computeDigitsHash } from "./audit";
import { withHeartbeat } from "./lib/heartbeat";
import { autoLockVerdict } from "./lib/heartbeatVerdicts";

const db = admin.firestore();

// --- HELPER: GENERATE DIGITS ---
// Fisher-Yates shuffle — produces a uniform permutation of 0-9. A
// `.sort(() => Math.random() - 0.5)` shuffle is biased, which is unacceptable
// for axis numbers that determine real-money payouts.
function generateDigits(): number[] {
    const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
}

// Normalize a lockAt value (number | Firestore Timestamp | date string) to ms.
function toMillis(raw: any): number {
    if (typeof raw === 'number') return raw;
    return raw?.toMillis?.() ?? new Date(raw).getTime();
}

// Lock pools with bounded concurrency so the ~1PM Sunday lock wave (hundreds of
// pools due in the same run) finishes inside the scheduler budget instead of
// serializing — otherwise stragglers lock AFTER kickoff, which is unacceptable
// for a real-money grid. Each executeAutoLock is an independent per-pool
// transaction, so running them in parallel is safe.
/** Returns how many pools FAILED to lock — see the heartbeat verdict below. */
async function lockAllWithConcurrency(pools: GameState[], limit = 15): Promise<number> {
    let failed = 0;
    for (let i = 0; i < pools.length; i += limit) {
        const results = await Promise.all(pools.slice(i, i + limit).map(p => executeAutoLock(p)));
        failed += results.filter((ok) => !ok).length;
    }
    return failed;
}

// --- DEDICATED AUTO-LOCK SCHEDULER (Runs Every 1 Minute) ---
export const autoLockPools = functions.scheduler.onSchedule(
    { schedule: "every 1 minutes", timeoutSeconds: 300, memory: "512MiB" },
    withHeartbeat('autoLockPools', async () => {
    const now = Date.now();
    // A pool SELECTED for auto-lock whose deadline is unparseable can never
    // lock — it is skipped silently, every minute, forever. Counted so the
    // heartbeat says so instead of reporting a clean run.
    let invalidDeadlines = 0;
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

        // Collect the pools that are actually due (lockAt within 30s), then lock
        // them with bounded concurrency below.
        const duePools: GameState[] = [];

        for (const doc of squaresSnapshot.docs) {
            const pool = { id: doc.id, ...doc.data() } as GameState;
            const raw = pool.reminders?.lock?.lockAt;
            if (!raw) continue;
            const lockAtNum = toMillis(raw);
            if (isNaN(lockAtNum)) {
                invalidDeadlines++;
                console.warn(`[AutoLock] Invalid lockAt for pool ${pool.id}:`, raw);
                continue;
            }
            if (lockAtNum - now <= 30000) duePools.push(pool);
        }

        for (const doc of bracketSnapshot.docs) {
            const pool = { id: doc.id, ...doc.data() } as GameState;
            const raw = (pool as any).lockAt;
            if (!raw) continue;
            const lockAtNum = toMillis(raw);
            if (isNaN(lockAtNum)) {
                invalidDeadlines++;
                console.warn(`[AutoLock] Invalid lockAt for BRACKET pool ${pool.id}:`, raw);
                continue;
            }
            if (lockAtNum - now <= 30000) duePools.push(pool);
        }

        console.log(`[AutoLock] Locking ${duePools.length} due pool(s) with bounded concurrency`);
        const failed = await lockAllWithConcurrency(duePools);

        console.log(`[AutoLock] Completed auto-lock check`);
        // A pool that failed to lock leaves picks OPEN past its deadline. The
        // per-pool catch stops one failure taking the batch down, which meant a
        // run where none of the due pools locked still reported healthy.
        return autoLockVerdict({ duePools: duePools.length, failed, invalidDeadlines });
    } catch (error) {
        // Caught so a scheduled run cannot become an unhandled rejection — but
        // NO pool was locked, and this job runs every minute on the path that
        // closes pick submission. A healthy heartbeat here would be a lie.
        console.error(`[AutoLock] Critical error:`, error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}));


// --- EXECUTE AUTO LOCK ---
/** True when the pool was locked; false when the transaction failed. */
async function executeAutoLock(pool: GameState): Promise<boolean> {
    const poolRef = db.collection('pools').doc(pool.id);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists) return; // Deleted?
            const currentPool = doc.data() as any;

            if (currentPool.isLocked) {
                console.log(`[AutoLock] Skipped - already locked: ${pool.id}`);
                return;
            }

            const updates: any = {
                isLocked: true,
                updatedAt: Timestamp.now(),
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
            } else if (type === 'BRACKET') {
                updates.status = 'LOCKED';
                updates.lockAt = Timestamp.now(); // Ensure sync
            }
            // PROPS and NFL_PLAYOFFS just use isLocked: true

            t.update(poolRef, updates);

            // Generic Audit Log
            await writeAuditEvent({
                poolId: pool.id,
                type: 'POOL_LOCKED',
                message: 'Auto-locked by system (Timer)',
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'AutoLock' }
                // NO dedupeKey - auto-lock should only happen once anyway
            }, t);
        });

        console.log(`[AutoLock] SUCCESSFULLY LOCKED: ${pool.id}`);
        return true;
    } catch (e) {
        console.error(`[AutoLock] Failed to lock pool ${pool.id}:`, e);
        return false;
    }
}
