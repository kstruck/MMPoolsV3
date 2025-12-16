"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixPoolScores = exports.syncGameStatus = void 0;
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
exports.syncGameStatus = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    var _a, _b, _c, _d, _e;
    const db = admin.firestore();
    // 1. Fetch Active Pools
    const poolsSnap = await db.collection("pools")
        .where("scores.gameStatus", "!=", "post")
        .get();
    if (poolsSnap.empty)
        return;
    // 2. Process Each Pool
    for (const doc of poolsSnap.docs) {
        const pool = doc.data();
        if (!pool.gameId)
            continue;
        if (!pool.isLocked && ((_a = pool.scores) === null || _a === void 0 ? void 0 : _a.gameStatus) === 'pre') {
            const now = Date.now();
            const start = new Date(pool.scores.startTime || 0).getTime();
            if (start > now + 2 * 60 * 60 * 1000)
                continue;
        }
        const espnScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
        if (!espnScores)
            continue;
        const period = espnScores.period;
        const state = espnScores.gameStatus;
        const isQ1Final = (period >= 2) || (state === "post");
        const isHalfFinal = (period >= 3) || (state === "post");
        const isQ3Final = (period >= 4) || (state === "post");
        const isGameFinal = (state === "post");
        const newScores = Object.assign(Object.assign({}, pool.scores), { current: espnScores.current, gameStatus: state, period: period, clock: espnScores.clock, startTime: espnScores.startTime });
        if (isQ1Final && !((_b = pool.scores) === null || _b === void 0 ? void 0 : _b.q1))
            newScores.q1 = espnScores.q1;
        if (isHalfFinal && !((_c = pool.scores) === null || _c === void 0 ? void 0 : _c.half))
            newScores.half = espnScores.half;
        if (isQ3Final && !((_d = pool.scores) === null || _d === void 0 ? void 0 : _d.q3))
            newScores.q3 = espnScores.q3;
        if (isGameFinal && !((_e = pool.scores) === null || _e === void 0 ? void 0 : _e.final))
            newScores.final = pool.includeOvertime ? espnScores.apiTotal : espnScores.final;
        await db.runTransaction(async (transaction) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const freshDoc = await transaction.get(doc.ref);
            if (!freshDoc.exists)
                return;
            const freshPool = freshDoc.data();
            let transactionUpdates = {};
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
                        actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                        payload: { period: pKey, commitHash: digitsHash },
                        dedupeKey: `DIGITS_GENERATED:${doc.id}:${pKey}:${digitsHash}`
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
            if (shouldUpdate) {
                transaction.update(doc.ref, Object.assign(Object.assign({}, transactionUpdates), { updatedAt: admin.firestore.Timestamp.now() }));
            }
            const handleWinnerLog = async (periodKey, homeScore, awayScore) => {
                var _a, _b;
                if (!freshPool.axisNumbers)
                    return;
                const hDigit = getLastDigit(homeScore);
                const aDigit = getLastDigit(awayScore);
                const soldSquares = freshPool.squares.filter(s => s.owner).length;
                const totalPot = soldSquares * freshPool.costPerSquare;
                const payoutPct = freshPool.payouts[periodKey] || 0;
                let amount = (totalPot * payoutPct) / 100;
                if ((_a = freshPool.ruleVariations) === null || _a === void 0 ? void 0 : _a.reverseWinners)
                    amount /= 2;
                const label = periodKey === 'q1' ? 'Q1' : periodKey === 'half' ? 'Halftime' : periodKey === 'q3' ? 'Q3' : 'Final';
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
                            message: `${label} Winner: ${winnerName} (Home ${hDigit}, Away ${aDigit})`,
                            severity: 'INFO',
                            actor: { uid: 'system', role: 'SYSTEM', label: 'Score Sync' },
                            payload: { period: label, homeScore, awayScore, homeDigit: hDigit, awayDigit: aDigit, winner: winnerName, squareId: squareIndex, amount },
                            dedupeKey: `WINNER:${doc.id}:${periodKey}:${hDigit}:${aDigit}`
                        }, transaction);
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
                        transaction.set(db.collection('pools').doc(doc.id).collection('winners').doc(periodKey), winnerDoc);
                    }
                    if ((_b = freshPool.ruleVariations) === null || _b === void 0 ? void 0 : _b.reverseWinners) {
                        const rRow = axis.away.indexOf(hDigit);
                        const rCol = axis.home.indexOf(aDigit);
                        if (rRow !== -1 && rCol !== -1) {
                            const rSqIndex = rRow * 10 + rCol;
                            if (rSqIndex !== (row * 10 + col)) {
                                const rSquare = freshPool.squares[rSqIndex];
                                const rWinnerName = (rSquare === null || rSquare === void 0 ? void 0 : rSquare.owner) || 'Unsold';
                                await (0, audit_1.writeAuditEvent)({
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
            const q1H = (_a = newScores.q1) === null || _a === void 0 ? void 0 : _a.home;
            const q1A = (_b = newScores.q1) === null || _b === void 0 ? void 0 : _b.away;
            const halfH = (_c = newScores.half) === null || _c === void 0 ? void 0 : _c.home;
            const halfA = (_d = newScores.half) === null || _d === void 0 ? void 0 : _d.away;
            const q3H = (_e = newScores.q3) === null || _e === void 0 ? void 0 : _e.home;
            const q3A = (_f = newScores.q3) === null || _f === void 0 ? void 0 : _f.away;
            const finalH = (_g = newScores.final) === null || _g === void 0 ? void 0 : _g.home;
            const finalA = (_h = newScores.final) === null || _h === void 0 ? void 0 : _h.away;
            if (isQ1Final && q1H !== undefined) {
                await (0, audit_1.writeAuditEvent)({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 1, score: { home: q1H, away: q1A } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:q1`
                }, transaction);
                await handleWinnerLog('q1', q1H, q1A);
            }
            if (isHalfFinal && halfH !== undefined) {
                await (0, audit_1.writeAuditEvent)({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 2, score: { home: halfH, away: halfA } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:half`
                }, transaction);
                await handleWinnerLog('half', halfH, halfA);
            }
            if (isQ3Final && q3H !== undefined) {
                await (0, audit_1.writeAuditEvent)({
                    poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
                    actor: { uid: 'system', role: 'SYSTEM' }, payload: { period: 3, score: { home: q3H, away: q3A } },
                    dedupeKey: `SCORE_FINALIZED:${doc.id}:q3`
                }, transaction);
                await handleWinnerLog('q3', q3H, q3A);
            }
            if (isGameFinal && finalH !== undefined) {
                await (0, audit_1.writeAuditEvent)({
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
    // Find all active pools with a game assigned (regardless of lock status)
    // We filter for gameId > "" to ensure we only get pools with a game.
    const poolsSnap = await db.collection("pools")
        .where("gameId", ">", "")
        .get();
    for (const doc of poolsSnap.docs) {
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
        // Fetch fresh scores
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
        // Force update all scores based on current period
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
//# sourceMappingURL=scoreUpdates.js.map