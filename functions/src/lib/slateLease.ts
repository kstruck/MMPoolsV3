// The fenced SLATE lease — the mutex between the weekly freeze and the importer
// (PLAN-NFL-SPREAD-FREEZE 1.3, codex round 11).
//
// WHY A LEASE AND NOT A TRANSACTION. The freeze reconciles the fetched event ids
// against the stored slate before it commits, so that a 15-of-16 response cannot
// leave a week frozen across two instants. That preflight does not survive a
// concurrent ADD: an importer write that creates a seventeenth game between the
// reconciliation and the commit lands happily alongside it, the sixteen originals
// freeze, the newcomer stays unfrozen, and the all-or-nothing invariant is
// violated even though the sets matched.
//
// Re-reading the slate query INSIDE the transaction does not close it either.
// Firestore transactions do not range-lock — a document created concurrently
// raises no conflict at all. So the writers are serialised instead, exactly the
// way `lib/scoringLease.ts` serialises everything that writes a pool's scoring
// state, and for the same reason: serialising an instant is not enough, the whole
// pass has to be serialised.
//
// WHY A FENCING TOKEN AND NOT JUST AN EXPIRY. A time-bounded lease is not a mutex.
// A slow invocation delayed past `until` would resume and write after a retry had
// already acquired the lease and frozen the slate. The unique `owner` token,
// asserted inside the committing transaction, is what makes the second writer
// lose. This is `scoringLease.ts`'s reasoning applied to a slate rather than a
// pool; it is a separate file because the subject is different — one is keyed by
// pool id and carries a `lockRevision`, this one is keyed by slate and does not.
//
// Deliberately free of a runtime `firebase-admin` import (types only), so a
// non-emulator unit test can import it.

import { randomUUID } from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { slateDocId, type SlateKey } from './spreadFreeze';

/** Server-only. `firestore.rules` refuses every client read and write. */
export const SLATE_LEASES = 'nfl_slate_leases';

/**
 * Short on purpose, same trade as the scoring lease: a live pass renews nothing
 * because a freeze is a single transaction, while a pass that DIED frees the
 * slate again in three minutes rather than blocking the next import for the
 * length of a function timeout.
 */
export const SLATE_LEASE_TTL_MS = 3 * 60 * 1000;

export interface SlateLease {
  owner: string;
  until: number;
}

export function readSlateLease(doc: Record<string, unknown> | undefined): SlateLease | undefined {
  if (!doc) return undefined;
  const { owner, until } = doc as { owner?: unknown; until?: unknown };
  if (typeof owner !== 'string' || typeof until !== 'number') return undefined;
  return { owner, until };
}

export function leaseIsLive(lease: SlateLease | undefined, now: number): boolean {
  return !!lease && lease.until > now;
}

/** Take the slate's lease, or null if a live pass already holds it. */
export async function acquireSlateLease(
  db: Firestore,
  key: SlateKey,
  now: number,
  ttlMs: number = SLATE_LEASE_TTL_MS,
): Promise<SlateLease | null> {
  const ref = db.collection(SLATE_LEASES).doc(slateDocId(key));
  return db.runTransaction<SlateLease | null>(async (tx) => {
    const snap = await tx.get(ref);
    if (leaseIsLive(readSlateLease(snap.data() as Record<string, unknown> | undefined), now)) return null;
    const lease = { owner: randomUUID(), until: now + ttlMs };
    tx.set(ref, { ...lease, slate: slateDocId(key) });
    return lease;
  });
}

/**
 * Hand it back. Expiring `until` rather than deleting keeps this free of a
 * runtime `FieldValue` import, and `until: 0` reads as free everywhere above.
 *
 * Conditional on still owning it: a pass that already lost the fence must not
 * release the lease its successor is holding.
 */
export async function releaseSlateLease(db: Firestore, key: SlateKey, lease: SlateLease): Promise<void> {
  const ref = db.collection(SLATE_LEASES).doc(slateDocId(key));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const held = readSlateLease(snap.data() as Record<string, unknown> | undefined);
    if (!held || held.owner !== lease.owner) return;
    tx.update(ref, { until: 0 });
  });
}

/**
 * Is a freeze running on this slate right now? What `importNFLSeason` asks
 * before it writes, the way a scoring pass returns `leaseBusy` rather than
 * writing.
 */
export async function slateLeaseIsHeld(db: Firestore, key: SlateKey, now: number): Promise<boolean> {
  const snap = await db.collection(SLATE_LEASES).doc(slateDocId(key)).get();
  return leaseIsLive(readSlateLease(snap.data() as Record<string, unknown> | undefined), now);
}

/**
 * Assert the fence INSIDE the committing transaction.
 *
 * A separate recheck-then-write is a TOCTOU race — a newer worker can acquire the
 * lease between the recheck and the write. This is read within the same
 * transaction that commits the frozen records, so a pass that lost its lease
 * commits nothing.
 */
export async function assertSlateFence(
  tx: Transaction,
  db: Firestore,
  key: SlateKey,
  lease: SlateLease,
  now: number,
): Promise<void> {
  const snap = await tx.get(db.collection(SLATE_LEASES).doc(slateDocId(key)));
  const held = readSlateLease(snap.data() as Record<string, unknown> | undefined);
  if (!held || held.owner !== lease.owner) {
    throw new Error(`FENCE_LOST: the slate lease for ${slateDocId(key)} is no longer held by this pass.`);
  }
  if (held.until <= now) {
    throw new Error(`FENCE_LOST: the slate lease for ${slateDocId(key)} expired mid-pass.`);
  }
}
