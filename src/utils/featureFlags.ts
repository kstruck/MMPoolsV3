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
  // Closed in code beats anything the config says — see HARD_CLOSED_POOL_TYPES.
  if ((HARD_CLOSED_POOL_TYPES as readonly string[]).includes(type)) return false;
  return resolvePoolTypeFlags(settings)[type] ?? true;
}
