import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { Game, TournamentSlot } from "./types";

// ---------------------------------------------------------------------------
// Big East 2026 Team Data (11 teams)
// Seeding is determined after the regular season, so we use placeholder seeds.
// Teams are loaded here by conference standing slot — actual seeds assigned by
// calling initializeBigEastTournament with real data post-season.
// ---------------------------------------------------------------------------

export interface ConferenceTeam {
    id: string;       // Internal ESPN abbreviation / key
    name: string;
    shortName: string;
    espnId: string;
    logo: string;
    seed?: number;    // Set when bracket is finalized
}

// 11 Big East teams for 2026 (seeds TBD; we store them seeded 1-11 as placeholder)
export const BIG_EAST_TEAMS_2026: ConferenceTeam[] = [
    { id: 'CONN', name: 'Connecticut Huskies', shortName: 'UConn', espnId: '41', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/41.png', seed: 1 },
    { id: 'MARQ', name: 'Marquette Golden Eagles', shortName: 'Marquette', espnId: '269', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/269.png', seed: 2 },
    { id: 'CREI', name: 'Creighton Bluejays', shortName: 'Creighton', espnId: '156', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/156.png', seed: 3 },
    { id: 'STJ', name: 'St. John\'s Red Storm', shortName: "St. John's", espnId: '2599', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2599.png', seed: 4 },
    { id: 'XAVI', name: 'Xavier Musketeers', shortName: 'Xavier', espnId: '2752', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2752.png', seed: 5 },
    { id: 'SETON', name: 'Seton Hall Pirates', shortName: 'Seton Hall', espnId: '2550', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2550.png', seed: 6 },
    { id: 'PROV', name: 'Providence Friars', shortName: 'Providence', espnId: '2zipper', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2490.png', seed: 7 },
    { id: 'VILL', name: 'Villanova Wildcats', shortName: 'Villanova', espnId: '222', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/222.png', seed: 8 },
    { id: 'GTWN', name: 'Georgetown Hoyas', shortName: 'Georgetown', espnId: '46', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/46.png', seed: 9 },
    { id: 'BUT', name: 'Butler Bulldogs', shortName: 'Butler', espnId: '2086', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2086.png', seed: 10 },
    { id: 'DEPA', name: 'DePaul Blue Demons', shortName: 'DePaul', espnId: '305', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/305.png', seed: 11 },
];

// ---------------------------------------------------------------------------
// Big East Tournament Structure
//
// Round 1 (Mar 11):  Seeds 6v11, 7v10, 8v9  → 3 games
// Quarterfinals (Mar 12): 1v(6/11), 2v(7/10), 3v(8/9), 4v5 → 4 games
// Semifinals (Mar 13): 2 games
// Championship (Mar 14): 1 game
//
// Total: 10 games, 10 slots
// Seeds 1-5 get first-round byes. Game IDs: R1-CONF-{n}, R2-CONF-{n}, etc.
// ---------------------------------------------------------------------------

export const initializeBigEastTournament = async (
    db: admin.firestore.Firestore,
    tournamentId: string,
    overwrite = false
): Promise<void> => {
    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    if (!overwrite) {
        const doc = await tournamentRef.get();
        if (doc.exists) {
            logger.info(`Tournament ${tournamentId} already exists. Skipping init.`);
            return;
        }
    }

    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    const startTime = '2026-03-11T12:00:00.000Z'; // placeholder; ESPN sync will update

    // Helper to build a game
    const makeGame = (id: string, round: number, homeId: string, awayId: string, startISO: string): Game => ({
        id,
        startTime: startISO,
        status: 'SCHEDULED',
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeScore: 0,
        awayScore: 0,
        round,
        region: 'Conference',
    });

    // ---- ROUND 1 (3 games, seeds 6-11, byes for 1-5) ----
    // R1-CONF-1: seed 8 vs seed 9
    // R1-CONF-2: seed 7 vs seed 10
    // R1-CONF-3: seed 6 vs seed 11
    const r1Matchups: { id: string; home: number; away: number }[] = [
        { id: 'R1-CONF-1', home: 8, away: 9 },
        { id: 'R1-CONF-2', home: 7, away: 10 },
        { id: 'R1-CONF-3', home: 6, away: 11 },
    ];

    for (const m of r1Matchups) {
        const homeTeam = BIG_EAST_TEAMS_2026.find(t => t.seed === m.home);
        const awayTeam = BIG_EAST_TEAMS_2026.find(t => t.seed === m.away);
        games[m.id] = makeGame(m.id, 1, homeTeam?.id || `SEED_${m.home}`, awayTeam?.id || `SEED_${m.away}`, startTime);
    }

    // ---- ROUND 2 — QUARTERFINALS (4 games) ----
    // R2-CONF-1: seed 1 vs winner of R1-CONF-3 (6v11)
    // R2-CONF-2: seed 2 vs winner of R1-CONF-2 (7v10)
    // R2-CONF-3: seed 3 vs winner of R1-CONF-1 (8v9)
    // R2-CONF-4: seed 4 vs seed 5
    const team1 = BIG_EAST_TEAMS_2026.find(t => t.seed === 1);
    const team2 = BIG_EAST_TEAMS_2026.find(t => t.seed === 2);
    const team3 = BIG_EAST_TEAMS_2026.find(t => t.seed === 3);
    const team4 = BIG_EAST_TEAMS_2026.find(t => t.seed === 4);
    const team5 = BIG_EAST_TEAMS_2026.find(t => t.seed === 5);
    const qfStartTime = '2026-03-12T12:00:00.000Z';

    games['R2-CONF-1'] = makeGame('R2-CONF-1', 2, team1?.id || 'SEED_1', '', qfStartTime);
    games['R2-CONF-2'] = makeGame('R2-CONF-2', 2, team2?.id || 'SEED_2', '', qfStartTime);
    games['R2-CONF-3'] = makeGame('R2-CONF-3', 2, team3?.id || 'SEED_3', '', qfStartTime);
    games['R2-CONF-4'] = makeGame('R2-CONF-4', 2, team4?.id || 'SEED_4', team5?.id || 'SEED_5', qfStartTime);

    // ---- ROUND 3 — SEMIFINALS (2 games) ----
    const sfStartTime = '2026-03-13T12:00:00.000Z';
    games['R3-CONF-1'] = makeGame('R3-CONF-1', 3, '', '', sfStartTime);
    games['R3-CONF-2'] = makeGame('R3-CONF-2', 3, '', '', sfStartTime);

    // ---- ROUND 4 — CHAMPIONSHIP (1 game) ----
    const champStartTime = '2026-03-14T14:00:00.000Z';
    games['R4-CONF-1'] = makeGame('R4-CONF-1', 4, '', '', champStartTime);

    // ---- SLOTS ----
    // R1 slots → their winners go to QF
    slots['R1-CONF-1'] = { id: 'R1-CONF-1', gameId: 'R1-CONF-1', nextSlotId: 'R2-CONF-3' }; // 8v9 winner → seed 3's QF
    slots['R1-CONF-2'] = { id: 'R1-CONF-2', gameId: 'R1-CONF-2', nextSlotId: 'R2-CONF-2' }; // 7v10 winner → seed 2's QF
    slots['R1-CONF-3'] = { id: 'R1-CONF-3', gameId: 'R1-CONF-3', nextSlotId: 'R2-CONF-1' }; // 6v11 winner → seed 1's QF

    // QF slots → winners go to SF
    slots['R2-CONF-1'] = { id: 'R2-CONF-1', gameId: 'R2-CONF-1', nextSlotId: 'R3-CONF-1' };
    slots['R2-CONF-2'] = { id: 'R2-CONF-2', gameId: 'R2-CONF-2', nextSlotId: 'R3-CONF-1' };
    slots['R2-CONF-3'] = { id: 'R2-CONF-3', gameId: 'R2-CONF-3', nextSlotId: 'R3-CONF-2' };
    slots['R2-CONF-4'] = { id: 'R2-CONF-4', gameId: 'R2-CONF-4', nextSlotId: 'R3-CONF-2' };

    // SF slots → winners go to Championship
    slots['R3-CONF-1'] = { id: 'R3-CONF-1', gameId: 'R3-CONF-1', nextSlotId: 'R4-CONF-1' };
    slots['R3-CONF-2'] = { id: 'R3-CONF-2', gameId: 'R3-CONF-2', nextSlotId: 'R4-CONF-1' };

    // Championship slot (no next)
    slots['R4-CONF-1'] = { id: 'R4-CONF-1', gameId: 'R4-CONF-1', nextSlotId: null };

    // ---- WRITE TO FIRESTORE ----
    await tournamentRef.set({
        id: tournamentId,
        seasonYear: 2026,
        gender: 'mens',
        isFinalized: false,
        tournamentType: 'conference',
        conferenceName: 'Big East',
        lockAt: new Date('2026-03-11T12:00:00.000Z').getTime(),
        games,
        slots,
        createdAt: admin.firestore.Timestamp.now().toMillis(),
    });

    logger.info(`Big East tournament ${tournamentId} initialized with ${Object.keys(games).length} games.`);
};

// ---------------------------------------------------------------------------
// HTTPS Callable — SuperAdmin only
// ---------------------------------------------------------------------------
export const initializeBigEastTournamentHttp = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in.');
    }

    // Verify caller is a SuperAdmin
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const role = userDoc.data()?.role;
    if (role !== 'SUPER_ADMIN') {
        throw new HttpsError('permission-denied', 'Super Admin only.');
    }

    const tournamentId = request.data?.tournamentId || 'bigeast-2026';
    const overwrite = request.data?.overwrite === true;

    await initializeBigEastTournament(db, tournamentId, overwrite);

    return { success: true, tournamentId };
});
