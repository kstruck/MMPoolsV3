"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledBracketSync = exports.syncBracketTournament = exports.adminInitTournament = exports.updateTournamentScores = exports.initializeTournament = void 0;
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
// Standard mapping of Seed match-ups for Round 1
// Slot 1: 1 vs 16. Slot 2: 8 vs 9. Slot 3: 5 vs 12. Slot 4: 4 vs 13.
// Slot 5: 6 vs 11. Slot 6: 3 vs 14. Slot 7: 7 vs 10. Slot 8: 2 vs 15.
const R1_SEED_MATCHUPS = [
    { slot: 1, top: 1, bot: 16 },
    { slot: 2, top: 8, bot: 9 },
    { slot: 3, top: 5, bot: 12 },
    { slot: 4, top: 4, bot: 13 },
    { slot: 5, top: 6, bot: 11 },
    { slot: 6, top: 3, bot: 14 },
    { slot: 7, top: 7, bot: 10 },
    { slot: 8, top: 2, bot: 15 }
];
const REGIONS = ['East', 'West', 'South', 'Midwest'];
/**
 * Initializes a structured Tournament document in Firestore.
 * Since the real bracket isn't out, this seeds it with placeholders or 2024 data if configured.
 */
const initializeTournament = async (db, tournamentId, seasonYear, gender) => {
    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    // Check if exists
    const doc = await tournamentRef.get();
    if (doc.exists) {
        logger.info(`Tournament ${tournamentId} already exists. Skipping init.`);
        return;
    }
    const games = {};
    const slots = {};
    // 1. Create Regions & Round 1 Games
    REGIONS.forEach(region => {
        R1_SEED_MATCHUPS.forEach(({ slot, top, bot }) => {
            const gameId = `R1-${region}-${slot}`;
            const slotId = `R1-${region}-${slot}`;
            // Create Game
            games[gameId] = {
                id: gameId,
                startTime: new Date().toISOString(), // TBD
                status: 'SCHEDULED',
                homeTeamId: `${region} ${top}`, // Placeholder ID
                awayTeamId: `${region} ${bot}`,
                homeScore: 0,
                awayScore: 0,
                round: 1,
                region: region
            };
            // Create Slot
            slots[slotId] = {
                id: slotId,
                gameId: gameId,
                nextSlotId: `R2-${region}-${Math.ceil(slot / 2)}`
            };
        });
        // Round 2 (4 games)
        for (let i = 1; i <= 4; i++) {
            const gameId = `R2-${region}-${i}`;
            games[gameId] = {
                id: gameId,
                startTime: new Date().toISOString(),
                status: 'SCHEDULED',
                homeTeamId: '', // TBD
                awayTeamId: '',
                homeScore: 0,
                awayScore: 0,
                round: 2,
                region: region
            };
            slots[gameId] = { id: gameId, gameId: gameId, nextSlotId: `R3-${region}-${Math.ceil(i / 2)}` };
        }
        // Round 3 (Sweet 16 - 2 games)
        for (let i = 1; i <= 2; i++) {
            const gameId = `R3-${region}-${i}`;
            games[gameId] = {
                id: gameId,
                startTime: new Date().toISOString(),
                status: 'SCHEDULED',
                homeTeamId: '',
                awayTeamId: '',
                homeScore: 0,
                awayScore: 0,
                round: 3,
                region: region
            };
            slots[gameId] = { id: gameId, gameId: gameId, nextSlotId: `R4-${region}-${1}` }; // All go to R4-1 (Elite 8)
        }
        // Round 4 (Elite 8 - 1 game)
        const r4Id = `R4-${region}-1`;
        games[r4Id] = {
            id: r4Id,
            startTime: new Date().toISOString(),
            status: 'SCHEDULED',
            homeTeamId: '',
            awayTeamId: '',
            homeScore: 0,
            awayScore: 0,
            round: 4,
            region: region
        };
        slots[r4Id] = { id: r4Id, gameId: r4Id, nextSlotId: `R5-FF-${getFFSlot(region)}` };
    });
    // Final Four (Round 5)
    // Semifinal 1: East vs West (Standard rotation varies, using placeholder)
    ['E_W', 'S_MW'].forEach((matchup, i) => {
        const gameId = `R5-FF-${i + 1}`;
        games[gameId] = {
            id: gameId,
            startTime: new Date().toISOString(),
            status: 'SCHEDULED',
            homeTeamId: '',
            awayTeamId: '',
            homeScore: 0,
            awayScore: 0,
            round: 5,
            region: 'Final Four'
        };
        slots[gameId] = { id: gameId, gameId: gameId, nextSlotId: 'R6-CHAMP-1' };
    });
    // Championship (Round 6)
    const champId = 'R6-CHAMP-1';
    games[champId] = {
        id: champId,
        startTime: new Date().toISOString(),
        status: 'SCHEDULED',
        homeTeamId: '',
        awayTeamId: '',
        homeScore: 0,
        awayScore: 0,
        round: 6,
        region: 'Final Four' // or Championship
    };
    slots[champId] = { id: champId, gameId: champId };
    // Write to DB
    const tournamentData = {
        id: tournamentId,
        seasonYear,
        gender,
        isFinalized: false,
        games,
        slots
    };
    await tournamentRef.set(tournamentData);
    logger.info(`Initialized tournament ${tournamentId} with 63 games.`);
};
exports.initializeTournament = initializeTournament;
// Helper to map region to FF slot (1 or 2)
function getFFSlot(region) {
    if (region === 'East' || region === 'West')
        return 1;
    return 2;
}
const bracketScoring_1 = require("./bracketScoring");
/**
 * Updates scores for a tournament from ESPN API.
 * For Phase 3 V1, this accepts a 'simulated' payload to let us test the scoring engine.
 */
const updateTournamentScores = async (db, tournamentId, dryRun = false) => {
    // Phase 3: just return mock log for now until we hook up the real URL
    logger.info("Syncing tournament scores...");
    // In real implementation:
    // 1. Fetch ESPN Scoreboard
    // 2. Map ESPN events to games[].externalId
    // 3. Update scores and statuses
    // 4. If winner decided, advance to nextSlotId
    // For now, we'll manually implement a "Simulator" in the frontend or calling simple update
    if (!dryRun) {
        try {
            const scoredCount = await (0, bracketScoring_1.scoreTournamentEntries)(db, tournamentId);
            logger.info(`Scoring complete. Scored ${scoredCount} entries.`);
        }
        catch (e) {
            logger.error("Scoring failed after sync:", e);
        }
    }
};
exports.updateTournamentScores = updateTournamentScores;
// --- Cloud Functions ---
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
/**
 * Admin-only function to seed the tournament bracket structure.
 * Usage: call with { tournamentId: 'mens-2025', seasonYear: 2025, gender: 'mens' }
 */
exports.adminInitTournament = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check (Admin only)
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Must be an admin to initialize tournament.');
    }
    const { tournamentId, seasonYear, gender } = request.data;
    if (!tournamentId || !seasonYear || !gender) {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields.');
    }
    const db = admin.firestore();
    await (0, exports.initializeTournament)(db, tournamentId, seasonYear, gender);
    return { success: true, message: `Initialized ${tournamentId}` };
});
/**
 * Scheduled function to sync scores every 10 minutes.
 * Also callable manually by admin.
 */
exports.syncBracketTournament = (0, https_1.onCall)(async (request) => {
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Admin only.');
    }
    const db = admin.firestore();
    const tournamentId = request.data.tournamentId || 'mens-2025';
    await (0, exports.updateTournamentScores)(db, tournamentId);
    return { success: true };
});
// Scheduled task: Runs every 10 minutes during March Madness
exports.scheduledBracketSync = (0, scheduler_1.onSchedule)("every 10 minutes", async (event) => {
    const db = admin.firestore();
    // Sync both men's and women's tournaments if active
    await (0, exports.updateTournamentScores)(db, 'mens-2025');
    // await updateTournamentScores(db, 'womens-2025');
    logger.info("Scheduled sync complete");
});
//# sourceMappingURL=espnBracket.js.map