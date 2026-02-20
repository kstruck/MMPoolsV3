import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { Tournament, Game, TournamentSlot, BracketRegion, Team } from "./types";
import { scoreTournamentEntries } from "./bracketScoring";

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

const REGIONS: BracketRegion[] = ['East', 'West', 'South', 'Midwest'];

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
export const initializeTournament = async (
    db: admin.firestore.Firestore,
    tournamentId: string,
    seasonYear: number,
    gender: 'mens' | 'womens',
    teams: Team[] = [] // Optional real data
) => {
    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    // Allow overwrite if teams are provided (Admin re-init)
    const doc = await tournamentRef.get();
    if (doc.exists && teams.length === 0) {
        logger.info(`Tournament ${tournamentId} already exists. Skipping init.`);
        return;
    }

    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    // Helper to find team by region/seed
    const findTeam = (region: string, seed: number, variant?: string): Team | undefined => {
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
                if (topTeam) topTeamId = topTeam.name;
                if (botTeam) botTeamId = botTeam.name;
            }

            // Check if this slot is fed by a First Four game
            const ffGame = FIRST_FOUR_GAMES.find(ff => ff.nextGameId === gameId);
            if (ffGame) {
                // If the bottom seed is the FF one (usually 16 or 11)
                // We'll replace the placeholder with the FF reference
                if (bot === ffGame.seed) {
                    botTeamId = `Winner of ${ffGame.region} ${ffGame.seed} Play-in`;
                } else if (top === ffGame.seed) {
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
    ['E_W', 'S_MW'].forEach((matchup, i) => { // 2 games
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
    const tournamentData: Tournament = {
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

// Helper to map region to FF slot (1 or 2)
function getFFSlot(region: string): number {
    if (region === 'East' || region === 'West') return 1;
    return 2;
}

/**
 * Updates scores for a tournament from ESPN API.
 * For Phase 3 V1, this accepts a 'simulated' payload to let us test the scoring engine.
 */
export const updateTournamentScores = async (
    db: admin.firestore.Firestore,
    tournamentId: string,
    dryRun: boolean = false
) => {
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
            const scoredCount = await scoreTournamentEntries(db, tournamentId);
            logger.info(`Scoring complete. Scored ${scoredCount} entries.`);
        } catch (e) {
            logger.error("Scoring failed after sync:", e);
        }
    }
};

// --- Cloud Functions ---

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

/**
 * Admin-only function to seed the tournament bracket structure.
 * Usage: call with { tournamentId: 'mens-2025', seasonYear: 2025, gender: 'mens', teams: [...] }
 */
export const adminInitTournament = onCall(async (request) => {
    // 1. Auth Check (Admin only)
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new HttpsError('permission-denied', 'Must be an admin to initialize tournament.');
    }

    const { tournamentId, seasonYear, gender, teams } = request.data;
    if (!tournamentId || !seasonYear || !gender) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    const db = admin.firestore();
    await initializeTournament(db, tournamentId, seasonYear, gender, teams);
    return { success: true, message: `Initialized ${tournamentId}` };
});

/**
 * Scheduled function to sync scores every 10 minutes.
 * Also callable manually by admin.
 */
export const syncBracketTournament = onCall(async (request) => {
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new HttpsError('permission-denied', 'Admin only.');
    }

    const db = admin.firestore();
    const tournamentId = request.data.tournamentId || 'mens-2025';
    await updateTournamentScores(db, tournamentId);
    return { success: true };
});

// Scheduled task: Runs every 10 minutes during March Madness
export const scheduledBracketSync = onSchedule("every 10 minutes", async () => {
    const db = admin.firestore();
    // Sync both men's and women's tournaments if active
    await updateTournamentScores(db, 'mens-2025');
    // await updateTournamentScores(db, 'womens-2025');
    logger.info("Scheduled sync complete");
});

// --- ESPN Import Types ---

interface ESPNCompetitor {
    id: string;
    uid: string;
    type: string;
    order: number;
    homeAway: "home" | "away";
    winner?: boolean;
    team: {
        id: string;
        uid: string;
        location: string;
        name: string;
        abbreviation: string;
        displayName: string;
        shortDisplayName: string;
        color?: string;
        alternateColor?: string;
        logo?: string;
    };
    score?: string;
    records?: { summary: string }[];
    curatedRank?: { current: number }; // Added for seed extraction
}

interface ESPNEvent {
    id: string;
    uid: string;
    date: string;
    name: string;
    shortName: string;
    season: { year: number; type: number; slug: string };
    competitions: {
        id: string;
        uid: string;
        date: string;
        attendance: number;
        type: { id: string; abbreviation: string };
        timeValid: boolean;
        neutralSite: boolean;
        venue?: { fullName: string };
        competitors: ESPNCompetitor[];
        notes?: { type: string; headline: string }[];
        status: {
            clock: number;
            displayClock: string;
            period: number;
            type: {
                id: string;
                name: string;
                state: "pre" | "in" | "post";
                completed: boolean;
                detail: string;
                shortDetail: string;
            };
        };
    }[];
    status: {
        type: {
            state: "pre" | "in" | "post";
        };
    };
}

interface ESPNResponse {
    leagues: {
        id: string;
        uid: string;
        name: string;
        abbreviation: string;
        slug: string;
    }[];
    season: { type: number; year: number };
    events: ESPNEvent[];
}

// --- ESPN Fetch & Import Logic ---

async function fetchESPNTournamentData(seasonYear: number): Promise<ESPNEvent[]> {
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
        const data = await response.json() as ESPNResponse;
        return data.events || [];
    } catch (error) {
        logger.error("Failed to fetch ESPN data:", error);
        throw error;
    }
}

/**
 * Imports tournament data from ESPN, mapping existing games and teams.
 */
export const importTournamentFromESPN = onCall(async (request) => {
    // 1. Auth Check
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new HttpsError('permission-denied', 'Admin only.');
    } // Ensure this brace closes the check

    const { tournamentId, seasonYear } = request.data;
    logger.info(`Starting ESPN import for tournament: ${tournamentId}, year: ${seasonYear}`);

    if (!tournamentId || !seasonYear) {
        // Return structured error instead of throwing to debug client side
        return { success: false, message: 'Missing tournamentId or seasonYear' };
    }

    const db = admin.firestore();
    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    try {
        // Validate fetch availability
        if (typeof fetch === 'undefined') {
            logger.error("Global fetch is undefined!");
            return { success: false, message: "Server configuration error: fetch not found" };
        }

        const events = await fetchESPNTournamentData(parseInt(seasonYear));
        logger.info(`Fetched ${events.length} events from ESPN for ${seasonYear}`);

        if (events.length === 0) {
            return { success: false, message: "No events found from ESPN." };
        }

        // Prepare Data Structures
        const games: Record<string, Game> = {};
        const teams: Record<string, Team> = {};

        // MAPPING LOGIC
        for (const event of events) {
            const competition = event.competitions[0];
            const gameId = `espn-${event.id}`;
            const status = competition.status.type.state === 'pre' ? 'SCHEDULED' :
                competition.status.type.state === 'in' ? 'IN_PROGRESS' : 'FINAL';

            // Identify Teams
            const homeComp = competition.competitors.find(c => c.homeAway === 'home');
            const awayComp = competition.competitors.find(c => c.homeAway === 'away');

            if (!homeComp || !awayComp) continue;

            const homeTeamId = homeComp.team.id;
            const awayTeamId = awayComp.team.id;

            // Extract ranks (seeds)
            // ESPN validation: curatedRank is sometimes populated
            const homeSeed = homeComp.curatedRank?.current || 99;
            const awaySeed = awayComp.curatedRank?.current || 99;

            // Store Teams if not exists
            if (!teams[homeTeamId]) {
                teams[homeTeamId] = {
                    id: homeTeamId,
                    name: homeComp.team.displayName,
                    seed: homeSeed,
                    region: 'TBD', // Difficult to pinpoint region without scraping bracket specifically
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
            const game: Game = {
                id: gameId,
                startTime: competition.date,
                status: status === 'FINAL' ? 'FINAL' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED', // status map
                homeTeamId: homeTeamId,
                awayTeamId: awayTeamId,
                homeScore: parseInt(homeComp.score || '0'),
                awayScore: parseInt(awayComp.score || '0'),
                winnerTeamId: status === 'FINAL' ? (parseInt(homeComp.score || '0') > parseInt(awayComp.score || '0') ? homeTeamId : awayTeamId) : undefined,
                round: 1, // Placeholder - needs inference
                region: 'TBD'
            };

            games[gameId] = game;
        }

        // SAVE
        // We preserve existing slots if we update
        await tournamentRef.set({
            id: tournamentId,
            seasonYear: parseInt(seasonYear),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            importedGames: games, // Save as separate collection or field to avoid breaking manual slots?
            importedTeams: teams
        }, { merge: true });

        return { success: true, count: events.length, teams: Object.keys(teams).length };

    } catch (error: unknown) {
        logger.error("Import failed with details:", error);
        // Clean error message for client
        const msg = error instanceof Error ? error.message : "Unknown error";
        return { success: false, message: `Import failed: ${msg}` };
    }
});
