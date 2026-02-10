
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

    // Round 1 (32 games called R1-W1 to R1-W32 for simplicity or just sequential)
    // Let's use standard naming convention if we can, but sequential is fine for logic.
    // We'll use "R{round}-G{gameIndex}"

    // R1: 32 games
    for (let i = 1; i <= 32; i++) {
        const gameId = `R1_G${i}`;
        games[gameId] = createGame(gameId, 1);
        createSlot(gameId, gameId); // Slot ID usually matches Game ID or Position ID
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
