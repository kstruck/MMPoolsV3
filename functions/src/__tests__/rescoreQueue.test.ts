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
  type RescoreReason,
  type QueuedEvent,
} from '../lib/rescoreQueue';
import { isRetiredPool, isTerminalPool, nextWithheldLockAt } from '../lib/autoScoreDecisions';
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
      .toEqual({ season: '2026', seasonType: 1, week: 2, reason: 'correction', enqueuedAt: 5 });
  });

  it('keeps notBefore only when it is a real instant', () => {
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 2, reason: 'lockPending', enqueuedAt: 5, notBefore: 900 })?.notBefore)
      .toBe(900);
    expect(parseRescoreEvent({ season: '2026', seasonType: 1, week: 2, reason: 'lockPending', enqueuedAt: 5, notBefore: null })?.notBefore)
      .toBeUndefined();
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

describe('survivorAllowedForGroup — the one deferral, and its exact boundary', () => {
  const set = (...r: RescoreReason[]) => new Set<RescoreReason>(r);

  it('DEFERS a correction-only group', () => {
    // Re-scoring week N leaves later strikeWeeks in place and skips every later
    // week once the entry is eliminated there, so the elimination ordering
    // downstream stays wrong. No safe automatic repair until reset-and-replay.
    expect(survivorAllowedForGroup(set('correction'))).toBe(false);
  });

  it('ALLOWS a delayed first final — that is a normal first score', () => {
    expect(survivorAllowedForGroup(set('terminal'))).toBe(true);
  });

  it('allows a group that carries a correction AND a terminal', () => {
    expect(survivorAllowedForGroup(set('correction', 'terminal'))).toBe(true);
  });

  it('allows spread and lockPending groups', () => {
    expect(survivorAllowedForGroup(set('spread'))).toBe(true);
    expect(survivorAllowedForGroup(set('lockPending'))).toBe(true);
  });

  it('an empty set is not allowed — no positive reason means no licence', () => {
    expect(survivorAllowedForGroup(set())).toBe(false);
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

  it('fires when an edited line is locked for the first time', () => {
    // The miss a "locked && value changed" test alone would ship: edit while
    // unlocked, then lock — the locked value never "changes" and the corrected
    // line grades ATS silently.
    expect(lockedSpreadChanged({ value: -3.5, locked: false }, { value: -3.5, locked: true })).toBe(true);
    expect(lockedSpreadChanged(undefined, { value: -7, locked: true })).toBe(true);
  });

  it('stays quiet on an unlocked line moving — that is every ESPN sync', () => {
    expect(lockedSpreadChanged({ value: -3, locked: false }, { value: -4, locked: false })).toBe(false);
  });

  it('stays quiet when a locked line is rewritten with the same value', () => {
    // syncScoresWindow preserves locked spreads and rewrites the whole slate every
    // 5 minutes; without this the queue would fill with no-op events all night.
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -3, locked: true })).toBe(false);
  });

  it('stays quiet on an unlock', () => {
    expect(lockedSpreadChanged({ value: -3, locked: true }, { value: -3, locked: false })).toBe(false);
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
