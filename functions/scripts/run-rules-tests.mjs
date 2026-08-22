/**
 * Runs every `functions/scripts/*.rules.test.mjs` against ONE Firestore
 * emulator, sequentially, clearing the emulator's data between files.
 *
 * Why this exists: those eight files were hand-run only. `npm run test:emulator`
 * runs vitest, not these, so the `participantIds` authorization guard from #432
 * (and the seven older rules guards) ran on NO pull request. This is the CI
 * entry point (`npm run test:rules` in `functions/`, wired into
 * `.github/workflows/ci.yml`'s emulator-tests job).
 *
 * Run locally, from anywhere:
 *   npm --prefix functions run test:rules
 *
 * Shape:
 *   - `emulators:exec` starts the emulator once and sets FIRESTORE_EMULATOR_HOST.
 *   - Each test file is spawned as its own Node process (they use top-level
 *     await and `process.exit`, so they cannot be imported into one process).
 *   - The emulator is wiped between files via its REST endpoint, because none of
 *     the tests call `clearFirestore()` — they were written to run alone. Without
 *     the wipe, a `users/{uid}` role doc seeded by one file could satisfy an
 *     `isSuperAdmin()` branch in the next and turn a FAIL case green.
 *   - Empty-pass protection: the count of discovered files must be at least
 *     MIN_FILES. A broken glob fails the job instead of reporting zero as green
 *     (same convention as fixtureMatrix's `FIXTURES.length >= 40`).
 *   - cwd is forced to the repo root because every test does
 *     `readFileSync('firestore.rules')` relative to cwd.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
process.chdir(repoRoot);

// Bump this when a rules test is ADDED. Lower it only with a written reason.
// 10 as of PLAN-COST-CONTROLS 0.5.1 (aiRequests.rules.test.mjs).
const MIN_FILES = 10;
// Every test file initialises rules-unit-testing with this project id.
const PROJECT_ID = 'gridiron-gamble-uzuqo';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) {
    console.error(
        'FIRESTORE_EMULATOR_HOST is not set — run this via ' +
        '`npm --prefix functions run test:rules`, which wraps it in `firebase emulators:exec`.',
    );
    process.exit(1);
}
// The wipe below is a DELETE against whatever host that variable names. Refuse
// anything but loopback — the same fail-fast the emulator vitest suites apply
// in functions/src/__tests__/emulator/setup.ts. (qodo on #434.)
const hostname = new URL(`http://${host}`).hostname; // strips port; IPv6 comes back bracketed
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    console.error(`Refusing to wipe a non-loopback Firestore host: ${host}`);
    process.exit(1);
}
// Bounded, so a stuck emulator or a hung test file fails the job instead of
// holding it until the runner-level timeout. (qodo on #434.)
const WIPE_TIMEOUT_MS = Number(process.env.RULES_WIPE_TIMEOUT_MS ?? 30_000);
const TEST_TIMEOUT_MS = Number(process.env.RULES_TEST_TIMEOUT_MS ?? 5 * 60_000);

const files = readdirSync(here).filter((f) => f.endsWith('.rules.test.mjs')).sort();
if (files.length < MIN_FILES) {
    console.error(
        `Expected at least ${MIN_FILES} *.rules.test.mjs files in ${here}, ` +
        `found ${files.length}: ${files.join(', ') || '(none)'}`,
    );
    process.exit(1);
}

let failed = 0;
for (const f of files) {
    const wipe = await fetch(
        `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
        { method: 'DELETE', signal: AbortSignal.timeout(WIPE_TIMEOUT_MS) },
    ).catch((err) => ({ ok: false, status: String(err?.name ?? err) }));
    if (!wipe.ok) {
        console.error(`Could not clear the emulator before ${f}: ${wipe.status}`);
        process.exit(1);
    }
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(here, f)], {
        stdio: 'inherit',
        timeout: TEST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
    });
    if (r.status !== 0) {
        failed += 1;
        const why = r.error?.code === 'ETIMEDOUT'
            ? `timed out after ${TEST_TIMEOUT_MS}ms`
            : `exit ${r.status ?? 'signal ' + r.signal}`;
        console.error(`FAIL ${f} (${why})`);
    }
}
console.log(`\n${files.length - failed}/${files.length} rules test files passed`);
process.exit(failed === 0 ? 0 : 1);
