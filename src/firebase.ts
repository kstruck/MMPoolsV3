import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

// Firebase App Check — attestation layer to prevent API abuse
// Enable debug token in dev so local development isn't blocked
if (import.meta.env.DEV) {
    // @ts-expect-error — Firebase debug token flag
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
    initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
    });
} else if (!import.meta.env.DEV) {
    console.warn('⚠️ SECURITY: App Check is NOT active — VITE_RECAPTCHA_SITE_KEY is missing from environment');
}

export const auth = getAuth(app);
// Offline persistence: cached reads + queued writes survive spotty connections
// (users pick on phones in stadiums/bars — the network there is the worst case)
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const functions = getFunctions(app);

// E2E-only: point the client at local emulators instead of the real project.
// Opt-in via VITE_USE_FIREBASE_EMULATOR=true (set only in .env.e2e); never set
// in normal dev/prod, so this has zero effect outside a Playwright run.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}