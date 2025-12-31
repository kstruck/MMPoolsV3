"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gradeProp = exports.purchasePropCard = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
// 1. Purchase Prop Card
exports.purchasePropCard = (0, https_1.onCall)(async (request) => {
    // request.data = { poolId, answers: { qId: idx }, tiebreakerVal }
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { poolId, answers, tiebreakerVal, userName } = request.data;
    const userId = request.auth.uid;
    const db = admin.firestore();
    if (!poolId || !answers) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or answers.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    // Check if user already bought one
    const cardRef = poolRef.collection('propCards').doc(userId);
    const existing = await cardRef.get();
    if (existing.exists) {
        throw new https_1.HttpsError('already-exists', 'You have already purchased a card for this pool.');
    }
    // Create Card
    const card = {
        userId,
        userName: userName || 'Anonymous',
        purchasedAt: Date.now(),
        answers,
        score: 0,
        tiebreakerVal: Number(tiebreakerVal) || 0
    };
    await cardRef.set(card);
    return { success: true };
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
    if (poolData.ownerId !== request.auth.uid) {
        // throw new HttpsError('permission-denied', 'Only owner can grade.');
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
                    score++;
                }
            }
        });
        batch.update(doc.ref, { score });
    });
    await batch.commit();
    return { success: true, updated: cardsSnap.size };
});
//# sourceMappingURL=propBets.js.map