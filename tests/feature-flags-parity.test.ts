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

  it('HARD_CLOSED_POOL_TYPES match', () => {
    expect([...client.HARD_CLOSED_POOL_TYPES].sort()).toEqual([...server.HARD_CLOSED_POOL_TYPES].sort());
  });
});

/**
 * THE CLOSURE THE CONFIG CANNOT OUT-VOTE (codex r1 P1, 2026-08-28).
 *
 * Hiding the client entry points does not close anything — `createPool` is a
 * callable and reachable from DevTools. And a `false` DEFAULT would not have
 * closed it either: `resolvePoolTypeFlags` merges the stored config ON TOP of
 * the defaults, so a `poolTypeFlags.SQUARES: true` already sitting in
 * `system/config` would have silently reopened it.
 */
describe('hard-closed pool types', () => {
  it('SQUARES is refused on both sides, with no config at all', () => {
    expect(server.isPoolTypeEnabled(null, 'SQUARES')).toBe(false);
    expect(client.isPoolTypeEnabled(null, 'SQUARES')).toBe(false);
  });

  it('...and stays refused when the config explicitly enables it', () => {
    const on = { poolTypeFlags: { SQUARES: true } };
    expect(server.isPoolTypeEnabled(on, 'SQUARES')).toBe(false);
    expect(client.isPoolTypeEnabled({ poolTypeFlags: { SQUARES: true } }, 'SQUARES')).toBe(false);
  });

  it('closes SQUARES ONLY — the three live NFL types are untouched', () => {
    // The planted counter-example: a closure that caught the season's own pool
    // types would have taken creation down on launch week.
    for (const t of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const) {
      expect(server.isPoolTypeEnabled(null, t), t).toBe(true);
      expect(client.isPoolTypeEnabled(null, t), t).toBe(true);
      // ...and an admin can still turn one off through the config.
      expect(server.isPoolTypeEnabled({ poolTypeFlags: { [t]: false } }, t), t).toBe(false);
    }
  });

  it('the fail-open defaults are left alone, so a corrupt config cannot brick creation', () => {
    expect(server.DEFAULT_POOL_TYPE_FLAGS.SQUARES).toBe(true);
    expect(server.resolvePoolTypeFlags(undefined).SQUARES).toBe(true);
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
