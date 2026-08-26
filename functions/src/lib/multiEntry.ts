// PLAN-MULTI-ENTRY T2 — the server half of "an entry is a row, not a uid".
//
// Three concerns, each used by every entry mutator (submitNFLPicks, proxyPick,
// executeSurvivorRebuy) so they cannot drift:
//
//   1. resolveOwnedEntry — which doc IS "entry n of uid" (D1/K1). Deterministic
//      id `entryIdFor(uid, n)`, read INSIDE the caller's transaction together
//      with every entry the uid owns; falls back to an auto-id when the
//      deterministic doc exists under a different owner (§0a). Readers never
//      parse ids — every doc carries `ownerUid` + `entryIndex`.
//   2. the cap — from entry EXISTENCE in the transaction, never a stored
//      counter (two concurrent first-submits of entry 2 and 3 → count 3, never
//      4: the owned-entries query is in both read sets, so the loser retries).
//   3. liability after the write (D2/D8) — `playableEntryCount` for the Member
//      Record, the `entries` roster map, and the `pool.entryCount` delta.
//
// Pure pieces are exported separately so they are unit-testable without an
// emulator; the Firestore pieces are thin.
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { defaultEntryName, entryIdFor, effectiveMaxEntriesPerUser, ENTRY_NAME_MAX } from "../shared/multiEntry";
import { deriveEntryCount } from "../shared/memberRecord";
import { poolDuesRef } from "./poolDues";

export interface OwnedEntry { id: string; data: Record<string, any> }

export interface EntryTarget {
  ref: DocumentReference;
  /** The target doc's data, or null when this write creates it. */
  existing: Record<string, any> | null;
  /** Every entry doc this uid owns, BEFORE the write (the target included when it exists). */
  owned: OwnedEntry[];
  entryIndex: number;
}

/** Does this entry doc hold at least one committed pick? (Pick'em: gameId→team; Survivor/Margin: week→team.) */
export function entryHasPick(data: Record<string, any> | null | undefined): boolean {
  const picks = data?.picks;
  return !!picks && typeof picks === 'object' && Object.keys(picks).length > 0;
}

/**
 * Which existing owned doc is "entry n"? The deterministic id when it exists
 * and is ours; otherwise a doc whose stored `entryIndex` is n (an earlier
 * auto-id fallback). Legacy `entries/{uid}` docs carry no `entryIndex` and are
 * entry #1. Pure, so the fallback order is a unit test.
 */
export function pickOwnedEntry(
  uid: string,
  entryIndex: number,
  owned: OwnedEntry[],
): { id: string; data: Record<string, any> } | null {
  const detId = entryIdFor(uid, entryIndex);
  const detOwned = owned.find(e => e.id === detId);
  if (detOwned) return detOwned;
  const byIndex = owned.find(e => (typeof e.data.entryIndex === 'number' ? e.data.entryIndex : 1) === entryIndex);
  return byIndex ?? null;
}

/**
 * Reads (transactionally) everything the caller needs to address entry n of
 * uid: the owned-entries set and the deterministic doc. All reads, no writes.
 */
export async function resolveOwnedEntry(
  tx: Transaction,
  poolRef: DocumentReference,
  uid: string,
  entryIndex: number,
): Promise<EntryTarget> {
  const col = poolRef.collection('entries');
  const detRef = col.doc(entryIdFor(uid, entryIndex));
  const legacyRef = col.doc(uid);
  // The legacy `entries/{uid}` doc is read REGARDLESS of the requested index
  // (codex r4 on #450): a pre-T2 primary entry may carry no `ownerUid` and so
  // miss the query — without it, creating entry 2 would count as the owner's
  // ONLY entry (count 1, no fee rise, roster without #1).
  const [ownedSnap, detSnap, legacySnap] = await Promise.all([
    tx.get(col.where('ownerUid', '==', uid)),
    tx.get(detRef),
    entryIndex === 1 ? Promise.resolve(null) : tx.get(legacyRef),
  ]);
  const owned: OwnedEntry[] = ownedSnap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, any> }));
  const det = detSnap.exists ? (detSnap.data() as Record<string, any>) : null;
  const legacy = entryIndex === 1 ? det : (legacySnap?.exists ? (legacySnap.data() as Record<string, any>) : null);
  // Legacy entry #1 with no ownerUid stamped: ours, and not in the query.
  if (legacy && legacy.ownerUid === undefined && !owned.some(e => e.id === uid)) {
    owned.push({ id: uid, data: legacy });
  }
  const hit = pickOwnedEntry(uid, entryIndex, owned);
  if (hit) return { ref: col.doc(hit.id), existing: hit.data, owned, entryIndex };
  // Create. The deterministic id unless a doc already sits there under another
  // owner (a uid that literally is `e2:alice` — impossible for Firebase Auth,
  // not for a hand-made one) — then an auto-id; nothing downstream parses ids.
  return { ref: det ? col.doc() : detRef, existing: null, owned, entryIndex };
}

/**
 * The cap, from existence: creating a NEW entry is refused once the owner
 * already holds `max` docs, and an index beyond the pool's max is refused
 * outright. Pure — throws HttpsError like every other gate.
 */
export function assertEntryAdmitted(
  settings: { maxEntriesPerUser?: unknown } | undefined,
  target: Pick<EntryTarget, 'existing' | 'owned' | 'entryIndex'>,
): void {
  const max = effectiveMaxEntriesPerUser(settings);
  if (target.entryIndex > max) {
    throw new HttpsError('failed-precondition',
      `ENTRY_INDEX_EXCEEDS_MAX: this pool allows ${max} entr${max === 1 ? 'y' : 'ies'} per player.`);
  }
  if (target.existing === null && target.owned.length >= max) {
    throw new HttpsError('failed-precondition',
      `MAX_ENTRIES_REACHED: you already hold ${target.owned.length} of ${max} entries in this pool.`);
  }
}

/** K5 — an `entryName` must be unique per owner (case-insensitive, trimmed). Returns the normalized name. */
export function assertEntryNameFree(
  entryName: string,
  target: Pick<EntryTarget, 'owned'> & { ref: { id: string } },
): string {
  const name = entryName.trim().slice(0, ENTRY_NAME_MAX);
  if (!name) throw new HttpsError('invalid-argument', 'ENTRY_NAME_EMPTY: entry name cannot be blank.');
  const clash = target.owned.find(e => e.id !== target.ref.id
    && typeof e.data.entryName === 'string' && e.data.entryName.trim().toLowerCase() === name.toLowerCase());
  if (clash) {
    throw new HttpsError('already-exists', `ENTRY_NAME_TAKEN: you already have an entry named "${clash.data.entryName}".`);
  }
  return name;
}

/**
 * K5 default for a NEW extra entry — `"Name #n"`, made unique against the
 * owner's other entries by construction (codex r1: an owner who explicitly
 * named entry 2 "Kev #3" and then creates entry 3 would otherwise get a
 * duplicate default). Appends a small suffix until free. Undefined for entry #1.
 */
export function freeDefaultEntryName(
  userName: string,
  entryIndex: number,
  target: Pick<EntryTarget, 'owned'> & { ref: { id: string } },
): string | undefined {
  const base = defaultEntryName(userName, entryIndex);
  if (!base) return undefined;
  const taken = new Set(target.owned
    .filter(e => e.id !== target.ref.id && typeof e.data.entryName === 'string')
    .map(e => (e.data.entryName as string).trim().toLowerCase()));
  let name = base.slice(0, ENTRY_NAME_MAX);
  for (let k = 2; taken.has(name.toLowerCase()); k++) {
    const suffix = ` (${k})`;
    name = base.slice(0, ENTRY_NAME_MAX - suffix.length) + suffix;
  }
  return name;
}

/**
 * The owner's state AFTER this write, for the Member Record: how many of their
 * entries have committed a pick, and the id → {index, name} roster (D2/D6).
 * `written` is the doc this transaction is setting; its post-write shape is
 * what counts, not its pre-write one.
 */
export function ownerStateAfter(
  owned: OwnedEntry[],
  written: { id: string; entryIndex: number; entryName?: string; hasPick: boolean },
): {
  playableEntryCount: number;
  entries: Record<string, { entryIndex: number; name?: string }>;
  /**
   * PLAN-MULTI-ENTRY-DUES D1a — WHICH entries hold a pick, not just how many.
   *
   * 🛑 TRANSACTION-LOCAL. This is the input `liableEntryIds` needs and CANNOT
   * get from the Member Record, because `entries` deliberately carries no pick
   * state (a participant-readable record must not say which entry has a pick for
   * an unrevealed week). **It must never be written to the record** — persisting
   * it is precisely the leak the omission exists to prevent. Compute it here,
   * pass it to `liableEntryIds` inside the same transaction, discard it.
   *
   * It costs no extra read: `entryHasPick` was already being evaluated on every
   * one of these documents to build `playableEntryCount`. Only the ids were
   * being thrown away.
   */
  pickedEntryIds: string[];
} {
  let playableEntryCount = written.hasPick ? 1 : 0;
  const pickedEntryIds: string[] = written.hasPick ? [written.id] : [];
  const entries: Record<string, { entryIndex: number; name?: string }> = {
    [written.id]: { entryIndex: written.entryIndex, ...(written.entryName ? { name: written.entryName } : {}) },
  };
  for (const e of owned) {
    if (e.id === written.id) continue;
    if (entryHasPick(e.data)) { playableEntryCount++; pickedEntryIds.push(e.id); }
    const idx = typeof e.data.entryIndex === 'number' ? e.data.entryIndex : 1;
    entries[e.id] = { entryIndex: idx, ...(typeof e.data.entryName === 'string' && e.data.entryName ? { name: e.data.entryName } : {}) };
  }
  return { playableEntryCount, entries, pickedEntryIds };
}

/**
 * D8 — `pool.entryCount` counts LIABLE entries and is server-maintained. When
 * the field is ABSENT (every NFL pool created before T2) it is derived from the
 * Member Records read in this same transaction — a from-zero increment would
 * make the pot denominator 1 on a populated pool. `members` may be null when
 * the caller saw the field present and skipped the read.
 */
export function entryCountWrite(
  pool: { entryCount?: unknown } | undefined,
  members: Array<Record<string, unknown>> | null,
  delta: number,
): Record<string, unknown> {
  if (typeof pool?.entryCount === 'number') {
    return delta === 0 ? {} : { entryCount: FieldValue.increment(delta) };
  }
  if (members === null) return {};
  return { entryCount: deriveEntryCount(members) + delta };
}

/**
 * K11 — after `ensureMemberRecord` reported a paid reset: mirror UNPAID onto
 * every entry the member owns (same field conventions as setPaidStatus's
 * UNPAID transition) and append the ledger line that says why.
 */
export function applyPaidReset(
  tx: Transaction,
  poolRef: DocumentReference,
  uid: string,
  memberName: string | undefined,
  ownedIds: string[],
  reset: { previousFeeOwed: number; feeOwed: number; paidAt?: number; paymentMethod?: string },
  reason: string,
  now: number,
): void {
  for (const id of ownedIds) {
    tx.set(poolRef.collection('entries').doc(id), {
      paidStatus: 'UNPAID', paymentMethod: FieldValue.delete(), paidAt: null, paymentNote: null, updatedAt: now,
    }, { merge: true });
  }
  // PLAN-MULTI-ENTRY-DUES: the reset must clear the PER-ENTRY map too, or it is
  // only half a reset (codex r2 on P2-T2).
  //
  // K11 sets the member UNPAID and mirrors that onto every entry doc. The dues
  // map is the AUTHORITY the summary is derived from, so leaving it behind
  // desynchronises the three stores: the commissioner then pays only the newly
  // added entry, the derivation sees the stale key for entry 1 and reports the
  // member PAID — while entry 1's own document still says UNPAID, and re-paying
  // entry 1 raises no ledger event because its key was never removed. Deleting
  // the document keeps "reset to unpaid" total.
  //
  // ⚠️ DELETE, not "write an empty map". An ABSENT dues document is the
  // canonical representation of "no per-entry detail" (R3), and it is what a
  // member who never had one looks like — so a reset lands them in the same
  // state rather than a second one that every reader would have to know about.
  //
  // K11 is RETIRED by P2-T3, which deletes this function; until then it has to
  // be correct about a store that did not exist when it was written.
  tx.delete(poolDuesRef(poolRef, uid));
  const paidDetail = [
    reset.paidAt ? `marked paid ${new Date(reset.paidAt).toISOString().slice(0, 10)}` : 'marked paid',
    reset.paymentMethod ? `via ${reset.paymentMethod}` : undefined,
    `at $${reset.previousFeeOwed}`,
  ].filter(Boolean).join(' ');
  tx.set(poolRef.collection('payments').doc(), {
    type: 'MARKED_UNPAID',
    uid,
    ...(memberName !== undefined ? { entryName: memberName } : {}),
    amount: reset.feeOwed,
    actorUid: 'system',
    at: now,
    createdAt: FieldValue.serverTimestamp(),
    note: `${reason} — dues rose from $${reset.previousFeeOwed} to $${reset.feeOwed}; previously ${paidDetail}. Mark paid again once the difference is collected.`,
  });
}
