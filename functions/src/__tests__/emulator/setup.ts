import * as admin from 'firebase-admin';

/**
 * REFUSE TO RUN AGAINST A REAL BACKEND.
 *
 * Every suite in this directory wipes whole collections — `pools`, `nfl_games`,
 * `users/*` subcollections — between tests. `emulators:exec` sets
 * `FIRESTORE_EMULATOR_HOST`, and its absence means vitest was pointed at this
 * config directly (`npx vitest --config vitest.emulator.config.ts`) rather than
 * through `npm run test:emulator`. The `demo-` project id below makes that
 * MOSTLY harmless — a demo project cannot reach live services — but it is only a
 * default: `process.env.GCLOUD_PROJECT` wins when it is already set, and a shell
 * carrying `GCLOUD_PROJECT=gridiron-gamble-uzuqo` plus ambient credentials would
 * point these deletes at production.
 *
 * Fail fast, here, once, for all twenty suites rather than per file — the guard
 * belongs where the connection is established, not where each wipe is written.
 * Raised by qodo on PR #332.
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'Emulator tests refused to start: FIRESTORE_EMULATOR_HOST is not set, so ' +
    'firebase-admin would not be pointed at the emulator — and these suites ' +
    'delete whole collections. Run `npm --prefix functions run test:emulator`, ' +
    'which wraps vitest in `firebase emulators:exec`.',
  );
}

// Ensure a project id (emulator does not require a real one). emulators:exec
// sets FIRESTORE_EMULATOR_HOST, so admin points at the emulator automatically.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mmp';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
