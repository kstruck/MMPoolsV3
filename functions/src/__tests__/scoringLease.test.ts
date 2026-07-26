import { describe, it, expect, vi } from 'vitest';
import {
  readScoringLease,
  readLockRevision,
  leaseIsLive,
  leaseHeldByOther,
  checkFence,
  retryWhileScoring,
  newLeaseOwner,
  SCORING_IN_PROGRESS,
  type ScoringFence,
} from '../lib/scoringLease';
import { nextEntryRevision, readEntryRevisionSum } from '../lib/entryRevision';
import {
  weekIsPublished,
  legacyPublishedWeeks,
  missingPublishedWeeks,
  extensionRefusal,
} from '../lib/publishedWeeks';

const NOW = 1_700_000_000_000;
const fence = (over: Partial<ScoringFence> = {}): ScoringFence =>
  ({ owner: 'me', lockRevision: 3, ttlMs: 60_000, ...over });
const poolWith = (lease: unknown, lockRevision = 3) =>
  ({ autoScore: { scoringLease: lease }, settings: { lockRevision } });

describe('readScoringLease — only a well-formed record counts', () => {
  it('reads owner + until', () => {
    expect(readScoringLease(poolWith({ owner: 'a', until: 5 }))).toEqual({ owner: 'a', until: 5 });
  });

  it('rejects malformed records rather than treating them as a held lease', () => {
    // A half-written record must not be able to wedge a pool permanently
    // unscoreable, nor to satisfy an owner check.
    expect(readScoringLease(undefined)).toBeUndefined();
    expect(readScoringLease({})).toBeUndefined();
    expect(readScoringLease(poolWith(null))).toBeUndefined();
    expect(readScoringLease(poolWith({ owner: 'a' }))).toBeUndefined();
    expect(readScoringLease(poolWith({ until: 5 }))).toBeUndefined();
    expect(readScoringLease(poolWith({ owner: 1, until: 5 }))).toBeUndefined();
  });
});

describe('readLockRevision', () => {
  it('defaults to 0 for a pool that has never had one', () => {
    expect(readLockRevision(undefined)).toBe(0);
    expect(readLockRevision({})).toBe(0);
    expect(readLockRevision({ settings: {} })).toBe(0);
  });

  it('ignores a non-numeric value instead of NaN-poisoning every comparison', () => {
    expect(readLockRevision({ settings: { lockRevision: 'seven' } })).toBe(0);
    expect(readLockRevision({ settings: { lockRevision: 7 } })).toBe(7);
  });
});

describe('leaseIsLive / leaseHeldByOther', () => {
  it('an expired lease is free', () => {
    expect(leaseIsLive({ owner: 'a', until: NOW }, NOW)).toBe(false);
    expect(leaseIsLive({ owner: 'a', until: NOW + 1 }, NOW)).toBe(true);
    expect(leaseIsLive(undefined, NOW)).toBe(false);
  });

  it('my own live lease is not "held by someone else"', () => {
    expect(leaseHeldByOther(poolWith({ owner: 'me', until: NOW + 1 }), 'me', NOW)).toBe(false);
    expect(leaseHeldByOther(poolWith({ owner: 'you', until: NOW + 1 }), 'me', NOW)).toBe(true);
    expect(leaseHeldByOther(poolWith({ owner: 'you', until: NOW - 1 }), 'me', NOW)).toBe(false);
  });
});

describe('checkFence — owner AND expiry AND revision, all three', () => {
  it('passes when all three still hold', () => {
    expect(() => checkFence(poolWith({ owner: 'me', until: NOW + 1 }), fence(), NOW)).not.toThrow();
  });

  it('fails when the lease was taken by someone else', () => {
    expect(() => checkFence(poolWith({ owner: 'you', until: NOW + 1 }), fence(), NOW))
      .toThrow(/FENCE_LOST/);
  });

  it('fails when MY OWN lease expired', () => {
    // codex r18: the case an owner-only check misses. A stalled worker whose
    // lease lapsed must not write after extendWeekDeadline legally committed an
    // override into the now-free lease — and it may still be the last owner on
    // record, so the owner check alone waves it through.
    expect(() => checkFence(poolWith({ owner: 'me', until: NOW }), fence(), NOW))
      .toThrow(/expired/);
  });

  it('fails when the lock revision moved under us', () => {
    expect(() => checkFence(poolWith({ owner: 'me', until: NOW + 1 }, 4), fence(), NOW))
      .toThrow(/lock changed/);
  });

  it('fails when the lease record is gone entirely', () => {
    expect(() => checkFence({ settings: { lockRevision: 3 } }, fence(), NOW)).toThrow(/FENCE_LOST/);
  });
});

describe('newLeaseOwner', () => {
  it('is unique per call — a shared token would not fence anything', () => {
    expect(newLeaseOwner()).not.toBe(newLeaseOwner());
  });
});

describe('retryWhileScoring', () => {
  const busy = () => { throw new Error(`${SCORING_IN_PROGRESS}: try later`); };

  it('retries a scoring-busy failure and returns the eventual success', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    const out = await retryWhileScoring(async () => {
      if (++calls < 3) busy();
      return 'ok';
    }, { sleep, delayMs: 1 });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt cap and rethrows', async () => {
    let calls = 0;
    await expect(retryWhileScoring(async () => { calls++; busy(); }, {
      attempts: 2, sleep: async () => undefined,
    })).rejects.toThrow(SCORING_IN_PROGRESS);
    expect(calls).toBe(2);
  });

  it('does NOT retry an unrelated error', async () => {
    // A validation failure retried four times is four times the damage and a
    // four-times-slower error for the member.
    let calls = 0;
    await expect(retryWhileScoring(async () => {
      calls++;
      throw new Error('TEAM_ALREADY_USED');
    }, { sleep: async () => undefined })).rejects.toThrow('TEAM_ALREADY_USED');
    expect(calls).toBe(1);
  });
});

describe('nextEntryRevision', () => {
  it('starts a legacy entry at 1 rather than leaving it invisible', () => {
    expect(nextEntryRevision(undefined)).toBe(1);
    expect(nextEntryRevision(null)).toBe(1);
    expect(nextEntryRevision('4')).toBe(1);
    expect(nextEntryRevision(NaN)).toBe(1);
    expect(nextEntryRevision(4)).toBe(5);
  });
});

describe('readEntryRevisionSum — fail toward an extra pass, never toward a skip', () => {
  const dbWith = (impl: () => unknown) => ({
    collection: () => ({ doc: () => ({ collection: () => ({ aggregate: () => ({ get: impl }) }) }) }),
  }) as never;

  it('returns the sum', async () => {
    expect(await readEntryRevisionSum(dbWith(async () => ({ data: () => ({ revisionSum: 12 }) })), 'p'))
      .toBe(12);
  });

  it('returns 0 for a pool whose entries carry no revision yet', async () => {
    expect(await readEntryRevisionSum(dbWith(async () => ({ data: () => ({ revisionSum: null }) })), 'p'))
      .toBe(0);
  });

  it('returns NULL — not 0 — when the aggregate throws', async () => {
    // 0 would be indistinguishable from "no entry has ever been mutated", so the
    // fingerprint would match and the pool would be skipped forever. Null makes
    // the caller score instead.
    expect(await readEntryRevisionSum(dbWith(() => { throw new Error('unavailable'); }), 'p'))
      .toBeNull();
  });
});

describe('publishedWeeks — the reveal marker and its cold-start backfill', () => {
  it('accepts both the string and number spelling of a week key', () => {
    expect(weekIsPublished({ publishedWeeks: { '2': true } }, 2)).toBe(true);
    expect(weekIsPublished({ publishedWeeks: { 2: true } }, 2)).toBe(true);
    expect(weekIsPublished({ publishedWeeks: { '2': false } }, 2)).toBe(false);
    expect(weekIsPublished({}, 2)).toBe(false);
    expect(weekIsPublished(undefined, 2)).toBe(false);
  });

  it('derives legacy weeks from scoredWeeks and scoredThroughWeek, unioned', () => {
    expect(legacyPublishedWeeks({ scoredWeeks: { '1': true, '3': true } })).toEqual([1, 3]);
    expect(legacyPublishedWeeks({ scoredThroughWeek: 3 })).toEqual([1, 2, 3]);
    expect(legacyPublishedWeeks({ scoredWeeks: { '5': true }, scoredThroughWeek: 2 }))
      .toEqual([1, 2, 5]);
    expect(legacyPublishedWeeks({ scoredWeeks: { '1': false } })).toEqual([]);
    expect(legacyPublishedWeeks({})).toEqual([]);
  });

  it('does NOT consult standings.current.lastScoredWeek', () => {
    // codex r5: that field is overwritten on every pass, so a late Week-1
    // correction resets it to 1 — a guard keyed off it would then permit a
    // Week-2 extension on an already-revealed week.
    expect(legacyPublishedWeeks({ standings: { current: { lastScoredWeek: 4 } } })).toEqual([]);
  });

  it('is idempotent — a re-run has nothing left to mark', () => {
    const pool = { scoredWeeks: { '1': true, '2': true }, publishedWeeks: { '1': true } };
    expect(missingPublishedWeeks(pool)).toEqual([2]);
    expect(missingPublishedWeeks({ ...pool, publishedWeeks: { '1': true, '2': true } })).toEqual([]);
  });
});

describe('extensionRefusal — the extendWeekDeadline publish guard', () => {
  it('allows an extension on a week nobody has seen', () => {
    expect(extensionRefusal({ publishedWeeks: { '1': true } }, 2, false)).toBeNull();
    expect(extensionRefusal({}, 1, false)).toBeNull();
  });

  it('refuses a week whose results are already published', () => {
    // The reveal guarantee cannot be broken retroactively: once the scorer has
    // shown Week 2's result, reopening its pick window lets a member pick a
    // known outcome.
    expect(extensionRefusal({ publishedWeeks: { '2': true } }, 2, false))
      .toBe('WEEK_ALREADY_PUBLISHED');
  });

  it('refuses while a scoring pass holds the lease', () => {
    // The marker alone cannot cover this: a pass in flight has not published
    // yet, so the marker is still unset while its grades are being written
    // against the pre-extension deadline.
    expect(extensionRefusal({}, 1, true)).toBe('SCORING_IN_PROGRESS');
  });

  it('reports the published refusal first when both apply', () => {
    // Ordering matters for the message the commissioner reads: "try again in a
    // moment" is wrong advice for a week that can never be extended again.
    expect(extensionRefusal({ publishedWeeks: { '1': true } }, 1, true))
      .toBe('WEEK_ALREADY_PUBLISHED');
  });
});
