import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

// Exported Cloud Functions
export { lockPool } from "./poolParams";
export { reserveSquare } from "./squares";
export { syncGameStatus, fixPoolScores } from "./scoreUpdates";
export { onWinnerUpdate, onAIRequest } from "./aiCommissioner";
export { onUserCreated, syncAllUsers } from "./userSync";
export { runReminders, onWinnerComputed } from "./reminders";
export { onPoolLocked, recalculateGlobalStats } from "./statsTrigger";
export { onUserCreated as createParticipantProfile, createClaimCode, claimMySquares, claimByCode, syncParticipantIndices } from "./participant";
export { createPool } from "./poolOps";
export { backfillPools } from "./backfill";
export { createBracketPool, publishBracketPool, joinBracketPool } from "./bracketPools";
export { createBracketEntry, updateBracketEntry, submitBracketEntry } from "./bracketEntries";
