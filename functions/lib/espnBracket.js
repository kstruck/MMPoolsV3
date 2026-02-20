"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledBracketSync = exports.syncBracketTournament = exports.adminInitTournament = exports.updateTournamentScores = exports.importTournamentFromESPN = exports.initializeTournament = void 0;
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const bracketScoring_1 = require("./bracketScoring");
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
// Standard First Four Matchups (placeholder logic - usually 11 seeds and 16 seeds)
const FIRST_FOUR_GAMES = [
    { id: 'FF-1', region: 'East', seed: 16, nextGameId: 'R1-East-1' }, // 1 vs 16
    { id: 'FF-2', region: 'West', seed: 11, nextGameId: 'R1-West-5' }, // 6 vs 11
    { id: 'FF-3', region: 'Midwest', seed: 16, nextGameId: 'R1-Midwest-1' },
    { id: 'FF-4', region: 'South', seed: 11, nextGameId: 'R1-South-5' }
];
/**
 * Initializes a structured Tournament document in Firestore.
 * Supports 64-team skeleton or 68-team full load.
 */
const initializeTournament = async (db, tournamentId, seasonYear, gender, teams = [] // Optional real data
) => {
    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    // Allow overwrite if teams are provided (Admin re-init)
    const doc = await tournamentRef.get();
    if (doc.exists && teams.length === 0) {
        logger.info(`Tournament ${tournamentId} already exists. Skipping init.`);
        return;
    }
    const games = {};
    const slots = {};
    // Helper to find team by region/seed
    const findTeam = (region, seed, variant) => {
        return teams.find(t => t.region === region && t.seed === seed && (!variant || t.name.includes(variant)));
    };
    // 0. Pre-Create First Four Games (Round 0)
    // We'll insert these into the games map.
    FIRST_FOUR_GAMES.forEach(ff => {
        const gameId = `R0-${ff.region}-${ff.seed}`;
        games[gameId] = {
            id: gameId,
            startTime: new Date().toISOString(),
            status: 'SCHEDULED',
            homeTeamId: `PlayIn ${ff.region} ${ff.seed}a`,
            awayTeamId: `PlayIn ${ff.region} ${ff.seed}b`,
            homeScore: 0,
            awayScore: 0,
            round: 0,
            region: ff.region,
            isFirstFour: true,
            nextGameId: ff.nextGameId
        };
        // Slots for FF? Usually not valid for main bracket picks, but good for UI
        slots[gameId] = { id: gameId, gameId: gameId, nextSlotId: ff.nextGameId };
    });
    // 1. Create Regions & Round 1 Games
    REGIONS.forEach(region => {
        R1_SEED_MATCHUPS.forEach(({ slot, top, bot }) => {
            const gameId = `R1-${region}-${slot}`;
            const slotId = `R1-${region}-${slot}`;
            // Determine Teams
            let topTeamId = `${region} ${top}`;
            let botTeamId = `${region} ${bot}`;
            // If real data
            if (teams.length > 0) {
                const topTeam = findTeam(region, top);
                const botTeam = findTeam(region, bot);
                if (topTeam)
                    topTeamId = topTeam.name;
                if (botTeam)
                    botTeamId = botTeam.name;
            }
            // Check if this slot is fed by a First Four game
            const ffGame = FIRST_FOUR_GAMES.find(ff => ff.nextGameId === gameId);
            if (ffGame) {
                // If the bottom seed is the FF one (usually 16 or 11)
                // We'll replace the placeholder with the FF reference
                if (bot === ffGame.seed) {
                    botTeamId = `Winner of ${ffGame.region} ${ffGame.seed} Play-in`;
                }
                else if (top === ffGame.seed) {
                    topTeamId = `Winner of ${ffGame.region} ${ffGame.seed} Play-in`;
                }
            }
            // Create Game
            games[gameId] = {
                id: gameId,
                startTime: new Date().toISOString(), // TBD
                status: 'SCHEDULED',
                homeTeamId: topTeamId,
                awayTeamId: botTeamId,
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
    await tournamentRef.set(tournamentData, { merge: true });
    logger.info(`Initialized tournament ${tournamentId} with games and ${teams.length} teams.`);
};
exports.initializeTournament = initializeTournament;
// Helper to map region to FF slot (1 or 2)
function getFFSlot(region) {
    if (region === 'East' || region === 'West')
        return 1;
    return 2;
}
/**
 * Shared logic to fetch and map ESPN data.
 */
async function fetchAndMapESPNGameData(seasonYear) {
    var _a, _b, _c, _d, _e, _f, _g;
    // Validate fetch availability
    if (typeof fetch === 'undefined') {
        throw new Error("Server configuration error: fetch not found");
    }
    const events = await fetchESPNTournamentData(seasonYear);
    logger.info(`Fetched ${events.length} events from ESPN for ${seasonYear}`);
    if (events.length === 0) {
        return { games: {}, teams: {}, count: 0 };
    }
    // Prepare Data Structures
    const games = {};
    const teams = {};
    // MAPPING LOGIC
    for (const event of events) {
        const competition = event.competitions[0];
        const gameId = `espn-${event.id}`;
        const status = competition.status.type.state === 'pre' ? 'SCHEDULED' :
            competition.status.type.state === 'in' ? 'IN_PROGRESS' : 'FINAL';
        // Identify Teams
        const homeComp = competition.competitors.find(c => c.homeAway === 'home');
        const awayComp = competition.competitors.find(c => c.homeAway === 'away');
        if (!homeComp || !awayComp)
            continue;
        const homeTeamId = homeComp.team.id;
        const awayTeamId = awayComp.team.id;
        // Extract ranks (seeds)
        const homeSeed = ((_a = homeComp.curatedRank) === null || _a === void 0 ? void 0 : _a.current) || 99;
        const awaySeed = ((_b = awayComp.curatedRank) === null || _b === void 0 ? void 0 : _b.current) || 99;
        // Store Teams if not exists
        if (!teams[homeTeamId]) {
            teams[homeTeamId] = {
                id: homeTeamId,
                name: homeComp.team.displayName,
                seed: homeSeed,
                region: 'TBD',
                logoUrl: homeComp.team.logo
            };
        }
        if (!teams[awayTeamId]) {
            teams[awayTeamId] = {
                id: awayTeamId,
                name: awayComp.team.displayName,
                seed: awaySeed,
                region: 'TBD',
                logoUrl: awayComp.team.logo
            };
        }
        // Create Game
        const game = {
            id: gameId,
            startTime: competition.date,
            status: status === 'FINAL' ? 'FINAL' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED',
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId,
            homeScore: parseInt(homeComp.score || '0'),
            awayScore: parseInt(awayComp.score || '0'),
            winnerTeamId: status === 'FINAL' ? (parseInt(homeComp.score || '0') > parseInt(awayComp.score || '0') ? homeTeamId : awayTeamId) : undefined,
            round: 1, // Placeholder
            region: 'TBD',
            // Live Score Details
            period: (_c = competition.status) === null || _c === void 0 ? void 0 : _c.period,
            clock: (_d = competition.status) === null || _d === void 0 ? void 0 : _d.displayClock, // e.g. "12:35"
            broadcast: (_g = (_f = (_e = competition.broadcasts) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.names) === null || _g === void 0 ? void 0 : _g[0], // e.g. "CBS"
            externalId: event.id
        };
        games[gameId] = game;
    }
    return { games, teams, count: events.length };
}
/**
 * Imports tournament data from ESPN, mapping existing games and teams.
 */
exports.importTournamentFromESPN = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c;
    // 1. Auth Check - Super Admin Only
    let role = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.role;
    if (!role && ((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid)) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.role;
    }
    if (role !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Super Admin only.');
    }
    const { tournamentId, seasonYear } = request.data;
    logger.info(`Starting ESPN import for tournament: ${tournamentId}, year: ${seasonYear}`);
    if (!tournamentId || !seasonYear) {
        return { success: false, message: 'Missing tournamentId or seasonYear' };
    }
    const db = admin.firestore();
    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    try {
        const { games, teams, count } = await fetchAndMapESPNGameData(parseInt(seasonYear));
        if (count === 0) {
            return { success: false, message: "No events found from ESPN." };
        }
        // SAVE
        await tournamentRef.set({
            id: tournamentId,
            seasonYear: parseInt(seasonYear),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            importedGames: games,
            importedTeams: teams
        }, { merge: true });
        return { success: true, count, teams: Object.keys(teams).length };
    }
    catch (error) {
        logger.error("Import failed with details:", error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        return { success: false, message: `Import failed: ${msg}` };
    }
});
/**
 * Updates scores for a tournament from ESPN API.
 */
const updateTournamentScores = async (db, tournamentId, dryRun = false) => {
    logger.info(`Syncing tournament scores for ${tournamentId}...`);
    try {
        // Assume tournamentId format "mens-2025" -> 2025
        const seasonYear = parseInt(tournamentId.split('-')[1] || '2025');
        const { games, teams, count } = await fetchAndMapESPNGameData(seasonYear);
        logger.info(`Mapped ${count} games for sync.`);
        if (!dryRun && count > 0) {
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            // Update importedGames and lastUpdated
            // We can also update importedTeams if we want to keep logos fresh, etc.
            await tournamentRef.set({
                importedGames: games,
                importedTeams: teams,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            // Trigger internal scoring (noop if main bracket not linked yet)
            try {
                const scoredCount = await (0, bracketScoring_1.scoreTournamentEntries)(db, tournamentId);
                logger.info(`Scoring complete. Scored ${scoredCount} entries.`);
            }
            catch (e) {
                logger.error("Scoring failed after sync:", e);
            }
        }
    }
    catch (error) {
        logger.error("updateTournamentScores failed:", error);
    }
};
exports.updateTournamentScores = updateTournamentScores;
// --- Cloud Functions ---
/**
 * Admin-only function to seed the tournament bracket structure.
 * Usage: call with { tournamentId: 'mens-2025', seasonYear: 2025, gender: 'mens', teams: [...] }
 */
exports.adminInitTournament = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c;
    // 1. Auth Check (Admin only)
    let role = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.role;
    if (!role && ((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid)) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.role;
    }
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Must be an admin to initialize tournament.');
    }
    const { tournamentId, seasonYear, gender, teams } = request.data;
    if (!tournamentId || !seasonYear || !gender) {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields.');
    }
    const db = admin.firestore();
    await (0, exports.initializeTournament)(db, tournamentId, seasonYear, gender, teams);
    return { success: true, message: `Initialized ${tournamentId}` };
});
/**
 * Scheduled function to sync scores every 10 minutes.
 * Also callable manually by admin.
 */
exports.syncBracketTournament = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c;
    let role = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.token.role;
    if (!role && ((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid)) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.role;
    }
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Admin only.');
    }
    const db = admin.firestore();
    const tournamentId = request.data.tournamentId || 'mens-2025';
    await (0, exports.updateTournamentScores)(db, tournamentId);
    return { success: true };
});
// Scheduled task: Runs every 10 minutes during March Madness
exports.scheduledBracketSync = (0, scheduler_1.onSchedule)("every 10 minutes", async () => {
    const db = admin.firestore();
    // Sync both men's and women's tournaments if active
    await (0, exports.updateTournamentScores)(db, 'mens-2025');
    // await updateTournamentScores(db, 'womens-2025');
    logger.info("Scheduled sync complete");
});
// --- ESPN Fetch & Import Logic ---
async function fetchESPNTournamentData(seasonYear) {
    // 2025 Dates: Selection Sunday (March 16) to Championship (April 7)
    // We can just fetch a wide range or distinct "groups" for tournament (group=100 usually for NCAA Tournament)
    // But specific date range is safer if group ID changes.
    // For 2026: 20260317-20260406
    // Better yet, just fetch "postseason" via specific endpoint logic if available, 
    // but the scoreboard endpoint with dates is reliable.
    const start = `${seasonYear}0315`;
    const end = `${seasonYear}0410`;
    const limit = 200; // Should cover all 67 games
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${start}-${end}&limit=${limit}&groups=100`; // group 100 is typically NCAA Tournament
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.events || [];
    }
    catch (error) {
        logger.error("Failed to fetch ESPN data:", error);
        throw error;
    }
}
//# sourceMappingURL=espnBracket.js.map