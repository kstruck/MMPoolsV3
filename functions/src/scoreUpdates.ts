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

// Helper: Check if two team names match (fuzzy match for abbreviations vs full names)
const teamNamesMatch = (poolTeam: string | undefined, espnTeam: string | undefined): boolean => {
    if (!poolTeam || !espnTeam) return false;
    const p = poolTeam.toLowerCase().trim();
    const e = espnTeam.toLowerCase().trim();
    // Exact match
    if (p === e) return true;
    // One contains the other (handles "Kansas City Chiefs" vs "KC" or "Chiefs")
    if (p.includes(e) || e.includes(p)) return true;
    // Check if last word matches (e.g., "Falcons" in "Atlanta Falcons")
    const pLast = p.split(/\s+/).pop() || '';
    const eLast = e.split(/\s+/).pop() || '';
    if (pLast.length > 2 && eLast.length > 2 && (pLast === eLast || pLast.includes(eLast) || eLast.includes(pLast))) return true;
    return false;
};

// Helper: Determine if ESPN home/away should be swapped based on pool team names
const shouldSwapHomeAway = (pool: GameState, espnHomeTeam: string, espnAwayTeam: string): boolean => {
    // If pool's homeTeam matches ESPN's awayTeam, scores need to be swapped
    const poolHomeMatchesEspnAway = teamNamesMatch(pool.homeTeam, espnAwayTeam);
    const poolAwayMatchesEspnHome = teamNamesMatch(pool.awayTeam, espnHomeTeam);
    // Only swap if both match in reverse (to avoid false positives)
    return poolHomeMatchesEspnAway && poolAwayMatchesEspnHome;
};

// Helper: Swap home/away in a score pair
const swapScores = (scores: { home: number, away: number } | undefined): { home: number, away: number } | undefined => {
    if (!scores) return undefined;
    return { home: scores.away, away: scores.home };
};

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
            // Team names for matching against pool configuration
            homeTeamName: homeComp.team?.abbreviation || homeComp.team?.displayName || '',
            awayTeamName: awayComp.team?.abbreviation || awayComp.team?.displayName || '',
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
    // Skip ALL period winners for Equal Split (only score events pay)
    if (poolData.ruleVariations?.scoreChangePayout && poolData.ruleVariations?.scoreChangePayoutStrategy === 'equal_split') {
        console.log(`[ScoreSync] Skipping Period Winner for Equal Split Pool ${poolId}`);
        return;
    }

    // For Hybrid: Skip Q1 and Q3 (only Halftime and Final get period payouts)
    if (poolData.ruleVariations?.scoreChangePayout && poolData.ruleVariations?.scoreChangePayoutStrategy === 'hybrid') {
        if (periodKey === 'q1' || periodKey === 'q3') {
            console.log(`[ScoreSync] Skipping ${periodKey} Winner for Hybrid Pool ${poolId} (only half/final pay)`);
            return;
        }
    }

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

                    // Persist reverse winner to subcollection
                    const reverseWinnerDoc: Winner = {
                        period: periodKey,
                        squareId: rSqIndex,
                        owner: rWinnerName,
                        amount: amount,
                        homeDigit: aDigit,  // Swapped for reverse
                        awayDigit: hDigit,  // Swapped for reverse
                        isReverse: true,
                        description: `${label} Reverse Winner`
                    };
                    transaction.set(
                        db.collection('pools').doc(poolId).collection('winners').doc(`${periodKey}_reverse`),
                        reverseWinnerDoc
                    );
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

    // ============ CRITICAL: Detect and correct home/away team orientation ============
    // ESPN returns scores based on actual venue (Falcons = home in Atlanta)
    // Pool's homeTeam/awayTeam are just labels that may not match ESPN's designation
    // If reversed, we need to swap all scores before processing
    const needsSwap = shouldSwapHomeAway(
        freshPool,
        espnScores.homeTeamName || '',
        espnScores.awayTeamName || ''
    );

    if (needsSwap) {
        console.log(`[ScoreSync] Team order mismatch detected for pool ${doc.id}. ESPN: ${espnScores.homeTeamName}(H) vs ${espnScores.awayTeamName}(A), Pool: ${freshPool.homeTeam}(H) vs ${freshPool.awayTeam}(A). Swapping scores.`);
        espnScores.current = swapScores(espnScores.current);
        espnScores.q1 = swapScores(espnScores.q1);
        espnScores.half = swapScores(espnScores.half);
        espnScores.q3 = swapScores(espnScores.q3);
        espnScores.final = swapScores(espnScores.final);
        espnScores.apiTotal = swapScores(espnScores.apiTotal);
    }
    // ============ END: Team orientation correction ============

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

    // Live Score Update Logging & Decomposed Events
    const freshCurrent = freshPool.scores?.current || { home: 0, away: 0 };
    const newCurrent = espnScores.current || { home: 0, away: 0 };

    // Calculate Deltas
    const deltaHome = newCurrent.home - freshCurrent.home;
    const deltaAway = newCurrent.away - freshCurrent.away;

    // Check if score changed
    if (deltaHome !== 0 || deltaAway !== 0) {

        // Prepare list of sequential score states to process
        // Each entry is { home: number, away: number, type: 'TD' | 'XP' | 'FG' | 'SAFETY' | 'OTHER' }
        const steps: { home: number; away: number; desc: string }[] = [];

        const combine = freshPool.ruleVariations?.combineTDandXP === true;

        // Helper function to decompose scoring for a single team
        const decomposeScoring = (
            delta: number,
            scoringTeam: 'home' | 'away',
            currentHome: number,
            currentAway: number
        ): { home: number; away: number; desc: string }[] => {
            const result: { home: number; away: number; desc: string }[] = [];

            if (delta <= 0) return result;

            // Decompose based on common football scoring patterns
            let remaining = delta;
            let runningHome = currentHome;
            let runningAway = currentAway;

            while (remaining > 0) {
                let points = 0;
                let desc = '';

                // Check for TD+XP (7) or TD+2PT (8) combos
                if (!combine && remaining >= 7) {
                    // TD (6 points)
                    points = 6;
                    desc = 'Touchdown';
                    if (scoringTeam === 'home') {
                        result.push({ home: runningHome + points, away: runningAway, desc });
                        runningHome += points;
                    } else {
                        result.push({ home: runningHome, away: runningAway + points, desc });
                        runningAway += points;
                    }
                    remaining -= points;

                    // Now check for XP or 2PT
                    if (remaining >= 2) {
                        points = 2;
                        desc = '2Pt Conv';
                    } else if (remaining >= 1) {
                        points = 1;
                        desc = 'Extra Point';
                    } else {
                        continue;
                    }
                } else if (remaining === 6) {
                    points = 6;
                    desc = 'Touchdown';
                } else if (remaining === 3) {
                    points = 3;
                    desc = 'Field Goal';
                } else if (remaining === 2) {
                    points = 2;
                    desc = 'Safety';
                } else if (remaining === 1) {
                    points = 1;
                    desc = 'Extra Point';
                } else {
                    // Unknown pattern - just record the remaining as one event
                    points = remaining;
                    desc = 'Score Change';
                }

                if (scoringTeam === 'home') {
                    result.push({ home: runningHome + points, away: runningAway, desc });
                    runningHome += points;
                } else {
                    result.push({ home: runningHome, away: runningAway + points, desc });
                    runningAway += points;
                }
                remaining -= points;
            }

            return result;
        };

        // Process HOME scoring first, then AWAY scoring
        // This ensures we capture all events even when both teams score in the same window
        let runningHome = freshCurrent.home;
        let runningAway = freshCurrent.away;

        if (deltaHome > 0) {
            const homeSteps = decomposeScoring(deltaHome, 'home', runningHome, runningAway);
            for (const step of homeSteps) {
                steps.push(step);
                runningHome = step.home;
            }
        }

        if (deltaAway > 0) {
            const awaySteps = decomposeScoring(deltaAway, 'away', runningHome, runningAway);
            for (const step of awaySteps) {
                steps.push(step);
                runningAway = step.away;
            }
        }

        // Handle negative corrections (score went down - rare but possible)
        if (deltaHome < 0 || deltaAway < 0) {
            steps.push({ home: newCurrent.home, away: newCurrent.away, desc: 'Score Correction' });
        }

        // If no steps were generated but score changed, add a fallback
        if (steps.length === 0 && (deltaHome !== 0 || deltaAway !== 0)) {
            steps.push({ home: newCurrent.home, away: newCurrent.away, desc: 'Score Change' });
        }

        // DEDUPE PRE-READ: Identify all keys we need to check
        const dedupeChecks: string[] = [];
        for (const step of steps) {
            dedupeChecks.push(`SCORE_STEP:${doc.id}:${step.home}:${step.away}`);
            if (freshPool.ruleVariations?.scoreChangePayout) {
                dedupeChecks.push(`WINNER_EVENT:${doc.id}:${step.home}:${step.away}`);
            }
        }

        // Perform READS (must be before any writes in the loop)
        const existingDedupes = new Set<string>();
        if (dedupeChecks.length > 0) {
            const refs = dedupeChecks.map(k => db.collection("pools").doc(doc.id).collection("audit_dedupe").doc(k));
            const snaps = await transaction.getAll(...refs);
            snaps.forEach(s => { if (s.exists) existingDedupes.add(s.id); });
        }

        // --- PROCESS SEQUENCE ---
        for (const step of steps) {
            const stepQText = state === 'pre' ? 'Pre' : period + (period === 1 ? 'st' : period === 2 ? 'nd' : period === 3 ? 'rd' : 'th');
            const scoreKey = `SCORE_STEP:${doc.id}:${step.home}:${step.away}`;

            if (existingDedupes.has(scoreKey)) continue;

            // 1. Log Score Change Audit
            // Use forceWriteDedupe to skip the read check inside writeAuditEvent
            await writeAuditEvent({
                poolId: doc.id,
                type: 'SCORE_FINALIZED',
                message: `${step.desc}: ${step.home}-${step.away} (${stepQText})`,
                severity: 'INFO',
                actor: actor,
                payload: { home: step.home, away: step.away, clock: espnScores.clock || "0:00" },
                dedupeKey: scoreKey,
                forceWriteDedupe: true
            }, transaction);

            // 2. Add to Score History
            const newEvent = {
                id: db.collection("_").doc().id,
                home: step.home,
                away: step.away,
                description: `${step.desc} (${state === 'pre' ? 'Pre' : 'Q' + period})`,
                timestamp: Date.now()
            };
            transactionUpdates.scoreEvents = admin.firestore.FieldValue.arrayUnion(newEvent);
            shouldUpdate = true;

            // 3. Handle "Score Change Payouts"
            if (freshPool.ruleVariations?.scoreChangePayout) {
                const winnerKey = `WINNER_EVENT:${doc.id}:${step.home}:${step.away}`;

                if (existingDedupes.has(winnerKey)) continue;

                const hDigit = getLastDigit(step.home);
                const aDigit = getLastDigit(step.away);
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
                            message: `Event Winner: ${winnerName} (${step.home}-${step.away})`,
                            severity: 'INFO',
                            actor: actor,
                            payload: {
                                period: 'Event',
                                homeScore: step.home,
                                awayScore: step.away,
                                homeDigit: hDigit,
                                awayDigit: aDigit,
                                winner: winnerName,
                                squareId: squareIndex
                            },
                            dedupeKey: winnerKey,
                            forceWriteDedupe: true
                        }, transaction);

                        const winnerDoc: Winner = {
                            period: 'Event',
                            squareId: squareIndex,
                            owner: winnerName,
                            amount: 0,
                            homeDigit: hDigit,
                            awayDigit: aDigit,
                            isReverse: false,
                            description: `${step.desc} (${step.home}-${step.away})`
                        };
                        transaction.set(
                            db.collection('pools').doc(doc.id).collection('winners').doc(`event_${step.home}_${step.away}`),
                            winnerDoc
                        );
                    }
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

    // Fix: Only process winners if we JUST finalized it (it wasn't in freshPool)
    // This prevents re-running winner logic on every sync

    if (isQ1Final && q1H !== undefined && !freshPool.scores?.q1) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
            actor: actor, payload: { period: 1, score: { home: q1H, away: q1A } }
            // Dedupe skipped safe here because we guarded with !freshPool.scores.q1
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q1', q1H, q1A, true);
    }

    if (isHalfFinal && halfH !== undefined && !freshPool.scores?.half) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
            actor: actor, payload: { period: 2, score: { home: halfH, away: halfA } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'half', halfH, halfA, true);
    }

    if (isQ3Final && q3H !== undefined && !freshPool.scores?.q3) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
            actor: actor, payload: { period: 3, score: { home: q3H, away: q3A } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q3', q3H, q3A, true);
    }

    if (isGameFinal && finalH !== undefined && !freshPool.scores?.final) {
        await writeAuditEvent({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Game Finalized: ${finalH}-${finalA}`, severity: 'INFO',
            actor: actor, payload: { period: 4, score: { home: finalH, away: finalA } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'final', finalH, finalA, true);
    }

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
    const strategy = pool.ruleVariations?.scoreChangePayoutStrategy || 'equal_split';

    if (strategy === 'equal_split') {
        scoreChangePot = totalPot;
    } else {
        // Hybrid
        const weights = pool.ruleVariations?.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 };
        const remainingPct = 100 - weights.final - weights.halftime;
        scoreChangePot = (totalPot * remainingPct) / 100;
    }

    // 2. Query ALL Event Winners from Subcollection (more reliable than scoreEvents array)
    const winnersRef = db.collection('pools').doc(poolId).collection('winners');
    const winnersSnap = await transaction.get(winnersRef);

    // Filter to only 'Event' period winners (exclude q1, half, q3, final)
    const eventWinners = winnersSnap.docs.filter(doc => {
        const data = doc.data();
        return data.period === 'Event';
    });

    // 3. Calculate Amount Per Event
    const eventCount = eventWinners.length;
    const amountPerEvent = eventCount > 0 ? (scoreChangePot / eventCount) : 0;

    console.log(`[FinalizePayouts] Pool ${poolId}: ${eventCount} events, $${totalPot} pot, $${amountPerEvent.toFixed(2)} per event`);

    // 4. Update Winner Docs
    let updatedCount = 0;

    for (const winnerDoc of eventWinners) {
        const currentData = winnerDoc.data();
        // Only update if amount is different (to avoid unnecessary writes)
        if (currentData.amount !== amountPerEvent) {
            transaction.update(winnerDoc.ref, { amount: amountPerEvent });
            updatedCount++;
        }
    }

    // 5. Log Action
    if (updatedCount > 0 || eventCount > 0) {
        await writeAuditEvent({
            poolId: poolId,
            type: 'WINNER_COMPUTED',
            message: `Finalized Event Payouts: $${amountPerEvent.toFixed(2)} per event (${eventCount} total events, ${updatedCount} updated)`,
            severity: 'INFO',
            actor: actor,
            payload: {
                totalPot,
                scoreChangePot,
                eventCount,
                amountPerEvent,
                updatedCount
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
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    try {
        // 1. Fetch Active Pools
        const poolsSnap = await db.collection("pools")
            .where("scores.gameStatus", "!=", "post")
            .get();

        if (poolsSnap.empty) {
            await db.collection('system_logs').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'SYNC_GAME_STATUS',
                status: 'idle',
                message: 'No active pools found',
                durationMs: Date.now() - startTime
            });
            return;
        }

        // 2. Process Each Pool
        for (const doc of poolsSnap.docs) {
            const pool = doc.data() as GameState;

            if (!pool.gameId) continue;

            // Optimization: Skip if game hasn't started yet and start time is > 2 hours away
            if (!pool.isLocked && pool.scores?.gameStatus === 'pre') {
                const now = Date.now();
                // Safe handling of startTime
                const start = pool.scores.startTime ? new Date(pool.scores.startTime).getTime() : 0;
                if (start > now + 2 * 60 * 60 * 1000) continue;
            }

            try {
                const espnScores = await fetchESPNScores(pool.gameId, (pool as any).league || 'nfl');
                if (!espnScores) {
                    console.warn(`[Sync] Failed to fetch scores for pool ${doc.id}`);
                    await db.collection('system_logs').add({
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        type: 'ESPN_FETCH_FAIL',
                        status: 'error',
                        message: `Failed to fetch valid scores for pool ${doc.id} (GameID: ${pool.gameId})`,
                        details: { poolId: doc.id, gameId: pool.gameId }
                    });
                    errorCount++;
                    continue;
                }

                await db.runTransaction(async (transaction) => {
                    const freshDoc = await transaction.get(doc.ref);
                    if (!freshDoc.exists) return;
                    await processGameUpdate(
                        transaction,
                        freshDoc,
                        espnScores,
                        { uid: 'system', role: 'SYSTEM' }
                    );
                });

                // Log Successful Fetch & Process
                await db.collection('system_logs').add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'ESPN_FETCH_SUCCESS',
                    status: 'success',
                    message: `Fetched ESPN scores for Game ${pool.gameId} (Pool ${doc.id})`,
                    details: {
                        poolId: doc.id,
                        gameId: pool.gameId,
                        currentScore: espnScores.current,
                        period: espnScores.period,
                        clock: espnScores.clock
                    }
                });
                processedCount++;
            } catch (e: any) {
                console.error(`Error processing pool ${doc.id}:`, e);
                await db.collection('system_logs').add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'POOL_SYNC_ERROR',
                    status: 'error',
                    message: `Error syncing pool ${doc.id}: ${e.message}`,
                    details: { poolId: doc.id, error: e.message }
                });
                errorCount++;
            }
        }

        // 3. Log Execution Summary
        await db.collection('system_logs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'SYNC_GAME_STATUS',
            status: errorCount > 0 ? 'partial' : 'success',
            message: `Score Sync Cycle Completed: ${processedCount}/${poolsSnap.size} pools processed.`,
            details: {
                activePoolsFound: poolsSnap.size,
                poolsProcessed: processedCount,
                errors: errorCount
            },
            durationMs: Date.now() - startTime
        });

    } catch (globalError: any) {
        console.error("Critical Sync Failure:", globalError);
        await db.collection('system_logs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'SYNC_GAME_STATUS',
            status: 'critical_error',
            message: globalError.message || 'Unknown error',
            durationMs: Date.now() - startTime
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
    timeoutSeconds: 300,
    memory: "512MiB"
}, async (request) => {
    // Check Authentication (Admin Only)
    if (request.auth?.token.role !== 'SUPER_ADMIN' && request.auth?.token.email !== 'kstruck@gmail.com') {
        if (request.auth?.token.role !== 'SUPER_ADMIN') {
            throw new HttpsError('permission-denied', 'Must be Super Admin');
        }
    }

    const db = admin.firestore();
    const targetPoolId = request.data?.poolId;
    let poolsSnap;

    if (targetPoolId) {
        // Targeted Fix
        console.log(`[FixPool] Targeting single pool: ${targetPoolId}`);
        const docSnap = await db.collection("pools").doc(targetPoolId).get();
        if (!docSnap.exists) return { success: false, message: 'Pool not found' };
        poolsSnap = { docs: [docSnap], size: 1 };
    } else {
        // Global Fix
        console.log(`[FixPool] Running Global Fix...`);
        poolsSnap = await db.collection("pools")
            .where("scores.gameStatus", "in", ["in", "post"])
            .get();
    }

    const results: any[] = [];

    for (const doc of poolsSnap.docs) {
        try {
            const pool = doc.data() as GameState;
            if (!pool.gameId) continue;

            const espnScores = await fetchESPNScores(pool.gameId, (pool as any).league || 'nfl');
            if (!espnScores) {
                results.push({ id: doc.id, status: 'error', reason: 'ESPN fetch failed' });
                continue;
            }

            const state = espnScores.gameStatus;
            const period = espnScores.period;
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

            // Run as Transaction
            await db.runTransaction(async (t) => {
                t.update(doc.ref, updates);

                // Construct effective pool
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

                // SKIP QUARTER WINNERS IF "EQUAL SPLIT" IS ACTIVE
                const isEqualSplit = pool.ruleVariations?.scoreChangePayout && pool.ruleVariations?.scoreChangePayoutStrategy === 'equal_split';

                if (!isEqualSplit) {
                    if (isQ1Final && q1H !== undefined) await processWinners(t, db, doc.id, effectivePool, 'q1', q1H, q1A);
                    if (isHalfFinal && halfH !== undefined) await processWinners(t, db, doc.id, effectivePool, 'half', halfH, halfA);
                    if (isQ3Final && q3H !== undefined) await processWinners(t, db, doc.id, effectivePool, 'q3', q3H, q3A);
                    if (isGameFinal && finalH !== undefined) await processWinners(t, db, doc.id, effectivePool, 'final', finalH, finalA);
                }

                // BACKFILL LOGIC
                let currentScoreEvents = pool.scoreEvents || [];

                if (pool.ruleVariations?.scoreChangePayout) {
                    const existingEvents = [...currentScoreEvents];
                    existingEvents.sort((a, b) => a.timestamp - b.timestamp);

                    const lastRecorded = existingEvents.length > 0 ? existingEvents[existingEvents.length - 1] : { home: 0, away: 0 };
                    if (lastRecorded.home !== espnScores.current.home || lastRecorded.away !== espnScores.current.away) {
                        console.log(`[FixPool] Appending missing tail score: ${espnScores.current.home}-${espnScores.current.away}`);
                        existingEvents.push({
                            id: db.collection("_").doc().id,
                            home: espnScores.current.home,
                            away: espnScores.current.away,
                            description: 'Score Update (Synced)',
                            timestamp: Date.now()
                        });
                    }

                    const newEventHistory: any[] = [];
                    let lastScore = { home: 0, away: 0 };
                    let repairsMade = false;

                    const ensureWinner = async (home: number, away: number, desc: string, timestamp: number) => {
                        const hDigit = getLastDigit(home);
                        const aDigit = getLastDigit(away);
                        let axis = pool.axisNumbers;

                        if (pool.numberSets === 4 && pool.quarterlyNumbers?.q1) {
                            axis = pool.quarterlyNumbers.q1;
                        }

                        if (axis?.home && axis?.away) {
                            const row = axis.away.indexOf(aDigit);
                            const col = axis.home.indexOf(hDigit);
                            if (row !== -1 && col !== -1) {
                                const sqIdx = row * 10 + col;
                                const square = pool.squares ? pool.squares[sqIdx] : null;
                                const winnerName = square?.owner || 'Unsold';
                                const docId = `event_${home}_${away}`;

                                // Calculate Amount
                                let amount = 0;
                                if (pool.scoreChangePayoutAmount && pool.scoreChangePayoutAmount > 0) {
                                    amount = pool.scoreChangePayoutAmount;
                                }

                                await t.set(db.collection('pools').doc(doc.id).collection('winners').doc(docId), {
                                    period: 'Event',
                                    squareId: sqIdx,
                                    owner: winnerName,
                                    amount: amount,
                                    homeDigit: hDigit,
                                    awayDigit: aDigit,
                                    isReverse: false,
                                    description: desc || 'Score Change',
                                    timestamp: timestamp
                                }, { merge: true });
                            }
                        }
                    };

                    for (const ev of existingEvents) {
                        const deltaHome = ev.home - lastScore.home;
                        const deltaAway = ev.away - lastScore.away;
                        const combine = pool.ruleVariations?.combineTDandXP === true;

                        if (!combine && deltaHome === 7 && deltaAway === 0) {
                            const tdScore = { home: lastScore.home + 6, away: lastScore.away };
                            const missingEvent = {
                                id: db.collection("_").doc().id,
                                home: tdScore.home,
                                away: tdScore.away,
                                description: 'Touchdown (Repaired)',
                                timestamp: ev.timestamp - 1000
                            };
                            newEventHistory.push(missingEvent);
                            await ensureWinner(tdScore.home, tdScore.away, 'Touchdown (Repaired)', missingEvent.timestamp);
                            repairsMade = true;

                            await writeAuditEvent({
                                poolId: doc.id,
                                type: 'ADMIN_OVERRIDE_SCORE',
                                message: `Repaired Missing Event: 6-pt TD (${tdScore.home}-${tdScore.away})`,
                                severity: 'WARNING',
                                actor: { uid: 'system', role: 'ADMIN' }
                            }, t);
                        } else if (!combine && deltaAway === 7 && deltaHome === 0) {
                            const tdScore = { home: lastScore.home, away: lastScore.away + 6 };
                            const missingEvent = {
                                id: db.collection("_").doc().id,
                                home: tdScore.home,
                                away: tdScore.away,
                                description: 'Touchdown (Repaired)',
                                timestamp: ev.timestamp - 1000
                            };
                            newEventHistory.push(missingEvent);
                            await ensureWinner(tdScore.home, tdScore.away, 'Touchdown (Repaired)', missingEvent.timestamp);
                            repairsMade = true;

                            await writeAuditEvent({
                                poolId: doc.id,
                                type: 'ADMIN_OVERRIDE_SCORE',
                                message: `Repaired Missing Event: 6-pt TD (${tdScore.home}-${tdScore.away})`,
                                severity: 'WARNING',
                                actor: { uid: 'system', role: 'ADMIN' }
                            }, t);
                        }

                        newEventHistory.push(ev);
                        await ensureWinner(ev.home, ev.away, ev.description || 'Score Update', ev.timestamp);
                        lastScore = { home: ev.home, away: ev.away };
                    }

                    if (repairsMade) {
                        updates.scoreEvents = newEventHistory;
                        currentScoreEvents = newEventHistory; // For finalization
                        t.update(doc.ref, { scoreEvents: newEventHistory });
                    }

                    if (isGameFinal) {
                        const poolForPayouts = { ...effectivePool, scoreEvents: currentScoreEvents };
                        await finalizeEventPayouts(t, db, doc.id, poolForPayouts, { uid: 'admin', role: 'ADMIN', label: 'Fix Payouts' });
                    }
                }

                await writeAuditEvent({
                    poolId: doc.id,
                    type: 'SCORE_FINALIZED',
                    message: `Manual Score Fix Applied by Admin`,
                    severity: 'INFO',
                    actor: { uid: 'system', role: 'ADMIN' }
                }, t);
            });

            results.push({
                id: doc.id,
                name: `${pool.homeTeam} vs ${pool.awayTeam}`,
                status: 'fixed',
                scores: updates
            });

        } catch (error: any) {
            console.error(`Error processing pool ${doc.id}:`, error);
            results.push({ id: doc.id, status: 'error', reason: error.message });
        }
    }

    return { success: true, pools: results };
});
