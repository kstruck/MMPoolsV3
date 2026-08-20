import { describe, it, expect, vi } from 'vitest';
import {
  applyFrozenSpreads,
  effectiveSpread,
  frozenSlateId,
  isUsableFrozenSpread,
  slateFieldsOf,
  FROZEN_SPREADS_COLLECTION,
  type FrozenSpread,
} from '../shared/frozenSpread';
import { readFrozenSpreadsByGameId, resolveGameSpreads } from '../lib/frozenSpreads';
import { plannedRecord } from '../migrations/backfillFrozenSpreads';
import { decideAlert, evaluateSlate, type WatchedGame, type WatchedPool } from '../lib/nflLockWatch';

/**
 * PLAN-NFL-SPREAD-FREEZE Revision 1, PR 1 — the write-once store and the reads.
 *
 * What these pin is the ONE thing the whole design rests on: `frozen ?? working`,
 * applied at the load, so that the gate, the grader, the fingerprint, the
 * tripwire and the pick sheet cannot individually disagree about which number a
 * week is played on. Two of the cases below are named in the plan because a codex
 * round found their absence — the tripwire crying wolf on a successful freeze
 * (revision round 4), and the backfill record omitting `source` (round 8).
 */

const frozen = (over: Partial<FrozenSpread> = {}): FrozenSpread => ({
  gameId: 'g1',
  value: -3.5,
  frozenAt: 1_700_000_000_000,
  season: '2026',
  seasonType: 1,
  week: 4,
  source: 'freeze',
  ...over,
});

/**
 * Minimal `Firestore` stand-in: `resolveGameSpreads` needs exactly
 * `collection().doc()` and `getAll()`.
 */
function fakeDb(store: Record<string, unknown>) {
  const seen: string[] = [];
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ __id: id, __col: name }) }),
    getAll: async (...refs: { __id: string; __col: string }[]) => {
      for (const r of refs) seen.push(`${r.__col}/${r.__id}`);
      return refs.map((r) => ({
        id: r.__id,
        exists: Object.prototype.hasOwnProperty.call(store, r.__id),
        data: () => store[r.__id],
      }));
    },
  };
  return { db: db as never, seen };
}

describe('effectiveSpread — the precedence rule', () => {
  it('prefers the frozen line over the working one', () => {
    expect(effectiveSpread(frozen({ value: -7 }), { value: -1.5, locked: false })).toEqual({ value: -7, locked: true });
  });

  it('reports a frozen line as LOCKED even when the working line is not', () => {
    // This is what keeps SPREADS_NOT_LOCKED, nflLockWatch coverage and the pick
    // sheet's own banner agreeing without any of them learning about the new
    // collection.
    expect(effectiveSpread(frozen(), { value: 0, locked: false })?.locked).toBe(true);
  });

  it('falls back to the working line when nothing is frozen', () => {
    expect(effectiveSpread(undefined, { value: -1.5, locked: false })).toEqual({ value: -1.5, locked: false });
  });

  it('leaves a game with neither spread undefined', () => {
    expect(effectiveSpread(undefined, undefined)).toBeUndefined();
  });

  it('treats a frozen value of 0 as a real line, not as missing', () => {
    // A pick-em game is spread 0. `?? `-style falsiness would silently discard it
    // and grade the week straight-up.
    expect(effectiveSpread(frozen({ value: 0 }), { value: -6, locked: true })).toEqual({ value: 0, locked: true });
  });

  it.each([
    ['a non-finite value', frozen({ value: NaN })],
    ['a missing value', { ...frozen(), value: undefined as unknown as number }],
    ['a string value', { ...frozen(), value: '-3' as unknown as number }],
  ])('treats %s as ABSENT and falls back rather than grading against it', (_label, rec) => {
    expect(isUsableFrozenSpread(rec)).toBe(false);
    expect(effectiveSpread(rec, { value: -6, locked: true })).toEqual({ value: -6, locked: true });
  });
});

describe('applyFrozenSpreads', () => {
  it('resolves only the games that carry a frozen record', () => {
    const games = [
      { id: 'g1', spread: { value: -1, locked: false } },
      { id: 'g2', spread: { value: -2, locked: false } },
    ];
    const out = applyFrozenSpreads(games, { g1: frozen({ gameId: 'g1', value: -9 }) });
    expect(out[0].spread).toEqual({ value: -9, locked: true });
    expect(out[1].spread).toEqual({ value: -2, locked: false });
  });

  it('gives a frozen record to a game that has no working spread at all', () => {
    const out = applyFrozenSpreads([{ id: 'g1' }], { g1: frozen({ value: 4.5 }) });
    expect((out[0] as { spread?: unknown }).spread).toEqual({ value: 4.5, locked: true });
  });

  it('NEVER MUTATES the input games', () => {
    // Resolved games are a read model. Writing one back to `nfl_games` would
    // stamp the frozen value onto the working line and re-create the shared
    // document this design exists to get away from.
    const games = [{ id: 'g1', spread: { value: -1, locked: false } }];
    const before = JSON.stringify(games);
    applyFrozenSpreads(games, { g1: frozen({ value: -9 }) });
    expect(JSON.stringify(games)).toBe(before);
  });
});

describe('frozenSlateId', () => {
  it('matches nflLockWatch.slateId', () => {
    expect(frozenSlateId({ season: '2026', seasonType: 1, week: 4 })).toBe('2026/1/4');
  });
});

describe('readFrozenSpreadsByGameId / resolveGameSpreads', () => {
  it('reads the frozen store by document id and resolves the slate', async () => {
    const { db, seen } = fakeDb({ g2: frozen({ gameId: 'g2', value: -6.5 }) });
    const out = await resolveGameSpreads(db, [
      { id: 'g1', spread: { value: -1, locked: false } },
      { id: 'g2', spread: { value: -2, locked: false } },
    ]);
    expect(seen).toEqual([`${FROZEN_SPREADS_COLLECTION}/g1`, `${FROZEN_SPREADS_COLLECTION}/g2`]);
    expect(out.map((g) => g.spread)).toEqual([
      { value: -1, locked: false },
      { value: -6.5, locked: true },
    ]);
  });

  it('drops a malformed record with a warning instead of grading against it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = fakeDb({ g1: { ...frozen(), value: null } });
    const got = await readFrozenSpreadsByGameId(db, ['g1']);
    expect(got).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not hit Firestore for an empty slate', async () => {
    const { db, seen } = fakeDb({});
    expect(await resolveGameSpreads(db, [])).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('de-duplicates repeated game ids', async () => {
    const { db, seen } = fakeDb({});
    await readFrozenSpreadsByGameId(db, ['g1', 'g1', 'g2']);
    expect(seen).toEqual([`${FROZEN_SPREADS_COLLECTION}/g1`, `${FROZEN_SPREADS_COLLECTION}/g2`]);
  });
});

describe('nflLockWatch coverage — a frozen slate must NOT page', () => {
  // Codex round 4 on the revision: coverage is derived from `spread.locked`, and
  // once the canonical line lives in its own collection an unresolved read makes
  // a perfectly frozen ATS slate look 0/16 locked — so the tripwire would page
  // inside the warning window on every week that WORKED. A tripwire that cries
  // wolf is worse than no tripwire.
  const kickoff = 1_700_000_000_000;
  const key = { season: '2026', seasonType: 1, week: 4 };
  const raw: WatchedGame[] = [
    { id: 'g1', ...key, startTime: kickoff, spread: { value: -3, locked: false } },
    // No working line at all — the preseason case that actually happened.
    { id: 'g2', ...key, startTime: kickoff + 3_600_000 },
  ];
  const pools: WatchedPool[] = [
    { id: 'p1', type: 'NFL_PICKEM', season: '2026', seasonType: 1, settings: { pickMode: 'ATS' } },
  ];
  const now = kickoff - 20 * 3_600_000; // inside any sane warning window

  it('pages when the slate is genuinely unfrozen', () => {
    const coverage = evaluateSlate(key, raw, pools);
    expect(coverage.locked).toBe(0);
    expect(decideAlert(coverage, now, 48).alert).toBe(true);
  });

  it('goes quiet once the same slate is resolved against the frozen store', () => {
    const resolved = applyFrozenSpreads(raw, {
      g1: frozen({ gameId: 'g1', value: -3 }),
      g2: frozen({ gameId: 'g2', value: 1.5 }),
    });
    const coverage = evaluateSlate(key, resolved, pools);
    expect(coverage.locked).toBe(2);
    expect(coverage.unlockedGameIds).toEqual([]);
    expect(coverage.missingLineGameIds).toEqual([]);
    expect(decideAlert(coverage, now, 48).alert).toBe(false);
  });
});

describe('backfillFrozenSpreads — plannedRecord', () => {
  const at = 1_700_000_000_000;
  const game = { season: '2026', seasonType: 1, week: 3, spread: { value: -3.5, locked: true } };

  it('stamps source=backfill and legacy=true', () => {
    // Both are load-bearing. The rescore trigger judges approval PER SOURCE, so a
    // record with no `source` is filed as an unapproved change for every legacy
    // game touched (codex round 8). `legacy` says this `frozenAt` is the backfill
    // instant, not a measured freeze instant.
    expect(plannedRecord('g1', game, at)).toEqual({
      gameId: 'g1',
      value: -3.5,
      frozenAt: at,
      season: '2026',
      seasonType: 1,
      week: 3,
      source: 'backfill',
      legacy: true,
    });
  });

  it('skips a game that is not locked', () => {
    expect(plannedRecord('g1', { ...game, spread: { value: -3.5, locked: false } }, at)).toEqual({ skip: 'not locked' });
    expect(plannedRecord('g1', { ...game, spread: undefined }, at)).toEqual({ skip: 'not locked' });
  });

  it('skips a locked game with no usable value rather than writing a bad line', () => {
    expect(plannedRecord('g1', { ...game, spread: { locked: true } }, at)).toEqual({
      skip: 'locked with no usable value',
    });
  });

  it('backfills a spread of 0', () => {
    const got = plannedRecord('g1', { ...game, spread: { value: 0, locked: true } }, at);
    expect(got).toMatchObject({ value: 0, source: 'backfill' });
  });

  it('refuses a record whose slate fields are malformed', () => {
    // The client subscribes by `season`, the freeze pass selects by the slate
    // triple, and a DELETE trigger can only recover the slate from the record's
    // own copy — a malformed slate would be invisible to all three.
    expect(plannedRecord('g1', { ...game, week: undefined }, at)).toMatchObject({ skip: expect.stringContaining('malformed slate') });
    expect(plannedRecord('g1', { ...game, season: '' }, at)).toMatchObject({ skip: expect.stringContaining('malformed slate') });
  });
});

describe('slateFieldsOf — `Number.isInteger` alone is not the test', () => {
  it('reads a good slate', () => {
    expect(slateFieldsOf({ season: 2026, seasonType: '1', week: 4 })).toEqual({ season: '2026', seasonType: 1, week: 4 });
  });

  it('REFUSES A NULL WEEK, which reads as 0 and 0 is an integer', () => {
    // Three call sites had independently written `Number.isInteger(week)` and all
    // three admitted a week-0 slate that does not exist. Found by an emulator test
    // on 2026-08-20 that expected a refusal and got a written frozen record.
    expect(slateFieldsOf({ season: '2026', seasonType: 1, week: null })).toBeNull();
    expect(slateFieldsOf({ season: '2026', seasonType: null, week: 4 })).toBeNull();
    expect(slateFieldsOf({ season: '2026', seasonType: 0, week: 4 })).toBeNull();
    expect(slateFieldsOf({ season: '2026', seasonType: 1, week: 0 })).toBeNull();
  });

  it('refuses a missing or non-numeric slate', () => {
    expect(slateFieldsOf(undefined)).toBeNull();
    expect(slateFieldsOf({ season: '', seasonType: 1, week: 4 })).toBeNull();
    expect(slateFieldsOf({ season: null, seasonType: 1, week: 4 })).toBeNull();
    expect(slateFieldsOf({ season: '2026', seasonType: 1, week: 'x' })).toBeNull();
    expect(slateFieldsOf({ season: '2026', seasonType: 1, week: 4.5 })).toBeNull();
  });
});
