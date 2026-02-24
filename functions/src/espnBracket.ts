import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
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

    // Default lockAt: First round of NCAA tournament starts ~March 20
    // For 2025: March 20, 2025 12:00 PM ET
    const defaultLockAt = seasonYear === 2025
        ? new Date('2025-03-20T12:00:00-04:00').getTime()
        : new Date(`${seasonYear}-03-15T12:00:00-04:00`).getTime();

    // Write to DB
    const tournamentData: Tournament = {
        id: tournamentId,
        seasonYear,
        gender,
        isFinalized: false,
        status: 'ACTIVE',
        lockAt: defaultLockAt,
        games,
        slots
    };

    await tournamentRef.set(tournamentData, { merge: true });
    logger.info(`Initialized tournament ${tournamentId} with lockAt=${new Date(defaultLockAt).toISOString()} and ${teams.length} teams.`);
};

// Helper to map region to FF slot (1 or 2)
function getFFSlot(region: string): number {
    if (region === 'East' || region === 'West') return 1;
    return 2;
}

/**
 * Shared logic to fetch and map ESPN data.
 */
async function fetchAndMapESPNGameData(seasonYear: number) {
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
    const games: Record<string, Game> = {};
    const teams: Record<string, Team> = {};

    // MAPPING LOGIC
    for (const event of events) {
        const competition = event.competitions[0];
        const gameId = `espn-${event.id}`;
        const status = competition.status.type.state === 'pre' ? 'SCHEDULED' :
            competition.status.type.state === 'in' ? 'IN_PROGRESS' : 'FINAL';

        // --- WS5: Parse region and round from notes[].headline ---
        const { region, round } = parseRegionAndRound(competition.notes);

        // Identify Teams
        const homeComp = competition.competitors.find(c => c.homeAway === 'home');
        const awayComp = competition.competitors.find(c => c.homeAway === 'away');

        if (!homeComp || !awayComp) continue;

        const homeTeamId = homeComp.team.id;
        const awayTeamId = awayComp.team.id;

        // --- WS4: Extract actual tournament seed from team name, e.g. "(1) Duke Blue Devils" ---
        const homeSeed = parseSeedFromName(homeComp.team.displayName) || homeComp.curatedRank?.current || 99;
        const awaySeed = parseSeedFromName(awayComp.team.displayName) || awayComp.curatedRank?.current || 99;

        // Strip seed prefix from name for cleaner display, e.g. "(1) Duke Blue Devils" -> "Duke Blue Devils"
        const homeDisplayName = homeComp.team.displayName.replace(/^\(\d+\)\s*/, '');
        const awayDisplayName = awayComp.team.displayName.replace(/^\(\d+\)\s*/, '');

        // Store Teams if not exists (update region if we now know it)
        if (!teams[homeTeamId]) {
            teams[homeTeamId] = {
                id: homeTeamId,
                name: homeDisplayName,
                seed: homeSeed,
                region: region,
                logoUrl: homeComp.team.logo
            };
        } else if (teams[homeTeamId].region === 'TBD' && region !== 'TBD') {
            teams[homeTeamId].region = region;
        }
        if (!teams[awayTeamId]) {
            teams[awayTeamId] = {
                id: awayTeamId,
                name: awayDisplayName,
                seed: awaySeed,
                region: region,
                logoUrl: awayComp.team.logo
            };
        } else if (teams[awayTeamId].region === 'TBD' && region !== 'TBD') {
            teams[awayTeamId].region = region;
        }

        // Create Game
        const game: Game = {
            id: gameId,
            startTime: competition.date,
            status: status === 'FINAL' ? 'FINAL' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED',
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId,
            homeScore: parseInt(homeComp.score || '0'),
            awayScore: parseInt(awayComp.score || '0'),
            winnerTeamId: status === 'FINAL' ? (parseInt(homeComp.score || '0') > parseInt(awayComp.score || '0') ? homeTeamId : awayTeamId) : undefined,
            round: round,
            region: region,

            // Live Score Details
            period: competition.status?.period,
            clock: competition.status?.displayClock, // e.g. "12:35"
            broadcast: competition.broadcasts?.[0]?.names?.[0], // e.g. "CBS"
            externalId: event.id
        };

        games[gameId] = game;
    }

    return { games, teams, count: events.length };
}

/**
 * WS4: Parse tournament seed from team display name.
 * ESPN formats tournament teams as "(1) Duke Blue Devils".
 * Returns the numeric seed or null if not found.
 */
function parseSeedFromName(displayName: string): number | null {
    const match = displayName.match(/^\((\d+)\)/);
    return match ? parseInt(match[1]) : null;
}

/**
 * WS5: Parse region and round from ESPN notes[].headline.
 * ESPN provides headlines like:
 *   "East Region - First Round"
 *   "South Region - Second Round"
 *   "West Region - Sweet 16"
 *   "Midwest Region - Elite Eight"
 *   "Final Four - National Semifinals"
 *   "National Championship"
 *   "First Four - East"
 */
function parseRegionAndRound(notes?: { type: string; headline: string }[]): { region: string; round: number } {
    if (!notes || notes.length === 0) return { region: 'TBD', round: 1 };

    // Find the headline note (usually type="event")
    const headline = notes.find(n => n.headline)?.headline || '';
    if (!headline) return { region: 'TBD', round: 1 };

    // Parse round from headline
    let round = 1;
    const headlineLower = headline.toLowerCase();
    if (headlineLower.includes('first four')) round = 0;
    else if (headlineLower.includes('first round')) round = 1;
    else if (headlineLower.includes('second round')) round = 2;
    else if (headlineLower.includes('sweet 16') || headlineLower.includes('sweet sixteen')) round = 3;
    else if (headlineLower.includes('elite eight') || headlineLower.includes('elite 8')) round = 4;
    else if (headlineLower.includes('final four') || headlineLower.includes('national semifinal')) round = 5;
    else if (headlineLower.includes('national championship') || headlineLower.includes('championship')) round = 6;

    // Parse region from headline
    let region = 'TBD';
    if (headlineLower.includes('east')) region = 'East';
    else if (headlineLower.includes('west')) region = 'West';
    else if (headlineLower.includes('south')) region = 'South';
    else if (headlineLower.includes('midwest')) region = 'Midwest';
    else if (round >= 5) region = 'Final Four'; // Final Four + Championship have no region

    return { region, round };
}

/**
 * WS1: Maps ESPN imported games to the skeleton games structure.
 * 
 * Algorithm:
 * - Round 1: Match by region + seed matchup (e.g. East seeds 1v16 → R1-East-1)
 * - Round 2-4: Match by feeder game winners cascading upward
 * - Round 5 (Final Four): Match by which region winners are playing
 * - Round 6 (Championship): Only 1 game at this round
 * 
 * Returns updated skeleton games map ready to write to Firestore.
 */
function mapESPNGamesToSkeleton(
    skeletonGames: Record<string, Game>,
    espnGames: Record<string, Game>,
    espnTeams: Record<string, Team>
): { updatedGames: Record<string, Game>; mappedCount: number } {
    const updated = { ...skeletonGames };
    let mappedCount = 0;

    // Index ESPN games by region+round for fast lookup
    const espnByRegionRound: Record<string, Game[]> = {};
    for (const g of Object.values(espnGames)) {
        const key = `${g.region}-${g.round}`;
        if (!espnByRegionRound[key]) espnByRegionRound[key] = [];
        espnByRegionRound[key].push(g);
    }

    // Helper: get team seed from espnTeams map
    const getTeamSeed = (teamId: string): number => espnTeams[teamId]?.seed || 99;

    // Build a map of skeleton game ID → ESPN game ID for cascading
    const skeletonToEspn: Record<string, Game> = {};

    // --- ROUND 1: Match by region + seed matchup ---
    for (const region of REGIONS) {
        for (const { slot, top, bot } of R1_SEED_MATCHUPS) {
            const skeletonId = `R1-${region}-${slot}`;
            if (!updated[skeletonId]) continue;

            // Find ESPN game in this region, round 1, where team seeds match this matchup
            const candidates = espnByRegionRound[`${region}-1`] || [];
            const match = candidates.find(eg => {
                const homeSeed = getTeamSeed(eg.homeTeamId);
                const awaySeed = getTeamSeed(eg.awayTeamId);
                return (homeSeed === top && awaySeed === bot) || (homeSeed === bot && awaySeed === top);
            });

            if (match) {
                // Ensure higher seed (lower number) is homeTeamId for consistency
                const homeSeed = getTeamSeed(match.homeTeamId);
                const topTeamId = homeSeed === top ? match.homeTeamId : match.awayTeamId;
                const botTeamId = homeSeed === top ? match.awayTeamId : match.homeTeamId;
                const topScore = homeSeed === top ? match.homeScore : match.awayScore;
                const botScore = homeSeed === top ? match.awayScore : match.homeScore;

                updated[skeletonId] = {
                    ...updated[skeletonId],
                    homeTeamId: topTeamId,
                    awayTeamId: botTeamId,
                    homeScore: topScore,
                    awayScore: botScore,
                    status: match.status,
                    winnerTeamId: match.winnerTeamId,
                    startTime: match.startTime,
                    period: match.period,
                    clock: match.clock,
                    broadcast: match.broadcast,
                    externalId: match.externalId,
                };
                skeletonToEspn[skeletonId] = match;
                mappedCount++;
            }
        }
    }

    // --- ROUNDS 2-4: Match by feeder game winners ---
    for (let round = 2; round <= 4; round++) {
        for (const region of REGIONS) {
            const gamesInRound = round === 2 ? 4 : round === 3 ? 2 : 1;
            for (let i = 1; i <= gamesInRound; i++) {
                const skeletonId = `R${round}-${region}-${i}`;
                if (!updated[skeletonId]) continue;

                // Determine which 2 feeder games feed into this game
                // Feeder structure: R2-Region-1 gets R1-Region-1 & R1-Region-2
                // R2-Region-2 gets R1-Region-3 & R1-Region-4, etc.
                // General: R(N)-Region-i gets R(N-1)-Region-(2i-1) & R(N-1)-Region-(2i)
                const feeder1Id = `R${round - 1}-${region}-${2 * i - 1}`;
                const feeder2Id = `R${round - 1}-${region}-${2 * i}`;

                const feeder1 = updated[feeder1Id];
                const feeder2 = updated[feeder2Id];

                if (!feeder1?.winnerTeamId || !feeder2?.winnerTeamId) {
                    // Can't map if feeder winners aren't known yet
                    continue;
                }

                // Find ESPN game in this region+round where these two teams are playing
                const candidates = espnByRegionRound[`${region}-${round}`] || [];
                const expectedTeams = new Set([feeder1.winnerTeamId, feeder2.winnerTeamId]);
                const match = candidates.find(eg =>
                    expectedTeams.has(eg.homeTeamId) && expectedTeams.has(eg.awayTeamId)
                );

                if (match) {
                    updated[skeletonId] = {
                        ...updated[skeletonId],
                        homeTeamId: feeder1.winnerTeamId, // Keep bracket order: winner of top feeder
                        awayTeamId: feeder2.winnerTeamId,
                        homeScore: match.homeTeamId === feeder1.winnerTeamId ? match.homeScore : match.awayScore,
                        awayScore: match.homeTeamId === feeder1.winnerTeamId ? match.awayScore : match.homeScore,
                        status: match.status,
                        winnerTeamId: match.winnerTeamId,
                        startTime: match.startTime,
                        period: match.period,
                        clock: match.clock,
                        broadcast: match.broadcast,
                        externalId: match.externalId,
                    };
                    skeletonToEspn[skeletonId] = match;
                    mappedCount++;
                }
            }
        }
    }

    // --- ROUND 5: Final Four ---
    // R5-FF-1 gets East (slot 1) and West (slot 2) winners via getFFSlot mapping
    // R5-FF-2 gets South (slot 1) and Midwest (slot 2) winners
    // We know which R4 games feed via the getFFSlot function
    for (let i = 1; i <= 2; i++) {
        const skeletonId = `R5-FF-${i}`;
        if (!updated[skeletonId]) continue;

        // Find which two R4 region winners feed this FF game
        // getFFSlot maps: East→1, West→1, South→2, Midwest→2
        // So FF-1 gets East + West winners, FF-2 gets South + Midwest winners
        const feederRegions = i === 1 ? ['East', 'West'] : ['South', 'Midwest'];
        const feeder1 = updated[`R4-${feederRegions[0]}-1`];
        const feeder2 = updated[`R4-${feederRegions[1]}-1`];

        if (!feeder1?.winnerTeamId || !feeder2?.winnerTeamId) continue;

        const candidates = espnByRegionRound['Final Four-5'] || [];
        const expectedTeams = new Set([feeder1.winnerTeamId, feeder2.winnerTeamId]);
        const match = candidates.find(eg =>
            expectedTeams.has(eg.homeTeamId) && expectedTeams.has(eg.awayTeamId)
        );

        if (match) {
            updated[skeletonId] = {
                ...updated[skeletonId],
                homeTeamId: feeder1.winnerTeamId,
                awayTeamId: feeder2.winnerTeamId,
                homeScore: match.homeTeamId === feeder1.winnerTeamId ? match.homeScore : match.awayScore,
                awayScore: match.homeTeamId === feeder1.winnerTeamId ? match.awayScore : match.homeScore,
                status: match.status,
                winnerTeamId: match.winnerTeamId,
                startTime: match.startTime,
                period: match.period,
                clock: match.clock,
                broadcast: match.broadcast,
                externalId: match.externalId,
            };
            mappedCount++;
        }
    }

    // --- ROUND 6: Championship ---
    const champId = 'R6-CHAMP-1';
    if (updated[champId]) {
        // Feeders: R5-FF-1 and R5-FF-2
        const feeder1 = updated['R5-FF-1'];
        const feeder2 = updated['R5-FF-2'];

        if (feeder1?.winnerTeamId && feeder2?.winnerTeamId) {
            const candidates = [
                ...(espnByRegionRound['Final Four-6'] || []),
                ...(espnByRegionRound['TBD-6'] || [])
            ];
            const expectedTeams = new Set([feeder1.winnerTeamId, feeder2.winnerTeamId]);
            const match = candidates.find(eg =>
                expectedTeams.has(eg.homeTeamId) && expectedTeams.has(eg.awayTeamId)
            );

            if (match) {
                updated[champId] = {
                    ...updated[champId],
                    homeTeamId: feeder1.winnerTeamId,
                    awayTeamId: feeder2.winnerTeamId,
                    homeScore: match.homeTeamId === feeder1.winnerTeamId ? match.homeScore : match.awayScore,
                    awayScore: match.homeTeamId === feeder1.winnerTeamId ? match.awayScore : match.homeScore,
                    status: match.status,
                    winnerTeamId: match.winnerTeamId,
                    startTime: match.startTime,
                    period: match.period,
                    clock: match.clock,
                    broadcast: match.broadcast,
                    externalId: match.externalId,
                };
                mappedCount++;
            }
        }
    }

    logger.info(`Mapped ${mappedCount} ESPN games to skeleton structure.`);
    return { updatedGames: updated, mappedCount };
}

/**
 * Imports tournament data from ESPN, mapping existing games and teams.
 */
export const importTournamentFromESPN = onCall(async (request) => {
    // 1. Auth Check - Super Admin Only
    let role = request.auth?.token.role;
    if (!role && request.auth?.uid) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = userDoc.data()?.role;
    }

    if (role !== 'SUPER_ADMIN') {
        throw new HttpsError('permission-denied', 'Super Admin only.');
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

        // Read existing skeleton games for mapping
        const existingDoc = await tournamentRef.get();
        const existingGames = existingDoc.data()?.games || {};

        // Map ESPN data to skeleton structure
        const { updatedGames, mappedCount } = mapESPNGamesToSkeleton(existingGames, games, teams);

        // SAVE: both raw ESPN data and mapped skeleton games
        await tournamentRef.set({
            id: tournamentId,
            seasonYear: parseInt(seasonYear),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            importedGames: games,
            importedTeams: teams,
            games: updatedGames,
        }, { merge: true });

        return { success: true, count, teams: Object.keys(teams).length, mapped: mappedCount };

    } catch (error: unknown) {
        logger.error("Import failed with details:", error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        return { success: false, message: `Import failed: ${msg}` };
    }
});

/**
 * Updates scores for a tournament from ESPN API.
 */
export const updateTournamentScores = async (
    db: admin.firestore.Firestore,
    tournamentId: string,
    dryRun: boolean = false
) => {
    logger.info(`Syncing tournament scores for ${tournamentId}...`);

    try {
        // Get season year from tournament doc (more robust than parsing ID)
        const tournamentRef = db.collection('tournaments').doc(tournamentId);
        const existingDoc = await tournamentRef.get();
        const existingData = existingDoc.data();
        const seasonYear = existingData?.seasonYear || parseInt(tournamentId.split('-')[1] || '2025');

        const { games, teams, count } = await fetchAndMapESPNGameData(seasonYear);
        logger.info(`Fetched ${count} games for sync.`);

        if (!dryRun && count > 0) {
            // Read existing skeleton games for mapping
            const existingGames = existingData?.games || {};

            // Map ESPN data to skeleton structure
            const { updatedGames, mappedCount } = mapESPNGamesToSkeleton(existingGames, games, teams);
            logger.info(`Mapped ${mappedCount} games to skeleton for scoring.`);

            // Update both raw ESPN data and mapped skeleton games
            await tournamentRef.set({
                importedGames: games,
                importedTeams: teams,
                games: updatedGames,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // Trigger internal scoring
            try {
                const scoredCount = await scoreTournamentEntries(db, tournamentId);
                logger.info(`Scoring complete. Scored ${scoredCount} entries.`);
            } catch (e) {
                logger.error("Scoring failed after sync:", e);
            }
        }
    } catch (error) {
        logger.error("updateTournamentScores failed:", error);
    }
};

// --- Cloud Functions ---



/**
 * Admin-only function to seed the tournament bracket structure.
 * Usage: call with { tournamentId: 'mens-2025', seasonYear: 2025, gender: 'mens', teams: [...] }
 */
export const adminInitTournament = onCall(async (request) => {
    // 1. Auth Check (Admin only)
    let role = request.auth?.token.role;
    if (!role && request.auth?.uid) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = userDoc.data()?.role;
    }

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
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
    let role = request.auth?.token.role;
    if (!role && request.auth?.uid) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = userDoc.data()?.role;
    }

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
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
    // Query all active (non-finalized) tournaments
    const activeTournaments = await db.collection('tournaments')
        .where('isFinalized', '==', false)
        .get();

    if (activeTournaments.empty) {
        logger.info("No active tournaments to sync.");
        return;
    }

    for (const doc of activeTournaments.docs) {
        logger.info(`Syncing tournament: ${doc.id}`);
        await updateTournamentScores(db, doc.id);
    }
    logger.info(`Scheduled sync complete for ${activeTournaments.size} tournament(s).`);
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
        broadcasts?: { market: string; names: string[] }[]; // Added for TV channel
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




