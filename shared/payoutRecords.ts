// Payout Record contract — the source of truth for Profit (ADR 0005 decision 3).
// Two docs per award, split by sensitivity, because Firestore rules are doc-level:
//   pools/{poolId}/payoutRecords/{awardId}        — pool-participant-readable
//   pools/{poolId}/payoutRecordsPrivate/{awardId} — commissioner/admin + recipient only
// Both server-write-only (recordPoolPayouts callable). Corrections SUPERSEDE (a new
// award pair + supersededBy on the old public doc) — records are never mutated in
// place, so the chain is auditable. The legacy payment ledger's PAYOUT_PAID/
// PAYOUT_UNPAID events are emitted alongside as an audit trail only.
// The platform records these figures; the money itself moves peer-to-peer.
// This file is framework-free so both client and functions import it.

// schemaVersion 2 (PLAN-PAYMENT-LEDGER T4): a PLACE record may name a `week`
// — a WEEKLY award bound to the recap's published `weeklyPlaces` row and its
// frozen prize (K11). Additive; `reduceAwards` ignores the field.
export const PAYOUT_SCHEMA_VERSION = 2;

/**
 * Deterministic id of a weekly PLACE award (K11): one live record per
 * (entry, week, place), so a double-click, a retry or two commissioner tabs
 * cannot record the same win twice. A re-record after a rescore (K12) is
 * `${base}~${k}` (k = 2, 3, …) superseding the previous one.
 */
export function weeklyAwardId(week: number, entryId: string, place: number, k = 1): string {
  const base = `wk${week}-${entryId}-p${place}`;
  return k <= 1 ? base : `${base}~${k}`;
}

export type PayoutKind = 'PLACE' | 'BONUS' | 'ADJUSTMENT';

/** Participant-visible: who won what. */
export interface PayoutRecord {
  uid: string;
  entryId?: string;
  amount: number; // dollars, >= 0 (ADJUSTMENT may be negative to correct an overstatement)
  kind: PayoutKind;
  /** Rank the award was for, when kind is PLACE (display convenience). */
  place?: number;
  /** The NFL week, when this PLACE award is a WEEKLY prize (schemaVersion 2). Absent = season award. */
  week?: number;
  recordedAt: number; // epoch millis
  supersededBy?: string; // awardId of the correcting record
  schemaVersion: number;
}

/** Commissioner/admin/recipient-only settlement metadata. */
export interface PayoutRecordPrivate {
  uid: string; // duplicated so rules can grant the recipient read access
  settled: boolean; // has the money actually moved (peer-to-peer)?
  note?: string;
  recordedBy: string; // actor uid
  schemaVersion: number;
}

export interface AwardTotals {
  /** Sum of non-superseded award amounts per uid (settled or not — awarded counts). */
  byUid: Record<string, number>;
  total: number;
}

/** Fold public payout records into per-member totals, skipping superseded ones. Pure. */
export function reduceAwards(records: PayoutRecord[]): AwardTotals {
  const byUid: Record<string, number> = {};
  let total = 0;
  for (const r of records) {
    if (r.supersededBy) continue;
    const amt = Number(r.amount) || 0;
    byUid[r.uid] = (byUid[r.uid] || 0) + amt;
    total += amt;
  }
  return { byUid, total };
}
