import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Firestore/Auth emulator needs a JRE; a portable one may not be on PATH, so
// this config lets JAVA_HOME be injected via the JAVA_HOME env var when
// running (see README note in tests/e2e). Falls back to whatever's on PATH.
const javaHome = process.env.JAVA_HOME;
const emulatorEnv: Record<string, string> = javaHome
  ? { PATH: `${path.join(javaHome, 'bin')};${process.env.PATH}` }
  : {};

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // auth+functions+firestore together: onUserCreated (auth trigger) must
      // fire and write users/{uid}, which createPool/createNFLPool require.
      // Build first (emulators:start does not run predeploy/copy-shared).
      command:
        'npm --prefix functions run build && firebase emulators:start --only auth,functions,firestore --project demo-mmp',
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: emulatorEnv,
    },
    {
      command: 'npm run dev:e2e',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
