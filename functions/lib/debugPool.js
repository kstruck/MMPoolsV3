"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const admin = require("firebase-admin");
// Initialize Admin used for local testing if key available, else rely on ADC?
// For this environment, we might rely on existing init in index.ts or similar.
// But standalone script needs init.
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    }
    catch (e) {
        console.error("Init failed", e);
    }
}
const db = admin.firestore();
async function debugPool(poolId) {
    console.log(`DEBUGGING POOL: ${poolId}`);
    const doc = await db.collection('pools').doc(poolId).get();
    if (!doc.exists) {
        console.log("Pool not found");
        return;
    }
    const data = doc.data();
    console.log("--- Rule Variations ---");
    console.log(JSON.stringify(data.ruleVariations, null, 2));
    console.log("--- Scores ---");
    console.log(JSON.stringify(data.scores, null, 2));
    console.log("--- Score Events ---");
    // Only show last 5
    const events = data.scoreEvents || [];
    console.log(`Count: ${events.length}`);
    console.log(JSON.stringify(events.slice(-5), null, 2));
    console.log("--- Winners (Subcollection) ---");
    const winnersSnap = await db.collection('pools').doc(poolId).collection('winners').get();
    const winners = winnersSnap.docs.map(d => d.data());
    console.log(`Count: ${winners.length}`);
    winners.slice(-5).forEach(w => {
        console.log(`[${w.period}] ${w.description} - ${w.owner} ($${w.amount})`);
    });
}
// Run
const targetPool = 'rukHR2FurdVwTqmKt3wg'; // The stuck pool
debugPool(targetPool).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=debugPool.js.map