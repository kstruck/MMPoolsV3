/**
 * One-time script to fix corrupted quarter scores in active pools
 * Run with: npx ts-node scripts/fixPoolScores.ts
 */

import * as admin from 'firebase-admin';

// Initialize Firebase Admin
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ESPN API helper to fetch fresh scores
async function fetchESPNScores(gameId: string, league: string): Promise<any> {
    const leaguePath = league === 'college' || league === 'ncaa' ? 'college-football' : 'nfl';
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/summary?event=${gameId}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.header?.competitions?.[0]) return null;

    const competition = data.header.competitions[0];
    const competitors = competition.competitors;

    const apiHomeComp = competitors.find((c: any) => c.homeAway === 'home');
    const apiAwayComp = competitors.find((c: any) => c.homeAway === 'away');

    if (!apiHomeComp || !apiAwayComp) return null;

    const safeInt = (val: any) => {
        if (val === null || val === undefined) return 0;
        const parsed = parseInt(val);
        return isNaN(parsed) ? 0 : parsed;
    };

    const homeLines = apiHomeComp.linescores || [];
    const awayLines = apiAwayComp.linescores || [];

    // Get delta scores per period from ESPN
    const getPeriodScore = (lines: any[], p: number) => {
        const found = lines.find((l: any) => l.period === p);
        return found ? safeInt(found.value) : 0;
    };

    // Individual quarter deltas
    const q1Home = getPeriodScore(homeLines, 1);
    const q1Away = getPeriodScore(awayLines, 1);
    const q2Home = getPeriodScore(homeLines, 2);
    const q2Away = getPeriodScore(awayLines, 2);
    const q3HomeRaw = getPeriodScore(homeLines, 3);
    const q3AwayRaw = getPeriodScore(awayLines, 3);
    const q4HomeRaw = getPeriodScore(homeLines, 4);
    const q4AwayRaw = getPeriodScore(awayLines, 4);

    // Calculate cumulative scores
    const halfHome = q1Home + q2Home;
    const halfAway = q1Away + q2Away;
    const q3Home = halfHome + q3HomeRaw;
    const q3Away = halfAway + q3AwayRaw;
    const regFinalHome = q3Home + q4HomeRaw;
    const regFinalAway = q3Away + q4AwayRaw;

    const apiTotalHome = safeInt(apiHomeComp.score);
    const apiTotalAway = safeInt(apiAwayComp.score);

    const statusState = data.header.status?.type?.state || competition.status?.type?.state;
    const period = safeInt(data.header.status?.period || competition.status?.period);
    const clock = data.header.status?.displayClock || competition.status?.displayClock || "0:00";

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
    console.log('🔍 Finding active (locked & live) pools...\n');

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

        const gameStatus = pool.scores?.gameStatus;
        if (gameStatus !== 'in' && gameStatus !== 'post') {
            console.log(`⏭️  Pool ${poolId}: Game status is '${gameStatus}', skipping`);
            continue;
        }

        console.log(`\n🏈 Fixing Pool: ${pool.homeTeam} vs ${pool.awayTeam} (${poolId})`);
        console.log(`   Current scores in DB:`);
        console.log(`   - Q1: ${pool.scores?.q1?.home}-${pool.scores?.q1?.away}`);
        console.log(`   - Half: ${pool.scores?.half?.home}-${pool.scores?.half?.away}`);
        console.log(`   - Q3: ${pool.scores?.q3?.home}-${pool.scores?.q3?.away}`);
        console.log(`   - Final: ${pool.scores?.final?.home}-${pool.scores?.final?.away}`);
        console.log(`   - Current: ${pool.scores?.current?.home}-${pool.scores?.current?.away}`);

        // Fetch fresh scores from ESPN
        const freshScores = await fetchESPNScores(pool.gameId, pool.league || 'nfl');

        if (!freshScores) {
            console.log(`   ❌ Could not fetch ESPN scores for gameId: ${pool.gameId}`);
            continue;
        }

        console.log(`\n   Fresh ESPN scores:`);
        console.log(`   - Q1: ${freshScores.q1.home}-${freshScores.q1.away}`);
        console.log(`   - Half: ${freshScores.half.home}-${freshScores.half.away}`);
        console.log(`   - Q3: ${freshScores.q3.home}-${freshScores.q3.away}`);
        console.log(`   - Final: ${freshScores.final?.home}-${freshScores.final?.away || 'null'}`);
        console.log(`   - Current: ${freshScores.current.home}-${freshScores.current.away}`);
        console.log(`   - Period: ${freshScores.period}, Status: ${freshScores.gameStatus}`);

        // Build update based on current period
        const updates: any = {
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
        await db.collection('pools').doc(poolId).update(updates);
        console.log(`   ✅ Updated pool with corrected scores!`);
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
