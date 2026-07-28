import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { writeAuditEvent } from './audit';
import { NFLGame } from './types';
import { detectStatCorrections } from './lib/feedSnapshot';
import { captureFeedSnapshot, pruneExpiredSnapshots, readSnapshotGate, reportStatCorrections } from './feedSnapshotStore';
import { opsCourierAuthToken } from './lib/opsAlertDispatcher';
import { withHeartbeat, configReadFailedVerdict } from './lib/heartbeat';
import { isTerminalGame } from './lib/weekCompletion';
import { RESCORE_QUEUE, rescoreEventDoc } from './lib/rescoreQueue';
import type { Firestore } from 'firebase-admin/firestore';
import { validated } from "./lib/validated";
import { importNFLScheduleSchema } from "./schemas/nflSchedule";

// Safe integer parsing helper
const safeInt = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const parsed = parseInt(val);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Did the feed actually deliver a score for this competitor?
 *
 * safeInt() maps a missing score to 0, which makes "ESPN dropped the field" and
 * "the team scored zero" indistinguishable downstream. That matters for A5:
 * detectStatCorrections must not page a false 21-17 → 0-0 "correction" when the
 * feed simply returned a partial payload. Used only to decide whether to emit a
 * scores object at all; the values themselves still go through safeInt.
 */
const hasScore = (val: any): boolean =>
  val !== null && val !== undefined && val !== '' && !isNaN(parseInt(val));

/**
 * Map an ESPN status to our NFLGame status. ESPN `type.state` is only pre/in/post,
 * so canceled/postponed/suspended must be read from `type.name` (e.g. STATUS_CANCELED).
 * A canceled game must NOT map to FINAL (it would score 0-0); a postponed/suspended game
 * stays SCHEDULED (won't score) and self-heals when ESPN reschedules it. Pure + testable.
 */
export function mapEspnGameStatus(
  state: string | undefined,
  name: string | undefined,
): 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'CANCELLED' {
  const n = (name || '').toUpperCase();
  if (n.includes('CANCEL') || n.includes('FORFEIT')) return 'CANCELLED';
  if (n.includes('POSTPONED') || n.includes('DELAYED') || n.includes('SUSPENDED')) return 'SCHEDULED';
  if (state === 'post') return 'FINAL';
  if (state === 'in') return 'IN_PROGRESS';
  return 'SCHEDULED';
}

/**
 * Resolve the scoreboard URL for a week. Prefers an explicit date range taken
 * from ESPN's own calendar, because the naive week/season/seasontype form
 * silently falls back to the PRIOR season during the off-season. Extracted from
 * fetchNFLWeekSchedule so both fetch variants resolve identically.
 */
async function resolveScoreboardUrl(
  week: number,
  season: string,
  seasonType: 1 | 2 | 3,
): Promise<string> {
    let url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&season=${season}&seasontype=${seasonType}`;

    try {
      // 1. Fetch calendar to extract precise date range for the specified week of 2026 season.
      // This prevents ESPN's scoreboard API from falling back to 2025 games during the off-season.
      const calendarUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?season=${season}`;
      const calendarResp = await fetch(calendarUrl);
      if (calendarResp.ok) {
        const calendarData = await calendarResp.json();
        const calendar = calendarData.leagues?.[0]?.calendar || [];
        const segment = calendar.find((c: any) => String(c.value) === String(seasonType));
        if (segment && segment.entries) {
          // Map week index securely to segment entries
          const entry = segment.entries[week - 1];
          if (entry && entry.startDate && entry.endDate) {
            const start = new Date(entry.startDate);
            const end = new Date(entry.endDate);
            
            const formatDate = (d: Date) => {
              const y = d.getUTCFullYear();
              const m = String(d.getUTCMonth() + 1).padStart(2, '0');
              const day = String(d.getUTCDate()).padStart(2, '0');
              return `${y}${m}${day}`;
            };
            
            const dateQuery = `${formatDate(start)}-${formatDate(end)}`;
            url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateQuery}`;
            console.log(`[nflSchedule] Resolved Week ${week} (Type: ${seasonType}) to dates: ${dateQuery}`);
          }
        }
      }
    } catch (calErr) {
      console.warn("[nflSchedule] Failed to resolve dates via calendar, falling back to standard week scoreboard URL:", calErr);
    }

    return url;
}

/**
 * Fetch a weekly NFL schedule from the official ESPN Scoreboard API.
 * seasonType: 1 = Preseason, 2 = Regular Season, 3 = Postseason
 */
export async function fetchNFLWeekSchedule(
  week: number,
  season: string,
  seasonType: 1 | 2 | 3
): Promise<NFLGame[]> {
  try {
    const url = await resolveScoreboardUrl(week, season, seasonType);

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`ESPN Scoreboard API returned HTTP status ${resp.status}`);
    }

    const data = await resp.json();
    return parseScoreboardResponse(data, week, season, seasonType);
  } catch (err) {
    console.error(`[nflSchedule] fetchNFLWeekSchedule failed for week ${week}, season ${season}:`, err);
    return [];
  }
}

/**
 * Fetch a week AND hand back the raw ESPN payload alongside the mapped games,
 * so the caller can snapshot exactly what the feed said before it overwrites
 * nfl_games (PLAN-NFL-PRESEASON-PILOT A5). `raw` is null when the fetch failed.
 */
export async function fetchNFLWeekScheduleWithRaw(
  week: number,
  season: string,
  seasonType: 1 | 2 | 3,
): Promise<{ games: NFLGame[]; raw: unknown | null }> {
  try {
    const url = await resolveScoreboardUrl(week, season, seasonType);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`ESPN Scoreboard API returned HTTP status ${resp.status}`);
    const data = await resp.json();
    return { games: parseScoreboardResponse(data, week, season, seasonType), raw: data };
  } catch (err) {
    console.error(`[nflSchedule] fetchNFLWeekScheduleWithRaw failed for week ${week}, season ${season}:`, err);
    return { games: [], raw: null };
  }
}

/**
 * Map an ESPN scoreboard payload to NFLGame[]. Pure — extracted from
 * fetchNFLWeekSchedule so the mapping (odds sign convention, MNF detection,
 * status mapping) is unit-testable without a network call, and so the raw
 * payload is reachable for snapshotting.
 */
/**
 * Does this ESPN event actually belong to the season+type we asked for?
 *
 * FAIL-OPEN on a MISSING field, fail-closed on a MISMATCH. If ESPN stops
 * sending `season` we degrade to the old (permissive) behavior rather than
 * silently importing zero games and looking like an outage; but when the field
 * IS present and disagrees, we trust it over our own arguments.
 */
export function eventMatchesSeason(
  event: { season?: { year?: number | string; type?: number | string } } | undefined | null,
  season: string,
  seasonType: 1 | 2 | 3,
): boolean {
  const s = event?.season;
  if (!s) return true; // shape changed — don't drop the whole slate

  if (s.type !== undefined && s.type !== null && Number(s.type) !== Number(seasonType)) return false;
  if (s.year !== undefined && s.year !== null && String(s.year) !== String(season)) return false;
  return true;
}

export function parseScoreboardResponse(
  data: any,
  week: number,
  season: string,
  seasonType: 1 | 2 | 3,
): NFLGame[] {
    if (!data?.events || !Array.isArray(data.events)) {
      return [];
    }

    const games: NFLGame[] = [];

    for (const event of data.events) {
      // Only keep events that actually BELONG to the requested season+type.
      //
      // Everything below stamps season/seasonType/week from this function's
      // ARGUMENTS, so anything the response happens to include gets relabelled.
      // Two ways that bites:
      //  1. ESPN's calendar segments span season boundaries — "Preseason Week 3"
      //     runs to 2026-09-09, so a date-range fetch for it also returns the
      //     REGULAR-SEASON opener. It was then stored as seasonType 1 week 4,
      //     which holds every preseason pool open in isSeasonComplete until that
      //     September game goes FINAL. Hit for real on 2026-07-19
      //     (espn_401872656, NE @ SEA).
      //  2. The naive week/season URL silently falls back to the PRIOR season
      //     during the off-season — the calendar guard in resolveScoreboardUrl
      //     is best-effort and swallows its own failures.
      // Checking the event's own season is the backstop for both.
      if (!eventMatchesSeason(event, season, seasonType)) continue;

      const competition = event.competitions?.[0];
      if (!competition) continue;

      const competitors = competition.competitors || [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home');
      const awayComp = competitors.find((c: any) => c.homeAway === 'away');

      if (!homeComp || !awayComp) continue;

      const gameId = `espn_${event.id}`;
      const startTime = new Date(competition.date || event.date).getTime();
      const status = mapEspnGameStatus(event.status?.type?.state, event.status?.type?.name);

      // Check if this is a Monday Night Football game (MNF) - usually Monday in US, which starts after UTC Monday night or Tuesday early
      const startDateObj = new Date(startTime);
      const isMonday = startDateObj.getDay() === 1; // 1 = Monday

      let spreadValue = 0;
      let spreadFound = false;
      if (competition.odds && competition.odds[0]) {
        const odds = competition.odds[0];
        if (odds.details && odds.details !== 'EVEN') {
          // e.g. "BAL -3.5" or "KC -10"
          const parts = odds.details.split(' ');
          if (parts.length >= 2) {
            const favAbbr = parts[0];
            const spreadPoints = parseFloat(parts[1]);
            if (!isNaN(spreadPoints)) {
              spreadFound = true;
              // If favored team is HOME, spread relative to home is negative (e.g. -3.5).
              // If favored team is AWAY, spread relative to home is positive (e.g. +3.5).
              if (homeComp.team?.abbreviation === favAbbr) {
                spreadValue = spreadPoints; // e.g. -3.5
              } else {
                spreadValue = -spreadPoints; // e.g. +3.5
              }
            }
          }
        } else if (odds.details === 'EVEN') {
          spreadFound = true;
          spreadValue = 0;
        }
      }

      games.push({
        id: gameId,
        espnGameId: event.id,
        week: week,
        season: season,
        seasonType: seasonType,
        homeTeam: {
          id: homeComp.team?.id || '',
          name: homeComp.team?.name || homeComp.team?.displayName || 'Home Team',
          abbreviation: homeComp.team?.abbreviation || 'HOME',
          logoUrl: homeComp.team?.logo || ''
        },
        awayTeam: {
          id: awayComp.team?.id || '',
          name: awayComp.team?.name || awayComp.team?.displayName || 'Away Team',
          abbreviation: awayComp.team?.abbreviation || 'AWAY',
          logoUrl: awayComp.team?.logo || ''
        },
        // Only emit scores when the feed actually delivered at least one. A
        // non-SCHEDULED game with NO scores in the payload is a partial
        // response, and reporting it as 0-0 would look like a stat correction
        // wiping a finished game (A5).
        scores: status !== 'SCHEDULED' && (hasScore(homeComp.score) || hasScore(awayComp.score)) ? {
          home: safeInt(homeComp.score),
          away: safeInt(awayComp.score)
        } : undefined,
        startTime: startTime,
        status: status,
        clock: event.status?.displayClock || '0:00',
        period: safeInt(event.status?.period),
        isMonday: isMonday,
        ...(spreadFound ? { spread: { value: spreadValue, locked: false } } : {})
      });
    }

    return games;
}

/**
 * Bulk import a full season (or specific week) of NFL games into Firestore.
 */
export async function importNFLSeason(
  season: string,
  seasonType: 1 | 2 | 3,
  weeks: number[] = Array.from({ length: 18 }, (_, i) => i + 1)
): Promise<{ success: boolean; importedCount: number }> {
  const db = admin.firestore();
  let importedCount = 0;

  console.log(`[nflSchedule] Starting import of season ${season} (type: ${seasonType}) for weeks: ${weeks.join(', ')}`);

  // Auto-cleanup any existing/legacy games for this season and seasonType to prevent orphan/mismatched data
  try {
    const existingSnap = await db.collection('nfl_games')
      .where('season', '==', season)
      .where('seasonType', '==', seasonType)
      .get();
    
    if (!existingSnap.empty) {
      console.log(`[nflSchedule] Found ${existingSnap.size} existing matching games for season ${season} (type ${seasonType}). Cleaning up...`);
      const deleteBatch = db.batch();
      existingSnap.docs.forEach(doc => {
        deleteBatch.delete(doc.ref);
      });
      await deleteBatch.commit();
      console.log(`[nflSchedule] Cleaned up ${existingSnap.size} legacy matching games successfully.`);
    }
  } catch (cleanupErr) {
    console.warn("[nflSchedule] Failed to clean up legacy matching games in DB:", cleanupErr);
  }

  for (const week of weeks) {
    const games = await fetchNFLWeekSchedule(week, season, seasonType);
    if (games.length === 0) {
      console.log(`[nflSchedule] No games fetched for Week ${week}. Skipping.`);
      continue;
    }

    const batch = db.batch();
    for (const game of games) {
      const cleanedGame = JSON.parse(JSON.stringify(game));
      const gameRef = db.collection('nfl_games').doc(cleanedGame.id);
      batch.set(gameRef, cleanedGame, { merge: true });
      importedCount++;
    }
    await batch.commit();
    console.log(`[nflSchedule] Week ${week} imported successfully with ${games.length} games.`);
  }

  await writeAuditEvent({
    poolId: 'system',
    type: 'POOL_STATUS_CHANGED', // Closest system type
    message: `Imported ${importedCount} NFL games for ${season} (type: ${seasonType})`,
    severity: 'INFO',
    actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Scheduler' }
  });

  return { success: true, importedCount };
}

/**
 * Scheduled sync function that fetches active NFL schedules and scores,
 * updates game statuses in Firestore, and updates kickoff times (schedule flexing).
 */
// `secrets` is required for the ops-alert SMS path used by the stat-correction
// page (A5) — dispatchOpsAlert reads COURIER_AUTH_TOKEN at call time.
export const syncNFLScoresJob = onSchedule(
  { schedule: '*/5 * * * *', secrets: [opsCourierAuthToken] },
  withHeartbeat('syncNFLScoresJob', async () => {
    const db = admin.firestore();
    const now = Date.now();
    return scoreSyncHeartbeat(await syncScoresWindow(db, now, HOT_WINDOW_LOOKBACK_MS, { prune: true }));
  }),
);

/** The 5-minute job's lower bound: games that started within the last 24h. */
export const HOT_WINDOW_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Default lower bound for the deep sweep — a full week back. */
export const DEFAULT_DEEP_SWEEP_DAYS = 7;

export interface ScoreSyncResult {
  /** Distinct season/seasonType/week slates fetched from ESPN. */
  slates: number;
  /** Games written back to nfl_games (0 when dryRun). */
  gamesWritten: number;
  /** Stat corrections detected across all slates. */
  corrections: number;
  /**
   * Slates that produced NO games and were therefore not reconciled at all.
   *
   * A slate only exists here because `nfl_games` already holds games in it, so
   * ESPN returning none for it is always an anomaly, and there are two ways to
   * get one — neither of which throws:
   *   - the fetch failed: `fetchNFLWeekScheduleWithRaw` catches its own errors
   *     and returns `{ games: [], raw: null }`, so a total ESPN outage resolves
   *     normally;
   *   - the fetch SUCCEEDED but every event was filtered out by the PR #219
   *     season guard — the shape you get when the calendar lookup falls back to
   *     an endpoint serving a different season.
   * Counted together because the consequence is identical (the slate was
   * skipped) and neither is distinguishable from a quiet night otherwise.
   */
  slatesNotReconciled: number;
  /**
   * Slates whose snapshot could not be stored. `captureFeedSnapshot` never
   * throws by design (a lost snapshot must not break score sync) — which is
   * EXACTLY how the A5 missing-index failure hid for days. Counted so the run
   * that swallowed it is still reported as degraded.
   */
  snapshotFailures: number;
  /**
   * Slates where a detected stat correction could not be REPORTED. Both sinks
   * behind reportStatCorrections swallow their own failures, so a correction
   * could be found and then dropped — leaving pools finalized on stale scores
   * with nobody told. That is the most expensive silent failure in this file.
   */
  correctionReportFailures: number;
}

/**
 * Fetch ESPN and reconcile every nfl_games doc whose kickoff falls in
 * `[now - lookbackMs, now + 2h]`.
 *
 * The window is a parameter rather than a constant because a stat correction can
 * land days after kickoff — the NFL routinely restates a stat on the Tuesday or
 * Wednesday following a Sunday game. The 5-minute job deliberately looks back
 * only 24h, since widening it would multiply ESPN fetches by the number of extra
 * slates on EVERY run; the deep sweep pays that cost once a day instead.
 *
 * `dryRun` suppresses only the nfl_games write. Correction detection and
 * reporting still run, because the alarm is the point of the sweep and running
 * it before arming the writes is how the sweep gets validated.
 *
 * `fetchSlate` is injectable ONLY so the write path — in particular the
 * locked-spread preservation below — can be tested without a network call.
 * Production always uses the default.
 */
export async function syncScoresWindow(
  db: Firestore,
  now: number,
  lookbackMs: number,
  opts: {
    dryRun?: boolean;
    prune?: boolean;
    fetchSlate?: typeof fetchNFLWeekScheduleWithRaw;
  } = {},
): Promise<ScoreSyncResult> {
  const dryRun = opts.dryRun === true;
  const fetchSlate = opts.fetchSlate ?? fetchNFLWeekScheduleWithRaw;
  const empty: ScoreSyncResult = {
    slates: 0, gamesWritten: 0, corrections: 0, slatesNotReconciled: 0, snapshotFailures: 0,
    correctionReportFailures: 0,
  };

  // Only games in the active window: started within the last `lookbackMs` (still live
  // or recently final) through the next 2h. The lower bound stops the job from
  // dragging the whole past season into every run (a single-field range is allowed).
  const activeGamesSnap = await db.collection('nfl_games')
    .where('startTime', '>=', now - lookbackMs)
    .where('startTime', '<=', now + 2 * 60 * 60 * 1000)
    .get();

  if (activeGamesSnap.empty) {
    return empty;
  }

  // Group active games by season and week to batch API requests
  const weeksToSync = new Map<string, { week: number; season: string; seasonType: 1 | 2 | 3 }>();
  activeGamesSnap.forEach(doc => {
    const data = doc.data() as NFLGame;
    // Only fetch if game status is not FINAL, or if it was finalised inside the window
    if (data.status !== 'FINAL' || (data.status === 'FINAL' && data.startTime > now - lookbackMs)) {
      const key = `${data.season}_${data.seasonType}_${data.week}`;
      if (!weeksToSync.has(key)) {
        weeksToSync.set(key, { week: data.week, season: data.season, seasonType: data.seasonType });
      }
    }
  });

  if (weeksToSync.size === 0) {
    return empty;
  }

  console.log(`[nflSchedule] Syncing scores for ${weeksToSync.size} week slots (lookback ${Math.round(lookbackMs / 3_600_000)}h${dryRun ? ', DRY RUN' : ''})`);

  // A5: snapshot the raw feed before it overwrites nfl_games, and notice when a
  // game that was already FINAL changes. Gate read once per run, not per slate.
  const snapshotGate = await readSnapshotGate(db);
  let gamesWritten = 0;
  let correctionCount = 0;
  let slatesNotReconciled = 0;
  let snapshotFailures = 0;
  let correctionReportFailures = 0;

  for (const [_, slot] of weeksToSync) {
    const { games: freshGames, raw } = await fetchSlate(slot.week, slot.season, slot.seasonType);
    // Zero games for a slate we KNOW has games is the whole signal — see
    // slatesNotReconciled. Deliberately does not care WHY (fetch threw and was
    // caught, or the season guard filtered everything): the run skipped work it
    // was supposed to do, and before this counter existed that looked identical
    // to a clean run.
    if (freshGames.length === 0) { slatesNotReconciled++; continue; }

    const slateKey = { season: slot.season, seasonType: slot.seasonType, week: slot.week };
    // Prior state for this slate, as the finalizer would have seen it. Scoped to
    // the window we queried — which is why the deep sweep's wider lookback is what
    // makes a late correction detectable at all.
    const prevGames = activeGamesSnap.docs
      .map(d => d.data() as NFLGame)
      .filter(g => g.season === slot.season && Number(g.seasonType) === Number(slot.seasonType) && Number(g.week) === Number(slot.week));
    const corrections = detectStatCorrections(prevGames, freshGames);

    if (snapshotGate.enabled && raw !== null) {
      const outcome = await captureFeedSnapshot(db, slateKey, raw, corrections, freshGames.length);
      if (outcome === "skipped") snapshotFailures++;
    }
    // Corrections are reported whether or not snapshots are on — the page is the
    // point; the snapshot is only the evidence attached to it.
    if (!(await reportStatCorrections(db, slateKey, corrections))) correctionReportFailures++;
    correctionCount += corrections.length;

    if (dryRun) {
      console.log(`[nflSchedule] DRY RUN — would write ${freshGames.length} game(s) for ${slateKey.season}/${slateKey.seasonType}/wk${slateKey.week}; ${corrections.length} correction(s) detected.`);
      continue;
    }

    // Existing docs for the WHOLE slate, not just the ones inside the time
    // window. ESPN returns the entire week, and every one of those games gets
    // written below — but a game later in the week can already carry a spread
    // locked by lockNFLSpreadsJob, and the parser emits `locked: false`. Looking
    // up only the in-window docs meant those locks were silently reset on every
    // run, re-opening a line members had already picked against.
    //
    // Fetched by document ID via getAll() rather than a (season, seasonType,
    // week) query: a direct ID lookup needs no composite index and therefore has
    // no way to die silently, which is the failure mode that took out A5 and the
    // finalize sweep.
    const existingById = new Map<string, NFLGame>();
    for (const doc of await db.getAll(...freshGames.map(g => db.collection('nfl_games').doc(g.id)))) {
      if (doc.exists) existingById.set(doc.id, doc.data() as NFLGame);
    }

    // Any status change where EITHER side is terminal, measured against the WHOLE
    // slate's stored state rather than the in-window subset (§5b). Four shapes,
    // and only the first was obvious:
    //  - nonterminal → FINAL: a postponed game finalizing >24h after its
    //    scheduled kickoff, which the live tier's window can no longer see;
    //  - nonterminal → CANCELLED: still carries a void, deferred penalties and
    //    the week's completion;
    //  - CANCELLED ⇄ FINAL (codex r3): both are terminal, so a "became terminal"
    //    test never fires, and `detectStatCorrections` ignores it too because it
    //    only compares games that were ALREADY FINAL. A pool finalized on the
    //    void would keep it forever;
    //  - CANCELLED → SCHEDULED / IN_PROGRESS (codex r11): a reinstated game. The
    //    pool already graded it VOID, and nothing else would revisit that until
    //    the game next goes terminal — which may never happen.
    // A game with no stored doc counts as arriving from SCHEDULED, so one that
    // arrives already terminal is a transition. A nonterminal → nonterminal move
    // (SCHEDULED → IN_PROGRESS) is NOT: it changes no grade, and it is every live
    // game on every 5-minute run.
    const firstTerminal = freshGames.some(g => {
      const prev = existingById.get(g.id)?.status ?? 'SCHEDULED';
      if (prev === g.status) return false;
      return isTerminalGame(g) || isTerminalGame({ status: prev });
    });

    const batch = db.batch();
    for (const freshGame of freshGames) {
      const gameRef = db.collection('nfl_games').doc(freshGame.id);
      const existingData = existingById.get(freshGame.id);

      if (existingData) {
        // Check for schedule flexing (startTime changed)
        if (existingData.startTime !== freshGame.startTime) {
          console.log(`[nflSchedule] Flex scheduling detected for game ${freshGame.id}: ${new Date(existingData.startTime).toLocaleTimeString()} -> ${new Date(freshGame.startTime).toLocaleTimeString()}`);
          
          await writeAuditEvent({
            poolId: 'system',
            type: 'SCHEDULE_FLEX',
            message: `NFL Flex Schedule: Game ${freshGame.awayTeam.abbreviation} @ ${freshGame.homeTeam.abbreviation} moved from ${new Date(existingData.startTime).toISOString()} to ${new Date(freshGame.startTime).toISOString()}`,
            severity: 'INFO',
            actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Score Sync' },
            payload: { gameId: freshGame.id, oldTime: existingData.startTime, newTime: freshGame.startTime }
          });
        }
        if (existingData.spread?.locked && freshGame.spread) {
          // Retain the locked spread value and state
          freshGame.spread = {
            value: existingData.spread.value,
            locked: true
          };
        }
      }

      const cleanedGame = JSON.parse(JSON.stringify(freshGame));
      batch.set(gameRef, cleanedGame, { merge: true });
    }

    // The rescore handoff rides IN the same batch as the games it describes
    // (codex r2). Enqueueing after the commit has a losing interleaving: the
    // terminal/corrected game is persisted, the queue write fails, and no later
    // sync sees a transition again — so once the slate leaves the hot window its
    // standings stay stale with nothing to fix them. In the batch, a failed
    // enqueue simply fails the whole slate write and the next 5-minute run
    // reconciles it from the same prior state.
    //
    // Write path only: a dry run changes no game, so there is nothing to
    // reconcile. Both reasons can fire for one slate — they are distinct events
    // and the drain unions them, which is what lets a Survivor pool be scored for
    // a delayed final on a slate that also carries a correction.
    for (const reason of ['correction', 'terminal'] as const) {
      if (reason === 'correction' ? corrections.length === 0 : !firstTerminal) continue;
      batch.set(db.collection(RESCORE_QUEUE).doc(), rescoreEventDoc({ ...slateKey, reason, enqueuedAt: now }));
    }

    await batch.commit();
    gamesWritten += freshGames.length;
  }

  // Pruning belongs to the 5-minute job only: it is retention maintenance, not
  // part of a window sync, and running it from both jobs would double the work.
  if (opts.prune && snapshotGate.enabled) {
    const pruned = await pruneExpiredSnapshots(db, now, snapshotGate.retentionDays);
    if (pruned > 0) console.log(`[feedSnapshot] pruned ${pruned} snapshot(s) past ${snapshotGate.retentionDays}d retention.`);
  }

  return {
    slates: weeksToSync.size, gamesWritten, corrections: correctionCount,
    slatesNotReconciled, snapshotFailures, correctionReportFailures,
  };
}

/**
 * Turn a sync result into a heartbeat verdict.
 *
 * WHY THIS IS NOT "did syncScoresWindow throw". Both of its dependencies
 * deliberately swallow their own failures — the ESPN fetcher returns an empty
 * slate, the snapshot writer returns "skipped" — so the job resolves cleanly
 * through the exact outages the heartbeat exists to surface. Deriving health
 * from the throw alone would have recorded `ok: true` all the way through the
 * A5 snapshot failure. Pure, so the mapping is unit-tested rather than
 * discovered during the next outage.
 */
export function scoreSyncHeartbeat(r: ScoreSyncResult): {
  ok: boolean; error?: string; detail: Record<string, unknown>;
} {
  const detail = {
    slates: r.slates, gamesWritten: r.gamesWritten, corrections: r.corrections,
    slatesNotReconciled: r.slatesNotReconciled, snapshotFailures: r.snapshotFailures,
    correctionReportFailures: r.correctionReportFailures,
  };
  const degraded: string[] = [];
  if (r.slatesNotReconciled > 0) degraded.push(`${r.slatesNotReconciled} slate(s) returned no games`);
  if (r.snapshotFailures > 0) degraded.push(`${r.snapshotFailures} snapshot write(s) failed`);
  if (r.correctionReportFailures > 0) degraded.push(`${r.correctionReportFailures} stat-correction report(s) undelivered`);
  return degraded.length > 0
    ? { ok: false, error: degraded.join('; '), detail }
    : { ok: true, detail };
}

/**
 * Deep score sweep — catch stat corrections that land after the 5-minute job has
 * stopped looking.
 *
 * `syncNFLScoresJob` only re-reads games that kicked off in the last 24h, so a
 * restated stat arriving on the Tuesday after a Sunday game is invisible to it,
 * and A5's correction detection never fires. This job re-reads a wider window
 * once a day. Cost is one ESPN fetch per slate per day, versus multiplying every
 * 5-minute run.
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * system/config.nflDeepSweep.enabled === true required (default OFF, fail-safe);
 * dry-run by default (nflDeepSweep.dryRun !== false). Note that dry-run still
 * DETECTS and REPORTS corrections — it only suppresses the nfl_games write — so
 * the alarm can be observed for a week before the writes are armed.
 */
export const nflDeepScoreSweepJob = onSchedule(
  { schedule: '30 11 * * *', timeZone: 'America/New_York', secrets: [opsCourierAuthToken] },
  withHeartbeat('nflDeepScoreSweepJob', async () => {
    const db = admin.firestore();

    let gate = { enabled: false, dryRun: true };
    let lookbackDays = DEFAULT_DEEP_SWEEP_DAYS;
    let configError: unknown = null;
    try {
      const cfg = (await db.doc('system/config').get()).data()?.nflDeepSweep as
        | { enabled?: boolean; dryRun?: boolean; lookbackDays?: number }
        | undefined;
      gate = readJobGate(cfg);
      lookbackDays = clampLookbackDays(cfg?.lookbackDays);
    } catch (e) {
      configError = e ?? new Error('unknown config read error');
    }
    if (configError) return configReadFailedVerdict('nflDeepScoreSweepJob', configError);
    if (!gate.enabled) {
      console.log('[nflDeepScoreSweepJob] disabled (system/config.nflDeepSweep.enabled !== true); nothing to do.');
      return { detail: { enabled: false } };
    }

    const result = await syncScoresWindow(
      db,
      Date.now(),
      lookbackDays * 24 * 60 * 60 * 1000,
      { dryRun: gate.dryRun },
    );
    console.log(`[nflDeepScoreSweepJob] ${lookbackDays}d sweep: ${result.slates} slate(s), ${result.corrections} correction(s), ${result.gamesWritten} game(s) written.`);
    return scoreSyncHeartbeat(result);
  }),
);

/**
 * Keep the configured lookback inside [1, 30] days. An unbounded value read from
 * config would let one bad edit re-fetch the entire season every night; a value
 * below a day would be narrower than the job it exists to widen.
 */
export function clampLookbackDays(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_DEEP_SWEEP_DAYS;
  return Math.min(30, Math.max(1, n));
}

import { onCall, HttpsError } from 'firebase-functions/v2/https';

/**
 * Read the {enabled, dryRun} gate for a scheduled job out of system/config.
 * Fail-safe: a missing/garbage config means disabled, and dry-run unless the
 * flag is explicitly `false`. Mirrors autoClosePools.ts:31-42 / nflFinalize.ts:235-243.
 * Pure so the enabled/dryRun matrix is unit-testable.
 */
export function readJobGate(
  cfg: { enabled?: boolean; dryRun?: boolean } | undefined | null,
): { enabled: boolean; dryRun: boolean } {
  return { enabled: cfg?.enabled === true, dryRun: cfg?.dryRun !== false };
}

/** Safety cap on writes per run, mirrors autoClosePools / nflFinalizeSweepJob. */
const MAX_SPREAD_LOCKS_PER_RUN = 200;

/** A spread is lockable when it exists, carries a value, and isn't locked yet. */
export function shouldLockSpread(game: Pick<NFLGame, 'spread'> | undefined): boolean {
  const spread = game?.spread;
  return !!spread && spread.locked !== true && spread.value !== undefined && spread.value !== null;
}

/**
 * Scheduled job to lock NFL spreads every Tuesday at 9:00 AM EST.
 * Scans upcoming games, and if spread is available, marks it as locked.
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * system/config.nflSpreadLock.enabled === true required (default OFF, fail-safe);
 * dry-run by default (nflSpreadLock.dryRun !== false) — logs which games it WOULD
 * lock, writing nothing, until explicitly flipped.
 */
export interface SpreadLockResult {
  /** Games whose spread was actually written to locked:true (0 when dryRun). */
  locked: number;
  /** Games that WOULD be locked — equals `locked` on a live run. */
  wouldLock: number;
  /** Eligible games left for the next run because of the per-run cap. */
  overflow: number;
}

/**
 * Lock every lockable spread in the next 7 days. Extracted from the scheduled
 * job so the WRITE PATH is testable without a scheduler.
 *
 * Worth stating why this extraction happened: before it, only the pure helpers
 * (`shouldLockSpread`, `readJobGate`) had tests, and every emulator fixture
 * seeded spreads as ALREADY `locked: true`. The unlocked→locked transition, the
 * per-run cap, and the dry-run-writes-nothing guarantee had never been executed
 * by any test — on a job about to be armed for preseason, on the same field
 * whose preservation bug shipped undetected until PR #235.
 *
 * The caller owns the gate; this function assumes it has been checked.
 */
export async function lockSpreadsOnce(
  db: Firestore,
  now: number,
  opts: { dryRun: boolean },
): Promise<SpreadLockResult> {
  const empty: SpreadLockResult = { locked: 0, wouldLock: 0, overflow: 0 };

  // Games starting in the next 7 days that are not finalized.
  const upcomingSnap = await db.collection('nfl_games')
    .where('startTime', '>', now)
    .where('startTime', '<=', now + 7 * 24 * 60 * 60 * 1000)
    .get();

  if (upcomingSnap.empty) return empty;

  const eligible = upcomingSnap.docs.filter(doc => shouldLockSpread(doc.data() as NFLGame));
  // Per-run cap, same convention as autoClosePools / nflFinalizeSweepJob. A real
  // week is ~16 games, so this never binds in practice — it exists so a bad
  // import can't push one batch past Firestore's 500-write limit and fail the
  // WHOLE commit, which would leave every spread unlocked and block the week
  // behind SPREADS_NOT_LOCKED. Overflow is logged, and the next run picks it up.
  const targets = eligible.slice(0, MAX_SPREAD_LOCKS_PER_RUN);
  const overflow = eligible.length - targets.length;

  if (opts.dryRun) {
    console.log(
      `[lockNFLSpreadsJob] DRY-RUN: would lock ${targets.length} spread(s)${overflow > 0 ? ` (${overflow} deferred past the ${MAX_SPREAD_LOCKS_PER_RUN} cap)` : ''}: ${targets.slice(0, 20).map(d => d.id).join(', ')}`,
    );
    return { locked: 0, wouldLock: targets.length, overflow };
  }

  if (targets.length === 0) return empty;

  const batch = db.batch();
  for (const doc of targets) batch.update(doc.ref, { 'spread.locked': true });
  await batch.commit();
  console.log(
    `[lockNFLSpreadsJob] Locked spreads for ${targets.length} upcoming games.${overflow > 0 ? ` WARNING: ${overflow} eligible game(s) exceeded the ${MAX_SPREAD_LOCKS_PER_RUN} per-run cap and were NOT locked.` : ''}`,
  );
  return { locked: targets.length, wouldLock: targets.length, overflow };
}

export const lockNFLSpreadsJob = onSchedule({
  schedule: '0 9 * * 2', // 9:00 AM every Tuesday
  timeZone: 'America/New_York'
}, withHeartbeat('lockNFLSpreadsJob', async () => {
  const db = admin.firestore();

  let gate = { enabled: false, dryRun: true };
  let configError: unknown = null;
  try {
    const cfg = (await db.doc('system/config').get()).data()?.nflSpreadLock as
      | { enabled?: boolean; dryRun?: boolean }
      | undefined;
    gate = readJobGate(cfg);
  } catch (e) {
    configError = e ?? new Error('unknown config read error');
  }
  if (configError) return configReadFailedVerdict('lockNFLSpreadsJob', configError);
  if (!gate.enabled) {
    console.log('[lockNFLSpreadsJob] disabled (system/config.nflSpreadLock.enabled !== true); nothing to do.');
    return { detail: { enabled: false } };
  }

  const result = await lockSpreadsOnce(db, Date.now(), { dryRun: gate.dryRun });
  // Overflow means eligible games were NOT locked this run. The job runs WEEKLY,
  // so "the next run picks it up" is up to seven days later — past kickoff for
  // everything it left behind, which blocks pick submission behind
  // SPREADS_NOT_LOCKED for every pool on that slate. A run that silently did
  // part of its job is exactly what a heartbeat is for.
  return result.overflow > 0
    ? {
        ok: false,
        error: `${result.overflow} eligible game(s) exceeded the ${MAX_SPREAD_LOCKS_PER_RUN} per-run cap and were NOT locked`,
        detail: { ...result, dryRun: gate.dryRun },
      }
    : { detail: { ...result, dryRun: gate.dryRun } };
}));

/**
 * SuperAdmin-only HTTPS callable to trigger manual NFL schedule imports.
 */
export const importNFLSchedule = validated(
  { schema: importNFLScheduleSchema, label: "importNFLSchedule", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const userRole = request.auth.token.role || 'USER';
  if (userRole !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Only super admins can trigger NFL schedule imports.');
  }

  const data = input;
  const season = data.season ? String(data.season) : '2026';
  const seasonType = data.seasonType !== undefined ? parseInt(String(data.seasonType)) as 1 | 2 | 3 : 2;
  const weeks = data.weeks ? (Array.isArray(data.weeks) ? data.weeks.map(Number) : [Number(data.weeks)]) : Array.from({ length: 18 }, (_, i) => i + 1);

  try {
    const res = await importNFLSeason(season, seasonType, weeks);
    return { success: true, importedCount: res.importedCount };
  } catch (err: any) {
    console.error("importNFLSchedule Failure:", err);
    throw new HttpsError('internal', `Failed to import NFL schedule: ${err.message || 'Unknown error'}`, err);
  }
});
