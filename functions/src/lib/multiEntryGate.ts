// PLAN-MULTI-ENTRY D8 — the `settings.maxEntriesPerUser` edit gate.
//
// Pure, so every refusal is unit-testable rather than inferred from a
// transaction. The caller evaluates `maxEntriesRefusal` INSIDE the transaction
// that writes, against the pool read in that same transaction: two managers
// saving at once must not let the later, smaller value land under a member
// who already holds entries the earlier, larger value admitted.
//
// "Only while the pool accepts entries" is the editability matrix
// (`shared/editability.ts`): the `settings` group is not editable once the
// pool is locked or archived, so this gate never sees those phases.
import { effectiveMaxEntriesPerUser, MAX_ENTRIES_PER_USER_CAP } from '../shared/multiEntry';

export const MAX_ENTRIES_SETTING_KEY = 'settings.maxEntriesPerUser';

export function touchesMaxEntriesSetting(patch: Record<string, unknown>): boolean {
    return MAX_ENTRIES_SETTING_KEY in patch;
}

/**
 * The manager UI re-sends a complete settings object on every save. A value
 * equal to the pool's EFFECTIVE max (absent ⇒ 1) is not a change: drop the key
 * so an ordinary save does not pay for a transaction plus a lease check, and so
 * a legacy pool with the field absent is not "changed" by re-saving 1.
 */
export function maxEntriesNoOpKeys(
    pool: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
): string[] {
    if (!touchesMaxEntriesSetting(patch)) return [];
    const current = effectiveMaxEntriesPerUser((pool?.settings ?? {}) as { maxEntriesPerUser?: unknown });
    return patch[MAX_ENTRIES_SETTING_KEY] === current ? [MAX_ENTRIES_SETTING_KEY] : [];
}

/** Raise-only (K6). Returns a user-facing message, or null when the write may proceed. */
export function maxEntriesRefusal(
    pool: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
): string | null {
    if (!touchesMaxEntriesSetting(patch)) return null;
    const incoming = patch[MAX_ENTRIES_SETTING_KEY];
    if (typeof incoming !== 'number' || !Number.isInteger(incoming) || incoming < 1 || incoming > MAX_ENTRIES_PER_USER_CAP) {
        return `MAX_ENTRIES_INVALID: entries per player must be a whole number from 1 to ${MAX_ENTRIES_PER_USER_CAP}.`;
    }
    const current = effectiveMaxEntriesPerUser((pool?.settings ?? {}) as { maxEntriesPerUser?: unknown });
    if (incoming < current) {
        return `MAX_ENTRIES_RAISE_ONLY: entries per player can be raised (currently ${current}) but never lowered — a member may already hold ${current}.`;
    }
    return null;
}
