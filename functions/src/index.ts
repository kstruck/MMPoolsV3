import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

// Exported Cloud Functions
export { lockPool } from "./poolParams";
export { reserveSquare } from "./squares";
export { syncGameStatus } from "./scoreUpdates";
export { onWinnerUpdate, onAIRequest } from "./aiCommissioner";
export { onUserCreated } from "./userSync";

