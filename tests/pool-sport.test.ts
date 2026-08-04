import { describe, it, expect } from 'vitest';
import {
  getPoolSport,
  getLeagueDisplayName,
  getPoolLifecycleState,
  getPoolEntrySummary,
  formatEntryCount,
  getPoolLockTime,
  getPoolLockTimeState,
  isNFLSeasonPoolType,
  isSquaresPoolType,
} from '../src/utils/poolSport';

describe('getPoolSport', () => {
  it('buckets NFL season pools (pickem/survivor/margin) as NFL Football — the bug T4 fixes', () => {
    // These used to fall through to getLeagueDisplayName(undefined) => "Other".
    expect(getPoolSport({ type: 'NFL_PICKEM' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'NFL_SURVIVOR' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'NFL_MARGIN' })).toBe('NFL Football');
  });

  it('classifies the other pool types', () => {
    expect(getPoolSport({ type: 'BRACKET' })).toBe('March Madness');
    expect(getPoolSport({ type: 'NFL_PLAYOFFS' })).toBe('NFL Playoffs');
    expect(getPoolSport({ type: 'PROPS' })).toBe('Props Pool');
    expect(getPoolSport({ type: 'SQUARES', league: 'nfl' })).toBe('NFL Football');
    expect(getPoolSport({ type: 'SQUARES', league: 'college' })).toBe('NCAA Football');
    expect(getPoolSport({ type: 'SQUARES', league: undefined })).toBe('Other');
  });

  it('getLeagueDisplayName maps league codes', () => {
    expect(getLeagueDisplayName('nfl')).toBe('NFL Football');
    expect(getLeagueDisplayName('college')).toBe('NCAA Football');
    expect(getLeagueDisplayName('ncaa')).toBe('NCAA Football');
    expect(getLeagueDisplayName(undefined)).toBe('Other');
  });
});

describe('getPoolLifecycleState', () => {
  it('reads SQUARES state from gameStatus/isLocked', () => {
    expect(getPoolLifecycleState({ type: 'SQUARES', scores: { gameStatus: 'post' } })).toBe('final');
    expect(getPoolLifecycleState({ type: 'SQUARES', scores: { gameStatus: 'in' } })).toBe('live');
    expect(getPoolLifecycleState({ type: 'SQUARES', isLocked: true })).toBe('locked');
    expect(getPoolLifecycleState({ type: 'SQUARES', isLocked: false })).toBe('open');
  });

  it('reads string-status types (NFL season, bracket, playoff, props) from status', () => {
    expect(getPoolLifecycleState({ type: 'NFL_PICKEM', status: 'OPEN' })).toBe('open');
    expect(getPoolLifecycleState({ type: 'NFL_PICKEM', status: 'COMPLETED' })).toBe('final');
    expect(getPoolLifecycleState({ type: 'BRACKET', status: 'LOCKED' })).toBe('locked');
    expect(getPoolLifecycleState({ type: 'BRACKET', status: 'LIVE' })).toBe('live');
    // T2 dual-writes isFinal on admin close — reader honors it immediately.
    expect(getPoolLifecycleState({ type: 'NFL_MARGIN', isFinal: true })).toBe('final');
  });

  it('defaults a freshly-created NFL pool (status OPEN, no terminal transition yet) to open', () => {
    expect(getPoolLifecycleState({ type: 'NFL_SURVIVOR', status: 'OPEN' })).toBe('open');
  });
});

describe('getPoolEntrySummary', () => {
  it('counts NFL season pools by participantIds, in players — the admin-list bug', () => {
    // These used to fall through to the SQUARES branch, count a `squares` array
    // they do not have, and report "100 Left" on every NFL pool in the list.
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(getPoolEntrySummary({ type, participantIds: ['a', 'b', 'c'] })).toEqual({
        count: 3,
        capacity: null,
        unit: 'players',
      });
    }
  });

  it('does not read `squares` or a capacity for a non-squares pool', () => {
    const nfl = getPoolEntrySummary({ type: 'NFL_PICKEM', participantIds: [] });
    expect(nfl.count).toBe(0);
    expect(nfl.capacity).toBeNull();
    expect(nfl.unit).not.toBe('squares');
  });

  it('counts SQUARES by owned squares out of 100', () => {
    const squares = Array.from({ length: 100 }, (_, i) => ({ owner: i < 42 ? 'Kevin' : null }));
    expect(getPoolEntrySummary({ type: 'SQUARES', squares })).toEqual({
      count: 42,
      capacity: 100,
      unit: 'squares',
    });
  });

  it('counts BRACKET by entryCount and honors the unlimited sentinel', () => {
    expect(getPoolEntrySummary({ type: 'BRACKET', entryCount: 7, settings: { maxEntriesTotal: 50 } }))
      .toEqual({ count: 7, capacity: 50, unit: 'entries' });
    // -1 means unlimited: no ceiling, so no progress bar.
    expect(getPoolEntrySummary({ type: 'BRACKET', entryCount: 7, settings: { maxEntriesTotal: -1 } }).capacity)
      .toBeNull();
    expect(getPoolEntrySummary({ type: 'BRACKET' })).toEqual({ count: 0, capacity: null, unit: 'entries' });
  });

  it('counts PROPS by entryCount and NFL_PLAYOFFS by its entries map', () => {
    expect(getPoolEntrySummary({ type: 'PROPS', entryCount: 4 }))
      .toEqual({ count: 4, capacity: null, unit: 'entries' });
    expect(getPoolEntrySummary({ type: 'NFL_PLAYOFFS', entries: { u1: {}, u2: {} }, entryCount: 0 }))
      .toEqual({ count: 2, capacity: null, unit: 'entries' });
  });

  it('treats an unknown/legacy type as squares without crashing on a missing grid', () => {
    expect(getPoolEntrySummary({ type: undefined })).toEqual({ count: 0, capacity: 100, unit: 'squares' });
  });
});

describe('formatEntryCount', () => {
  it('singularizes an uncapped count of one — a fresh NFL pool has exactly its owner', () => {
    expect(formatEntryCount({ count: 1, capacity: null, unit: 'players' })).toBe('1 player');
    expect(formatEntryCount({ count: 1, capacity: null, unit: 'entries' })).toBe('1 entry');
    expect(formatEntryCount({ count: 1, capacity: null, unit: 'squares' })).toBe('1 square');
  });

  it('pluralizes every other uncapped count', () => {
    expect(formatEntryCount({ count: 0, capacity: null, unit: 'players' })).toBe('0 players');
    expect(formatEntryCount({ count: 6, capacity: null, unit: 'entries' })).toBe('6 entries');
  });

  it('keeps the plural unit alongside a capacity', () => {
    expect(formatEntryCount({ count: 1, capacity: 100, unit: 'squares' })).toBe('1/100 squares');
    expect(formatEntryCount({ count: 42, capacity: 100, unit: 'squares' })).toBe('42/100 squares');
  });
});

describe('getPoolLockTime', () => {
  const ISO = '2026-09-10T00:20:00.000Z';
  const EPOCH = Date.parse(ISO);

  it('returns null for NFL season pools — they lock per game/week, not pool-wide', () => {
    expect(getPoolLockTime({ type: 'NFL_PICKEM' })).toBeNull();
    expect(getPoolLockTime({ type: 'NFL_SURVIVOR' })).toBeNull();
    expect(getPoolLockTime({ type: 'NFL_MARGIN' })).toBeNull();
  });

  it('reads the right field per type', () => {
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: EPOCH })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'NFL_PLAYOFFS', lockDate: EPOCH })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'SQUARES', scores: { startTime: ISO } })).toBe(EPOCH);
  });

  it('reads a props deadline from reminders.lock, which is where the wizard writes it', () => {
    // PropsWizard sets reminders.lock.lockAt and autoLock locks off that field;
    // `lockDate` is declared on PropsPool but no write path sets it.
    expect(getPoolLockTime({ type: 'PROPS', reminders: { lock: { lockAt: EPOCH } } })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'PROPS', lockDate: EPOCH })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'PROPS' })).toBeNull();
  });

  it('accepts legacy ISO strings where the type declares a number', () => {
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: ISO })).toBe(EPOCH);
  });

  it('returns null rather than NaN when the field is missing or unparseable', () => {
    expect(getPoolLockTime({ type: 'BRACKET' })).toBeNull();
    expect(getPoolLockTime({ type: 'SQUARES', scores: {} })).toBeNull();
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: 'not a date' })).toBeNull();
  });

  it('normalizes a Firestore Timestamp, which autoLock writes on bracket lock', () => {
    // functions/src/autoLock.ts sets `lockAt: Timestamp.now()`, so a
    // number-only normalizer would blank the column on every auto-locked pool.
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: { toMillis: () => EPOCH } })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'SQUARES', scores: { startTime: { toMillis: () => EPOCH } } })).toBe(EPOCH);
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: {} })).toBeNull();
  });

  it('treats epoch 0 as unset, not as 1970', () => {
    // functions/src/bracketPools.ts creates every bracket pool with lockAt: 0
    // until a deadline is configured, so this is the common case, not an edge.
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: 0 })).toBeNull();
    expect(getPoolLockTime({ type: 'NFL_PLAYOFFS', lockDate: 0 })).toBeNull();
    expect(getPoolLockTime({ type: 'PROPS', lockDate: 0 })).toBeNull();
    expect(getPoolLockTime({ type: 'BRACKET', lockAt: '1970-01-01T00:00:00.000Z' })).toBeNull();
  });
});

describe('getPoolLockTimeState', () => {
  it('separates "never has one" from "nobody set one" — both were one em-dash', () => {
    // A bracket created with lockAt: 0 has an unconfigured deadline, which is
    // an admin's problem to fix; an NFL season pool is working as designed.
    // Rendering both identically hid the first.
    expect(getPoolLockTimeState({ type: 'NFL_SURVIVOR' })).toEqual({ kind: 'per-week' });
    expect(getPoolLockTimeState({ type: 'BRACKET', lockAt: 0 })).toEqual({ kind: 'unset' });
    expect(getPoolLockTimeState({ type: 'SQUARES', scores: {} })).toEqual({ kind: 'unset' });
    expect(getPoolLockTimeState({ type: 'PROPS' })).toEqual({ kind: 'unset' });
  });

  it('carries the timestamp through when there is one', () => {
    const at = Date.parse('2026-09-10T00:20:00.000Z');
    expect(getPoolLockTimeState({ type: 'BRACKET', lockAt: at })).toEqual({ kind: 'at', at });
  });

  it('stays per-week for an NFL season pool even if a stray lockAt is present', () => {
    // lockPool writes isLocked on these types; nothing writes a meaningful
    // pool-wide deadline, so a value here is not one to display.
    expect(getPoolLockTimeState({ type: 'NFL_PICKEM', lockAt: 1_780_000_000_000 }))
      .toEqual({ kind: 'per-week' });
  });
});

describe('isNFLSeasonPoolType', () => {
  it('accepts a raw string off a Firestore doc', () => {
    expect(isNFLSeasonPoolType('NFL_SURVIVOR')).toBe(true);
    expect(isNFLSeasonPoolType('NFL_PLAYOFFS')).toBe(false);
    expect(isNFLSeasonPoolType(undefined)).toBe(false);
  });
});

describe('isSquaresPoolType', () => {
  it('includes legacy docs written before `type` existed', () => {
    // getPoolEntrySummary/getPoolLockTime already treat an untyped pool as
    // squares, so the squares-only row actions must agree or those pools lose
    // their Sim/Fix buttons.
    expect(isSquaresPoolType('SQUARES')).toBe(true);
    expect(isSquaresPoolType(undefined)).toBe(true);
    expect(isSquaresPoolType('')).toBe(true);
  });

  it('excludes every other type', () => {
    for (const type of ['BRACKET', 'PROPS', 'NFL_PLAYOFFS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(isSquaresPoolType(type)).toBe(false);
    }
  });
});
