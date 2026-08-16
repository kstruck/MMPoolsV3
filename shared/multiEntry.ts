/**
 * Multiple entries per player (PLAN-MULTI-ENTRY D1/D8). PURE — no Firebase.
 *
 * `settings.maxEntriesPerUser` on the three NFL season types. Absent on every
 * pool created before the setting existed, so every reader goes through
 * `effectiveMaxEntriesPerUser` (absent ⇒ 1). The wizard's upper bound is K2.
 */
export const MAX_ENTRIES_PER_USER_CAP = 10;

/**
 * Whether the wizard OFFERS multi-entry. Flipped to true by T2 — the PR that
 * made `submitNFLPicks` honour `entryIndex`, so a pool created at max 3 really
 * admits three entries per player. (T1 shipped it false because the submit
 * path still wrote `entries/{uid}` and the option would have been a lie.)
 */
export const MULTI_ENTRY_WIZARD_ENABLED = true;

/** K5 — `entryName` on `submitNFLPicks`, trimmed, ≤ 30 chars. */
export const ENTRY_NAME_MAX = 30;

export function effectiveMaxEntriesPerUser(settings: { maxEntriesPerUser?: unknown } | null | undefined): number {
  const n = settings?.maxEntriesPerUser;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_ENTRIES_PER_USER_CAP) : 1;
}

/**
 * K1 — entry identity. Entry #1 keeps `entryId === uid` (zero migration: every
 * existing NFL entry doc is already in the new shape); extras are `e${n}:${uid}`.
 * Index PREFIX with a `:` separator, because a uid can contain `_` (sim/test
 * uids do — `mr_boss`) so a `${uid}_${n}` suffix collides: user `a` entry 2 vs
 * user `a_2` entry 1.
 *
 * The id is a CONVENIENCE, not an invariant — readers never parse it; every
 * entry doc carries `ownerUid` + `entryIndex`. The create path falls back to
 * an auto-id when the deterministic doc exists under a different owner (§0a).
 */
export function entryIdFor(uid: string, entryIndex: number): string {
  return entryIndex <= 1 ? uid : `e${entryIndex}:${uid}`;
}

/** Default display name for an extra entry (K5): `"Kevin #2"`. Entry #1 has none — it shows `userName`. */
export function defaultEntryName(userName: string, entryIndex: number): string | undefined {
  return entryIndex <= 1 ? undefined : `${userName} #${entryIndex}`;
}
