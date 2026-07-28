import { describe, it, expect } from 'vitest';
import { isActiveManagedPool } from '../utils/poolSport';
import { isSimPool } from '@shared/testPool';

describe('isActiveManagedPool', () => {
  it('includes an open string-status pool', () => {
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'OPEN', id: 'p1' })).toBe(true);
  });

  it('excludes completed, canceled, admin-closed, and archived pools', () => {
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'COMPLETED', id: 'p1' })).toBe(false);
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'CANCELED', id: 'p1' })).toBe(false);
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'OPEN', closedVia: 'ADMIN_CLOSE', id: 'p1' })).toBe(false);
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'archived', id: 'p1' })).toBe(false);
  });

  it('agrees with the canonical isSimPool on an ARRAY season — the divergence the copy carried', () => {
    // This file used to re-derive the sim rule with
    // `String(pool.season || '').startsWith('sim-')`, and `String(['sim-x'])` is
    // exactly 'sim-x'. So a Firestore ARRAY season forged a sim pool HERE while
    // the hardened `isSimPool` (codex r4, typeof === 'string') correctly said no
    // — a real pool silently dropped from the commissioner dashboard. Both must
    // now give the same answer, so the assertion is stated as agreement rather
    // than as a hardcoded expectation.
    const pool = { type: 'NFL_PICKEM', status: 'OPEN', id: 'p1', season: ['sim-x'] as unknown as string };
    expect(isSimPool(pool, 'p1')).toBe(false);
    expect(isActiveManagedPool(pool)).toBe(true);
  });

  it('excludes sim-* test pools even when otherwise active', () => {
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'OPEN', id: 'sim-abc' })).toBe(false);
    expect(isActiveManagedPool({ type: 'SQUARES', status: 'OPEN', slug: 'sim-xyz' })).toBe(false);
  });

  it('includes a live squares pool', () => {
    expect(isActiveManagedPool({ type: 'SQUARES', scores: { gameStatus: 'in' }, id: 'p2' })).toBe(true);
  });
});
