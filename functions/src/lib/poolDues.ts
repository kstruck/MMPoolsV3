// PLAN-MULTI-ENTRY-DUES D1 (as AMENDED 2026-08-26) — the per-entry dues store.
//
// 🛑 WHY THIS IS NOT A FIELD ON THE MEMBER RECORD, WHICH IS WHERE THE SIGNED
// PLAN ORIGINALLY PUT IT.
//
// `paidEntries` is keyed by ENTRY ID, and the ids in it are the entries a member
// is LIABLE for — which means the entries that have committed a pick. A Member
// Record is readable by every participant in the pool (`firestore.rules`:
// `request.auth.uid in ... participantIds`), so a key named `e2:alice` sitting
// there told the whole pool that Alice's entry 2 was live. That is exactly the
// bit `shared/memberRecord.ts`'s `entries` field refuses to persist — "NEVER
// picks and never per-entry weeks" — for commissioner-blind picks.
//
// Found by cross-model review on PR #602; Kevin ruled the move on 2026-08-26.
//
// ✅ NO `firestore.rules` CHANGE WAS NEEDED, AND THAT IS THE DESIGN. The
// subcollection is already sealed to every principal including SUPER_ADMIN:
//
//     match /private/{docId} { allow read: if false; allow write: if false; }
//
// whose own comment says the wildcard exists "so a future private doc cannot be
// added under a laxer default". This is that future doc. Callables reach it with
// an Admin SDK handle, exactly as `verifyPoolAccess` reaches the password record
// next door. A commissioner surface that needs these rows gets a callable
// (P2-T5), the same posture `getPoolPicks` already takes.
//
// ⚠️ MONEY TRUTH IS NOW TWO DOCUMENTS: the Member Record (`paidStatus`,
// `feeOwed`) and this one (`paidEntries`). Every writer must touch BOTH IN ONE
// TRANSACTION — that requirement is what replaces single-document atomicity, and
// it is why `readPoolDues` takes a `Transaction` rather than offering a
// convenience read.
import type { DocumentReference, Transaction } from "firebase-admin/firestore";

/** One member's per-entry payment rows. Presence of a key IS the paid signal (D1b). */
export type PaidEntryMap = Record<string, { paidAt?: number; method?: string; note?: string }>;

/**
 * The dues document for one member.
 *
 * The `dues__` prefix is load-bearing: this subcollection also holds
 * `private/access`, the pool's PBKDF2 password record. A prefixed id cannot
 * collide with it for ANY uid — even a hand-made uid of `access` yields
 * `dues__access`.
 */
export const poolDuesRef = (poolRef: DocumentReference, uid: string): DocumentReference =>
  poolRef.collection('private').doc(`dues__${uid}`);

/**
 * This member's per-entry payment rows, read INSIDE the caller's transaction.
 *
 * An ABSENT document means "no per-entry detail recorded" — never "nothing is
 * paid" (R3). The caller falls back to the member's stored `paidStatus`, and a
 * writer materialises that stored `PAID` into the map before deriving from it.
 * Returning `{}` here would erase the difference between those two, so the
 * absence is reported as `undefined` and the decision is left to the caller.
 */
export async function readPoolDues(
  tx: Transaction,
  poolRef: DocumentReference,
  uid: string,
): Promise<PaidEntryMap | undefined> {
  const snap = await tx.get(poolDuesRef(poolRef, uid));
  if (!snap.exists) return undefined;
  const map = snap.data()?.paidEntries;
  return map && typeof map === 'object' && !Array.isArray(map) ? map as PaidEntryMap : undefined;
}

/**
 * Write this member's rows, WHOLE.
 *
 * ⚠️ `set` without `merge`, deliberately. A merge unions nested maps and can
 * therefore never DELETE a key, and D1b makes deletion the un-mark: presence is
 * the paid signal, so an un-marked entry must have its key gone rather than
 * falsified. The caller computes the complete next map inside the transaction
 * that read the current one, so a full overwrite loses nothing.
 */
export function writePoolDues(
  tx: Transaction,
  poolRef: DocumentReference,
  poolId: string,
  uid: string,
  paidEntries: PaidEntryMap,
  now: number,
): void {
  tx.set(poolDuesRef(poolRef, uid), { uid, poolId, paidEntries, updatedAt: now });
}
