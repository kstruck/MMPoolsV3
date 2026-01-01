"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePropCard = exports.gradeProp = exports.purchasePropCard = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
// 1. Purchase Prop Card (Supports multiple cards per user)
// 1. Purchase Prop Card (Supports multiple cards per user)
exports.purchasePropCard = (0, https_1.onCall)(async (request) => {
    // request.data = { poolId, answers: { qId: idx }, tiebreakerVal, userName, cardName, email }
    var _a;
    // Auth Handling
    let userId;
    let finalUserName;
    let userEmail;
    const { poolId, answers, tiebreakerVal, userName, cardName, email } = request.data;
    if (request.auth) {
        userId = request.auth.uid;
        finalUserName = userName || request.auth.token.name || 'Anonymous';
        userEmail = request.auth.token.email; // Optional
    }
    else {
        // Guest Mode
        if (!userName || !email) {
            throw new https_1.HttpsError('unauthenticated', 'Must be logged in OR provide Name and Email to play as guest.');
        }
        // Create a stable ID for the guest based on email to track card limits
        userId = `guest:${email.toLowerCase().trim()}`;
        finalUserName = userName;
        userEmail = email;
    }
    const db = admin.firestore();
    if (!poolId || !answers) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or answers.');
    }
    // Check if pool is locked
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found.');
    }
    const poolData = poolSnap.data();
    // Check Status (isLocked covers most cases)
    if (poolData.isLocked) {
        throw new https_1.HttpsError('failed-precondition', 'Pool is locked. No new entries allowed.');
    }
    // Get maxCards limit (default: 1)
    const maxCards = ((_a = poolData.props) === null || _a === void 0 ? void 0 : _a.maxCards) || 1;
    // Count user's existing cards
    const existingCards = await poolRef.collection('propCards')
        .where('userId', '==', userId)
        .get();
    if (existingCards.size >= maxCards) {
        throw new https_1.HttpsError('resource-exhausted', `You can only purchase ${maxCards} card(s) for this pool.`);
    }
    // Create Card with auto-generated ID (supports multiple cards)
    const card = {
        userId,
        userName: finalUserName,
        cardName: cardName || `Card #${existingCards.size + 1}`,
        purchasedAt: Date.now(),
        answers,
        score: 0,
        tiebreakerVal: Number(tiebreakerVal) || 0,
        // Store email if available (guest or auth) for future claiming/notifications
        email: userEmail
    }; // Cast to any to add 'email' if not in PropCard type yet
    // Use add() instead of doc(userId).set() to allow multiple cards
    await poolRef.collection('propCards').add(card);
    // Increment entryCount on the main pool document
    await poolRef.update({
        entryCount: admin.firestore.FieldValue.increment(1)
    });
    return { success: true, cardCount: existingCards.size + 1 };
});
// 2. Grade Prop (Admin Only)
exports.gradeProp = (0, https_1.onCall)(async (request) => {
    var _a;
    // request.data = { poolId, questionId, correctOptionIndex }
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { poolId, questionId, correctOptionIndex } = request.data;
    const db = admin.firestore();
    // Validate Admin
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        throw new https_1.HttpsError('not-found', 'Pool not found');
    const poolData = poolSnap.data();
    // Check Owner, Manager, or SuperAdmin
    const isOwner = poolData.ownerId === request.auth.uid;
    const isManager = poolData.managerUid === request.auth.uid;
    // Note: SuperAdmin check usually requires checking Custom Claims or a User doc. 
    // For now we enforce Pool Owner/Manager.
    if (!isOwner && !isManager) {
        throw new https_1.HttpsError('permission-denied', 'Only pool owner/manager can grade.');
    }
    const questions = ((_a = poolData.props) === null || _a === void 0 ? void 0 : _a.questions) || [];
    const qIndex = questions.findIndex((q) => q.id === questionId);
    if (qIndex === -1) {
        throw new https_1.HttpsError('not-found', 'Question not found in pool config');
    }
    // Update local object
    const updatedQuestions = [...questions];
    updatedQuestions[qIndex] = Object.assign(Object.assign({}, updatedQuestions[qIndex]), { correctOption: correctOptionIndex });
    // Write Config Update
    await poolRef.update({
        'props.questions': updatedQuestions
    });
    // RE-CALCULATE SCORES for ALL Cards
    const cardsSnap = await poolRef.collection('propCards').get();
    const batch = db.batch();
    cardsSnap.docs.forEach(doc => {
        const card = doc.data();
        let score = 0;
        // Loop through all questions in the UPDATED config
        updatedQuestions.forEach((q) => {
            if (q.correctOption !== undefined && q.correctOption !== null) {
                if (card.answers[q.id] === q.correctOption) {
                    score += (q.points || 1);
                }
            }
        });
        batch.update(doc.ref, { score });
    });
    await batch.commit();
    return { success: true, updated: cardsSnap.size };
});
// 3. Update Prop Card (Edit answers before lock)
exports.updatePropCard = (0, https_1.onCall)(async (request) => {
    // request.data = { poolId, cardId, answers, tiebreakerVal, cardName }
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { poolId, cardId, answers, tiebreakerVal, cardName } = request.data;
    const userId = request.auth.uid;
    const db = admin.firestore();
    if (!poolId || !cardId || !answers) {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields.');
    }
    // Check pool status
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found.');
    }
    const poolData = poolSnap.data();
    if (poolData.isLocked) {
        throw new https_1.HttpsError('failed-precondition', 'Pool is locked. Cannot edit answers.');
    }
    // Verify card ownership
    const cardRef = poolRef.collection('propCards').doc(cardId);
    const cardSnap = await cardRef.get();
    if (!cardSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Card not found.');
    }
    const cardData = cardSnap.data();
    if (cardData.userId !== userId) {
        throw new https_1.HttpsError('permission-denied', 'You can only edit your own cards.');
    }
    // Update the card
    await cardRef.update({
        answers,
        tiebreakerVal: Number(tiebreakerVal) || cardData.tiebreakerVal,
        cardName: cardName || cardData.cardName,
        updatedAt: Date.now()
    });
    return { success: true };
});
//# sourceMappingURL=propBets.js.map