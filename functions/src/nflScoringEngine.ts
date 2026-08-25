import {
  NFLGame,
  NFLPickemPool,
  NFLSurvivorPool,
  NFLMarginPool,
  NFLPickemEntry,
  SurvivorEntry,
  MarginEntry,
  WeeklyRecap
} from './nflPoolTypes';
import {
  countTeamUsesBefore,
  effectiveMaxTeamUses,
  effectiveTieCountsAs,
  UNLIMITED_TEAM_USES,
} from './shared/survivorReuse';
import type { WeeklyTiebreaker } from './shared/nflTiebreaker';
import { resolveTiebreakTargetIds } from './shared/nflTiebreaker';
import type { WeeklyPlace, WeeklyPrizeSnapshot } from './shared/weeklyPrizes';

// ============================================================================
// Feed-integrity predicates — what the scorer is allowed to treat as played
// ============================================================================

/**
 * Did the feed actually deliver BOTH scores for this game?
 *
 * `nflSchedule.ts:267-271` emits no `scores` object at all when the payload
 * carries a score for neither competitor, deliberately, so that "ESPN dropped
 * the field" stays distinguishable from "the team scored zero" — otherwise
 * `detectStatCorrections` would page a false 21-17 → 0-0 correction. Nothing
 * downstream repeated that distinction: every engine below reads
 * `game.scores?.home ?? 0`, which collapses the two cases back together and
 * grades a broken payload as a real 0-0.
 *
 * That is defect NFL7-3/NFL7-4 from the chaos drill. A 0-0 is a PUSH for every
 * Pick'em entry, a TIE for Survivor — and a tie is a strike by default
 * (`settings.tieCountsAs`, absent ⇒ today's rule), so at `maxStrikes: 0` a
 * dropped field ELIMINATES the member who picked correctly.
 *
 * A **one-sided** drop is deliberately NOT detectable here and is not claimed
 * to be: the importer emits both values when EITHER competitor has a score, so
 * the missing side is already written as a real `0`. Fixing that belongs in the
 * importer (PLAN-NFL7-CHAOS-FIXES §3.1, residual R4).
 */
export function hasReportedScores(
  g: { scores?: { home?: number; away?: number } | null },
): boolean {
  return Number.isFinite(g.scores?.home) && Number.isFinite(g.scores?.away);
}

/**
 * Was there nothing to play this week — every game of a non-empty slate
 * cancelled?
 *
 * `games.length > 0` is load-bearing, not defensive noise. An EMPTY slate means
 * "the scorer has no data", which is a reason to wait; an all-cancelled slate
 * means "there was nothing to play", which is a reason to excuse. Collapsing
 * those two is defect NFL7-5 wearing a different hat, so the empty case
 * deliberately answers `false` here and is handled by `isWeekComplete`.
 */
export function isVoidWeek(games: Pick<NFLGame, 'status'>[]): boolean {
  return games.length > 0 && games.every(g => g.status === 'CANCELLED');
}

// ============================================================================
// Pick'em Scoring Logic
// ============================================================================

/**
 * Does this pool's SCORING actually consume `game.spread`?
 *
 * Only an ATS pick'em pool does — see the `pickMode === 'ATS'` branch in
 * gradePickemGames below. Straight-up pick'em grades on the raw scores, and
 * NFL_SURVIVOR (pick a winner) / NFL_MARGIN (margin of victory) never read a
 * spread under any setting.
 *
 * This lives next to the branch it describes ON PURPOSE. `submitNFLPicks`'s
 * SPREADS_NOT_LOCKED precondition calls it, so the gate protects exactly the
 * pools the scorer needs spreads for. If someone later adds a spread-consuming
 * mode and updates the scorer, the gate follows automatically instead of
 * silently under- or over-blocking.
 */
export function poolUsesSpreads(pool: { type?: string; settings?: { pickMode?: string } } | null | undefined): boolean {
  return pool?.type === 'NFL_PICKEM' && pool?.settings?.pickMode === 'ATS';
}

// away/home abbreviations ride along so the profile pick history can render
// matchups without re-fetching every historical game doc (ADR 0005 Phase 5).
export type PickemGameGrade = { pick: string; result: 'W' | 'L' | 'PUSH' | 'VOID'; away: string; home: string };

/**
 * Grades every picked, concluded game of a week: W / L / PUSH / VOID per game
 * (ADR 0005 per-pick results). This is the single source of pick correctness —
 * scorePickemEntry derives points/correctCount from these grades, so the two
 * can never disagree. Semantics preserved from the original scorer:
 * - CANCELLED game with a pick   -> VOID (earns 0)
 * - ATS exact-spread cover       -> PUSH (earns 0)
 * - straight-up tie              -> PUSH (earns 0; previously "incorrect" — same score)
 * - ATS pool but game missing a spread -> graded straight-up (rare repair case;
 *   submit-time SPREADS_NOT_LOCKED gating makes this unusual)
 * - unpicked or not-yet-final games are absent from the result
 */
export function gradePickemGames(
  entry: NFLPickemEntry,
  games: NFLGame[],
  pool: NFLPickemPool
): Record<string, PickemGameGrade> {
  const grades: Record<string, PickemGameGrade> = {};

  for (const game of games) {
    if (game.status !== 'FINAL' && game.status !== 'CANCELLED') continue;
    // A FINAL the feed reported no scores for is not a played game (NFL7-3).
    // Not redundant with `isTerminalGame`: a PROVISIONAL pass hands the engines
    // the full slate, so without this the broken game is still graded mid-week.
    if (game.status === 'FINAL' && !hasReportedScores(game)) continue;

    const pick = entry.picks[game.id];
    if (!pick) continue; // Unpicked game

    if (game.status === 'CANCELLED') {
      grades[game.id] = { pick, result: 'VOID', away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation };
      continue;
    }

    const homeScore = game.scores?.home ?? 0;
    const awayScore = game.scores?.away ?? 0;

    if (pool.settings.pickMode === 'ATS' && typeof game.spread?.value === 'number') {
      // Against the spread. spread.value is relative to the home team
      // (negative = home favored), so the home side covers when
      // homeScore + spread.value beats awayScore.
      const adjustedHome = homeScore + game.spread.value;
      if (adjustedHome === awayScore) {
        grades[game.id] = { pick, result: 'PUSH', away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation };
      } else {
        const coveringTeam = adjustedHome > awayScore
          ? game.homeTeam.abbreviation
          : game.awayTeam.abbreviation;
        grades[game.id] = { pick, result: pick === coveringTeam ? 'W' : 'L', away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation };
      }
    } else if (homeScore === awayScore) {
      grades[game.id] = { pick, result: 'PUSH', away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation }; // straight-up tie
    } else {
      const winner = homeScore > awayScore
        ? game.homeTeam.abbreviation
        : game.awayTeam.abbreviation;
      grades[game.id] = { pick, result: pick === winner ? 'W' : 'L', away: game.awayTeam.abbreviation, home: game.homeTeam.abbreviation };
    }
  }

  return grades;
}

/**
 * Scores a Weekly Pick'em participant's entry for a single week or the season.
 * Derived from gradePickemGames — only 'W' grades earn points/correct, exactly
 * matching the original inline logic (PUSH and straight-up tie earned 0 there too).
 */
export function scorePickemEntry(
  entry: NFLPickemEntry,
  games: NFLGame[],
  pool: NFLPickemPool
): { points: number; correctCount: number } {
  let points = 0;
  let correctCount = 0;

  const confidenceMode = pool.settings.confidenceMode;
  const grades = gradePickemGames(entry, games, pool);

  for (const [gameId, grade] of Object.entries(grades)) {
    if (grade.result !== 'W') continue;
    correctCount++;
    if (confidenceMode) {
      points += entry.confidence?.[gameId] ?? 0;
    } else {
      points += 1; // Standard scoring
    }
  }

  return { points, correctCount };
}

/**
 * Validates confidence assignments for a given week.
 * N = number of games. Range must be uniquely [17-N..16].
 */
export function validateConfidenceValues(
  picks: Record<string, string>,
  confidence: Record<string, number>,
  gamesInWeek: NFLGame[]
): { valid: boolean; error?: string } {
  const N = gamesInWeek.length;
  const minVal = 17 - N;
  const maxVal = 16;

  const gameIds = new Set(gamesInWeek.map(g => g.id));
  const assignedValues = new Set<number>();

  for (const gameId of Object.keys(picks)) {
    if (!gameIds.has(gameId)) continue; // Not a game in this week

    const value = confidence[gameId];
    if (value === undefined || value === null) {
      return { valid: false, error: `INCOMPLETE_CONFIDENCE_SUBMISSION: Missing confidence value for game ${gameId}` };
    }

    if (value < minVal || value > maxVal) {
      return { valid: false, error: `OUT_OF_RANGE_CONFIDENCE: Value ${value} must be between ${minVal} and ${maxVal}` };
    }

    if (assignedValues.has(value)) {
      return { valid: false, error: `DUPLICATE_CONFIDENCE_VALUES: Value ${value} assigned more than once` };
    }

    assignedValues.add(value);
  }

  // Completeness check
  if (assignedValues.size !== N) {
    return { valid: false, error: `INCOMPLETE_CONFIDENCE_SUBMISSION: Must assign confidence to all ${N} games` };
  }

  return { valid: true };
}

// ============================================================================
// Survivor Scoring Logic
// ============================================================================

/**
 * Evaluates whether a Survivor entry survived the given week.
 * Returns { survived: boolean, strikeLogged: boolean }
 */
export function evaluateSurvivorWeek(
  entry: SurvivorEntry,
  week: number,
  gamesInWeek: NFLGame[],
  pool: NFLSurvivorPool
): { survived: boolean; strikeLogged: boolean } {
  // If player is already eliminated, they stay eliminated unless rebuy was processed
  if (entry.status === 'ELIMINATED') {
    return { survived: false, strikeLogged: false };
  }

  // Check if player was exempt this week
  if (entry.exemptWeeks?.includes(week)) {
    return { survived: true, strikeLogged: false };
  }

  const pick = entry.picks[week];

  // Auto-Strike for non-submission after games conclude — unless there was
  // nothing to submit. The penalty exists to punish not showing up FOR A GAME;
  // on a week where every game was cancelled there was no legal pick to make
  // (defect NFL7-1).
  //
  // Deliberately NOT routed through checkAutoSurviveExemption, which is the
  // machinery that looks like it should cover this: that helper is gated on
  // `autoSurviveExemptionEnabled`, a commissioner setting that can be turned
  // OFF, and a week nobody could play must not strike anybody however the pool
  // is configured. It also could not fire here anyway — it requires
  // `teamsPlaying.size > 0`, and a fully-cancelled slate contributes no teams,
  // which is precisely why this defect survived.
  if (!pick) {
    if (isVoidWeek(gamesInWeek)) return { survived: true, strikeLogged: false };
    return { survived: false, strikeLogged: true };
  }

  // Find the game containing the picked team
  const game = gamesInWeek.find(
    g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick
  );

  // If game isn't found or was cancelled, we err on the side of safety
  if (!game) {
    return { survived: true, strikeLogged: false };
  }

  if (game.status === 'CANCELLED') {
    return { survived: true, strikeLogged: false }; // Cancelled game = survive
  }

  if (game.status !== 'FINAL') {
    return { survived: true, strikeLogged: false }; // Still active, skip for now
  }

  // A FINAL with no reported scores would read 0-0, i.e. a TIE — and a tie is a
  // strike, so a field ESPN dropped would eliminate this member at
  // `maxStrikes: 0` (NFL7-4). Treat it as still active: waiting is always safe,
  // and the run after the scores arrive grades it properly.
  if (!hasReportedScores(game)) {
    return { survived: true, strikeLogged: false };
  }

  const homeScore = game.scores?.home ?? 0;
  const awayScore = game.scores?.away ?? 0;
  const isHome = game.homeTeam.abbreviation === pick;

  let teamWon = false;
  let teamLost = false;
  let teamTied = false;

  if (homeScore > awayScore) {
    if (isHome) teamWon = true; else teamLost = true;
  } else if (awayScore > homeScore) {
    if (!isHome) teamWon = true; else teamLost = true;
  } else {
    teamTied = true;
  }

  // Fold the tie into won/lost BEFORE the mode branch, so `pickLosersMode`
  // composes with the setting instead of needing a 2×2 matrix in each arm:
  // tie-as-WIN in losers mode means the picked team "won", which is a strike.
  //
  // ⚠️ ONLY 'WIN' folds. The plan's snippet also folded the default 'LOSS' into
  // `teamLost`, and that would have CHANGED today's behaviour on every existing
  // pick-losers pool with no setting written: a tie there would become a
  // survive, because "the team I picked to lose lost". Today a tie is a strike
  // in BOTH modes, and the locked decision is that defaults preserve current
  // behaviour exactly. So 'LOSS' means "today's rule" — it is the WIN option
  // that this setting exists to add ("ties count as a win for the picked team").
  if (teamTied && effectiveTieCountsAs(pool.settings) === 'WIN') {
    teamWon = true;
    teamTied = false;
  }

  const pickLosersMode = pool.settings.pickLosersMode;
  let strike = false;

  if (pickLosersMode) {
    // Inverted: pick a loser to survive. Winning/Tying = strike
    if (teamWon || teamTied) strike = true;
  } else {
    // Standard: pick a winner to survive. Losing/Tying = strike
    if (teamLost || teamTied) strike = true;
  }

  return {
    survived: !strike,
    strikeLogged: strike
  };
}

/**
 * Evaluates the new status of a Survivor entry based on current strikes.
 */
export function updateSurvivorStatus(
  entry: SurvivorEntry,
  pool: NFLSurvivorPool
): SurvivorEntry {
  const freshEntry = { ...entry };
  const maxStrikes = pool.settings.maxStrikes;

  if (freshEntry.strikesUsed >= maxStrikes + 1) {
    freshEntry.status = 'ELIMINATED';
  } else {
    freshEntry.status = 'ALIVE';
  }

  return freshEntry;
}

/**
 * Checks if a player qualifies for an auto-survive exemption (no eligible teams remaining).
 * Evaluates whether every NFL team playing this week was already used in a week
 * STRICTLY BEFORE the one being scored — a use that had not happened yet by that
 * week (a future-week reservation) does not count.
 */
export function checkAutoSurviveExemption(
  gamesInWeek: NFLGame[],
  autoSurviveEnabled: boolean,
  // Required, not opt-in: eligibility is picks-derived in EVERY mode
  // (PLAN-SURVIVOR-EXEMPTION-RESERVATIONS). `usedTeams` is submit-time and
  // carries no week information, so it cannot answer "had this member run out
  // of options by the time this week was graded" — a pick pre-submitted for a
  // LATER week was counting as a use and could excuse a missed pick.
  ctx: { maxTeamUses: number; picks: Record<number, string>; week: number },
): boolean {
  if (!autoSurviveEnabled) return false;

  // Find all team abbreviations playing this week
  const teamsPlaying = new Set<string>();
  for (const game of gamesInWeek) {
    if (game.status !== 'CANCELLED') {
      teamsPlaying.add(game.homeTeam.abbreviation);
      teamsPlaying.add(game.awayTeam.abbreviation);
    }
  }

  // Filter out teams the player could no longer pick BY THIS WEEK: uses are
  // counted over weeks strictly before it, one code path for every mode, so a
  // default pool (limit 1 via effectiveMaxTeamUses at the caller) and a
  // configured pool cannot diverge.
  //
  // `maxTeamUses: 0` (unlimited): every playing team stays eligible, so this
  // can never grant an exemption — surviving a week nobody could play is
  // `isVoidWeek`'s job, not this one, and an all-cancelled slate contributes
  // no teams so `teamsPlaying.size > 0` fails there anyway.
  const useCounts = countTeamUsesBefore(ctx.picks, ctx.week);
  const eligibleTeams = [...teamsPlaying].filter(t => {
    if (ctx.maxTeamUses === UNLIMITED_TEAM_USES) return true;
    return (useCounts[t] ?? 0) < ctx.maxTeamUses;
  });

  // If there are zero eligible teams playing this week, they get an exemption!
  return eligibleTeams.length === 0 && teamsPlaying.size > 0;
}

// ============================================================================
// Margin Scoring Logic
// ============================================================================

/**
 * Scores a Margin participant's entry for a single week.
 * Returns the score differential (can be negative).
 */
export function scoreMarginWeek(
  pick: string, // team picked e.g. "KC"
  gamesInWeek: NFLGame[]
): number | null {
  const game = gamesInWeek.find(
    g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick
  );

  if (!game || (game.status !== 'FINAL' && game.status !== 'CANCELLED')) {
    return null; // Not ready or unpicked
  }

  if (game.status === 'CANCELLED') {
    return 0; // Cancelled game
  }

  // Scoreless FINAL: not ready, same as an unplayed game (NFL7-3). `null` rather
  // than 0 matters — 0 is a real margin that would be written into weeklyScores
  // and the season total.
  if (!hasReportedScores(game)) {
    return null;
  }

  const homeScore = game.scores?.home ?? 0;
  const awayScore = game.scores?.away ?? 0;
  const isHome = game.homeTeam.abbreviation === pick;

  // Margin of victory (includes OT)
  return isHome ? (homeScore - awayScore) : (awayScore - homeScore);
}

/**
 * Ranks Margin pool entries using the strict 5-level tiebreaker cascade.
 * 1. Highest Season Total margin.
 * 2. Lowest Negative Burden (sum of absolute values of negative margins).
 * 3. Most Positive Weeks (score > 0).
 * 4. Highest Single-Week margin.
 * 5. Deterministic tie-break on the ENTRY id (PLAN-MULTI-ENTRY D4) — one
 *    player's two entries must not compare equal.
 */
export function sortMarginLeaderboard(entries: MarginEntry[]): MarginEntry[] {
  return [...entries].sort((a, b) => {
    // 1. Season Total
    if (b.seasonTotal !== a.seasonTotal) {
      return b.seasonTotal - a.seasonTotal;
    }

    // 2. Lowest Negative Burden (lower is better)
    if (a.negativeBurden !== b.negativeBurden) {
      return a.negativeBurden - b.negativeBurden;
    }

    // 3. Most Positive Weeks
    if (b.positiveWeeks !== a.positiveWeeks) {
      return b.positiveWeeks - a.positiveWeeks;
    }

    // 4. Highest Single Week
    if (b.bestWeek !== a.bestWeek) {
      return b.bestWeek - a.bestWeek;
    }

    // 5. Tie-breaker fallback: the ENTRY id, never the owner's uid
    //     (PLAN-MULTI-ENTRY D4 / sweeps S6).
    //
    // 🛑 `ownerUid` HERE WOULD COMPARE TWO ENTRIES OF ONE PLAYER AS EQUAL, and
    // `Array.prototype.sort` is only guaranteed stable, not deterministic across
    // inputs — so their ranks would fall out of whatever order Firestore
    // happened to return the documents in, and could swap between two scoring
    // passes over identical data. The entry id is unique per row by
    // construction (`entryIdFor`), so the cascade always terminates on a
    // distinct value.
    return String(a.id ?? a.ownerUid).localeCompare(String(b.id ?? b.ownerUid));
  });
}

// ============================================================================
// Rescore-safe helpers (PLAN-TEST-SUITE Phase 2 item 13)
// ============================================================================

/**
 * The tiebreaker TARGET: the number a member's prediction is measured against.
 *
 * `rule` comes from `settings.weeklyTiebreaker` via `effectiveWeeklyTiebreaker`,
 * and defaults to `MNF_COMBINED` — the historical behaviour, so a pool that has
 * never heard of this setting computes exactly what it always did
 * (PLAN-WEEKLY-TIEBREAKERS §4, no migration).
 *
 * WHICH game(s) are summed comes from ONE place — `resolveTiebreakTargetIds`
 * (`shared/nflTiebreaker.ts`), the same function the pick sheet used to tell
 * the member what they were predicting — OR, when the pool has a FROZEN target
 * for the week (`pool.frozenTiebreakTargets[week]`, set by the week's first
 * submission — PLAN-WEEKLY-PRIZES §2b), from that frozen list verbatim. The
 * frozen list wins: a flex move, a postponement, or a game gaining or losing
 * `isMonday` after members have submitted must not re-point their prediction.
 *
 *  - `MNF_COMBINED`   — every Monday game (legacy; no Monday game → no target).
 *  - `MNF_LAST_GAME`  — the LAST Monday game to kick off; Monday-less → the
 *    week's final game.
 *  - `MNF_FIRST_GAME` — the FIRST Monday game to kick off; Monday-less → the
 *    week's final game.
 *  - `NONE`           — the pool does not use a tiebreaker.
 *
 * `null` means "no target", and every caller must already handle it (no game
 * qualifies, an EMPTY frozen list, or the games are not final yet). A frozen game that is CANCELLED
 * — or no longer in the schedule at all — also yields `null`: there is no
 * combined score to compare against, so the tie is shared (D3), the same
 * outcome as "nobody answered".
 *
 * ⚠️ Returns null until the games it reads are FINAL — a mid-Monday scoring run
 * must not freeze a partial total into the tiebreak; a rescore recomputes it.
 * `MNF_LAST_GAME` waits only on the ONE game it names, so on a doubleheader it
 * can resolve while the earlier game is still being corrected. That is the
 * rule's point, not a hole in it.
 */
export function computeMNFTiebreakerTotal(
  games: NFLGame[],
  rule: WeeklyTiebreaker = 'MNF_COMBINED',
  frozenTargetIds?: ReadonlyArray<string>,
): number | null {
  if (rule === 'NONE') return null;
  // A frozen list — INCLUDING an empty one, which means "this week has no
  // target" — wins over the live schedule; only `undefined` (nothing frozen)
  // falls through to the rule.
  const targetIds = frozenTargetIds !== undefined
    ? frozenTargetIds
    : resolveTiebreakTargetIds(games, rule);
  if (targetIds.length === 0) return null;
  const counted = targetIds.map(id => games.find(g => String(g.id) === id));
  if (!counted.every((g): g is NFLGame => Boolean(g) && g!.status === 'FINAL')) return null;
  return counted.reduce(
    (sum, g) => sum + (g.scores?.home ?? 0) + (g.scores?.away ?? 0),
    0,
  );
}

/** One entry's claim on the week, as the winner computation sees it. */
export interface WeeklyWinnerCandidate {
  /** The entry DOCUMENT id (`{uid}` for entry #1, `e{n}:{uid}` for extras) — PLAN-WEEKLY-PRIZES §9 A1. */
  entryId: string;
  userId: string;
  userName: string;
  /** The entry's own name when named (multi-entry K5); rows display `entryName ?? userName`. */
  entryName?: string;
  points: number;
  /**
   * `|prediction − target|`, or `undefined` when this member made no
   * prediction. ⚠️ Undefined is NOT zero and must never be coerced to it — see
   * `computeWeeklyWinners`.
   */
  tiebreakDiff?: number;
}

export interface WeeklyWinner {
  /** Entry doc id (PLAN-WEEKLY-PRIZES §9 A1). Absent on recaps written before it. */
  entryId?: string;
  userId: string;
  userName: string;
  points: number;
  tiebreakDiff?: number;
}

/**
 * Who won the week (PLAN-WEEKLY-TIEBREAKERS §8c).
 *
 * The cascade, and every step of it is load-bearing:
 *
 *  1. Highest `points`. Nobody below the top score is a candidate for anything.
 *  2. Tied at the top → lowest `tiebreakDiff`.
 *  3. Still tied → **shared win**: every remaining member is returned.
 *
 * ⚠️ **A SHARED WIN IS THE NORMAL OUTCOME OF AN UNBREAKABLE TIE, NOT AN ERROR.**
 * This function replaces `sharpUser`'s `if (points > best)`, which handed every
 * tied week to whichever entry Firestore happened to iterate first — i.e. to a
 * document id. On a `payoutMode: WEEKLY` pool that named a winner of a tied
 * week arbitrarily. Returning the whole tied set is the fix; the caller renders
 * "(shared)".
 *
 * ⚠️ **A MISSING PREDICTION IS ABSENCE, NOT ZERO.** Members with no
 * `tiebreakDiff` are dropped **only when at least one tied leader has one** —
 * they lose a tiebreak somebody else can win, but two non-answerers tie with
 * each other and share. The scorer's older `?? 0` read
 * (`nflPools.ts`, `closestTiebreaker`) must NOT be copied here: a fake diff of
 * `target − 0` merely usually loses, and on a low-scoring Monday it would let
 * somebody who never answered WIN the tiebreak. (codex P1, plan round 11.)
 *
 * Returns `[]` for no candidates, which the caller writes as "no field" rather
 * than as "nobody won" — an empty array in the recap would be a claim.
 */
export function computeWeeklyWinners(candidates: WeeklyWinnerCandidate[]): WeeklyWinner[] {
  if (candidates.length === 0) return [];

  const best = Math.max(...candidates.map(c => c.points));
  const leaders = candidates.filter(c => c.points === best);
  if (leaders.length === 1) return leaders.map(toWinner);

  const withDiff = leaders.filter(c => typeof c.tiebreakDiff === 'number');
  // Nobody among the leaders answered: the tie is unbreakable, so they share.
  // Deliberately NOT the same as "no target" — the caller passes no diffs in
  // that case either, and both land here for the same honest reason.
  if (withDiff.length === 0) return leaders.map(toWinner);

  const closest = Math.min(...withDiff.map(c => c.tiebreakDiff as number));
  return withDiff.filter(c => c.tiebreakDiff === closest).map(toWinner);
}

function toWinner(c: WeeklyWinnerCandidate): WeeklyWinner {
  // Rebuilt field by field rather than spread: `tiebreakDiff: undefined` is a
  // LITERAL undefined to Firestore's `set()`, which throws on it (the same trap
  // buildWeeklyRecap documents). Omitting the key is not the same as setting it.
  const w: WeeklyWinner = { entryId: c.entryId, userId: c.userId, userName: c.userName, points: c.points };
  if (typeof c.tiebreakDiff === 'number') w.tiebreakDiff = c.tiebreakDiff;
  return w;
}

/**
 * Result of recomputing one survivor entry for one week. `update` is the exact
 * Firestore patch; `strikeIsNew` gates the SURVIVOR_AUTO_STRIKE audit event so
 * a rescore never duplicates it; `alive` feeds the recap attrition count.
 */
export interface SurvivorWeekUpdate {
  update: {
    status: 'ALIVE' | 'ELIMINATED';
    strikeWeeks: number[];
    strikesUsed: number;
    exemptWeeks: number[];
    eliminatedWeek: number | null;
  };
  strikeIsNew: boolean;
  alive: boolean;
  skipped: boolean;
}

/**
 * Idempotent per-(entry, week) survivor recompute. Set semantics: this week's
 * prior contribution (strike, exemption, this-week elimination) is stripped and
 * recomputed from scratch, so scoring the same week twice yields identical
 * state — the rescore path the dual-MNF gate depends on.
 *
 * Contract:
 * - Entries eliminated in an EARLIER week are skipped (skipped: true).
 * - An entry eliminated by a previous run of THIS week is re-evaluated and can
 *   be revived by corrected game data.
 * - Weeks at/before lastRebuyWeek are skipped: the rebuy already absorbed those
 *   strikes; recomputing them would re-strike a player who bought back in.
 * - strikesUsed is recomputed as strikeWeeks.length. Legacy entries with
 *   strikesUsed but no strikeWeeks ledger lose unattributed strikes on their
 *   first rescore — acceptable pre-first-live-season; the ledger is
 *   authoritative from now on.
 */
export function computeSurvivorWeekUpdate(
  entry: SurvivorEntry,
  week: number,
  games: NFLGame[],
  pool: NFLSurvivorPool,
): SurvivorWeekUpdate {
  const noUpdate = {
    status: entry.status,
    strikeWeeks: entry.strikeWeeks ?? [],
    strikesUsed: entry.strikesUsed,
    exemptWeeks: entry.exemptWeeks ?? [],
    eliminatedWeek: entry.eliminatedWeek ?? null,
  };

  if (entry.status === 'ELIMINATED' && (entry.eliminatedWeek ?? 0) < week) {
    return { update: noUpdate, strikeIsNew: false, alive: false, skipped: true };
  }
  if (entry.lastRebuyWeek != null && week <= entry.lastRebuyWeek) {
    return { update: noUpdate, strikeIsNew: false, alive: entry.status === 'ALIVE', skipped: true };
  }

  // Strip this week's prior contribution before recomputing.
  const priorExemptWeeks = (entry.exemptWeeks ?? []).filter(w => w !== week);
  const priorStrikeWeeks = (entry.strikeWeeks ?? []).filter(w => w !== week);
  const strikeAlreadyRecorded = (entry.strikeWeeks ?? []).includes(week);

  const cleaned: SurvivorEntry = {
    ...entry,
    status: 'ALIVE',
    exemptWeeks: priorExemptWeeks,
    strikeWeeks: priorStrikeWeeks,
    strikesUsed: priorStrikeWeeks.length,
  };

  const autoSurviveEnabled = pool.settings.autoSurviveExemptionEnabled ?? true;
  const maxTeamUses = effectiveMaxTeamUses(pool.settings);
  if (checkAutoSurviveExemption(games, autoSurviveEnabled, {
    maxTeamUses, picks: cleaned.picks, week,
  })) {
    return {
      update: {
        status: 'ALIVE',
        strikeWeeks: priorStrikeWeeks,
        strikesUsed: priorStrikeWeeks.length,
        exemptWeeks: [...priorExemptWeeks, week],
        eliminatedWeek: null,
      },
      strikeIsNew: false,
      alive: true,
      skipped: false,
    };
  }

  const { strikeLogged } = evaluateSurvivorWeek(cleaned, week, games, pool);
  const strikeWeeks = strikeLogged ? [...priorStrikeWeeks, week] : priorStrikeWeeks;
  const scored = updateSurvivorStatus(
    { ...cleaned, strikeWeeks, strikesUsed: strikeWeeks.length },
    pool,
  );
  const eliminated = scored.status === 'ELIMINATED';

  return {
    update: {
      status: scored.status,
      strikeWeeks,
      strikesUsed: strikeWeeks.length,
      exemptWeeks: priorExemptWeeks,
      eliminatedWeek: eliminated ? week : null,
    },
    strikeIsNew: strikeLogged && !strikeAlreadyRecorded,
    alive: !eliminated,
    skipped: false,
  };
}

/**
 * Per-pick game record for a scored Survivor week (ADR 0005). Returns null when
 * there is nothing game-shaped to record (no pick — the week-level
 * {survived, strike} still captures the auto-strike — or the picked team has no
 * game this week). Cancelled games grade VOID (survive, matches evaluateSurvivorWeek).
 */
export function gradeSurvivorWeekGame(
  entry: SurvivorEntry,
  week: number,
  games: NFLGame[],
  struckThisWeek: boolean,
): { gameId: string; pick: string; result: 'SURVIVED' | 'STRUCK' | 'VOID' } | null {
  const pick = entry.picks[week];
  if (!pick) return null;
  const game = games.find(
    g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick
  );
  if (!game) return null;
  if (game.status === 'CANCELLED') return { gameId: game.id, pick, result: 'VOID' };
  // Scoreless FINAL: nothing to record yet (NFL7-3). Without this the per-pick
  // record would read SURVIVED off a payload that reported no scores, which is a
  // published claim about a game nobody played.
  if (game.status !== 'FINAL' || !hasReportedScores(game)) return null;
  return { gameId: game.id, pick, result: struckThisWeek ? 'STRUCK' : 'SURVIVED' };
}

/**
 * Per-pick game record for a scored Margin week (ADR 0005). Mirrors
 * scoreMarginWeek's game resolution: null when unpicked/not concluded;
 * cancelled games record net 0.
 */
export function gradeMarginWeekGame(
  pick: string | undefined,
  games: NFLGame[],
): { gameId: string; pick: string; net: number } | null {
  if (!pick) return null;
  const game = games.find(
    g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick
  );
  if (!game || (game.status !== 'FINAL' && game.status !== 'CANCELLED')) return null;
  // Mirrors scoreMarginWeek exactly, which is the contract this function's
  // docstring claims: a null from it means "not ready", and `?? 0` would turn a
  // scoreless FINAL into a recorded net of 0 (NFL7-3).
  const net = scoreMarginWeek(pick, games);
  if (net === null) return null;
  return { gameId: game.id, pick, net };
}

// ============================================================================
// Standings projection (ADR 0005 / PLAN-PLAYER-PROFILES Phase 2)
// ============================================================================

/**
 * One member-readable standings row. Built by ALLOWLIST, never by stripping —
 * a new entry field is leak-safe by default. Deliberate exclusions:
 * - picks / confidence / weeklyTiebreakers: raw pick data (the whole point)
 * - usedTeams: updated at SUBMIT time, so it reveals the current week's
 *   un-scored pick
 * - weeklyResults per-game maps: scored (reveal-safe) but bulky; the profile
 *   projection carries per-pick history, standings only need the summaries
 */
export interface StandingsRow {
  id: string;
  ownerUid: string;
  userName: string;
  entryName?: string;
  paidStatus?: 'PAID' | 'UNPAID';
  // Pickem
  totalScore?: number;
  weeklyPoints?: Record<number, number>;
  weeklyResults?: Record<number, { correct?: number; total?: number; points?: number; mode?: string; survived?: boolean; strike?: boolean; net?: number }>;
  // Survivor
  status?: 'ALIVE' | 'ELIMINATED';
  strikesUsed?: number;
  strikeWeeks?: number[];
  rebuysUsed?: number;
  eliminatedWeek?: number | null;
  exemptWeeks?: number[];
  // Margin
  weeklyScores?: Record<number, number>;
  seasonTotal?: number;
  negativeBurden?: number;
  positiveWeeks?: number;
  bestWeek?: number;
  rank?: number;
}

/** Drops per-game records from a weeklyResults map, keeping the summaries. */
function sanitizeWeeklyResults(
  wr: Record<number, Record<string, unknown>> | undefined,
): StandingsRow['weeklyResults'] | undefined {
  if (!wr) return undefined;
  const out: NonNullable<StandingsRow['weeklyResults']> = {};
  for (const [week, val] of Object.entries(wr)) {
    const { games: _games, game: _game, ...summary } = val as Record<string, unknown>;
    out[Number(week)] = summary as NonNullable<StandingsRow['weeklyResults']>[number];
  }
  return out;
}

/** Builds the member-readable rows for pools/{id}/standings/current. Pure. */
export function buildStandingsRows(
  poolType: string,
  entries: Array<NFLPickemEntry | SurvivorEntry | MarginEntry>,
): StandingsRow[] {
  return entries.map((e) => {
    const row: StandingsRow = {
      id: e.id,
      ownerUid: e.ownerUid,
      userName: e.userName,
    };
    if (e.entryName !== undefined) row.entryName = e.entryName;
    if (e.paidStatus !== undefined) row.paidStatus = e.paidStatus;

    if (poolType === 'NFL_PICKEM') {
      const p = e as NFLPickemEntry;
      row.totalScore = p.totalScore ?? 0;
      if (p.weeklyPoints !== undefined) row.weeklyPoints = p.weeklyPoints;
      const wr = sanitizeWeeklyResults(p.weeklyResults as never);
      if (wr !== undefined) row.weeklyResults = wr;
    } else if (poolType === 'NFL_SURVIVOR') {
      const s = e as SurvivorEntry;
      row.status = s.status;
      row.strikesUsed = s.strikesUsed ?? 0;
      if (s.strikeWeeks !== undefined) row.strikeWeeks = s.strikeWeeks;
      if (s.rebuysUsed !== undefined) row.rebuysUsed = s.rebuysUsed;
      row.eliminatedWeek = s.eliminatedWeek ?? null;
      if (s.exemptWeeks !== undefined) row.exemptWeeks = s.exemptWeeks;
      const wr = sanitizeWeeklyResults(s.weeklyResults as never);
      if (wr !== undefined) row.weeklyResults = wr;
    } else if (poolType === 'NFL_MARGIN') {
      const m = e as MarginEntry;
      if (m.weeklyScores !== undefined) row.weeklyScores = m.weeklyScores;
      row.seasonTotal = m.seasonTotal ?? 0;
      row.negativeBurden = m.negativeBurden ?? 0;
      row.positiveWeeks = m.positiveWeeks ?? 0;
      row.bestWeek = m.bestWeek ?? 0;
      const rank = (m as unknown as { rank?: number }).rank;
      if (rank !== undefined) row.rank = rank;
      const wr = sanitizeWeeklyResults(m.weeklyResults as never);
      if (wr !== undefined) row.weeklyResults = wr;
    }
    return row;
  });
}

/**
 * Builds a WeeklyRecap doc with only DEFINED optional fields. Firestore's
 * default `set()` throws on any literal `undefined` field value (no
 * ignoreUndefinedProperties on this project) — the previous inline object
 * literal set sharpOfWeek/closestTiebreaker/attritionCount to `undefined`
 * whenever there was no sharp user, no MNF tiebreaker, or a non-Survivor pool,
 * which crashed EVERY scoreNFLWeek call that hit any of those (normal) cases.
 * Found via the NFL Phase-2 simulator's first real invocation of the callable.
 */
export function buildWeeklyRecap(params: {
  poolId: string;
  week: number;
  poolType: string;
  /**
   * PLAN-MULTI-ENTRY D4 — `entryId` is the ROW the callout names and `name` is
   * already `entryName ?? userName`; `uid` stays the owner. Optional so the sim
   * harness and older callers keep compiling.
   */
  sharpUser: { uid: string; entryId?: string; name: string; val: number } | null;
  closestTie: { uid: string; entryId?: string; name: string; diff: number } | null;
  aliveCount: number;
  /**
   * The tie-broken winner set (PLAN-WEEKLY-TIEBREAKERS §8b). Omitted from the
   * doc when empty — an empty ARRAY in the recap would assert "nobody won",
   * where absence honestly says "not computed" (an older recap, a pool type
   * with no weekly winner, or a week nobody entered).
   */
  weeklyWinners?: WeeklyWinner[];
  /**
   * The Weekly Winners List (PLAN-WEEKLY-PRIZES §3, §9 A1–A2): EVERY scored
   * entry, competition-ranked, `prize` on paid ranks of a priced week. Omitted
   * when not computed (older recap, void week, Survivor).
   */
  weeklyPlaces?: WeeklyPlace[];
  /**
   * The frozen pot/places/entryCount/weeks the prizes were computed from
   * (§3b-i), or `null` = published UNPRICED (SEASON / no pot at first
   * publication) — an explicit sentinel so a later edit cannot retroactively
   * price an already-published week. Absent = not published by this feature.
   */
  weeklyPrize?: WeeklyPrizeSnapshot | null;
  /** Publication failed CLOSED (§9 A5) — the code, never a crash. */
  weeklyPlacesError?: string;
  nowMs?: number;
}): WeeklyRecap {
  const { poolId, week, poolType, sharpUser, closestTie, aliveCount, weeklyWinners, weeklyPlaces, weeklyPrize, weeklyPlacesError, nowMs = Date.now() } = params;
  const recap: WeeklyRecap = {
    id: `week_${week}`,
    poolId,
    week,
    createdAt: nowMs,
  };
  if (sharpUser) {
    recap.sharpOfWeek = {
      userId: sharpUser.uid,
      ...(sharpUser.entryId ? { entryId: sharpUser.entryId } : {}),
      userName: sharpUser.name,
      score: sharpUser.val,
    };
  }
  if (closestTie) {
    recap.closestTiebreaker = {
      userId: closestTie.uid,
      ...(closestTie.entryId ? { entryId: closestTie.entryId } : {}),
      userName: closestTie.name,
      diff: closestTie.diff,
    };
  }
  if (weeklyWinners && weeklyWinners.length > 0) {
    recap.weeklyWinners = weeklyWinners;
  }
  if (weeklyPlaces && weeklyPlaces.length > 0) {
    recap.weeklyPlaces = weeklyPlaces;
  }
  if (weeklyPrize !== undefined) {
    recap.weeklyPrize = weeklyPrize;
  }
  if (weeklyPlacesError) {
    recap.weeklyPlacesError = weeklyPlacesError;
  }
  if (poolType === 'NFL_SURVIVOR') {
    recap.attritionCount = aliveCount;
  }
  return recap;
}
