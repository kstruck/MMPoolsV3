/**
 * Feature-flag SOURCE OF TRUTH (functions side).
 *
 * The client has a mirror at src/utils/featureFlags.ts. They live in separate,
 * module-incompatible TS roots so the constants are duplicated; a root vitest
 * parity test (tests/feature-flags-parity.test.ts) imports both and asserts
 * deep equality, failing CI on drift.
 *
 * This module is PURE (no firebase-admin) so it can be imported from the
 * client-side test context. Doc reads live in systemGuards.ts.
 */

export const POOL_TYPES = [
  'SQUARES',
  'BRACKET',
  'NFL_PLAYOFFS',
  'PROPS',
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
] as const;

export type PoolType = (typeof POOL_TYPES)[number];

/**
 * Fail-open default: every pool type enabled. This mirrors the current live
 * posture (flags were previously dead code, so all types were creatable) so a
 * missing/corrupt system/config doc can never brick pool creation.
 */
export const DEFAULT_POOL_TYPE_FLAGS: Record<PoolType, boolean> = {
  SQUARES: true,
  BRACKET: true,
  NFL_PLAYOFFS: true,
  PROPS: true,
  NFL_PICKEM: true,
  NFL_SURVIVOR: true,
  NFL_MARGIN: true,
};

/**
 * POOL TYPES CLOSED IN CODE, WHICH `system/config.poolTypeFlags` CANNOT REOPEN.
 *
 * 🟢 EMPTY SINCE PLAN-SQUARES-REOPEN PR-D (2026-11). It held 'SQUARES' from
 * 2026-08-28 (Kevin: *"do not allow any Squares pools from being purchased or
 * setup for now"*) until the defects behind that closure were fixed.
 *
 * The MECHANISM stays, and is tested with a planted type
 * (`hardClosedMechanism.test.ts`), because it is the one closure that holds
 * against everything: it is checked BEFORE `poolTypeFlags` and ignores it, it
 * is not crossed by the simulator's bypass, and it also refuses purchase and
 * activation of a pool of that type. A stored `poolTypeFlags.X: true` cannot
 * out-vote it.
 *
 * To close a type for good, list it here AND in the other copy (the client's
 * `src/utils/featureFlags.ts` / the server's `functions/src/lib/
 * featureFlags.ts` — `tests/feature-flags-parity.test.ts` fails if they
 * differ), then `npx firebase deploy` and rebuild `www`. To close one quickly
 * and without a deploy, use `poolTypeFlags` instead.
 *
 * The fail-open defaults are untouched, so a missing or corrupt config still
 * cannot brick creation for any type.
 */
export const HARD_CLOSED_POOL_TYPES: readonly PoolType[] = [];

export const DEFAULT_MAINTENANCE_MODE = false;

export interface FlagConfig {
  poolTypeFlags?: Partial<Record<string, boolean>>;
  maintenanceMode?: boolean;
  /**
   * The squares winner-record pause. Declared here because this is the shape
   * of `system/config`; it is NOT read through this module. `squaresPause.ts`
   * reads it inside the transaction that would write the winners, which is the
   * only place a pause can be honoured without a race.
   */
  squaresWinners?: { paused?: boolean };
}

/** Merge a raw config's poolTypeFlags over the fail-open defaults. */
export function resolvePoolTypeFlags(
  raw?: Partial<Record<string, boolean>>
): Record<PoolType, boolean> {
  const out = { ...DEFAULT_POOL_TYPE_FLAGS };
  if (raw) {
    for (const t of POOL_TYPES) {
      if (typeof raw[t] === 'boolean') out[t] = raw[t] as boolean;
    }
  }
  return out;
}

/** True if the given pool type may be created. Unknown types fail open (allow). */
export function isPoolTypeEnabled(cfg: FlagConfig | null | undefined, type: string): boolean {
  // Closed in code beats anything the config says — see HARD_CLOSED_POOL_TYPES.
  if ((HARD_CLOSED_POOL_TYPES as readonly string[]).includes(type)) return false;
  const flags = resolvePoolTypeFlags(cfg?.poolTypeFlags);
  return (flags as Record<string, boolean>)[type] ?? true;
}

/** True only when maintenance mode is explicitly on (default false). */
export function isMaintenanceMode(cfg: FlagConfig | null | undefined): boolean {
  return cfg?.maintenanceMode === true;
}
