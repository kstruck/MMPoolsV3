/**
 * Multiple entries per player (PLAN-MULTI-ENTRY D8). PURE — no Firebase.
 *
 * `settings.maxEntriesPerUser` on the three NFL season types. Absent on every
 * pool created before the setting existed, so every reader goes through
 * `effectiveMaxEntriesPerUser` (absent ⇒ 1). The wizard's upper bound is K2.
 */
export const MAX_ENTRIES_PER_USER_CAP = 10;

/**
 * Whether the wizard OFFERS multi-entry. False until PLAN-MULTI-ENTRY T2 ships
 * the submit path — until then `submitNFLPicks` still writes `entries/{uid}`,
 * so a pool created at max 3 would still admit one entry per player and the
 * option would be a lie (qodo #3 on #449). T1 ships the setting, the rules key
 * and the raise-only gate; T2 flips this to true in the same PR that honours it.
 */
export const MULTI_ENTRY_WIZARD_ENABLED = false;

export function effectiveMaxEntriesPerUser(settings: { maxEntriesPerUser?: unknown } | null | undefined): number {
  const n = settings?.maxEntriesPerUser;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_ENTRIES_PER_USER_CAP) : 1;
}
