import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Firestore/Auth emulator needs a JRE; a portable one may not be on PATH, so
// this config lets JAVA_HOME be injected via the JAVA_HOME env var when
// running (see README note in tests/e2e). Falls back to whatever's on PATH.
//
// path.delimiter, NOT a hardcoded ';'. A literal ';' is only the PATH separator
// on Windows; on the Linux CI runner (where actions/setup-java ALWAYS exports
// JAVA_HOME, so this branch always fires) it would glue "<javaHome>/bin" and the
// first real PATH entry into one unusable element — and that first entry is the
// node/npm toolcache dir, so the emulator webServer's `npm --prefix functions
// run build` would fail to find npm. Cross-platform by construction now.
const javaHome = process.env.JAVA_HOME;
const emulatorEnv: Record<string, string> = javaHome
  ? { PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}` }
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
      // This window covers `tsc` over the whole functions tree AND the emulator
      // binding 8080. 120s is comfortable locally (12.3s to bind, measured
      // 2026-08-24, with functions/lib already built). On a cold CI runner the
      // tsc half alone is the bulk of it, so CI gets 240s rather than failing the
      // e2e job for being slow. Local stays at 120s — a two-minute local hang is
      // a problem worth surfacing fast.
      timeout: process.env.CI ? 240_000 : 120_000,
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
