import { describe, it, expect } from 'vitest';
import { scorePickemEntry } from '../nflScoringEngine';
import type { NFLGame, NFLPickemPool, NFLPickemEntry } from '../nflPoolTypes';

// PLAN-TEST-SUITE Phase 2 item 14: pickMode 'ATS' was offered by the schema and
// wizard but scorePickemEntry never read spreads — ATS pools silently scored
// straight-up. spread.value is relative to the home team (negative = home
// favored); push = 0 points for both sides.

const game = (over: Partial<NFLGame>): NFLGame => ({
    id: 'g1', espnGameId: 'e1', season: '2026', seasonType: 2, week: 1,
    homeTeam: { id: '1', name: 'Chiefs', abbreviation: 'KC' },
    awayTeam: { id: '2', name: 'Bills', abbreviation: 'BUF' },
    startTime: 0, status: 'FINAL',
    scores: { home: 27, away: 24 },
    spread: { value: -7, locked: true }, // KC favored by 7
    ...over,
} as NFLGame);

const pool = (pickMode: 'STRAIGHT' | 'ATS', confidenceMode = false): NFLPickemPool => ({
    id: 'p1', type: 'NFL_PICKEM', name: 'T', season: '2026',
    settings: { pickMode, confidenceMode, entryFee: 0 },
} as unknown as NFLPickemPool);

const entry = (picks: Record<string, string>, confidence?: Record<string, number>): NFLPickemEntry => ({
    id: 'u1', poolId: 'p1', ownerUid: 'u1', userName: 'Alice',
    picks, confidence, weeklyPoints: {}, totalScore: 0,
    submittedAt: 0, paidStatus: 'PAID',
} as unknown as NFLPickemEntry);

describe('scorePickemEntry — ATS', () => {
    it('favorite wins the game but fails to cover: underdog pick scores', () => {
        // KC won 27-24 but was favored by 7 → adjusted 20-24 → BUF covers
        const games = [game({})];
        expect(scorePickemEntry(entry({ g1: 'BUF' }), games, pool('ATS')).points).toBe(1);
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('ATS')).points).toBe(0);
        // Same game scored STRAIGHT still pays the winner
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('STRAIGHT')).points).toBe(1);
    });

    it('favorite covers: favorite pick scores', () => {
        const games = [game({ scores: { home: 34, away: 24 } })]; // KC by 10 > 7
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('ATS')).points).toBe(1);
        expect(scorePickemEntry(entry({ g1: 'BUF' }), games, pool('ATS')).points).toBe(0);
    });

    it('push (exact spread) scores 0 for both sides', () => {
        const games = [game({ scores: { home: 31, away: 24 } })]; // KC by exactly 7
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('ATS')).points).toBe(0);
        expect(scorePickemEntry(entry({ g1: 'BUF' }), games, pool('ATS')).points).toBe(0);
    });

    it('home underdog (positive spread) covers by losing narrowly', () => {
        // BUF favored by 3 on the road → spread +3; KC loses 20-21 but covers
        const games = [game({ scores: { home: 20, away: 21 }, spread: { value: 3, locked: true } })];
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('ATS')).points).toBe(1);
    });

    it('missing spread falls back to straight-up', () => {
        const games = [game({ spread: undefined })];
        expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('ATS')).points).toBe(1);
    });

    it('composes with confidence mode (points = confidence value on a cover)', () => {
        const games = [game({})]; // BUF covers
        const e = entry({ g1: 'BUF' }, { g1: 12 });
        expect(scorePickemEntry(e, games, pool('ATS', true)).points).toBe(12);
    });
});
