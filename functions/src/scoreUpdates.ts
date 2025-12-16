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

        const period = espnScores.period;
        const state = espnScores.gameStatus;
        const isQ1Final = (period >= 2) || (state === "post");
        const isHalfFinal = (period >= 3) || (state === "post");
        const isQ3Final = (period >= 4) || (state === "post");
        const isGameFinal = (state === "post");

        const newScores: any = {
            ...pool.scores,
            current: espnScores.current,
            gameStatus: state,
            period: period,
            clock: espnScores.clock,
            startTime: espnScores.startTime
        };

        if (isQ1Final && !pool.scores?.q1) newScores.q1 = espnScores.q1;
        if (isHalfFinal && !pool.scores?.half) newScores.half = espnScores.half;
        if (isQ3Final && !pool.scores?.q3) newScores.q3 = espnScores.q3;
        if (isGameFinal && !pool.scores?.final) newScores.final = pool.includeOvertime ? espnScores.apiTotal : espnScores.final;

        await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(doc.ref);
            if (!freshDoc.exists) return;
            const freshPool = freshDoc.data() as GameState;

            let transactionUpdates: any = {};
            let shouldUpdate = false;

            const currentScoresStr = JSON.stringify(freshPool.scores);
            const newScoresStr = JSON.stringify(newScores);

            if (currentScoresStr !== newScoresStr) {
                transactionUpdates.scores = newScores;
                shouldUpdate = true;
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
                        actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                        payload: { period: pKey, commitHash: digitsHash },
                        dedupeKey: `DIGITS_GENERATED:${doc.id}:${pKey}:${digitsHash}`
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

            if (shouldUpdate) {
                transaction.update(doc.ref, {
                    ...transactionUpdates,
                    updatedAt: admin.firestore.Timestamp.now()
                });
            }

            const handleWinnerLog = async (periodKey: 'q1' | 'half' | 'q3' | 'final', homeScore: number, awayScore: number) => {
                if (!freshPool.axisNumbers) return;
                const hDigit = getLastDigit(homeScore);
                const aDigit = getLastDigit(awayScore);

                const soldSquares = freshPool.squares.filter(s => s.owner).length;
                const totalPot = soldSquares * freshPool.costPerSquare;
                const payoutPct = freshPool.payouts[periodKey] || 0;
                let amount = (totalPot * payoutPct) / 100;
                if (freshPool.ruleVariations?.reverseWinners) amount /= 2;

                const label = periodKey === 'q1' ? 'Q1' : periodKey === 'half' ? 'Halftime' : periodKey === 'q3' ? 'Q3' : 'Final';
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
                            message: `${label} Winner: ${winnerName} (Home ${hDigit}, Away ${aDigit})`,
                            severity: 'INFO',
                            actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                            payload: { period: label, homeScore, awayScore, homeDigit: hDigit, awayDigit: aDigit, winner: winnerName, squareId: squareIndex, amount },
                            dedupeKey: `WINNER:${doc.id}:${periodKey}:${hDigit}:${aDigit}`
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
                        transaction.set(db.collection('pools').doc(doc.id).collection('winners').doc(periodKey), winnerDoc);
                    }

                    if (freshPool.ruleVariations?.reverseWinners) {
                        const rRow = axis.away.indexOf(hDigit);
                        const rCol = axis.home.indexOf(aDigit);
                        if (rRow !== -1 && rCol !== -1) {
                            const rSqIndex = rRow * 10 + rCol;
                            if (rSqIndex !== (row * 10 + col)) {
                                const rSquare = freshPool.squares[rSqIndex];
                                const rWinnerName = rSquare?.owner || 'Unsold';
                                await writeAuditEvent({
                                    poolId: doc.id,
                                    type: 'WINNER_COMPUTED',
                                    message: `${label} Reverse Winner: ${rWinnerName}`,
                                    severity: 'INFO',
                                    actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                                    payload: { period: label, type: 'REVERSE', winner: rWinnerName, squareId: rSqIndex },
                                    dedupeKey: `WINNER_REV:${doc.id}:${periodKey}:${hDigit}:${aDigit}`
                                }, transaction);
                            }
                        }
                    }
                }
            };

            const q1H = newScores.q1?.home; const q1A = newScores.q1?.away;
            const halfH = newScores.half?.home; const halfA = newScores.half?.away;
            const q3H = newScores.q3?.home; const q3A = newScores.q3?.away;
            const finalH = newScores.final?.home; const finalA = newScores.final?.away;

            if (isQ1Final && q1H !== undefined) {
                await writeAuditEvent({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 1, score: { home: q1H, away: q1A } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:q1`
                }, transaction);
                await handleWinnerLog('q1', q1H, q1A);
            }

            if (isHalfFinal && halfH !== undefined) {
                await writeAuditEvent({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 2, score: { home: halfH, away: halfA } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:half`
                }, transaction);
                await handleWinnerLog('half', halfH, halfA);
            }

            if (isQ3Final && q3H !== undefined) {
                await writeAuditEvent({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 3, score: { home: q3H, away: q3A } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:q3`
                }, transaction);
                await handleWinnerLog('q3', q3H, q3A);
            }

            if (isGameFinal && finalH !== undefined) {
                await writeAuditEvent({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Game Finalized: ${finalH}-${finalA}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 4, score: { home: finalH, away: finalA } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:final`
                }, transaction);
                await handleWinnerLog('final', finalH, finalA);
            }
        });
    }
});

// One-time callable function to fix corrupted pool scores
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

    // Find all active pools with a game assigned (regardless of lock status)
    // We filter for gameId > "" to ensure we only get pools with a game.
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

        // Fetch fresh scores
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

        // Force update all scores based on current period
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

        await db.collection('pools').doc(doc.id).update(updates);

        results.push({
            id: doc.id,
            name: `${pool.homeTeam} vs ${pool.awayTeam}`,
            status: 'fixed',
            scores: {
                q1: isQ1Final ? espnScores.q1 : null,
                half: isHalfFinal ? espnScores.half : null,
                q3: isQ3Final ? espnScores.q3 : null,
                final: isGameFinal ? (pool.includeOvertime ? espnScores.apiTotal : espnScores.final) : null,
                current: espnScores.current
            }
        });
    }

    return { success: true, pools: results };
});
