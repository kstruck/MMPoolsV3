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
  // 120s: registration + reload-to-surface-SUPER_ADMIN + wizard walk + real
  // callable round-trip, with headroom for the first test's cold-start cost.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // Unique port (not 5173) so a stray `npm run dev` from another checkout of
    // this repo can't be silently reused in place of this worktree's build.
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // auth+functions+firestore together: onUserCreated (auth trigger) must
      // fire and write users/{uid}, which createPool/createNFLPool require.
      // Build first (emulators:start does not run predeploy/copy-shared).
      // `npx firebase` (not bare `firebase`) — the bare binary is only on PATH
      // inside npm-run-script shells, not in the raw shell Playwright spawns
      // webServer commands in.
      command:
        'npm --prefix functions run build && npx firebase emulators:start --only auth,functions,firestore --project demo-mmp',
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: emulatorEnv,
    },
    {
      // reuseExistingServer:false — always spawn this worktree's own e2e server
      // (on the dedicated 5199 port) rather than reuse whatever's already bound.
      command: 'npm run dev:e2e',
      port: 5199,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
