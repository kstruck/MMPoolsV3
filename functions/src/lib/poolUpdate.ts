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
import { isPinnableMessageId } from '../shared/pinnedMessage';
import { usesWeeklyHardLock, normalizeLockBufferMinutes } from '../shared/weeklyHardLock';
import { MAX_TEAM_USES } from '../shared/survivorReuse';
import { MAX_ENTRIES_PER_USER_CAP } from '../shared/multiEntry';

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
    // The matrix decides which KEYS may be written; it says nothing about their
    // values. `pinnedMessageId` is the one key here whose value becomes a
    // Firestore PATH SEGMENT on the client, and an id containing `/` (or a
    // non-string) makes `doc()` throw inside the effect every member runs.
    // (codex r1 [P2].)
    if (key === 'pinnedMessageId' && !isPinnableMessageId(value)) {
      rejected.push(`${key} (not a valid message id)`);
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

// ---------------------------------------------------------------------------
// Merge-preserving settings writes (PLAN-REALTIME-SCORING §3a, PR-B′)
// ---------------------------------------------------------------------------

/**
 * Nested `settings.*` keys the SERVER owns. A client may never write them, and
 * a client save must never be able to erase them.
 *
 * `weekLockOverrides` is the one an attacker would want: setting it after a
 * result is published reopens picks on a known outcome. `lockRevision` is the
 * concurrency protocol's backstop — a client that could reset it would let a
 * scoring pass that should have been invalidated commit anyway.
 */
export const SERVER_OWNED_SETTINGS_KEYS: readonly string[] = ['weekLockOverrides', 'lockRevision'];

/**
 * Settings whose value changes WHEN a pick locks, and therefore what the scorer
 * is allowed to reveal. A write touching any of these has to serialize with a
 * live scoring pass and bump `settings.lockRevision` (see poolOps.updatePoolSettings).
 *
 * `confidenceMode` is on the list because submission derives weekly-lock mode
 * from `settings.confidenceMode || settings.lockMode === 'WEEKLY'` — flipping it
 * silently converts a Pick'em pool from per-game to weekly locking.
 */
export const LOCK_AFFECTING_SETTINGS_KEYS: readonly string[] =
  ['lockMode', 'lockBufferMinutes', 'confidenceMode', 'weekLockOverrides'];

/** Widest Pick'em buffer we will store: a full day before the first kickoff. */
const MAX_PICKEM_LOCK_BUFFER_MINUTES = 24 * 60;



export function touchesLockSettings(patch: Record<string, unknown>): boolean {
  // `flattenSettingsPatch` always expands a `settings` key into dotted paths, so
  // the first test is the real one. The second is defence against a future caller
  // that skips the flatten: an unexamined whole-settings write must be treated as
  // lock-affecting, not waved through.
  return LOCK_AFFECTING_SETTINGS_KEYS.some((k) => `settings.${k}` in patch)
    || 'settings' in patch;
}

/** Firestore field paths split on `.`; a settings key containing one would
 *  silently write somewhere else entirely. Reject anything unusual outright. */
const SAFE_SETTINGS_KEY = /^[A-Za-z0-9_]{1,100}$/;

/**
 * Turn a whole-`settings` replacement into per-key dotted updates.
 *
 * WHY THIS EXISTS. `NFLManagerView` sends a COMPLETE `settings` object, and its
 * per-type branches omit `weekLockOverrides`/`lockRevision` entirely. A
 * Firestore `update({ settings: {...} })` REPLACES the map — so an ordinary
 * "save settings" click after a commissioner extended a deadline would silently
 * delete the accepted extension and reset the revision protocol. Writing
 * `settings.<key>` per key carries every server-owned field through untouched.
 *
 * It is also where the server-only rule is enforced for real: `firestore.rules`
 * `affectedKeys()` only reports the TOP-LEVEL `settings` key, so no rules-level
 * field list can see an override injected inside a wholesale settings write.
 * Blocking direct client `settings` writes at the rules layer and validating
 * nested keys HERE is the pair that closes it.
 */
export function flattenSettingsPatch(
  set: Record<string, unknown>,
  poolType: string | undefined,
): Record<string, unknown> {
  if (!('settings' in set)) return set;
  const raw = set.settings;
  const { settings: _dropped, ...rest } = set;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'settings must be an object.');
  }

  const hardLock = usesWeeklyHardLock(poolType);
  const out: Record<string, unknown> = { ...rest };
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SAFE_SETTINGS_KEY.test(key)) {
      rejected.push(`settings.${key} (not a valid settings key)`);
      continue;
    }
    if (SERVER_OWNED_SETTINGS_KEYS.includes(key)) {
      rejected.push(`settings.${key} (managed by the server)`);
      continue;
    }
    if (hardLock && key === 'lockMode') {
      // Not an error — the UI has no control for it, and forcing rather than
      // rejecting keeps a legacy payload from failing the whole save.
      out['settings.lockMode'] = 'WEEKLY';
      continue;
    }
    if (key === 'lockBufferMinutes') {
      if (hardLock) {
        // Protecting the field is not enough (codex r29): once direct writes are
        // blocked, a manager can still call this callable with 0/15/arbitrary and
        // move the "hard" deadline. Snap it to an allowed preset on the way in.
        out['settings.lockBufferMinutes'] = normalizeLockBufferMinutes(value);
        continue;
      }
      // Pick'em keeps a free-form buffer, but not an ARBITRARY one (codex r3).
      // `effectiveGameLockAt` computes `kickoff - buffer`, so a NEGATIVE buffer
      // moves the lock AFTER kickoff and lets picks be changed on a game whose
      // result is already published — the reveal hole `publishedWeeks` does not
      // cover, because that marker only guards deadline EXTENSIONS. Rejected
      // rather than clamped so a mis-set value is visible instead of silently
      // reinterpreted.
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > MAX_PICKEM_LOCK_BUFFER_MINUTES) {
        rejected.push(
          `settings.lockBufferMinutes (must be between 0 and ${MAX_PICKEM_LOCK_BUFFER_MINUTES} minutes)`,
        );
        continue;
      }
      out['settings.lockBufferMinutes'] = n;
      continue;
    }
    // Survivor parity settings. `updatePoolSettingsSchema.updates` is
    // `z.record(z.string(), z.unknown())` — permissive, which means these arrive
    // UNVALIDATED. A negative `maxTeamUses` sliding through would read as
    // "unlimited" to any `> 0` test, so reject rather than coerce: a mis-set
    // value must be visible, not silently reinterpreted.
    if (key === 'tieCountsAs') {
      if (value !== 'WIN' && value !== 'LOSS') {
        rejected.push(`settings.tieCountsAs (must be WIN or LOSS)`);
        continue;
      }
      out['settings.tieCountsAs'] = value;
      continue;
    }
    if (key === 'maxTeamUses') {
      // A NUMBER, not something Number() can chew into one. `Number('')` is 0 —
      // which is the "unlimited" sentinel — so an empty-string field from some
      // future form would quietly remove the restriction it was meant to set.
      // That is the same hazard as the negative value, wearing a different hat.
      const n = value;
      // Capped at the number of weeks a season can hold: above that the limit
      // is indistinguishable from unlimited, which `0` already expresses.
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_TEAM_USES) {
        rejected.push(
          `settings.maxTeamUses (must be a whole number from 0 to ${MAX_TEAM_USES}; 0 means unlimited)`,
        );
        continue;
      }
      out['settings.maxTeamUses'] = n;
      continue;
    }
    if (key === 'maxEntriesPerUser') {
      // PLAN-MULTI-ENTRY D8. Same reasoning as maxTeamUses: `updates` arrives
      // unvalidated, and a coerced value would be silently reinterpreted.
      // Raise-only is judged in updatePoolSettings' transaction (multiEntryGate);
      // this is only the shape.
      const n = value;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_ENTRIES_PER_USER_CAP) {
        rejected.push(`settings.maxEntriesPerUser (must be a whole number from 1 to ${MAX_ENTRIES_PER_USER_CAP})`);
        continue;
      }
      out['settings.maxEntriesPerUser'] = n;
      continue;
    }
    out[`settings.${key}`] = value;
  }

  if (rejected.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `These changes are not allowed right now: ${rejected.join('; ')}.`,
    );
  }
  return out;
}
