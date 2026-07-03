import { onCall } from "firebase-functions/v2/https";

/**
 * Returns the server's current epoch ms so clients can correct device-clock
 * drift in countdown/lock UI. Enforcement still happens server-side at submit;
 * this only keeps what the user SEES honest.
 */
export const getServerTime = onCall({ cors: true }, () => {
    return { serverTime: Date.now() };
});
