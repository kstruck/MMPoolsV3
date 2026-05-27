const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'march-melee-pools' });
}

const db = admin.firestore();

async function backfillHistoricalStats() {
    console.log("Starting backfill for Super Bowl Squares pools...");

    try {
        // Fetch all SQUARES pools
        const poolsSnap = await db.collection("pools")
            .where("type", "==", "SQUARES")
            .get();

        const userStatsMap = new Map(); // uid -> UserHistoricalStats
        const managerStatsMap = new Map(); // uid -> ManagerHistoricalStats

        for (const doc of poolsSnap.docs) {
            const pool = doc.data();
            // Filter only super bowl squares (either sport = 'Super Bowl' or week = 5 or name contains 'Super Bowl')
            const isSuperBowl = (pool.sport && pool.sport.toLowerCase().includes('super bowl')) ||
                                (pool.name && pool.name.toLowerCase().includes('super bowl')) ||
                                (pool.week === 5); // Week 5 of postseason

            if (!isSuperBowl) {
                continue;
            }

            console.log(`Processing Super Bowl pool: ${doc.id} - ${pool.name}`);

            const managerUid = pool.managerUid || pool.ownerId;
            const costPerSquare = pool.costPerSquare || 0;
            
            // Increment Manager Stats
            if (managerUid) {
                if (!managerStatsMap.has(managerUid)) {
                    managerStatsMap.set(managerUid, { poolsManaged: 0, totalRevenue: 0, totalPayouts: 0, totalParticipants: 0 });
                }
                const mStats = managerStatsMap.get(managerUid);
                mStats.poolsManaged += 1;
                
                // Calculate squares sold
                const squaresSold = (pool.squares || []).filter(s => s.owner).length;
                const uniqueParticipants = new Set((pool.squares || []).filter(s => s.reservedByUid).map(s => s.reservedByUid)).size;
                const revenue = squaresSold * costPerSquare;

                mStats.totalRevenue += revenue;
                mStats.totalParticipants += uniqueParticipants;
                // Payouts handled via winners collection
            }

            // Get winners
            const winnersSnap = await db.collection("pools").doc(doc.id).collection("winners").get();
            const winners = winnersSnap.docs.map(d => d.data());

            // Add payouts to manager
            if (managerUid) {
                const totalPayouts = winners.reduce((sum, w) => sum + (w.amount || 0), 0);
                managerStatsMap.get(managerUid).totalPayouts += totalPayouts;
            }

            // Increment User Stats
            for (const square of (pool.squares || [])) {
                if (!square.reservedByUid) continue;
                const uid = square.reservedByUid;
                
                if (!userStatsMap.has(uid)) {
                    userStatsMap.set(uid, {
                        totalPoints: 0, totalWinnings: 0, totalLosses: 0, poolsEntered: 0,
                        poolsWon: 0, correctPicks: 0, incorrectPicks: 0, marginDifferential: 0
                    });
                }
                
                const uStats = userStatsMap.get(uid);
                uStats.totalLosses += costPerSquare; // Add to losses initially, winnings offset it later
            }

            // Distinct pools entered logic
            const uidsInPool = new Set((pool.squares || []).filter(s => s.reservedByUid).map(s => s.reservedByUid));
            for (const uid of uidsInPool) {
                userStatsMap.get(uid).poolsEntered += 1;
            }

            // Handle Winnings
            for (const winner of winners) {
                const squareId = winner.squareId;
                const square = (pool.squares || []).find(s => s.id === squareId);
                if (square && square.reservedByUid) {
                    const uid = square.reservedByUid;
                    if (!userStatsMap.has(uid)) continue; // Defensive
                    
                    const uStats = userStatsMap.get(uid);
                    uStats.totalWinnings += (winner.amount || 0);
                    uStats.poolsWon += 1; 
                }
            }
        }

        console.log(`Prepared stats for ${userStatsMap.size} users and ${managerStatsMap.size} managers.`);

        // Batch writes
        let batch = db.batch();
        let ops = 0;

        for (const [uid, stats] of userStatsMap.entries()) {
            const userRef = db.collection('users').doc(uid);
            batch.set(userRef, { historicalStats: stats }, { merge: true });
            ops++;
            if (ops >= 400) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }

        for (const [uid, stats] of managerStatsMap.entries()) {
            const userRef = db.collection('users').doc(uid);
            batch.set(userRef, { managerStats: stats }, { merge: true });
            ops++;
            if (ops >= 400) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }

        if (ops > 0) {
            await batch.commit();
        }

        console.log("Backfill complete.");

    } catch (error) {
        console.error("Error during backfill:", error);
    }
}

backfillHistoricalStats();
