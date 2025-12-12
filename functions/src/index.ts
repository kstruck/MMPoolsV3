import * as admin from "firebase-admin";

admin.initializeApp();

export const db = admin.firestore();

// Exported Cloud Functions
export { lockPool } from "./poolParams";
export { reserveSquare } from "./squares";
