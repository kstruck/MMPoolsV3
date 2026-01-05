// Script to check pool gameId and fetch ESPN data
// Run: node scripts/checkPoolGame.mjs 4BLlJSC7CGTAiK3SM6xO

import admin from 'firebase-admin';
import { readFileSync, writeFileSync } from 'fs';

const serviceAccountPath = './serviceAccountKey.json';
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const poolId = process.argv[2] || '4BLlJSC7CGTAiK3SM6xO';

async function check() {
    const db = admin.firestore();
    const poolDoc = await db.collection('pools').doc(poolId).get();

    if (!poolDoc.exists) {
        console.log('Pool not found!');
        process.exit(1);
    }

    const pool = poolDoc.data();

    console.log('=== POOL INFO ===');
    console.log('Pool ID:', poolId);
    console.log('Game ID:', pool.gameId);
    console.log('Home Team:', pool.homeTeam);
    console.log('Away Team:', pool.awayTeam);
    console.log('Score Change Payout:', pool.ruleVariations?.scoreChangePayout);
    console.log('');

    // Fetch ESPN data for this gameId
    const gameId = pool.gameId;
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;

    console.log('Fetching ESPN:', url);
    const resp = await fetch(url);
    const data = await resp.json();

    console.log('');
    console.log('=== ESPN TEAMS ===');
    const comp = data.header?.competitions?.[0];
    if (comp) {
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        console.log('ESPN Home:', home?.team?.displayName, '-', home?.score);
        console.log('ESPN Away:', away?.team?.displayName, '-', away?.score);
    }

    console.log('');
    console.log('=== ESPN SCORING PLAYS ===');
    if (data.scoringPlays) {
        console.log('Total plays:', data.scoringPlays.length);
        data.scoringPlays.forEach((play, i) => {
            console.log(`  ${i + 1}. Away ${play.awayScore} - Home ${play.homeScore} | ${play.type?.text} (${play.team?.abbreviation})`);
        });

        writeFileSync('scripts/espn_pool_data.json', JSON.stringify({
            poolInfo: { gameId, homeTeam: pool.homeTeam, awayTeam: pool.awayTeam },
            scoringPlays: data.scoringPlays
        }, null, 2));
        console.log('\nFull data written to scripts/espn_pool_data.json');
    } else {
        console.log('No scoringPlays found!');
    }

    process.exit(0);
}

check().catch(console.error);
