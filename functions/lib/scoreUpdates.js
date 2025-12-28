"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixPoolScores = exports.simulateGameUpdate = exports.syncGameStatus = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const audit_1 = require("./audit");
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
// Helper to safely parse integers
const safeInt = (val) => {
    if (val === null || val === undefined)
        return 0;
    const parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
};
const getPeriodScore = (lines, period) => {
    var _a, _b;
    let val;
    // Try finding by period property
    const found = lines.find((l) => l.period == period);
    if (found) {
        val = (_a = found.value) !== null && _a !== void 0 ? _a : found.displayValue;
    }
    else {
        // Fallback to index
        const indexed = lines[period - 1];
        if (indexed)
            val = (_b = indexed.value) !== null && _b !== void 0 ? _b : indexed.displayValue;
    }
    return safeInt(val);
};
// Helper to safely parse payout
const getSafePayout = (payouts, key) => {
    if (!payouts)
        return 0;
    const val = payouts[key];
    return typeof val === 'number' ? val : Number(val) || 0;
};
// Helper: Get last digit for squares logic
const getLastDigit = (n) => Math.abs(n) % 10;
// Fetch and calculate scores from ESPN API
async function fetchESPNScores(gameId, league) {
    var _a, _b, _c;
    try {
        const leaguePath = league === 'college' || league === 'ncaa' ? 'college-football' : 'nfl';
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${gameId}`;
        const resp = await fetch(url);
        if (!resp.ok)
            return null;
        const data = await resp.json();
        if (!((_b = (_a = data.header) === null || _a === void 0 ? void 0 : _a.competitions) === null || _b === void 0 ? void 0 : _b[0]))
            return null;
        const competition = data.header.competitions[0];
        const status = data.header.status || competition.status;
        const competitors = competition.competitors;
        const homeComp = competitors.find((c) => c.homeAway === 'home');
        const awayComp = competitors.find((c) => c.homeAway === 'away');
        if (!homeComp || !awayComp)
            return null;
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
        const state = ((_c = status.type) === null || _c === void 0 ? void 0 : _c.state) || 'pre';
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
    }
    catch (e) {
        console.error('ESPN fetch failed:', e);
        return null;
    }
}
// Helper to handle winner logging and computation (Shared between sync and fix)
const processWinners = async (transaction, db, poolId, poolData, periodKey, homeScore, awayScore, skipDedupe = false) => {
    var _a, _b, _c, _d;
    // Safety check for axis numbers
    if (!poolData.axisNumbers || !poolData.axisNumbers.home || !poolData.axisNumbers.away)
        return;
    // Dedupe check handled by writeAuditEvent keys
    const hDigit = getLastDigit(homeScore);
    const aDigit = getLastDigit(awayScore);
    const soldSquares = poolData.squares ? poolData.squares.filter((s) => s.owner).length : 0;
    const totalPot = soldSquares * (poolData.costPerSquare || 0);
    // Process Payout Amount
    if (((_a = poolData.ruleVariations) === null || _a === void 0 ? void 0 : _a.scoreChangePayout) && ((_b = poolData.ruleVariations) === null || _b === void 0 ? void 0 : _b.scoreChangePayoutStrategy) === 'equal_split') {
        console.log(`[ScoreSync] Skipping Period Winner for Equal Split Pool ${poolId}`);
        return;
    }
    const payoutPct = getSafePayout(poolData.payouts, periodKey);
    let amount = (totalPot * payoutPct) / 100;
    if ((_c = poolData.ruleVariations) === null || _c === void 0 ? void 0 : _c.reverseWinners)
        amount /= 2;
    const label = periodKey === 'q1' ? 'Q1' : periodKey === 'half' ? 'Halftime' : periodKey === 'q3' ? 'Q3' : 'Final';
    const axis = poolData.axisNumbers;
    if (axis) {
        const row = axis.away.indexOf(aDigit);
        const col = axis.home.indexOf(hDigit);
        if (row !== -1 && col !== -1) {
            const squareIndex = row * 10 + col;
            const square = poolData.squares[squareIndex];
            const winnerName = (square === null || square === void 0 ? void 0 : square.owner) || 'Unsold';
            await (0, audit_1.writeAuditEvent)(Object.assign({ poolId: poolId, type: 'WINNER_COMPUTED', message: `${label} Winner: ${winnerName} (Home ${hDigit}, Away ${aDigit})`, severity: 'INFO', actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' }, payload: { period: label, homeScore, awayScore, homeDigit: hDigit, awayDigit: aDigit, winner: winnerName, squareId: squareIndex, amount } }, (skipDedupe ? {} : { dedupeKey: `WINNER:${poolId}:${periodKey}:${hDigit}:${aDigit}` })), transaction);
            const winnerDoc = {
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
        if ((_d = poolData.ruleVariations) === null || _d === void 0 ? void 0 : _d.reverseWinners) {
            const rRow = axis.away.indexOf(hDigit);
            const rCol = axis.home.indexOf(aDigit);
            if (rRow !== -1 && rCol !== -1) {
                const rSqIndex = rRow * 10 + rCol;
                // Regular winner index (if valid)
                const regularIndex = (row !== -1 && col !== -1) ? (row * 10 + col) : -999;
                if (rSqIndex !== regularIndex) {
                    const rSquare = poolData.squares[rSqIndex];
                    const rWinnerName = (rSquare === null || rSquare === void 0 ? void 0 : rSquare.owner) || 'Unsold';
                    await (0, audit_1.writeAuditEvent)(Object.assign({ poolId: poolId, type: 'WINNER_COMPUTED', message: `${label} Reverse Winner: ${rWinnerName}`, severity: 'INFO', actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' }, payload: { period: label, type: 'REVERSE', winner: rWinnerName, squareId: rSqIndex, amount: amount } }, (skipDedupe ? {} : { dedupeKey: `WINNER_REV:${poolId}:${periodKey}:${hDigit}:${aDigit}` })), transaction);
                }
            }
        }
    }
};
/**
 * Core logic to update a single pool based on new scores.
 */
const processGameUpdate = async (transaction, doc, espnScores, actor, overrides) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    const db = admin.firestore();
    const freshPool = Object.assign(Object.assign({}, doc.data()), overrides);
    if (!espnScores)
        return;
    const period = espnScores.period;
    const state = espnScores.gameStatus;
    const isQ1Final = (period >= 2) || (state === "post");
    const isHalfFinal = (period >= 3) || (state === "post");
    const isQ3Final = (period >= 4) || (state === "post");
    const isGameFinal = (state === "post");
    // Prepare New Scores Object
    const newScores = Object.assign(Object.assign({}, freshPool.scores), { current: espnScores.current, gameStatus: state, period: period, clock: espnScores.clock, startTime: espnScores.startTime || freshPool.scores.startTime });
    if (isQ1Final && !((_a = freshPool.scores) === null || _a === void 0 ? void 0 : _a.q1))
        newScores.q1 = espnScores.q1;
    if (isHalfFinal && !((_b = freshPool.scores) === null || _b === void 0 ? void 0 : _b.half))
        newScores.half = espnScores.half;
    if (isQ3Final && !((_c = freshPool.scores) === null || _c === void 0 ? void 0 : _c.q3))
        newScores.q3 = espnScores.q3;
    if (isGameFinal && !((_d = freshPool.scores) === null || _d === void 0 ? void 0 : _d.final)) {
        newScores.final = (freshPool.includeOvertime && espnScores.apiTotal !== undefined)
            ? espnScores.apiTotal
            : (espnScores.final || espnScores.current);
    }
    let transactionUpdates = {};
    let shouldUpdate = false;
    const currentScoresStr = JSON.stringify(freshPool.scores);
    const newScoresStr = JSON.stringify(newScores);
    if (currentScoresStr !== newScoresStr) {
        transactionUpdates.scores = newScores;
        shouldUpdate = true;
    }
    // Live Score Update Logging & Decomposed Events
    const freshCurrent = ((_e = freshPool.scores) === null || _e === void 0 ? void 0 : _e.current) || { home: 0, away: 0 };
    const newCurrent = espnScores.current || { home: 0, away: 0 };
    // Calculate Deltas
    const deltaHome = newCurrent.home - freshCurrent.home;
    const deltaAway = newCurrent.away - freshCurrent.away;
    // Check if score changed
    if (deltaHome !== 0 || deltaAway !== 0) {
        // Prepare list of sequential score states to process
        // Each entry is { home: number, away: number, type: 'TD' | 'XP' | 'FG' | 'SAFETY' | 'OTHER' }
        const steps = [];
        const combine = ((_f = freshPool.ruleVariations) === null || _f === void 0 ? void 0 : _f.combineTDandXP) === true;
        // Helper to push steps for a single side scoring
        // Note: This simple logic assumes only ONE team scores at a time in a single poll interval.
        // If both change (rare in 5 min interval but possible), we just process final.
        // A more robust way is to handle Home change then Away change sequentially.
        // HOME SCORING lookup
        if (deltaHome > 0 && deltaAway === 0) {
            if (!combine && deltaHome === 7) {
                // TD (6) then XP (1)
                steps.push({ home: freshCurrent.home + 6, away: freshCurrent.away, desc: 'Touchdown' });
                steps.push({ home: freshCurrent.home + 7, away: freshCurrent.away, desc: 'Extra Point' });
            }
            else if (!combine && deltaHome === 8) {
                // TD (6) then 2Pt (2)
                steps.push({ home: freshCurrent.home + 6, away: freshCurrent.away, desc: 'Touchdown' });
                steps.push({ home: freshCurrent.home + 8, away: freshCurrent.away, desc: '2Pt Conv' });
            }
            else {
                steps.push({ home: newCurrent.home, away: newCurrent.away, desc: 'Score Change' });
            }
        }
        // AWAY SCORING lookup
        else if (deltaAway > 0 && deltaHome === 0) {
            if (!combine && deltaAway === 7) {
                steps.push({ home: freshCurrent.home, away: freshCurrent.away + 6, desc: 'Touchdown' });
                steps.push({ home: freshCurrent.home, away: freshCurrent.away + 7, desc: 'Extra Point' });
            }
            else if (!combine && deltaAway === 8) {
                steps.push({ home: freshCurrent.home, away: freshCurrent.away + 6, desc: 'Touchdown' });
                steps.push({ home: freshCurrent.home, away: freshCurrent.away + 8, desc: '2Pt Conv' });
            }
            else {
                steps.push({ home: newCurrent.home, away: newCurrent.away, desc: 'Score Change' });
            }
        }
        // BOTH scored or negative correction (just take final)
        else {
            steps.push({ home: newCurrent.home, away: newCurrent.away, desc: 'Score Change' });
        }
        // --- PROCESS SEQUENCE ---
        for (const step of steps) {
            const stepQText = state === 'pre' ? 'Pre' : period + (period === 1 ? 'st' : period === 2 ? 'nd' : period === 3 ? 'rd' : 'th');
            // 1. Log Score Change Audit
            // Only log the "Main" update on the final step? Or all? User wants "Each score accounted for".
            // We will log unique audit events for each step.
            await (0, audit_1.writeAuditEvent)({
                poolId: doc.id,
                type: 'SCORE_FINALIZED',
                message: `${step.desc}: ${step.home}-${step.away} (${stepQText})`,
                severity: 'INFO',
                actor: actor,
                payload: { home: step.home, away: step.away, clock: espnScores.clock || "0:00" },
                dedupeKey: `SCORE_STEP:${doc.id}:${step.home}:${step.away}`
            }, transaction);
            // 2. Add to Score History (scoreEvents)
            const newEvent = {
                id: db.collection("_").doc().id,
                home: step.home,
                away: step.away,
                description: `${step.desc} (${state === 'pre' ? 'Pre' : 'Q' + period})`,
                timestamp: Date.now()
            };
            transactionUpdates.scoreEvents = admin.firestore.FieldValue.arrayUnion(newEvent);
            shouldUpdate = true;
            // 3. Handle "Score Change Payouts" (Event Winners)
            if ((_g = freshPool.ruleVariations) === null || _g === void 0 ? void 0 : _g.scoreChangePayout) {
                const hDigit = getLastDigit(step.home);
                const aDigit = getLastDigit(step.away);
                const axis = freshPool.axisNumbers;
                if (axis) {
                    const row = axis.away.indexOf(aDigit);
                    const col = axis.home.indexOf(hDigit);
                    if (row !== -1 && col !== -1) {
                        const squareIndex = row * 10 + col;
                        const square = freshPool.squares[squareIndex];
                        const winnerName = (square === null || square === void 0 ? void 0 : square.owner) || 'Unsold';
                        await (0, audit_1.writeAuditEvent)({
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
                            dedupeKey: `WINNER_EVENT:${doc.id}:${step.home}:${step.away}`
                        }, transaction);
                        // PERSIST WINNER TO COLLECTION
                        // Use unique ID for event document so they don't overwrite if same digits! (e.g. 0-6 and 10-6)
                        // Actually the requirement is "Each score must determine a winner".
                        // Previous ID was `event_${home}_${away}` which IS unique for the score combo.
                        const winnerDoc = {
                            period: 'Event',
                            squareId: squareIndex,
                            owner: winnerName,
                            amount: 0, // Calculated at end of game
                            homeDigit: hDigit,
                            awayDigit: aDigit,
                            isReverse: false,
                            description: `${step.desc} (${step.home}-${step.away})`
                        };
                        transaction.set(db.collection('pools').doc(doc.id).collection('winners').doc(`event_${step.home}_${step.away}`), winnerDoc);
                    }
                }
            }
        }
    }
    if (freshPool.numberSets === 4) {
        let qNums = freshPool.quarterlyNumbers || {};
        let numsUpdated = false;
        const handleGen = async (pKey) => {
            const newAxis = generateAxisNumbers();
            qNums[pKey] = newAxis;
            numsUpdated = true;
            const digitsHash = (0, audit_1.computeDigitsHash)({ home: newAxis.home, away: newAxis.away, poolId: doc.id, period: pKey });
            await (0, audit_1.writeAuditEvent)({
                poolId: doc.id,
                type: 'DIGITS_GENERATED',
                message: `${pKey.toUpperCase()} Axis Numbers Generated`,
                severity: 'INFO',
                actor: actor,
                payload: { period: pKey, commitHash: digitsHash }
                // Dedupe skipped to prevent Read-After-Write error
            }, transaction);
        };
        if (isQ1Final && !qNums.q2)
            await handleGen('q2');
        if (isHalfFinal && !qNums.q3)
            await handleGen('q3');
        if (isQ3Final && !qNums.q4)
            await handleGen('q4');
        if (numsUpdated) {
            transactionUpdates.quarterlyNumbers = qNums;
            shouldUpdate = true;
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
    const q1H = (_h = newScores.q1) === null || _h === void 0 ? void 0 : _h.home;
    const q1A = (_j = newScores.q1) === null || _j === void 0 ? void 0 : _j.away;
    const halfH = (_k = newScores.half) === null || _k === void 0 ? void 0 : _k.home;
    const halfA = (_l = newScores.half) === null || _l === void 0 ? void 0 : _l.away;
    const q3H = (_m = newScores.q3) === null || _m === void 0 ? void 0 : _m.home;
    const q3A = (_o = newScores.q3) === null || _o === void 0 ? void 0 : _o.away;
    const finalH = (_p = newScores.final) === null || _p === void 0 ? void 0 : _p.home;
    const finalA = (_q = newScores.final) === null || _q === void 0 ? void 0 : _q.away;
    if (isQ1Final && q1H !== undefined) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
            actor: actor, payload: { period: 1, score: { home: q1H, away: q1A } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q1', q1H, q1A, true);
    }
    if (isHalfFinal && halfH !== undefined) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
            actor: actor, payload: { period: 2, score: { home: halfH, away: halfA } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'half', halfH, halfA, true);
    }
    if (isQ3Final && q3H !== undefined) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
            actor: actor, payload: { period: 3, score: { home: q3H, away: q3A } }
            // Dedupe skipped to prevent Read-After-Write error
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q3', q3H, q3A, true);
    }
    if (isGameFinal && finalH !== undefined) {
        await (0, audit_1.writeAuditEvent)({
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
        transaction.update(doc.ref, Object.assign(Object.assign({}, transactionUpdates), { updatedAt: admin.firestore.Timestamp.now() }));
    }
    // --- EVERY SCORE PAYS FINALIZATION ---
    // If the game just went final, we need to calculate the actual $ amount for each event based on the total pot logic
    if (isGameFinal && ((_r = freshPool.ruleVariations) === null || _r === void 0 ? void 0 : _r.scoreChangePayout)) {
        await finalizeEventPayouts(transaction, db, doc.id, freshPool, actor);
    }
};
// Helper to calculate and backfill amounts for all score events when game is over
const finalizeEventPayouts = async (transaction, db, poolId, pool, actor) => {
    // 1. Calculate Pot Logic
    const soldSquares = pool.squares ? pool.squares.filter((s) => s.owner).length : 0;
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
    }
    else {
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
        const docId = `event-${ev.id}`;
        const winnerRef = db.collection('pools').doc(poolId).collection('winners').doc(docId);
        // We use transaction.set with merge true to update amount
        transaction.set(winnerRef, { amount: amountPerEvent }, { merge: true });
        updatedCount++;
    }
    // 5. Log Action
    if (updatedCount > 0) {
        await (0, audit_1.writeAuditEvent)({
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
exports.syncGameStatus = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    var _a;
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
            const pool = doc.data();
            if (!pool.gameId)
                continue;
            // Optimization: Skip if game hasn't started yet and start time is > 2 hours away
            if (!pool.isLocked && ((_a = pool.scores) === null || _a === void 0 ? void 0 : _a.gameStatus) === 'pre') {
                const now = Date.now();
                const start = new Date(pool.scores.startTime || 0).getTime();
                if (start > now + 2 * 60 * 60 * 1000)
                    continue;
            }
            try {
                const espnScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
                if (!espnScores)
                    continue;
                await db.runTransaction(async (transaction) => {
                    const freshDoc = await transaction.get(doc.ref);
                    if (!freshDoc.exists)
                        return;
                    await processGameUpdate(transaction, freshDoc, espnScores, { uid: 'system', role: 'SYSTEM' });
                });
                processedCount++;
            }
            catch (e) {
                console.error(`Error processing pool ${doc.id}:`, e);
                errorCount++;
            }
        }
        // 3. Log Execution Summary
        await db.collection('system_logs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'SYNC_GAME_STATUS',
            status: errorCount > 0 ? 'partial' : 'success',
            details: {
                activePoolsFound: poolsSnap.size,
                poolsProcessed: processedCount,
                errors: errorCount
            },
            durationMs: Date.now() - startTime
        });
    }
    catch (globalError) {
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
exports.simulateGameUpdate = (0, https_1.onCall)({
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (request) => {
    // Relaxed Auth for Dev/Test - Ensure user is at least authenticated
    if (!request.auth) {
        throw new https_1.HttpsError('permission-denied', 'Authentication required');
    }
    const { poolId, scores } = request.data;
    if (!poolId || !scores) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or scores');
    }
    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);
    try {
        await db.runTransaction(async (transaction) => {
            var _a, _b;
            const doc = await transaction.get(poolRef);
            if (!doc.exists)
                throw new https_1.HttpsError('not-found', 'Pool not found');
            // Ensure Axis Numbers Exist during Simulation
            let overrides = {};
            const poolData = doc.data();
            if (!poolData.axisNumbers) {
                const newAxis = generateAxisNumbers();
                console.log(`[Sim] Generating missing Axis Numbers for pool ${poolId}`);
                transaction.update(poolRef, { axisNumbers: newAxis });
                overrides.axisNumbers = newAxis;
                await (0, audit_1.writeAuditEvent)({
                    poolId: doc.id,
                    type: 'DIGITS_GENERATED',
                    message: `Axis Numbers Auto-Generated for Simulation`,
                    severity: 'INFO',
                    actor: { uid: ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || 'admin', role: 'ADMIN', label: 'Sim Auto-Gen' },
                    payload: { axis: newAxis }
                    // Dedupe skipped to prevent Read-After-Write error
                }, transaction);
            }
            await processGameUpdate(transaction, doc, scores, { uid: ((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid) || 'admin', role: 'ADMIN', label: 'Simulation' }, overrides);
        });
        return { success: true, message: 'Simulation Applied' };
    }
    catch (error) {
        console.error('Simulation Transaction Failed:', error);
        throw new https_1.HttpsError('internal', `Simulation failed: ${error.message}`);
    }
});
// One-time callable function to fix corrupted pool scores AND run winner logic
exports.fixPoolScores = (0, https_1.onCall)({
    timeoutSeconds: 120,
    memory: "256MiB"
}, async (request) => {
    var _a;
    // Only allow super admin
    if (!request.auth || request.auth.token.email !== 'kstruck@gmail.com') {
        throw new https_1.HttpsError('permission-denied', 'Only super admin can run this');
    }
    const db = admin.firestore();
    const results = [];
    const poolsSnap = await db.collection('pools')
        .where('gameId', '!=', null)
        .get();
    for (const doc of poolsSnap.docs) {
        try {
            const pool = doc.data();
            if (!pool.gameId) {
                results.push({ id: doc.id, status: 'skipped', reason: 'no gameId' });
                continue;
            }
            const gameStatus = (_a = pool.scores) === null || _a === void 0 ? void 0 : _a.gameStatus;
            if (gameStatus !== 'in' && gameStatus !== 'post') {
                results.push({ id: doc.id, status: 'skipped', reason: `gameStatus is ${gameStatus}` });
                continue;
            }
            const espnScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
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
            const updates = {
                'scores.current': espnScores.current,
                'scores.gameStatus': state,
                'scores.period': period,
                'scores.clock': espnScores.clock
            };
            if (isQ1Final)
                updates['scores.q1'] = espnScores.q1;
            if (isHalfFinal)
                updates['scores.half'] = espnScores.half;
            if (isQ3Final)
                updates['scores.q3'] = espnScores.q3;
            if (isGameFinal) {
                updates['scores.final'] = pool.includeOvertime ? espnScores.apiTotal : espnScores.final;
            }
            // Run as Transaction
            await db.runTransaction(async (t) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
                t.update(doc.ref, updates);
                // Construct effective pool
                const effectivePool = Object.assign(Object.assign({}, pool), { scores: Object.assign(Object.assign({}, pool.scores), {
                        q1: isQ1Final ? espnScores.q1 : pool.scores.q1,
                        half: isHalfFinal ? espnScores.half : pool.scores.half,
                        q3: isQ3Final ? espnScores.q3 : pool.scores.q3,
                        final: isGameFinal ? (pool.includeOvertime ? espnScores.apiTotal : espnScores.final) : pool.scores.final
                    }) });
                const q1H = (_a = effectivePool.scores.q1) === null || _a === void 0 ? void 0 : _a.home;
                const q1A = (_b = effectivePool.scores.q1) === null || _b === void 0 ? void 0 : _b.away;
                const halfH = (_c = effectivePool.scores.half) === null || _c === void 0 ? void 0 : _c.home;
                const halfA = (_d = effectivePool.scores.half) === null || _d === void 0 ? void 0 : _d.away;
                const q3H = (_e = effectivePool.scores.q3) === null || _e === void 0 ? void 0 : _e.home;
                const q3A = (_f = effectivePool.scores.q3) === null || _f === void 0 ? void 0 : _f.away;
                const finalH = (_g = effectivePool.scores.final) === null || _g === void 0 ? void 0 : _g.home;
                const finalA = (_h = effectivePool.scores.final) === null || _h === void 0 ? void 0 : _h.away;
                // SKIP QUARTER WINNERS IF "EQUAL SPLIT" IS ACTIVE
                // If the user chose "Every Score Pays" -> "Equal Split", there are no quarterly winners.
                // We trust ruleVariations over stale payout percentages.
                const isEqualSplit = ((_j = pool.ruleVariations) === null || _j === void 0 ? void 0 : _j.scoreChangePayout) && ((_k = pool.ruleVariations) === null || _k === void 0 ? void 0 : _k.scoreChangePayoutStrategy) === 'equal_split';
                if (!isEqualSplit) {
                    if (isQ1Final && q1H !== undefined)
                        await processWinners(t, db, doc.id, effectivePool, 'q1', q1H, q1A);
                    if (isHalfFinal && halfH !== undefined)
                        await processWinners(t, db, doc.id, effectivePool, 'half', halfH, halfA);
                    if (isQ3Final && q3H !== undefined)
                        await processWinners(t, db, doc.id, effectivePool, 'q3', q3H, q3A);
                    if (isGameFinal && finalH !== undefined)
                        await processWinners(t, db, doc.id, effectivePool, 'final', finalH, finalA);
                }
                // BACKFILL LOGIC
                let currentScoreEvents = pool.scoreEvents || [];
                if ((_l = pool.ruleVariations) === null || _l === void 0 ? void 0 : _l.scoreChangePayout) {
                    const existingEvents = [...currentScoreEvents];
                    existingEvents.sort((a, b) => a.timestamp - b.timestamp);
                    const newEventHistory = [];
                    let lastScore = { home: 0, away: 0 };
                    let repairsMade = false;
                    const ensureWinner = async (home, away, desc, timestamp) => {
                        var _a;
                        const hDigit = getLastDigit(home);
                        const aDigit = getLastDigit(away);
                        let axis = pool.axisNumbers;
                        if (pool.numberSets === 4 && ((_a = pool.quarterlyNumbers) === null || _a === void 0 ? void 0 : _a.q1)) {
                            axis = pool.quarterlyNumbers.q1;
                        }
                        if ((axis === null || axis === void 0 ? void 0 : axis.home) && (axis === null || axis === void 0 ? void 0 : axis.away)) {
                            const row = axis.away.indexOf(aDigit);
                            const col = axis.home.indexOf(hDigit);
                            if (row !== -1 && col !== -1) {
                                const sqIdx = row * 10 + col;
                                const square = pool.squares ? pool.squares[sqIdx] : null;
                                const winnerName = (square === null || square === void 0 ? void 0 : square.owner) || 'Unsold';
                                const docId = `event_${home}_${away}`;
                                await t.set(db.collection('pools').doc(doc.id).collection('winners').doc(docId), {
                                    period: 'Event',
                                    squareId: sqIdx,
                                    owner: winnerName,
                                    homeDigit: hDigit,
                                    awayDigit: aDigit,
                                    isReverse: false,
                                    description: desc || 'Score Change',
                                    // Preserve existing amount (it will be overwritten by finalizeEventPayouts if final)
                                    // BUT if we create it new, it has no amount.
                                }, { merge: true });
                            }
                        }
                    };
                    for (const ev of existingEvents) {
                        const deltaHome = ev.home - lastScore.home;
                        const deltaAway = ev.away - lastScore.away;
                        const combine = ((_m = pool.ruleVariations) === null || _m === void 0 ? void 0 : _m.combineTDandXP) === true;
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
                            await (0, audit_1.writeAuditEvent)({
                                poolId: doc.id,
                                type: 'ADMIN_OVERRIDE_SCORE',
                                message: `Repaired Missing Event: 6-pt TD (${tdScore.home}-${tdScore.away})`,
                                severity: 'WARNING',
                                actor: { uid: 'system', role: 'ADMIN' }
                            }, t);
                        }
                        else if (!combine && deltaAway === 7 && deltaHome === 0) {
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
                            await (0, audit_1.writeAuditEvent)({
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
                        // Use the updated event history for finalization so new events get paid!
                        const poolForPayouts = Object.assign(Object.assign({}, effectivePool), { scoreEvents: currentScoreEvents });
                        await finalizeEventPayouts(t, db, doc.id, poolForPayouts, { uid: 'admin', role: 'ADMIN', label: 'Fix Payouts' });
                    }
                }
                await (0, audit_1.writeAuditEvent)({
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
        }
        catch (error) {
            console.error(`Error processing pool ${doc.id}:`, error);
            results.push({ id: doc.id, status: 'error', message: error.message });
        }
    }
    return { success: true, pools: results };
});
//# sourceMappingURL=scoreUpdates.js.map