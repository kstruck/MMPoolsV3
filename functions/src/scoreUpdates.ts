import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GameState, AxisNumbers, Winner } from "./types";
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

// Helper to safely parse integers
const safeInt = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
};

const getPeriodScore = (lines: any[], period: number): number => {
    let val;
    // Try finding by period property
    const found = lines.find((l: any) => l.period == period);
    if (found) {
        val = found.value ?? found.displayValue;
    } else {
        // Fallback to index
        const indexed = lines[period - 1];
        if (indexed) val = indexed.value ?? indexed.displayValue;
    }
    return safeInt(val);
};

// Helper to safely parse payout
const getSafePayout = (payouts: any, key: string): number => {
    if (!payouts) return 0;
    const val = payouts[key];
    return typeof val === 'number' ? val : Number(val) || 0;
};

// Helper: Get last digit for squares logic
const getLastDigit = (n: number) => Math.abs(n) % 10;

// Fetch and calculate scores from ESPN API
async function fetchESPNScores(gameId: string, league: string): Promise<any | null> {
    try {
        const leaguePath = league === 'college' || league === 'ncaa' ? 'college-football' : 'nfl';
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${gameId}`;

        const resp = await fetch(url);
        if (!resp.ok) return null;

        const data = await resp.json();
        if (!data.header?.competitions?.[0]) return null;

        const competition = data.header.competitions[0];
        const status = data.header.status || competition.status;
        const competitors = competition.competitors;

        const homeComp = competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competitors.find((c: any) => c.homeAway === 'away');

        if (!homeComp || !awayComp) return null;

        const homeLines = homeComp.linescores || [];
        const awayLines = awayComp.linescores || [];

        // Get individual quarter DELTA scores from ESPN
        const q1Home = getPeriodScore(homeLines, 1);
        const q1Away = getPeriodScore(awayLines, 1);
        const q2Home = getPeriodScore(homeLines, 2);
        const q2Away = getPeriodScore(awayLines, 2);
        const q3HomeRaw = getPeriodScore(homeLines, 3);
        const q3AwayRaw = getPeriodScore(awayLines, 3);
        const q4HomeRaw = getPeriodScore(homeLines, 4);
        const q4AwayRaw = getPeriodScore(awayLines, 4);

        // Calculate CUMULATIVE scores (what we store)
        const halfHome = q1Home + q2Home;
        const halfAway = q1Away + q2Away;
        const q3Home = halfHome + q3HomeRaw;
        const q3Away = halfAway + q3AwayRaw;
        const regFinalHome = q3Home + q4HomeRaw;
        const regFinalAway = q3Away + q4AwayRaw;

        const apiTotalHome = safeInt(homeComp.score);
        const apiTotalAway = safeInt(awayComp.score);

        const period = safeInt(status.period);
        const state = status.type?.state || 'pre';
        const clock = status.displayClock || "0:00";
        const gameDate = competition.date;

        return {
            current: { home: apiTotalHome, away: apiTotalAway },
            // Q1 stores the delta (which equals cumulative since it's Q1)
            q1: { home: q1Home, away: q1Away },
            // Half stores cumulative (Q1 + Q2)
            half: { home: halfHome, away: halfAway },
            // Q3 stores cumulative (Q1 + Q2 + Q3)
            q3: { home: q3Home, away: q3Away },
            // Final stores cumulative or API total
            final: { home: regFinalHome, away: regFinalAway },
            apiTotal: { home: apiTotalHome, away: apiTotalAway },
            gameStatus: state,
            period,
            clock,
            startTime: gameDate
        };
    } catch (e) {
        console.error('ESPN fetch failed:', e);
        return null;
    }
}

// Helper to handle winner logging and computation (Shared between sync and fix)
const processWinners = async (
    transaction: admin.firestore.Transaction,
    db: admin.firestore.Firestore,
    poolId: string,
    poolData: GameState,
    periodKey: 'q1' | 'half' | 'q3' | 'final',
    homeScore: number,
    awayScore: number,
    skipDedupe: boolean = false
) => {
    // Safety check for axis numbers
    if (!poolData.axisNumbers || !poolData.axisNumbers.home || !poolData.axisNumbers.away) return;

    // Dedupe check handled by writeAuditEvent keys

    const hDigit = getLastDigit(homeScore);
    const aDigit = getLastDigit(awayScore);

    const soldSquares = poolData.squares ? poolData.squares.filter((s: any) => s.owner).length : 0;
    const totalPot = soldSquares * (poolData.costPerSquare || 0);

    // Process Payout Amount
    const payoutPct = getSafePayout(poolData.payouts, periodKey);
    let amount = (totalPot * payoutPct) / 100;
    if (poolData.ruleVariations?.reverseWinners) amount /= 2;

    const label = periodKey === 'q1' ? 'Q1' : periodKey === 'half' ? 'Halftime' : periodKey === 'q3' ? 'Q3' : 'Final';
    const axis = poolData.axisNumbers;

    if (axis) {
        const row = axis.away.indexOf(aDigit);
        const col = axis.home.indexOf(hDigit);

        if (row !== -1 && col !== -1) {
            const squareIndex = row * 10 + col;
            const square = poolData.squares[squareIndex];
            const winnerName = square?.owner || 'Unsold';

            await writeAuditEvent({
                poolId: poolId,
                type: 'WINNER_COMPUTED',
                message: `${label} Winner: ${winnerName} (Home ${hDigit}, Away ${aDigit})`,
                severity: 'INFO',
                actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                payload: { period: label, homeScore, awayScore, homeDigit: hDigit, awayDigit: aDigit, winner: winnerName, squareId: squareIndex, amount },
                ...(skipDedupe ? {} : { dedupeKey: `WINNER:${poolId}:${periodKey}:${hDigit}:${aDigit}` })
            }, transaction);

            const winnerDoc: Winner = {
                period: periodKey,
                squareId: squareIndex,
                owner: winnerName,
                amount: amount,
                homeDigit: hDigit,
                awayDigit: aDigit,
                isReverse: false,
                description: `${label} Winner`
            };
            transaction.set(db.collection('pools').doc(poolId).collection('winners').doc(periodKey), winnerDoc);
        }

        if (poolData.ruleVariations?.reverseWinners) {
            const rRow = axis.away.indexOf(hDigit);
            const rCol = axis.home.indexOf(aDigit);
            if (rRow !== -1 && rCol !== -1) {
                const rSqIndex = rRow * 10 + rCol;
                // Regular winner index (if valid)
                const regularIndex = (row !== -1 && col !== -1) ? (row * 10 + col) : -999;

                if (rSqIndex !== regularIndex) {
                    const rSquare = poolData.squares[rSqIndex];
                    const rWinnerName = rSquare?.owner || 'Unsold';
                    await writeAuditEvent({
                        poolId: poolId,
                        type: 'WINNER_COMPUTED',
                        message: `${label} Reverse Winner: ${rWinnerName}`,
                        severity: 'INFO',
                        actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                        payload: { period: label, type: 'REVERSE', winner: rWinnerName, squareId: rSqIndex, amount: amount },
                        ...(skipDedupe ? {} : { dedupeKey: `WINNER_REV:${poolId}:${periodKey}:${hDigit}:${aDigit}` })
                    }, transaction);
                }
            }
        }
    }
};

/**
 * Core logic to update a single pool based on new scores.
 */
const processGameUpdate = async (
    transaction: admin.firestore.Transaction,
    doc: admin.firestore.DocumentSnapshot,
    espnScores: any,
    actor: { uid: string, role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN' | 'GUEST', label?: string },
    overrides?: Partial<GameState>
) => {
    const db = admin.firestore();
    const freshPool = { ...doc.data() as GameState, ...overrides };

    if (!espnScores) return;

    const period = espnScores.period;
    const state = espnScores.gameStatus;
    const isQ1Final = (period >= 2) || (state === "post");
    const isHalfFinal = (period >= 3) || (state === "post");
    const isQ3Final = (period >= 4) || (state === "post");
    const isGameFinal = (state === "post");

    // Prepare New Scores Object
    const newScores: any = {
        ...freshPool.scores,
        current: espnScores.current,
        gameStatus: state,
        period: period,
        clock: espnScores.clock,
        startTime: espnScores.startTime || freshPool.scores.startTime
    };

    if (isQ1Final && !freshPool.scores?.q1) newScores.q1 = espnScores.q1;
    if (isHalfFinal && !freshPool.scores?.half) newScores.half = espnScores.half;
    if (isQ3Final && !freshPool.scores?.q3) newScores.q3 = espnScores.q3;
    if (isGameFinal && !freshPool.scores?.final) {
        newScores.final = (freshPool.includeOvertime && espnScores.apiTotal !== undefined)
            ? espnScores.apiTotal
            : (espnScores.final || espnScores.current);
    }

    let transactionUpdates: any = {};
    let shouldUpdate = false;

    const currentScoresStr = JSON.stringify(freshPool.scores);
    const newScoresStr = JSON.stringify(newScores);

    if (currentScoresStr !== newScoresStr) {
        transactionUpdates.scores = newScores;
        shouldUpdate = true;
    }

    // Live Score Update Logging
    const freshCurrent = freshPool.scores?.current || { home: 0, away: 0 };
    const newCurrent = espnScores.current || { home: 0, away: 0 };

    // Check if score changed
    if (freshCurrent.home !== newCurrent.home || freshCurrent.away !== newCurrent.away) {
        // 1. Log Score Change Audit
        await writeAuditEvent({
            poolId: doc.id,
            type: 'SCORE_FINALIZED',
            message: `Score Update: ${newCurrent.home}-${newCurrent.away} (${state === 'pre' ? 'Pre' : period + (period === 1 ? 'st' : period === 2 ? 'nd' : period === 3 ? 'rd' : 'th')})`,
            severity: 'INFO',
            actor: actor,
            payload: { home: newCurrent.home, away: newCurrent.away, clock: espnScores.clock || "0:00" }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);

        // 2. Add to Score History (scoreEvents)
        const newEvent = {
            id: db.collection("_").doc().id, // Random ID
            home: newCurrent.home,
            away: newCurrent.away,
            description: `Score Change (${period > 0 ? 'Q' + period : 'Pre'})`,
            timestamp: Date.now()
        };
        transactionUpdates.scoreEvents = admin.firestore.FieldValue.arrayUnion(newEvent);
        shouldUpdate = true;

        // 3. Handle "Score Change Payouts" (Event Winners)
        if (freshPool.ruleVariations?.scoreChangePayout) {
            const hDigit = getLastDigit(newCurrent.home);
            const aDigit = getLastDigit(newCurrent.away);
            const axis = freshPool.axisNumbers;

            if (axis) {
                const row = axis.away.indexOf(aDigit);
                const col = axis.home.indexOf(hDigit);

                if (row !== -1 && col !== -1) {
                    const squareIndex = row * 10 + col;
                    const square = freshPool.squares[squareIndex];
                    const winnerName = square?.owner || 'Unsold';

                    await writeAuditEvent({
                        poolId: doc.id,
                        type: 'WINNER_COMPUTED',
                        message: `Event Winner: ${winnerName} (${newCurrent.home}-${newCurrent.away})`,
                        severity: 'INFO',
                        actor: actor,
                        payload: {
                            period: 'Event',
                            homeScore: newCurrent.home,
                            awayScore: newCurrent.away,
                            homeDigit: hDigit,
                            awayDigit: aDigit,
                            winner: winnerName,
                            squareId: squareIndex
                        }
                        // Dedupe skipped to prevent Read-After-Write error
                    }, transaction);

                    // PERSIST WINNER TO COLLECTION
                    const winnerDoc: Winner = {
                        period: 'Event',
                        squareId: squareIndex,
                        owner: winnerName,
                        amount: 0, // Calculated at end of game
                        homeDigit: hDigit,
                        awayDigit: aDigit,
                        isReverse: false,
                        description: `Score Change (${newCurrent.home}-${newCurrent.away})`
                    };
                    transaction.set(
                        db.collection('pools').doc(doc.id).collection('winners').doc(`event_${newCurrent.home}_${newCurrent.away}`),
                        winnerDoc
                    );
                }
            }
        }
    }

    if (freshPool.numberSets === 4) {
        let qNums = freshPool.quarterlyNumbers || {};
        let numsUpdated = false;

        const handleGen = async (pKey: 'q2' | 'q3' | 'q4') => {
            const newAxis = generateAxisNumbers();
            qNums[pKey] = newAxis;
            numsUpdated = true;
            const digitsHash = computeDigitsHash({ home: newAxis.home, away: newAxis.away, poolId: doc.id, period: pKey });
            await writeAuditEvent({
                poolId: doc.id,
                type: 'DIGITS_GENERATED',
                message: `${pKey.toUpperCase()} Axis Numbers Generated`,
                severity: 'INFO',
                actor: actor,
                payload: { period: pKey, commitHash: digitsHash }
                // Dedupe skipped to prevent Read-After-Write error
            }, transaction);
        };

        if (isQ1Final && !qNums.q2) await handleGen('q2');
        if (isHalfFinal && !qNums.q3) await handleGen('q3');
        if (isQ3Final && !qNums.q4) await handleGen('q4');

        if (numsUpdated) {
            transactionUpdates.quarterlyNumbers = qNums;
            shouldUpdate = true;
            if (qNums.q4 && (period >= 4)) transactionUpdates.axisNumbers = qNums.q4;
            else if (qNums.q3 && (period >= 3)) transactionUpdates.axisNumbers = qNums.q3;
            else if (qNums.q2 && (period >= 2)) transactionUpdates.axisNumbers = qNums.q2;
            else if (qNums.q1) transactionUpdates.axisNumbers = qNums.q1;
        }
    }

    const q1H = newScores.q1?.home; const q1A = newScores.q1?.away;
    const halfH = newScores.half?.home; const halfA = newScores.half?.away;
    const q3H = newScores.q3?.home; const q3A = newScores.q3?.away;
    const finalH = newScores.final?.home; const finalA = newScores.final?.away;

    if (isQ1Final && q1H !== undefined) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
            actor: actor, payload: { period: 1, score: { home: q1H, away: q1A } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q1', q1H, q1A, true);
    }

    if (isHalfFinal && halfH !== undefined) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
            actor: actor, payload: { period: 2, score: { home: halfH, away: halfA } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'half', halfH, halfA, true);
    }

    if (isQ3Final && q3H !== undefined) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
            actor: actor, payload: { period: 3, score: { home: q3H, away: q3A } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q3', q3H, q3A, true);
    }

    if (isGameFinal && finalH !== undefined) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Game Finalized: ${finalH}-${finalA}`, severity: 'INFO',
            actor: actor, payload: { period: 4, score: { home: finalH, away: finalA } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'final', finalH, finalA, true);
    }

    // ... (This function is getting large, consider refactoring if it grows more)

    // FINAL WRITE: Update the pool doc itself
    // Must be last if previous steps involve reads (like audit deduping)
    if (shouldUpdate) {
        transaction.update(doc.ref, {
            ...transactionUpdates,
            updatedAt: admin.firestore.Timestamp.now()
        });
    }

    // --- EVERY SCORE PAYS FINALIZATION ---
    // If the game just went final, we need to calculate the actual $ amount for each event based on the total pot logic
    if (isGameFinal && freshPool.ruleVariations?.scoreChangePayout) {
        await finalizeEventPayouts(transaction, db, doc.id, freshPool, actor);
    }
};

// Helper to calculate and backfill amounts for all score events when game is over
const finalizeEventPayouts = async (
    transaction: admin.firestore.Transaction,
    db: admin.firestore.Firestore,
    poolId: string,
    pool: GameState,
    actor: { uid: string, role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN' | 'GUEST', label?: string }
) => {
    // 1. Calculate Pot Logic
    const soldSquares = pool.squares ? pool.squares.filter((s: any) => s.owner).length : 0;
    const totalPot = soldSquares * (pool.costPerSquare || 0);

    let scoreChangePot = 0;
    const strategy = pool.ruleVariations.scoreChangePayoutStrategy || 'equal_split';

    if (strategy === 'equal_split') {
        // In "Equal Split" mode (as per user req), usually this means 100% of pot goes to scores??
        // Or is it implied that PayoutConfig is respected?
        // Game Logic client-side says: "Option A (Equal Split) = 100% of pot is for scores (technically, if not standard 25/25/25/25)"
        // But let's assume if payouts are defined (e.g. 25/25/25/25), then Equal Split applies to the *Remainder*?
        // Actually, for "Every Score Pays", usually the *Entire* pot is split by events.
        // Let's stick to the GameLogic.ts implementation logic to match client validation.
        // In GameLogic.ts: if equal_split, scoreChangePot = totalPot (and distributable is 0)
        scoreChangePot = totalPot;
    } else {
        // Hybrid
        const weights = pool.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 };
        const remainingPct = 100 - weights.final - weights.halftime;
        scoreChangePot = (totalPot * remainingPct) / 100;
    }

    // 2. Filter Valid Events
    let validEvents = [...(pool.scoreEvents || [])];
    if (pool.ruleVariations.includeOTInScorePayouts === false) {
        validEvents = validEvents.filter(e => !e.description.toUpperCase().includes('OT') && !e.description.toUpperCase().includes('OVERTIME'));
    }

    // 3. Calculate Amount Per Event
    const eventCount = validEvents.length;
    const amountPerEvent = eventCount > 0 ? (scoreChangePot / eventCount) : 0;

    // 4. Update Winner Docs
    // We need to find the winner docs corresponding to these events.
    // The ID format is `event_HOME_AWAY`.
    // Valid events have unique scores usually, but lets be careful.

    let updatedCount = 0;

    for (const ev of validEvents) {
        const docId = `event_${ev.home}_${ev.away}`;
        const winnerRef = db.collection('pools').doc(poolId).collection('winners').doc(docId);

        // We use transaction.set with merge true to update amount
        transaction.set(winnerRef, { amount: amountPerEvent }, { merge: true });
        updatedCount++;
    }

    // 5. Log Action
    if (updatedCount > 0) {
        await writeAuditEvent({
            poolId: poolId,
            type: 'WINNER_COMPUTED',
            message: `Finalized Event Payouts: $${amountPerEvent.toFixed(2)} per event (${updatedCount} events)`,
            severity: 'INFO',
            actor: actor,
            payload: {
                totalPot,
                scoreChangePot,
                eventCount,
                amountPerEvent
            }
        }, transaction);
    }
};

export const syncGameStatus = onSchedule({
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    const db = admin.firestore();

    // 1. Fetch Active Pools
    const poolsSnap = await db.collection("pools")
        .where("scores.gameStatus", "!=", "post")
        .get();

    if (poolsSnap.empty) return;

    // 2. Process Each Pool
    for (const doc of poolsSnap.docs) {
        const pool = doc.data() as GameState;

        if (!pool.gameId) continue;

        if (!pool.isLocked && pool.scores?.gameStatus === 'pre') {
            const now = Date.now();
            const start = new Date(pool.scores.startTime || 0).getTime();
            if (start > now + 2 * 60 * 60 * 1000) continue;
        }

        const espnScores = await fetchESPNScores(pool.gameId, (pool as any).league || 'nfl');
        if (!espnScores) continue;

        await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(doc.ref);
            if (!freshDoc.exists) return;
            // Use shared logic
            await processGameUpdate(
                transaction,
                freshDoc,
                espnScores,
                { uid: 'system', role: 'SYSTEM' }
            );
        });
    }
});

// Callable to simulate a game update for testing
export const simulateGameUpdate = onCall({
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (request) => {
    // Relaxed Auth for Dev/Test - Ensure user is at least authenticated
    if (!request.auth) {
        throw new HttpsError('permission-denied', 'Authentication required');
    }

    const { poolId, scores } = request.data;
    if (!poolId || !scores) {
        throw new HttpsError('invalid-argument', 'Missing poolId or scores');
    }

    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);

    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(poolRef);
            if (!doc.exists) throw new HttpsError('not-found', 'Pool not found');

            // Ensure Axis Numbers Exist during Simulation
            let overrides: Partial<GameState> = {};
            const poolData = doc.data() as GameState;
            if (!poolData.axisNumbers) {
                const newAxis = generateAxisNumbers();
                console.log(`[Sim] Generating missing Axis Numbers for pool ${poolId}`);
                transaction.update(poolRef, { axisNumbers: newAxis });
                overrides.axisNumbers = newAxis;

                await writeAuditEvent({
                    poolId: doc.id,
                    type: 'DIGITS_GENERATED',
                    message: `Axis Numbers Auto-Generated for Simulation`,
                    severity: 'INFO',
                    actor: { uid: request.auth?.uid || 'admin', role: 'ADMIN', label: 'Sim Auto-Gen' },
                    payload: { axis: newAxis }
                    // Dedupe skipped to prevent Read-After-Write error
                }, transaction);
            }

            await processGameUpdate(
                transaction,
                doc,
                scores,
                { uid: request.auth?.uid || 'admin', role: 'ADMIN', label: 'Simulation' },
                overrides
            );
        });

        return { success: true, message: 'Simulation Applied' };
    } catch (error: any) {
        console.error('Simulation Transaction Failed:', error);
        throw new HttpsError('internal', `Simulation failed: ${error.message}`);
    }
});

// One-time callable function to fix corrupted pool scores AND run winner logic
export const fixPoolScores = onCall({
    timeoutSeconds: 120,
    memory: "256MiB"
}, async (request) => {
    // Only allow super admin
    if (!request.auth || request.auth.token.email !== 'kstruck@gmail.com') {
        throw new HttpsError('permission-denied', 'Only super admin can run this');
    }

    const db = admin.firestore();
    const results: any[] = [];

    const poolsSnap = await db.collection("pools")
        .where("gameId", ">", "")
        .get();

    for (const doc of poolsSnap.docs) {
        const pool = doc.data() as GameState;

        if (!pool.gameId) {
            results.push({ id: doc.id, status: 'skipped', reason: 'no gameId' });
            continue;
        }

        const gameStatus = pool.scores?.gameStatus;
        if (gameStatus !== 'in' && gameStatus !== 'post') {
            results.push({ id: doc.id, status: 'skipped', reason: `gameStatus is ${gameStatus}` });
            continue;
        }

        const espnScores = await fetchESPNScores(pool.gameId, (pool as any).league || 'nfl');
        if (!espnScores) {
            results.push({ id: doc.id, status: 'error', reason: 'ESPN fetch failed' });
            continue;
        }

        const period = espnScores.period;
        const state = espnScores.gameStatus;
        const isQ1Final = (period >= 2) || (state === "post");
        const isHalfFinal = (period >= 3) || (state === "post");
        const isQ3Final = (period >= 4) || (state === "post");
        const isGameFinal = (state === "post");

        // Prepare Updates
        const updates: any = {
            'scores.current': espnScores.current,
            'scores.gameStatus': state,
            'scores.period': period,
            'scores.clock': espnScores.clock
        };

        if (isQ1Final) updates['scores.q1'] = espnScores.q1;
        if (isHalfFinal) updates['scores.half'] = espnScores.half;
        if (isQ3Final) updates['scores.q3'] = espnScores.q3;
        if (isGameFinal) {
            updates['scores.final'] = pool.includeOvertime ? espnScores.apiTotal : espnScores.final;
        }

        // Run as Transaction to support winners & audit
        await db.runTransaction(async (t) => {
            t.update(doc.ref, updates);

            // Construct the "Effective" pool data to use for winner logging
            const effectivePool = {
                ...pool,
                scores: {
                    ...pool.scores, ...{
                        q1: isQ1Final ? espnScores.q1 : pool.scores.q1,
                        half: isHalfFinal ? espnScores.half : pool.scores.half,
                        q3: isQ3Final ? espnScores.q3 : pool.scores.q3,
                        final: isGameFinal ? (pool.includeOvertime ? espnScores.apiTotal : espnScores.final) : pool.scores.final
                    }
                }
            };

            const q1H = effectivePool.scores.q1?.home; const q1A = effectivePool.scores.q1?.away;
            const halfH = effectivePool.scores.half?.home; const halfA = effectivePool.scores.half?.away;
            const q3H = effectivePool.scores.q3?.home; const q3A = effectivePool.scores.q3?.away;
            const finalH = effectivePool.scores.final?.home; const finalA = effectivePool.scores.final?.away;

            if (isQ1Final && q1H !== undefined) await processWinners(t, db, doc.id, effectivePool, 'q1', q1H, q1A);
            if (isHalfFinal && halfH !== undefined) await processWinners(t, db, doc.id, effectivePool, 'half', halfH, halfA);
            if (isQ3Final && q3H !== undefined) await processWinners(t, db, doc.id, effectivePool, 'q3', q3H, q3A);
            if (isGameFinal && finalH !== undefined) await processWinners(t, db, doc.id, effectivePool, 'final', finalH, finalA);

            // BACKFILL EVENT WINNERS
            if (pool.ruleVariations?.scoreChangePayout && pool.scoreEvents) {
                for (const ev of pool.scoreEvents) {
                    const hDigit = getLastDigit(ev.home);
                    const aDigit = getLastDigit(ev.away);
                    // ... (existing logic to recreate winners if missing) ...
                    // We can reuse the same logic block here or just trust processGameUpdate logic?
                    // The block above (lines 621-665 in view) handles *creation* of docs.
                    // But we also need to set the *Amount* if the game is final.

                    // Let's ensure the Backfill logic above runs first to create docs (it has amount: 0)
                    // Then run finalize logic to update amounts.

                    let axis = pool.axisNumbers;
                    if (pool.numberSets === 4 && pool.quarterlyNumbers) {
                        let periodKey: 'q1' | 'q2' | 'q3' | 'q4' = 'q1';
                        if (ev.description.includes('Q2')) periodKey = 'q2';
                        if (ev.description.includes('Q3')) periodKey = 'q3';
                        if (ev.description.includes('Q4')) periodKey = 'q4';

                        if (periodKey === 'q1' && pool.quarterlyNumbers.q1) axis = pool.quarterlyNumbers.q1;
                        if (periodKey === 'q2' && pool.quarterlyNumbers.q2) axis = pool.quarterlyNumbers.q2;
                        if (periodKey === 'q3' && pool.quarterlyNumbers.q3) axis = pool.quarterlyNumbers.q3;
                        if (periodKey === 'q4' && pool.quarterlyNumbers.q4) axis = pool.quarterlyNumbers.q4;
                    }

                    if (axis) {
                        const row = axis.away.indexOf(aDigit);
                        const col = axis.home.indexOf(hDigit);

                        if (row !== -1 && col !== -1) {
                            const sqIdx = row * 10 + col;
                            const square = pool.squares[sqIdx];
                            const winnerName = square?.owner || 'Unsold';

                            // Don't overwrite if exists, just ensure it's there
                            // Actually fixPoolScores is forceful.
                            const winnerDoc: Winner = {
                                period: 'Event',
                                squareId: sqIdx,
                                owner: winnerName,
                                amount: 0, // Will be updated by finalize if Final
                                homeDigit: hDigit,
                                awayDigit: aDigit,
                                isReverse: false,
                                description: `Score Change (${ev.home}-${ev.away})`
                            };
                            t.set(
                                db.collection('pools').doc(doc.id).collection('winners').doc(`event_${ev.home}_${ev.away}`),
                                winnerDoc
                            );
                        }
                    }
                }

                // NEW: Run Finalize Payouts if Game is Final
                if (isGameFinal) {
                    // We need the *fresh* (effective) pool data with the events we just ensured exist
                    // Since we're in a transaction, writes aren't visible to reads yet typically, 
                    // but `finalizeEventPayouts` doesn't read *winners*, it only Writes them.
                    // It Reads `pool.scoreEvents` (from memory) and `pool.ruleVariations`.
                    await finalizeEventPayouts(t, db, doc.id, effectivePool, { uid: 'admin', role: 'ADMIN', label: 'Fix Payouts' });
                }
            }

            // Also log that FIX was run

            // Also log that FIX was run
            const eventsCount = pool.scoreEvents?.length || 0;
            console.log(`[Fix] Backfilled winners for pool ${doc.id}:`, {
                q1: !!q1H,
                half: !!halfH,
                q3: !!q3H,
                final: !!finalH,
                eventWinnersCount: eventsCount
            });

            await writeAuditEvent({
                poolId: doc.id,
                type: 'SCORE_FINALIZED',
                message: `Manual Score Fix Applied by Admin`,
                severity: 'WARNING',
                actor: { uid: request.auth?.uid || 'admin', role: 'ADMIN', label: 'SuperAdmin Fix' },
                payload: { updates },
                dedupeKey: `FIX_SCORES:${doc.id}:${Date.now()}`
            }, t);
        });

        results.push({
            id: doc.id,
            name: `${pool.homeTeam} vs ${pool.awayTeam}`,
            status: 'fixed',
            scores: updates
        });
    }

    return { success: true, pools: results };
});
