/**
 * Diagnostic script to check pool configuration
 * Run: node scripts/checkPoolConfig.js 4BLlJSC7CGTAiK3SM6xO
 */

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const poolId = process.argv[2];
if (!poolId) {
    console.error('Usage: node scripts/checkPoolConfig.js <poolId>');
    process.exit(1);
}

async function checkPool() {
    const db = admin.firestore();
    const poolDoc = await db.collection('pools').doc(poolId).get();

    if (!poolDoc.exists) {
        console.error('Pool not found!');
        process.exit(1);
    }

    const pool = poolDoc.data();

    console.log('\n=== POOL CONFIGURATION ===\n');
    console.log('Pool ID:', poolId);
    console.log('Teams:', pool.homeTeam, 'vs', pool.awayTeam);
    console.log('');

    console.log('✓ axisNumbers:', pool.axisNumbers ? 'YES' : '❌ NO - THIS IS THE PROBLEM!');
    if (pool.axisNumbers) {
        console.log('  Home:', pool.axisNumbers.home);
        console.log('  Away:', pool.axisNumbers.away);
    }
    console.log('');

    console.log('✓ scoreChangePayout:', pool.ruleVariations?.scoreChangePayout ? 'YES' : 'NO');
    console.log('✓ scoreChangePayoutStrategy:', pool.ruleVariations?.scoreChangePayoutStrategy || 'N/A');
    console.log('');

    console.log('✓ Score Events:', pool.scoreEvents?.length || 0);
    if (pool.scoreEvents && pool.scoreEvents.length > 0) {
        pool.scoreEvents.forEach(ev => {
            console.log(`  - ${ev.home}-${ev.away}: ${ev.description}`);
        });
    }
    console.log('');

    console.log('✓ Current Score:', `${pool.scores?.current?.home || 0}-${pool.scores?.current?.away || 0}`);
    console.log('✓ Game Status:', pool.scores?.gameStatus || 'unknown');
    console.log('');

    // Check winners
    const winnersSnap = await db.collection('pools').doc(poolId).collection('winners').get();
    console.log('✓ Winners Generated:', winnersSnap.size);
    if (winnersSnap.size > 0) {
        winnersSnap.docs.forEach(doc => {
            const winner = doc.data();
            console.log(`  - ${winner.period}: ${winner.owner} (${winner.homeDigit},${winner.awayDigit})`);
        });
    }

    console.log('');

    if (!pool.axisNumbers) {
        console.log('⚠️  PROBLEM IDENTIFIED:');
        console.log('   Pool does not have axisNumbers generated!');
        console.log('   Winners cannot be computed without numbers.');
        console.log('');
        console.log('   SOLUTION: Generate numbers for this pool first.');
    }

    process.exit(0);
}

checkPool().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
