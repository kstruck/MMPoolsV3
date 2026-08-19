import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { nflLockMode, usesWeeklyLock, weekLockOverrideFor, gameLockAt, weekLockAtFor, nextLockAtFor } from '../shared/nflLockMode';

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

  it("confidence mode forces WEEKLY even while lockMode still reads PER_GAME", () => {
    // The clause two server copies had already dropped. A confidence pool's
    // stored lockMode is untouched, so reading lockMode alone gets it wrong.
    expect(nflLockMode('NFL_PICKEM', { lockMode: 'PER_GAME', confidenceMode: true })).toBe('WEEKLY');
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
describe('the server still computes weekly locking the same way', () => {
  const SUBMIT = 'functions/src/nflPools.ts';
  const REVEAL = 'functions/src/lib/pickReveal.ts';

  it('submitNFLPicks derives it as confidenceMode || lockMode === WEEKLY', () => {
    const src = read(SUBMIT);
    expect(
      src,
      `${SUBMIT} no longer derives weekly locking the way shared/nflLockMode.ts does. ` +
        'If the server rule changed, change nflLockMode to match and update this guard — ' +
        'do not delete it. A per-game Pick\'em pool shipped a whole-sheet lock for ' +
        'months because nothing compared the two.',
    ).toContain("const weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';");
  });

  it('pickReveal derives it the same way', () => {
    const src = read(REVEAL);
    expect(src).toContain("(s?.confidenceMode || s?.lockMode === 'WEEKLY') ? 'WEEK' : 'PER_GAME'");
  });

  /**
   * The guard discriminates. Both assertions above are `toContain` on a literal,
   * so a changed expression fails — proved here on a mutated copy rather than
   * asserted in a comment.
   */
  it('would catch the confidenceMode clause being dropped', () => {
    const mutated = read(SUBMIT).replace(
      "const weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';",
      "const weeklyLockMode = settings.lockMode === 'WEEKLY';",
    );
    expect(mutated).not.toContain(
      "const weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';",
    );
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
