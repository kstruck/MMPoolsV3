import { describe, it, expect } from 'vitest';
import {
    BROWSE_TYPE_FILTERS,
    browseCost,
    browsePriceMatches,
    browseStatusMatches,
    browseTypeMatches,
    describeBrowseCard,
} from '../src/utils/browseCard';
import type { Pool } from '../src/types';

/**
 * Public Pools card + filters, per pool type.
 *
 * Production defect, measured 2026-09-08 (the day before NFL kickoff): the two
 * public NFL season pools on /browse rendered as
 * "Game Day Squares · $0 Per Square · AWAY vs HOME · 100 Left" because
 * BrowsePools had no branch for NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN and fell
 * through to the squares one. The type filter had no chip for them either.
 *
 * The non-NFL cases below pin the PREVIOUS behaviour of the component (they
 * were transcribed from it, not designed), so a redesign that changes them on
 * purpose should change these on purpose too.
 */

const survivor = {
    id: 'surv1', type: 'NFL_SURVIVOR', league: 'NFL', name: '2026 Survivor', season: '2026',
    isLocked: false, status: 'OPEN', isPublic: true,
    participantIds: ['a', 'b', 'c'],
    settings: { entryFee: 25, isListedPublic: true, maxStrikes: 1, maxRebuys: 1, paymentInstructions: '', payouts: [] },
} as unknown as Pool;

const pickem = {
    id: 'pick1', type: 'NFL_PICKEM', league: 'NFL', name: '2026 Pick-em', season: '2026',
    isLocked: false, status: 'OPEN', isPublic: true,
    participantIds: ['a'],
    settings: { entryFee: 0, isListedPublic: true, confidenceMode: true, payoutMode: 'SEASON', paymentInstructions: '', payouts: [] },
} as unknown as Pool;

const margin = {
    id: 'marg1', type: 'NFL_MARGIN', league: 'NFL', name: 'Margin', season: '2026',
    isLocked: true, status: 'LIVE', isPublic: true,
    settings: { entryFee: 60, isListedPublic: true, paymentInstructions: '', payouts: [] },
} as unknown as Pool;

const squares = {
    id: 'sq1', type: 'SQUARES', name: 'SB Squares', homeTeam: 'Chiefs', awayTeam: 'Eagles',
    costPerSquare: 10, isLocked: false, league: 'nfl', seasonType: '2', week: 1,
    squares: Array.from({ length: 100 }, (_, i) => ({ id: i, owner: i < 37 ? 'someone' : null })),
    charity: { enabled: true },
} as unknown as Pool;

const legacySquares = { id: 'old1', name: 'Untyped legacy', costPerSquare: 5, squares: [] } as unknown as Pool;

const bracket = {
    id: 'br1', type: 'BRACKET', name: 'Madness', status: 'OPEN', entryCount: 12, isListedPublic: true,
    settings: { entryFee: 20, maxEntriesTotal: 48 },
} as unknown as Pool;

describe('describeBrowseCard — NFL season pools (the production defect)', () => {
    it('Survivor: format label, entry fee, player count, rule chips, no matchup, no grid bar', () => {
        const card = describeBrowseCard(survivor);
        expect(card.typeLabel).toBe('NFL Survivor');
        expect(card.cost).toBe(25);
        expect(card.costUnit).toBe('Entry Fee');
        expect(card.matchup).toBeNull();
        expect(card.fillText).toBe('3 players');
        expect(card.pct).toBeNull();
        expect(card.details).toEqual(['1 strike', 'Rebuys']);
        expect(card.badge).toBe('open');
        expect(card.charityEnabled).toBe(false);
    });

    it("Pick'em: $0 is an honest free pool, not a missing costPerSquare; one player singularises", () => {
        const card = describeBrowseCard(pickem);
        expect(card.typeLabel).toBe("NFL Pick'em");
        expect(card.cost).toBe(0);
        expect(card.costUnit).toBe('Entry Fee');
        expect(card.fillText).toBe('1 player');
        expect(card.details).toEqual(['Straight-up', 'Confidence', 'Season-long']);
    });

    it('Margin: a LIVE pool wears the live badge; no participantIds counts as 0 players', () => {
        const card = describeBrowseCard(margin);
        expect(card.typeLabel).toBe('NFL Margin');
        expect(card.badge).toBe('live');
        expect(card.fillText).toBe('0 players');
    });

    it('never says squares things about a season pool', () => {
        for (const pool of [survivor, pickem, margin]) {
            const card = describeBrowseCard(pool);
            expect(card.typeLabel).not.toContain('Squares');
            expect(card.costUnit).not.toBe('Per Square');
            expect(card.fillText).not.toMatch(/Left$/);
        }
    });

    it('a locked-but-not-live season pool wears the locked badge', () => {
        const locked = { ...(survivor as object), status: 'LOCKED', isLocked: true } as unknown as Pool;
        expect(describeBrowseCard(locked).badge).toBe('locked');
    });

    // codex r1: maybeFinalizeNFLPool stamps `finalizedAt` and never touches
    // `status`, so a finished pool still says OPEN. It must not be joinable-looking.
    it('a scorer-finalized pool (finalizedAt set, status still OPEN) is closed, not open', () => {
        const finished = { ...(survivor as object), status: 'OPEN', finalizedAt: { toMillis: () => 1_700_000_000_000 } } as unknown as Pool;
        expect(describeBrowseCard(finished).badge).toBe('locked');
        expect(browseStatusMatches(finished, 'open')).toBe(false);
        expect(browseStatusMatches(finished, 'live')).toBe(false);
        expect(browseStatusMatches(finished, 'closed')).toBe(true);
    });

    it('a backfilled status FINAL pool is closed too', () => {
        const settled = { ...(pickem as object), status: 'FINAL' } as unknown as Pool;
        expect(describeBrowseCard(settled).badge).toBe('locked');
        expect(browseStatusMatches(settled, 'open')).toBe(false);
        expect(browseStatusMatches(settled, 'closed')).toBe(true);
    });

    // qodo on #677: the manager archive path stores lowercase `archived`; the
    // shared reader maps any unknown string status to open.
    it('an archived pool is closed, not open', () => {
        const archived = { ...(margin as object), status: 'archived', isLocked: false } as unknown as Pool;
        expect(describeBrowseCard(archived).badge).toBe('locked');
        expect(browseStatusMatches(archived, 'open')).toBe(false);
        expect(browseStatusMatches(archived, 'live')).toBe(false);
        expect(browseStatusMatches(archived, 'closed')).toBe(true);
    });

    // qodo on #677: a locked pool (deadline passed, games unscored) matched no
    // bucket but All. It belongs under Live Now, as a LOCKED bracket does.
    it('a locked season pool is found under Live Now, like a locked bracket', () => {
        const locked = { ...(survivor as object), status: 'LOCKED', isLocked: true } as unknown as Pool;
        expect(browseStatusMatches(locked, 'open')).toBe(false);
        expect(browseStatusMatches(locked, 'live')).toBe(true);
        expect(browseStatusMatches(locked, 'closed')).toBe(false);
        const lockedBracket = { ...(bracket as object), status: 'LOCKED' } as unknown as Pool;
        expect(browseStatusMatches(lockedBracket, 'live')).toBe(true);
    });

    it('a null finalizedAt (never finalized) is still open', () => {
        const fresh = { ...(survivor as object), finalizedAt: null } as unknown as Pool;
        expect(describeBrowseCard(fresh).badge).toBe('open');
        expect(browseStatusMatches(fresh, 'open')).toBe(true);
    });
});

describe('describeBrowseCard — previous behaviour pinned for the other types', () => {
    it('Squares: 37 owned of 100 → "63 Left", 37% bar, team matchup, charity flag', () => {
        const card = describeBrowseCard(squares);
        expect(card.typeLabel).toBe('Game Day Squares');
        expect(card.cost).toBe(10);
        expect(card.costUnit).toBe('Per Square');
        expect(card.matchup?.away).toBe('Eagles');
        expect(card.matchup?.home).toBe('Chiefs');
        expect(card.fillText).toBe('63 Left');
        expect(card.pct).toBe(37);
        expect(card.badge).toBe('open');
        expect(card.charityEnabled).toBe(true);
    });

    it('a legacy doc with no type is a squares pool', () => {
        const card = describeBrowseCard(legacySquares);
        expect(card.costUnit).toBe('Per Square');
        expect(card.fillText).toBe('100 Left');
        expect(card.matchup).toEqual({ away: 'Away', home: 'Home', awayLogo: null, homeLogo: null });
    });

    it('Bracket: gold accent, entry fee, entries over capacity', () => {
        const card = describeBrowseCard(bracket);
        expect(card.typeLabel).toBe('March Madness Bracket');
        expect(card.typeAccent).toBe(true);
        expect(card.costUnit).toBe('Entry Fee');
        expect(card.fillText).toBe('12 Entries');
        expect(card.pct).toBe(25);
    });
});

describe('type filter', () => {
    it('offers a chip for every NFL season format', () => {
        const ids = BROWSE_TYPE_FILTERS.map(f => f.id);
        expect(ids).toEqual(expect.arrayContaining(['survivor', 'pickem', 'margin', 'squares', 'props', 'bracket', 'playoff', 'all']));
    });

    it('each chip selects exactly its own type', () => {
        expect(browseTypeMatches(survivor, 'survivor')).toBe(true);
        expect(browseTypeMatches(pickem, 'survivor')).toBe(false);
        expect(browseTypeMatches(pickem, 'pickem')).toBe(true);
        expect(browseTypeMatches(margin, 'margin')).toBe(true);
        expect(browseTypeMatches(squares, 'squares')).toBe(true);
        expect(browseTypeMatches(legacySquares, 'squares')).toBe(true);
        expect(browseTypeMatches(survivor, 'squares')).toBe(false);
        expect(browseTypeMatches(bracket, 'bracket')).toBe(true);
        expect(browseTypeMatches(survivor, 'all')).toBe(true);
    });
});

describe('price filter reads the fee the type actually stores', () => {
    it('NFL season pools bucket on settings.entryFee (they used to count as $0 always)', () => {
        expect(browseCost(survivor)).toBe(25);
        expect(browseCost(margin)).toBe(60);
        expect(browsePriceMatches(survivor, 'mid')).toBe(true);
        expect(browsePriceMatches(survivor, 'low')).toBe(false);
        expect(browsePriceMatches(margin, 'high')).toBe(true);
        expect(browsePriceMatches(pickem, 'low')).toBe(true);
    });

    it('squares and brackets keep their fields', () => {
        expect(browseCost(squares)).toBe(10);
        expect(browseCost(bracket)).toBe(20);
        expect(browsePriceMatches(bracket, 'mid')).toBe(true);
    });
});

describe('status filter', () => {
    it('NFL season pools follow the derived lifecycle state', () => {
        expect(browseStatusMatches(survivor, 'open')).toBe(true);
        expect(browseStatusMatches(survivor, 'live')).toBe(false);
        expect(browseStatusMatches(margin, 'live')).toBe(true);
        expect(browseStatusMatches(margin, 'open')).toBe(false);
        const done = { ...(survivor as object), status: 'COMPLETED' } as unknown as Pool;
        expect(browseStatusMatches(done, 'closed')).toBe(true);
        expect(browseStatusMatches(done, 'open')).toBe(false);
    });

    it('squares and brackets keep their previous rules', () => {
        expect(browseStatusMatches(squares, 'open')).toBe(true);
        expect(browseStatusMatches({ ...(squares as object), isLocked: true, scores: { gameStatus: 'in' } } as unknown as Pool, 'live')).toBe(true);
        expect(browseStatusMatches({ ...(squares as object), scores: { gameStatus: 'post' } } as unknown as Pool, 'closed')).toBe(true);
        expect(browseStatusMatches(bracket, 'open')).toBe(true);
        expect(browseStatusMatches({ ...(bracket as object), status: 'LOCKED' } as unknown as Pool, 'live')).toBe(true);
        expect(browseStatusMatches({ ...(bracket as object), status: 'COMPLETED' } as unknown as Pool, 'closed')).toBe(true);
    });
});
