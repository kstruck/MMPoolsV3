/**
 * The shape every squares pool document must have (PLAN-SQUARES-REOPEN C0).
 * PURE — no Firebase.
 *
 * WHY THIS FILE EXISTS. The squares pages were written when a pool was created
 * in the browser from one big default object, so they read
 * `pool.ruleVariations.quarterlyRollover`, `pool.payouts.q1`, `pool.scores.q1`
 * and a dozen more with no guard. The create wizard that replaced that flow
 * sends a small payload, and the server added only the grid, the scores and the
 * payouts — so a pool created by the wizard had no `ruleVariations` at all and
 * **its own page threw on load**. Nobody saw it because squares creation was
 * closed before a wizard-created pool was ever opened.
 *
 * Fixed at both ends, from this one file:
 *   - `createPool` seeds a complete document (`squaresCreateDefaults`);
 *   - the pages read through `withSquaresDefaults`, so a document that is
 *     missing a piece for any other reason still renders.
 *
 * 🛑 A DEFAULT HERE IS WHAT THE SERVER ENFORCES FOR A MISSING VALUE — never a
 * nicer-looking guess. The payout math (`squaresPayouts.ts`) reads a missing
 * rule as OFF and a missing percentage as 0; the claim path reads a missing cap
 * as no limit. A page that filled in "rollover on" or "25% a quarter" for a
 * document that does not say so would show members a prize the server will not
 * record.
 */

export type UnclaimedFinalPrizeStrategy = 'last_winner' | 'random';

export interface SquaresRuleVariations {
  reverseWinners: boolean;
  quarterlyRollover: boolean;
  scoreChangePayout: boolean;
  unclaimedFinalPrizeStrategy: UnclaimedFinalPrizeStrategy;
  [extra: string]: unknown;
}

/** What a rule reads as when the document does not carry it: OFF. */
export const SQUARES_RULES_WHEN_ABSENT: Readonly<SquaresRuleVariations> = Object.freeze({
  reverseWinners: false,
  quarterlyRollover: false,
  scoreChangePayout: false,
  unclaimedFinalPrizeStrategy: 'last_winner',
});

export interface SquaresPayoutSplit { q1: number; half: number; q3: number; final: number }

/** What a NEW pool is created with when the commissioner sets nothing. Sums to 100. */
export const SQUARES_DEFAULT_PAYOUTS: Readonly<SquaresPayoutSplit> = Object.freeze({ q1: 25, half: 25, q3: 25, final: 25 });

const PERIODS = ['q1', 'half', 'q3', 'final'] as const;

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * A payout split a commissioner asked for, or `null` if it is not one.
 *
 * Four whole-or-fractional percentages, none negative, that add up to exactly
 * 100. Anything else is refused rather than repaired: a split that pays 90% or
 * 120% of the pot is a mistake the commissioner should see, not one to round.
 */
export function validSquaresPayouts(raw: unknown): SquaresPayoutSplit | null {
  const o = asObject(raw);
  const out = { q1: 0, half: 0, q3: 0, final: 0 };
  for (const p of PERIODS) {
    const n = finite(o[p]);
    // No upper bound is needed: nothing is negative and the four total 100,
    // so none can exceed it. (A separate `> 100` check here was dead code — a
    // mutation test removed it and nothing changed.)
    if (n === null || n < 0) return null;
    out[p] = n;
  }
  const total = out.q1 + out.half + out.q3 + out.final;
  return Math.abs(total - 100) < 1e-9 ? out : null;
}

/** The rules as stored, with every missing one read as OFF. Unknown keys are kept. */
export function squaresRules(raw: unknown): SquaresRuleVariations {
  const o = asObject(raw);
  return {
    ...SQUARES_RULES_WHEN_ABSENT,
    ...o,
    reverseWinners: o.reverseWinners === true,
    quarterlyRollover: o.quarterlyRollover === true,
    scoreChangePayout: o.scoreChangePayout === true,
    unclaimedFinalPrizeStrategy: o.unclaimedFinalPrizeStrategy === 'random' ? 'random' : 'last_winner',
  };
}

export interface SquaresCharity { enabled: boolean; name: string; percentage: number; [extra: string]: unknown }

/** Charity as stored; off, at 0%, when absent. The percentage is held to 0–100. */
export function squaresCharity(raw: unknown): SquaresCharity {
  const o = asObject(raw);
  const pct = finite(o.percentage) ?? 0;
  return {
    ...o,
    enabled: o.enabled === true,
    name: typeof o.name === 'string' ? o.name : '',
    percentage: Math.min(100, Math.max(0, pct)),
  };
}

/**
 * A team badge as the score feed serves it: an https image on ESPN's CDN.
 *
 * The create payload carries the badge of the game the commissioner picked, and
 * the pool page puts it in an `<img>` for every visitor. Accepting any string
 * there would let a commissioner point every member's browser at a URL of their
 * choosing, so nothing else is storable.
 */
const FEED_LOGO = /^https:\/\/[a-z0-9-]+\.espncdn\.com\/[\w\-./%]+$/i;
export function isFeedLogoUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 300 && FEED_LOGO.test(v);
}

const EMPTY_SCORES = Object.freeze({ current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' });

const emptyGrid = () => Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null as string | null }));

/**
 * A squares pool document made safe to render.
 *
 * Every nested object the pages dereference is present afterwards, and every
 * value that was missing reads the way the server treats it. Values that ARE on
 * the document are never changed — this fills holes, it does not correct data.
 */
export function withSquaresDefaults<T extends Record<string, unknown>>(pool: T): T & {
  ruleVariations: SquaresRuleVariations;
  payouts: SquaresPayoutSplit;
  charity: SquaresCharity;
  scores: Record<string, unknown>;
  squares: Array<Record<string, unknown>>;
  scoreEvents: unknown[];
  numberSets: number;
  costPerSquare: number;
  maxSquaresPerPlayer: number;
  homeTeam: string;
  awayTeam: string;
} {
  const payouts = asObject(pool.payouts);
  // The SAME array when it is already a full grid: the grid component keys
  // effects and memos on its identity, and a fresh copy per render would re-run
  // all of them.
  const stored = Array.isArray(pool.squares) ? (pool.squares as unknown[]) : null;
  const intact = !!stored && stored.length === 100 && stored.every((s) => !!s && typeof s === 'object');
  const squares = intact
    ? (stored as Array<Record<string, unknown>>)
    : emptyGrid().map((empty, i) => {
      const s = stored?.[i];
      return s && typeof s === 'object' ? (s as Record<string, unknown>) : empty;
    });
  return {
    ...pool,
    ruleVariations: squaresRules(pool.ruleVariations),
    payouts: {
      q1: finite(payouts.q1) ?? 0,
      half: finite(payouts.half) ?? 0,
      q3: finite(payouts.q3) ?? 0,
      final: finite(payouts.final) ?? 0,
    },
    charity: squaresCharity(pool.charity),
    scores: { ...EMPTY_SCORES, ...asObject(pool.scores) },
    squares,
    scoreEvents: Array.isArray(pool.scoreEvents) ? pool.scoreEvents : [],
    numberSets: pool.numberSets === 4 ? 4 : 1,
    costPerSquare: finite(pool.costPerSquare) ?? 0,
    maxSquaresPerPlayer: finite(pool.maxSquaresPerPlayer) ?? 0,
    homeTeam: typeof pool.homeTeam === 'string' ? pool.homeTeam : '',
    awayTeam: typeof pool.awayTeam === 'string' ? pool.awayTeam : '',
  };
}

/** A game as a picker hands it over (`ScheduleGame` in the client's schedule service). */
export interface LinkableGame {
  id: string;
  /** Kickoff, epoch ms. */
  kickoff: number;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  seasonType?: '1' | '2' | '3';
  week?: number;
}

/**
 * What linking an EXISTING pool to a game writes — from the manage page.
 *
 * The same link `squaresCreateDefaults` makes at creation, so a pool linked
 * afterwards behaves exactly like one linked in the wizard: scored from the
 * feed, and LOCKED AT KICKOFF. The manage page's own version of this set the
 * lock to fifteen minutes before kickoff, did not say so anywhere, left the
 * lock's on/off switch as it found it, and — when the pool had no reminder
 * settings yet — switched on payment-reminder emails to every player as a side
 * effect of choosing a game.
 *
 * Other reminder settings are left exactly as they are. Nothing is switched on
 * except the kickoff lock; a pool with no reminder settings gets that and
 * nothing else.
 */
export function squaresGameLink(
  game: LinkableGame,
  league: 'nfl' | 'college',
  existing: { reminders?: unknown; scores?: unknown; gameId?: unknown } = {},
): Record<string, unknown> | null {
  const id = typeof game.id === 'string' ? game.id.trim() : '';
  const kickoff = finite(game.kickoff);
  // The id is the score feed's event id — digits (see the create schema).
  if (!/^\d{1,15}$/.test(id) || kickoff === null || kickoff <= 0) return null;

  const reminders = asObject(existing.reminders);
  const lock = asObject(reminders.lock);
  const patch: Record<string, unknown> = {
    gameId: id,
    gameTime: kickoff,
    league: league === 'college' ? 'college' : 'nfl',
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    reminders: {
      ...reminders,
      lock: {
        scheduleMinutes: Array.isArray(lock.scheduleMinutes) ? lock.scheduleMinutes : [],
        ...lock,
        enabled: true,
        lockAt: kickoff,
      },
    },
    // Scores belong to ONE game (codex, PR #760). Re-linking the same game
    // keeps what it has; any other game — or a pool that had none — starts
    // from nothing. Carrying another game's scores kept its final and its
    // status: the score sync skips a pool whose status is 'post', so the new
    // game would never be scored, and the claim check would call it started.
    scores: {
      ...EMPTY_SCORES,
      ...(existing.gameId === id ? asObject(existing.scores) : {}),
      startTime: new Date(kickoff).toISOString(),
    },
  };
  // A badge that is not the feed's own is not written; the page falls back to the name.
  if (isFeedLogoUrl(game.homeLogo)) patch.homeTeamLogo = game.homeLogo;
  if (isFeedLogoUrl(game.awayLogo)) patch.awayTeamLogo = game.awayLogo;
  if (game.seasonType === '1' || game.seasonType === '2' || game.seasonType === '3') patch.seasonType = game.seasonType;
  if (Number.isInteger(game.week) && (game.week as number) > 0) patch.week = game.week;
  return patch;
}

/**
 * What `createPool` writes onto a NEW squares pool, from what the wizard sent.
 *
 * `requestedPayouts` is the wizard's split. An invalid one is the caller's to
 * refuse BEFORE calling this (the create schema does); here it falls back to
 * the even split so a pool can never be created paying 0%.
 *
 * A linked game brings its kickoff with it: the grid locks itself then
 * (`reminders.lock`, read by `autoLockPools`), and the score sync has a start
 * time to work from. An unlocked grid at kickoff is the worst failure a squares
 * pool has — squares still on sale while the game is played.
 */
export function squaresCreateDefaults(input: {
  requestedPayouts?: unknown;
  ruleVariations?: unknown;
  charity?: unknown;
  reminders?: unknown;
  gameId?: unknown;
  gameTime?: unknown;
  numberSets?: unknown;
}): {
  payouts: SquaresPayoutSplit;
  ruleVariations: SquaresRuleVariations;
  charity: SquaresCharity;
  scoreEvents: never[];
  numberSets: number;
  scores: Record<string, unknown>;
  reminders?: Record<string, unknown>;
} {
  const kickoff = finite(input.gameTime);
  const linked = typeof input.gameId === 'string' && input.gameId.trim() !== '' && kickoff !== null && kickoff > 0;

  const out: ReturnType<typeof squaresCreateDefaults> = {
    payouts: validSquaresPayouts(input.requestedPayouts) ?? { ...SQUARES_DEFAULT_PAYOUTS },
    ruleVariations: squaresRules(input.ruleVariations),
    charity: squaresCharity(input.charity),
    scoreEvents: [],
    numberSets: Number(input.numberSets) === 4 ? 4 : 1,
    scores: { ...EMPTY_SCORES, ...(linked ? { startTime: new Date(kickoff as number).toISOString() } : {}) },
  };

  if (linked) {
    const reminders = asObject(input.reminders);
    const lock = asObject(reminders.lock);
    out.reminders = {
      ...reminders,
      lock: {
        // No "locking soon" emails unless the commissioner sets some up later.
        scheduleMinutes: Array.isArray(lock.scheduleMinutes) ? lock.scheduleMinutes : [],
        ...lock,
        enabled: true,
        lockAt: kickoff,
      },
    };
  }
  return out;
}

/**
 * HOW FAR AHEAD OF ITS LOCK TIME A SQUARES GRID IS LOCKED.
 *
 * The lock job (`autoLockPools`) runs once a minute and locks a grid as soon as
 * its lock time is within this lead — so a grid locks somewhere between this
 * long before its lock time and half a minute after it. It was 90 seconds
 * while a second, biased auto-lock had to be beaten to the grid; that copy is
 * gone (plan K7, `functions/src/autoLock.ts`).
 *
 * It lives here, not in the job, because THE PAGE HAS TO TELL PLAYERS THE SAME
 * THING THE JOB DOES. The pool page showed the stored lock time — kickoff — as
 * "Grid locks", and the grid locked ahead of it: a player who came back at the
 * last minute could find it shut (qodo, PR #761).
 * The job and the page read this one number; change it and both move.
 */
export const SQUARES_LOCK_LEAD_MS = 30_000;

/** Epoch ms from the shapes a stored lock time has had: a number, a Firestore Timestamp, a date string. */
function lockTimeMs(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let ms: number;
  if (typeof raw === 'number') ms = raw;
  else if (typeof raw === 'object' && typeof (raw as { toMillis?: unknown }).toMillis === 'function') ms = (raw as { toMillis: () => number }).toMillis();
  else if (raw instanceof Date) ms = raw.getTime();
  else if (typeof raw === 'string') ms = new Date(raw).getTime();
  else return null;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * WHEN PICKS CLOSE on a grid that locks itself — the moment to show a player.
 *
 * The stored lock time less the lead: the EARLIEST the job can lock the grid.
 * It may stay open up to a minute longer, never less, so a deadline shown from
 * this is one the grid always keeps. (Past that, the server still refuses a
 * claim once the game itself has started.) `null` when the grid will not lock itself
 * (the lock is off, or has no usable time) — then there is no deadline to show.
 */
export function squaresPicksCloseMs(pool: unknown): number | null {
  const lock = asObject(asObject(asObject(pool).reminders).lock);
  if (lock.enabled !== true) return null;
  const at = lockTimeMs(lock.lockAt);
  return at === null ? null : at - SQUARES_LOCK_LEAD_MS;
}

