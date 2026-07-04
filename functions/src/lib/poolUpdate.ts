// Pure decision logic for updatePoolSettings: given a pool doc and a requested
// settings update, validate every key against the editability matrix for the
// pool's current lifecycle phase and reconcile payment handles. Kept free of
// firebase-admin so it is unit-testable; the callable maps CLEAR -> FieldValue.delete().
import { HttpsError } from 'firebase-functions/v2/https';
import {
  normalizePhase,
  classifyUpdateKey,
  isGroupEditable,
} from '../shared/editability';
import { writePaymentHandles, CLEAR, LEGACY_TOP_LEVEL_HANDLE_KEYS } from '../shared/paymentHandles';

export interface PoolSettingsUpdatePlan {
  // Fields to set on the pool doc.
  set: Record<string, unknown>;
  // Legacy top-level handle fields to delete (out of sync after a handle edit).
  clearLegacy: string[];
}

/**
 * Throws HttpsError('failed-precondition') if any requested key is unknown or
 * not editable in the pool's current lifecycle phase. Otherwise returns the
 * sanitized update plan. When nested `paymentHandles` are edited, legacy
 * top-level fields are dual-written (or cleared) to stay in sync.
 */
export function buildPoolSettingsUpdate(
  pool: { isLocked?: boolean; status?: string } | null | undefined,
  updates: Record<string, unknown>,
): PoolSettingsUpdatePlan {
  const phase = normalizePhase(pool);
  const set: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const group = classifyUpdateKey(key);
    if (!group) {
      rejected.push(`${key} (not an editable field)`);
      continue;
    }
    if (!isGroupEditable(phase, group)) {
      rejected.push(`${key} (${group} is locked while the pool is ${phase})`);
      continue;
    }
    set[key] = value;
  }

  if (rejected.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `These changes are not allowed right now: ${rejected.join('; ')}.`,
    );
  }

  // Reconcile payment handles: when nested paymentHandles are edited, dual-write
  // the legacy top-level fields (clearing any that are now empty).
  const clearLegacy: string[] = [];
  if (set.paymentHandles && typeof set.paymentHandles === 'object') {
    const patch = writePaymentHandles(set.paymentHandles as Record<string, string>);
    set.paymentHandles = patch.paymentHandles;
    for (const k of LEGACY_TOP_LEVEL_HANDLE_KEYS) {
      if (patch[k] === CLEAR) {
        clearLegacy.push(k);
        delete set[k];
      } else {
        set[k] = patch[k];
      }
    }
  }

  return { set, clearLegacy };
}
