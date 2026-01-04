/**
 * Helper script to manually trigger score sync for a specific pool
 * Usage: node scripts/fixPoolScores.js <poolId>
 * Example: node scripts/fixPoolScores.js 4BLlJSC7CGTAiK3SM6xO
 */

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function fixPoolScores(poolId) {
    try {
        console.log(`\n🔧 Starting score fix for pool: ${poolId}\n`);

        const poolRef = db.collection('pools').doc(poolId);
        const poolDoc = await poolRef.get();

        if (!poolDoc.exists) {
            console.error(`❌ Pool ${poolId} not found!`);
            process.exit(1);
        }

        const pool = poolDoc.data();
        console.log(`📊 Pool: ${pool.homeTeam} vs ${pool.awayTeam}`);
        console.log(`⚙️  Every Score Pays: ${pool.ruleVariations?.scoreChangePayout ? 'YES' : 'NO'}`);
        console.log(`📈 Current Score: ${pool.scores?.current?.home || 0} - ${pool.scores?.current?.away || 0}`);
        console.log(`🎮 Game Status: ${pool.scores?.gameStatus || 'unknown'}\n`);

        if (!pool.gameId) {
            console.error('❌ Pool has no gameId. Cannot sync scores.');
            process.exit(1);
        }

        // Import the fixPoolScores function
        // Note:  Since we're calling from a script, we need to manually import the function logic
        // For now, let's use the Firebase Admin SDK to call the deployed function

        const functions = require('firebase-functions-test')();
        const fixPoolScoresModule = require('../functions/lib/scoreUpdates');

        console.log('🚀 Calling fixPoolScores function...\n');

        const result = await fixPoolScoresModule.fixPoolScores.run({
            data: { poolId }
        });

        console.log('\n✅ Fix completed!');
        console.log('📋 Result:', JSON.stringify(result, null, 2));

        // Fetch updated pool data
        const updatedPoolDoc = await poolRef.get();
        const updatedPool = updatedPoolDoc.data();

        console.log(`\n📊 Updated Score Events: ${updatedPool.scoreEvents?.length || 0}`);
        console.log(`🏆 Winners Collection: Checking...`);

        const winnersSnap = await poolRef.collection('winners').get();
        console.log(`🏆 Total Winners: ${winnersSnap.size}\n`);

        if (pool.ruleVariations?.scoreChangePayout) {
            console.log('💡 Verify winners in Firebase Console:');
            console.log(`   https://console.firebase.google.com/project/${admin.app().options.projectId}/firestore/data/pools/${poolId}/winners\n`);
        }

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error fixing pool scores:', error);
        process.exit(1);
    }
}

// Get poolId from command line
const poolId = process.argv[2];

if (!poolId) {
    console.error('Usage: node scripts/fixPoolScores.js <poolId>');
    console.error('Example: node scripts/fixPoolScores.js 4BLlJSC7CGTAiK3SM6xO');
    process.exit(1);
}

fixPoolScores(poolId);
