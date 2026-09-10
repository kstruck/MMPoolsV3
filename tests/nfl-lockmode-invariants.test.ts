import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  nflLockMode, usesWeeklyLock, weekLockOverrideFor, gameLockAt, weekLockAtFor, nextLockAtFor,
  dropStaleLockedPicks, dropStaleLockedWeights, isGameLockedFor, isWeekLockedFor, confidenceSlateFor,
  LOCK_RULE_VERSION,
} from '../shared/nflLockMode';
// The server's copy of the arithmetic. `functions/src/shared/` is the copy-shared
// output, so this resolves after `node functions/scripts/copy-shared.mjs` (which
// `npm test` runs first).
import * as server from '../functions/src/lib/effectiveLock';

/**
 * The lock rule, and the guard that it stays the SAME rule on both sides.
 *
 * A `PER_GAME` Pick'em pool — the wizard default — used to lock its whole pick
 * sheet at the week's first kickoff, because `NFLPoolDashboard` derived one
 * week-level lock from the earliest kickoff for every NFL type and
 * `PickemPickEntry` treated that flag as "every game is locked". The server
 * disagreed and would have accepted a later pick, so the manager's `lockMode`
 * choice did nothing a member could see.
 *
 * Kevin's ruling, 2026-08-18: **the pool manager makes the decision on that
 * option and the site must abide by that option selection.** So the rule is one
 * function now, and this file holds it to the server's copy of it.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

describe('nflLockMode — the rule', () => {
  it('Survivor and Margin are WEEKLY from the pool TYPE, whatever settings say', () => {
    for (const type of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(nflLockMode(type, { lockMode: 'PER_GAME' })).toBe('WEEKLY');
      expect(nflLockMode(type, { lockMode: 'PER_GAME', confidenceMode: false })).toBe('WEEKLY');
      expect(nflLockMode(type, undefined)).toBe('WEEKLY');
    }
  });

  it("Pick'em honours the manager's choice", () => {
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME' })).toBe('PER_GAME');
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'WEEKLY' })).toBe('WEEKLY');
  });

  it('LEGACY: an unstamped confidence pool still forces WEEKLY while lockMode reads PER_GAME', () => {
    // PLAN-CONFIDENCE-PER-GAME-LOCK: the old rule survives for any confidence
    // pool the backfill has not stamped, so the functions deploy is safe before
    // the backfill runs (codex r1 #3). Absent, stale, or junk stamps all count.
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: true })).toBe('WEEKLY');
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: true, lockRuleVersion: 1 })).toBe('WEEKLY');
    expect(nflLockMode('NFL_PICKEM', { confidenceMode: true, lockRuleVersion: 2 as never, lockMode: undefined })).toBe('PER_GAME');
  });

  it("STAMPED: a confidence pool honours the manager's lockMode — per game locks each pick AND weight", () => {
    expect(LOCK_RULE_VERSION).toBe(2);
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: true, lockRuleVersion: 2 })).toBe('PER_GAME');
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'WEEKLY', confidenceMode: true, lockRuleVersion: 2 })).toBe('WEEKLY');
    // The stamp changes nothing for a straight pool.
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: false })).toBe('PER_GAME');
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: false, lockRuleVersion: 2 })).toBe('PER_GAME');
    // Nor for the hard-lock types, stamped or not.
    expect(nflLockMode('NFL_SURVIVOR', { lockMode: 'PER_GAME', lockRuleVersion: 2 })).toBe('WEEKLY');
    expect(nflLockMode('NFL_MARGIN', { lockMode: 'PER_GAME', confidenceMode: true, lockRuleVersion: 2 })).toBe('WEEKLY');
  });

  it('an absent lockMode is PER_GAME, matching the server default', () => {
    // `submitNFLPicks` computes `confidenceMode || lockMode === 'WEEKLY'`, so a
    // pool with neither field set locks per game. The wizard writes PER_GAME
    // explicitly; legacy pools may carry nothing.
    expect(nflLockMode('NFL_PICKEM', {})).toBe('PER_GAME');
    expect(nflLockMode('NFL_PICKEM', undefined)).toBe('PER_GAME');
  });

  it('usesWeeklyLock agrees with nflLockMode', () => {
    expect(usesWeeklyLock('NFL_PICKEM', { lockMode: 'WEEKLY' })).toBe(true);
    expect(usesWeeklyLock('NFL_PICKEM', { lockMode: 'PER_GAME' })).toBe(false);
  });
});

describe('weekLockOverrideFor', () => {
  const pool = (type: string, overrides: Record<string | number, unknown>) => ({
    type,
    settings: { weekLockOverrides: overrides },
  });

  it("reads a Pick'em override, by number or string key", () => {
    expect(weekLockOverrideFor(pool('NFL_PICKEM', { 3: 1234 }), 3)).toBe(1234);
    expect(weekLockOverrideFor(pool('NFL_PICKEM', { '3': 1234 }), 3)).toBe(1234);
  });

  it('drops an override on a hard-lock pool, because the server does', () => {
    // `extendWeekDeadline` refuses Survivor and Margin outright
    // (HARD_WEEKLY_LOCK) and `proxyPick` ignores a stored one. Honouring it here
    // would open a sheet the server keeps shut.
    expect(weekLockOverrideFor(pool('NFL_SURVIVOR', { 3: 1234 }), 3)).toBeUndefined();
    expect(weekLockOverrideFor(pool('NFL_MARGIN', { 3: 1234 }), 3)).toBeUndefined();
  });

  it('ignores junk and absent weeks', () => {
    expect(weekLockOverrideFor(pool('NFL_PICKEM', { 3: 'soon' }), 3)).toBeUndefined();
    expect(weekLockOverrideFor(pool('NFL_PICKEM', { 3: Number.NaN }), 3)).toBeUndefined();
    expect(weekLockOverrideFor(pool('NFL_PICKEM', {}), 3)).toBeUndefined();
    expect(weekLockOverrideFor(undefined, 3)).toBeUndefined();
  });
});

describe('gameLockAt', () => {
  it('is kickoff minus the buffer', () => {
    expect(gameLockAt(10 * 60_000, 5)).toBe(5 * 60_000);
  });

  it('an override may only move it LATER, never earlier', () => {
    // Matches `effectiveGameLockAt`'s Math.max. An override that landed EARLIER
    // would close picks a member still had time for.
    expect(gameLockAt(10 * 60_000, 5, 9 * 60_000)).toBe(9 * 60_000);
    expect(gameLockAt(10 * 60_000, 5, 1 * 60_000)).toBe(5 * 60_000);
  });

  it('with the kickoff ceiling an override stops AT kickoff (confidence pools, plan §3.2a)', () => {
    // Kevin, 2026-09-10: "any confidence pick for a game that has started can
    // not be changed under any circumstances" — so the exception path that lets
    // a straight pool reopen a started game is capped at kickoff here.
    expect(gameLockAt(10 * 60_000, 5, 30 * 60_000, true)).toBe(10 * 60_000);
    expect(gameLockAt(10 * 60_000, 5, 30 * 60_000, false)).toBe(30 * 60_000);
    // Below kickoff the ceiling is inert: a shrunk buffer still moves the lock later.
    expect(gameLockAt(10 * 60_000, 0, undefined, true)).toBe(10 * 60_000);
    expect(gameLockAt(10 * 60_000, 5, 8 * 60_000, true)).toBe(8 * 60_000);
  });
});

describe('isGameLockedFor / isWeekLockedFor — the pool-aware readers', () => {
  const NOW = 100 * 60_000;
  const g = (id: string, startTime: number, status = 'SCHEDULED') => ({ id, startTime, status });
  const conf = (lockMode: string, extra: Record<string, unknown> = {}) => ({
    type: 'NFL_PICKEM',
    settings: { confidenceMode: true, lockRuleVersion: 2, lockMode, lockBufferMinutes: 5, ...extra },
  });

  it('PER_GAME confidence: each game on its own clock', () => {
    const wed = g('wed', NOW - 60_000);
    const sun = g('sun', NOW + 60 * 60_000);
    const pool = conf('PER_GAME');
    expect(isGameLockedFor(pool, 1, wed, [wed, sun], NOW)).toBe(true);
    expect(isGameLockedFor(pool, 1, sun, [wed, sun], NOW)).toBe(false);
    expect(isWeekLockedFor(pool, 1, [wed, sun], NOW)).toBe(false); // week closes at the LAST kickoff
  });

  it('WEEKLY confidence: the first kickoff closes every game', () => {
    const wed = g('wed', NOW - 60_000);
    const sun = g('sun', NOW + 60 * 60_000);
    const pool = conf('WEEKLY');
    expect(isGameLockedFor(pool, 1, sun, [wed, sun], NOW)).toBe(true);
    expect(isWeekLockedFor(pool, 1, [wed, sun], NOW)).toBe(true);
  });

  it('status beats the clock in a confidence pool, and only there (codex r2 #1)', () => {
    const live = g('live', NOW + 2 * 60 * 60_000, 'IN_PROGRESS'); // feed moved it LATER
    const pool = conf('PER_GAME');
    expect(isGameLockedFor(pool, 1, live, [live], NOW)).toBe(true);
    expect(isWeekLockedFor(conf('WEEKLY'), 1, [live], NOW)).toBe(true);
    const straight = { type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME', lockBufferMinutes: 5 } };
    expect(isGameLockedFor(straight, 1, live, [live], NOW)).toBe(false);
  });

  it('an extension cannot reopen a started game in a confidence pool (codex r1 #1)', () => {
    const wed = g('wed', NOW - 60_000);
    const thu = g('thu', NOW + 24 * 60 * 60_000);
    const pool = conf('PER_GAME', { weekLockOverrides: { 1: NOW + 48 * 60 * 60_000 } });
    expect(isGameLockedFor(pool, 1, wed, [wed, thu], NOW)).toBe(true);   // started: stays shut
    expect(isGameLockedFor(pool, 1, thu, [wed, thu], NOW + 25 * 60 * 60_000)).toBe(true); // ceiling at ITS kickoff
    expect(isGameLockedFor(pool, 1, thu, [wed, thu], NOW + 23 * 60 * 60_000)).toBe(false);
  });
});

describe('confidenceSlateFor — D2: a missed game forfeits the HIGHEST weight', () => {
  const games = Array.from({ length: 16 }, (_, i) => ({ id: `g${i}`, startTime: i, status: 'SCHEDULED' }));
  const lockedIds = (ids: string[]) => (game: { id: string }) => ids.includes(game.id);

  it('full slate, nothing missed → 1..16', () => {
    const s = confidenceSlateFor(games, {}, lockedIds([]));
    expect(s).toMatchObject({ missedIds: [], minValue: 1, maxValue: 16 });
    expect(s.slateIds).toHaveLength(16);
  });

  it('one locked game never picked → the 16 is gone (Kevin: "they would lose 16")', () => {
    const s = confidenceSlateFor(games, {}, lockedIds(['g0']));
    expect(s).toMatchObject({ missedIds: ['g0'], minValue: 1, maxValue: 15 });
  });

  it('two missed of 16 → 1..14; 12-game week, one missed → 5..15', () => {
    expect(confidenceSlateFor(games, {}, lockedIds(['g0', 'g1']))).toMatchObject({ minValue: 1, maxValue: 14 });
    const twelve = games.slice(0, 12);
    expect(confidenceSlateFor(twelve, {}, lockedIds(['g0']))).toMatchObject({ minValue: 5, maxValue: 15 });
  });

  it('a locked game the member DID pick is not a miss', () => {
    const s = confidenceSlateFor(games, { g0: 'SEA' }, lockedIds(['g0']));
    expect(s).toMatchObject({ missedIds: [], minValue: 1, maxValue: 16 });
  });

  it('a weight frozen on a locked pick is grandfathered; a later miss forfeits the top value still OPEN (codex r5)', () => {
    // 16 locked in on Wednesday, then Sunday's early game missed: the 16 stays
    // theirs, the 15 is what the miss costs, and the open games take 1..14.
    const s = confidenceSlateFor(games, { g0: 'SEA' }, lockedIds(['g0', 'g1']), { g0: 16 });
    expect(s.missedIds).toEqual(['g1']);
    expect(s.frozenValues).toEqual([16]);
    expect(s.availableValues[0]).toBe(14);
    expect(s.availableValues).not.toContain(16);
    expect(s.availableValues).not.toContain(15);
    expect(s).toMatchObject({ minValue: 1, maxValue: 14 });
    // No miss: the open games take everything but the frozen 16.
    const noMiss = confidenceSlateFor(games, { g0: 'SEA' }, lockedIds(['g0']), { g0: 16 });
    expect(noMiss.availableValues).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(noMiss.maxValue).toBe(15);
  });

  it('a CANCELLED game nobody picked leaves the slate; a picked one stays (codex r2 #5)', () => {
    const withCancel = games.map((g) => (g.id === 'g3' ? { ...g, status: 'CANCELLED' } : g));
    const unpicked = confidenceSlateFor(withCancel, {}, lockedIds(['g3']));
    expect(unpicked.slateIds).not.toContain('g3');
    expect(unpicked).toMatchObject({ missedIds: [], minValue: 2, maxValue: 16 }); // 15 games, k = 0
    const picked = confidenceSlateFor(withCancel, { g3: 'KC' }, lockedIds(['g3']));
    expect(picked.slateIds).toContain('g3');
    expect(picked).toMatchObject({ missedIds: [], minValue: 1, maxValue: 16 });
  });
});

describe('dropStaleLockedWeights mirrors dropStaleLockedPicks', () => {
  it('drops a locked weight that differs from the saved one, keeps a matching one', () => {
    const r = dropStaleLockedWeights(['a', 'b', 'c'], { a: 16, b: 15, c: 14 }, { a: 16, b: 1 }, (id) => id !== 'c');
    expect(r.confidence).toEqual({ a: 16, c: 14 });
    expect(r.droppedGameIds).toEqual(['b']);
  });
});

/**
 * The client's rule and the server's are two files that must agree. Nothing
 * imports across that boundary, so this reads the server source and fails when
 * its expression changes shape.
 *
 * A test that merely asserted our own function would have passed happily
 * throughout the entire period the bug was live — the client was wrong, not the
 * rule. What was missing was anything comparing the two.
 */
describe('the server IMPORTS the rule instead of restating it (PLAN-CONFIDENCE-PER-GAME-LOCK T2)', () => {
  // Until 2026-09-10 these three files each carried a hand-written copy of the
  // expression and this test pinned the literal. Copies drift — two of them
  // had already dropped a clause once — so the rule is imported now, and the
  // guard flips: the literal must be ABSENT and the import PRESENT.
  const SERVER_READERS = [
    ['submit', 'functions/src/nflPools.ts'],
    ['reveal', 'functions/src/lib/pickReveal.ts'],
    ['proxyPick', 'functions/src/poolExceptions.ts'],
  ] as const;
  const HAND_COPIES = [
    /confidenceMode\s*\|\|\s*(settings|s)\??\.lockMode\s*===\s*['"]WEEKLY['"]/,
  ];

  it.each(SERVER_READERS)('%s imports nflLockMode from the shared file', (_label, file) => {
    const src = read(file);
    expect(src, `${file} must import nflLockMode from ./shared/nflLockMode`).toMatch(
      /import \{[^}]*\bnflLockMode\b[^}]*\} from ['"]\.{1,2}\/shared\/nflLockMode['"]/,
    );
    expect(src, `${file} must CALL nflLockMode(`).toContain('nflLockMode(');
  });

  it.each(SERVER_READERS)('%s carries no hand-written copy of the rule', (_label, file) => {
    const src = read(file);
    for (const re of HAND_COPIES) {
      expect(src, `${file} restates the lock rule by hand — import nflLockMode instead`).not.toMatch(re);
    }
  });

  /** The guard discriminates: a re-introduced hand copy is caught. */
  it('would catch a hand copy coming back', () => {
    const mutated = read('functions/src/nflPools.ts')
      + "\nconst weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';\n";
    expect(HAND_COPIES.some((re) => re.test(mutated))).toBe(true);
  });
});

/**
 * READER PARITY (codex r2 #4 on the plan): the client's `gameLockAt` and the
 * server's `effectiveGameLockAt` are two implementations of one instant. Run
 * both over one table of cases — buffer, override, the kickoff ceiling — and
 * fail on any disagreement.
 */
describe('client gameLockAt and server effectiveGameLockAt agree', () => {
  const KICK = 1_000_000_000;
  const cases: Array<{ name: string; buffer: number; override?: number; ceiling: boolean }> = [
    { name: 'plain buffer', buffer: 5, ceiling: false },
    { name: 'override later than buffer', buffer: 5, override: KICK - 60_000, ceiling: false },
    { name: 'override past kickoff, no ceiling (straight pool reopens)', buffer: 5, override: KICK + 3_600_000, ceiling: false },
    { name: 'override past kickoff, ceiling (confidence pool stops at kickoff)', buffer: 5, override: KICK + 3_600_000, ceiling: true },
    { name: 'zero buffer, ceiling', buffer: 0, ceiling: true },
    { name: 'wide buffer, ceiling', buffer: 60, ceiling: true },
  ];
  it.each(cases)('$name', ({ buffer, override, ceiling }) => {
    const client = gameLockAt(KICK, buffer, override, ceiling);
    const srv = server.effectiveGameLockAt(KICK, 3, {
      lockBufferMinutes: buffer,
      ...(override !== undefined ? { weekLockOverrides: { 3: override } } : {}),
      kickoffCeiling: ceiling,
    });
    expect(client).toBe(srv);
    if (ceiling) expect(client).toBeLessThanOrEqual(KICK);
  });

  it('status beats the clock on both sides in a confidence pool', () => {
    const settings = { lockBufferMinutes: 5, kickoffCeiling: true };
    const inProgressMovedLater = { startTime: Date.now() + 7_200_000, status: 'IN_PROGRESS' };
    expect(server.isGameLockedForGame(Date.now(), inProgressMovedLater, 3, settings)).toBe(true);
    const pool = { type: 'NFL_PICKEM', settings: { confidenceMode: true, lockRuleVersion: 2, lockMode: 'PER_GAME', lockBufferMinutes: 5 } };
    expect(isGameLockedFor(pool, 3, inProgressMovedLater, [inProgressMovedLater], Date.now())).toBe(true);
    // A straight pool keeps the clock rule.
    expect(server.isGameLockedForGame(Date.now(), inProgressMovedLater, 3, { lockBufferMinutes: 5 })).toBe(false);
  });
});

/**
 * THE DEFECT ITSELF, as behaviour rather than as source text.
 *
 * Sixteen games: Thursday 20:00, then fifteen on Sunday from 13:00 to 20:20.
 * A five-minute buffer. The bug was that the week reported itself locked at
 * 19:55 Thursday, closing every Sunday pick with it.
 */
describe('a PER_GAME week is not over until its LAST game starts', () => {
  const THU = Date.UTC(2026, 8, 10, 20, 0);
  const SUN_EARLY = Date.UTC(2026, 8, 13, 13, 0);
  const SUN_LATE = Date.UTC(2026, 8, 13, 20, 20);
  const SLATE = [THU, SUN_EARLY, SUN_LATE];
  const pickem = (settings: Record<string, unknown>) => ({ type: 'NFL_PICKEM', settings });

  it('closes at the LAST kickoff on PER_GAME', () => {
    const at = weekLockAtFor(pickem({ lockMode: 'PER_GAME', lockBufferMinutes: 5 }), 3, SLATE);
    expect(at).toBe(SUN_LATE - 5 * 60_000);
  });

  it('closes at the FIRST kickoff on WEEKLY', () => {
    const at = weekLockAtFor(pickem({ lockMode: 'WEEKLY', lockBufferMinutes: 5 }), 3, SLATE);
    expect(at).toBe(THU - 5 * 60_000);
  });

  /**
   * The regression, stated as the thing a member experiences. Reverting
   * `weekLockAtFor` to `Math.min(...gameStartTimes)` fails exactly this.
   */
  it('is still open on Sunday morning after Thursday night has kicked off', () => {
    const sundayMorning = Date.UTC(2026, 8, 13, 9, 0);
    const perGame = weekLockAtFor(pickem({ lockMode: 'PER_GAME', lockBufferMinutes: 5 }), 3, SLATE)!;
    expect(sundayMorning >= perGame).toBe(false);
    // And the discriminator: the same pool set to WEEKLY IS closed by then, so
    // this is not passing because the clock is simply early.
    const weekly = weekLockAtFor(pickem({ lockMode: 'WEEKLY', lockBufferMinutes: 5 }), 3, SLATE)!;
    expect(sundayMorning >= weekly).toBe(true);
  });

  it('confidence mode closes the week at the first kickoff even on PER_GAME', () => {
    const at = weekLockAtFor(
      pickem({ lockMode: 'PER_GAME', confidenceMode: true, lockBufferMinutes: 5 }), 3, SLATE,
    );
    expect(at).toBe(THU - 5 * 60_000);
  });

  it('an extension moves the week deadline later', () => {
    const base = SUN_LATE - 5 * 60_000;
    const at = weekLockAtFor(
      { type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME', lockBufferMinutes: 5, weekLockOverrides: { 3: base + 3_600_000 } } },
      3, SLATE,
    );
    expect(at).toBe(base + 3_600_000);
  });

  it('returns null for a week with no games', () => {
    expect(weekLockAtFor(pickem({ lockMode: 'PER_GAME' }), 3, [])).toBeNull();
  });

  it('a Survivor pool is weekly whatever its stored lockMode says', () => {
    const at = weekLockAtFor({ type: 'NFL_SURVIVOR', settings: { lockMode: 'PER_GAME', lockBufferMinutes: 5 } }, 3, SLATE);
    expect(at).toBe(THU - 5 * 60_000);
  });

  it('a Survivor pool never moves later than its frozen deadline', () => {
    const frozen = THU - 60 * 60_000;
    const at = weekLockAtFor(
      { type: 'NFL_SURVIVOR', settings: { lockBufferMinutes: 5 }, hardLockByWeek: { 3: frozen } },
      3, SLATE,
    );
    expect(at).toBe(frozen);
  });
});

describe('nextLockAtFor — what the countdown points at', () => {
  const THU = Date.UTC(2026, 8, 10, 20, 0);
  const SUN = Date.UTC(2026, 8, 13, 13, 0);
  const SLATE = [THU, SUN];
  const perGame = { type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME', lockBufferMinutes: 5 } };

  it('is the next GAME on a per-game pool, not the end of the week', () => {
    const wednesday = Date.UTC(2026, 8, 9, 12, 0);
    expect(nextLockAtFor(perGame, 3, SLATE, wednesday)).toBe(THU - 5 * 60_000);
    // The week deadline is a different, later instant — which is the point.
    expect(weekLockAtFor(perGame, 3, SLATE)).toBe(SUN - 5 * 60_000);
  });

  it('advances to Sunday once Thursday has locked', () => {
    const fridayMorning = Date.UTC(2026, 8, 11, 9, 0);
    expect(nextLockAtFor(perGame, 3, SLATE, fridayMorning)).toBe(SUN - 5 * 60_000);
  });

  it('falls back to the week deadline when nothing is left', () => {
    const afterEverything = SUN + 60_000;
    expect(nextLockAtFor(perGame, 3, SLATE, afterEverything)).toBe(SUN - 5 * 60_000);
  });

  it('equals the week deadline on a weekly pool', () => {
    const weekly = { type: 'NFL_PICKEM', settings: { lockMode: 'WEEKLY', lockBufferMinutes: 5 } };
    const wednesday = Date.UTC(2026, 8, 9, 12, 0);
    expect(nextLockAtFor(weekly, 3, SLATE, wednesday)).toBe(weekLockAtFor(weekly, 3, SLATE));
  });
});

/**
 * The two client files that had the defect, pinned at the source level.
 *
 * Behaviour is covered above; these stop the components silently going back to
 * computing it themselves, which is the specific way it broke.
 */
describe('the client no longer computes the lock itself', () => {
  it('the dashboard delegates to the shared helpers', () => {
    const src = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    expect(src).toContain('weekLockAtFor(castPool, selectedWeek');
    expect(src).toContain('nextLockAtFor(castPool, selectedWeek');
    // The exact line that caused it.
    expect(src).not.toContain('const earliestKickoff = Math.min(...weeklyGames.map(g => g.startTime));');
  });

  it("the pick sheet's week short-circuit is weekly-only", () => {
    const src = read('src/components/NFLPoolDashboard/PickemPickEntry.tsx');
    expect(src).toContain("if (lockMode === 'WEEKLY' && isWeekLocked) return true;");
    expect(src).not.toMatch(/if \(isWeekLocked\) return true;/);
  });
});

/**
 * The submission payload, once per-game pools stay open.
 *
 * `submitNFLPicks` refuses a locked game whose pick CHANGED, and refuses the
 * WHOLE submission when it does — so one stale Thursday selection would reject
 * every open Sunday pick with it. Unreachable before the per-game fix, ordinary
 * after it. (codex P1 on this PR.)
 */
describe('dropStaleLockedPicks', () => {
  const IDS = ['thu', 'sun-a', 'sun-b'];
  const lockedThursday = (id: string) => id === 'thu';

  it('drops a locked pick the server never received', () => {
    const out = dropStaleLockedPicks(
      IDS, { thu: 'KC', 'sun-a': 'BUF' }, {}, lockedThursday,
    );
    expect(out.picks).toEqual({ 'sun-a': 'BUF' });
    expect(out.droppedGameIds).toEqual(['thu']);
  });

  it('keeps a locked pick that matches what is already saved', () => {
    const out = dropStaleLockedPicks(
      IDS, { thu: 'KC', 'sun-a': 'BUF' }, { thu: 'KC' }, lockedThursday,
    );
    expect(out.picks).toEqual({ thu: 'KC', 'sun-a': 'BUF' });
    expect(out.droppedGameIds).toEqual([]);
  });

  it('drops a locked pick that was EDITED away from the saved one', () => {
    // The member changed their mind after kickoff. The server would refuse the
    // whole submission over it.
    const out = dropStaleLockedPicks(
      IDS, { thu: 'DEN', 'sun-a': 'BUF' }, { thu: 'KC' }, lockedThursday,
    );
    expect(out.picks).toEqual({ 'sun-a': 'BUF' });
    expect(out.droppedGameIds).toEqual(['thu']);
  });

  it('touches nothing when no game is locked', () => {
    const picks = { thu: 'KC', 'sun-a': 'BUF' };
    const out = dropStaleLockedPicks(IDS, picks, {}, () => false);
    expect(out.picks).toEqual(picks);
    expect(out.droppedGameIds).toEqual([]);
  });

  it('reports what it dropped, so the member can be told', () => {
    const out = dropStaleLockedPicks(
      IDS, { thu: 'KC', 'sun-a': 'BUF' }, {}, (id) => id !== 'sun-a',
    );
    expect(out.droppedGameIds).toEqual(['thu']);
    expect(out.picks).toEqual({ 'sun-a': 'BUF' });
  });

  it('never invents a pick for a game the member left blank', () => {
    const out = dropStaleLockedPicks(IDS, { 'sun-a': 'BUF' }, {}, lockedThursday);
    expect(out.picks).toEqual({ 'sun-a': 'BUF' });
    expect(out.droppedGameIds).toEqual([]);
  });
});
