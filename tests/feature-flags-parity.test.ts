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
 * callable and reachable from DevTools. And a `false` DEFAULT would not close
 * a type either: `resolvePoolTypeFlags` merges the stored config ON TOP of the
 * defaults, so a `poolTypeFlags.X: true` already sitting in `system/config`
 * would silently reopen it. `HARD_CLOSED_POOL_TYPES` is the list that config
 * cannot out-vote.
 *
 * 🟢 THE LIST IS EMPTY since squares reopened (PLAN-SQUARES-REOPEN PR-D). The
 * first block pins that. The second keeps the MECHANISM honest by planting a
 * type in the real list — a rule with nothing in its list is the kind that
 * rots without anyone seeing it.
 */
describe('hard-closed pool types — none, since squares reopened', () => {
  it('nothing is hard-closed on either side', () => {
    expect([...server.HARD_CLOSED_POOL_TYPES]).toEqual([]);
    expect([...client.HARD_CLOSED_POOL_TYPES]).toEqual([]);
  });

  it('SQUARES is open on both sides, with no config at all', () => {
    expect(server.isPoolTypeEnabled(null, 'SQUARES')).toBe(true);
    expect(client.isPoolTypeEnabled(null, 'SQUARES')).toBe(true);
  });

  it('...and follows the config like every other type: false closes it, true opens it', () => {
    for (const t of client.POOL_TYPES) {
      expect(server.isPoolTypeEnabled(null, t), t).toBe(true);
      expect(client.isPoolTypeEnabled(null, t), t).toBe(true);
      expect(server.isPoolTypeEnabled({ poolTypeFlags: { [t]: false } }, t), t).toBe(false);
      expect(client.isPoolTypeEnabled({ poolTypeFlags: { [t]: false } }, t), t).toBe(false);
      expect(server.isPoolTypeEnabled({ poolTypeFlags: { [t]: true } }, t), t).toBe(true);
      expect(client.isPoolTypeEnabled({ poolTypeFlags: { [t]: true } }, t), t).toBe(true);
    }
  });

  it('the fail-open defaults are left alone, so a corrupt config cannot brick creation', () => {
    expect(server.DEFAULT_POOL_TYPE_FLAGS.SQUARES).toBe(true);
    expect(server.resolvePoolTypeFlags(undefined).SQUARES).toBe(true);
  });
});

describe('the hard-close mechanism, with a type planted in the real list', () => {
  // The lists are module constants. Planting into them exercises the real
  // `isPoolTypeEnabled` on each side, not a copy of it.
  const plant = (list: readonly string[], type: string) => {
    (list as string[]).push(type);
    return () => { (list as string[]).length = 0; };
  };

  it('a listed type is refused on both sides whatever the config says — and only that type', () => {
    const undo = [plant(server.HARD_CLOSED_POOL_TYPES, 'PROPS'), plant(client.HARD_CLOSED_POOL_TYPES, 'PROPS')];
    try {
      for (const cfg of [null, {}, { poolTypeFlags: { PROPS: true } }]) {
        expect(server.isPoolTypeEnabled(cfg, 'PROPS')).toBe(false);
        expect(client.isPoolTypeEnabled(cfg, 'PROPS')).toBe(false);
      }
      // The planted counter-example: a closure that caught the season's own
      // pool types would take creation down with it.
      for (const t of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'SQUARES'] as const) {
        expect(server.isPoolTypeEnabled(null, t), t).toBe(true);
        expect(client.isPoolTypeEnabled(null, t), t).toBe(true);
      }
    } finally {
      undo.forEach((u) => u());
    }
    // And the plant is gone: the next test sees the shipped, empty list.
    expect(server.isPoolTypeEnabled(null, 'PROPS')).toBe(true);
    expect(client.isPoolTypeEnabled(null, 'PROPS')).toBe(true);
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
