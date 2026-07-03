/**
 * Feature-flag MIRROR (client side). Source of truth is
 * functions/src/lib/featureFlags.ts — keep these constants identical; a root
 * vitest parity test (tests/feature-flags-parity.test.ts) fails CI on drift.
 *
 * Client checks are UX only; the server guard (systemGuards.ts) is authoritative.
 */
import type { PoolType, SystemSettings } from '../types';

export const POOL_TYPES: PoolType[] = [
  'SQUARES',
  'BRACKET',
  'NFL_PLAYOFFS',
  'PROPS',
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
];

/** Fail-open default: every pool type enabled (mirrors current live posture). */
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

/** Merge a settings doc's poolTypeFlags over the fail-open defaults. */
export function resolvePoolTypeFlags(
  settings: Pick<SystemSettings, 'poolTypeFlags'> | null | undefined
): Record<PoolType, boolean> {
  const out = { ...DEFAULT_POOL_TYPE_FLAGS };
  const raw = settings?.poolTypeFlags;
  if (raw) {
    for (const t of POOL_TYPES) {
      if (typeof raw[t] === 'boolean') out[t] = raw[t] as boolean;
    }
  }
  return out;
}

/** True if the given pool type may be created. Unknown types fail open. */
export function isPoolTypeEnabled(
  settings: Pick<SystemSettings, 'poolTypeFlags'> | null | undefined,
  type: PoolType
): boolean {
  return resolvePoolTypeFlags(settings)[type] ?? true;
}
