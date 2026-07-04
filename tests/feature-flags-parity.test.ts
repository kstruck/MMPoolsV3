import { describe, it, expect } from 'vitest';
import * as client from '../src/utils/featureFlags';
import * as server from '../functions/src/lib/featureFlags';

// The client mirror and the functions source-of-truth live in separate,
// module-incompatible TS roots, so the flag constants are duplicated. This
// test fails CI the moment they drift.
describe('feature-flag parity (client mirror vs functions source of truth)', () => {
  it('POOL_TYPES lists match', () => {
    expect([...client.POOL_TYPES].sort()).toEqual([...server.POOL_TYPES].sort());
  });

  it('DEFAULT_POOL_TYPE_FLAGS match', () => {
    expect(client.DEFAULT_POOL_TYPE_FLAGS).toEqual(server.DEFAULT_POOL_TYPE_FLAGS);
  });

  it('DEFAULT_MAINTENANCE_MODE match', () => {
    expect(client.DEFAULT_MAINTENANCE_MODE).toBe(server.DEFAULT_MAINTENANCE_MODE);
  });

  it('defaults are fail-open (every type enabled)', () => {
    for (const t of client.POOL_TYPES) {
      expect(client.DEFAULT_POOL_TYPE_FLAGS[t]).toBe(true);
    }
  });
});

describe('flag resolution semantics (shared behavior)', () => {
  it('a partial config only overrides the named types; the rest stay enabled', () => {
    const resolved = server.resolvePoolTypeFlags({ NFL_SURVIVOR: false });
    expect(resolved.NFL_SURVIVOR).toBe(false);
    expect(resolved.SQUARES).toBe(true);
    expect(resolved.BRACKET).toBe(true);
  });

  it('isPoolTypeEnabled fails open for a missing config', () => {
    expect(server.isPoolTypeEnabled(null, 'NFL_MARGIN')).toBe(true);
    expect(client.isPoolTypeEnabled(null, 'NFL_MARGIN')).toBe(true);
  });

  it('isPoolTypeEnabled honors an explicit disable', () => {
    expect(server.isPoolTypeEnabled({ poolTypeFlags: { PROPS: false } }, 'PROPS')).toBe(false);
    expect(client.isPoolTypeEnabled({ poolTypeFlags: { PROPS: false } }, 'PROPS')).toBe(false);
  });

  it('isMaintenanceMode defaults false, true only when explicit', () => {
    expect(server.isMaintenanceMode(null)).toBe(false);
    expect(server.isMaintenanceMode({ maintenanceMode: true })).toBe(true);
  });
});
