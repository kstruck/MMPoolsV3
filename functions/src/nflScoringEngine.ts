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

// ============================================================================
// Pick'em Scoring Logic
// ============================================================================

/**
 * Scores a Weekly Pick'em participant's entry for a single week or the season.
 */
export function scorePickemEntry(
  entry: NFLPickemEntry,
  games: NFLGame[],
  pool: NFLPickemPool
): { points: number; correctCount: number } {
  let points = 0;
  let correctCount = 0;

  const confidenceMode = pool.settings.confidenceMode;

  for (const game of games) {
    if (game.status !== 'FINAL' && game.status !== 'CANCELLED') continue;

    const pick = entry.picks[game.id];
    if (!pick) continue; // Unpicked game

    // Voids cancelled games (earn 0)
    if (game.status === 'CANCELLED') continue;

    // Check if the picked team won
    const homeScore = game.scores?.home ?? 0;
    const awayScore = game.scores?.away ?? 0;

    let isCorrect = false;
    if (homeScore > awayScore && pick === game.homeTeam.abbreviation) {
      isCorrect = true;
    } else if (awayScore > homeScore && pick === game.awayTeam.abbreviation) {
      isCorrect = true;
    } else if (homeScore === awayScore) {
      // Ties usually count as 0 or ties in standard pools. We treat tie as incorrect for straight pick'em unless specified.
      isCorrect = false;
    }

    if (isCorrect) {
      correctCount++;
      if (confidenceMode) {
        const confidenceVal = entry.confidence?.[game.id] ?? 0;
        points += confidenceVal;
      } else {
        points += 1; // Standard scoring
      }
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

  // Auto-Strike for non-submission after games conclude
  if (!pick) {
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
 * Evaluates whether all NFL teams playing this week are either already used or on bye.
 */
export function checkAutoSurviveExemption(
  usedTeams: string[],
  gamesInWeek: NFLGame[],
  autoSurviveEnabled: boolean
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

  // Filter out teams that the player has already picked in past weeks
  const eligibleTeams = [...teamsPlaying].filter(t => !usedTeams.includes(t));

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
 * 5. Deterministic tie-break based on userId comparison.
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

    // 5. Tie-breaker fallback (deterministic UUID sorting)
    return a.ownerUid.localeCompare(b.ownerUid);
  });
}

// ============================================================================
// Rescore-safe helpers (PLAN-TEST-SUITE Phase 2 item 13)
// ============================================================================

/**
 * MNF tiebreaker target: the COMBINED score of ALL Monday games in the week
 * (docs/NFL_POOLS_README.md), not just the first one found. Returns null until
 * EVERY Monday game is FINAL — a mid-Monday SUPER_ADMIN scoring run must not
 * freeze a partial total into the tiebreak; a rescore recomputes it.
 */
export function computeMNFTiebreakerTotal(games: NFLGame[]): number | null {
  const mondayGames = games.filter(g => g.isMonday);
  if (mondayGames.length === 0) return null;
  if (!mondayGames.every(g => g.status === 'FINAL')) return null;
  return mondayGames.reduce(
    (sum, g) => sum + (g.scores?.home ?? 0) + (g.scores?.away ?? 0),
    0,
  );
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
  if (checkAutoSurviveExemption(cleaned.usedTeams, games, autoSurviveEnabled)) {
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
