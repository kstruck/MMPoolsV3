import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Tournament, Game, TournamentSlot, BracketRegion, Team } from "./types";
import { scoreTournamentEntries } from "./bracketScoring";
import { BIG_12_TEAMS_2026, BIG_EAST_TEAMS_2026 } from "./conferenceTournaments";

/**
 * Recursively sanitizes an object for Firestore by replacing all `undefined`
 * values with `null`. Firestore rejects `undefined` but accepts `null`.
 */
function sanitizeForFirestore<T>(obj: T): T {
    if (obj === undefined) return null as unknown as T;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore) as unknown as T;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = sanitizeForFirestore(value);
    }
    return result as T;
}

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
 * Static 2026 NCAA Tournament seed lookup.
 * ESPN's scoreboard API does NOT provide tournament seeds — only AP poll curatedRank.
 * Two-level lookup: region → displayName → seed.
 * Derived from ESPN API: sorted by startTime within region (standard slot order).
 * Slot order: 1(1v16), 2(8v9), 3(5v12), 4(4v13), 5(6v11), 6(3v14), 7(7v10), 8(2v15)
 */
const NCAA_2026_SEEDS: Record<string, Record<string, number>> = {
    East: {
        'Ohio State Buckeyes':        1,
        'TCU Horned Frogs':          16,
        'Louisville Cardinals':        8,
        'South Florida Bulls':         9,
        'Duke Blue Devils':            5,
        'Siena Saints':               12,
        'Michigan State Spartans':     4,
        'North Dakota State Bison':   13,
        "St. John's Red Storm":        6,
        'Northern Iowa Panthers':     11,
        'UCLA Bruins':                 3,
        'UCF Knights':                14,
        'Kansas Jayhawks':             7,
        'California Baptist Lancers': 10,
        'UConn Huskies':               2,
        'Furman Paladins':            15,
    },
    West: {
        'Wisconsin Badgers':           1,
        'High Point Panthers':        16,
        'Arkansas Razorbacks':         8,
        "Hawai'i Rainbow Warriors":    9,
        'Michigan Wolverines':         5,
        'Howard Bison':               12,
        'BYU Cougars':                 4,
        'Texas Longhorns':            13,
        'Georgia Bulldogs':            6,
        'Saint Louis Billikens':      11,
        'Gonzaga Bulldogs':            3,
        'Kennesaw State Owls':        14,
        'Kentucky Wildcats':           7,
        'Santa Clara Broncos':        10,
        'Texas Tech Red Raiders':      2,
        'Akron Zips':                 15,
        // First Four (6v11 slot winner goes to West-5)
        'SMU Mustangs':               11,
        'Miami (OH) RedHawks':        11,
    },
    South: {
        'Nebraska Cornhuskers':        1,
        'Troy Trojans':               16,
        'Vanderbilt Commodores':       8,
        'McNeese Cowboys':             9,
        'North Carolina Tar Heels':    5,
        'VCU Rams':                   12,
        "Saint Mary's Gaels":          4,
        'Texas A&M Aggies':           13,
        'Illinois Fighting Illini':    6,
        'Pennsylvania Quakers':       11,
        'Houston Cougars':             3,
        'Idaho Vandals':              14,
        'Clemson Tigers':              7,
        'Iowa Hawkeyes':              10,
        'Florida Gators':              2,
        'Prairie View A&M Panthers':  15,
        // First Four (11 slot winner goes to South-5)
        'Lehigh Mountain Hawks':      11,
    },
    Midwest: {
        'Arizona Wildcats':            1,
        'Long Island University Sharks': 16,
        'Iowa State Cyclones':         2,
        'Tennessee State Tigers':     15,
        'Alabama Crimson Tide':        4,
        'Hofstra Pride':              13,
        'Tennessee Volunteers':        6,
        'Wright State Raiders':       11,
        'Virginia Cavaliers':          3,
        'Utah State Aggies':          14,
        'Purdue Boilermakers':        14,  // pending verify
        'Queens University Royals':   16,  // pending verify
        'Miami Hurricanes':            4,  // pending verify
        'Missouri Tigers':            13,  // pending verify
        'Villanova Wildcats':         14,  // pending verify
    },
};



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
    // For 2026: March 19, 2026 12:00 PM ET
    let defaultLockAt: number;
    if (seasonYear === 2026) {
        defaultLockAt = new Date('2026-03-19T12:00:00-04:00').getTime();
    } else if (seasonYear === 2025) {
        defaultLockAt = new Date('2025-03-20T12:00:00-04:00').getTime();
    } else {
        defaultLockAt = new Date(`${seasonYear}-03-15T12:00:00-04:00`).getTime();
    }

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

        const homeEspnId = homeComp.team.id;
        const awayEspnId = awayComp.team.id;

        // --- WS4: Resolve tournament seed from static 2026 bracket table.
        // ESPN's API does NOT include tournament seeds - curatedRank is the AP poll rank, not bracket seed.
        // Two-key lookup: NCAA_2026_SEEDS[region][displayName] → seed number.
        const homeDisplayNameRaw = homeComp.team.displayName;
        const awayDisplayNameRaw = awayComp.team.displayName;
        const regionSeeds = seasonYear === 2026 ? (NCAA_2026_SEEDS[region] ?? {}) : {};
        const homeSeed = regionSeeds[homeDisplayNameRaw] ?? parseSeedFromName(homeDisplayNameRaw) ?? 99;
        const awaySeed = regionSeeds[awayDisplayNameRaw] ?? parseSeedFromName(awayDisplayNameRaw) ?? 99;

        // Strip seed prefix from name for cleaner display, e.g. "(1) Duke Blue Devils" -> "Duke Blue Devils"
        const homeDisplayName = homeComp.team.displayName.replace(/^\(\d+\)\s*/, '');
        const awayDisplayName = awayComp.team.displayName.replace(/^\(\d+\)\s*/, '');

        // KEY CHANGE: Key teams by display name, not ESPN numeric ID.
        // This means games' homeTeamId/awayTeamId are the display names (e.g. "Duke Blue Devils"),
        // which the bracket UI can render directly without a lookup table.
        const homeTeamKey = homeDisplayName;
        const awayTeamKey = awayDisplayName;

        // Store Teams if not exists (update region if we now know it)
        if (!teams[homeTeamKey]) {
            teams[homeTeamKey] = {
                id: homeTeamKey,
                name: homeDisplayName,
                seed: homeSeed,
                region: region,
                logoUrl: homeComp.team.logo,
                externalId: homeEspnId, // Keep ESPN numeric ID for score sync
            } as Team & { externalId?: string };
        } else if ((teams[homeTeamKey] as Team & { region?: string }).region === 'TBD' && region !== 'TBD') {
            teams[homeTeamKey].region = region;
        }
        if (!teams[awayTeamKey]) {
            teams[awayTeamKey] = {
                id: awayTeamKey,
                name: awayDisplayName,
                seed: awaySeed,
                region: region,
                logoUrl: awayComp.team.logo,
                externalId: awayEspnId, // Keep ESPN numeric ID for score sync
            } as Team & { externalId?: string };
        } else if ((teams[awayTeamKey] as Team & { region?: string }).region === 'TBD' && region !== 'TBD') {
            teams[awayTeamKey].region = region;
        }

        // Determine winner name (by display name key)
        const homeScore = parseInt(homeComp.score || '0');
        const awayScore = parseInt(awayComp.score || '0');
        const winnerKey = status === 'FINAL' ? (homeScore > awayScore ? homeTeamKey : awayTeamKey) : null;

        // Create Game — use display name keys as team IDs
        const game: Game = {
            id: gameId,
            startTime: competition.date,
            status: status === 'FINAL' ? 'FINAL' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED',
            homeTeamId: homeTeamKey,
            awayTeamId: awayTeamKey,
            homeScore,
            awayScore,
            winnerTeamId: winnerKey,
            round: round,
            region: region,

            // Live Score Details
            period: competition.status?.period ?? null,
            clock: competition.status?.displayClock ?? null, // e.g. "12:35"
            broadcast: competition.broadcasts?.[0]?.names?.[0] ?? null, // e.g. "CBS"
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
    else if (headlineLower.includes('first round') || headlineLower.includes('1st round')) round = 1;
    else if (headlineLower.includes('second round') || headlineLower.includes('2nd round')) round = 2;
    else if (headlineLower.includes('sweet 16') || headlineLower.includes('sweet sixteen') || headlineLower.includes('3rd round')) round = 3;
    else if (headlineLower.includes('elite eight') || headlineLower.includes('elite 8') || headlineLower.includes('4th round')) round = 4;
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

            // If we didn't find a direct R1 match, check if there's a First Four game that feeds this seed
            // We can detect this if we look at the R0 (First Four) games for this region and seed.
            const ffCandidates = espnByRegionRound[`${region}-0`] || [];
            let fallbackTeamId: string | null = null;
            let fallbackPlayingSeed: number | null = null;

            if (!match && ffCandidates.length > 0) {
                // Determine if 'top' or 'bot' seed is the one playing in the First Four
                // Usually it's the 11 or 16 seed (so 'bot' often matches 11 or 16)
                for (const ffGame of ffCandidates) {
                    const homeSeed = getTeamSeed(ffGame.homeTeamId);
                    const awaySeed = getTeamSeed(ffGame.awayTeamId);

                    // If the FF game's seeds match one of the expected seeds for this R1 game
                    if (homeSeed === top || homeSeed === bot || awaySeed === top || awaySeed === bot) {
                        // We found the First Four game that feeds this R1 slot
                        const homeDbTeam = espnTeams[ffGame.homeTeamId];
                        const awayDbTeam = espnTeams[ffGame.awayTeamId];
                        if (homeDbTeam && awayDbTeam) {
                            fallbackTeamId = `${homeDbTeam.name}/${awayDbTeam.name}`;
                            fallbackPlayingSeed = homeSeed; // Which seed slot this represents (e.g. 16 or 11)
                        }
                        break;
                    }
                }
            }

            if (match) {
                // Ensure higher seed (lower number) is homeTeamId for consistency
                const homeSeed = getTeamSeed(match.homeTeamId);
                const topEspnId = homeSeed === top ? match.homeTeamId : match.awayTeamId;
                const botEspnId = homeSeed === top ? match.awayTeamId : match.homeTeamId;
                const topScore = homeSeed === top ? match.homeScore : match.awayScore;
                const botScore = homeSeed === top ? match.awayScore : match.homeScore;

                // Resolve ESPN numeric IDs → display names so bracket renders correctly
                const topTeamName = espnTeams[topEspnId]?.name || topEspnId;
                const botTeamName = espnTeams[botEspnId]?.name || botEspnId;
                const winnerName = match.winnerTeamId ? (espnTeams[match.winnerTeamId]?.name || match.winnerTeamId) : null;

                updated[skeletonId] = {
                    ...updated[skeletonId],
                    homeTeamId: topTeamName,
                    awayTeamId: botTeamName,
                    homeScore: topScore,
                    awayScore: botScore,
                    status: match.status,
                    winnerTeamId: winnerName,
                    startTime: match.startTime,
                    period: match.period,
                    clock: match.clock,
                    broadcast: match.broadcast,
                    externalId: match.externalId,
                };
                skeletonToEspn[skeletonId] = match;
                mappedCount++;
            } else if (fallbackTeamId && fallbackPlayingSeed !== null) {
                // We don't have a scheduled R1 match yet (likely because the Play-In game hasn't finished),
                // but we know WHO is playing in the Play-In game for this slot. Let's update the skeleton
                // to show "TeamA/TeamB" instead of "Winner of Play-In"

                // Which of the two spots does the play-in winner occupy?
                // `fallbackPlayingSeed` tells us the expected seed (e.g. 16)
                let newTopTeamId = updated[skeletonId].homeTeamId;
                let newBotTeamId = updated[skeletonId].awayTeamId;

                if (top === fallbackPlayingSeed) {
                    newTopTeamId = fallbackTeamId;
                } else if (bot === fallbackPlayingSeed) {
                    newBotTeamId = fallbackTeamId;
                }

                updated[skeletonId] = {
                    ...updated[skeletonId],
                    homeTeamId: newTopTeamId,
                    awayTeamId: newBotTeamId
                };
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
                    // feeder winners are already resolved to names from the R1 step above
                    const winnerName = match.winnerTeamId ? (espnTeams[match.winnerTeamId]?.name || match.winnerTeamId) : null;
                    // Scores: match home/away refers to ESPN IDs, map to correct side
                    const homeEspnId = match.homeTeamId;
                    const homeIsFeeder1 = espnTeams[homeEspnId]?.name === feeder1.winnerTeamId || homeEspnId === feeder1.winnerTeamId;
                    updated[skeletonId] = {
                        ...updated[skeletonId],
                        homeTeamId: feeder1.winnerTeamId, // Keep bracket order: winner of top feeder
                        awayTeamId: feeder2.winnerTeamId,
                        homeScore: homeIsFeeder1 ? match.homeScore : match.awayScore,
                        awayScore: homeIsFeeder1 ? match.awayScore : match.homeScore,
                        status: match.status,
                        winnerTeamId: winnerName,
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
            const winnerName = match.winnerTeamId ? (espnTeams[match.winnerTeamId]?.name || match.winnerTeamId) : null;
            const homeEspnId = match.homeTeamId;
            const homeIsFeeder1 = espnTeams[homeEspnId]?.name === feeder1.winnerTeamId || homeEspnId === feeder1.winnerTeamId;
            updated[skeletonId] = {
                ...updated[skeletonId],
                homeTeamId: feeder1.winnerTeamId,
                awayTeamId: feeder2.winnerTeamId,
                homeScore: homeIsFeeder1 ? match.homeScore : match.awayScore,
                awayScore: homeIsFeeder1 ? match.awayScore : match.homeScore,
                status: match.status,
                winnerTeamId: winnerName,
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
                const winnerName = match.winnerTeamId ? (espnTeams[match.winnerTeamId]?.name || match.winnerTeamId) : null;
                const homeEspnId = match.homeTeamId;
                const homeIsFeeder1 = espnTeams[homeEspnId]?.name === feeder1.winnerTeamId || homeEspnId === feeder1.winnerTeamId;
                updated[champId] = {
                    ...updated[champId],
                    homeTeamId: feeder1.winnerTeamId,
                    awayTeamId: feeder2.winnerTeamId,
                    homeScore: homeIsFeeder1 ? match.homeScore : match.awayScore,
                    awayScore: homeIsFeeder1 ? match.awayScore : match.homeScore,
                    status: match.status,
                    winnerTeamId: winnerName,
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
        // sanitize first: Firestore rejects `undefined`, needs `null`
        await tournamentRef.set(sanitizeForFirestore({
            id: tournamentId,
            seasonYear: parseInt(seasonYear),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            importedGames: games,
            importedTeams: teams,
            games: updatedGames,
        }), { merge: true });

        return { success: true, count, teams: Object.keys(teams).length, mapped: mappedCount };

    } catch (error: unknown) {
        logger.error("Import failed with details:", error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        return { success: false, message: `Import failed: ${msg}` };
    }
});

/**
 * Unified update function that delegates scoring based on tournamentType
 */
export const updateTournamentScores = async (
    db: admin.firestore.Firestore,
    tournamentId: string,
    dryRun: boolean = false
) => {
    logger.info(`Syncing tournament scores for ${tournamentId}...`);

    try {
        const tournamentRef = db.collection('tournaments').doc(tournamentId);
        const existingDoc = await tournamentRef.get();
        const existingData = existingDoc.data();
        if (!existingData) {
            logger.info(`Tournament ${tournamentId} not found for sync.`);
            return;
        }

        const seasonYear = existingData.seasonYear || parseInt(tournamentId.split('-')[1] || '2025');
        const isConference = existingData.tournamentType === 'conference';

        if (isConference) {
            // Conference Sync
            const confName = existingData.conferenceName;
            let groupId = 100;
            if (confName === 'Big 12') groupId = 8;
            else if (confName === 'Big East') groupId = 4;
            else {
                logger.info(`Unsupported conference: ${confName}`);
                return;
            }

            const events = await fetchESPNConferenceTournamentData(seasonYear, groupId);

            if (!dryRun && events.length > 0) {
                const existingGames = existingData.games || {};
                const slots = existingData.slots || {};

                // Build ESPN numeric ID → skeleton short ID lookup for this conference
                const confTeams = confName === 'Big 12' ? BIG_12_TEAMS_2026
                    : confName === 'Big East' ? BIG_EAST_TEAMS_2026
                        : [];
                const teamLookup: Record<string, { espnId: string; id: string }> = {};
                for (const t of confTeams) { teamLookup[t.espnId] = { espnId: t.espnId, id: t.id }; }

                const { updatedGames, mappedCount } = mapESPNConferenceGamesToSkeleton(existingGames, slots, events, teamLookup);
                logger.info(`[Conf Sync] Mapped ${mappedCount} games to skeleton for scoring.`);

                await tournamentRef.set({
                    importedEvents: events,
                    games: updatedGames,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                try {
                    const scoredCount = await scoreTournamentEntries(db, tournamentId);
                    logger.info(`[Conf Sync] Scoring complete for ${tournamentId}. Scored ${scoredCount} entries.`);
                } catch (e) {
                    logger.error(`[Conf Sync] Scoring failed for ${tournamentId}:`, e);
                }
            }
        } else {
            // NCAA Sync
            const { games, teams, count } = await fetchAndMapESPNGameData(seasonYear);
            logger.info(`Fetched ${count} games for sync.`);

            if (!dryRun && count > 0) {
                const existingGames = existingData.games || {};
                const { updatedGames, mappedCount } = mapESPNGamesToSkeleton(existingGames, games, teams);
                logger.info(`Mapped ${mappedCount} games to skeleton for scoring.`);

                await tournamentRef.set({
                    importedGames: games,
                    importedTeams: teams,
                    games: updatedGames,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                try {
                    const scoredCount = await scoreTournamentEntries(db, tournamentId);
                    logger.info(`Scoring complete. Scored ${scoredCount} entries.`);
                } catch (e) {
                    logger.error("Scoring failed after sync:", e);
                }
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
async function fetchESPNConferenceTournamentData(seasonYear: number, groupId: number): Promise<ESPNEvent[]> {
    const start = `${seasonYear}0305`;
    const end = `${seasonYear}0318`; // Includes selection sunday margin
    const limit = 50;

    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${start}-${end}&limit=${limit}&groups=${groupId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json() as ESPNResponse;
        // Postseason is type 3 in ESPN API (sometimes conference tourneys are marked 3, sometimes not, 
        // but limiting by group + date range should guarantee only the tournament games are pulled).
        return data.events || [];
    } catch (error) {
        logger.error("Failed to fetch ESPN conf data:", error);
        throw error;
    }
}

function mapESPNConferenceGamesToSkeleton(
    existingGames: Record<string, Game>,
    slots: Record<string, TournamentSlot>,
    espnEvents: ESPNEvent[],
    teams?: Record<string, { espnId: string; id: string }>  // espnId → { shortId }
): { updatedGames: Record<string, Game>, mappedCount: number } {
    const updated = { ...existingGames };
    let mappedCount = 0;

    // Build ESPN numeric ID → skeleton short ID lookup
    // e.g. '239' → 'BAYLOR', '9' → 'ASU'
    const espnToShort: Record<string, string> = {};
    if (teams) {
        for (const t of Object.values(teams)) {
            if (t.espnId && t.id) espnToShort[t.espnId] = t.id;
        }
    }

    // Convert espnEvents to matches — translate ESPN numeric IDs to skeleton short IDs
    const matches = espnEvents.map(e => {
        const comp = e.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        if (!home || !away) return null;

        const homeScore = parseInt(home.score || '0');
        const awayScore = parseInt(away.score || '0');
        const status = (comp.status.type.state === 'pre' ? 'SCHEDULED' :
            comp.status.type.state === 'in' ? 'IN_PROGRESS' : 'FINAL') as 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';

        // Translate ESPN numeric IDs to skeleton short IDs (fallback: raw ESPN id)
        const homeShortId = espnToShort[home.team.id] || home.team.id;
        const awayShortId = espnToShort[away.team.id] || away.team.id;

        let winnerTeamId: string | null = null;
        if (status === 'FINAL') {
            // Winner stored as skeleton short ID
            winnerTeamId = homeScore > awayScore ? homeShortId : awayShortId;
        }

        return {
            homeTeamId: homeShortId,
            awayTeamId: awayShortId,
            homeScore,
            awayScore,
            status,
            winnerTeamId,
            startTime: comp.date,
            period: comp.status?.period ?? null,
            clock: comp.status?.displayClock ?? null,
            broadcast: comp.broadcasts?.[0]?.names?.[0] ?? null,
            externalId: e.id
        };
    }).filter((m): m is NonNullable<typeof m> => m !== null);

    // Match by passing teams from feeders down
    const maxRound = Math.max(...Object.values(updated).map(g => g.round));

    for (let currentRound = 1; currentRound <= maxRound; currentRound++) {
        for (const [id, game] of Object.entries(updated)) {
            if (game.round !== currentRound) continue;

            let hId = game.homeTeamId;
            let aId = game.awayTeamId;

            const feeders = Object.values(slots).filter(s => s.nextSlotId === id);

            if (feeders.length > 0) {
                const winningTeams = feeders.map(f => updated[f.gameId]?.winnerTeamId).filter(Boolean);
                let nextWinningSlot = 0;
                if ((!hId || hId.startsWith('SEED_')) && nextWinningSlot < winningTeams.length) {
                    hId = winningTeams[nextWinningSlot++]!;
                }
                if ((!aId || aId.startsWith('SEED_')) && nextWinningSlot < winningTeams.length) {
                    aId = winningTeams[nextWinningSlot++]!;
                }
            }

            if (hId && !hId.startsWith('SEED_')) updated[id].homeTeamId = hId;
            if (aId && !aId.startsWith('SEED_')) updated[id].awayTeamId = aId;

            if (hId && aId && !hId.startsWith('SEED_') && !aId.startsWith('SEED_')) {
                const expected = new Set([hId, aId]);
                const match = matches.find(m => expected.has(m.homeTeamId) && expected.has(m.awayTeamId));
                if (match) {
                    updated[id] = {
                        ...updated[id],
                        ...match,
                        homeTeamId: hId,
                        awayTeamId: aId,
                        homeScore: match.homeTeamId === hId ? match.homeScore : match.awayScore,
                        awayScore: match.homeTeamId === hId ? match.awayScore : match.homeScore
                    };
                    mappedCount++;
                }
            }
        }
    }

    return { updatedGames: updated, mappedCount };
}


/**
 * Imports tournament data from ESPN, mapping existing games and teams for Conference Tournaments.
 */

export const importConferenceTournamentFromESPN = onCall(async (request) => {
    let role = request.auth?.token.role;
    if (!role && request.auth?.uid) {
        const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
        role = userDoc.data()?.role;
    }

    if (role !== 'SUPER_ADMIN') {
        throw new HttpsError('permission-denied', 'Super Admin only.');
    }

    const { tournamentId, seasonYear, conferenceName } = request.data;
    if (!tournamentId || !seasonYear || !conferenceName) {
        return { success: false, message: 'Missing tournamentId, seasonYear, or conferenceName' };
    }

    let groupId = 100;
    if (conferenceName === 'Big 12') groupId = 8;
    else if (conferenceName === 'Big East') groupId = 4;
    else return { success: false, message: 'Unsupported conference.' };

    const db = admin.firestore();
    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    try {
        const events = await fetchESPNConferenceTournamentData(parseInt(seasonYear), groupId);
        if (events.length === 0) {
            return { success: false, message: "No events found from ESPN." };
        }

        const existingDoc = await tournamentRef.get();
        if (!existingDoc.exists) return { success: false, message: "Tournament not initialized yet." };

        const existingGames = existingDoc.data()?.games || {};
        const slots = existingDoc.data()?.slots || {};

        const { updatedGames, mappedCount } = mapESPNConferenceGamesToSkeleton(existingGames, slots, events);

        await tournamentRef.set({
            importedEvents: events,
            games: updatedGames,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await scoreTournamentEntries(db, tournamentId);

        return { success: true, count: events.length, mapped: mappedCount };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return { success: false, message: `Import failed: ${msg}` };
    }
});

/**
 * Super Admin function to sync early bracket picks with play-in game winners.
 * Users who submit brackets before the First Four finishes will have "TeamA/TeamB"
 * as their Round 1 pick. Once the playoff game is finished, we need to update
 * those brackets to the actual team ID so scoring works correctly.
 */
export const syncPlayInPicks = onCall(async (request) => {
    // 1. Authorization
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const userRole = (request.auth.token['role'] as string) || 'user';
    if (userRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Only super admins can sync play-in picks.');
    }

    const { tournamentId } = request.data;
    if (!tournamentId) {
        throw new HttpsError('invalid-argument', 'Missing tournamentId.');
    }

    const db = admin.firestore();

    // 2. Fetch the current tournament skeleton to know the R1 teams
    const tourneyRef = db.collection('tournaments').doc(tournamentId);
    const tourneySnap = await tourneyRef.get();
    if (!tourneySnap.exists) {
        throw new HttpsError('not-found', `Tournament ${tournamentId} not found.`);
    }

    const tourneyData = tourneySnap.data() as Tournament;
    const skeletonGames = tourneyData.games;

    if (!skeletonGames) {
        return { success: true, message: "No games to sync in this tournament." };
    }

    // 3. Find all matches where a play-in game was resolved.
    // We can identify these by looking at Round 1 games. If a Round 1 game has 
    // real team names (not TeamA/TeamB) but user brackets still have TeamA/TeamB, we can update them.
    // Instead of parsing strings, we will look at all Round 1 games. For each R1 game, we
    // record its homeTeamId and awayTeamId.
    const resolvedR1Teams = new Set<string>();

    // We also need to map TeamA/TeamB back to the resolved winning team. 
    // To do this reliably without ESPN data here, we check if the user's picked string
    // looks like "Wagner/Howard". If one of those two teams is currently in a Round 1 slot, 
    // that's the winner.
    for (const game of Object.values(skeletonGames)) {
        if (game.round === 1) {
            if (game.homeTeamId && !game.homeTeamId.includes('/')) {
                resolvedR1Teams.add(game.homeTeamId);
            }
            if (game.awayTeamId && !game.awayTeamId.includes('/')) {
                resolvedR1Teams.add(game.awayTeamId);
            }
        }
    }

    // 4. Fetch all entries for this tournament
    const entriesRef = db.collection('entries').where('tournamentId', '==', tournamentId);
    const entriesSnap = await entriesRef.get();

    if (entriesSnap.empty) {
        return { success: true, message: "No entries found to sync." };
    }

    let updatedCount = 0;
    const batch = db.batch();
    let batchSize = 0;

    // 5. Check each entry for unresolved play-in picks
    entriesSnap.forEach(docSnap => {
        const entry = docSnap.data();
        let needsUpdate = false;
        const newBracket = { ...entry.bracket };

        // For every pick in their bracket
        for (const [slotId, teamId] of Object.entries(entry.bracket as Record<string, string>)) {
            // Is it a play-in placeholder format like "Wagner/Howard"?
            if (teamId && teamId.includes('/')) {
                const parts = teamId.split('/');
                const teamA = parts[0];
                const teamB = parts[1];

                // If one of these teams is now legitimately in Round 1
                if (resolvedR1Teams.has(teamA)) {
                    newBracket[slotId] = teamA;
                    needsUpdate = true;
                } else if (resolvedR1Teams.has(teamB)) {
                    newBracket[slotId] = teamB;
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            batch.update(docSnap.ref, { bracket: newBracket });
            updatedCount++;
            batchSize++;

            // Firestore batch limit is 500, but let's be safe
            if (batchSize >= 400) {
                // Technically we should wait for batch.commit() here in a padded loop,
                // but for ~100 brackets this simple logic is fine. For scale, use a commit chunks array.
            }
        }
    });

    if (batchSize > 0) {
        await batch.commit();
    }

    return {
        success: true,
        message: `Synced ${updatedCount} entries with resolved play-in winners.`
    };
});
