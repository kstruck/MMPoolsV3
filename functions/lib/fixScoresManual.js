"use strict";
/**
 * One-time script to fix corrupted quarter scores in active pools
 * Run with: npx ts-node src/fixScoresManual.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const admin = require("firebase-admin");
// Initialize Firebase Admin
// Key is in root (../../serviceAccountKey.json) relative to src/fixScoresManual.ts
const serviceAccount = require('../../serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// ESPN API helper to fetch fresh scores
async function fetchESPNScores(gameId, league) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const leaguePath = league === 'college' || league === 'ncaa' ? 'college-football' : 'nfl';
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${gameId}`;
    const response = await fetch(url);
    if (!response.ok)
        return null;
    const data = await response.json();
    if (!((_b = (_a = data.header) === null || _a === void 0 ? void 0 : _a.competitions) === null || _b === void 0 ? void 0 : _b[0]))
        return null;
    const competition = data.header.competitions[0];
    const competitors = competition.competitors;
    const apiHomeComp = competitors.find((c) => c.homeAway === 'home');
    const apiAwayComp = competitors.find((c) => c.homeAway === 'away');
    if (!apiHomeComp || !apiAwayComp)
        return null;
    const safeInt = (val) => {
        if (val === null || val === undefined)
            return 0;
        const parsed = parseInt(val);
        return isNaN(parsed) ? 0 : parsed;
    };
    const homeLines = apiHomeComp.linescores || [];
    const awayLines = apiAwayComp.linescores || [];
    console.log('DEBUG LINES:', JSON.stringify({ homeLines, awayLines }, null, 2));
    // Get delta scores per period from ESPN
    const getPeriodScore = (lines, p) => {
        var _a, _b;
        let val;
        // Try finding by period property
        const found = lines.find((l) => l.period == p);
        if (found) {
            val = (_a = found.value) !== null && _a !== void 0 ? _a : found.displayValue;
        }
        else {
            // Fallback to index
            const indexed = lines[p - 1];
            if (indexed)
                val = (_b = indexed.value) !== null && _b !== void 0 ? _b : indexed.displayValue;
        }
        return safeInt(val);
    };
    // Individual quarter deltas
    const q1Home = getPeriodScore(homeLines, 1);
    const q1Away = getPeriodScore(awayLines, 1);
    const q2Home = getPeriodScore(homeLines, 2);
    const q2Away = getPeriodScore(awayLines, 2);
    const q3HomeRaw = getPeriodScore(homeLines, 3);
    const q3AwayRaw = getPeriodScore(awayLines, 3);
    // Calculate cumulative scores
    const halfHome = q1Home + q2Home;
    const halfAway = q1Away + q2Away;
    const q3Home = halfHome + q3HomeRaw;
    const q3Away = halfAway + q3AwayRaw;
    const apiTotalHome = safeInt(apiHomeComp.score);
    const apiTotalAway = safeInt(apiAwayComp.score);
    const statusState = ((_d = (_c = data.header.status) === null || _c === void 0 ? void 0 : _c.type) === null || _d === void 0 ? void 0 : _d.state) || ((_f = (_e = competition.status) === null || _e === void 0 ? void 0 : _e.type) === null || _f === void 0 ? void 0 : _f.state);
    const period = safeInt(((_g = data.header.status) === null || _g === void 0 ? void 0 : _g.period) || ((_h = competition.status) === null || _h === void 0 ? void 0 : _h.period));
    const clock = ((_j = data.header.status) === null || _j === void 0 ? void 0 : _j.displayClock) || ((_k = competition.status) === null || _k === void 0 ? void 0 : _k.displayClock) || "0:00";
    return {
        current: { home: apiTotalHome, away: apiTotalAway },
        q1: { home: q1Home, away: q1Away },
        half: { home: halfHome, away: halfAway },
        q3: { home: q3Home, away: q3Away },
        final: statusState === 'post' ? { home: apiTotalHome, away: apiTotalAway } : null,
        gameStatus: statusState,
        period,
        clock
    };
}
async function fixActivePools() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    console.log('🔍 Finding active (locked) pools...\n');
    const poolsSnapshot = await db.collection('pools')
        .where('isLocked', '==', true)
        .get();
    console.log(`Found ${poolsSnapshot.size} locked pools\n`);
    for (const doc of poolsSnapshot.docs) {
        const pool = doc.data();
        const poolId = doc.id;
        // Check if game is in progress or recently finished
        if (!pool.gameId) {
            console.log(`⏭️  Pool ${poolId} (${pool.homeTeam} vs ${pool.awayTeam}): No gameId, skipping`);
            continue;
        }
        const gameStatus = (_a = pool.scores) === null || _a === void 0 ? void 0 : _a.gameStatus;
        if (gameStatus !== 'in' && gameStatus !== 'post') {
            console.log(`⏭️  Pool ${poolId}: Game status is '${gameStatus}', skipping`);
            continue;
        }
        console.log(`\n🏈 Fixing Pool: ${pool.homeTeam} vs ${pool.awayTeam} (${poolId})`);
        console.log(`   Current scores in DB:`);
        console.log(`   - Q1: ${(_c = (_b = pool.scores) === null || _b === void 0 ? void 0 : _b.q1) === null || _c === void 0 ? void 0 : _c.home}-${(_e = (_d = pool.scores) === null || _d === void 0 ? void 0 : _d.q1) === null || _e === void 0 ? void 0 : _e.away}`);
        console.log(`   - Half: ${(_g = (_f = pool.scores) === null || _f === void 0 ? void 0 : _f.half) === null || _g === void 0 ? void 0 : _g.home}-${(_j = (_h = pool.scores) === null || _h === void 0 ? void 0 : _h.half) === null || _j === void 0 ? void 0 : _j.away}`);
        // ...
        // Fetch fresh scores from ESPN
        const freshScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');
        if (!freshScores) {
            console.log(`   ❌ Could not fetch ESPN scores for gameId: ${pool.gameId}`);
            continue;
        }
        console.log(`\n   Fresh ESPN scores:`);
        console.log(`   - Q1: ${freshScores.q1.home}-${freshScores.q1.away}`);
        console.log(`   - Half: ${freshScores.half.home}-${freshScores.half.away}`);
        console.log(`   - Period: ${freshScores.period}, Status: ${freshScores.gameStatus}`);
        // Build update based on current period
        const updates = {
            'scores.current': freshScores.current,
            'scores.gameStatus': freshScores.gameStatus,
            'scores.period': freshScores.period,
            'scores.clock': freshScores.clock
        };
        // Set quarter scores based on game progress
        if (freshScores.period >= 2 || freshScores.gameStatus === 'post') {
            updates['scores.q1'] = freshScores.q1;
        }
        if (freshScores.period >= 3 || freshScores.gameStatus === 'post') {
            updates['scores.half'] = freshScores.half;
        }
        if (freshScores.period >= 4 || freshScores.gameStatus === 'post') {
            updates['scores.q3'] = freshScores.q3;
        }
        if (freshScores.gameStatus === 'post' && freshScores.final) {
            updates['scores.final'] = freshScores.final;
        }
        // Apply update
        console.log('   Applying updates:', JSON.stringify(updates, null, 2));
        await db.collection('pools').doc(poolId).update(updates);
        console.log(`   ✅ Updated pool!`);
    }
    console.log('\n✅ Done fixing pools!');
}
// Run the fix
fixActivePools()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
//# sourceMappingURL=fixScoresManual.js.map