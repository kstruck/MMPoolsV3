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
 * 🟢 TRUE since 2026-08-25, and the rule it was false for is the reason it is
 * true now: **never advertise entries nobody can play.** It stayed hidden
 * through T1 (the setting) and T2 (the server), because a commissioner could
 * have set a cap while the read side still merged a player's rows by uid and no
 * member had any UI to address entry #2. That is closed, in order:
 *
 *   T3 (#587) — scoring, reveal, finalize and profiles key by ENTRY id.
 *   T4 (#588) — `buildMemberStandings` renders one row per entry.
 *   T5 (#589) — the "My Entries" switcher; the three pick sheets send
 *               `entryIndex` + `entryName`; Survivor's rebuy names its entry.
 *   T6a       — every row surface displays `entryName ?? userName`, so two
 *               entries of one player are not indistinguishable duplicates.
 *
 * ⚠️ THE FLAG IS NOT THE FEATURE'S ONLY GATE, AND FLIPPING IT BACK IS SAFE.
 * It governs only whether the CONTROLS are rendered
 * (`wizard/create/MultiEntryFields.tsx`, `NFLManagerView`'s raise control).
 * Every pool keeps `effectiveMaxEntriesPerUser` = 1 unless a commissioner
 * raises it, `updatePoolSettings` is raise-only, and the server refuses
 * `entryIndex: 2` with `ENTRY_INDEX_EXCEEDS_MAX` on a max-1 pool. So setting
 * this back to `false` hides the offer without stranding a pool that already
 * took it — the manager control deliberately still renders when
 * `currentMaxEntries > 1`.
 *
 * The arc this asserts is a test, not a claim: see the FLIP block in
 * `functions/src/__tests__/emulator/multiEntry.emulator.test.ts` (wizard create
 * payload → two entries → the standings projection) and the "one row per ENTRY"
 * block in `src/utils/memberStandings.test.ts` (those artifacts → two rows).
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
