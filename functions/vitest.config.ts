import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the mocked unit tests (billing/coupon/referral). The emulator-backed
    // rules tests under scripts/*.rules.test.mjs need @firebase/rules-unit-testing
    // + a running emulator and are run separately, not in the default gate.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**'],
  },
});
