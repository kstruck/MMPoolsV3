/**
 * Bracket standings: uid -> display name, WITHOUT reading `users/{uid}`.
 *
 * The dashboard used to build this map with `userRepository.getById(uid)` for
 * every distinct entry owner. `firestore.rules` lets an ordinary member read
 * `users/{uid}` only when `uid` is their own, so every OTHER member's read came
 * back permission-denied — and `BaseRepository.getById` reports each failure
 * through `errorHandler.handleError`, which is one Sentry event AND one
 * `logClientError` callable + Firestore write PER OTHER MEMBER, PER PAGE LOAD.
 * A 20-member pool paid 19 of each every time anyone opened it. Super admins
 * pass the same rule, which is why the owner never saw it.
 * (Sentry march-melee-pools-web c810a0012edf4755ba408bcb1be0a279.)
 *
 * `publicProfiles/{uid}` is the sanitized public projection (ADR 0004/0005),
 * `allow read: if true`, and carries `userName`. Reading it is both permitted
 * and cheaper — no error path to report at all.
 *
 * The profile doc can legitimately be MISSING: it is written by
 * `recomputeUserProfile` on entry writes, so an entry submitted before that
 * trigger shipped has no profile. Hence the fallback chain below.
 */

/** The fields of a bracket entry this resolver reads. `BracketEntry` satisfies it. */
export interface OwnerNameEntry {
    ownerUid: string;
    /** The ENTRY's name, used as the second-choice display name. */
    name?: string;
}

/** The one field of `publicProfiles/{uid}` this resolver reads. */
export interface OwnerNameProfile {
    userName?: string;
}

/** Injected so the resolver is testable without Firestore. `dbService.getPublicProfile` fits. */
export type PublicProfileFetcher = (uid: string) => Promise<OwnerNameProfile | null>;

/** Shown when neither the public profile nor the entry supplies a usable name. */
export const OWNER_NAME_FALLBACK = 'Unknown';

/**
 * A stable key for the SET of owners in a list of entries.
 *
 * The entries subscription hands back a fresh array on every snapshot, and
 * during live scoring a snapshot lands whenever any score changes. Re-running
 * the resolver on each one would re-read every profile from the server — free
 * before this change only because the reads were being DENIED. Names cannot
 * have changed unless the owner set did, so callers re-resolve when this key
 * changes and skip when it does not.
 *
 * Order- and duplicate-insensitive: two entries by the same owner, or the same
 * owners arriving in a different order, are the same set of names to fetch.
 */
export const ownerSetKey = (entries: readonly OwnerNameEntry[]): string =>
    // A fresh array every call, so sorting it in place is safe.
    uniqueOwnerUids(entries).sort().join(',');

/** Distinct, truthy owner uids, in first-seen order. */
const uniqueOwnerUids = (entries: readonly OwnerNameEntry[]): string[] =>
    [...new Set(entries.map(e => e.ownerUid).filter((uid): uid is string => !!uid))];

/** A non-empty trimmed string, or null. Guards against `userName: ''` / `'   '`. */
const usableName = (value: string | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

/**
 * Resolve one display name per distinct entry owner.
 *
 * Fallback chain, in order:
 *   1. `publicProfiles/{uid}.userName`
 *   2. `entry.name` (the entry's own label — always present on a real entry)
 *   3. `'Unknown'`
 *
 * 🛑 The raw uid is NEVER a fallback. The pre-fix code ended its chain with
 * `|| uniqueUids[i]`, which put an opaque Firebase id in front of the reader
 * whenever a member had neither a name nor an email on their user doc.
 *
 * Never rejects: a fetch that throws is treated as "no profile" for that uid
 * only, so one unreadable profile cannot blank out the whole map. Callers that
 * used `Promise.all(...).catch()` got the opposite — the first rejection lost
 * every name.
 */
export const resolveOwnerNames = async (
    entries: readonly OwnerNameEntry[],
    fetchProfile: PublicProfileFetcher
): Promise<Record<string, string>> => {
    const uniqueUids = uniqueOwnerUids(entries);

    const profiles = await Promise.all(
        uniqueUids.map(async (uid) => {
            try {
                return await fetchProfile(uid);
            } catch {
                return null;
            }
        })
    );

    const map: Record<string, string> = {};
    uniqueUids.forEach((uid, i) => {
        const fromProfile = usableName(profiles[i]?.userName);
        const fromEntry = usableName(entries.find(e => e.ownerUid === uid)?.name);
        map[uid] = fromProfile ?? fromEntry ?? OWNER_NAME_FALLBACK;
    });
    return map;
};
