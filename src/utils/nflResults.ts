/**
 * The arithmetic behind the league Results pages (Weekly Results, Season
 * Summary, Margin Summary, Margin Standings).
 *
 * DISPLAY ONLY. Every number here is derived from fields the member-readable
 * standings projection already publishes (`pools/{id}/standings/current`, built
 * by `buildStandingsRows`) — `weeklyPoints`, `weeklyResults` summaries,
 * `weeklyScores`, `seasonTotal`. Nothing in this file reads a pick, writes a
 * document, or re-scores anything: the scorer stays the only writer of every
 * value it consumes.
 *
 * It lives outside the component so the ranking and the max-points arithmetic
 * can be unit-tested without rendering — the parts that are easy to get subtly
 * wrong are the parts a table quietly renders anyway.
 */

/** The subset of a standings row these pages read. */
export interface ResultsRow {
    id: string;
    ownerUid?: string;
    userName?: string;
    unscored?: boolean;
    totalScore?: number;
    weeklyPoints?: Record<number, number>;
    weeklyResults?: Record<number, { correct?: number; total?: number; points?: number; mode?: string }>;
    weeklyScores?: Record<number, number>;
    seasonTotal?: number;
}

/**
 * The maximum points ONE player could have scored in a week — the denominator
 * the Weekly Results page's "Max" column reports.
 *
 * ⚠️ This is max POSSIBLE for the week, not max STILL ATTAINABLE — the
 * difference being that it never falls because a PLAYER's picks went wrong. It
 * is the same number in every row, so Points/Max reads as a score out of a
 * shared total rather than a target that shrinks under one player. Kevin's
 * reference screenshot does not disambiguate the two; named in the PR body for
 * him to veto.
 *
 * ⚠️ **It is NOT a constant for the week, and an earlier version of this comment
 * wrongly said it "does not change as games finish".** The caller passes the
 * count of games that can still be WON (`unwinnableGameIds`), so Max DOES fall
 * — once, per game — when a game is cancelled or ends in a push, because at
 * that moment the points behind it stopped existing for everyone at the same
 * time. That is the intended behaviour: the alternative is a denominator that
 * includes points the scorer can provably never award. What it never does is
 * move for one player and not another. (qodo on PR #427, catching a
 * doc/behaviour mismatch introduced by the codex r1 fix.)
 *
 * Confidence mode: weights on an N-game week are unique and drawn from
 * [17-N .. 16] (`validateConfidenceValues`), so the best case is every weight
 * correct — the sum of that whole range, N*(33-N)/2. For a 16-game week that is
 * 136, and for a 13-game week 130.
 *
 * Standard mode: ONE point per correct pick. Deliberately NOT
 * `settings.pointsPerPick` — that field exists in the create schema
 * (`shared/schemas/nfl.ts`) and **the scorer never reads it**:
 * `scorePickemEntry` hardcodes `points += 1` on a non-confidence pool. Honouring
 * it here would print a Max the scorer can provably never award.
 */
export function weeklyMaxPoints(gameCount: number, confidenceMode: boolean): number {
    if (gameCount <= 0) return 0;
    if (!confidenceMode) return gameCount;
    const n = Math.min(gameCount, 16); // weights are capped at 16 by the validator
    return (n * (33 - n)) / 2;
}

/** The fields of an NFL game this file needs. Structural, so tests need no fixture. */
export interface ScoreableGame {
    id: string;
    status?: string;
    scores?: { home?: number; away?: number } | null;
    spread?: { value?: number } | null;
}

/**
 * The games of a week that can NEVER earn a point, whoever picked them.
 *
 * Mirrors `gradePickemGames` (functions/src/nflScoringEngine.ts), which awards
 * points only on a `W`:
 *   - CANCELLED            → VOID
 *   - straight-up tie      → PUSH   (non-ATS pools)
 *   - exact spread cover   → PUSH   (ATS pools: homeScore + spread === awayScore)
 *
 * ⚠️ A game that has not concluded is NOT here. This answers "is this game
 * unwinnable", not "has it been graded" — an unplayed game is still worth its
 * full value, which is exactly what a max-POSSIBLE denominator needs.
 *
 * A FINAL the feed reported no scores for is likewise excluded: the scorer skips
 * it for now (NFL7-3) and it may yet be repaired, so calling it unwinnable would
 * shrink Max over a feed glitch.
 *
 * (codex: without this the Max column claimed a score a cancelled game made
 * impossible.)
 */
export function unwinnableGameIds(games: ScoreableGame[], isAts: boolean): Set<string> {
    const out = new Set<string>();
    for (const g of games) {
        if (g.status === 'CANCELLED') { out.add(g.id); continue; }
        if (g.status !== 'FINAL') continue;
        const home = g.scores?.home;
        const away = g.scores?.away;
        if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
        const spread = g.spread?.value;
        if (isAts && typeof spread === 'number') {
            if ((home as number) + spread === away) out.add(g.id);
        } else if (home === away) {
            out.add(g.id);
        }
    }
    return out;
}

/**
 * A week's value for one row: Pick'em points, or Margin net.
 *
 * `null` — never 0 — when the scorer has not published this week for this
 * player. A real 0 (every pick wrong, or a Margin net of exactly 0) is a played
 * week and must outrank a week nobody has scored yet. Same rule the standings
 * table applies; duplicated here rather than imported so the two files cannot
 * drift into disagreeing about what "no score" means... which is precisely why
 * `tests/nfl-results.test.ts` asserts the 0-vs-null distinction directly.
 */
export function weekValueFor(row: ResultsRow, week: number, isMargin: boolean): number | null {
    const v = isMargin ? row.weeklyScores?.[week] : row.weeklyPoints?.[week];
    return typeof v === 'number' ? v : null;
}

export interface RankedRow<T> {
    row: T;
    /** Competition rank — tied values SHARE a place (1, 1, 3). Null when unranked. */
    place: number | null;
    value: number | null;
}

/**
 * Orders rows by a week's value, descending, with COMPETITION ranking.
 *
 * Ties share a place (1, 1, 3) rather than being handed to the alphabet. That is
 * not cosmetic: a Pick'em weekly tie is settled by the tiebreaker PREDICTION,
 * which is judged by the scorer and reported in the recap — so numbering two
 * tied players 1 and 2 here would show a different weekly winner than the recap
 * does. The table's job is to say "these two are tied", not to break it.
 *
 * Unscored players and players with no value for this week sort last, by name,
 * with `place: null`. They have not lost; they have not been scored.
 */
export function rankByWeek<T extends ResultsRow>(rows: T[], week: number, isMargin: boolean): Array<RankedRow<T>> {
    const played: T[] = [];
    const rest: T[] = [];
    for (const row of rows) {
        if (!row.unscored && weekValueFor(row, week, isMargin) !== null) played.push(row);
        else rest.push(row);
    }
    played.sort((a, b) => {
        const d = (weekValueFor(b, week, isMargin) as number) - (weekValueFor(a, week, isMargin) as number);
        if (d !== 0) return d;
        return (a.userName || '').localeCompare(b.userName || '');
    });
    rest.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));

    const out: Array<RankedRow<T>> = [];
    let prevValue: number | null = null;
    let prevPlace = 1;
    played.forEach((row, i) => {
        const value = weekValueFor(row, week, isMargin) as number;
        const place = value === prevValue ? prevPlace : i + 1;
        out.push({ row, place, value });
        prevValue = value;
        prevPlace = place;
    });
    for (const row of rest) out.push({ row, place: null, value: null });
    return out;
}

/**
 * Orders rows by a season total, descending, with the same competition ranking.
 *
 * Pick'em reads `totalScore`, Margin reads `seasonTotal`. Unscored rows sort
 * last with a null place, for the same reason as `rankByWeek`.
 *
 * ⚠️ This is the DISPLAY order only. It deliberately does not reproduce the
 * Margin standings' five-level tiebreaker cascade (negative burden → positive
 * weeks → best week) that `NFLStandings` applies — the Margin Standings page
 * reports the total and the count of weeks played, and a tie in the total is
 * shown AS a tie. The season-prize tiebreak is a money question and is being
 * specified separately (PLAN-WEEKLY-PRIZES); this page must not pre-empt it by
 * inventing an order the rules page has never published.
 */
export function rankBySeason<T extends ResultsRow>(rows: T[], isMargin: boolean): Array<RankedRow<T>> {
    const valueOf = (r: T): number | null => {
        if (r.unscored) return null;
        const v = isMargin ? r.seasonTotal : r.totalScore;
        return typeof v === 'number' ? v : null;
    };
    const played = rows.filter(r => valueOf(r) !== null);
    const rest = rows.filter(r => valueOf(r) === null)
        .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
    played.sort((a, b) => {
        const d = (valueOf(b) as number) - (valueOf(a) as number);
        if (d !== 0) return d;
        return (a.userName || '').localeCompare(b.userName || '');
    });

    const out: Array<RankedRow<T>> = [];
    let prevValue: number | null = null;
    let prevPlace = 1;
    played.forEach((row, i) => {
        const value = valueOf(row) as number;
        const place = value === prevValue ? prevPlace : i + 1;
        out.push({ row, place, value });
        prevValue = value;
        prevPlace = place;
    });
    for (const row of rest) out.push({ row, place: null, value: null });
    return out;
}

/**
 * How many weeks a Margin player has actually been scored for — the "Weeks"
 * column. Counts published weeks, INCLUDING zero and negative ones: a week
 * scored at -14 is a week played, and dropping it would make a player who is
 * losing look like a player who is absent.
 */
export function scoredWeekCount(row: ResultsRow, weeks: number[], isMargin: boolean): number {
    return weeks.filter(w => weekValueFor(row, w, isMargin) !== null).length;
}
