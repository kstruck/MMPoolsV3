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
  if (game.status !== 'FINAL') return null;
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
  const net = scoreMarginWeek(pick, games) ?? 0;
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
  sharpUser: { uid: string; name: string; val: number } | null;
  closestTie: { uid: string; name: string; diff: number } | null;
  aliveCount: number;
  nowMs?: number;
}): WeeklyRecap {
  const { poolId, week, poolType, sharpUser, closestTie, aliveCount, nowMs = Date.now() } = params;
  const recap: WeeklyRecap = {
    id: `week_${week}`,
    poolId,
    week,
    createdAt: nowMs,
  };
  if (sharpUser) {
    recap.sharpOfWeek = { userId: sharpUser.uid, userName: sharpUser.name, score: sharpUser.val };
  }
  if (closestTie) {
    recap.closestTiebreaker = { userId: closestTie.uid, userName: closestTie.name, diff: closestTie.diff };
  }
  if (poolType === 'NFL_SURVIVOR') {
    recap.attritionCount = aliveCount;
  }
  return recap;
}
