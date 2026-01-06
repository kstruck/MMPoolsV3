
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function inspectPool(poolId) {
    console.log(`Inspecting Pool: ${poolId}`);
    const doc = await db.collection('pools').doc(poolId).get();
    if (!doc.exists) {
        console.log('Pool not found');
        return;
    }
    const data = doc.data();
    console.log('--- Rule Variations ---');
    console.log(JSON.stringify(data.ruleVariations, null, 2));

    console.log('\n--- Scores ---');
    console.log(JSON.stringify(data.scores, null, 2));

    console.log('\n--- Status ---');
    console.log(`UpdatedAt: ${data.updatedAt ? data.updatedAt.toDate() : 'N/A'}`);
    console.log(`GameID: ${data.gameId}`);

    console.log('\n--- Winners Collection ---');
    const winners = await db.collection('pools').doc(poolId).collection('winners').get();
    winners.forEach(w => {
        console.log(`${w.id}: ${JSON.stringify(w.data())}`);
    });
}

inspectPool('eZ1rSmgowfjpe45Cl1hg');
