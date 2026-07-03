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

export const DEFAULT_MAINTENANCE_MODE = false;

export interface FlagConfig {
  poolTypeFlags?: Partial<Record<string, boolean>>;
  maintenanceMode?: boolean;
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
  const flags = resolvePoolTypeFlags(cfg?.poolTypeFlags);
  return (flags as Record<string, boolean>)[type] ?? true;
}

/** True only when maintenance mode is explicitly on (default false). */
export function isMaintenanceMode(cfg: FlagConfig | null | undefined): boolean {
  return cfg?.maintenanceMode === true;
}
