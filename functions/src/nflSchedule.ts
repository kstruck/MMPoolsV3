import * as admin from 'firebase-admin';
import { ESPN_SITE_API } from './lib/espnHost';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { writeAuditEvent } from './audit';
import { NFLGame } from './types';
import { acquireSlateLease, releaseSlateLease } from './lib/slateLease';
import { detectStatCorrections, type GameStateChange } from './lib/feedSnapshot';
import { captureFeedSnapshot, pruneExpiredSnapshots, readSnapshotGate, reportStatCorrections } from './feedSnapshotStore';
import { opsCourierAuthToken } from './lib/opsAlertDispatcher';
import { withHeartbeat, configReadFailedVerdict } from './lib/heartbeat';
import { isTerminalGame } from './lib/weekCompletion';
import { hasReportedScores } from './nflScoringEngine';
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
 * Did this game cross into — or out of — a terminal state on this sync?
 *
 * The `terminal` rescore-queue trigger: the slate is enqueued for later
 * reconciliation when any of its games did. Extracted from `syncScoresWindow`
 * and exported so it can be unit-tested; it was inline, and a mutation removing
 * half of it survived the entire suite.
 *
 * `prev === undefined` means no stored doc, which counts as arriving from
 * SCHEDULED — so a game that arrives already terminal IS a transition.
 *
 * BOTH halves of the "nothing moved" test are required:
 *  - the STATUS can move between two terminal states (`CANCELLED ⇄ FINAL`),
 *    which `detectStatCorrections` also ignores because it only compares games
 *    that were already FINAL — a pool finalized on the void would keep it;
 *  - the TERMINAL-NESS can move without the status, which is new: a scoreless
 *    `FINAL` is not terminal (NFL7-3), so a game becomes terminal the moment its
 *    scores arrive, and across that moment the status stays `FINAL`. Keying only
 *    on the status would miss it, and beyond the 24h live window nothing else
 *    would ever make that slate a candidate again.
 *
 * A nonterminal → nonterminal move (`SCHEDULED → IN_PROGRESS`) is deliberately
 * NOT a transition: it changes no grade, and it is every live game on every
 * 5-minute run.
 */
export function isTerminalTransition(
  prev: Pick<NFLGame, 'status' | 'scores'> | undefined,
  next: Pick<NFLGame, 'status' | 'scores'>,
): boolean {
  const prevStatus = prev?.status ?? 'SCHEDULED';
  const prevTerminal = prev ? isTerminalGame(prev) : false;
  const nowTerminal = isTerminalGame(next);
  if (prevStatus === next.status && prevTerminal === nowTerminal) return false;
  return nowTerminal || prevTerminal;
}

/**
 * The `scoresMissing` marker for a game about to be written to `nfl_games`.
 *
 * A `FINAL` the feed reported no scores for is not scoreable (NFL7-3) and does
 * not recover on its own: the score-sync window query bounds on `startTime`, so
 * once the game ages past the lookback nothing asks ESPN about it again. This
 * flag is the second door into that window, so it has to be set by EVERY write
 * path — `syncScoresWindow`, `importNFLSeason` and `replayFeedSnapshot` all write
 * the same `parseScoreboardResponse` output, and a marker set by only one of them
 * leaves the other two able to create a permanently stranded game (codex r2).
 *
 * `existing` is the stored doc where the caller has it. It matters because every
 * write is `merge: true`: a fresh payload that omits `scores` does NOT erase
 * stored ones, so judging the fresh payload alone would re-flag a game that is
 * already fine. Callers without it (bulk import, replay) pass nothing and get the
 * conservative answer — at worst one extra slate fetch, which the next sync
 * clears, because erring toward re-fetching is the safe direction here.
 */
export function scoresMissingMarker(
  fresh: Pick<NFLGame, 'status' | 'scores'>,
  existing?: Pick<NFLGame, 'scores'>,
): boolean {
  const merged = fresh.scores ?? existing?.scores;
  return fresh.status === 'FINAL' && !hasReportedScores({ scores: merged });
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
    // Host lives in lib/espnHost.ts — read its comment before touching it.
    let url = `${ESPN_SITE_API}/football/nfl/scoreboard?week=${week}&season=${season}&seasontype=${seasonType}`;

    try {
      // 1. Fetch calendar to extract precise date range for the specified week of 2026 season.
      // This prevents ESPN's scoreboard API from falling back to 2025 games during the off-season.
      const calendarUrl = `${ESPN_SITE_API}/football/nfl/scoreboard?season=${season}`;
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
            url = `${ESPN_SITE_API}/football/nfl/scoreboard?dates=${dateQuery}`;
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
/**
 * Which week does ESPN say this event belongs to?
 *
 * Same convention as `eventMatchesSeason` directly below: FAIL-OPEN on a
 * missing field, TRUST ESPN over our own argument when the field is present.
 * The requested week is only ever a fallback.
 *
 * ⚠️ THIS EXISTS BECAUSE THE OPPOSITE COST A GAME-DAY DEFECT. `week` used to be
 * stamped from the REQUESTED week — `week: week` — while season and seasonType
 * were already validated against ESPN's own answer. So when a scoreboard query
 * for preseason week 1 came back holding the week-2 slate, all sixteen of those
 * games were written as week 1.
 *
 * Measured in production 2026-08-06: `nfl_games` season 2026 seasonType 1 held
 * week1=7, week2=10 where the truth is 1 and 16 — six games (DET@CIN, GB@PIT,
 * IND@NE, LAC@HOU, ARI@LV, TEN@SF) mis-filed into the Hall of Fame week. A
 * commissioner's HOF pool asked members to pick seven games, six of them from
 * the following weekend, and the week could not score cleanly because those six
 * would not be final for another week.
 *
 * ESPN reports `event.week.number` correctly for every one of them, so trusting
 * it would have prevented the whole thing.
 */
export function eventWeekNumber(
  event: { week?: { number?: number | string } } | undefined | null,
  requestedWeek: number,
): number {
  const n = Number(event?.week?.number);
  // Integral, not merely finite: a fractional 1.5 would file the game outside
  // EVERY real slate (pools and importer requests are whole weeks) and would
  // slip the scoped cleanup too. (codex.)
  return Number.isInteger(n) && n > 0 ? n : requestedWeek;
}

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

      // TV / streaming listing, e.g. "NFL Net", "ESPN Unlmtd", "CBS".
      //
      // ⚠️ OFTEN ABSENT, and that is normal rather than a feed fault. Measured
      // against the live ESPN scoreboard on 2026-08-12: present on 11 of 16
      // preseason week-2 games, 13 of 16 in week 3, 11 of 16 in week 4 — a game
      // carried only in its local markets has no national listing to report.
      // So this is written only when the feed supplies one; the pick sheet omits
      // the field rather than printing a placeholder for it.
      //
      // `names` can hold more than one entry (a simulcast). They are joined
      // rather than truncated to the first, because "CBS/Paramount+" is the
      // honest answer and picking one of the two silently drops where half the
      // audience will actually watch.
      // NATIONAL entries only. ESPN also returns `home`/`away` market rows for
      // local affiliates, and flattening those would put a single city's
      // station on a label the pick sheet presents as the national listing.
      // Filtering here is also what makes the measured counts above TRUE — they
      // were taken over national listings. (codex on this PR.)
      const broadcastNames: string[] = (competition.broadcasts || [])
        .filter((b: any) => b?.market === 'national')
        .flatMap((b: any) => b?.names || [])
        .filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0);

      // ⚠️ `null`, NOT omitted, when there is no listing. Every game write in
      // this file is `merge: true`, and merge KEEPS a field the new payload
      // omits — so a game that loses its national listing (a flex, a feed
      // correction) would keep displaying the old channel forever. An explicit
      // null overwrites it. Readers already test truthiness, so null and absent
      // render identically. (codex on this PR — the same merge-semantics trap
      // this file documents for `scores` and for dropped spreads.)
      const broadcast: string | null = broadcastNames.join('/') || null;

      games.push({
        id: gameId,
        espnGameId: event.id,
        // ESPN's own answer wins over the requested week — see eventWeekNumber.
        week: eventWeekNumber(event, week),
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
        ...(spreadFound ? { spread: { value: spreadValue, locked: false } } : {}),
        broadcast,
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
  weeks: number[] = Array.from({ length: 18 }, (_, i) => i + 1),
  // Injectable ONLY so the write path — the week-scoped orphan cleanup and the
  // locked-spread preservation — is testable without a network call.
  // Production always uses the default. Same arrangement as syncScoresWindow.
  opts: { fetchWeek?: typeof fetchNFLWeekSchedule } = {},
): Promise<{ success: boolean; importedCount: number; leaseBusyWeeks: number[] }> {
  const db = admin.firestore();
  const fetchWeek = opts.fetchWeek ?? fetchNFLWeekSchedule;
  let importedCount = 0;

  console.log(`[nflSchedule] Starting import of season ${season} (type: ${seasonType}) for weeks: ${weeks.join(', ')}`);

  // Read what is already stored for this season+type. Used for two things: the
  // scoped orphan cleanup below, and preserving manually locked spreads.
  const requested = new Set(weeks.map(Number));
  const existingById = new Map<string, Record<string, unknown>>();
  const inScopeWeekById = new Map<string, number>();
  try {
    const existingSnap = await db.collection('nfl_games')
      .where('season', '==', season)
      .where('seasonType', '==', seasonType)
      .get();
    for (const doc of existingSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      existingById.set(doc.id, data);
      // ⚠️ SCOPED TO THE WEEKS BEING IMPORTED.
      //
      // This cleanup used to delete EVERY game of the season+type regardless of
      // which weeks the caller asked for, then re-import only those weeks — so
      // `importNFLSchedule(2026, 1, weeks:[2])` would have destroyed weeks 1, 3
      // and 4, including a Hall of Fame game hours before kickoff. Nothing in
      // the signature hinted at that; `weeks` reads like a filter.
      if (requested.has(Number(data.week))) inScopeWeekById.set(doc.id, Number(data.week));
    }
  } catch (readErr) {
    // Fail CLOSED on the read. Without it we cannot tell an orphan from a game
    // in another week, and we cannot see which spreads are locked — proceeding
    // would risk both deleting the wrong docs and clobbering a manual lock.
    console.error('[nflSchedule] Could not read existing games; aborting import rather than guessing:', readErr);
    throw new HttpsError('unavailable', 'Could not read existing NFL games; import aborted.');
  }

  const freshIds = new Set<string>();
  // Only weeks whose fetch actually returned a slate are eligible for the orphan
  // sweep below. A week that fetched NOTHING is skipped entirely — otherwise an
  // ESPN outage or a bad date range would delete a perfectly good stored week,
  // which is the failure this whole change exists to prevent. Caught by
  // `importScope.emulator.test.ts`; an earlier revision of this function
  // asserted in a comment that it could not happen, and it could.
  const fetchedWeeks = new Set<number>();
  /** Weeks skipped because a freeze pass held the slate (reported, never silent). */
  const leaseBusyWeeks: number[] = [];
  for (const week of weeks) {
    // ⚠️ HOLD THE SLATE LEASE ACROSS THIS WEEK'S FETCH AND COMMIT
    // (PLAN-NFL-SPREAD-FREEZE 1.3, codex round 11; TAKEN rather than merely
    // CHECKED after codex r1 on this PR).
    //
    // The freeze reconciles the fetched event ids against the stored slate before
    // it commits, and Firestore does not range-lock — so an import that ADDS a
    // game between that reconciliation and the commit would leave the newcomer
    // unfrozen and the week frozen across two states. Serialising the two writers
    // is the only thing that closes it.
    //
    // A read-only `is it held?` check was the first version of this and it did not
    // serialise anything: an import that observed no lease could still be fetching
    // when the freeze acquired one, and commit its batch afterwards. The lease has
    // to be HELD for the whole fetch-and-write, which is what the freeze does with
    // it too. Per week rather than per import, so an 18-week backfill never parks
    // the freeze behind seventeen ESPN round-trips.
    //
    // This does NOT close the general importer race — `PLAN-IMPORTER-SAFETY.md`
    // §1.1/§1.5 still owns that. It closes the freeze's half of it.
    const slateKey = { season, seasonType, week: Number(week) };
    const importLease = await acquireSlateLease(db, slateKey, Date.now());
    if (!importLease) {
      console.warn(`[nflSchedule] Week ${week} is held by a running spread freeze; skipping it rather than racing the commit.`);
      leaseBusyWeeks.push(Number(week));
      continue;
    }
    try {
    const games = await fetchWeek(week, season, seasonType);
    if (games.length === 0) {
      console.log(`[nflSchedule] No games fetched for Week ${week}. Skipping (its stored games are left untouched).`);
      continue;
    }
    // ⚠️ ONLY when the response actually contains a game FOR THIS WEEK.
    //
    // A non-empty response is not proof the week was fetched: at an overlapping
    // calendar boundary ESPN can return a slate made up ENTIRELY of the next
    // week's games. Marking the week fetched on `games.length > 0` alone would
    // then let the orphan sweep below delete every stored game in it, because
    // none of them appear in `freshIds` — destroying a good week from a response
    // that said nothing about it. Same spillover class this change exists to
    // handle, one layer down. (codex r2 on this change.)
    if (games.some(g => Number(g.week) === Number(week))) fetchedWeeks.add(Number(week));

    // ⚠️ RE-READ THIS WEEK'S DOCS IMMEDIATELY BEFORE WRITING THEM.
    //
    // The spread decision below used `existingById`, which is read ONCE before
    // the week loop — so on an 18-week import the snapshot backing week 18's
    // decision is minutes old and 17 ESPN round-trips stale. A spread locked in
    // that gap (a commissioner in the admin UI, or `lockNFLSpreadsJob`) would be
    // overwritten with the fresh line and `locked: false`, which is the #235 bug
    // class: an ATS pool then refuses every pick behind SPREADS_NOT_LOCKED.
    // (qodo #2 on this PR.)
    //
    // 🛑 THIS NARROWS THE RACE, IT DOES NOT CLOSE IT. There is still a gap
    // between this read and the commit. The real fix is the single atomic
    // TRANSACTION specified in PLAN-IMPORTER-SAFETY.md §1.1/§1.5, which re-reads
    // inside the transaction so a concurrent lock forces a retry — that is Phase
    // 1 work and deliberately not in this PR. Do not read this comment as the
    // race being handled.
    //
    // It is still strictly better than what shipped before this change, which
    // DELETED the documents first and destroyed a concurrently-locked spread
    // outright.
    const freshExisting = new Map<string, NFLGame>();
    for (const doc of await db.getAll(...games.map(g => db.collection('nfl_games').doc(g.id)))) {
      if (doc.exists) freshExisting.set(doc.id, doc.data() as NFLGame);
    }

    const batch = db.batch();
    for (const game of games) {
      const cleanedGame = JSON.parse(JSON.stringify(game));
      // Bulk import writes the same parseScoreboardResponse output as the sync,
      // so it can create a scoreless FINAL too — and without the marker that game
      // is outside BOTH doors and never refreshed again (codex r2).
      cleanedGame.scoresMissing = scoresMissingMarker(game);

      // ⚠️ NEVER CLOBBER A MANUALLY LOCKED SPREAD. The parser always emits
      // `locked: false`, so a re-import used to silently unlock every line a
      // commissioner had locked — and an ATS pool with an unlocked line refuses
      // every pick (SPREADS_NOT_LOCKED). Dropping the key lets `merge: true`
      // keep what is stored.
      // `freshExisting`, not `existingById` — see the re-read above. The orphan
      // sweep keeps using `existingById`, which is correct for it: it decides
      // which STORED ids existed when the run began.
      const stored = freshExisting.get(cleanedGame.id) as { spread?: { locked?: boolean } } | undefined;
      if (stored?.spread?.locked === true) {
        delete cleanedGame.spread;
      } else if (stored?.spread !== undefined && cleanedGame.spread === undefined) {
        // ⚠️ AN UNLOCKED SPREAD THE FEED NO LONGER CARRIES MUST BE REMOVED, NOT KEPT.
        //
        // This case only exists because this change stopped deleting the docs
        // first. The old importer wiped the week and rewrote it, so a line ESPN
        // had dropped simply vanished; the orphan sweep replaced that with
        // `merge: true`, and merge keeps a field the new payload omits — which is
        // exactly what makes the locked-spread preservation above work.
        //
        // Keeping a stale UNLOCKED line is not harmless. `lockNFLSpreadsJob` locks
        // any spread it finds with a value and `locked !== true`
        // (`shouldLockSpread`), so the next Tuesday it would freeze a number ESPN
        // has withdrawn, and every ATS pick and grade on that game would run
        // against it. Nothing downstream can tell a withdrawn line from a current
        // one.
        //
        // The opposite reading — "an absent field is feed flakiness, do not act on
        // it", which `detectStatCorrections` applies to scores — is right for the
        // 5-minute poll and wrong here: an import is an explicit operator action
        // whose whole purpose is to make storage match the feed, and it is cheap
        // to re-run. A locked spread is still preserved above, so this can never
        // touch a line a commissioner has committed to. (codex.)
        cleanedGame.spread = admin.firestore.FieldValue.delete();
      }

      freshIds.add(cleanedGame.id);
      const gameRef = db.collection('nfl_games').doc(cleanedGame.id);
      batch.set(gameRef, cleanedGame, { merge: true });
      importedCount++;
    }
    await batch.commit();
    console.log(`[nflSchedule] Week ${week} imported successfully with ${games.length} games.`);
    } finally {
      // Best-effort, same as the freeze: a failed release only means the lease
      // expires on its own TTL, which is what the expiry is for.
      await releaseSlateLease(db, slateKey, importLease).catch((e) => {
        console.warn(`[nflSchedule] slate lease release failed for week ${week}:`, e);
      });
    }
  }

  // Orphans: stored games in a SUCCESSFULLY FETCHED week that the fresh slate no
  // longer returns — a cancelled or re-scheduled fixture. Deleted AFTER the
  // writes, and only for weeks that actually returned data. Chunked under the
  // 500-op batch cap.
  //
  // RESIDUAL, stated rather than implied away: this runs outside the slate lease.
  // A delete racing a freeze can only REMOVE a game, never add one, so it cannot
  // produce the partial-freeze the lease exists to prevent — the worst case is a
  // frozen record for a game that no longer exists, which no reader consults
  // (every reader iterates the STORED slate and joins to it).
  const orphanIds = [...inScopeWeekById.entries()]
    .filter(([id, wk]) => fetchedWeeks.has(wk) && !freshIds.has(id))
    .map(([id]) => id);
  for (let i = 0; i < orphanIds.length; i += 400) {
    const chunk = orphanIds.slice(i, i + 400);
    const deleteBatch = db.batch();
    chunk.forEach(id => deleteBatch.delete(db.collection('nfl_games').doc(id)));
    await deleteBatch.commit();
  }
  if (orphanIds.length > 0) {
    console.log(`[nflSchedule] Removed ${orphanIds.length} orphaned game(s) from weeks ${weeks.join(', ')}: ${orphanIds.join(', ')}`);
  }

  await writeAuditEvent({
    poolId: 'system',
    type: 'POOL_STATUS_CHANGED', // Closest system type
    message: `Imported ${importedCount} NFL games for ${season} (type: ${seasonType})`,
    severity: 'INFO',
    actor: { uid: 'system', role: 'SYSTEM', label: 'NFL Scheduler' }
  });

  // A week skipped for a live freeze lease is NOT an import that quietly did less
  // than it said. An operator who asked for weeks 3 and 4 and got one of them has
  // to be able to see that from the result.
  if (leaseBusyWeeks.length > 0) {
    console.warn(`[nflSchedule] ${leaseBusyWeeks.length} week(s) skipped for a running spread freeze: ${leaseBusyWeeks.join(', ')}. Re-run the import once it finishes.`);
  }
  return { success: true, importedCount, leaseBusyWeeks };
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
   * Games written this run as `FINAL` with no reported scores (NFL7-3). These
   * block their pool's week from completing and cannot be scored, and both this
   * job and the auto-scorer otherwise resolve cleanly through the condition —
   * which is precisely the "resolves successfully while nothing works" shape the
   * heartbeat exists to surface. Counted so the run is reported DEGRADED rather
   * than silently green.
   */
  scorelessFinals: number;
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
    scorelessFinals: 0,
    correctionReportFailures: 0,
  };

  // Only games in the active window: started within the last `lookbackMs` (still live
  // or recently final) through the next 2h. The lower bound stops the job from
  // dragging the whole past season into every run (a single-field range is allowed).
  const activeGamesSnap = await db.collection('nfl_games')
    .where('startTime', '>=', now - lookbackMs)
    .where('startTime', '<=', now + 2 * 60 * 60 * 1000)
    .get();

  // NOTE: there is deliberately no `activeGamesSnap.empty` early return here any
  // more. One used to sit at this point, and it would have skipped the
  // scoreless-FINAL door below — which is the exact case that door exists for: a
  // game stranded PAST the lookback, with nothing else in the window to keep the
  // run alive. Emptiness is decided once, on `weeksToSync`, after BOTH sources
  // have contributed. Found by an existing test, not by reading.

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

  // SECOND DOOR: games left FINAL with no reported scores, at ANY startTime.
  //
  // The window query above bounds on `startTime`, so a scoreless FINAL older than
  // the lookback drops out of every refresh path — and because it is not terminal
  // (NFL7-3) the pool never finalizes, with nothing left that would ever ask the
  // feed again. That is a permanent stall, not a wait. The marker is written by
  // the score-sync write path below, so a slate re-enters the window on the
  // strength of the defect itself and leaves it the moment the scores land.
  //
  // Cheap by construction: the flag is only ever true for a genuinely broken
  // payload, so this query returns nothing on a healthy day.
  //
  // BOUNDED (qodo). A prolonged feed outage or a bad backfill could mark many
  // games, and an unbounded read would grow both the Firestore read size and the
  // number of ESPN slate fetches on every 5-minute run — a scheduler timeout is a
  // worse outcome than a slow recovery. The cap is on GAMES, and games collapse
  // into slates, so one bad week costs one fetch however many of its games are
  // marked; 200 games is more than ten full NFL weeks entirely broken at once.
  //
  // Deliberately NOT paginated, and the log message says so rather than implying
  // otherwise (codex r7). Without an ordering there is no cursor to carry, and
  // adding one means a composite index — which is the single failure mode that
  // has bitten this repo hardest (A5 and the finalize sweep both died silently on
  // a missing index). Hitting this cap is an operator event, not a slow path, so
  // the honest design is a hard ceiling plus a log that admits it is one.
  const SCORELESS_SCAN_LIMIT = 200;
  const scorelessSnap = await db.collection('nfl_games')
    .where('scoresMissing', '==', true)
    .limit(SCORELESS_SCAN_LIMIT)
    .get();
  if (scorelessSnap.size === SCORELESS_SCAN_LIMIT) {
    console.warn(
      `[nflSchedule] scoreless-FINAL scan hit its ${SCORELESS_SCAN_LIMIT}-game cap. ` +
      'Games beyond the cap are NOT being examined, and they will NOT be picked up ' +
      'by a later run on their own: the query has no cursor and no ordering, so ' +
      'every run returns the same prefix, and the prefix only advances as those ' +
      'games are resolved. This needs a human. A cap this deep means something is ' +
      'systematically wrong with the feed, not one broken game.',
    );
  }
  /** Marked game ids per slate key — used below to notice one the refresh never returned. */
  const markedBySlate = new Map<string, string[]>();
  scorelessSnap.forEach(doc => {
    const data = doc.data() as NFLGame;
    const key = `${data.season}_${data.seasonType}_${data.week}`;
    if (!weeksToSync.has(key)) {
      weeksToSync.set(key, { week: data.week, season: data.season, seasonType: data.seasonType });
    }
    markedBySlate.set(key, [...(markedBySlate.get(key) ?? []), doc.id]);
  });
  if (scorelessSnap.size > 0) {
    console.warn(
      `[nflSchedule] ${scorelessSnap.size} game(s) are FINAL with no reported scores and ` +
      `cannot be scored: ${scorelessSnap.docs.map(d => d.id).slice(0, 10).join(', ')}. ` +
      'Their slates are being re-fetched; pools on them stay unfinalized until the feed delivers.',
    );
  }

  if (weeksToSync.size === 0) {
    return empty;
  }

  console.log(`[nflSchedule] Syncing scores for ${weeksToSync.size} week slots (lookback ${Math.round(lookbackMs / 3_600_000)}h${dryRun ? ', DRY RUN' : ''})`);

  // A5: snapshot the raw feed before it overwrites nfl_games, and notice when a
  // game that was already FINAL changes. Gate read once per run, not per slate.
  const snapshotGate = await readSnapshotGate(db);
  let gamesWritten = 0;
  /** Game ids written this run as FINAL with no reported scores — see the marker below. */
  const scorelessFinals: string[] = [];
  let correctionCount = 0;
  let slatesNotReconciled = 0;
  let snapshotFailures = 0;
  let correctionReportFailures = 0;
  /**
   * Game ids whose correction has already been reported THIS RUN.
   *
   * ESPN's calendar ranges overlap, so one corrected game can arrive in two
   * slots' responses. `activeGamesSnap` is read once before this loop, so after
   * the first slot writes the new score the second slot still compares against
   * the stale prior state and detects the SAME correction again — paging twice
   * and inflating `corrections`. A stat-correction page is a wake-somebody event;
   * crying it twice for one restatement is how a real one starts getting ignored.
   *
   * Keyed by game id, not by the change tuple: two different fields changing on
   * one game is still one correction event for one game, and the report already
   * carries the detail. First slot to see it owns it — which is the slot whose
   * response actually delivered it. (codex r7 on this change.)
   */
  const reportedCorrections = new Set<string>();
  /**
   * Game ids whose correction has been COUNTED this run.
   *
   * Separate from `reportedCorrections` because the two answer different
   * questions, and collapsing them costs one of the answers. Suppression must
   * only happen once a report SUCCEEDED — otherwise a failed alert silences the
   * retry a later overlapping slot could have made, and this file's own
   * `correctionReportFailures` docblock calls a detected-then-dropped correction
   * the most expensive silent failure here. Counting, by contrast, must happen
   * once per correction however many slots deliver it, or a retry inflates the
   * heartbeat number an operator uses to judge the night. (qodo #3, second pass.)
   */
  const countedCorrections = new Set<string>();

  for (const [_, slot] of weeksToSync) {
    const { games: freshGames, raw } = await fetchSlate(slot.week, slot.season, slot.seasonType);
    // Zero games for a slate we KNOW has games is the whole signal — see
    // slatesNotReconciled. Deliberately does not care WHY (fetch threw and was
    // caught, or the season guard filtered everything): the run skipped work it
    // was supposed to do, and before this counter existed that looked identical
    // to a clean run.
    if (freshGames.length === 0) { slatesNotReconciled++; continue; }

    const slateKey = { season: slot.season, seasonType: slot.seasonType, week: slot.week };

    // ⚠️ SPLIT THE RESPONSE BY THE WEEK EACH GAME ACTUALLY BELONGS TO.
    //
    // `resolveScoreboardUrl` queries a DATE RANGE from ESPN's calendar, and those
    // calendar entries OVERLAP at the boundary — the 2026 "Hall of Fame Weekend"
    // entry runs 08-06..08-13 and "Preseason Week 1" starts on 08-13. So a slate
    // fetch legitimately returns games from the NEXT week, and since
    // `parseScoreboardResponse` now files each game under ESPN's own
    // `week.number`, `freshGames` can span weeks.
    //
    // Everything slate-SCOPED below (correction detection, the feed snapshot,
    // terminal-transition detection and the rescore-queue key) is keyed on
    // `slateKey`, so feeding it the spillover would attribute another week's
    // corrections and rescore events to this one. Reconcile only this slate's
    // games; still WRITE all of them, because their scores and their corrected
    // `week` are real data and dropping them would strand the spillover games.
    // (codex, on the week-stamping change.)
    const slateGames = freshGames.filter(g => Number(g.week) === Number(slot.week));
    /** id -> the fresh game, so a correction can be traced back to its owning week. */
    const freshById = new Map(freshGames.map(g => [g.id, g]));
    if (slateGames.length !== freshGames.length) {
      console.log(`[nflSchedule] slate ${slateKey.season}/${slateKey.seasonType}/wk${slateKey.week}: ${freshGames.length - slateGames.length} game(s) belong to another week; written but reconciled under their own slate.`);
    }

    // ⚠️ A NON-EMPTY RESPONSE IS NOT PROOF THIS SLATE WAS FETCHED.
    //
    // The `freshGames.length === 0` guard above counts a slate that returned
    // nothing. But an overlapping calendar range can return a response made up
    // ENTIRELY of the neighbouring week's games, and that is a slate-level fetch
    // failure wearing a success: we asked about week N and learned nothing about
    // it. Without this the run reports healthy, `slatesNotReconciled` stays 0, and
    // `captureFeedSnapshot` stores a snapshot claiming `gameCount: 0` beside a
    // non-empty raw payload — evidence that actively misleads whoever reads it
    // during the next incident.
    //
    // The importer already guards the identical shape
    // (`games.some(g => Number(g.week) === Number(week))` before marking a week
    // fetched); this is the sync path catching up to it. (qodo #6 on this PR.)
    //
    // The spillover games are still WRITTEN, and their terminal transitions and
    // stat corrections are still enqueued under their own weeks below — the
    // response is not discarded, only its claim about THIS slate is. (qodo #6.)
    const slateReconciled = slateGames.length > 0;
    if (!slateReconciled) {
      slatesNotReconciled++;
      console.warn(`[nflSchedule] slate ${slateKey.season}/${slateKey.seasonType}/wk${slateKey.week}: spillover-only response (${freshGames.length} game(s), none in this week); slate NOT reconciled. Its games are still written under their own weeks.`);
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
    //
    // Hoisted above correction detection so the spillover pass below has a prior
    // state to compare against — `activeGamesSnap` only covers this slate.
    const existingById = new Map<string, NFLGame>();
    for (const doc of await db.getAll(...freshGames.map(g => db.collection('nfl_games').doc(g.id)))) {
      if (doc.exists) existingById.set(doc.id, doc.data() as NFLGame);
    }

    // Prior state for this slate, as the finalizer would have seen it. Scoped to
    // the window we queried — which is why the deep sweep's wider lookback is what
    // makes a late correction detectable at all.
    const prevGames = activeGamesSnap.docs
      .map(d => d.data() as NFLGame)
      .filter(g => g.season === slot.season && Number(g.seasonType) === Number(slot.seasonType) && Number(g.week) === Number(slot.week));
    // Filtered on what has been REPORTED, not on what has been seen: an
    // overlapping slot that already alerted successfully owns it, but one whose
    // alert FAILED must not silence this slot's attempt.
    const corrections = detectStatCorrections(prevGames, slateGames)
      .filter(c => !reportedCorrections.has(c.gameId));

    // COUNTING AND THE RESCORE ENQUEUE ARE ONCE-PER-RUN; ONLY THE ALERT RETRIES.
    //
    // Splitting these is the point (qodo #3, second pass). A failed alert should
    // be re-attempted by a later overlapping slot, because both of its sinks
    // swallow their own failures and a dropped correction is the most expensive
    // silent failure in this file. But the rescore event and the heartbeat count
    // must not be re-emitted on that retry: the queue would carry a duplicate for
    // a slate it already covers, and `corrections` is the number an operator reads
    // to judge how bad a night was.
    const newCorrections = corrections.filter(c => !countedCorrections.has(c.gameId));
    for (const c of newCorrections) countedCorrections.add(c.gameId);
    correctionCount += newCorrections.length;

    // ⚠️ A SPILLOVER GAME CAN CARRY A STAT CORRECTION, AND SLATE-SCOPING SWALLOWS IT.
    //
    // Second finding of the same shape as `terminalSlates` below, on the round
    // after that one was fixed (codex). `detectStatCorrections` above compares
    // this slate only, so an already-FINAL game from a NEIGHBOURING week whose
    // score changed produces no correction — while the write loop persists the new
    // score anyway. After that the evidence is gone: the owning week's pass, on
    // this run or any later one, compares against the score this run just wrote
    // and sees nothing changed. If that week has no slot at all, it is never
    // revisited.
    //
    // A stat correction is the one class of change that invalidates a settled
    // result, so losing it leaves a pool's standings wrong with nothing left to
    // notice. Detect it against the stored doc — `existingById`, hoisted above for
    // exactly this — and file the alert and the rescore under the owning week.
    //
    // DETECTION RUNS BEFORE THE SNAPSHOT so the snapshot can carry it. Reporting
    // still happens after, keeping the snapshot-then-report order the main slate
    // has always used.
    const spilloverGames = freshGames.filter(g => Number(g.week) !== Number(slot.week));
    const correctionSlates = new Map<number, GameStateChange[]>();
    /** Owning weeks carrying at least one correction NEW to this run. */
    const newCorrectionSlates = new Set<number>();
    for (const change of detectStatCorrections(
      spilloverGames.map(g => existingById.get(g.id)).filter((g): g is NFLGame => g !== undefined),
      spilloverGames,
    )) {
      // Same run-level dedupe as the slate pass above — the owning week's own
      // slot may already have reported this one. Marked reported only after the
      // report below succeeds.
      if (reportedCorrections.has(change.gameId)) continue;
      const week = Number(freshById.get(change.gameId)?.week);
      // Unusable week: attribute it to the slot we fetched rather than dropping
      // it or keying an un-drainable event.
      const owning = Number.isInteger(week) && week > 0 ? week : Number(slot.week);
      correctionSlates.set(owning, [...(correctionSlates.get(owning) ?? []), change]);
      // Same split as the slate pass: counted and enqueued once per run, alerted
      // again if the alert failed.
      if (!countedCorrections.has(change.gameId)) {
        countedCorrections.add(change.gameId);
        correctionCount++;
        newCorrectionSlates.add(owning);
      }
    }
    const spilloverChanges = [...correctionSlates.values()].flat();

    // THE SNAPSHOT IS THE EVIDENCE BEHIND THE ALERT, so it is captured whenever
    // there is an alert to support — including on a spillover-only response.
    //
    // Two earlier fixes on this PR collided here (codex, the round after both).
    // One skipped the snapshot when the slate was not reconciled, because
    // `gameCount: 0` beside a non-empty payload reads as misleading evidence. The
    // other made the spillover alert point operators at THIS slate's snapshots.
    // Together they produced an alert that names a slate where the response was
    // never stored — promising before/after payloads that do not exist, which is
    // worse than the misleading count either fix was avoiding.
    //
    // So the gate is "is there anything to keep", not "was this slate
    // reconciled", and the snapshot carries BOTH correction lists. That also
    // resolves the original objection: a row with `gameCount: 0` and a non-empty
    // `corrections` array explains itself — the response carried no games for this
    // slate but did carry a correction for another week. The genuinely misleading
    // shape, `gameCount: 0` with no corrections, is still skipped.
    //
    // `gameCount` remains THIS slate's count, so it keeps meaning one thing.
    // Filing under `slateKey` is deliberate: it is the response we fetched, it is
    // where `snapshotPointerLine` sends the operator, and writing it under the
    // owning week would collide with the snapshot that week's own pass stores.
    const keepEvidence = slateReconciled || spilloverChanges.length > 0;
    if (snapshotGate.enabled && raw !== null && keepEvidence) {
      const outcome = await captureFeedSnapshot(
        db, slateKey, raw, [...corrections, ...spilloverChanges], slateGames.length,
      );
      if (outcome === "skipped") snapshotFailures++;
    }
    // Corrections are reported whether or not snapshots are on — the page is the
    // point; the snapshot is only the evidence attached to it. Gated on
    // `slateReconciled` because a spillover-only response says nothing about THIS
    // slate; the spillover's own alert follows.
    if (slateReconciled && corrections.length > 0) {
      // Marked reported ONLY on success, so a failed alert leaves the retry open
      // to a later overlapping slot in this same run.
      if (await reportStatCorrections(db, slateKey, corrections)) {
        for (const c of corrections) reportedCorrections.add(c.gameId);
      } else {
        correctionReportFailures++;
      }
    }

    for (const [week, changes] of correctionSlates) {
      const owningKey = { season: slot.season, seasonType: slot.seasonType, week };
      // `slateKey` is passed as `observedIn` so the alert names the slate whose
      // response this arrived in — the snapshot is filed under THAT one, and
      // pointing an operator at the owning week's snapshots during an incident
      // would send them somewhere with nothing in it. (qodo #3.)
      if (await reportStatCorrections(db, owningKey, changes, slateKey)) {
        for (const c of changes) reportedCorrections.add(c.gameId);
      } else {
        correctionReportFailures++;
      }
      console.warn(`[nflSchedule] ${changes.length} stat correction(s) arrived for week ${week} inside the week ${slot.week} response: ${changes.map(c => c.gameId).join(', ')}`);
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
    //  - scoreless FINAL → FINAL WITH SCORES (NFL7-3): `isTerminalGame` no
    //    longer counts a FINAL the feed reported no scores for, so the moment
    //    the scores arrive is the moment the game really becomes terminal — and
    //    the STATUS did not change across it.
    //
    // Measured against the MERGED game, not the raw payload (codex r3). Every
    // write is `merge: true`, so a payload that omits `scores` leaves the stored
    // ones in place — but the raw payload on its own reads as a scoreless FINAL,
    // i.e. NON-terminal, so comparing it to a stored terminal game looks like a
    // terminal → nonterminal transition and would enqueue a `terminal` rescore
    // on EVERY sync for as long as the feed kept omitting them. One merged view,
    // used for both this test and the marker below, is what keeps the two from
    // disagreeing about what is about to be persisted.
    const mergedById = new Map<string, NFLGame>(freshGames.map(g => [
      g.id,
      { ...g, scores: g.scores ?? existingById.get(g.id)?.scores } as NFLGame,
    ]));
    // Which SLATES had a terminal transition in this response — keyed by each
    // game's OWN week, not by the slot we fetched.
    //
    // ⚠️ THE OBVIOUS VERSION IS WRONG AND SHIPPED IN AN EARLIER REVISION OF THIS
    // CHANGE. It scoped the test to `slateGames` on the reasoning that a
    // spillover game "picks itself up on its own pass". It does not, for two
    // independent reasons (codex, on this change):
    //
    //  - THE WRITE BELOW PERSISTS IT. Every game in `freshGames` is written,
    //    spillover included — deliberately, its scores are real data. So once
    //    this slot's pass commits a spillover game as FINAL, the pass for the
    //    week that OWNS it reads that FINAL as its prior state and sees
    //    `FINAL -> FINAL`, which `isTerminalTransition` correctly reports as no
    //    transition. The event is not deferred to the other pass; it is lost.
    //  - THE OTHER PASS MAY NOT EXIST. `weeksToSync` was built from stored docs
    //    before any of this ran, so a week whose games are outside the
    //    `startTime` window is not a slot at all and never gets a pass.
    //
    // The consequence is the one the rescore queue exists to prevent: a game
    // goes terminal, its pool's standings are never reconciled, and nothing
    // downstream ever revisits it. Enqueue under the owning week instead — the
    // event still rides in this slot's batch, because this slot's write is what
    // made it necessary.
    //
    // `mergedById` deliberately spans all of `freshGames`, because the write loop
    // below reads it for every game it persists.
    const terminalSlates = new Map<string, { season: string; seasonType: 1 | 2 | 3; week: number }>();
    for (const g of freshGames) {
      if (!isTerminalTransition(existingById.get(g.id), mergedById.get(g.id)!)) continue;
      const week = Number(g.week);
      // A game whose week is unusable would key an un-drainable event; file it
      // under the slot we asked for, which is where it would have gone before
      // ESPN's week was trusted at all.
      const owning = Number.isInteger(week) && week > 0 ? week : Number(slot.week);
      const key = `${slot.season}_${slot.seasonType}_${owning}`;
      if (!terminalSlates.has(key)) {
        terminalSlates.set(key, { season: slot.season, seasonType: slot.seasonType, week: owning });
      }
    }

    // Counted BEFORE the dry-run early-out below. A dry run that re-fetches an
    // already-stranded game, gets another scoreless FINAL, and then reports a
    // healthy run would make the monitoring worthless in exactly the situation
    // it exists for — and the deep sweep runs dry by default (codex r3).
    for (const g of freshGames) {
      if (scoresMissingMarker(mergedById.get(g.id)!)) scorelessFinals.push(g.id);
    }
    // A marked game that the refresh did NOT return at all (codex r4). The slate
    // came back non-empty, so `slatesNotReconciled` stays 0, and the loop above
    // only sees what WAS returned — so the marked doc keeps its flag, keeps being
    // retried forever, and the heartbeat reports a healthy run while the pool is
    // still blocked. The absence is the signal here, and an absent error is not
    // evidence of success.
    const marked = markedBySlate.get(`${slateKey.season}_${slateKey.seasonType}_${slateKey.week}`) ?? [];
    for (const id of marked) {
      if (!mergedById.has(id)) scorelessFinals.push(id);
    }

    if (dryRun) {
      console.log(`[nflSchedule] DRY RUN — would write ${freshGames.length} game(s) for ${slateKey.season}/${slateKey.seasonType}/wk${slateKey.week}; ${corrections.length} correction(s) detected.`);
      continue;
    }

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

      // A FINAL the feed reported no scores for is not scoreable (NFL7-3), and
      // it is not self-healing either: the week-selection query above bounds on
      // `startTime`, so once the game is older than the lookback its slate is
      // never re-fetched and the scores are never asked for again. The pool
      // would sit unfinalized forever with nothing left to repair it.
      //
      // So it is MARKED, durably, and the marker is a second door into the sync
      // window (see `scoresMissing` in the selection above). Computed against the
      // MERGED result rather than the fresh payload: `merge: true` preserves a
      // stored `scores` when the new payload omits it, so testing `freshGame`
      // alone would re-flag a game that already has scores on every run.
      // Same merged view the transition test used above, so the marker and the
      // enqueue decision can never disagree about what is being persisted. The
      // count was taken there too, before the dry-run early-out.
      cleanedGame.scoresMissing = scoresMissingMarker(mergedById.get(freshGame.id)!);

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
    // BOTH reasons are keyed to the OWNING week now, not to the slot we fetched.
    // `corrections` covers this slate; `correctionSlates` covers a neighbouring
    // week whose already-FINAL game was corrected inside this response — the
    // write below persists that new score, so if this event is not enqueued the
    // correction is gone for good (see the spillover block above).
    // Gated on NEW corrections, not on `corrections`: a correction whose alert
    // failed in an earlier slot is deliberately re-attempted here, and that retry
    // must not enqueue a second rescore for a slate the queue already covers.
    if (newCorrections.length > 0) {
      batch.set(db.collection(RESCORE_QUEUE).doc(), rescoreEventDoc({ ...slateKey, reason: 'correction', enqueuedAt: now }));
    }
    for (const week of newCorrectionSlates) {
      batch.set(db.collection(RESCORE_QUEUE).doc(), rescoreEventDoc({
        season: slot.season, seasonType: slot.seasonType, week, reason: 'correction', enqueuedAt: now,
      }));
    }
    for (const owning of terminalSlates.values()) {
      batch.set(db.collection(RESCORE_QUEUE).doc(), rescoreEventDoc({ ...owning, reason: 'terminal', enqueuedAt: now }));
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
    scorelessFinals: scorelessFinals.length,
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
    scorelessFinals: r.scorelessFinals,
  };
  const degraded: string[] = [];
  if (r.slatesNotReconciled > 0) degraded.push(`${r.slatesNotReconciled} slate(s) returned no games`);
  if (r.snapshotFailures > 0) degraded.push(`${r.snapshotFailures} snapshot write(s) failed`);
  if (r.correctionReportFailures > 0) degraded.push(`${r.correctionReportFailures} stat-correction report(s) undelivered`);
  // Not a failure of THIS job — the feed is what is broken — but it blocks
  // scoring and finalization, so a green heartbeat here would be a lie.
  if (r.scorelessFinals > 0) degraded.push(`${r.scorelessFinals} game(s) FINAL with no reported scores — cannot be scored`);
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

// `shouldLockSpread`, `lockSpreadsOnce`, `SpreadLockResult` and `lockNFLSpreadsJob`
// LIVED HERE UNTIL 2026-08-20 and are DELETED, not moved (PLAN-NFL-SPREAD-FREEZE
// Phase 1). They locked whatever value the last import had left on the document —
// they fetched nothing — so on 2026-08-18 the job ran on schedule and reported
// `would lock 0 spread(s)` while ESPN carried all sixteen lines for the slate.
//
// The replacement is `nflSpreadFreeze.ts`: it FETCHES the target week at the
// stated instant and writes the result, all or nothing, to `nfl_frozen_spreads`.
// It keeps the deployed export name `lockNFLSpreadsJob` and the config key
// `system/config.nflSpreadLock` so the Cloud Scheduler job, the heartbeat history
// and the armed production config all carry over.

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
    // Surfaced, not swallowed: the caller asked for N weeks and may have got fewer.
    return { success: true, importedCount: res.importedCount, leaseBusyWeeks: res.leaseBusyWeeks };
  } catch (err: any) {
    console.error("importNFLSchedule Failure:", err);
    throw new HttpsError('internal', `Failed to import NFL schedule: ${err.message || 'Unknown error'}`, err);
  }
});
