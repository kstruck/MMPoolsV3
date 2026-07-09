import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { writeLedgerEvent } from "./paymentLedger";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { PAYOUT_SCHEMA_VERSION, type PayoutKind } from "./shared/payoutRecords";
import { writeAuditEvent } from "./audit";

/**
 * recordPoolPayouts — the Commissioner's "record payouts" action (ADR 0005
 * decision 3 / PLAN-PLAYER-PROFILES Phase 4). The FIRST real writer of payout
 * truth: canonical award docs split by sensitivity —
 *   pools/{poolId}/payoutRecords/{awardId}         {uid, entryId?, amount, kind, place?, recordedAt, supersededBy?}
 *   pools/{poolId}/payoutRecordsPrivate/{awardId}  {uid, settled, note?, recordedBy}
 * plus PAYOUT_PAID/PAYOUT_UNPAID ledger events (audit trail only) and
 * pool.payoutsRecordedAt. Corrections supersede (supersedes: awardId) — never
 * mutate. The platform records figures; the money moves peer-to-peer.
 */

interface AwardInput {
  uid: string;
  entryId?: string;
  amount: number;
  kind: PayoutKind;
  place?: number;
  settled: boolean;
  note?: string;
  /** awardId of a prior record this one corrects. */
  supersedes?: string;
}

const KINDS: PayoutKind[] = ['PLACE', 'BONUS', 'ADJUSTMENT'];
const MAX_AWARDS_PER_CALL = 100;

export const recordPoolPayouts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  const actorUid = request.auth.uid;
  const db = admin.firestore();

  const { poolId, awards } = request.data || {};
  if (!poolId || typeof poolId !== 'string') throw new HttpsError('invalid-argument', 'poolId is required.');
  if (!Array.isArray(awards) || awards.length === 0) throw new HttpsError('invalid-argument', 'awards[] is required.');
  if (awards.length > MAX_AWARDS_PER_CALL) throw new HttpsError('invalid-argument', `At most ${MAX_AWARDS_PER_CALL} awards per call.`);

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
  const pool = poolSnap.data() as any;

  const claimRole = request.auth.token.role as string | undefined;
  try {
    assertPoolOwnerOrSuperAdmin(pool, actorUid, claimRole);
  } catch {
    throw new HttpsError('permission-denied', 'Only the pool commissioner or a super admin can record payouts.');
  }

  // Payouts are recorded once competition is settled — after Season Finalization
  // (NFL) or a FINAL/COMPLETED status. Corrections remain possible afterwards.
  const settledPool = !!pool.finalizedAt || pool.status === 'FINAL' || pool.status === 'COMPLETED' || pool.isFinal === true;
  if (!settledPool) {
    throw new HttpsError('failed-precondition', 'POOL_NOT_SETTLED: record payouts after the pool is finalized.');
  }

  const participantIds: string[] = pool.participantIds || [];
  const validated: AwardInput[] = awards.map((a: any, i: number) => {
    if (!a || typeof a.uid !== 'string' || !a.uid) throw new HttpsError('invalid-argument', `awards[${i}].uid is required — every award needs an explicit recipient.`);
    if (!participantIds.includes(a.uid)) throw new HttpsError('invalid-argument', `awards[${i}].uid is not a member of this pool.`);
    const amount = Number(a.amount);
    if (!Number.isFinite(amount)) throw new HttpsError('invalid-argument', `awards[${i}].amount must be a number.`);
    if (!KINDS.includes(a.kind)) throw new HttpsError('invalid-argument', `awards[${i}].kind must be one of ${KINDS.join('/')}.`);
    if (a.kind !== 'ADJUSTMENT' && amount < 0) throw new HttpsError('invalid-argument', `awards[${i}].amount must be >= 0 (negative only on ADJUSTMENT corrections).`);
    if (a.supersedes !== undefined && typeof a.supersedes !== 'string') throw new HttpsError('invalid-argument', `awards[${i}].supersedes must be an awardId.`);
    return {
      uid: a.uid,
      entryId: typeof a.entryId === 'string' ? a.entryId : undefined,
      amount,
      kind: a.kind,
      place: Number.isFinite(Number(a.place)) ? Number(a.place) : undefined,
      settled: a.settled === true,
      note: typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 500) : undefined,
      supersedes: a.supersedes,
    };
  });

  // Supersession targets must exist and not already be superseded.
  for (const a of validated) {
    if (!a.supersedes) continue;
    const target = await poolRef.collection('payoutRecords').doc(a.supersedes).get();
    if (!target.exists) throw new HttpsError('invalid-argument', `supersedes target ${a.supersedes} not found.`);
    if ((target.data() as any).supersededBy) throw new HttpsError('failed-precondition', `award ${a.supersedes} is already superseded — correct the latest record instead.`);
  }

  const now = Date.now();
  const batch = db.batch();
  const awardIds: string[] = [];
  for (const a of validated) {
    const awardRef = poolRef.collection('payoutRecords').doc();
    awardIds.push(awardRef.id);
    batch.set(awardRef, {
      uid: a.uid,
      ...(a.entryId ? { entryId: a.entryId } : {}),
      amount: a.amount,
      kind: a.kind,
      ...(a.place !== undefined ? { place: a.place } : {}),
      recordedAt: now,
      schemaVersion: PAYOUT_SCHEMA_VERSION,
    });
    batch.set(poolRef.collection('payoutRecordsPrivate').doc(awardRef.id), {
      uid: a.uid,
      settled: a.settled,
      ...(a.note ? { note: a.note } : {}),
      recordedBy: actorUid,
      schemaVersion: PAYOUT_SCHEMA_VERSION,
    });
    if (a.supersedes) {
      batch.update(poolRef.collection('payoutRecords').doc(a.supersedes), { supersededBy: awardRef.id });
    }
  }
  batch.update(poolRef, { payoutsRecordedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  // Audit-trail ledger events (best-effort by design; payoutRecords is the truth).
  for (let i = 0; i < validated.length; i++) {
    const a = validated[i];
    await writeLedgerEvent(db, poolId, {
      type: a.settled ? 'PAYOUT_PAID' : 'PAYOUT_UNPAID',
      uid: a.uid,
      ...(a.entryId ? { entryId: a.entryId } : {}),
      amount: a.amount,
      ...(a.note ? { note: a.note } : {}),
      actorUid,
    });
  }

  await writeAuditEvent({
    poolId,
    type: 'POOL_STATUS_CHANGED',
    message: `Payouts recorded (${validated.length} award(s)) by ${actorUid}`,
    severity: 'INFO',
    actor: { uid: actorUid, role: 'ADMIN', label: 'Host' },
    payload: { awards: validated.length, awardIds },
  });

  return { success: true, awardIds };
});
