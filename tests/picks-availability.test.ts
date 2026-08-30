import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  picksAvailability,
  picksBlockedReason,
  SPREAD_FREEZE_CRON,
  SPREAD_FREEZE_TIMEZONE,
  SPREAD_FREEZE_WHEN,
} from '../src/utils/picksAvailability';

/**
 * WHEN THIS WEEK'S PICK SHEET OPENS (Kevin, 2026-08-28).
 *
 * *"Add a note to the pool home page that informs the players when that weeks
 * picks are available to make. Note the day and time based on when the spreads
 * are automatically pulled from ESPN."*
 *
 * The page already said when the week LOCKS. It never said when it OPENS — so
 * an against-the-spread pool sat on "Waiting on Spreads" with no answer to the
 * only question that state raises.
 *
 * These assert the SUBSTANCE: which pools wait, which do not, and that the day
 * and time named is the one the freeze job actually runs on.
 */

const root = resolve(__dirname, '..');
const locked = (n: number) => Array.from({ length: n }, () => ({ spread: { locked: true } }));
const unlocked = (n: number) => Array.from({ length: n }, () => ({ spread: { locked: false } }));

const ATS = { type: 'NFL_PICKEM', settings: { pickMode: 'ATS' } };
const STRAIGHT = { type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT' } };
const SURVIVOR = { type: 'NFL_SURVIVOR', settings: {} };
const MARGIN = { type: 'NFL_MARGIN', settings: {} };

describe('the schedule named in the copy is the one the job runs on', () => {
  /**
   * THE DRIFT PIN. The client cannot import from `functions/` (separate,
   * module-incompatible TS root), so the cron is duplicated — exactly like
   * `poolUsesSpreads` and the feature flags. If the freeze ever moves, this
   * fails and the member-facing sentence has to move with it.
   */
  it('matches lockNFLSpreadsJob verbatim', () => {
    const src = readFileSync(resolve(root, 'functions/src/nflSpreadFreeze.ts'), 'utf8');
    expect(src).toContain(`schedule: '${SPREAD_FREEZE_CRON}'`);
    expect(src).toContain(`timeZone: '${SPREAD_FREEZE_TIMEZONE}'`);
  });

  it('and the English says the same day and hour as the cron', () => {
    // `0 9 * * 2` = minute 0, hour 9, day-of-week 2 (Tuesday).
    const [minute, hour, , , dow] = SPREAD_FREEZE_CRON.split(' ');
    expect(minute).toBe('0');
    expect(hour).toBe('9');
    expect(dow).toBe('2');
    expect(SPREAD_FREEZE_WHEN).toMatch(/Tuesday/i);
    expect(SPREAD_FREEZE_WHEN).toMatch(/9:00\s*AM/i);
    expect(SPREAD_FREEZE_WHEN).toMatch(/ET/);
  });
});

describe('picksAvailability — who waits on spreads and who does not', () => {
  it('an ATS week with every line frozen is OPEN', () => {
    const a = picksAvailability(ATS, locked(16), { weekLocked: false });
    expect(a.kind).toBe('OPEN');
    expect(a.notice).toBe('Picks are available to make now.');
  });

  it('an ATS week with ANY line unfrozen names the day and time', () => {
    // The server counts EVERY game of the week, so one unlocked line blocks it.
    const a = picksAvailability(ATS, [...locked(15), ...unlocked(1)], { weekLocked: false });
    expect(a.kind).toBe('WAITING_ON_SPREADS');
    expect(a.notice).toContain('Tuesdays at 9:00 AM ET');
  });

  /**
   * 🛑 THE POOLS THAT MUST NEVER BE TOLD TO WAIT.
   *
   * `functions/src/nflPools.ts` scopes SPREADS_NOT_LOCKED to
   * `poolUsesSpreads(pool)`. Straight-up pick'em, Survivor and Margin submit
   * fine with no lines at all — every preseason week is one — so naming a
   * Tuesday deadline at them would be a fabricated rule.
   */
  it.each([
    ['straight-up pickem', STRAIGHT],
    ['survivor', SURVIVOR],
    ['margin', MARGIN],
  ])('%s is OPEN even with no line on any game', (_label, pool) => {
    const a = picksAvailability(pool, unlocked(16), { weekLocked: false });
    expect(a.kind).toBe('OPEN');
    expect(a.notice).toBe('Picks are available to make now.');
    expect(a.notice).not.toContain('Tuesday');
  });

  it('a pool with no pickMode stored is treated as straight-up, not blocked', () => {
    // `pickMode` is `.optional()` and absent means STRAIGHT. Defaulting the
    // other way would lock every legacy pick'em pool out of its own sheet.
    const a = picksAvailability({ type: 'NFL_PICKEM', settings: {} }, unlocked(16), { weekLocked: false });
    expect(a.kind).toBe('OPEN');
  });

  it('a locked week says nothing new — the lock copy already covers it', () => {
    const a = picksAvailability(ATS, locked(16), { weekLocked: true });
    expect(a.kind).toBe('LOCKED');
    expect(a.notice).toBeNull();
  });

  /**
   * AN EMPTY SLATE IS NOT "OPEN", FOR ANY POOL TYPE (codex r1 P2).
   *
   * The first cut special-cased this for ATS only — `spreadsBlockWeek`
   * delegates to `weekGames.every(...)` and `[].every()` is TRUE. The
   * observation was right and applied too narrowly: `submitNFLPicks` refuses an
   * empty week with `No NFL games found` regardless of type, and checks it
   * BEFORE the spreads gate. So does this.
   */
  it.each([
    ['ATS pickem', ATS],
    ['straight-up pickem', STRAIGHT],
    ['survivor', SURVIVOR],
    ['margin', MARGIN],
  ])('%s with no games loaded is NO_GAMES, never open', (_label, pool) => {
    const a = picksAvailability(pool, [], { weekLocked: false });
    expect(a.kind).toBe('NO_GAMES');
    expect(a.notice).toContain('schedule has not been posted');
    // ...and it must not blame the spreads, which is not why it is shut.
    expect(a.notice).not.toContain('Tuesday');
  });

  it('the no-games reason outranks the spreads reason, as it does on the server', () => {
    // nflPools.ts throws `No NFL games found` before it reaches the
    // SPREADS_NOT_LOCKED gate, so an ATS pool with nothing loaded is told the
    // true reason rather than one that would send it to wait for Tuesday.
    const src = readFileSync(resolve(root, 'functions/src/nflPools.ts'), 'utf8');
    const noGames = src.indexOf('No NFL games found');
    const spreads = src.indexOf('SPREADS_NOT_LOCKED: Picks cannot be submitted');
    expect(noGames).toBeGreaterThan(-1);
    expect(spreads).toBeGreaterThan(-1);
    expect(noGames).toBeLessThan(spreads);
  });
});

describe('picksBlockedReason — what greys the Make Picks button out', () => {
  it('gives a reason on a blocked ATS week, naming the day and time', () => {
    const reason = picksBlockedReason(ATS, unlocked(4));
    expect(reason).toContain('spreads are not locked yet');
    expect(reason).toContain(SPREAD_FREEZE_WHEN);
  });

  it('returns null wherever the button must stay live', () => {
    expect(picksBlockedReason(ATS, locked(4))).toBeNull();
    expect(picksBlockedReason(STRAIGHT, unlocked(4))).toBeNull();
    expect(picksBlockedReason(SURVIVOR, unlocked(4))).toBeNull();
    expect(picksBlockedReason(MARGIN, unlocked(4))).toBeNull();
    expect(picksBlockedReason(null, unlocked(4))).toBeNull();
  });

  it('an empty slate blocks the button on EVERY pool type, and says why', () => {
    for (const pool of [ATS, STRAIGHT, SURVIVOR, MARGIN]) {
      const reason = picksBlockedReason(pool, []);
      expect(reason).toContain('schedule has not been posted');
      expect(reason).not.toContain('Tuesday');
    }
  });
});

describe('the three surfaces actually render it', () => {
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

  it('the Lock Status card shows the OPENS line ABOVE the LOCKS block', () => {
    const src = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    const opens = src.indexOf('picksAvailability(castPool, weeklyGames');
    const locks = src.indexOf('COUNTS DOWN TO THE NEXT LOCK');
    expect(opens).toBeGreaterThan(-1);
    expect(locks).toBeGreaterThan(-1);
    // Kevin: "This should be above the text that shows when the pool locks."
    expect(opens).toBeLessThan(locks);
  });

  /**
   * ONE DERIVATION FOR THE HEADER AND THE NOTICE (codex r2).
   *
   * The header keyed off `spreadsBlocked` alone, so an empty slate rendered
   * "Picks are Open" directly above "this week's schedule has not been posted
   * yet" — two contradictory claims on one card. Both now come from the same
   * `picksAvailability` call.
   */
  it('the Lock Status header names all four states from one derivation', () => {
    const src = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    expect(src).toContain("availability.kind === 'NO_GAMES' ? 'No Games Yet'");
    expect(src).toContain("availability.kind === 'WAITING_ON_SPREADS' ? 'Waiting on Spreads'");
    // The old second derivation is gone, so the two cannot disagree again.
    expect(src).not.toContain('const spreadsBlocked = useMemo(');
    expect((src.match(/picksAvailability\(castPool, weeklyGames/g) ?? [])).toHaveLength(1);
  });

  it('the week checklist GREYS the button out rather than hiding it', () => {
    const src = read('src/components/NFLPoolDashboard/WeekChecklist.tsx');
    expect(src).toContain('disabled={nextDue.spreadsBlocked}');
    // The old behaviour removed the button entirely.
    expect(src).not.toContain('{!nextDue.spreadsBlocked && (');
  });

  it('both dashboard CTAs are disabled while the sheet cannot take a pick', () => {
    const src = read('src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx');
    expect(src).toContain('const picksBlocked = picksBlockedReason(castPool, weeklyGames);');
    expect((src.match(/disabled=\{!!picksBlocked\}/g) ?? [])).toHaveLength(2);
    expect((src.match(/title=\{picksBlocked \?\? undefined\}/g) ?? [])).toHaveLength(2);
  });

  /**
   * THE ROUTE AROUND THE GATE (codex r1 P2). The matchup panel under the CTA is
   * itself a click target for the picks tab, so leaving it live while the
   * button is disabled just walks the member around the gate.
   */
  it('the clickable matchup panel follows the same gate, keyboard path included', () => {
    const src = read('src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx');
    expect(src).toContain("onClick={picksBlocked ? undefined : () => onSelectTab('picks')}");
    expect(src).toContain('tabIndex={picksBlocked ? -1 : 0}');
    expect(src).toContain('aria-disabled={picksBlocked ? true : undefined}');
    expect(src).toContain("if (!picksBlocked && (e.key === 'Enter' || e.key === ' '))");
  });
});
