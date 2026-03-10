import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
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
export const db = getFirestore(app);
export const functions = getFunctions(app);