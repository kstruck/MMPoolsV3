
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeTournament } from '../functions/src/espnBracket';
import { Team } from '../functions/src/types';

// Mock Firebase Admin
const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn(() => ({
    get: mockGet,
    set: mockSet,
    collection: vi.fn(), // for subcollections if any
}));
const mockCollection = vi.fn(() => ({
    doc: mockDoc,
}));

const mockDb = {
    collection: mockCollection,
    runTransaction: vi.fn(),
} as any;

// Mock Logger
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
}));

describe('Tournament Initialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: Updated doc doesn't exist
        mockGet.mockResolvedValue({ exists: false });
    });

    it('should initialize a skeleton tournament with 63+4 games', async () => {
        await initializeTournament(mockDb, 'mens-2026', 2026, 'mens');

        expect(mockCollection).toHaveBeenCalledWith('tournaments');
        expect(mockDoc).toHaveBeenCalledWith('mens-2026');
        expect(mockSet).toHaveBeenCalledTimes(1);

        const savedData = mockSet.mock.calls[0][0];
        expect(savedData.id).toBe('mens-2026');
        expect(savedData.seasonYear).toBe(2026);
        expect(savedData.gender).toBe('mens');

        // Count games. 
        // 4 Regions * (8+4+2+1) = 60
        // FF = 2
        // Champ = 1
        // First Four = 4
        // Total = 67?
        // Let's count keys
        const gameKeys = Object.keys(savedData.games);
        // R1: 32, R2: 16, R3: 8, R4: 4, R5: 2, R6: 1
        // 32+16+8+4+2+1 = 63
        // +4 First Four = 67
        expect(gameKeys.length).toBe(67);

        // Check First Four
        const ffGames = Object.values(savedData.games).filter((g: any) => g.round === 0);
        expect(ffGames.length).toBe(4);
        expect(ffGames[0].isFirstFour).toBe(true);

        // Check Round 1 linkage
        const r1East1 = savedData.games['R1-East-1'];
        // FF-1 is East 16, feeds R1-East-1 (which is 1 vs 16)
        // Check if map logic worked. 
        // Logic: if FF feeds this slot, replace bot/top team ID.
        // We need to know specific FF mappings in the code.
        // FF-1: East 16 -> R1-East-1. Seed 16 is bot.
        // So homeTeamId should be "East 1", awayTeamId should be "Winner of East 16 Play-in"
        expect(r1East1.homeTeamId).toBe('East 1');
        expect(r1East1.awayTeamId).toBe('Winner of East 16 Play-in');
    });

    it('should populate real team names if provided', async () => {
        const teams: Team[] = [
            { id: 'duke', name: 'Duke', seed: 1, region: 'East' },
            { id: 'unc', name: 'UNC', seed: 16, region: 'East' }
        ];

        // We need to mock "unc" as winning the play in? 
        // No, initTournament doesn't resolve games. 
        // But if UNC is Seed 16 in East, and East 16 is a FF game...
        // The helper `findTeam` matches region/seed.
        // "UNC" is East 16.
        // R1-East-1 is East 1 vs East 16.
        // Logic:
        // if (teams.length > 0) topTeamId = foundTeam.name
        // THEN "Check if this slot is fed by a First Four game"
        // If it is, it OVERWRITES botTeamId with "Winner of..."

        // So for R1-East-1, even if we know UNC is East 16, 
        // because it's a FF slot, it should still say "Winner of..."
        // EXCEPT if we improved logic to say "Winner of East 16 (Team A / Team B)"
        // Current logic: `botTeamId = Winner of ${ffGame.region} ${ffGame.seed} Play-in`

        await initializeTournament(mockDb, 'mens-2026', 2026, 'mens', teams);

        const savedData = mockSet.mock.calls[0][0];
        const r1East1 = savedData.games['R1-East-1'];

        expect(r1East1.homeTeamId).toBe('Duke'); // Should match Duke
        expect(r1East1.awayTeamId).toContain('Winner of East 16'); // Overwritten by FF logic
    });

    it('should pre-fill FF games with placeholder teams', async () => {
        await initializeTournament(mockDb, 'mens-2026', 2026, 'mens');
        const savedData = mockSet.mock.calls[0][0];
        const ffGame = savedData.games['R0-East-16']; // ID from code: `R0-${ff.region}-${ff.seed}`

        expect(ffGame).toBeDefined();
        expect(ffGame.homeTeamId).toBe('PlayIn East 16a');
        expect(ffGame.awayTeamId).toBe('PlayIn East 16b');
    });
});
