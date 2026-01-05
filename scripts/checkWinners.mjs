// Direct Firestore query to check pool winners after fix
// Run: node scripts/checkWinners.mjs <poolId>

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const poolId = process.argv[2] || '4BLlJSC7CGTAiK3SM6xO';

async function checkWinners() {
    try {
        // Initialize Firebase Admin (requires service account)
        // For now, just fetch via HTTP to see if pool exists
        console.log(`Checking pool: ${poolId}`);
        console.log('');

        // Use Firebase REST API to check pool data
        const poolUrl = `https://firestore.googleapis.com/v1/projects/gridiron-gamble-uzuqo/databases/(default)/documents/pools/${poolId}`;

        const response = await fetch(poolUrl);
        if (!response.ok) {
            console.log('❌ Pool not found or not accessible');
            return;
        }

        const poolData = await response.json();
        console.log('Pool found:', poolData.fields?.name?.stringValue || 'Unknown');

        // Check for scoreEvents
        if (poolData.fields?.scoreEvents) {
            console.log('\\nScore Events:', poolData.fields.scoreEvents);
        }

        // Check for winners subcollection
        const winnersUrl = `https://firestore.googleapis.com/v1/projects/gridiron-gamble-uzuqo/databases/(default)/documents/pools/${poolId}/winners`;
        const winnersRes = await fetch(winnersUrl);

        if (winnersRes.ok) {
            const winnersData = await winnersRes.json();
            console.log('\\nWinners found:', winnersData.documents?.length || 0);

            if (winnersData.documents) {
                winnersData.documents.forEach(doc => {
                    const name = doc.name.split('/').pop();
                    const period = doc.fields?.period?.stringValue;
                    const owner = doc.fields?.owner?.stringValue;
                    const desc = doc.fields?.description?.stringValue;
                    console.log(`  - ${name}: ${period} - ${owner} - ${desc}`);
                });
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkWinners();
