import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The post-commit projection refresh must NEVER fail its caller.
 *
 * WHY THIS FILE EXISTS. `setPaidStatus` commits the Member Record, the ledger
 * row and the entry mirror in one transaction, then refreshes two derived
 * projections. Those refreshes used to run un-caught: a failure after the
 * commit rejected the callable, so a payment that WAS recorded surfaced to the
 * commissioner as a failure. The commissioner's natural retry then sends the
 * opposite state and reverses collected money.
 *
 * Asserting "returns false" is not enough on its own — the whole point is that
 * it RESOLVES rather than rejects, so the rejection case is asserted directly.
 */
vi.mock('../lib/rosterSummary', () => ({ recomputeRosterSummary: vi.fn() }));
vi.mock('../lib/commissionerAggregate', () => ({
  recomputeCommissionerAggregate: vi.fn(),
  ownerOf: (pool: any) => pool?.ownerId,
}));

import { refreshProjectionsBestEffort } from '../lib/refreshProjections';
import { recomputeRosterSummary } from '../lib/rosterSummary';
import { recomputeCommissionerAggregate } from '../lib/commissionerAggregate';

const db = {} as any;
const pool = { ownerId: 'owner-1' };

describe('refreshProjectionsBestEffort', () => {
  beforeEach(() => {
    vi.mocked(recomputeRosterSummary).mockReset().mockResolvedValue({} as any);
    vi.mocked(recomputeCommissionerAggregate).mockReset().mockResolvedValue({} as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('refreshes both projections and reports true on the happy path', async () => {
    await expect(refreshProjectionsBestEffort(db, 'pool-1', pool)).resolves.toBe(true);
    expect(recomputeRosterSummary).toHaveBeenCalledWith(db, 'pool-1');
    expect(recomputeCommissionerAggregate).toHaveBeenCalledWith(db, 'owner-1');
  });

  it('resolves false — never rejects — when the roster summary throws', async () => {
    vi.mocked(recomputeRosterSummary).mockRejectedValue(new Error('firestore unavailable'));
    // .resolves is the assertion that matters: a reject here is the defect.
    await expect(refreshProjectionsBestEffort(db, 'pool-1', pool)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('resolves false — never rejects — when the commissioner aggregate throws', async () => {
    vi.mocked(recomputeCommissionerAggregate).mockRejectedValue(new Error('deadline exceeded'));
    await expect(refreshProjectionsBestEffort(db, 'pool-1', pool)).resolves.toBe(false);
    // The roster summary still ran — a later failure must not un-do an earlier success.
    expect(recomputeRosterSummary).toHaveBeenCalledOnce();
  });

  it('skips the commissioner aggregate when the pool has no resolvable owner', async () => {
    await expect(refreshProjectionsBestEffort(db, 'pool-1', {})).resolves.toBe(true);
    expect(recomputeCommissionerAggregate).not.toHaveBeenCalled();
  });
});

describe('setPaidStatus routes its post-commit refresh through the best-effort helper', () => {
  // Source ratchet, same idiom as heartbeat.test.ts. Reverting either call site
  // back to a bare `await recomputeRosterSummary(...)` reintroduces the
  // reject-after-commit path, and no behavioural test above would notice.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'setPaidStatus.ts'),
    'utf8',
  ) as string;

  it('calls refreshProjectionsBestEffort on BOTH branches (rebuy settle and paid mark)', () => {
    expect(src.match(/refreshProjectionsBestEffort\(db, poolId, pool\)/g)?.length).toBe(2);
  });

  it('never calls the raw recompute helpers directly', () => {
    expect(src).not.toContain('recomputeRosterSummary(');
    expect(src).not.toContain('recomputeCommissionerAggregate(');
  });
});
