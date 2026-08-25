/**
 * Which of a member's own entries is which (PLAN-MULTI-ENTRY T5 / D7).
 *
 * Pure, and deliberately NOT inside `EntrySwitcher.tsx`: the dashboard needs
 * `nextFreeEntryIndex` to build a draft and `sortOwnEntries` to resolve the
 * active entry, and exporting non-components from a component module both
 * breaks React Fast Refresh and invites the two callers to drift.
 */

/** The fields any own-entry consumer here reads. Entry documents carry much more. */
export interface OwnEntryLike {
    id?: string;
    /** PLAN-MULTI-ENTRY D1 — absent on a legacy `entries/{uid}` document ⇒ 1. */
    entryIndex?: number;
    entryName?: string;
}

/** The entry's index, with the legacy default. Absent is entry #1, not "unknown". */
export function entryIndexOf(entry: OwnEntryLike | null | undefined): number {
    return typeof entry?.entryIndex === 'number' ? entry.entryIndex : 1;
}

/** Entry #1 first, then by index, then by id — stable across snapshots. */
export function sortOwnEntries<T extends OwnEntryLike>(entries: readonly T[] | null | undefined): T[] {
    return [...(entries ?? [])].sort((a, b) =>
        entryIndexOf(a) - entryIndexOf(b) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
}

/**
 * The index a NEW entry would take: the lowest index this member does not
 * already hold, or `null` when they hold every index up to the cap.
 *
 * 🛑 NOT `count + 1`. Indexes are not guaranteed contiguous — an entry created
 * through the manager's proxy path can arrive at any index the cap allows — and
 * `count + 1` would then name an index that already exists. The server resolves
 * an existing index by RETURNING that entry rather than creating one
 * (`resolveOwnedEntry`), so the member would silently be editing a sheet they
 * did not choose, and their first save would overwrite it.
 *
 * 🛑 AND NEVER 1. Entry #1 is not something a member ADDS — it is the sheet
 * they already have, created by their first ordinary submit, and by contract it
 * carries no `entryName` (it displays their user name; `defaultEntryName`
 * returns undefined for index 1 and `submitNFLPicks` is only sent a name for an
 * extra entry). Offering it as an addable slot would invite a member to type a
 * name that the first save then silently discards. (codex r1 P2 on the T5 PR.)
 */
export function nextAddableEntryIndex(entries: readonly OwnEntryLike[] | null | undefined, maxEntries: number): number | null {
    const taken = new Set((entries ?? []).map(entryIndexOf));
    for (let i = 2; i <= maxEntries; i++) if (!taken.has(i)) return i;
    return null;
}

/** The label a row or tab shows for one entry (§0b.4) — `entryName ?? fallback`. */
export function entryLabelOf(entry: OwnEntryLike | null | undefined, fallback: string): string {
    return (typeof entry?.entryName === 'string' && entry.entryName) ? entry.entryName : fallback;
}
