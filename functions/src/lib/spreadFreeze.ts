// The weekly spread freeze — the DECISIONS (PLAN-NFL-SPREAD-FREEZE 1.1-1.4,
// Revision 1).
//
// Pure: every Firestore and ESPN call lives in `nflSpreadFreeze.ts`. These
// functions are what the unit tests pin, and they are where the rules that took
// fifteen review rounds to get right actually live.
//
// The requirement, Kevin 2026-08-19: *"once the spreads are fetched for that
// week, they must be locked and remain unchanged no matter what."* Three rules
// fall out of that and none of them is optional:
//
//  1. ONE SLATE PER RUN, and a slate is freezable EXACTLY ONCE. Selecting "the
//     earliest slate not already fully locked" was the original rule and it
//     inverted the plan: a slate with fifteen games frozen and one late addition
//     satisfies it, and the pass then rewrites all sixteen at a second instant
//     with whatever the feed says now (codex round 7).
//  2. A FREEZE HORIZON, or the once-only rule walks forward. With week N frozen
//     and therefore excluded, "the earliest unfrozen slate" is week N+1 — frozen
//     nine days early, at a Tuesday that is not its stated cutoff, permanently
//     (codex round 8).
//  3. ALL-OR-NOTHING OVER THE STORED SLATE, not over whatever the feed returned.
//     "Every fetched game has a line" passes on a 15-of-16 response: fifteen get
//     written and the stored sixteenth stays unfrozen — a partially frozen week
//     that looks complete to the job that made it (codex round 9).

/** One (season, seasonType, week) slate — the exact scope of the submit gate. */
export interface SlateKey {
  season: string;
  seasonType: number;
  week: number;
}

/** The minimum of an `nfl_games` doc this module reasons about. */
export interface StoredGame extends SlateKey {
  id: string;
  startTime: number;
  status?: string;
  spread?: { value?: number | null; locked?: boolean } | null;
}

/** The minimum of a game as the ESPN fetch returns it. */
export interface FetchedGame extends SlateKey {
  id: string;
  spread?: { value?: number | null } | null;
}

/** The freeze horizon: one run covers exactly the slate that is due next. */
export const FREEZE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Safety cap on a single freeze transaction. A real slate is ~16 games, so this
 * never binds — it exists so a corrupt import cannot push one transaction past
 * Firestore's limits. REFUSE rather than truncate if it ever does: truncating is
 * the partial-freeze failure wearing a different hat (1.4).
 */
export const MAX_GAMES_PER_FREEZE = 40;

/** `season/seasonType/week`, matching `nflLockWatch.slateId`. */
export const slateId = (k: SlateKey): string => `${k.season}/${k.seasonType}/${k.week}`;

/**
 * The same key as a Firestore document id. `slateId` uses `/`, which a document
 * id may not contain — this is the lease document's name, so it uses `_`.
 */
export const slateDocId = (k: SlateKey): string => `${k.season}_${k.seasonType}_${k.week}`;

/** Group a window query's results into the slates they belong to. */
export function slateKeysOf(games: Pick<StoredGame, 'season' | 'seasonType' | 'week'>[]): SlateKey[] {
  const out = new Map<string, SlateKey>();
  for (const g of games) {
    const season = String(g.season ?? '');
    const seasonType = Number(g.seasonType);
    const week = Number(g.week);
    if (!season || !Number.isInteger(seasonType) || !Number.isInteger(week)) continue;
    const key = { season, seasonType, week };
    out.set(slateId(key), key);
  }
  return [...out.values()];
}

export interface SlateDueVerdict {
  due: boolean;
  reason: string;
  /** Earliest kickoff across the WHOLE stored slate, 0 when the slate is empty. */
  firstKickoffMs: number;
}

/**
 * Is this slate the one this run should freeze?
 *
 * Measured against the earliest kickoff of the FULL STORED SLATE, never against
 * the subset a window query returned — a slate is one thing that freezes at one
 * instant, and judging it by a partial view is how it ends up frozen across two.
 *
 * `alreadyFrozen` is the caller's answer to "does any `nfl_frozen_spreads`
 * record exist for this slate". It is deliberately not derivable here: under
 * Revision 1 the marker lives in a different collection, and 1.1's original test
 * read `nfl_games.spread.frozenAt`, which this revision never writes — leaving it
 * that way resurrected the round-7 re-freeze defect by moving the data (codex
 * round 5 on the revision).
 */
export function slateIsDue(
  slate: StoredGame[],
  now: number,
  alreadyFrozen: boolean,
  horizonMs: number = FREEZE_HORIZON_MS,
): SlateDueVerdict {
  if (slate.length === 0) return { due: false, reason: 'no games stored for this slate', firstKickoffMs: 0 };

  const kickoffs = slate.map((g) => Number(g.startTime)).filter((t) => Number.isFinite(t));
  if (kickoffs.length === 0) return { due: false, reason: 'no usable kickoff times', firstKickoffMs: 0 };
  const firstKickoffMs = Math.min(...kickoffs);

  if (alreadyFrozen) {
    // Permanently, and that is the point. Anything after the first freeze is a
    // correction, and corrections go through the audited override — never
    // through a second freeze.
    return { due: false, reason: 'already frozen', firstKickoffMs };
  }
  if (firstKickoffMs <= now) {
    return { due: false, reason: 'first kickoff has passed', firstKickoffMs };
  }
  if (firstKickoffMs > now + horizonMs) {
    return {
      due: false,
      reason: `first kickoff is beyond the ${Math.round(horizonMs / 86_400_000)}-day freeze horizon`,
      firstKickoffMs,
    };
  }
  return { due: true, reason: 'due', firstKickoffMs };
}

/** Pick the slate this run should freeze: the earliest DUE one. */
export function chooseSlate(
  candidates: { key: SlateKey; verdict: SlateDueVerdict }[],
): { key: SlateKey; verdict: SlateDueVerdict } | null {
  const due = candidates.filter((c) => c.verdict.due);
  if (due.length === 0) return null;
  return due.reduce((a, b) => (b.verdict.firstKickoffMs < a.verdict.firstKickoffMs ? b : a));
}

export interface PlannedFreeze {
  gameId: string;
  value: number;
  /** Where the number came from, for the dry-run report and the run log. */
  from: 'feed' | 'working';
}

export type FreezePlan =
  | { ok: true; writes: PlannedFreeze[] }
  | {
      ok: false;
      reason: string;
      /** Stored games the fetch did not return — ESPN dropped an event. */
      missingFromFetch: string[];
      /** Fetched games not stored — the slate changed under us. */
      unexpectedInFetch: string[];
      /** Games with neither a feed line nor a stored working line. */
      noLine: string[];
    };

const usable = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Turn a stored slate plus a fetch into the exact set of writes, or into a
 * refusal that names what is wrong.
 *
 * ⚠️ `fetched` MUST ALREADY BE FILTERED TO THE TARGET SLATE. `parseScoreboardResponse`
 * stamps each game with `eventWeekNumber(event, week)` — ESPN's own answer wins
 * over the requested week — and ESPN's scoreboard endpoint is unreliable about
 * which slate it returns for a given `week` param (an import of one week returned
 * 20 events spanning two slates, measured 2026-08-19). Reconciling an unfiltered
 * response against one stored slate would report the neighbouring week's games as
 * `unexpectedInFetch` and refuse every single Tuesday. The filter happens here so
 * no caller can forget it.
 *
 * ⚠️ THE PER-GAME FALLBACK IS THE MANUAL BACKSTOP AND IT IS NOT OPTIONAL (codex
 * round 4 on the revision). The freeze fetches ESPN; the override only corrects a
 * record that already exists. Without a fallback to the stored working line there
 * would be nothing that turns operator-entered values into frozen records, so a
 * gap week — the preseason case that actually happened on 2026-08-19 — would block
 * ATS submission indefinitely, with the backstop that has carried every week so
 * far quietly removed.
 */
export function planFreeze(key: SlateKey, stored: StoredGame[], fetched: FetchedGame[]): FreezePlan {
  const onSlate = fetched.filter(
    (g) => String(g.season) === key.season && Number(g.seasonType) === key.seasonType && Number(g.week) === key.week,
  );

  const storedIds = stored.map((g) => g.id);
  const fetchedById = new Map(onSlate.map((g) => [g.id, g]));

  const missingFromFetch = storedIds.filter((id) => !fetchedById.has(id));
  const unexpectedInFetch = [...fetchedById.keys()].filter((id) => !storedIds.includes(id));

  if (missingFromFetch.length > 0 || unexpectedInFetch.length > 0) {
    return {
      ok: false,
      reason:
        'the fetched slate does not match the stored slate — a partially frozen week is what the requirement forbids, ' +
        'so nothing is written',
      missingFromFetch,
      unexpectedInFetch,
      noLine: [],
    };
  }

  if (stored.length === 0) {
    return { ok: false, reason: 'the stored slate is empty', missingFromFetch: [], unexpectedInFetch: [], noLine: [] };
  }
  if (stored.length > MAX_GAMES_PER_FREEZE) {
    return {
      ok: false,
      reason: `the slate has ${stored.length} games, past the ${MAX_GAMES_PER_FREEZE} per-freeze cap — refusing rather than truncating`,
      missingFromFetch: [],
      unexpectedInFetch: [],
      noLine: [],
    };
  }

  const writes: PlannedFreeze[] = [];
  const noLine: string[] = [];
  for (const game of stored) {
    const feed = fetchedById.get(game.id)?.spread?.value;
    if (usable(feed)) {
      writes.push({ gameId: game.id, value: feed, from: 'feed' });
      continue;
    }
    const working = game.spread?.value;
    if (usable(working)) {
      writes.push({ gameId: game.id, value: working, from: 'working' });
      continue;
    }
    noLine.push(game.id);
  }

  if (noLine.length > 0) {
    return {
      ok: false,
      reason: `${noLine.length} of ${stored.length} game(s) have neither a feed line nor a stored working line`,
      missingFromFetch: [],
      unexpectedInFetch: [],
      noLine,
    };
  }

  return { ok: true, writes };
}

// ---------------------------------------------------------------------------
// The stated instant
// ---------------------------------------------------------------------------
//
// 1.6 promises members a day and a time: Tuesday 09:00 ET. A LIVE manual freeze
// (1.5b) could otherwise commit a slate permanently on the Sunday before, and the
// scheduled run would then skip it as already frozen — the stated cutoff quietly
// not honoured, by the tool built to repair it (codex r6 on PR 2).
//
// The rule that falls out is narrow and needs no escape hatch: a live freeze is
// allowed at or after the slate's OWN stated cutoff, never before it. That admits
// the scheduled run (which fires exactly at the cutoff) and every legitimate
// repair after a refusal — Tuesday afternoon, Wednesday, Saturday — and refuses
// only the one case that breaks the promise.

/** The freeze's stated weekday, as `Date#getUTCDay` numbers it. */
const TUESDAY = 2;
/** The freeze's stated hour, America/New_York wall clock. */
const CUTOFF_HOUR_ET = 9;
const DAY_MS = 24 * 60 * 60 * 1000;

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** An instant's wall-clock fields as read in America/New_York. */
function etParts(at: number): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const p: Record<string, string> = {};
  for (const part of ET_PARTS.formatToParts(new Date(at))) p[part.type] = part.value;
  // `hour12: false` renders midnight as "24" in some ICU versions; normalise it.
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
}

/**
 * The epoch of a given America/New_York wall clock.
 *
 * Two correction passes rather than one: the first guess uses the offset at the
 * WRONG instant, and on a DST changeover day that offset is off by an hour, so a
 * single pass lands sixty minutes out. Iterating settles it. There is no `tz`
 * dependency in this repo and this is the only place that needs one.
 */
function etWallClockToEpoch(y: number, m: number, d: number, h: number): number {
  const target = Date.UTC(y, m - 1, d, h);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = etParts(guess);
    guess += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  }
  return guess;
}

/**
 * The latest Tuesday 09:00 America/New_York STRICTLY before `before`.
 *
 * `Number.NEGATIVE_INFINITY` if none is found within nine days, which cannot
 * happen — it is there so a malformed input degrades to "the cutoff has passed"
 * rather than blocking a repair on a date bug.
 */
export function statedCutoffBefore(before: number): number {
  if (!Number.isFinite(before)) return Number.NEGATIVE_INFINITY;
  for (let back = 0; back <= 8; back++) {
    const p = etParts(before - back * DAY_MS);
    if (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() !== TUESDAY) continue;
    const cutoff = etWallClockToEpoch(p.y, p.m, p.d, CUTOFF_HOUR_ET);
    if (cutoff < before) return cutoff;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * May a LIVE freeze of this slate run right now?
 *
 * Dry runs are unrestricted — rehearsing on a Sunday is exactly what 1.5b exists
 * for, and a dry run writes nothing.
 */
export function liveFreezeAllowed(firstKickoffMs: number, now: number): { allowed: boolean; cutoffMs: number } {
  const cutoffMs = statedCutoffBefore(firstKickoffMs);
  return { allowed: now >= cutoffMs, cutoffMs };
}
