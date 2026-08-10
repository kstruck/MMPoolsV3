import { describe, it, expect } from 'vitest';
import {
    computeSurvivorWeekUpdate,
    computeMNFTiebreakerTotal,
    evaluateSurvivorWeek,
    checkAutoSurviveExemption,
} from '../nflScoringEngine';
import {
    blockedTeamsFor,
    countTeamUses,
    normalizePickWeeks,
    effectiveMaxTeamUses,
    effectiveTieCountsAs,
} from '../shared/survivorReuse';
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

// ============================================================================
// PLAN-SURVIVOR-PARITY-SCORING Phase 1 — tieCountsAs + maxTeamUses
// ============================================================================

/** A survivor pool carrying arbitrary extra settings. */
const parityPool = (settings: Record<string, unknown>): NFLSurvivorPool => ({
    id: 'p1', type: 'NFL_SURVIVOR', name: 'T', season: '2026',
    settings: {
        maxStrikes: 0, maxRebuys: 0, entryFee: 0,
        autoSurviveExemptionEnabled: false, pickLosersMode: false,
        ...settings,
    },
} as unknown as NFLSurvivorPool);

const tiedGame = [game({ id: 'g1', scores: { home: 17, away: 17 } })]; // KC 17 - BUF 17

describe('countTeamUses — week-key grammar', () => {
    it('counts one use per LOGICAL week and excludes the current week', () => {
        const picks = { 1: 'KC', 2: 'KC', 3: 'BUF' } as Record<number, string>;
        expect(countTeamUses(picks)).toEqual({ KC: 2, BUF: 1 });
        expect(countTeamUses(picks, 2)).toEqual({ KC: 1, BUF: 1 });
    });

    it('treats "01" as week 1 — so it is EXCLUDED when week 1 is', () => {
        // The self-resubmit case: a stringified-with-leading-zero key must not
        // consume a use against its own week (PR #384's rule, generalized).
        expect(countTeamUses({ '01': 'KC' } as never, 1)).toEqual({});
        expect(countTeamUses({ '01': 'KC' } as never, 2)).toEqual({ KC: 1 });
    });

    it('collapses duplicate spellings of one week — canonical spelling wins', () => {
        expect(countTeamUses({ '1': 'KC', '01': 'KC' } as never)).toEqual({ KC: 1 });
        // Different teams for the same logical week: canonical "1" holds.
        expect(countTeamUses({ '01': 'BUF', '1': 'KC' } as never)).toEqual({ KC: 1 });
        expect(normalizePickWeeks({ '01': 'BUF', '1': 'KC' } as never).get(1)).toBe('KC');
    });

    it('skips malformed and out-of-range keys rather than coercing them', () => {
        const picks = {
            '1.5': 'KC', '2junk': 'KC', ' 1': 'KC', '1e0': 'KC',
            '-1': 'KC', '0': 'KC', '24': 'KC', '': 'KC',
        } as never;
        expect(countTeamUses(picks)).toEqual({});
    });

    it('tolerates a missing or non-object picks map', () => {
        expect(countTeamUses(undefined)).toEqual({});
        expect(countTeamUses(null)).toEqual({});
    });
});

describe('effective setting defaults', () => {
    it('absent settings read as today behaviour', () => {
        expect(effectiveTieCountsAs(undefined)).toBe('LOSS');
        expect(effectiveTieCountsAs({})).toBe('LOSS');
        expect(effectiveMaxTeamUses(undefined)).toBe(1);
        expect(effectiveMaxTeamUses({})).toBe(1);
    });

    it('a garbage stored value falls back to the default, never to unlimited', () => {
        // An Admin-SDK or console write is not bound by the callable's
        // validation; a negative must not read as "0 = unlimited".
        expect(effectiveMaxTeamUses({ maxTeamUses: -1 })).toBe(1);
        expect(effectiveMaxTeamUses({ maxTeamUses: 1.5 })).toBe(1);
        expect(effectiveMaxTeamUses({ maxTeamUses: '0' })).toBe(1);
        expect(effectiveTieCountsAs({ tieCountsAs: 'win' })).toBe('LOSS');
        // The legitimate values still read through.
        expect(effectiveMaxTeamUses({ maxTeamUses: 0 })).toBe(0);
        expect(effectiveTieCountsAs({ tieCountsAs: 'WIN' })).toBe('WIN');
    });
});

describe('blockedTeamsFor — the client grid must agree with the callable', () => {
    // The component holds no branch of its own: it calls this. These are the
    // client-gating regression cases (SurvivorPickEntry.tsx).
    it('default limit: usedTeams is the authority, current week excluded', () => {
        const blocked = blockedTeamsFor({ 1: 'KC', 2: 'BUF' }, ['KC', 'BUF', 'SF'], 2, 1);
        expect([...blocked].sort()).toEqual(['KC', 'SF']); // BUF is this week's own pick
    });

    it('default limit: a DIVERGENT ledger still wins — today behaviour, unchanged', () => {
        // Seeded/legacy entries exist whose usedTeams does not match picks
        // (e.g. the auto-survive fixtures). Counting picks here would offer a
        // team the ledger says is spent.
        expect([...blockedTeamsFor({}, ['KC'], 1, 1)]).toEqual(['KC']);
        // ...and a team in picks but NOT in the ledger stays offered.
        expect([...blockedTeamsFor({ 3: 'SF' }, [], 1, 1)]).toEqual([]);
    });

    it('handles a stringified current-week key when excluding this week', () => {
        expect([...blockedTeamsFor({ '2': 'BUF' }, ['BUF'], 2, 1)]).toEqual([]);
    });

    it('limit 2: blocked only at the limit, current week excluded', () => {
        expect([...blockedTeamsFor({ 1: 'KC' }, [], 5, 2)]).toEqual([]);
        expect([...blockedTeamsFor({ 1: 'KC', 2: 'KC' }, [], 5, 2)]).toEqual(['KC']);
        // The member is looking at week 2, where KC is already their pick — it
        // must stay re-submittable, matching the callable's exclusion.
        expect([...blockedTeamsFor({ 1: 'KC', 2: 'KC' }, [], 2, 2)]).toEqual([]);
    });

    it('unlimited blocks nothing, however long the history', () => {
        expect([...blockedTeamsFor({ 1: 'KC', 2: 'KC', 3: 'KC' }, ['KC'], 9, 0)]).toEqual([]);
    });
});

describe('evaluateSurvivorWeek — tieCountsAs × pickLosersMode', () => {
    const e = entry({ picks: { 1: 'KC' } });

    it('DEFAULT (absent): a tie strikes in BOTH modes — today behaviour', () => {
        expect(evaluateSurvivorWeek(e, 1, tiedGame, parityPool({})).strikeLogged).toBe(true);
        expect(evaluateSurvivorWeek(e, 1, tiedGame, parityPool({ pickLosersMode: true })).strikeLogged).toBe(true);
    });

    it('explicit LOSS is identical to absent, in both modes', () => {
        expect(evaluateSurvivorWeek(e, 1, tiedGame, parityPool({ tieCountsAs: 'LOSS' })).strikeLogged).toBe(true);
        expect(evaluateSurvivorWeek(e, 1, tiedGame, parityPool({ tieCountsAs: 'LOSS', pickLosersMode: true })).strikeLogged).toBe(true);
    });

    it('WIN + standard: the tie survives', () => {
        const r = evaluateSurvivorWeek(e, 1, tiedGame, parityPool({ tieCountsAs: 'WIN' }));
        expect(r).toEqual({ survived: true, strikeLogged: false });
    });

    it('WIN + pick-losers: the tie STRIKES — the picked team "won"', () => {
        const r = evaluateSurvivorWeek(e, 1, tiedGame, parityPool({ tieCountsAs: 'WIN', pickLosersMode: true }));
        expect(r).toEqual({ survived: false, strikeLogged: true });
    });

    it('a decided game is unaffected by tieCountsAs', () => {
        const decided = [game({ id: 'g1' })]; // KC 20 - BUF 10
        for (const tieCountsAs of ['WIN', 'LOSS'] as const) {
            expect(evaluateSurvivorWeek(e, 1, decided, parityPool({ tieCountsAs })).strikeLogged).toBe(false);
            expect(evaluateSurvivorWeek(entry({ picks: { 1: 'BUF' } }), 1, decided, parityPool({ tieCountsAs })).strikeLogged).toBe(true);
        }
    });
});

describe('checkAutoSurviveExemption — maxTeamUses tri-mode', () => {
    const games = [game({ id: 'g1' })]; // KC and BUF play

    it('no reuse context: usedTeams stays the authority (today path)', () => {
        expect(checkAutoSurviveExemption(['KC', 'BUF'], games, true)).toBe(true);
        expect(checkAutoSurviveExemption(['KC'], games, true)).toBe(false);
    });

    it('maxTeamUses 1 keeps usedTeams authority even when picks DISAGREE', () => {
        // The legacy-divergence guarantee: a seeded usedTeams that does not
        // match picks must produce the same outcome it does today. Counting
        // picks here would return false and change the entry outcome.
        const reuse = { maxTeamUses: 1, picks: {} as Record<number, string>, week: 1 };
        expect(checkAutoSurviveExemption(['KC', 'BUF'], games, true, reuse)).toBe(true);
    });

    it('maxTeamUses 2: a team picked once is still eligible, twice is not', () => {
        const once = { maxTeamUses: 2, picks: { 1: 'KC', 2: 'BUF' }, week: 9 };
        expect(checkAutoSurviveExemption([], games, true, once)).toBe(false);
        const twice = { maxTeamUses: 2, picks: { 1: 'KC', 2: 'KC', 3: 'BUF', 4: 'BUF' }, week: 9 };
        expect(checkAutoSurviveExemption([], games, true, twice)).toBe(true);
    });

    it('maxTeamUses 0 (unlimited): the exemption can NEVER fire', () => {
        const exhausted = {
            maxTeamUses: 0,
            picks: { 1: 'KC', 2: 'KC', 3: 'BUF', 4: 'BUF', 5: 'KC' },
            week: 9,
        };
        expect(checkAutoSurviveExemption(['KC', 'BUF'], games, true, exhausted)).toBe(false);
        // And an all-cancelled slate still cannot reach it — teamsPlaying is
        // empty, which is isVoidWeek's job, not this helper's.
        const cancelled = [game({ id: 'g1', status: 'CANCELLED' })];
        expect(checkAutoSurviveExemption([], cancelled, true, exhausted)).toBe(false);
    });

    it('a FUTURE-week reservation counts as a use — in BOTH modes, matching production', () => {
        // codex round 4 raised this as a P1 against the maxTeamUses >= 2 path:
        // scoring week 3 while the member has pre-submitted picks for weeks 5-6
        // counts those reservations, so the exemption can excuse an earlier
        // week's missed pick. The observation is right, but it is NOT something
        // this PR introduces — `submitNFLPicks` writes every submitted team into
        // `usedTeams` whatever week it is for, so the DEPLOYED default path has
        // exactly the same property. Both assertions below pass on `main`'s
        // logic and on the new one.
        //
        // This test exists to keep them EQUAL. Changing only the counted path
        // would split behaviour between a default pool and a configured one,
        // which is the split the tri-mode guarantee exists to prevent. If this
        // is ever fixed it must be fixed for both, as its own scoring change
        // with its own plan gate.
        const reservedLater = { maxTeamUses: 2, picks: { 5: 'KC', 6: 'KC', 7: 'BUF', 8: 'BUF' }, week: 3 };
        expect(checkAutoSurviveExemption(['KC', 'BUF'], games, true)).toBe(true);
        expect(checkAutoSurviveExemption([], games, true, reservedLater)).toBe(true);
    });

    it('the exemption toggle still wins over every mode', () => {
        expect(checkAutoSurviveExemption(['KC', 'BUF'], games, false, { maxTeamUses: 2, picks: {}, week: 1 })).toBe(false);
    });
});

describe('computeSurvivorWeekUpdate — idempotency under the new settings', () => {
    it('rescoring a tied week twice is identical, for WIN and for LOSS', () => {
        for (const tieCountsAs of ['WIN', 'LOSS'] as const) {
            const p = parityPool({ tieCountsAs, maxStrikes: 1 });
            const e0 = entry({ picks: { 1: 'KC' } });
            const r1 = computeSurvivorWeekUpdate(e0, 1, tiedGame, p);
            const r2 = computeSurvivorWeekUpdate(apply(e0, r1), 1, tiedGame, p);
            expect(r2.update, tieCountsAs).toEqual(r1.update);
            expect(r2.strikeIsNew, tieCountsAs).toBe(false);
        }
    });

    it('flipping tieCountsAs to WIN on rescore clears the tie strike', () => {
        const e0 = entry({ picks: { 1: 'KC' } });
        const struck = computeSurvivorWeekUpdate(e0, 1, tiedGame, parityPool({ maxStrikes: 1 }));
        expect(struck.update.strikeWeeks).toEqual([1]);
        const rescored = computeSurvivorWeekUpdate(
            apply(e0, struck), 1, tiedGame, parityPool({ maxStrikes: 1, tieCountsAs: 'WIN' }),
        );
        expect(rescored.update.strikeWeeks).toEqual([]);
    });

    it('maxTeamUses 2 grants no exemption to an entry with a team still available', () => {
        const p = parityPool({ maxStrikes: 1, maxTeamUses: 2, autoSurviveExemptionEnabled: true });
        // usedTeams says both teams are spent — under maxTeamUses 2 the picks
        // map is the authority and KC has one use left, so no exemption and the
        // week grades normally.
        const e = entry({ usedTeams: ['KC', 'BUF'], picks: { 1: 'KC', 9: 'KC' } });
        const r = computeSurvivorWeekUpdate(e, 9, [game({ id: 'g1' })], p);
        expect(r.update.exemptWeeks).toEqual([]);
        expect(r.update.strikeWeeks).toEqual([]); // KC won
    });
});
