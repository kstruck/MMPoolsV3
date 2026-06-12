import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const db = admin.firestore();

// Triggered when a pool's billing status changes to 'active' (payment confirmed)
export const creditReferralOnPayment = onDocumentUpdated('pools/{poolId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  if (!before || !after) return;

  // Only trigger when billing status changes TO 'active'
  if (before.billing?.status === after.billing?.status) return;
  if (after.billing?.status !== 'active') return;

  const ownerId = after.ownerId || after.createdByUid;
  if (!ownerId) return;

  // Check if this pool owner was referred by someone
  const referralsSnap = await db.collection('referrals')
    .where('referredUserId', '==', ownerId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (referralsSnap.empty) return;

  const referralDoc = referralsSnap.docs[0];
  const referrerId = referralDoc.data().referrerId;

  if (referrerId === ownerId) {
    console.warn(`Blocked self-referral credit attempt by ${ownerId}`);
    return;
  }

  // Load referral config
  const configSnap = await db.doc('settings/referral_config').get();
  const config = configSnap.data() || { creditsRequiredForFreePool: 5, discountPerCredit: 5 };

  // Run atomic transaction
  await db.runTransaction(async (tx) => {
    const referrerRef = db.doc(`users/${referrerId}`);
    const referrerSnap = await tx.get(referrerRef);

    if (!referrerSnap.exists) return;

    const currentCredits = (referrerSnap.data()?.referralCredits || 0) + 1;
    const updates: Record<string, any> = { referralCredits: currentCredits };

    // If they've hit the free pool threshold, award a free pool token
    if (currentCredits >= config.creditsRequiredForFreePool) {
      updates.freePoolsAvailable = admin.firestore.FieldValue.increment(1);
      updates.referralCredits = currentCredits - config.creditsRequiredForFreePool;
    }

    tx.update(referrerRef, updates);

    // Mark this referral as confirmed
    tx.update(referralDoc.ref, {
      status: 'confirmed',
      confirmedAt: Date.now(),
      creditAwarded: true
    });
  });

  console.log(`Referral credit awarded to ${referrerId} for referred user ${ownerId}`);
});

export const generateReferralToken = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }
    const uid = request.auth.uid;
    const token = crypto.randomBytes(16).toString('hex');

    await db.collection('referralTokens').doc(token).set({
        uid,
        createdAt: Date.now()
    });

    return { token };
});

export const resolveReferralToken = onCall(async (request) => {
    const { token } = request.data;
    if (!token) {
        throw new HttpsError('invalid-argument', 'Missing token.');
    }

    const tokenDoc = await db.collection('referralTokens').doc(token).get();
    if (!tokenDoc.exists) {
        throw new HttpsError('not-found', 'Invalid referral token.');
    }

    const referrerUid = tokenDoc.data()?.uid;
    if (request.auth && request.auth.uid === referrerUid) {
        throw new HttpsError('invalid-argument', 'Self-referral is not permitted.');
    }

    return { uid: referrerUid };
});
