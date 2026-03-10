const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function backfillBracketPoolParticipants() {
    console.log('Starting backfill of bracket pool participantIds...');

    try {
        // Find all pools of type BRACKET
        const poolsSnapshot = await db.collection('pools').where('type', '==', 'BRACKET').get();
        console.log(`Found ${poolsSnapshot.size} bracket pools.`);

        let updatedCount = 0;

        for (const poolDoc of poolsSnapshot.docs) {
            const poolId = poolDoc.id;
            const poolData = poolDoc.data();
            console.log(`Processing pool: ${poolId} (${poolData.name})`);

            // Find all entries for this pool
            const entriesSnapshot = await db.collection('pools').doc(poolId).collection('entries').get();
            const uniqueParticipants = new Set();

            // The owner of the pool should also be a participant
            if (poolData.ownerId) {
                uniqueParticipants.add(poolData.ownerId);
            }

            entriesSnapshot.forEach(entryDoc => {
                const entryData = entryDoc.data();
                if (entryData.ownerUid) {
                    uniqueParticipants.add(entryData.ownerUid);
                }
            });

            const participantIds = Array.from(uniqueParticipants);

            // Update pool with correct participantIds
            await poolDoc.ref.update({
                participantIds: participantIds
            });

            console.log(`Updated pool ${poolId} with ${participantIds.length} participantIds.`);
            updatedCount++;
        }

        console.log(`Backfill complete. Updated ${updatedCount} bracket pools.`);
        process.exit(0);
    } catch (error) {
        console.error('Error during backfill:', error);
        process.exit(1);
    }
}

backfillBracketPoolParticipants();
