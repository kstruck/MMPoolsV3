/**
 * Multiple entries per player (PLAN-MULTI-ENTRY D8). PURE — no Firebase.
 *
 * `settings.maxEntriesPerUser` on the three NFL season types. Absent on every
 * pool created before the setting existed, so every reader goes through
 * `effectiveMaxEntriesPerUser` (absent ⇒ 1). The wizard's upper bound is K2.
 */
export const MAX_ENTRIES_PER_USER_CAP = 10;

export function effectiveMaxEntriesPerUser(settings: { maxEntriesPerUser?: unknown } | null | undefined): number {
  const n = settings?.maxEntriesPerUser;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_ENTRIES_PER_USER_CAP) : 1;
}
