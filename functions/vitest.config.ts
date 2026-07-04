import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the mocked unit tests (billing/coupon/referral). The emulator-backed
    // rules tests under scripts/*.rules.test.mjs need @firebase/rules-unit-testing
    // + a running emulator and are run separately, not in the default gate.
    include: ['src/**/*.test.ts'],
    // *.emulator.test.ts need a live Firestore emulator — run via `npm run
    // test:emulator` (vitest.emulator.config.ts), not the default mocked gate.
    exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**', '**/*.emulator.test.ts'],
  },
});
