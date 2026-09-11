/**
 * Display-name ownership — `users/{uid}.name` is the ONE source of truth, and
 * every per-pool copy of it follows.
 *
 * Why this file exists (2026-09-10). A pool's standings read
 * `pools/{id}/entries/{entryId}.userName`, and its member list / Payment Ledger
 * read `pools/{id}/members/{uid}.userName`. Both are COPIES taken at join or
 * pick time, and nothing ever refreshed them — so a member whose profile name
 * was fixed (by themselves on /profile, or by a super admin on the Members tab)
 * kept their old name on every pool page. The copies were seeded from the
 * login token's `name` claim first and the profile second, so a profile edit
 * did not even win on the NEXT pick: the token still carried the old name.
 *
 * Three rules, all enforced here:
 *
 *   1. `resolveSubjectName` — a write that stamps a name onto a pool copy asks
 *      the PROFILE first and the token second. The token is what Firebase Auth
 *      knew at sign-in; the profile is what the person (or an admin) last set.
 *   2. `userNameChanged` — the gate for the `users/{uid}` trigger. Pure, so the
 *      trigger's decision is unit-testable without Firestore.
 *   3. `propagateUserName` — pushes a changed profile name into every Member
 *      Record and every entry the uid owns, across every pool, without touching
 *      anything else on those documents. `entryName` (a player's custom entry
 *      label) is NOT a copy of the profile name and is left alone.
 *
 * Placeholders. `New User` was written by `createParticipantProfile` when the
 * Auth trigger fired before the client had set a display name (the race is
 * closed in participant.ts); `Unknown` / `Unknown User` are the client's own
 * fallbacks; `Member` / `Participant` / `Host` / `Player` are server fallbacks
 * on pool copies. A placeholder in the profile never OUTRANKS a real name from
 * the token, and a real profile name is never overwritten by one.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { pickPreferredName } from '../shared/displayName';

export { isPlaceholderName, PLACEHOLDER_DISPLAY_NAMES } from '../shared/displayName';

/**
 * Pick the name to stamp on a pool copy. Profile first, token second, and a
 * placeholder only when neither source has anything better.
 *
 *   real profile name              -> profile
 *   placeholder profile, real token -> token
 *   both placeholders              -> whichever is non-empty (profile first)
 *   nothing                        -> undefined (callers keep a stored name)
 */
export function pickSubjectName(profileName: unknown, tokenName: unknown): string | undefined {
  return pickPreferredName(profileName, tokenName);
}

/** One profile read, then `pickSubjectName`. Read OUTSIDE any transaction. */
export async function resolveSubjectName(db: Firestore, uid: string, tokenName: unknown): Promise<string | undefined> {
  const snap = await db.collection('users').doc(uid).get();
  return pickSubjectName(snap.data()?.name, tokenName);
}

/**
 * The trigger gate. Returns the name to propagate, or `null` when nothing
 * should happen:
 *   - the document was deleted (no `after`): account deletion has its own path;
 *   - the new name is empty;
 *   - an update that did not change `name` (the `lastLogin` stamp on sign-in).
 *
 * A CREATE propagates (qodo #690 finding 9): a profile can be recreated for
 * someone who already has pool copies — `syncAllUsers` re-materialises a
 * missing `users/{uid}` — and those copies must follow. For a genuinely new
 * signup the two collection-group reads find nothing and cost nothing more.
 *
 * A change TO a placeholder still propagates: the copies must equal the
 * profile, and a stale real name on a pool page would be a lie the profile
 * no longer tells. The client and the create triggers are the ones that stop
 * a placeholder from landing on a profile that already has a real name.
 */
export function userNameChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string | null {
  if (!after) return null;
  const next = typeof after.name === 'string' ? after.name.trim() : '';
  if (!next) return null;
  if (!before) return next;
  const prev = typeof before.name === 'string' ? before.name.trim() : '';
  return next === prev ? null : next;
}

export interface PropagateResult {
  members: number;
  entries: number;
  /** True when the profile no longer carried `name` by commit time: nothing (more) was written. */
  superseded: boolean;
}

/**
 * Keep `users/{uid}.searchName` (the super-admin Members-tab prefix index,
 * `searchUsersByEmail`) equal to the lowercased name. Only `userSync` ever wrote
 * it — at account creation, from the Auth name — so an admin or /profile edit
 * left the index on the OLD name and the new one unsearchable. Returns true
 * when it wrote. A write here re-fires the users/{uid} trigger; the gate sees
 * an unchanged `name` and stops.
 */
export async function stampSearchName(db: Firestore, uid: string, name: string): Promise<boolean> {
  const ref = db.collection('users').doc(uid);
  // Transactional, and conditioned on the profile STILL carrying `name`: two
  // quick edits fire two events that may run out of order, and the older one
  // must not put the older name back into the index (codex r1 P2).
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return false;
    if (!profileNameIs(snap.get('name'), name)) return false;
    const want = name.toLowerCase();
    if (snap.get('searchName') === want) return false;
    t.update(ref, { searchName: want });
    return true;
  });
}

/** True when a stored profile `name` (trimmed) equals `name`. */
export function profileNameIs(stored: unknown, name: string): boolean {
  return typeof stored === 'string' && stored.trim() === name;
}

/**
 * The supersession check for the trigger (codex r1 P2): before pushing an
 * event's name into every pool, confirm the profile still says so. When two
 * edits land close together their events can run out of order or concurrently;
 * the event whose value the profile no longer holds must stand down and let
 * the newer one apply. A window remains between this read and the batch
 * commits — narrow, and closed on the next name write either way.
 */
export async function isCurrentProfileName(db: Firestore, uid: string, name: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && profileNameIs(snap.get('name'), name);
}

const BATCH_LIMIT = 400;

function underPools(ref: FirebaseFirestore.DocumentReference): boolean {
  // pools/{poolId}/members/{uid}  or  pools/{poolId}/entries/{entryId}
  const pool = ref.parent.parent;
  return !!pool && pool.parent.id === 'pools' && pool.parent.parent === null;
}

/**
 * Push `name` into every `pools/{*}/members/{uid}.userName` and every
 * `pools/{*}/entries/*.userName` whose `ownerUid` is `uid`.
 *
 * Only documents that already CARRY a `userName` are written — a bracket entry
 * has no such field and is not given one — and only when the stored value
 * differs, so a re-fired trigger is a no-op. `update` with the single field:
 * a Member Record carries paid state and a `set` here would be a clobber.
 *
 * Collection-group queries need collection-group indexes on `members.uid` and
 * `entries.ownerUid`; both are declared in `firestore.indexes.json`
 * (fieldOverrides). The emulator needs no index, so a green emulator suite
 * does NOT prove the index shipped — verify after deploy.
 *
 * 🛑 SERIALIZED AGAINST THE PROFILE (codex r2 P2). Two quick edits fire two
 * events that can overlap; a pre-check alone lets the OLDER one commit its
 * stale name after the newer one has finished. So every chunk is a
 * TRANSACTION that first reads `users/{uid}` and writes only if the profile
 * still says `name`. Firestore's optimistic concurrency does the rest: if the
 * profile changes between that read and the commit, the transaction retries,
 * re-reads, sees the newer name, and stops. An older handler therefore cannot
 * commit after a newer name change, whatever order the events ran in.
 */
export async function propagateUserName(db: Firestore, uid: string, name: string): Promise<PropagateResult> {
  const [memberSnap, entrySnap] = await Promise.all([
    db.collectionGroup('members').where('uid', '==', uid).get(),
    db.collectionGroup('entries').where('ownerUid', '==', uid).get(),
  ]);

  const members: FirebaseFirestore.DocumentReference[] = [];
  const entries: FirebaseFirestore.DocumentReference[] = [];
  const seenEntries = new Set<string>();
  const memberPools: FirebaseFirestore.DocumentReference[] = [];
  for (const doc of memberSnap.docs) {
    if (!underPools(doc.ref)) continue;
    memberPools.push(doc.ref.parent.parent!);
    const current = doc.get('userName');
    if (typeof current !== 'string' || current === name) continue;
    members.push(doc.ref);
  }
  for (const doc of entrySnap.docs) {
    if (!underPools(doc.ref)) continue;
    seenEntries.add(doc.ref.path);
    const current = doc.get('userName');
    if (typeof current !== 'string' || current === name) continue;
    entries.push(doc.ref);
  }

  // ⚠️ THE `ownerUid` QUERY MISSES A PRE-MULTI-ENTRY `entries/{uid}` DOC THAT
  // WAS NEVER STAMPED WITH ONE (the same gap userProfile.ts and multiEntry.ts
  // read around; codex r3). Every pool this uid is a member of gets that one
  // document read directly, and it is included when it exists, carries a
  // `userName`, and has no `ownerUid` (one that does was in the query already).
  if (memberPools.length > 0) {
    const legacyRefs = memberPools.map(p => p.collection('entries').doc(uid));
    const legacySnaps = await db.getAll(...legacyRefs);
    for (const snap of legacySnaps) {
      if (!snap.exists || seenEntries.has(snap.ref.path)) continue;
      if (snap.get('ownerUid') !== undefined) continue;
      const current = snap.get('userName');
      if (typeof current !== 'string' || current === name) continue;
      entries.push(snap.ref);
    }
  }

  const profileRef = db.collection('users').doc(uid);
  const writes = [...members, ...entries];
  const result: PropagateResult = { members: 0, entries: 0, superseded: false };
  let written = 0;

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const chunk = writes.slice(i, i + BATCH_LIMIT);
    const committed = await db.runTransaction(async (t) => {
      const profile = await t.get(profileRef);
      if (!profile.exists || !profileNameIs(profile.get('name'), name)) return false;
      for (const ref of chunk) t.update(ref, { userName: name });
      return true;
    });
    if (!committed) {
      result.superseded = true;
      break;
    }
    written += chunk.length;
  }

  // Counts reflect what was COMMITTED; members were queued first.
  result.members = Math.min(written, members.length);
  result.entries = Math.max(0, written - members.length);
  return result;
}
