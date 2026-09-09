/**
 * Public Pools (/browse) card model + filter predicates, per pool type.
 *
 * WHY THIS EXISTS. BrowsePools.tsx branched on BRACKET / NFL_PLAYOFFS / PROPS
 * and let everything else fall into the SQUARES branch. The three NFL season
 * types (NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN) were never added, so on
 * production (measured 2026-09-08, the day before kickoff) a public Survivor
 * pool rendered as "Game Day Squares · $0 Per Square · AWAY vs HOME · 100 Left"
 * — a `squares` array it does not have, counted as a 10x10 grid. The type
 * filter had no Survivor / Pick'em / Margin chip either, and the price and
 * status filters read fields those pools do not carry.
 *
 * Same defect class the admin pool list had (MembersTab, fixed via
 * getPoolEntrySummary). This file reuses those readers rather than growing a
 * third copy, and is pure so the card can be unit-tested without a DOM.
 *
 * Non-NFL-season branches reproduce the component's previous behaviour exactly
 * (including the arbitrary 50% / 20% bars on playoff and props pools) — this
 * PR fixes the NFL rendering, it does not redesign the card.
 */
import type { Pool, GameState, BracketPool, PlayoffPool, PropsPool, Square } from '../types';
import { getTeamLogo } from '../constants';
import { getPoolTypeName } from './poolUtils';
import { poolTypeLabel, poolOptionLabels } from './poolTypeLabel';
import { formatEntryCount, getPoolEntrySummary, getPoolLifecycleState, isNFLSeasonPoolType } from './poolSport';
import type { EntryCountable, LifecycleReadable, PoolLifecycleState } from './poolSport';

/**
 * Lifecycle state for an NFL season pool, finalization-aware.
 *
 * The scorer's finalizer (functions/src/nflFinalize.ts, `maybeFinalizeNFLPool`)
 * stamps `finalizedAt` and writes NO status — a finished Survivor pool keeps
 * `status: 'OPEN'` (or LOCKED) for good. `backfillPools` can also stamp
 * `status: 'FINAL'`, and the manager archive path stores lowercase `archived`
 * (declared on every NFL pool type; `poolInclusion.ts` and `reminders.ts`
 * already treat it as finished). `getPoolLifecycleState` reads none of the
 * three, so on its own a finished or archived season pool would sit under the
 * default Open filter wearing an Open badge (codex r1 + qodo on this PR).
 * Resolved here rather than in the shared reader because that reader also
 * feeds `isActiveManagedPool` (commissioner rosters and stats), whose
 * semantics are not this PR's to change.
 *
 * Verified 2026-09-08 (re-run before trusting):
 *   grep -n "finalizedAt\|status" functions/src/nflFinalize.ts   # :411 finalizedAt, no status write
 *   grep -n "'FINAL'" functions/src/backfill.ts                   # :137 status FINAL
 *   grep -rn "'archived'" functions/src/lib/poolInclusion.ts functions/src/reminders.ts
 */
function nflSeasonLifecycle(pool: Pool): PoolLifecycleState {
    const p = pool as { finalizedAt?: unknown; status?: string };
    if (p.finalizedAt !== undefined && p.finalizedAt !== null) return 'final';
    const status = typeof p.status === 'string' ? p.status.toUpperCase() : '';
    if (status === 'FINAL' || status === 'ARCHIVED') return 'final';
    return getPoolLifecycleState(pool as LifecycleReadable);
}

export type BrowseTypeFilter = 'all' | 'squares' | 'props' | 'bracket' | 'playoff' | 'survivor' | 'pickem' | 'margin';
export type BrowsePriceFilter = 'all' | 'low' | 'mid' | 'high'; // low < 20, mid 20-50, high > 50
export type BrowseStatusFilter = 'all' | 'open' | 'live' | 'closed';

/** Chip order on the sidebar. NFL season chips lead: it is football season. */
export const BROWSE_TYPE_FILTERS: ReadonlyArray<{ id: BrowseTypeFilter; label: string }> = [
    { id: 'all', label: 'All Types' },
    { id: 'survivor', label: 'Survivor' },
    { id: 'pickem', label: "Pick'em" },
    { id: 'margin', label: 'Margin' },
    { id: 'squares', label: 'Squares' },
    { id: 'props', label: 'Side Hustle' },
    { id: 'bracket', label: 'NCAA Brackets' },
    { id: 'playoff', label: 'Playoff Brackets' },
];

const FILTER_TO_TYPE: Record<Exclude<BrowseTypeFilter, 'all' | 'squares'>, string> = {
    props: 'PROPS',
    bracket: 'BRACKET',
    playoff: 'NFL_PLAYOFFS',
    survivor: 'NFL_SURVIVOR',
    pickem: 'NFL_PICKEM',
    margin: 'NFL_MARGIN',
};

/** SQUARES is also the legacy shape: a pool doc with no `type` is a squares pool. */
export function isSquaresPool(pool: { type?: string }): boolean {
    return !pool.type || pool.type === 'SQUARES';
}

/** Does this pool belong under the selected Pool Type chip? `all` admits everything. */
export function browseTypeMatches(pool: { type?: string }, filter: BrowseTypeFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'squares') return isSquaresPool(pool);
    return pool.type === FILTER_TO_TYPE[filter];
}

/** The dollar figure the card prints and the price filter buckets on. */
export function browseCost(pool: Pool): number {
    if (isSquaresPool(pool)) return (pool as GameState).costPerSquare || 0;
    if (pool.type === 'PROPS') return (pool as PropsPool).props?.cost || 0;
    // BRACKET, NFL_PLAYOFFS and the three NFL season types all keep it at settings.entryFee.
    const fee = (pool as { settings?: { entryFee?: number } }).settings?.entryFee;
    return typeof fee === 'number' ? fee : 0;
}

/** Entry Cost buckets over `browseCost`: low < $20, mid $20–$50 inclusive, high > $50. */
export function browsePriceMatches(pool: Pool, filter: BrowsePriceFilter): boolean {
    if (filter === 'all') return true;
    const cost = browseCost(pool);
    if (filter === 'low') return cost < 20;
    if (filter === 'mid') return cost >= 20 && cost <= 50;
    return cost > 50;
}

/**
 * Game Status buckets, per type. BRACKET reads its string status; NFL season
 * types read the finalization-aware lifecycle; SQUARES (and, as before, PROPS
 * and NFL_PLAYOFFS) read `isLocked` + `scores.gameStatus`.
 */
export function browseStatusMatches(pool: Pool, filter: BrowseStatusFilter): boolean {
    if (filter === 'all') return true;
    if (pool.type === 'BRACKET') {
        const status = (pool as BracketPool).status;
        if (filter === 'open') return status === 'OPEN';
        if (filter === 'live') return status === 'LIVE' || status === 'LOCKED';
        return status === 'COMPLETED';
    }
    if (isNFLSeasonPoolType(pool.type)) {
        // Three buckets for five states. `locked` (deadline passed, games not yet
        // scored) goes under "Live Now", the same call the BRACKET branch makes
        // above — otherwise a locked pool matched no bucket but All (qodo on
        // this PR).
        const state = nflSeasonLifecycle(pool);
        if (filter === 'open') return state === 'open';
        if (filter === 'live') return state === 'live' || state === 'locked';
        return state === 'final' || state === 'closed';
    }
    // SQUARES / legacy, and (as before) PROPS + NFL_PLAYOFFS read through the squares fields.
    const s = pool as GameState;
    if (filter === 'open') return !isSquaresPool(pool) || !s.isLocked;
    if (filter === 'live') return !!s.isLocked && s.scores?.gameStatus === 'in';
    return s.scores?.gameStatus === 'post';
}

export interface BrowseCardModel {
    /** Sub-line under the pool name, e.g. "Game Day Squares", "NFL Survivor". */
    typeLabel: string;
    /** Gold accent on the sub-line and avatar (brackets only, as before). */
    typeAccent: boolean;
    cost: number;
    costUnit: 'Per Square' | 'Entry Fee';
    /** The AWAY vs HOME strip. null for pools that have no single matchup. */
    matchup: { away: string; home: string; awayLogo: string | null; homeLogo: string | null } | null;
    /** Rule chips shown instead of a matchup, e.g. ["Straight-up", "Confidence", "Season-long"]. */
    details: string[];
    /** "37 Left" (squares) or "12 Entries" / "8 players". */
    fillText: string;
    /** Fill bar 0–100, or null to hide the bar (no meaningful capacity). */
    pct: number | null;
    badge: 'open' | 'locked' | 'live';
    charityEnabled: boolean;
}

/** Everything the Public Pools card prints for one pool, dispatched on `pool.type`. Pure. */
export function describeBrowseCard(pool: Pool): BrowseCardModel {
    if (pool.type === 'BRACKET') {
        const bp = pool as BracketPool;
        const filled = bp.entryCount || 0;
        const max = bp.settings.maxEntriesTotal === -1 ? 100 : bp.settings.maxEntriesTotal; // Mock 100 if unlimited for progress
        const locked = bp.status === 'LOCKED' || bp.status === 'LIVE' || bp.status === 'COMPLETED';
        return {
            typeLabel: 'March Madness Bracket',
            typeAccent: true,
            cost: bp.settings.entryFee,
            costUnit: 'Entry Fee',
            matchup: { away: 'Bracket', home: 'Tournament', awayLogo: null, homeLogo: null },
            details: [],
            fillText: `${filled} Entries`,
            pct: bp.settings.maxEntriesTotal === -1 ? 0 : Math.round((filled / max) * 100),
            badge: locked ? 'locked' : 'open',
            charityEnabled: false,
        };
    }
    if (pool.type === 'NFL_PLAYOFFS') {
        const pp = pool as PlayoffPool;
        return {
            typeLabel: getPoolTypeName(pool as unknown as GameState),
            typeAccent: false,
            cost: pp.settings?.entryFee || 0,
            costUnit: 'Per Square',
            matchup: { away: 'Playoffs', home: 'NFL', awayLogo: null, homeLogo: null },
            details: [],
            fillText: `${Object.keys(pp.entries || {}).length} Entries`,
            pct: 50, // Arbitrary for now
            badge: pp.isLocked ? 'locked' : 'open',
            charityEnabled: false,
        };
    }
    if (pool.type === 'PROPS') {
        const pp = pool as PropsPool;
        return {
            typeLabel: getPoolTypeName(pool as unknown as GameState),
            typeAccent: false,
            cost: pp.props?.cost || 0,
            costUnit: 'Per Square',
            matchup: { away: 'Pool', home: 'Props', awayLogo: null, homeLogo: null },
            details: [],
            fillText: `${pp.entryCount || 0} Entries`,
            pct: 20, // Arbitrary
            badge: pp.isLocked ? 'locked' : 'open',
            charityEnabled: false,
        };
    }
    if (isNFLSeasonPoolType(pool.type)) {
        // Season-long pools: no single matchup, no grid. The honest count is
        // players on the pool doc (getPoolEntrySummary); the rule chips are the
        // same words the My Entries cards and the Commissioner Hub use.
        const summary = getPoolEntrySummary(pool as EntryCountable);
        const state = nflSeasonLifecycle(pool);
        const charity = (pool as { charity?: { enabled?: boolean } }).charity;
        return {
            typeLabel: `NFL ${poolTypeLabel(pool)}`,
            typeAccent: false,
            cost: browseCost(pool),
            costUnit: 'Entry Fee',
            matchup: null,
            details: poolOptionLabels(pool),
            fillText: formatEntryCount(summary),
            pct: null,
            badge: state === 'live' ? 'live' : state === 'open' ? 'open' : 'locked',
            charityEnabled: !!charity?.enabled,
        };
    }
    // SQUARES, or a legacy doc with no type.
    const sp = pool as GameState;
    const filled = sp.squares?.filter((s: Square) => s.owner).length || 0;
    return {
        typeLabel: getPoolTypeName(sp),
        typeAccent: false,
        cost: sp.costPerSquare || 0,
        costUnit: 'Per Square',
        matchup: {
            away: sp.awayTeam || 'Away',
            home: sp.homeTeam || 'Home',
            awayLogo: sp.awayTeamLogo || getTeamLogo(sp.awayTeam || '') || null,
            homeLogo: sp.homeTeamLogo || getTeamLogo(sp.homeTeam || '') || null,
        },
        details: [],
        fillText: `${100 - filled} Left`,
        pct: Math.round((filled / 100) * 100),
        badge: sp.isLocked ? 'locked' : 'open',
        charityEnabled: !!sp.charity?.enabled,
    };
}
