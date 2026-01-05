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
// Helper: Check if two team names match (fuzzy match for abbreviations vs full names)
const teamNamesMatch = (poolTeam, espnTeam) => {
    if (!poolTeam || !espnTeam)
        return false;
    const p = poolTeam.toLowerCase().trim();
    const e = espnTeam.toLowerCase().trim();
    // Exact match
    if (p === e)
        return true;
    // One contains the other (handles "Kansas City Chiefs" vs "KC" or "Chiefs")
    if (p.includes(e) || e.includes(p))
        return true;
    // Check if last word matches (e.g., "Falcons" in "Atlanta Falcons")
    const pLast = p.split(/\s+/).pop() || '';
    const eLast = e.split(/\s+/).pop() || '';
    if (pLast.length > 2 && eLast.length > 2 && (pLast === eLast || pLast.includes(eLast) || eLast.includes(pLast)))
        return true;
    return false;
};
// Helper: Determine if ESPN home/away should be swapped based on pool team names
const shouldSwapHomeAway = (pool, espnHomeTeam, espnAwayTeam) => {
    // If pool's homeTeam matches ESPN's awayTeam, scores need to be swapped
    const poolHomeMatchesEspnAway = teamNamesMatch(pool.homeTeam, espnAwayTeam);
    const poolAwayMatchesEspnHome = teamNamesMatch(pool.awayTeam, espnHomeTeam);
    // Only swap if both match in reverse (to avoid false positives)
    return poolHomeMatchesEspnAway && poolAwayMatchesEspnHome;
};
// Helper: Swap home/away in a score pair
const swapScores = (scores) => {
    if (!scores)
        return undefined;
    return { home: scores.away, away: scores.home };
};
// Fetch and calculate scores from ESPN API
async function fetchESPNScores(gameId, league) {
    var _a, _b, _c, _d, _e, _f, _g;
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
            // Team names for matching against pool configuration
            homeTeamName: ((_d = homeComp.team) === null || _d === void 0 ? void 0 : _d.abbreviation) || ((_e = homeComp.team) === null || _e === void 0 ? void 0 : _e.displayName) || '',
            awayTeamName: ((_f = awayComp.team) === null || _f === void 0 ? void 0 : _f.abbreviation) || ((_g = awayComp.team) === null || _g === void 0 ? void 0 : _g.displayName) || '',
            gameStatus: state,
            period,
            clock,
            startTime: gameDate,
            // CRITICAL: Extract ACTUAL scoring plays from ESPN for Every Score Pays
            // Each play includes: awayScore, homeScore, type.text, team.abbreviation
            scoringPlays: (data.scoringPlays || []).map((play) => {
                var _a, _b, _c, _d, _e;
                return ({
                    awayScore: safeInt(play.awayScore),
                    homeScore: safeInt(play.homeScore),
                    description: ((_a = play.type) === null || _a === void 0 ? void 0 : _a.text) || ((_b = play.scoringType) === null || _b === void 0 ? void 0 : _b.displayName) || 'Score',
                    team: ((_c = play.team) === null || _c === void 0 ? void 0 : _c.abbreviation) || '',
                    period: safeInt((_d = play.period) === null || _d === void 0 ? void 0 : _d.number),
                    clock: ((_e = play.clock) === null || _e === void 0 ? void 0 : _e.displayValue) || '',
                    id: play.id || `${play.awayScore}-${play.homeScore}`
                });
            })
        };
    }
    catch (e) {
        console.error('ESPN fetch failed:', e);
        return null;
    }
}
// Helper to handle winner logging and computation (Shared between sync and fix)
const processWinners = async (transaction, db, poolId, poolData, periodKey, homeScore, awayScore, skipDedupe = false) => {
    var _a, _b, _c, _d, _e, _f;
    // Safety check for axis numbers
    if (!poolData.axisNumbers || !poolData.axisNumbers.home || !poolData.axisNumbers.away)
        return;
    // Dedupe check handled by writeAuditEvent keys
    const hDigit = getLastDigit(homeScore);
    const aDigit = getLastDigit(awayScore);
    const soldSquares = poolData.squares ? poolData.squares.filter((s) => s.owner).length : 0;
    const totalPot = soldSquares * (poolData.costPerSquare || 0);
    // Process Payout Amount
    // Skip ALL period winners for Equal Split (only score events pay)
    if (((_a = poolData.ruleVariations) === null || _a === void 0 ? void 0 : _a.scoreChangePayout) && ((_b = poolData.ruleVariations) === null || _b === void 0 ? void 0 : _b.scoreChangePayoutStrategy) === 'equal_split') {
        console.log(`[ScoreSync] Skipping Period Winner for Equal Split Pool ${poolId}`);
        return;
    }
    // For Hybrid: Skip Q1 and Q3 (only Halftime and Final get period payouts)
    if (((_c = poolData.ruleVariations) === null || _c === void 0 ? void 0 : _c.scoreChangePayout) && ((_d = poolData.ruleVariations) === null || _d === void 0 ? void 0 : _d.scoreChangePayoutStrategy) === 'hybrid') {
        if (periodKey === 'q1' || periodKey === 'q3') {
            console.log(`[ScoreSync] Skipping ${periodKey} Winner for Hybrid Pool ${poolId} (only half/final pay)`);
            return;
        }
    }
    const payoutPct = getSafePayout(poolData.payouts, periodKey);
    let amount = (totalPot * payoutPct) / 100;
    if ((_e = poolData.ruleVariations) === null || _e === void 0 ? void 0 : _e.reverseWinners)
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
        if ((_f = poolData.ruleVariations) === null || _f === void 0 ? void 0 : _f.reverseWinners) {
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
                    // Persist reverse winner to subcollection
                    const reverseWinnerDoc = {
                        period: periodKey,
                        squareId: rSqIndex,
                        owner: rWinnerName,
                        amount: amount,
                        homeDigit: aDigit, // Swapped for reverse
                        awayDigit: hDigit, // Swapped for reverse
                        isReverse: true,
                        description: `${label} Reverse Winner`
                    };
                    transaction.set(db.collection('pools').doc(poolId).collection('winners').doc(`${periodKey}_reverse`), reverseWinnerDoc);
                }
            }
        }
    }
};
/**
 * Core logic to update a single pool based on new scores.
 */
const processGameUpdate = async (transaction, doc, espnScores, actor, overrides) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    const db = admin.firestore();
    const freshPool = Object.assign(Object.assign({}, doc.data()), overrides);
    if (!espnScores)
        return;
    // ============ CRITICAL: Detect and correct home/away team orientation ============
    // ESPN returns scores based on actual venue (Falcons = home in Atlanta)
    // Pool's homeTeam/awayTeam are just labels that may not match ESPN's designation
    // If reversed, we need to swap all scores before processing
    const needsSwap = shouldSwapHomeAway(freshPool, espnScores.homeTeamName || '', espnScores.awayTeamName || '');
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
    // PRE-READ: For "Every Score Wins" pools going final, we need to read winners BEFORE any writes
    // This prevents read-after-write transaction errors
    let preReadEventWinners = null;
    if (isGameFinal && ((_a = freshPool.ruleVariations) === null || _a === void 0 ? void 0 : _a.scoreChangePayout)) {
        const winnersRef = db.collection('pools').doc(doc.id).collection('winners');
        const winnersSnap = await transaction.get(winnersRef);
        preReadEventWinners = winnersSnap.docs.filter(d => d.data().period === 'Event');
    }
    // Prepare New Scores Object
    const newScores = Object.assign(Object.assign({}, freshPool.scores), { current: espnScores.current, gameStatus: state, period: period, clock: espnScores.clock, startTime: espnScores.startTime || freshPool.scores.startTime });
    if (isQ1Final && !((_b = freshPool.scores) === null || _b === void 0 ? void 0 : _b.q1))
        newScores.q1 = espnScores.q1;
    if (isHalfFinal && !((_c = freshPool.scores) === null || _c === void 0 ? void 0 : _c.half))
        newScores.half = espnScores.half;
    if (isQ3Final && !((_d = freshPool.scores) === null || _d === void 0 ? void 0 : _d.q3))
        newScores.q3 = espnScores.q3;
    if (isGameFinal && !((_e = freshPool.scores) === null || _e === void 0 ? void 0 : _e.final)) {
        newScores.final = (freshPool.includeOvertime && espnScores.apiTotal !== undefined)
            ? espnScores.apiTotal
            : (espnScores.final || espnScores.current);
    }
    let transactionUpdates = {};
    let shouldUpdate = false;
    // Include axisNumbers override if passed (e.g., from simulation auto-generation)
    if (overrides === null || overrides === void 0 ? void 0 : overrides.axisNumbers) {
        transactionUpdates.axisNumbers = overrides.axisNumbers;
        shouldUpdate = true;
    }
    const currentScoresStr = JSON.stringify(freshPool.scores);
    const newScoresStr = JSON.stringify(newScores);
    if (currentScoresStr !== newScoresStr) {
        transactionUpdates.scores = newScores;
        shouldUpdate = true;
    }
    // Live Score Update Logging & Decomposed Events
    const freshCurrent = ((_f = freshPool.scores) === null || _f === void 0 ? void 0 : _f.current) || { home: 0, away: 0 };
    const newCurrent = espnScores.current || { home: 0, away: 0 };
    // Calculate Deltas
    const deltaHome = newCurrent.home - freshCurrent.home;
    const deltaAway = newCurrent.away - freshCurrent.away;
    // Check if score changed
    if (deltaHome !== 0 || deltaAway !== 0) {
        // Prepare list of sequential score states to process
        // Each entry is { home: number, away: number, type: 'TD' | 'XP' | 'FG' | 'SAFETY' | 'OTHER' }
        const steps = [];
        const combine = ((_g = freshPool.ruleVariations) === null || _g === void 0 ? void 0 : _g.combineTDandXP) === true;
        // Helper function to decompose scoring for a single team
        const decomposeScoring = (delta, scoringTeam, currentHome, currentAway) => {
            const result = [];
            if (delta <= 0)
                return result;
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
                    }
                    else {
                        result.push({ home: runningHome, away: runningAway + points, desc });
                        runningAway += points;
                    }
                    remaining -= points;
                    // Now check for XP or 2PT
                    if (remaining >= 2) {
                        points = 2;
                        desc = '2Pt Conv';
                    }
                    else if (remaining >= 1) {
                        points = 1;
                        desc = 'Extra Point';
                    }
                    else {
                        continue;
                    }
                }
                else if (remaining === 6) {
                    points = 6;
                    desc = 'Touchdown';
                }
                else if (remaining === 3) {
                    points = 3;
                    desc = 'Field Goal';
                }
                else if (remaining === 2) {
                    points = 2;
                    desc = 'Safety';
                }
                else if (remaining === 1) {
                    points = 1;
                    desc = 'Extra Point';
                }
                else {
                    // Unknown pattern - just record the remaining as one event
                    points = remaining;
                    desc = 'Score Change';
                }
                if (scoringTeam === 'home') {
                    result.push({ home: runningHome + points, away: runningAway, desc });
                    runningHome += points;
                }
                else {
                    result.push({ home: runningHome, away: runningAway + points, desc });
                    runningAway += points;
                }
                remaining -= points;
            }
            return result;
        };
        // ============================================================
        // CRITICAL FIX: Use ACTUAL ESPN scoring plays instead of guessing
        // ============================================================
        if (espnScores.scoringPlays && espnScores.scoringPlays.length > 0) {
            // Use real ESPN scoring play data
            console.log(`[ScoreUpdate] Using ${espnScores.scoringPlays.length} actual ESPN scoring plays`);
            // Track current score as we process plays
            let prevHome = freshCurrent.home;
            let prevAway = freshCurrent.away;
            for (const play of espnScores.scoringPlays) {
                // ESPN returns awayScore/homeScore - we need to map to pool's home/away
                // Check if ESPN's home matches pool's home, or if we need to swap
                const needsSwap = shouldSwapHomeAway(freshPool, espnScores.homeTeamName, espnScores.awayTeamName);
                const playHome = needsSwap ? play.awayScore : play.homeScore;
                const playAway = needsSwap ? play.homeScore : play.awayScore;
                // Only process plays beyond our current recorded score
                if (playHome < freshCurrent.home || playAway < freshCurrent.away) {
                    continue;
                }
                if (playHome === freshCurrent.home && playAway === freshCurrent.away) {
                    continue;
                }
                // Calculate the point change from this play
                const deltaH = playHome - prevHome;
                const deltaA = playAway - prevAway;
                // ESPN combines TD+XP into single plays (7 or 8 points)
                // If pool wants separate TD/XP winners, we need to decompose
                if (!combine && ((deltaH === 7 || deltaH === 8) || (deltaA === 7 || deltaA === 8))) {
                    // Decompose TD+XP combinations
                    if (deltaH === 7) {
                        // TD (6) + XP (1)
                        steps.push({ home: prevHome + 6, away: prevAway, desc: 'Touchdown' });
                        steps.push({ home: playHome, away: playAway, desc: 'Extra Point' });
                    }
                    else if (deltaH === 8) {
                        // TD (6) + 2PT (2)
                        steps.push({ home: prevHome + 6, away: prevAway, desc: 'Touchdown' });
                        steps.push({ home: playHome, away: playAway, desc: '2Pt Conv' });
                    }
                    else if (deltaA === 7) {
                        // TD (6) + XP (1)
                        steps.push({ home: prevHome, away: prevAway + 6, desc: 'Touchdown' });
                        steps.push({ home: playHome, away: playAway, desc: 'Extra Point' });
                    }
                    else if (deltaA === 8) {
                        // TD (6) + 2PT (2)
                        steps.push({ home: prevHome, away: prevAway + 6, desc: 'Touchdown' });
                        steps.push({ home: playHome, away: playAway, desc: '2Pt Conv' });
                    }
                }
                else {
                    // Use ESPN play as-is (FG, Safety, or combined TD+XP when pool allows)
                    steps.push({
                        home: playHome,
                        away: playAway,
                        desc: play.description || 'Score'
                    });
                }
                // Update tracking
                prevHome = playHome;
                prevAway = playAway;
            }
        }
        else {
            // FALLBACK: No ESPN scoring plays available - use old decomposition as backup
            console.log(`[ScoreUpdate] No ESPN scoringPlays, falling back to decomposition`);
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
        const dedupeChecks = [];
        for (const step of steps) {
            dedupeChecks.push(`SCORE_STEP:${doc.id}:${step.home}:${step.away}`);
            if ((_h = freshPool.ruleVariations) === null || _h === void 0 ? void 0 : _h.scoreChangePayout) {
                dedupeChecks.push(`WINNER_EVENT:${doc.id}:${step.home}:${step.away}`);
            }
        }
        // Perform READS (must be before any writes in the loop)
        const existingDedupes = new Set();
        if (dedupeChecks.length > 0) {
            const refs = dedupeChecks.map(k => db.collection("pools").doc(doc.id).collection("audit_dedupe").doc(k));
            const snaps = await transaction.getAll(...refs);
            snaps.forEach(s => { if (s.exists)
                existingDedupes.add(s.id); });
        }
        // --- PROCESS SEQUENCE ---
        for (const step of steps) {
            const stepQText = state === 'pre' ? 'Pre' : period + (period === 1 ? 'st' : period === 2 ? 'nd' : period === 3 ? 'rd' : 'th');
            const scoreKey = `SCORE_STEP:${doc.id}:${step.home}:${step.away}`;
            if (existingDedupes.has(scoreKey))
                continue;
            // 1. Log Score Change Audit
            // Use forceWriteDedupe to skip the read check inside writeAuditEvent
            await (0, audit_1.writeAuditEvent)({
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
            if ((_j = freshPool.ruleVariations) === null || _j === void 0 ? void 0 : _j.scoreChangePayout) {
                const winnerKey = `WINNER_EVENT:${doc.id}:${step.home}:${step.away}`;
                if (existingDedupes.has(winnerKey))
                    continue;
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
                            dedupeKey: winnerKey,
                            forceWriteDedupe: true
                        }, transaction);
                        const winnerDoc = {
                            period: 'Event',
                            squareId: squareIndex,
                            owner: winnerName,
                            amount: 0,
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
    const q1H = (_k = newScores.q1) === null || _k === void 0 ? void 0 : _k.home;
    const q1A = (_l = newScores.q1) === null || _l === void 0 ? void 0 : _l.away;
    const halfH = (_m = newScores.half) === null || _m === void 0 ? void 0 : _m.home;
    const halfA = (_o = newScores.half) === null || _o === void 0 ? void 0 : _o.away;
    const q3H = (_p = newScores.q3) === null || _p === void 0 ? void 0 : _p.home;
    const q3A = (_q = newScores.q3) === null || _q === void 0 ? void 0 : _q.away;
    const finalH = (_r = newScores.final) === null || _r === void 0 ? void 0 : _r.home;
    const finalA = (_s = newScores.final) === null || _s === void 0 ? void 0 : _s.away;
    // Fix: Only process winners if we JUST finalized it (it wasn't in freshPool)
    // This prevents re-running winner logic on every sync
    if (isQ1Final && q1H !== undefined && !((_t = freshPool.scores) === null || _t === void 0 ? void 0 : _t.q1)) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q1 Finalized: ${q1H}-${q1A}`, severity: 'INFO',
            actor: actor, payload: { period: 1, score: { home: q1H, away: q1A } }
            // Dedupe skipped safe here because we guarded with !freshPool.scores.q1
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q1', q1H, q1A, true);
    }
    if (isHalfFinal && halfH !== undefined && !((_u = freshPool.scores) === null || _u === void 0 ? void 0 : _u.half)) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Halftime Finalized: ${halfH}-${halfA}`, severity: 'INFO',
            actor: actor, payload: { period: 2, score: { home: halfH, away: halfA } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'half', halfH, halfA, true);
    }
    if (isQ3Final && q3H !== undefined && !((_v = freshPool.scores) === null || _v === void 0 ? void 0 : _v.q3)) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Q3 Finalized: ${q3H}-${q3A}`, severity: 'INFO',
            actor: actor, payload: { period: 3, score: { home: q3H, away: q3A } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'q3', q3H, q3A, true);
    }
    if (isGameFinal && finalH !== undefined && !((_w = freshPool.scores) === null || _w === void 0 ? void 0 : _w.final)) {
        await (0, audit_1.writeAuditEvent)({
            poolId: doc.id, type: 'SCORE_FINALIZED', message: `Game Finalized: ${finalH}-${finalA}`, severity: 'INFO',
            actor: actor, payload: { period: 4, score: { home: finalH, away: finalA } }
        }, transaction);
        await processWinners(transaction, db, doc.id, freshPool, 'final', finalH, finalA, true);
    }
    // FINAL WRITE: Update the pool doc itself
    // Must be last if previous steps involve reads (like audit deduping)
    if (shouldUpdate) {
        transaction.update(doc.ref, Object.assign(Object.assign({}, transactionUpdates), { updatedAt: admin.firestore.Timestamp.now() }));
    }
    // --- EVERY SCORE PAYS FINALIZATION ---
    // If the game just went final, we need to calculate the actual $ amount for each event based on the total pot logic
    if (isGameFinal && ((_x = freshPool.ruleVariations) === null || _x === void 0 ? void 0 : _x.scoreChangePayout) && preReadEventWinners) {
        await finalizeEventPayouts(transaction, db, doc.id, freshPool, actor, preReadEventWinners);
    }
};
// Helper to calculate and backfill amounts for all score events when game is over
// IMPORTANT: eventWinners must be PRE-READ before any writes to avoid transaction errors
const finalizeEventPayouts = async (transaction, db, poolId, pool, actor, eventWinners) => {
    var _a, _b;
    // 1. Calculate Pot Logic
    const soldSquares = pool.squares ? pool.squares.filter((s) => s.owner).length : 0;
    const totalPot = soldSquares * (pool.costPerSquare || 0);
    let scoreChangePot = 0;
    const strategy = ((_a = pool.ruleVariations) === null || _a === void 0 ? void 0 : _a.scoreChangePayoutStrategy) || 'equal_split';
    if (strategy === 'equal_split') {
        scoreChangePot = totalPot;
    }
    else {
        // Hybrid
        const weights = ((_b = pool.ruleVariations) === null || _b === void 0 ? void 0 : _b.scoreChangeHybridWeights) || { final: 40, halftime: 20, other: 40 };
        const remainingPct = 100 - weights.final - weights.halftime;
        scoreChangePot = (totalPot * remainingPct) / 100;
    }
    // NOTE: eventWinners is now pre-read (passed in) to avoid read-after-write errors
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
        await (0, audit_1.writeAuditEvent)({
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
        // 1. Fetch Active Pools AND Recently Completed Pools
        // Get active/in-progress pools
        const activePoolsSnap = await db.collection("pools")
            .where("scores.gameStatus", "!=", "post")
            .get();
        // Also get recently completed pools (last 48 hours) to ensure score events are captured
        // This is critical for Every Score Pays pools that may complete quickly
        const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
        const completedPoolsSnap = await db.collection("pools")
            .where("scores.gameStatus", "==", "post")
            .where("updatedAt", ">=", admin.firestore.Timestamp.fromMillis(twoDaysAgo))
            .get();
        // Combine both result sets
        const allPools = [...activePoolsSnap.docs, ...completedPoolsSnap.docs];
        if (allPools.length === 0) {
            await db.collection('system_logs').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'SYNC_GAME_STATUS',
                status: 'idle',
                message: 'No active or recently completed pools found',
                durationMs: Date.now() - startTime
            });
            return;
        }
        console.log(`[Sync] Processing ${allPools.length} pools (${activePoolsSnap.size} active, ${completedPoolsSnap.size} recently completed)`);
        // 2. Process Each Pool
        for (const doc of allPools) {
            const pool = doc.data();
            if (!pool.gameId)
                continue;
            // Optimization: Skip if game hasn't started yet and start time is > 2 hours away
            if (!pool.isLocked && ((_a = pool.scores) === null || _a === void 0 ? void 0 : _a.gameStatus) === 'pre') {
                const now = Date.now();
                // Safe handling of startTime
                const start = pool.scores.startTime ? new Date(pool.scores.startTime).getTime() : 0;
                if (start > now + 2 * 60 * 60 * 1000)
                    continue;
            }
            try {
                const espnScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
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
                    if (!freshDoc.exists)
                        return;
                    await processGameUpdate(transaction, freshDoc, espnScores, { uid: 'system', role: 'SYSTEM' });
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
            }
            catch (e) {
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
            message: `Score Sync Cycle Completed: ${processedCount}/${allPools.length} pools processed.`,
            details: {
                activePools: activePoolsSnap.size,
                completedPools: completedPoolsSnap.size,
                totalPoolsFound: allPools.length,
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
    var _a;
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
    // Track if we generated axis numbers (for audit logging AFTER transaction)
    let generatedAxis = null;
    try {
        await db.runTransaction(async (transaction) => {
            var _a;
            const doc = await transaction.get(poolRef);
            if (!doc.exists)
                throw new https_1.HttpsError('not-found', 'Pool not found');
            // Ensure Axis Numbers Exist during Simulation 
            // IMPORTANT: Do NOT call transaction.update here - it would cause read-after-write
            // since processGameUpdate does transaction.getAll() for deduping.
            // Instead, pass the axis as an override and processGameUpdate will include it
            // in its final poolRef update.
            let overrides = {};
            const poolData = doc.data();
            if (!poolData.axisNumbers) {
                const newAxis = generateAxisNumbers();
                console.log(`[Sim] Generating missing Axis Numbers for pool ${poolId}`);
                overrides.axisNumbers = newAxis;
                generatedAxis = newAxis; // Track for post-transaction audit
            }
            await processGameUpdate(transaction, doc, scores, { uid: ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || 'admin', role: 'ADMIN', label: 'Simulation' }, overrides);
        });
        // Audit event OUTSIDE transaction to avoid read-after-write errors
        if (generatedAxis) {
            await (0, audit_1.writeAuditEvent)({
                poolId,
                type: 'DIGITS_GENERATED',
                message: `Axis Numbers Auto-Generated for Simulation`,
                severity: 'INFO',
                actor: { uid: ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || 'admin', role: 'ADMIN', label: 'Sim Auto-Gen' },
                payload: { axis: generatedAxis }
            });
        }
        return { success: true, message: 'Simulation Applied' };
    }
    catch (error) {
        console.error('Simulation Transaction Failed:', error);
        throw new https_1.HttpsError('internal', `Simulation failed: ${error.message}`);
    }
});
// One-time callable function to fix corrupted pool scores AND run winner logic
exports.fixPoolScores = (0, https_1.onCall)({
    timeoutSeconds: 300,
    memory: "512MiB"
}, async (request) => {
    // TEMPORARY: Auth disabled for testing
    /*
    // Check Authentication (Admin Only)
    if (request.auth?.token.role !== 'SUPER_ADMIN' && request.auth?.token.email !== 'kstruck@gmail.com') {
        if (request.auth?.token.role !== 'SUPER_ADMIN') {
            throw new HttpsError('permission-denied', 'Must be Super Admin');
        }
    }
    */
    var _a, _b, _c, _d;
    const db = admin.firestore();
    const targetPoolId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.poolId;
    let poolsSnap;
    if (targetPoolId) {
        // Targeted Fix
        console.log(`[FixPool] Targeting single pool: ${targetPoolId}`);
        const docSnap = await db.collection("pools").doc(targetPoolId).get();
        if (!docSnap.exists)
            return { success: false, message: 'Pool not found' };
        poolsSnap = { docs: [docSnap], size: 1 };
    }
    else {
        // Global Fix
        console.log(`[FixPool] Running Global Fix...`);
        poolsSnap = await db.collection("pools")
            .where("scores.gameStatus", "in", ["in", "post"])
            .get();
    }
    const results = [];
    for (const doc of poolsSnap.docs) {
        try {
            const pool = doc.data();
            if (!pool.gameId)
                continue;
            const espnScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
            if (!espnScores) {
                results.push({ id: doc.id, status: 'error', reason: 'ESPN fetch failed' });
                continue;
            }
            // DEBUG LOGGING
            console.log(`[FixPool] Pool ${doc.id}: ${pool.awayTeam} @ ${pool.homeTeam}`);
            console.log(`[FixPool] GameId: ${pool.gameId}`);
            console.log(`[FixPool] ESPN Teams: ${espnScores.awayTeamName} @ ${espnScores.homeTeamName}`);
            console.log(`[FixPool] ESPN Final: Away ${espnScores.current.away} - Home ${espnScores.current.home}`);
            console.log(`[FixPool] ESPN Scoring Plays: ${((_b = espnScores.scoringPlays) === null || _b === void 0 ? void 0 : _b.length) || 0}`);
            if (espnScores.scoringPlays && espnScores.scoringPlays.length > 0) {
                espnScores.scoringPlays.slice(0, 3).forEach((p) => {
                    console.log(`  - ${p.awayScore}-${p.homeScore}: ${p.description}`);
                });
            }
            // CRITICAL FIX: For Every Score Pays pools, reset scores to force full decomposition
            if (((_c = pool.ruleVariations) === null || _c === void 0 ? void 0 : _c.scoreChangePayout) && ((_d = pool.scores) === null || _d === void 0 ? void 0 : _d.current)) {
                console.log(`[FixPool] Resetting ${doc.id} from ${pool.scores.current.home}-${pool.scores.current.away} to 0-0`);
                await doc.ref.update({
                    'scores.current': { home: 0, away: 0 },
                    scoreEvents: []
                });
            }
            // Use processGameUpdate - the SAME function syncGameStatus uses
            // This ensures score events and winners are properly generated
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(doc.ref);
                if (!freshDoc.exists)
                    return;
                await processGameUpdate(transaction, freshDoc, espnScores, { uid: 'system', role: 'ADMIN', label: 'Manual Fix' });
            });
            results.push({
                id: doc.id,
                name: `${pool.homeTeam} vs ${pool.awayTeam}`,
                status: 'fixed',
                message: 'Score events and winners processed'
            });
        }
        catch (error) {
            console.error(`Error processing pool ${doc.id}: `, error);
            results.push({ id: doc.id, status: 'error', reason: error.message });
        }
    }
    return { success: true, pools: results };
});
//# sourceMappingURL=scoreUpdates.js.map