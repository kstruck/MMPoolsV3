import type { NFLGame } from '../types';
import type { PicksGridCell } from './picksGrid';
import { gradePick, hasReportedScores } from './pickemResult';

/**
 * W-L, Max and Pts Left for one row of the Current Picks grid
 * (PLAN-SPLIT-POT-SETTLEMENT Part B, Kevin 2026-10-08; Pts Left added
 * 2026-11-19, and shown on Week Results too).
 *
 * 🛑 THIS GRADES NOTHING AND REVEALS NOTHING. Every result comes from a cell
 * `picksGridCell` already built (and `gradePick` already graded, parity-pinned to
 * the scorer by `tests/pickem-result-parity.test.ts`), and every cell is already
 * gated by the server's reveal allowlist. This module only COUNTS cells. It must
 * never read a pick the grid is not already showing — an unrevealed pick is a
 * `HIDDEN` cell, and it contributes nothing but the one fact the server's
 * saved-pick count (`reveal.counts`) already discloses: HOW MANY picks the
 * player has saved. (That count was once printed as the grid's Set column; it
 * still prices unrevealed picks here.)
 *
 * Max = points already earned + points still winnable this week.
 *
 *   earned     standard → wins; confidence → Σ weight over won picks
 *   remaining  every pick on a game that has not concluded (its weight, or 1),
 *              PLUS, on a row whose picks are not all revealed, the picks the
 *              reveal has not shown yet (`setCount − revealed picks`, ×1 each)
 *
 * `max` is `null` — printed "?" — whenever the answer would be a guess:
 *   - another player's row and the reveal has not arrived (`COUNT_UNKNOWN`);
 *   - confidence scoring and some of their picks are unrevealed, so their
 *     weights are unknowable (`WEIGHTS_HIDDEN`);
 *   - a confidence pick with no stored weight (`WEIGHT_MISSING`).
 *
 * Pts Left (`left`) = points still winnable on games NOT YET DECIDED — not
 * `max − earned`, because Max keeps a hidden pick on a finished game as an upper
 * bound. `null` when it would be a guess: a reveal/count is missing and a hidden
 * game is still open (`COUNT_UNKNOWN`); a hidden pick could sit on either a
 * finished or an open game (`COUNT_UNKNOWN`); in confidence scoring an
 * unrevealed pick could sit on an open game (`WEIGHTS_HIDDEN`); or a pick still
 * in play has no stored weight (`WEIGHT_MISSING`).
 *
 * PUSH and VOID earn nothing and are nobody's mistake: excluded from W-L and
 * from Max. A FINAL the feed reported no scores for stays ungraded (`null`), is
 * left out of W-L, and STAYS in Max: the scorer will grade it when scores arrive,
 * so it is still winnable, and Max is an upper bound that must not dip below what
 * that grade could give.
 *
 * Pure and clock-free: no `now`, no lock arithmetic. Whether a game is over is
 * the game's own `status`, the same field `gradePick` reads.
 */

/**
 * `TOTAL_STALE` is a Pts Left reason only: the server's hidden-points total is
 * older than the game statuses on screen (see `tallyGridRow`). It has its own
 * value, not a borrowed one, because the tooltip must say what is actually
 * wrong. The first version reused `WEIGHTS_HIDDEN`, whose tooltip blames
 * unrevealed confidence weights (qodo on #805).
 */
export type MaxUnknownReason = 'COUNT_UNKNOWN' | 'WEIGHTS_HIDDEN' | 'WEIGHT_MISSING' | 'TOTAL_STALE';

export interface GridRowTally {
    wins: number;
    losses: number;
    earned: number;
    /** The most this row can finish the week with: `earned` + still winnable. `null` when unknowable. */
    max: number | null;
    maxUnknown?: MaxUnknownReason;
    /**
     * Points still winnable on games NOT YET DECIDED — the "Pts Left" column.
     * Not `max − earned`: Max keeps a hidden pick on a finished game (the reveal
     * can lag the game, and that pick may already be a win), which is right for
     * an upper bound and wrong for "left to play". `null` when unknowable.
     */
    left: number | null;
    leftUnknown?: MaxUnknownReason;
}

/**
 * Is this game DECIDED — no pick on it can still be "points left"?
 *
 * CANCELLED, or a FINAL the feed has reported scores for. A FINAL with no
 * scores is NOT decided: the scorer grades it when they arrive. The server uses
 * the same rule for the total it sends (`functions/src/nflPickReveal.ts`).
 *
 * Not the same question as `hiddenGameCanPay` below: a FINAL game with scores
 * is decided (nothing is LEFT on it) and can still pay (a hidden pick on it may
 * already be a win, so it stays in Max).
 */
export function isGameDecided(game: Pick<NFLGame, 'status' | 'scores'>): boolean {
    return game.status === 'CANCELLED' || (game.status === 'FINAL' && hasReportedScores(game as NFLGame));
}

/**
 * The ids of the games not yet decided, by the statuses in hand.
 * `undefined` for an empty schedule: "no games loaded yet" must not read as
 * "every game was already decided".
 */
export function undecidedGameIds(games: readonly NFLGame[]): string[] | undefined {
    if (games.length === 0) return undefined;
    return games.filter((g) => !isGameDecided(g)).map((g) => g.id);
}

/**
 * Fetch a reveal and stamp it with the games that were open WHEN THE REQUEST
 * WAS SENT (`hiddenLeftOpenGameIds`).
 *
 * 🛑 BEFORE THE CALL, NOT WHEN THE RESPONSE LANDS. The server computes its
 * hidden-points total from its own game read, some time after the request
 * leaves. A stamp taken on arrival can already show a game as decided that the
 * server still counted — the game would then be missing from the stamp, the
 * stale check in `tallyGridRow` would not fire, and Pts Left would print the
 * too-high number this exists to stop (the Claude pre-review of the fix found
 * exactly that ordering). Taken before the call, the stamp is a superset of
 * what the server can have counted.
 *
 * The cost of that choice is the safe direction: a game decided between the
 * request and the server's read is in the stamp but not in the total, so Pts
 * Left reads "?" until the next poll although the total was right. A spurious
 * "?" for one poll, never a wrong number.
 *
 * `gamesNow` is read synchronously, so a caller may pass a ref's current value.
 */
export function fetchStampedReveal<R extends object>(
    fetch: () => Promise<R>,
    gamesNow: readonly NFLGame[],
): Promise<R & { hiddenLeftOpenGameIds?: string[] }> {
    const openAtRequest = undecidedGameIds(gamesNow);
    return fetch().then((r) => ({ ...r, hiddenLeftOpenGameIds: openAtRequest }));
}

/**
 * Should the dashboard fetch this week's reveal AGAIN, to get a stamped one?
 *
 * The first reveal request of a page load can leave before the schedule
 * subscription has delivered any games. `fetchStampedReveal` then has nothing
 * to stamp with, and the total comes back unstamped. The tables do not use an
 * unstamped total (they print "?"), so without a second fetch the row would
 * stay "?" until the next poll, up to five minutes for a member.
 *
 * True only when a refetch can actually help: there IS a total, it has no
 * stamp, and the schedule has now loaded. A stamped reveal — even one stamped
 * with an empty list — returns false, so this cannot loop.
 */
export function needsStampedRefetch(
    reveal: { hiddenLeft?: unknown; hiddenLeftOpenGameIds?: readonly string[] } | null | undefined,
    scheduleLoaded: boolean,
): boolean {
    return scheduleLoaded && !!reveal && reveal.hiddenLeft !== undefined && reveal.hiddenLeftOpenGameIds === undefined;
}

/**
 * Could a pick on this game that we cannot see still earn a point?
 *
 *   CANCELLED                  never — grades VOID.
 *   FINAL, a tie / exact cover never — grades PUSH. A PUSH does not depend on
 *                              which side was picked, so any pick answers it.
 *   FINAL, no reported scores  YES — it is not settled: the scorer grades it
 *                              once scores arrive, and showing Max below what
 *                              that grade could give would break the upper
 *                              bound (qodo #2 on #722 asked for a number that
 *                              is not 0; the honest one is the upper bound).
 *   FINAL, otherwise           yes — the hidden pick may already be a win, and
 *                              dropping it could put Max BELOW the real score
 *                              (the reveal can lag the game document).
 *   not over yet               yes.
 */
function hiddenGameCanPay(game: NFLGame, pickMode: string | undefined): boolean {
    if (game.status === 'CANCELLED') return false;
    if (game.status !== 'FINAL') return true;
    if (!hasReportedScores(game)) return true;
    // PUSH is independent of the side picked, so either team answers it; a real
    // team is needed because `gradePick` returns null for an empty pick.
    return gradePick(game, game.homeTeam.abbreviation, pickMode) !== 'PUSH';
}

export function tallyGridRow(args: {
    weekGames: readonly NFLGame[];
    /** What the grid already computed for this row, keyed by game id. */
    cells: ReadonlyMap<string, PicksGridCell>;
    /** The saved-pick count: the server's (`reveal.counts`), or the viewer's own. Prices unrevealed picks. */
    setCount: number | undefined;
    /** The server's reveal mode, or `undefined` when the reveal has not arrived. */
    revealMode: 'WEEK' | 'PER_GAME' | undefined;
    isOwnRow: boolean;
    confidenceMode: boolean;
    /** `settings.pickMode` — the same value `picksGridCell` grades with. */
    pickMode?: string;
    /**
     * The server's total for this row's picks that are hidden from the viewer and
     * on games not yet decided (`reveal.hiddenLeft`, PLAN-PTS-LEFT-HIDDEN-TOTAL):
     * their confidence weights summed, or one per pick. `undefined` when there is
     * no total to use — the pre-deploy server, a non-Pick'em pool, a hidden pick
     * with no stored weight, or the commissioner's "Show Everyone's Pts Left"
     * setting being OFF (the server then sends none, and the callers pass
     * `undefined` even for a total still held from before it was turned off) —
     * and the tally falls back to bounding them.
     */
    hiddenLeft?: number;
    /**
     * The games that were not yet decided WHEN `hiddenLeft` WAS FETCHED
     * (`reveal.hiddenLeftOpenGameIds`, stamped by the dashboard). `hiddenLeft`
     * is a snapshot and `weekGames` is live: a hidden game in this set that is
     * decided now may still be counted in the total. The callers pass a total
     * ONLY together with its stamp: an unstamped total has nothing to be checked
     * against, so they withhold it and the row reads "?" until a stamped one
     * arrives (qodo on #805 — the first request of a page load can beat the
     * schedule). `undefined` here therefore means no staleness check is possible,
     * which only a direct caller such as a test should ever rely on.
     */
    hiddenLeftOpenAtFetch?: ReadonlySet<string>;
}): GridRowTally {
    const { weekGames, cells, setCount, revealMode, isOwnRow, confidenceMode, pickMode, hiddenLeft, hiddenLeftOpenAtFetch } = args;

    let wins = 0;
    let losses = 0;
    let earned = 0;
    let remaining = 0;
    let revealedPicks = 0;
    let hiddenCells = 0;
    // Hidden games that can still pay (`hiddenGameCanPay`): a pick on one that
    // can never score is counted in Set but must not be priced in Max.
    let hiddenLive = 0;
    // Hidden games not yet DECIDED (not cancelled, and not a FINAL with scores):
    // the only hidden games whose picks count as points LEFT (codex r1 on the
    // Pts Left PR — a lagging reveal must not show a finished game as left).
    let hiddenOpen = 0;
    // Hidden games already DECIDED that could still have paid (a reveal lagging
    // a finished game): the server's `hiddenLeft` does not cover these, and a
    // pick on one may already be a win, so Max must still allow for it.
    let hiddenDecidedLive = 0;
    // Hidden games decided NOW that were still open when the server's total was
    // fetched: the total may count a pick on each of them, and no longer should.
    let hiddenDecidedSinceFetch = 0;
    let weightMissing = false;
    // A missing weight on a pick still IN PLAY makes Pts Left unknown too; one on
    // an already-won pick affects only Max (qodo #790, finding 1).
    let openWeightMissing = false;

    for (const game of weekGames) {
        const cell = cells.get(game.id);
        if (!cell) continue;
        if (cell.kind === 'HIDDEN') {
            hiddenCells++;
            const canPay = hiddenGameCanPay(game, pickMode);
            const open = !isGameDecided(game);
            if (canPay) hiddenLive++;
            if (open) hiddenOpen++;
            else if (canPay) hiddenDecidedLive++;
            if (!open && hiddenLeftOpenAtFetch?.has(game.id)) hiddenDecidedSinceFetch++;
            continue;
        }
        if (cell.kind !== 'PICK') continue;
        revealedPicks++;

        const weight = confidenceMode ? cell.confidence : 1;
        if (cell.result === 'W') {
            wins++;
            if (typeof weight === 'number') earned += weight; else weightMissing = true;
        } else if (cell.result === 'L') {
            losses++;
        } else if (cell.result === null && game.status !== 'CANCELLED' && (game.status !== 'FINAL' || !hasReportedScores(game))) {
            // Ungraded: not over yet, OR a FINAL the feed reported no scores for —
            // the scorer will grade that one when scores arrive, so it is still
            // winnable and must stay in Max (an upper bound).
            if (typeof weight === 'number') remaining += weight; else { weightMissing = true; openWeightMissing = true; }
        }
        // PUSH and VOID: neither earned nor winnable.
    }

    const tally = { wins, losses, earned };

    if (openWeightMissing) return { ...tally, max: null, maxUnknown: 'WEIGHT_MISSING', left: null, leftUnknown: 'WEIGHT_MISSING' };

    // The SERVER'S TOTAL for the hidden open picks (PLAN-PTS-LEFT-HIDDEN-TOTAL,
    // Kevin 2026-11-23: members saw "?" for every other player until the last
    // games kicked off). With it, Pts Left is exact: the revealed picks still in
    // play plus that total. Max adds it to what is already won — the most the
    // row can finish with, which is Kevin's definition of the column.
    //
    // A hidden pick on an already-DECIDED game (the reveal lagging the game) is
    // not in the server's total and may already be a win. Standard scoring can
    // bound it at 1 each; a confidence weight cannot be bounded, so Max is
    // unknown until the reveal catches up.
    //
    // ⚠️ PTS LEFT IS EXACT ONLY WHILE THE TOTAL IS AS FRESH AS THE STATUSES.
    // This comment said "Pts Left is still exact, because a decided game is not
    // points left" — true of the server's total at the instant it was computed,
    // and not of a total held for up to five minutes while `weekGames` moves on.
    // A hidden game that was open at fetch and is decided now (cancelled before
    // kickoff, or finished while a refresh failed) may still be inside
    // `hiddenLeft`. We cannot see whether this row picked it, so Pts Left is
    // somewhere between the total and the total minus those picks: unknown, and
    // printed as "?" until the next poll brings a total that excludes the game.
    // (Found by the Claude pre-review of #801; Kevin: "Fix 1 as well".)
    //
    // Max does NOT change: a pick on a just-decided game may be a WIN, so it
    // must stay in the upper bound either way.
    if (!isOwnRow && hiddenCells > 0 && typeof hiddenLeft === 'number') {
        const leftUpper = remaining + hiddenLeft;
        const mayOvercount = hiddenDecidedSinceFetch > 0 && hiddenLeft > 0;
        const leftPart: Pick<GridRowTally, 'left' | 'leftUnknown'> = mayOvercount
            ? { left: null, leftUnknown: 'TOTAL_STALE' }
            : { left: leftUpper };
        const left = leftUpper;
        if (weightMissing) return { ...tally, max: null, maxUnknown: 'WEIGHT_MISSING', ...leftPart };
        // How many hidden picks CAN sit on a decided game. Without the saved-pick
        // count, any of those games might hold one. With it, the picks not yet
        // accounted for bound it — and in standard scoring `hiddenLeft` IS the
        // number of hidden picks on open games, so those come off too. A row
        // whose count is fully explained by what is visible has none, and its
        // Max is exact (codex r4: it read one high, or "?", before).
        // In confidence mode `hiddenLeft` is a weight SUM, not a count — but every
        // weight is at least 1, so a positive total proves at least ONE hidden
        // pick is on an open game (codex r6).
        const hiddenOpenPicksAtLeast = confidenceMode ? (hiddenLeft > 0 ? 1 : 0) : hiddenLeft;
        const unexplained = setCount === undefined
            ? Infinity
            : Math.max(0, setCount - revealedPicks - hiddenOpenPicksAtLeast);
        const decidedMost = Math.min(hiddenDecidedLive, unexplained);
        if (decidedMost > 0) {
            if (confidenceMode) return { ...tally, max: null, maxUnknown: 'WEIGHTS_HIDDEN', ...leftPart };
            return { ...tally, max: earned + left + decidedMost, ...leftPart };
        }
        return { ...tally, max: earned + left, ...leftPart };
    }

    // The viewer's own row is sourced from their own entry: every cell is known.
    if (!isOwnRow && hiddenCells > 0) {
        // Not the viewer's row and some picks are unrevealed. Without the reveal
        // there is no count to price them with.
        if (revealMode === undefined || setCount === undefined) {
            // With no hidden game still OPEN, no hidden pick can be points left,
            // so Pts Left is exact from the revealed cells even without a count —
            // a finished week reads 0, not "?" (qodo #790, finding 2).
            const leftKnown = hiddenOpen === 0 ? { left: remaining } : { left: null, leftUnknown: 'COUNT_UNKNOWN' as const };
            return { ...tally, max: null, maxUnknown: 'COUNT_UNKNOWN', ...leftKnown };
        }
        // How many saved picks are still unrevealed. A stale count smaller than
        // what is already revealed clamps to 0.
        const unrevealed = Math.max(0, setCount - revealedPicks);
        // Confidence weights are unknowable until revealed — but only matter if
        // there IS an unrevealed pick: when the server's count equals the revealed
        // picks (including a player with none), nothing hidden can contribute and
        // the answer is exact.
        //
        // Only a pick on a hidden game that CAN still pay has a weight that
        // matters. A pick on a cancelled game grades VOID whatever its weight, so
        // when no hidden game can pay the answer is exact (qodo #2 on #721).
        // Points LEFT price only the unrevealed picks that sit on a game not yet
        // decided — and we cannot see which hidden game a pick is on. So bound
        // it: at most every unrevealed pick is on an open game (`openMost`), at
        // least the ones that cannot all fit on the decided hidden games
        // (`openLeast`). Only when the two agree is the number exact (codex r2:
        // one hidden pick across a just-finished game and an open one could be
        // 0 or 1, and printing 1 would be a guess).
        const openMost = Math.min(unrevealed, hiddenOpen);
        const openLeast = Math.max(0, unrevealed - (hiddenCells - hiddenOpen));
        const leftPart = confidenceMode
            // Confidence: an unrevealed pick that may sit on an open game has an
            // unknowable weight.
            ? (openMost > 0 ? { left: null, leftUnknown: 'WEIGHTS_HIDDEN' as const } : { left: remaining })
            : openLeast === openMost
                ? { left: remaining + openMost }
                : { left: null, leftUnknown: 'COUNT_UNKNOWN' as const };
        if (confidenceMode && Math.min(unrevealed, hiddenLive) > 0) return { ...tally, max: null, maxUnknown: 'WEIGHTS_HIDDEN', ...leftPart };
        // Standard scoring prices every unrevealed pick at exactly 1. They cannot
        // outnumber the hidden games that can still pay, which keeps Max an UPPER
        // bound even though we cannot see which hidden game a pick sits on.
        //
        // ⚠️ A hidden FINAL game stays counted ON PURPOSE (codex asked to drop
        // it): a reveal can lag the game document, and that hidden pick may
        // already be a win. Dropping it could put Max BELOW the player's real
        // score; counting it can only leave Max one point high until the reveal
        // lands, which an upper bound is allowed to be.
        if (weightMissing) return { ...tally, max: null, maxUnknown: 'WEIGHT_MISSING', ...leftPart };
        if (!confidenceMode) return { ...tally, max: earned + remaining + Math.min(unrevealed, hiddenLive), ...leftPart };
        return { ...tally, max: earned + remaining, ...leftPart };
    }

    // A won pick with no stored weight: Max is unknown, but it is on a decided
    // game, so Pts Left is not (qodo #790, finding 1).
    if (weightMissing) return { ...tally, max: null, maxUnknown: 'WEIGHT_MISSING', left: remaining };

    // Every cell on the row is known: what is left is exactly the revealed picks
    // on games not yet decided.
    return { ...tally, max: earned + remaining, left: remaining };
}

/** "3-1", or "—" while nothing on the row has been graded. */
export function formatWinLoss(t: Pick<GridRowTally, 'wins' | 'losses'>): string | null {
    return t.wins + t.losses === 0 ? null : `${t.wins}-${t.losses}`;
}

/** Why a Max cell reads "?", in the words the column's tooltip uses. */
export function maxUnknownTitle(reason: MaxUnknownReason | undefined): string {
    switch (reason) {
        case 'WEIGHTS_HIDDEN': return "Their confidence weights are not revealed yet, so the most they can score is not known";
        case 'WEIGHT_MISSING': return 'A pick on this row has no stored confidence weight';
        default: return 'Not known yet';
    }
}

/**
 * Points still winnable this week — the "Pts Left" column on the Current Picks
 * grid and the Week Results table (Kevin, 2026-11-19, from member feedback:
 * "if there are still 2 games to go and the player has chosen those two games
 * to have a confidence score of 5 and 6, they would have 11 total pts still
 * possible").
 *
 * From the SAME tally as Max (`tallyGridRow`, over the same reveal-gated cells),
 * but counting only games not yet decided: every revealed pick on such a game,
 * at its confidence weight (or 1 point), plus — in standard scoring — the
 * unrevealed picks that can sit on one, at 1 each. `null` (printed "?") when
 * that is unknowable: confidence weights not revealed yet, or the reveal has
 * not arrived. A finished week reads 0.
 */
export function pointsLeft(t: Pick<GridRowTally, 'left'>): number | null {
    return t.left;
}

/** Why a Pts Left cell reads "?", in the words the column's tooltip uses. */
export function pointsLeftUnknownTitle(reason: MaxUnknownReason | undefined): string {
    switch (reason) {
        case 'WEIGHTS_HIDDEN': return "Their confidence weights are not revealed yet, so the points they have left are not known";
        case 'WEIGHT_MISSING': return 'A pick on this row has no stored confidence weight';
        case 'TOTAL_STALE': return 'A game has finished or been cancelled since these points were last checked. This updates within a few minutes';
        default: return 'Not known yet';
    }
}
