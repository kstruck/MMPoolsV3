// The fenced scoring lease — the mutex between everything that writes a pool's
// scoring state (PLAN-REALTIME-SCORING §3a, PR-B′).
//
// Why a lease and not a single up-front check: the scorer commits in chunks
// (≤400 ops), so an `extendWeekDeadline` can land AFTER a revision check and
// BEFORE the first entry batch. Serializing an instant is not enough; the whole
// pass has to be serialized.
//
// Why a fencing token and not just an expiry: a time-bounded lease is not a
// mutex. If a slow invocation is delayed past `until`, a retry acquires the
// lease and scores, and the original then resumes and overwrites the entry maps
// — and both passes can carry the SAME `lockRevision`, so the revision check
// never sees it. The unique `owner` token is what makes the second writer lose.
//
// Why the token is validated INSIDE the committing transaction: a separate
// recheck-then-write is a TOCTOU race — a newer worker can acquire the lease
// between the recheck and the write. `fencedWrite` reads the pool doc and
// asserts owner + expiry + `lockRevision` in the same transaction that commits
// the data, so a worker that lost its lease commits nothing.
//
// Deliberately free of a runtime `firebase-admin` import (types only): anything
// that reaches `admin.firestore()` at module load cannot be imported by a
// non-emulator unit test — the trap PR-B1 hit with billing.ts.

import { randomUUID } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { isVoidedPool } from './autoScoreDecisions';

/** The single lease record. One path, everywhere — §3a codex r16. */
export const SCORING_LEASE_PATH = 'autoScore.scoringLease';

/**
 * How long an acquired lease stays valid without renewal.
 *
 * Short on purpose: every fenced write renews it, so a live worker never loses
 * its own lease mid-pass however long the pass runs, while a worker that DIED
 * frees the pool again in three minutes rather than blocking the manual
 * "Score Week" button for the length of a function timeout.
 */
export const SCORING_LEASE_TTL_MS = 3 * 60 * 1000;

export interface ScoringLease {
  owner: string;
  until: number;
}

/**
 * What a lease holder carries for the rest of its pass. `lockRevision` is the
 * backstop: the lease bounds the window, the revision catches an override that
 * committed anyway.
 */
export interface ScoringFence {
  owner: string;
  lockRevision: number;
  ttlMs: number;
}

type PoolDoc = Record<string, unknown> | undefined;

export function readScoringLease(pool: PoolDoc): ScoringLease | undefined {
  const lease = (pool?.autoScore as { scoringLease?: unknown } | undefined)?.scoringLease;
  if (!lease || typeof lease !== 'object') return undefined;
  const { owner, until } = lease as { owner?: unknown; until?: unknown };
  if (typeof owner !== 'string' || typeof until !== 'number') return undefined;
  return { owner, until };
}

/**
 * The monotonic lock revision. Bumped by every lock-affecting write
 * (`extendWeekDeadline`); captured at lease acquisition and re-asserted by every
 * fenced write.
 */
export function readLockRevision(pool: PoolDoc): number {
  const raw = (pool?.settings as { lockRevision?: unknown } | undefined)?.lockRevision;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Is SOMEONE holding an unexpired lease right now? */
export function leaseIsLive(lease: ScoringLease | undefined, now: number): boolean {
  return !!lease && lease.until > now;
}

/** Is a live lease held by someone OTHER than `owner`? */
export function leaseHeldByOther(pool: PoolDoc, owner: string, now: number): boolean {
  const lease = readScoringLease(pool);
  return leaseIsLive(lease, now) && lease!.owner !== owner;
}

/**
 * The fence assertion. Owner AND expiry AND revision, all three (codex r18): an
 * owner-only check lets a stalled worker whose lease already expired write after
 * `extendWeekDeadline` legally committed an override into the now-free lease.
 */
export function checkFence(pool: PoolDoc, fence: ScoringFence, now: number): void {
  const lease = readScoringLease(pool);
  if (!lease || lease.owner !== fence.owner) {
    throw new HttpsError('aborted', 'FENCE_LOST: the scoring lease is no longer held by this pass.');
  }
  if (lease.until <= now) {
    throw new HttpsError('aborted', 'FENCE_LOST: the scoring lease expired mid-pass.');
  }
  if (readLockRevision(pool) !== fence.lockRevision) {
    throw new HttpsError('aborted', 'FENCE_LOST: the pool lock changed during this scoring pass.');
  }
  // Lifecycle, checked in the SAME transaction as the write (codex r6). A
  // pre-flight guard before the pass is read-then-write: `cancelPool` and the
  // admin close take no scoring lease, so they can commit between the check and
  // the first fenced write, and every scoring write downstream would land in a
  // voided pool. `maybeFinalizeNFLPool` cannot undo them — it only tests
  // cancellation, and only after its own writes.
  //
  // Here rather than in one caller because `fencedWrite` is the single door every
  // scoring write goes through, so one assertion covers the scheduled job, the
  // manual button, the finalize sweep and the reconciliation drain at once.
  if (isVoidedPool(pool as { status?: unknown })) {
    throw new HttpsError('aborted', 'FENCE_LOST: the pool was voided during this scoring pass.');
  }
}

/**
 * Take the lease, or return null if another live pass holds it.
 *
 * Atomic by construction — the read and the claim are one transaction, so two
 * schedulers firing on the same pool cannot both win.
 */
export async function acquireScoringLease(
  db: Firestore,
  poolId: string,
  now: number,
  ttlMs: number = SCORING_LEASE_TTL_MS,
): Promise<ScoringFence | null> {
  const poolRef = db.collection('pools').doc(poolId);
  return db.runTransaction<ScoringFence | null>(async (tx) => {
    const snap = await tx.get(poolRef);
    if (!snap.exists) return null;
    const pool = snap.data() as PoolDoc;
    if (leaseIsLive(readScoringLease(pool), now)) return null;

    const owner = randomUUID();
    tx.update(poolRef, { [`${SCORING_LEASE_PATH}`]: { owner, until: now + ttlMs } });
    return { owner, lockRevision: readLockRevision(pool), ttlMs };
  });
}

/**
 * Hand the lease back early. Expiring `until` rather than deleting the record
 * keeps this free of a runtime FieldValue import, and `until: 0` reads as free
 * everywhere the predicates above are used.
 *
 * Conditional on still owning it: a pass that already lost the fence must not
 * release the lease its successor is holding.
 */
export async function releaseScoringLease(
  db: Firestore,
  poolId: string,
  fence: ScoringFence,
): Promise<void> {
  const poolRef = db.collection('pools').doc(poolId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    if (!snap.exists) return;
    const lease = readScoringLease(snap.data() as PoolDoc);
    if (!lease || lease.owner !== fence.owner) return;
    tx.update(poolRef, { [`${SCORING_LEASE_PATH}.until`]: 0 });
  });
}

/**
 * Commit a set of writes only if this pass still owns the lease, asserted in the
 * SAME transaction — and renew the lease while we are here, so a long pass never
 * expires under itself.
 *
 * `poolPatch` exists so a caller that also writes the pool doc folds its fields
 * into the one update rather than issuing a second write to the same document.
 *
 * Throws `aborted` on a lost fence. That propagates: the caller MUST NOT swallow
 * it, or the pass would carry on writing with data the fence just invalidated.
 */
export async function fencedWrite(
  db: Firestore,
  poolRef: DocumentReference,
  fence: ScoringFence,
  /**
   * `poolData` is the pool doc AS READ IN THIS TRANSACTION — a caller that
   * freezes anything derived from live settings must derive it from THIS, not
   * from the pre-lease snapshot, or an edit that committed between the two
   * reads is frozen out (PLAN-WEEKLY-PRIZES §3b-i; codex r2 on the step-4 PR).
   * A returned object is folded into the pool update like `poolPatch`.
   */
  apply: (tx: Transaction, poolData: Record<string, unknown> | undefined) => void | Record<string, unknown> | undefined,
  poolPatch?: Record<string, unknown>,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    const now = Date.now();
    const poolData = snap.data() as Record<string, unknown> | undefined;
    checkFence(poolData as PoolDoc, fence, now);
    const extra = apply(tx, poolData);
    tx.update(poolRef, {
      ...(poolPatch ?? {}),
      ...(extra ?? {}),
      [`${SCORING_LEASE_PATH}.until`]: now + fence.ttlMs,
    });
  });
}

/** Convenience for callers whose whole job is "take it, do work, give it back". */
export async function withScoringLease<T>(
  db: Firestore,
  poolId: string,
  now: number,
  fn: (fence: ScoringFence) => Promise<T>,
): Promise<T | 'LEASE_BUSY'> {
  const fence = await acquireScoringLease(db, poolId, now);
  if (!fence) return 'LEASE_BUSY';
  try {
    return await fn(fence);
  } finally {
    await releaseScoringLease(db, poolId, fence).catch(() => undefined);
  }
}

/** Random token for tests that need a fence without touching Firestore. */
export function newLeaseOwner(): string {
  return randomUUID();
}

export const SCORING_IN_PROGRESS = 'SCORING_IN_PROGRESS';

/**
 * The entry-mutator side of the mutex (`submitNFLPicks` / `proxyPick` /
 * `executeSurvivorRebuy`).
 *
 * A watermark alone is not enough here: it only schedules a LATER pass, and does
 * nothing about the race where the scorer's missing-pick update and a still-valid
 * submission interleave — one writes a false strike, or the other is rejected
 * against a just-eliminated entry. So a mutator reads the lease inside its own
 * transaction and refuses to commit while a scoring pass owns it.
 *
 * Call this BEFORE any write in the transaction — Firestore requires all reads
 * first, and adding the pool doc to the read set is also what makes Firestore
 * itself abort the mutator if the scorer commits mid-transaction.
 */
export async function assertNoScoringInProgress(
  tx: Transaction,
  poolRef: DocumentReference,
  now: number,
): Promise<void> {
  const snap = await tx.get(poolRef);
  if (leaseIsLive(readScoringLease(snap.data() as PoolDoc), now)) {
    throw new HttpsError(
      'aborted',
      `${SCORING_IN_PROGRESS}: this week is being scored right now. Try again in a moment.`,
    );
  }
}

/**
 * Retry a transaction that lost to a live scoring lease.
 *
 * A pass is seconds long, so a handful of short waits turns "your pick was
 * rejected" into "your pick took a second" for the only case that can hit it —
 * a boundary submission committing right at the lock. Anything else propagates
 * untouched. `fn` must be self-contained (it re-runs from scratch).
 */
export async function retryWhileScoring<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 400;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const busy = e instanceof Error && e.message.includes(SCORING_IN_PROGRESS);
      if (!busy || i >= attempts) throw e;
      await sleep(delayMs);
    }
  }
}
