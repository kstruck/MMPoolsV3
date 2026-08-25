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

/**
 * D9 — which `users/{uid}/seasonHistory/{docId}` document ONE ENTRY's season
 * record lands in.
 *
 * Entry #1 keeps `{poolId}` — byte-for-byte what every existing document
 * already is, so nothing migrates and every existing reader keeps working.
 * Extra entries get `{poolId}__e{n}`.
 *
 * 🛑 A DOUBLE UNDERSCORE, AND ONLY BECAUSE OF THE COLLISION A SINGLE ONE HAS.
 * Auto-generated pool ids never contain `_`, but a hand-made or imported one
 * can — and `{poolId}_2` would then be ambiguous between "entry 2 of pool X"
 * and "entry 1 of the pool literally named X_2". `__e` is not a shape a pool id
 * has ever taken here. It is still only a uniqueness device: the document
 * carries `poolId` and `entryId` as FIELDS and no reader parses the id.
 */
export function seasonHistoryDocIdFor(poolId: string, entryIndex: number | undefined): string {
  const idx = typeof entryIndex === 'number' && Number.isInteger(entryIndex) ? entryIndex : 1;
  return idx <= 1 ? poolId : `${poolId}__e${idx}`;
}

/** Default display name for an extra entry (K5): `"Kevin #2"`. Entry #1 has none — it shows `userName`. */
export function defaultEntryName(userName: string, entryIndex: number): string | undefined {
  return entryIndex <= 1 ? undefined : `${userName} #${entryIndex}`;
}
