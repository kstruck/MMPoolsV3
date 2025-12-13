import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { GameState, AxisNumbers } from "./types";
import { writeAuditEvent, computeDigitsHash } from "./audit";

// Helper to generate random digits
const generateDigits = (): number[] => {
    const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return nums;
};

// Helper to generate AxisNumbers
const generateAxisNumbers = (): AxisNumbers => ({
    home: generateDigits(),
    away: generateDigits(),
});

export const syncGameStatus = onSchedule({
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

    if (poolsSnap.empty) return;

    // 2. Group by Game ID to batch ESPN calls
    const gameIds = new Set<string>();
    poolsSnap.docs.forEach(doc => {
        const p = doc.data() as GameState;
        if (p.gameId) gameIds.add(p.gameId);
    });

    // 3. Fetch Data for each Game
    const gameDataMap: Record<string, any> = {};
    for (const gid of Array.from(gameIds)) {
        try {
            const resp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gid}`);
            if (resp.ok) {
                gameDataMap[gid] = await resp.json();
            }
        } catch (e) {
            console.error(`Failed to fetch game ${gid}`, e);
        }
    }

    // 4. Process Each Pool
    for (const doc of poolsSnap.docs) {
        const pool = doc.data() as GameState;
        const gameData = gameDataMap[pool.gameId || ""];

        if (!gameData || !gameData.header || !gameData.header.competitions) continue;

        const competition = gameData.header.competitions[0];
        const status = competition.status;
        const period = status.period; // 1, 2, 3, 4...
        const state = status.type.state; // 'pre', 'in', 'post'

        // Determine if quarters are final
        const isQ1Final = (period >= 2) || (state === "post");
        const isHalfFinal = (period >= 3) || (state === "post");
        const isQ3Final = (period >= 4) || (state === "post");

        // Create updates object
        let updates: any = {};

        // 1. Basic Score & Time Data
        const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');

        const homeScore = parseInt(homeComp.score || '0');
        const awayScore = parseInt(awayComp.score || '0');
        const displayClock = status.displayClock;
        const gameDate = competition.date; // ISO String

        // Prepare new scores object
        const newScores = {
            ...pool.scores,
            current: { home: homeScore, away: awayScore },
            gameStatus: state,
            period: period,
            clock: displayClock,
            startTime: gameDate
        };

        // Deep check to strictly avoid unnecessary writes (infinite loops)
        const isChanged =
            JSON.stringify(newScores.current) !== JSON.stringify(pool.scores.current) ||
            pool.scores.gameStatus !== state ||
            pool.scores.period !== period ||
            pool.scores.clock !== displayClock ||
            pool.scores.startTime !== gameDate;

        if (isChanged) {
            updates['scores'] = newScores;
        }

        // --- TRANSACTION WRAPPER for Safety ---
        await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(doc.ref);
            if (!freshDoc.exists) return;
            const freshPool = freshDoc.data() as GameState;

            let transactionUpdates: any = {};
            if (isChanged) transactionUpdates['scores'] = newScores;

            // Re-read 4-Sets Logic with fresh data
            if (freshPool.numberSets === 4) {
                let qNums = freshPool.quarterlyNumbers || {};
                let updated = false;

                // Helper to generate and log
                const handleGen = async (pKey: 'q2' | 'q3' | 'q4', triggerPeriod: string) => {
                    const newAxis = generateAxisNumbers();
                    qNums[pKey] = newAxis;
                    updated = true;

                    const digitsHash = computeDigitsHash({ home: newAxis.home, away: newAxis.away, poolId: doc.id, period: pKey });
                    await writeAuditEvent({
                        poolId: doc.id,
                        type: 'DIGITS_GENERATED',
                        message: `${pKey.toUpperCase()} Axis Numbers Generated`,
                        severity: 'INFO',
                        actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                        payload: { period: pKey, commitHash: digitsHash },
                        dedupeKey: `DIGITS_GENERATED:${doc.id}:${pKey}:${digitsHash}`
                    }, transaction);
                };

                if (isQ1Final && !qNums.q2) await handleGen('q2', 'Q1 Final');
                if (isHalfFinal && !qNums.q3) await handleGen('q3', 'Half Final');
                if (isQ3Final && !qNums.q4) await handleGen('q4', 'Q3 Final');

                if (updated) {
                    transactionUpdates.quarterlyNumbers = qNums;
                    // Sync current axis
                    if (qNums.q4 && (period >= 4)) transactionUpdates.axisNumbers = qNums.q4;
                    else if (qNums.q3 && (period >= 3)) transactionUpdates.axisNumbers = qNums.q3;
                    else if (qNums.q2 && (period >= 2)) transactionUpdates.axisNumbers = qNums.q2;
                    else if (qNums.q1) transactionUpdates.axisNumbers = qNums.q1;
                }
            }

            // Apply updates if any
            if (Object.keys(transactionUpdates).length > 0) {
                transaction.update(doc.ref, {
                    ...transactionUpdates,
                    updatedAt: admin.firestore.Timestamp.now()
                });
            }
        });
    }
});
