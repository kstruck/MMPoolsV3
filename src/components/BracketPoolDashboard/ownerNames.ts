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
 * Distinct, truthy owner uids, in first-seen order.
 *
 * Callers use this to work out who still needs a name. The entries subscription
 * hands back a fresh array on every snapshot, and during live scoring a snapshot
 * lands whenever any score changes; re-reading every profile each time would be
 * a real cost now that these reads succeed (before this change they were free
 * only because they were being DENIED).
 */
export const ownerUidsOf = (entries: readonly OwnerNameEntry[]): string[] =>
    [...new Set(entries.map(e => e.ownerUid).filter((uid): uid is string => !!uid))];

/**
 * How many times ONE owner's profile may be read per mount before the fallback
 * name is accepted as the answer.
 *
 * There has to be a cap. A pool holding entries written before
 * `recomputeUserProfile` shipped has owners whose profile will never exist, and
 * retrying those forever would recreate the per-page-load read storm this whole
 * change removes — just with successful reads instead of denied ones.
 *
 * Four, not one, because the first read can lose a race it will win seconds
 * later: `recomputeUserProfile` is triggered BY the entry write, so the entries
 * snapshot reaches the client before the profile it causes (codex r1/r2 P2). In
 * development React's StrictMode double-invokes the effect and burns one
 * attempt on mount, which is the other reason this is not two.
 */
export const MAX_PROFILE_ATTEMPTS = 4;

/**
 * The minimum gap between two reads of the SAME profile — and so also how long
 * the dashboard waits before trying again. Long enough that a Cloud Function
 * trigger has time to write the doc, short enough that a member watching the
 * standings sees the real name without reloading.
 */
export const PROFILE_RETRY_MS = 10_000;

/** What one owner's profile reads have cost so far, in this mount. */
export interface OwnerProfileAttempt {
    count: number;
    /** `Date.now()` of the most recent read. */
    lastAt: number;
}

export type OwnerProfileAttempts = Readonly<Record<string, OwnerProfileAttempt>>;

interface RetryPolicy {
    maxAttempts?: number;
    /** Minimum gap between two reads of the SAME profile. */
    minIntervalMs?: number;
}

/**
 * The owners worth a profile read RIGHT NOW: no final name yet, budget left,
 * and not read again inside `minIntervalMs`.
 *
 * 🛑 The interval is what makes the budget a budget. Without it, four entries
 * snapshots in the same second — ordinary during live scoring — spend all four
 * attempts before the Cloud Function has written anything, and the fallback
 * name then stands until a reload (codex r3 P2). Attempts are meant to be
 * spread across the window, not raced through it.
 *
 * Pure so the policy is testable without a rendered dashboard: the component
 * keeps `resolved`/`attempts` in refs and does nothing else.
 */
export const pendingOwnerUids = (
    entries: readonly OwnerNameEntry[],
    resolved: ReadonlySet<string>,
    attempts: OwnerProfileAttempts,
    now: number,
    { maxAttempts = MAX_PROFILE_ATTEMPTS, minIntervalMs = PROFILE_RETRY_MS }: RetryPolicy = {}
): string[] =>
    ownerUidsOf(entries).filter(uid => {
        if (resolved.has(uid)) return false;
        const attempt = attempts[uid];
        if (!attempt) return true;
        if (attempt.count >= maxAttempts) return false;
        return now - attempt.lastAt >= minIntervalMs;
    });

/**
 * How long until some owner becomes eligible again, or null if none ever will
 * (everyone is final, or every budget is spent).
 *
 * The caller needs this because nothing else will wake it: the profile write
 * does not touch the entry, so it produces no entries snapshot, and an idle
 * pool produces none either (codex r2 P2).
 */
export const nextRetryDelay = (
    entries: readonly OwnerNameEntry[],
    resolved: ReadonlySet<string>,
    attempts: OwnerProfileAttempts,
    now: number,
    { maxAttempts = MAX_PROFILE_ATTEMPTS, minIntervalMs = PROFILE_RETRY_MS }: RetryPolicy = {}
): number | null => {
    const waits = ownerUidsOf(entries)
        .filter(uid => !resolved.has(uid) && (attempts[uid]?.count ?? 0) < maxAttempts)
        .map(uid => {
            const attempt = attempts[uid];
            return attempt ? Math.max(0, attempt.lastAt + minIntervalMs - now) : 0;
        });
    return waits.length > 0 ? Math.min(...waits) : null;
};

/**
 * Everything the dashboard remembers about owner names, scoped to ONE pool.
 *
 * 🛑 The scope is the point. `PoolRoute` renders the dashboard without a `key`,
 * so navigating from `/pool/a` straight to `/pool/b` REUSES the component
 * instance and every ref in it. An owner with no profile in the first pool
 * would arrive at the second with their budget spent and their first pool's
 * entry name still on screen — shown under the wrong bracket's label, with no
 * read left to correct it (codex r4 P2).
 */
export interface OwnerNameCache {
    poolId: string;
    /** Owners whose name came from a profile, and is therefore final. */
    resolved: Set<string>;
    attempts: Record<string, OwnerProfileAttempt>;
}

/**
 * The cache to use for `poolId`: the existing one if it belongs to that pool,
 * otherwise an empty one. Identity is the signal — a caller that gets back a
 * different object knows the pool changed and the name map must be dropped too.
 */
export const ownerNameCacheFor = (cache: OwnerNameCache | null, poolId: string): OwnerNameCache =>
    cache && cache.poolId === poolId
        ? cache
        : { poolId, resolved: new Set<string>(), attempts: {} };

/** A non-empty trimmed string, or null. Guards against `userName: ''` / `'   '`. */
const usableName = (value: string | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export interface OwnerNameResolution {
    /** uid -> display name, for the owners this call was asked about. */
    names: Record<string, string>;
    /**
     * The subset whose name came from a `publicProfiles` doc, and is therefore
     * FINAL — nothing later in the session can improve it.
     *
     * Everything else in `names` is a fallback and may still be waiting on a
     * profile that does not exist YET: `recomputeUserProfile` is triggered by
     * the entry write, so an entries snapshot can reach the client before the
     * profile it causes. A caller that remembers only this list retries the
     * rest on the next snapshot and picks the real name up when it lands —
     * remembering the whole owner set instead would freeze the fallback in
     * place for the life of the mount (codex r1 P2).
     */
    resolvedFromProfile: string[];
}

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
 *
 * `only` narrows WHICH owners are fetched (a caller that already holds final
 * names for the rest passes just the ones still outstanding). The full `entries`
 * list is still needed, because it carries the `entry.name` fallback.
 */
export const resolveOwnerNames = async (
    entries: readonly OwnerNameEntry[],
    fetchProfile: PublicProfileFetcher,
    only?: readonly string[]
): Promise<OwnerNameResolution> => {
    const uids = only ? [...new Set(only)] : ownerUidsOf(entries);

    const profiles = await Promise.all(
        uids.map(async (uid) => {
            try {
                return await fetchProfile(uid);
            } catch {
                return null;
            }
        })
    );

    const names: Record<string, string> = {};
    const resolvedFromProfile: string[] = [];
    uids.forEach((uid, i) => {
        const fromProfile = usableName(profiles[i]?.userName);
        if (fromProfile) resolvedFromProfile.push(uid);
        const fromEntry = usableName(entries.find(e => e.ownerUid === uid)?.name);
        names[uid] = fromProfile ?? fromEntry ?? OWNER_NAME_FALLBACK;
    });
    return { names, resolvedFromProfile };
};
