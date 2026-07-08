// Triggers that keep rosterSummary + commissioner aggregate fresh WITHOUT hooking noisy
// entry pick/score writes. Fires on: Member Record writes (membership/payment), payout
// writes, and pool-doc fee/inclusion field changes (ADR 0003 item 7).
import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { recomputeRosterSummary } from "./lib/rosterSummary";
import { recomputeCommissionerAggregate, ownerOf } from "./lib/commissionerAggregate";

const db = () => admin.firestore();

async function refreshPoolAndOwner(poolId: string): Promise<void> {
  await recomputeRosterSummary(db(), poolId);
  const poolSnap = await db().collection('pools').doc(poolId).get();
  const owner = ownerOf(poolSnap.data());
  if (owner) await recomputeCommissionerAggregate(db(), owner);
}

/** Member Record add/remove/payment change → refresh that pool's summary + its commissioner. */
export const onMemberRecordWrite = onDocumentWritten('pools/{poolId}/members/{uid}', async (event) => {
  await refreshPoolAndOwner(event.params.poolId);
});

/** Payout marked/reversed on a winner doc → commissioner Payouts can change with no member write. */
export const onWinnerWrite = onDocumentWritten('pools/{poolId}/winners/{winId}', async (event) => {
  const poolSnap = await db().collection('pools').doc(event.params.poolId).get();
  const owner = ownerOf(poolSnap.data());
  if (owner) await recomputeCommissionerAggregate(db(), owner);
});

const WATCHED_FIELDS = ['status', 'closedVia', 'isFinal'];
const WATCHED_FEE_PATHS = (p: any) => ({
  entryFee: p?.settings?.entryFee,
  costPerSquare: p?.costPerSquare ?? p?.settings?.costPerSquare,
  rebuyCost: p?.settings?.rebuyCost,
});

/**
 * Pool-doc write → refresh only when an inclusion or fee field actually changed (a fee edit
 * changes Dues Expected; a lifecycle change flips inclusion), so we don't recompute on every
 * unrelated pool update.
 */
export const onPoolRosterFieldsChange = onDocumentWritten('pools/{poolId}', async (event) => {
  const before: any = event.data?.before?.data();
  const after: any = event.data?.after?.data();
  if (!after) return; // deletes handled elsewhere
  const inclusionChanged = WATCHED_FIELDS.some((f) => before?.[f] !== after?.[f]);
  const beforeFees = WATCHED_FEE_PATHS(before || {});
  const afterFees = WATCHED_FEE_PATHS(after);
  const feeChanged = (Object.keys(afterFees) as (keyof typeof afterFees)[]).some((k) => beforeFees[k] !== afterFees[k]);
  if (!inclusionChanged && !feeChanged) return;
  await refreshPoolAndOwner(event.params.poolId);
});
