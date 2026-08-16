/**
 * Multiple entries per player (PLAN-MULTI-ENTRY D1/D8). PURE — no Firebase.
 *
 * `settings.maxEntriesPerUser` on the three NFL season types. Absent on every
 * pool created before the setting existed, so every reader goes through
 * `effectiveMaxEntriesPerUser` (absent ⇒ 1). The wizard's upper bound is K2.
 */
export const MAX_ENTRIES_PER_USER_CAP = 10;

/**
 * Whether the wizard (and the manager settings form) OFFERS multi-entry.
 *
 * STILL FALSE after T2. T2 made the SERVER honour `entryIndex` (submit, proxy,
 * rebuy, dues, entryCount), but a member has no UI to address entry #2 until
 * T5 (`PickemPickEntry`/`SurvivorPickEntry`/`MarginPickEntry` send no
 * `entryIndex`), and standings/reveal/finalize still key by uid until T3/T4.
 * Offering the toggle now would let a commissioner advertise entries nobody
 * can play — the same lie T1 hid it for (qodo #3 on #449; codex r1+r2 on the
 * T2 PR). The T3/T4/T5 PR that closes the read side flips this to true.
 * The submit path is exercised end-to-end regardless (emulator suite).
 */
export const MULTI_ENTRY_WIZARD_ENABLED = false;

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
