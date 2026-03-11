const admin = require('firebase-admin');
const { initializeBig12Tournament } = require('./lib/conferenceTournaments');

try {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'gridiron-gamble-uzuqo'
    });
} catch (e) {
    console.log('App already initialized');
}

const db = admin.firestore();

async function run() {
    try {
        await initializeBig12Tournament(db, 'big12-2026', true);
        console.log('SUCCESS: big12-2026 tournament re-initialized with correct 2026 seeds!');
        process.exit(0);
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exit(1);
    }
}

run();
