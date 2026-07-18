import { describe, it, expect } from 'vitest';
import { poolUsesSpreads } from '../nflScoringEngine';
import { poolIsBlockable, type WatchedPool } from '../lib/nflLockWatch';

// TOMORROW-TASKS NFL-1 — the SPREADS_NOT_LOCKED precondition in submitNFLPicks
// used to run unconditionally, blocking pick submission for every NFL pool over
// data most of them never read. This pins the predicate that scopes it.
//
// Why it mattered: the create wizard hardcodes pickMode 'STRAIGHT' and exposes
// no ATS control (CreateNFLPickemPool.tsx:72), so in practice EVERY pool was
// blocked by a check that protected none of them. Preseason surfaced it — the
// 2026 preseason feed carries a betting line on 1 of 49 games — but a
// spread-less regular-season week would have done the same.

const p = (over: Record<string, unknown> = {}) => ({
  type: 'NFL_PICKEM', settings: { pickMode: 'ATS' }, ...over,
} as any);

describe('poolUsesSpreads — the gate must cover exactly what the scorer consumes', () => {
  it('is true only for ATS pick\'em — the one mode gradePickemGames reads spread for', () => {
    expect(poolUsesSpreads(p())).toBe(true);
  });

  it('is false for straight-up pick\'em', () => {
    // gradePickemGames grades on raw scores when pickMode !== 'ATS'.
    expect(poolUsesSpreads(p({ settings: { pickMode: 'STRAIGHT' } }))).toBe(false);
  });

  it('is false when pickMode is absent — the only shape the wizard produces', () => {
    expect(poolUsesSpreads(p({ settings: {} }))).toBe(false);
    expect(poolUsesSpreads(p({ settings: undefined }))).toBe(false);
  });

  it('is false for survivor and margin — neither reads a spread under ANY setting', () => {
    expect(poolUsesSpreads(p({ type: 'NFL_SURVIVOR' }))).toBe(false);
    expect(poolUsesSpreads(p({ type: 'NFL_MARGIN' }))).toBe(false);
    // Even if a survivor pool somehow carried an ATS setting, it has no ATS
    // scoring path, so it must not be gated on spreads.
    expect(poolUsesSpreads({ type: 'NFL_SURVIVOR', settings: { pickMode: 'ATS' } } as any)).toBe(false);
  });

  it('is false for a non-NFL or malformed pool rather than throwing', () => {
    expect(poolUsesSpreads(null)).toBe(false);
    expect(poolUsesSpreads(undefined)).toBe(false);
    expect(poolUsesSpreads({} as any)).toBe(false);
    expect(poolUsesSpreads({ type: 'SQUARES' } as any)).toBe(false);
  });
});

describe('the two predicates must not drift apart', () => {
  // nflScoringEngine.poolUsesSpreads gates pick submission; lib/nflLockWatch
  // .poolIsBlockable decides whether the tripwire pages. They are separate
  // because the lock-watch module is pure and imports no scoring code — so if
  // they ever disagree, the alarm would page about pools that can still submit
  // (false alarm) or stay silent on pools that cannot (missed outage).
  const cases: Array<Partial<WatchedPool>> = [
    { type: 'NFL_PICKEM', settings: { pickMode: 'ATS' } },
    { type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT' } },
    { type: 'NFL_PICKEM', settings: {} },
    { type: 'NFL_PICKEM' },
    { type: 'NFL_SURVIVOR', settings: { pickMode: 'ATS' } },
    { type: 'NFL_SURVIVOR' },
    { type: 'NFL_MARGIN', settings: { pickMode: 'ATS' } },
    { type: 'NFL_MARGIN' },
  ];

  it.each(cases)('agree for %j', (c) => {
    const asWatched = { id: 'x', season: '2026', ...c } as WatchedPool;
    expect(poolIsBlockable(asWatched)).toBe(poolUsesSpreads(c as any));
  });
});
