// The pure half of the reconciliation tier (PLAN-REALTIME-SCORING §5b).
//
// Everything here decides whether a late correction, a delayed final or a
// withheld reveal ever reaches the scorer at all — and every one of these is a
// silent skip-forever bug when it goes wrong, which is exactly the class that
// cannot be noticed in production. The Firestore-touching halves (enqueue, drain,
// ack) are pinned in `autoScore.emulator.test.ts` where a real transaction can
// interleave.
import { describe, it, expect } from 'vitest';
import {
  parseRescoreEvent,
  groupBySlate,
  survivorAllowedForGroup,
  slateKeyOf,
  lockedSpreadChanged,
  partitionQueue,
  type RescoreReason,
  type QueuedEvent,
} from '../lib/rescoreQueue';
import { isRetiredPool, isTerminalPool, isVoidedPool, nextWithheldLockAt } from '../lib/autoScoreDecisions';
import type { NFLGame } from '../nflPoolTypes';

const ev = (over: Partial<QueuedEvent['event']> & { id?: string } = {}): QueuedEvent => {
  const { id, ...event } = over;
  return {
    id: id ?? 'e1',
    event: { season: '2026', seasonType: 1, week: 1, reason: 'terminal', enqueuedAt: 1000, ...event },
  };
};

describe('parseRescoreEvent — a malformed doc must not become work', () => {
  it('accepts a well-formed event', () => {
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 2, reason: 'correction', enqueuedAt: 5 }))
      .toEqual({ season: '2026', seasonType: 1, week: 2, reason: 'correction', enqueuedAt: 5, notBefore: 0 });
  });

  it('normalizes notBefore to 0 when it is not a real instant', () => {
    // Always a number, never absent: the drain filters on it in the QUERY, and a
    // Firestore inequality omits docs missing the field.
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 2, reason: 'lockPending', enqueuedAt: 5, notBefore: 900 })?.notBefore)
      .toBe(900);
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 2, reason: 'lockPending', enqueuedAt: 5, notBefore: null })?.notBefore)
      .toBe(0);
  });

  it('rejects a finalizeRetry with no poolId — finalization is per POOL', () => {
    // Treating it as slate work would re-score a whole slate to chase one pool's
    // finalization; there is no safe default.
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 1, reason: 'finalizeRetry', enqueuedAt: 1 })).toBeNull();
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 1, reason: 'finalizeRetry', enqueuedAt: 1, poolId: 'p1' })?.poolId)
      .toBe('p1');
  });

  it('rejects an unknown reason rather than defaulting it', () => {
    // A reason the drain does not understand would be treated as "safe for
    // Survivor" by any default, which is the one direction that corrupts data.
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 1, reason: 'whatever', enqueuedAt: 1 })).toBeNull();
  });

  it.each([
    ['no season', { seasonType: 1, week: 1, reason: 'terminal' }],
    ['week 0', { season: '2026', seasonType: 1, week: 0, reason: 'terminal' }],
    ['non-numeric week', { season: '2026', seasonType: 1, week: 'one', reason: 'terminal' }],
    ['nothing at all', undefined],
  ])('rejects %s', (_label, doc) => {
    expect(parseRescoreEvent(doc)).toBeNull();
  });
});

describe('groupBySlate — one unit of work per slate, every id kept for the ack', () => {
  it('unions reasons and keeps both ids', () => {
    const groups = groupBySlate([
      ev({ id: 'a', reason: 'correction' }),
      ev({ id: 'b', reason: 'terminal' }),
    ]);
    expect(groups).toHaveLength(1);
    expect([...groups[0].reasons].sort()).toEqual(['correction', 'terminal']);
    expect(groups[0].ids.sort()).toEqual(['a', 'b']);
  });

  it('separates seasonType — a preseason week 1 is not a regular-season week 1', () => {
    const groups = groupBySlate([ev({ id: 'a', seasonType: 1 }), ev({ id: 'b', seasonType: 2 })]);
    expect(groups).toHaveLength(2);
  });

  it('separates week and season', () => {
    expect(groupBySlate([ev({ id: 'a', week: 1 }), ev({ id: 'b', week: 2 })])).toHaveLength(2);
    expect(groupBySlate([ev({ id: 'a', season: '2026' }), ev({ id: 'b', season: '2027' })])).toHaveLength(2);
  });

  it('slateKeyOf is the grouping key and is stable', () => {
    expect(slateKeyOf({ season: '2026', seasonType: 1, week: 3 })).toBe('2026_1_3');
  });
});

describe('survivorAllowedForGroup — the one thing a queued pass may do to Survivor', () => {
  const set = (...r: RescoreReason[]) => new Set<RescoreReason>(r);
  const unscored = {};
  const scoredWk1 = { scoredWeeks: { '1': true } };

  it('DEFERS a correction-only group', () => {
    // Re-scoring week N leaves later strikeWeeks in place and rewrites
    // eliminatedWeek to N, after which every later week is skipped and the
    // elimination ordering is wrong. No safe repair until reset-and-replay.
    expect(survivorAllowedForGroup(set('correction'), unscored, 1)).toBe(false);
  });

  it('ALLOWS a delayed first final on a week nobody has completed', () => {
    expect(survivorAllowedForGroup(set('terminal'), unscored, 1)).toBe(true);
  });

  it('DEFERS every reason once the week is already scored', () => {
    // codex r3: the damage is re-running a SCORED week, not the reason label. A
    // spread edit or a delayed final on another game corrupts the ledger exactly
    // as a correction would.
    expect(survivorAllowedForGroup(set('terminal'), scoredWk1, 1)).toBe(false);
    expect(survivorAllowedForGroup(set('spread'), scoredWk1, 1)).toBe(false);
    expect(survivorAllowedForGroup(set('lockPending'), scoredWk1, 1)).toBe(false);
  });

  it('an EARLIER scored week does not block a first score of a later one', () => {
    expect(survivorAllowedForGroup(set('terminal'), scoredWk1, 2)).toBe(true);
  });

  it('DEFERS when a LATER week has already been scored — out of order is as bad as a replay', () => {
    // codex r7: Survivor state is sequential. A suspended week-2 game going
    // terminal after week 3 was scored would run week 2 against a ledger that
    // already carries week-3 strikes and elimination, and computeSurvivorWeekUpdate
    // can rewrite eliminatedWeek backwards to week 2 even when that pick WON.
    expect(survivorAllowedForGroup(set('terminal'), { scoredWeeks: { '3': true } }, 2)).toBe(false);
    expect(survivorAllowedForGroup(set('terminal'), { publishedWeeks: { '3': true } }, 2)).toBe(false);
  });

  it('DEFERS a week that was only PROVISIONALLY scored — the ledger already exists', () => {
    // codex r6: scoredWeeks alone is not enough. A provisional pass on a
    // weekly-locked Survivor pool writes strikeWeeks / eliminatedWeek the moment
    // the weekly lock passes and a picked game finalizes, and publishedWeeks is
    // stamped by ANY pass that revealed anything. That ledger is exactly what a
    // replay corrupts.
    expect(survivorAllowedForGroup(set('terminal'), { publishedWeeks: { '1': true } }, 1)).toBe(false);
    expect(survivorAllowedForGroup(set('spread'), { publishedWeeks: { 1: true } }, 1)).toBe(false);
  });

  it('still allows a week nothing has touched — neither marker set', () => {
    expect(survivorAllowedForGroup(set('terminal'), { scoredWeeks: { '1': false }, publishedWeeks: {} }, 1)).toBe(true);
  });

  it('an earlier publishedWeeks marker does not block a later week', () => {
    expect(survivorAllowedForGroup(set('terminal'), { publishedWeeks: { '1': true } }, 2)).toBe(true);
  });

  it('ignores false markers on later weeks — only a real one blocks', () => {
    expect(survivorAllowedForGroup(set('terminal'), { scoredWeeks: { '5': false } }, 2)).toBe(true);
  });

  it('allows a group that carries a correction AND a terminal', () => {
    expect(survivorAllowedForGroup(set('correction', 'terminal'), unscored, 1)).toBe(true);
  });

  it('an empty set is not allowed — no positive reason means no licence', () => {
    expect(survivorAllowedForGroup(set(), unscored, 1)).toBe(false);
  });
});

describe('partitionQueue — finalize retries are pool work, not slate work', () => {
  it('splits finalizeRetry out of the slate stream', () => {
    const { slateWork, finalizeRetries } = partitionQueue([
      ev({ id: 'a', reason: 'terminal' }),
      ev({ id: 'b', reason: 'finalizeRetry', poolId: 'p1' }),
      ev({ id: 'c', reason: 'correction' }),
    ]);
    expect(slateWork.map(e => e.id)).toEqual(['a', 'c']);
    expect(finalizeRetries.map(e => e.id)).toEqual(['b']);
  });

  it('keeps a finalizeRetry out of groupBySlate, so it can never re-score a slate', () => {
    // The point of the split: the week SCORED fine — finalization threw. Sending
    // it down the slate path would re-score every pool on the slate, and the
    // Survivor scoredWeeks gate would defer it outright so it never ran at all.
    const { slateWork } = partitionQueue([ev({ id: 'b', reason: 'finalizeRetry', poolId: 'p1' })]);
    expect(groupBySlate(slateWork)).toEqual([]);
  });
});

describe('isRetiredPool vs isTerminalPool vs isVoidedPool', () => {
  it.each(['CANCELED', 'COMPLETED', 'ARCHIVED', 'archived'])('%s is voided — no scorer may write into it', (status) => {
    expect(isVoidedPool({ status })).toBe(true);
  });

  it('status FINAL is retired but NOT voided', () => {
    // Payout handling stamps FINAL on a settled pool. A commissioner re-scoring
    // one through the manual button is a legitimate flow today, so the in-lease
    // guard must not start refusing it — that would be a behavior change well
    // outside the cancelPool race it closes.
    expect(isRetiredPool({ status: 'FINAL' })).toBe(true);
    expect(isVoidedPool({ status: 'FINAL' })).toBe(false);
  });

  it('a live pool is neither, and a missing pool is both', () => {
    expect(isVoidedPool({ status: 'OPEN' })).toBe(false);
    expect(isVoidedPool(undefined)).toBe(true);
  });
});

describe('isRetiredPool vs isTerminalPool — what the queued tier may bypass', () => {
  it('a finalized pool is terminal but NOT retired, so a correction can rescore it', () => {
    const finalized = { finalizedAt: 123, status: 'active' };
    expect(isTerminalPool(finalized)).toBe(true);
    expect(isRetiredPool(finalized)).toBe(false);
    const flagged = { isFinal: true, status: 'active' };
    expect(isTerminalPool(flagged)).toBe(true);
    expect(isRetiredPool(flagged)).toBe(false);
  });

  it.each(['CANCELED', 'COMPLETED', 'ARCHIVED', 'archived', 'FINAL'])(
    'status %s stays retired even for a queued rescore', (status) => {
      // maybeFinalizeNFLPool never writes a status — it writes finalizedAt — so
      // keeping every status on the retired side does not block the queue's job.
      // It does keep it out of a voided pool (codex r9) and out of a pool whose
      // payouts were already settled against the standings.
      expect(isRetiredPool({ status })).toBe(true);
      expect(isTerminalPool({ status })).toBe(true);
    });

  it('an ordinary live pool is neither', () => {
    expect(isTerminalPool({ status: 'active' })).toBe(false);
    expect(isRetiredPool({ status: 'active' })).toBe(false);
  });
});

describe('lockedSpreadChanged — the manual line edit detectStatCorrections cannot see', () => {
  it('fires when a locked value is corrected', () => {
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -3.5, locked: true })).toBe(true);
  });

  it('stays quiet on the weekly false → true lock, however the value moves', () => {
    // codex r1/P2: lockNFLSpreadsJob flips every upcoming game to locked on its
    // own schedule. Calling that a correction would queue a rescore for a slate
    // whose games have not kicked off — days early, on every game.
    expect(lockedSpreadChanged({ value: -3.5, locked: false }, { value: -3.5, locked: true })).toBe(false);
    expect(lockedSpreadChanged({ value: -3, locked: false }, { value: -4, locked: true })).toBe(false);
    expect(lockedSpreadChanged(undefined, { value: -7, locked: true })).toBe(false);
  });

  it('stays quiet on an unlocked line moving — that is every ESPN sync', () => {
    expect(lockedSpreadChanged({ value: -3, locked: false }, { value: -4, locked: false })).toBe(false);
  });

  it('stays quiet when a locked line is rewritten with the same value', () => {
    // syncScoresWindow preserves locked spreads and rewrites the whole slate every
    // 5 minutes; without this the queue would fill with no-op events all night.
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -3, locked: true })).toBe(false);
  });

  it('stays quiet on a bare unlock — nothing about the grade changed', () => {
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -3, locked: false })).toBe(false);
  });

  it('FIRES when a locked line is corrected and unlocked in the same write', () => {
    // codex r9: ATS grades on spread.value whatever `locked` says, and the spread
    // UI can save both changes at once. Gating on the AFTER side being locked
    // would drop exactly this correction.
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -6.5, locked: false })).toBe(true);
  });
});

describe('nextWithheldLockAt — the reminder for a reveal held behind an override', () => {
  const HOUR = 60 * 60 * 1000;
  const KICK = 1_000_000_000_000;
  const game = (over: Partial<NFLGame> = {}): NFLGame => ({
    id: 'g1', status: 'FINAL', startTime: KICK, week: 1, season: '2026', seasonType: 1,
    homeTeam: { abbreviation: 'AAA' }, awayTeam: { abbreviation: 'BBB' }, ...over,
  } as unknown as NFLGame);
  // `weekLockOverrides` holds an ABSOLUTE epoch-ms deadline, not a duration —
  // effectiveGameLockAt takes Math.max(kickoff - buffer, override).
  const OVERRIDE_AT = KICK + 23 * HOUR;
  const pool = (overrideAt?: number) => ({
    type: 'NFL_PICKEM',
    settings: overrideAt ? { weekLockOverrides: { 1: overrideAt } } : {},
  });

  it('returns null when the terminal game is already revealable', () => {
    expect(nextWithheldLockAt(pool(), 1, [game()], KICK + 2 * HOUR)).toBeNull();
  });

  it('returns the override instant when a FINAL game is still behind it', () => {
    // The §5b case exactly: final at kickoff+1h, override expiring at kickoff+23h.
    // The slate leaves the 24h window before the override does.
    expect(nextWithheldLockAt(pool(OVERRIDE_AT), 1, [game()], KICK + HOUR)).toBe(OVERRIDE_AT);
  });

  it('ignores games that are not terminal yet — the live window still covers those', () => {
    expect(nextWithheldLockAt(pool(OVERRIDE_AT), 1, [game({ status: 'IN_PROGRESS' } as Partial<NFLGame>)], KICK + HOUR))
      .toBeNull();
  });

  it('returns the EARLIEST withheld lock, so the reminder fires at the first reveal', () => {
    // Two terminal games with different kickoffs and no override: the reminder
    // must land on the first reveal, not the last.
    const early = game({ id: 'g1', startTime: KICK + 2 * HOUR } as Partial<NFLGame>);
    const late = game({ id: 'g2', startTime: KICK + 3 * HOUR } as Partial<NFLGame>);
    expect(nextWithheldLockAt(pool(), 1, [late, early], KICK))
      .toBe(KICK + 2 * HOUR - 5 * 60 * 1000);
  });

  it('returns null for an empty slate', () => {
    expect(nextWithheldLockAt(pool(OVERRIDE_AT), 1, [], KICK)).toBeNull();
  });

  it('ignores a Survivor override — the hard-lock types drop overrides entirely', () => {
    // effectiveLockSettings strips weekLockOverrides for the weekly-hard-lock
    // types, so a stale override on one cannot manufacture a reminder.
    expect(nextWithheldLockAt({ type: 'NFL_SURVIVOR', settings: { weekLockOverrides: { 1: OVERRIDE_AT } } }, 1, [game()], KICK + HOUR))
      .toBeNull();
  });
});
