import { describe, it, expect } from 'vitest';
import {
    computeSurvivorWeekUpdate,
    computeMNFTiebreakerTotal,
} from '../nflScoringEngine';
import type { NFLGame, NFLSurvivorPool, SurvivorEntry } from '../nflPoolTypes';

// PLAN-TEST-SUITE Phase 2 item 13: scoreNFLWeek must be idempotent per
// (poolId, week) — scoring the same week twice yields identical state — and the
// MNF tiebreaker is the COMBINED score of ALL Monday games, resolved only when
// every Monday game is FINAL.

const game = (over: Partial<NFLGame>): NFLGame => ({
    id: 'g1', espnGameId: 'e1', season: '2026', seasonType: 2, week: 1,
    homeTeam: { id: '1', name: 'Chiefs', abbreviation: 'KC' },
    awayTeam: { id: '2', name: 'Bills', abbreviation: 'BUF' },
    startTime: 0,
    status: 'FINAL', scores: { home: 20, away: 10 },
    ...over,
} as NFLGame);

const pool = (maxStrikes = 1): NFLSurvivorPool => ({
    id: 'p1', type: 'NFL_SURVIVOR', name: 'T', season: '2026',
    settings: { maxStrikes, maxRebuys: 1, entryFee: 0, autoSurviveExemptionEnabled: false },
} as unknown as NFLSurvivorPool);

const entry = (over: Partial<SurvivorEntry>): SurvivorEntry => ({
    id: 'u1', poolId: 'p1', ownerUid: 'u1', userName: 'Alice',
    status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0,
    usedTeams: [], picks: {}, exemptWeeks: [],
    submittedAt: 0, paidStatus: 'PAID',
    ...over,
});

// Applies the computed update back onto the entry, as Firestore would.
const apply = (e: SurvivorEntry, u: ReturnType<typeof computeSurvivorWeekUpdate>): SurvivorEntry => ({
    ...e,
    ...u.update,
    eliminatedWeek: u.update.eliminatedWeek ?? undefined,
});

describe('computeSurvivorWeekUpdate — idempotency', () => {
    const games = [game({ id: 'g1' })]; // KC beat BUF

    it('scoring the same week twice yields identical state and no duplicate strike', () => {
        // No pick for week 1 → auto-strike
        const e0 = entry({});
        const r1 = computeSurvivorWeekUpdate(e0, 1, games, pool(1));
        expect(r1.update.strikeWeeks).toEqual([1]);
        expect(r1.update.strikesUsed).toBe(1);
        expect(r1.strikeIsNew).toBe(true);

        const e1 = apply(e0, r1);
        const r2 = computeSurvivorWeekUpdate(e1, 1, games, pool(1));
        expect(r2.update).toEqual(r1.update);
        expect(r2.strikeIsNew).toBe(false); // no duplicate SURVIVOR_AUTO_STRIKE
    });

    it('rescore with corrected data revives a same-week elimination', () => {
        // Sudden death (maxStrikes 0): picked BUF, BUF lost → eliminated week 1
        const e0 = entry({ picks: { 1: 'BUF' } });
        const r1 = computeSurvivorWeekUpdate(e0, 1, games, pool(0));
        expect(r1.update.status).toBe('ELIMINATED');
        expect(r1.update.eliminatedWeek).toBe(1);

        // Score correction: BUF actually won. Rescore of week 1 revives.
        const corrected = [game({ id: 'g1', scores: { home: 10, away: 20 } })];
        const r2 = computeSurvivorWeekUpdate(apply(e0, r1), 1, corrected, pool(0));
        expect(r2.update.status).toBe('ALIVE');
        expect(r2.update.eliminatedWeek).toBeNull();
        expect(r2.update.strikeWeeks).toEqual([]);
    });

    it('entries eliminated in an EARLIER week stay skipped', () => {
        const e = entry({ status: 'ELIMINATED', eliminatedWeek: 1, strikeWeeks: [1], strikesUsed: 1 });
        const r = computeSurvivorWeekUpdate(e, 3, games, pool(0));
        expect(r.skipped).toBe(true);
        expect(r.alive).toBe(false);
    });

    it('rescoring a week at/before lastRebuyWeek never re-strikes a rebuyer', () => {
        const e = entry({ lastRebuyWeek: 2, strikeWeeks: [], strikesUsed: 0, rebuysUsed: 1 });
        const r = computeSurvivorWeekUpdate(e, 1, games, pool(0)); // week 1 <= rebuy week 2
        expect(r.skipped).toBe(true);
        expect(r.alive).toBe(true);
    });

    it('exemption weeks use set semantics across reruns', () => {
        const e0 = entry({ usedTeams: ['KC', 'BUF'] }); // all playing teams used
        const p = pool(1);
        p.settings.autoSurviveExemptionEnabled = true;
        const r1 = computeSurvivorWeekUpdate(e0, 1, games, p);
        expect(r1.update.exemptWeeks).toEqual([1]);
        const r2 = computeSurvivorWeekUpdate(apply(e0, r1), 1, games, p);
        expect(r2.update.exemptWeeks).toEqual([1]); // not [1, 1]
    });
});

describe('computeMNFTiebreakerTotal', () => {
    it('sums BOTH Monday games in a dual-MNF week', () => {
        const games = [
            game({ id: 'm1', isMonday: true, scores: { home: 20, away: 10 } }),
            game({ id: 'm2', isMonday: true, scores: { home: 7, away: 3 } }),
            game({ id: 's1', isMonday: false, scores: { home: 50, away: 50 } }),
        ];
        expect(computeMNFTiebreakerTotal(games)).toBe(40);
    });

    it('returns null while any Monday game is still live (provisional scoring)', () => {
        const games = [
            game({ id: 'm1', isMonday: true, status: 'FINAL' }),
            game({ id: 'm2', isMonday: true, status: 'IN_PROGRESS' }),
        ];
        expect(computeMNFTiebreakerTotal(games)).toBeNull();
    });

    it('returns null when the week has no Monday game', () => {
        expect(computeMNFTiebreakerTotal([game({ isMonday: false })])).toBeNull();
    });
});
