// Per-entry submission watermark (PLAN-REALTIME-SCORING §3a acceptance criterion
// 5, PR-B′).
//
// The problem it closes: `submitNFLPicks` captures its clock before its
// transaction, so a valid submission can commit AFTER the auto-scorer has read
// the entries collection. With games and settings unchanged the week fingerprint
// matches, the pool takes the skip path, and that entry keeps an omitted grade
// until something else happens to move the hash.
//
// The counter lives on the ENTRY doc, never on the pool. A pool-wide
// `submitSeq.{week}` would make every pre-kickoff submission contend on one
// document — concurrent submits would abort each other and valid picks could be
// dropped (codex r17).
//
// The scorer therefore has to aggregate the per-entry counters, and the choice
// of aggregate is load-bearing (codex r18/r22):
//   - `max` STALLS: independent bumps mean a lower entry moving 2→3 leaves the
//     maximum unchanged, so that pool is skipped forever;
//   - a COUNT of entries above the last-scored revision stalls the moment an
//     entry already above the threshold re-increments;
//   - a monotone SUM changes on every single mutation, which is the property
//     required.

import { AggregateField } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/** The entry-doc field. One name, everywhere. */
export const ENTRY_REVISION_FIELD = 'revision';

/**
 * The next value for an entry's own counter. Legacy entries carry no `revision`,
 * so they start at 1 — which is itself a change from the absent/0 the scorer
 * last saw, and correctly forces one more pass.
 */
export function nextEntryRevision(existing: unknown): number {
  return (typeof existing === 'number' && Number.isFinite(existing) ? existing : 0) + 1;
}

/**
 * The monotone sum of a pool's per-entry revisions, via a Firestore aggregation
 * query — one aggregation read rather than a full entries read on every 10-minute
 * poll, which is the whole point of the fingerprint skip.
 *
 * Returns `null` when the aggregate cannot be read. A null MUST be treated as
 * "unknown", i.e. do not skip: guessing 0 would make an entry mutation invisible,
 * which is exactly the bug this exists to prevent. Failing toward an extra
 * scoring pass costs reads; failing toward a skip loses a member's picks.
 */
export async function readEntryRevisionSum(
  db: Firestore,
  poolId: string,
): Promise<number | null> {
  try {
    const snap = await db
      .collection('pools').doc(poolId)
      .collection('entries')
      .aggregate({ revisionSum: AggregateField.sum(ENTRY_REVISION_FIELD) })
      .get();
    const value = snap.data().revisionSum;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch (e) {
    console.warn(`[entryRevision] aggregate failed for pool ${poolId}; will not skip:`, e);
    return null;
  }
}
