// Test script to call fixPoolScores function
// Run: node scripts/testFixPool.mjs <poolId>

const poolId = process.argv[2] || '4BLlJSC7CGTAiK3SM6xO';

async function callFixPoolScores() {
    const url = 'https://fixpoolscores-aytocvj4cq-uc.a.run.app';

    console.log(`Calling fixPoolScores for pool: ${poolId}`);
    console.log(`URL: ${url}`);
    console.log('');

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data: { poolId }
            })
        });

        const result = await response.json();

        console.log('Response Status:', response.status);
        console.log('Response:', JSON.stringify(result, null, 2));

        if (result.result) {
            console.log('\n✅ SUCCESS');
            console.log('Updated:', result.result.updated);
            console.log('Message:', result.result.message);
        }
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }
}

callFixPoolScores();
