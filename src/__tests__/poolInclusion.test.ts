import { describe, it, expect } from 'vitest';
import { isActiveManagedPool } from '../utils/poolSport';

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

  it('excludes sim-* test pools even when otherwise active', () => {
    expect(isActiveManagedPool({ type: 'NFL_PICKEM', status: 'OPEN', id: 'sim-abc' })).toBe(false);
    expect(isActiveManagedPool({ type: 'SQUARES', status: 'OPEN', slug: 'sim-xyz' })).toBe(false);
  });

  it('includes a live squares pool', () => {
    expect(isActiveManagedPool({ type: 'SQUARES', scores: { gameStatus: 'in' }, id: 'p2' })).toBe(true);
  });
});
