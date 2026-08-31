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
 * 🛑 POOL TYPES CLOSED IN CODE, WHICH `system/config.poolTypeFlags` CANNOT REOPEN.
 *
 * Kevin, 2026-08-28: *"do not allow any Squares pools from being purchased or
 * setup for now."* The client switch (`src/config/season.ts`) hides the entry
 * points; THIS is the boundary that actually holds, because a callable is
 * reachable from DevTools or any custom client (codex r1 P1 on the closure PR).
 *
 * It is checked BEFORE `poolTypeFlags` and ignores it, deliberately. A stored
 * `poolTypeFlags.SQUARES: true` would otherwise override a `false` default and
 * silently reopen the very thing this closes — the merge in
 * `resolvePoolTypeFlags` puts the config on top. "Do not allow any" is not a
 * default anyone should be able to out-vote from a Firestore doc.
 *
 * The fail-open defaults below are untouched, so a missing or corrupt config
 * still cannot brick creation for every other type.
 *
 * Reopening is one line here plus `npx firebase deploy`, alongside the client
 * flip. Reason and fix list: `SQUARES-BACKLOG.md`.
 */
export const HARD_CLOSED_POOL_TYPES: readonly PoolType[] = ['SQUARES'];

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
