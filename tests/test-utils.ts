
import { Tournament, Game, TournamentSlot, BracketEntry, BracketPool } from '../src/types';

export const TEST_POOL_SETTINGS: BracketPool['settings'] = {
    scoringSystem: 'CLASSIC',
    payouts: { places: [], bonuses: [] },
    maxEntriesPerUser: 1,
    maxEntriesTotal: 100,
    entryFee: 10,
    paymentInstructions: '',
    tieBreakers: { closestAbsolute: true, closestUnder: false }
};

export const TEST_POOL_SETTINGS_FIBONACCI: BracketPool['settings'] = {
    ...TEST_POOL_SETTINGS,
    scoringSystem: 'FIBONACCI',
};

export const TEST_POOL_SETTINGS_CUSTOM: BracketPool['settings'] = {
    ...TEST_POOL_SETTINGS,
    scoringSystem: 'CUSTOM',
    customScoring: [5, 10, 20, 40, 80, 160],
};

export const TEST_POOL_SETTINGS_UPSET_BONUS: BracketPool['settings'] = {
    ...TEST_POOL_SETTINGS,
    upsetBonus: { enabled: true, multiplier: 5 },
};

export function createMockTournament(): Tournament {
    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    // Helper to create a game
    const createGame = (id: string, round: number, region: string = 'East'): Game => ({
        id,
        startTime: new Date().toISOString(),
        status: 'SCHEDULED',
        homeTeamId: 'TBD',
        awayTeamId: 'TBD',
        homeScore: 0,
        awayScore: 0,
        round, // 1-6
        region
    });

    // Helper to create a slot
    const createSlot = (id: string, gameId: string) => {
        slots[id] = { id, gameId };
    };

    // R1: 32 games
    for (let i = 1; i <= 32; i++) {
        const gameId = `R1_G${i}`;
        games[gameId] = createGame(gameId, 1);
        createSlot(gameId, gameId);
    }

    // R2: 16 games
    for (let i = 1; i <= 16; i++) {
        const gameId = `R2_G${i}`;
        games[gameId] = createGame(gameId, 2);
        createSlot(gameId, gameId);
    }

    // R3: 8 games (Sweet 16)
    for (let i = 1; i <= 8; i++) {
        const gameId = `R3_G${i}`;
        games[gameId] = createGame(gameId, 3);
        createSlot(gameId, gameId);
    }

    // R4: 4 games (Elite 8)
    for (let i = 1; i <= 4; i++) {
        const gameId = `R4_G${i}`;
        games[gameId] = createGame(gameId, 4);
        createSlot(gameId, gameId);
    }

    // R5: 2 games (Final 4)
    for (let i = 1; i <= 2; i++) {
        const gameId = `R5_G${i}`;
        games[gameId] = createGame(gameId, 5);
        createSlot(gameId, gameId);
    }

    // R6: 1 game (Championship)
    const gameId = `R6_G1`;
    games[gameId] = createGame(gameId, 6);
    createSlot(gameId, gameId);

    return {
        id: 'test-tournament',
        seasonYear: 2025,
        gender: 'mens',
        isFinalized: false,
        games,
        slots
    };
}

/**
 * Creates a conference tournament mock with a configurable number of rounds.
 * Round 1: ceil(teams/2) games, halving each subsequent round.
 */
export function createConferenceTournament(totalRounds: number): Tournament {
    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    // Game counts per round: e.g. 4-round → [8, 4, 2, 1], 5-round → [16, 8, 4, 2, 1]
    for (let round = 1; round <= totalRounds; round++) {
        const gamesInRound = Math.pow(2, totalRounds - round);
        for (let i = 1; i <= gamesInRound; i++) {
            const gameId = `R${round}_G${i}`;
            games[gameId] = {
                id: gameId,
                startTime: new Date().toISOString(),
                status: 'SCHEDULED',
                homeTeamId: 'TBD',
                awayTeamId: 'TBD',
                homeScore: 0,
                awayScore: 0,
                round,
                region: 'Conference'
            };
            slots[gameId] = { id: gameId, gameId };
        }
    }

    return {
        id: `conf-${totalRounds}r-tournament`,
        seasonYear: 2026,
        gender: 'mens',
        isFinalized: false,
        tournamentType: 'conference',
        conferenceName: totalRounds === 4 ? 'Big East' : 'Big 12',
        games,
        slots
    };
}

export function createMockEntry(id: string, picks: Record<string, string>): BracketEntry {
    return {
        id,
        poolId: 'test-pool',
        ownerUid: 'user-1',
        name: 'Test Bracket',
        picks,
        status: 'SUBMITTED',
        paidStatus: 'UNPAID',
        score: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * Assigns random team IDs and sets all games to FINAL with a random winner.
 * Also assigns seeded team IDs (e.g. "E1-TeamA", "E16-TeamB") to R1 games.
 */
export function setRandomOutcomes(tournament: Tournament, useSeeds = false): void {
    Object.values(tournament.games).forEach(game => {
        if (game.homeTeamId === 'TBD') {
            game.homeTeamId = useSeeds
                ? `E${Math.floor(Math.random() * 16) + 1}-Team_H_${game.id}`
                : `Team_H_${game.id}`;
        }
        if (game.awayTeamId === 'TBD') {
            game.awayTeamId = useSeeds
                ? `E${Math.floor(Math.random() * 16) + 1}-Team_A_${game.id}`
                : `Team_A_${game.id}`;
        }
        game.status = 'FINAL';
        game.winnerTeamId = Math.random() > 0.5 ? game.homeTeamId : game.awayTeamId;
    });
}

/**
 * Creates a picks record where every pick matches the winner.
 */
export function createPerfectPicks(tournament: Tournament): Record<string, string> {
    const picks: Record<string, string> = {};
    Object.values(tournament.games).forEach(game => {
        if (game.winnerTeamId) {
            picks[game.id] = game.winnerTeamId;
        }
    });
    return picks;
}

/**
 * Creates a picks record where every pick is the loser.
 */
export function createAllWrongPicks(tournament: Tournament): Record<string, string> {
    const picks: Record<string, string> = {};
    Object.values(tournament.games).forEach(game => {
        if (game.winnerTeamId) {
            picks[game.id] = game.winnerTeamId === game.homeTeamId
                ? game.awayTeamId
                : game.homeTeamId;
        }
    });
    return picks;
}
