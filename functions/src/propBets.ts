import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as admin from 'firebase-admin';
import { PropCard, GameState } from './types';
import { writeAuditEvent } from './audit';
import { checkBillingAccess } from './billing';
import { validated } from "./lib/validated";
import { purchasePropCardSchema } from "./schemas/squaresProps";
import { gradePropSchema, updatePropCardSchema } from "./schemas/propBets";

// 1. Purchase Prop Card (Supports multiple cards per user)
// 1. Purchase Prop Card (Supports multiple cards per user)
export const purchasePropCard = validated(
    // PUBLIC (guest flow): answers is qId -> option index, shape-enforced at
    // the gate; guest identity + card-limit logic stays below.
    { schema: purchasePropCardSchema, label: "purchasePropCard", auth: "public", appCheck: "monitor" },
    async (input, request) => {
    // Auth Handling
    let userId: string;
    let finalUserName: string;
    let userEmail: string | undefined;

    const { poolId, answers, tiebreakerVal, userName, cardName, email } = input;

    if (request.auth) {
        userId = request.auth.uid;
        finalUserName = userName || request.auth.token.name || 'Anonymous';
        userEmail = request.auth.token.email; // Optional
    } else {
        // Guest Mode
        if (!userName || !email) {
            throw new HttpsError('unauthenticated', 'Must be logged in OR provide Name and Email to play as guest.');
        }
        // Create a stable ID for the guest based on email to track card limits
        userId = `guest:${email.toLowerCase().trim()}`;
        finalUserName = userName;
        userEmail = email;
    }

    const db = admin.firestore();

    // Check if pool is locked
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError('not-found', 'Pool not found.');
    }
    const poolData = poolSnap.data() as GameState;

    // Check Status (isLocked covers most cases)
    if (poolData.isLocked) {
        throw new HttpsError('failed-precondition', 'Pool is locked. No new entries allowed.');
    }

    // Get maxCards limit (default: 1)
    const maxCards = poolData.props?.maxCards || 1;

    // Count user's existing cards
    const existingCards = await poolRef.collection('propCards')
        .where('userId', '==', userId)
        .get();

    if (existingCards.size >= maxCards) {
        throw new HttpsError('resource-exhausted', `You can only purchase ${maxCards} card(s) for this pool.`);
    }

    const billingCheck = checkBillingAccess(poolData.billing);
    if (!billingCheck.allowed) {
        throw new HttpsError('failed-precondition', billingCheck.reason || 'Pool is locked due to billing.');
    }

    // Enforce 10-player Free Plan participant lock
    const billingStatus = poolData.billing?.status ?? 'free';
    if (billingStatus === 'free') {
        const currentEntriesCount = poolData.entryCount || 0;
        if (currentEntriesCount >= 10) {
            throw new HttpsError('failed-precondition', 'This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.');
        }
    }

    // Create Card with auto-generated ID (supports multiple cards)
    const card: PropCard = {
        userId,
        userName: finalUserName,
        cardName: cardName || `Card #${existingCards.size + 1}`,
        purchasedAt: Date.now(),
        answers,
        score: 0,
        tiebreakerVal: Number(tiebreakerVal) || 0,
        // Store email if available (guest or auth) for future claiming/notifications
        email: userEmail
    } as any; // Cast to any to add 'email' if not in PropCard type yet

    // Use add() instead of doc(userId).set() to allow multiple cards
    await poolRef.collection('propCards').add(card);

    // Increment entryCount on the main pool document
    await poolRef.update({
        entryCount: FieldValue.increment(1)
    });

    // Audit Log
    await writeAuditEvent({
        poolId,
        type: 'PROP_CARD_PURCHASED',
        message: `${finalUserName} purchased a Prop Card: ${cardName || 'Card'}`,
        severity: 'INFO',
        actor: request.auth ? { uid: request.auth.uid, role: 'USER', label: finalUserName } : { uid: userId, role: 'GUEST', label: finalUserName },
        payload: { userId, cardName, timestamp: card.purchasedAt }
    });

    return { success: true, cardCount: existingCards.size + 1 };
    },
);

// 2. Grade Prop (Admin Only)
export const gradeProp = validated(
    // Owner/manager gate stays in-handler (needs the pool doc).
    { schema: gradePropSchema, label: "gradeProp", appCheck: "monitor" },
    async ({ poolId, questionId, correctOptionIndex }, request) => {
    const db = admin.firestore();

    // Validate Admin
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found');

    const poolData = poolSnap.data() as GameState;

    // Check Owner, Manager, or SuperAdmin
    const isOwner = poolData.ownerId === request.auth!.uid;
    const isManager = poolData.managerUid === request.auth!.uid;
    // Note: SuperAdmin check usually requires checking Custom Claims or a User doc. 
    // For now we enforce Pool Owner/Manager.

    if (!isOwner && !isManager) {
        throw new HttpsError('permission-denied', 'Only pool owner/manager can grade.');
    }

    const questions = poolData.props?.questions || [];
    const qIndex = questions.findIndex((q: any) => q.id === questionId);

    if (qIndex === -1) {
        throw new HttpsError('not-found', 'Question not found in pool config');
    }

    // Update local object
    const updatedQuestions = [...questions];
    updatedQuestions[qIndex] = {
        ...updatedQuestions[qIndex],
        correctOption: correctOptionIndex
    };

    // Write Config Update
    await poolRef.update({
        'props.questions': updatedQuestions
    });

    // RE-CALCULATE SCORES for ALL Cards
    const cardsSnap = await poolRef.collection('propCards').get();

    const batch = db.batch();

    cardsSnap.docs.forEach(doc => {
        const card = doc.data() as PropCard;
        let score = 0;

        // Loop through all questions in the UPDATED config
        updatedQuestions.forEach((q: any) => {
            if (q.correctOption !== undefined && q.correctOption !== null) {
                if (card.answers[q.id] === q.correctOption) {
                    score += (q.points || 1);
                }
            }
        });

        batch.update(doc.ref, { score });
    });

    await batch.commit();

    // Audit Log
    await writeAuditEvent({
        poolId,
        type: 'PROP_QUESTION_GRADED',
        message: `Question Graded: "${questions[qIndex].text}"`,
        severity: 'INFO',
        actor: { uid: request.auth!.uid, role: 'ADMIN', label: 'Admin' },
        payload: { questionId, correctOptionIndex }
    });

    return { success: true, updated: cardsSnap.size };
    },
);

// 3. Update Prop Card (Edit answers before lock)
export const updatePropCard = validated(
    // Card-ownership gate stays in-handler (needs the card doc).
    { schema: updatePropCardSchema, label: "updatePropCard", appCheck: "monitor" },
    async ({ poolId, cardId, answers, tiebreakerVal, cardName }, request) => {
    const userId = request.auth!.uid;
    const db = admin.firestore();

    // Check pool status
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError('not-found', 'Pool not found.');
    }
    const poolData = poolSnap.data() as GameState;

    if (poolData.isLocked) {
        throw new HttpsError('failed-precondition', 'Pool is locked. Cannot edit answers.');
    }

    const billingCheck = checkBillingAccess(poolData.billing);
    if (!billingCheck.allowed) {
        throw new HttpsError('failed-precondition', billingCheck.reason || 'Pool is locked due to billing.');
    }

    // Verify card ownership
    const cardRef = poolRef.collection('propCards').doc(cardId);
    const cardSnap = await cardRef.get();
    if (!cardSnap.exists) {
        throw new HttpsError('not-found', 'Card not found.');
    }
    const cardData = cardSnap.data() as PropCard;
    if (cardData.userId !== userId) {
        throw new HttpsError('permission-denied', 'You can only edit your own cards.');
    }

    // Update the card
    await cardRef.update({
        answers,
        tiebreakerVal: Number(tiebreakerVal) || cardData.tiebreakerVal,
        cardName: cardName || cardData.cardName,
        updatedAt: Date.now()
    });

    // Audit Log
    await writeAuditEvent({
        poolId,
        type: 'ADMIN_OVERRIDE_SQUARE_STATE', // Reusing OR could add PROP_CARD_UPDATED
        message: `${cardData.userName} updated Prop Card: ${cardName || cardData.cardName}`,
        severity: 'INFO',
        actor: { uid: userId, role: 'USER', label: cardData.userName },
        payload: { cardId, cardName }
    });

    return { success: true };
    },
);
