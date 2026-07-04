import { defineConfig } from 'vitest/config';

// Emulator-backed tests: run via `npm run test:emulator`, which wraps this in
// `firebase emulators:exec --only firestore` (sets FIRESTORE_EMULATOR_HOST).
export default defineConfig({
  test: {
    include: ['src/**/*.emulator.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**'],
    // admin.initializeApp must run before any function module (billing.ts calls
    // admin.firestore() at module load).
    setupFiles: ['./src/__tests__/emulator/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
