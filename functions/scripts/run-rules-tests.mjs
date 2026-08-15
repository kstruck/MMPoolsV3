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
const MIN_FILES = 8;
// Every test file initialises rules-unit-testing with this project id.
const PROJECT_ID = 'gridiron-gamble-uzuqo';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) {
    console.error('FIRESTORE_EMULATOR_HOST is not set — run this via `npm --prefix functions run test:rules`, which wraps it in `firebase emulators:exec`.');
    process.exit(1);
}

const files = readdirSync(here).filter((f) => f.endsWith('.rules.test.mjs')).sort();
if (files.length < MIN_FILES) {
    console.error(`Expected at least ${MIN_FILES} *.rules.test.mjs files in ${here}, found ${files.length}: ${files.join(', ') || '(none)'}`);
    process.exit(1);
}

let failed = 0;
for (const f of files) {
    const wipe = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
    if (!wipe.ok) {
        console.error(`Could not clear the emulator before ${f}: HTTP ${wipe.status}`);
        process.exit(1);
    }
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
    if (r.status !== 0) {
        failed += 1;
        console.error(`FAIL ${f} (exit ${r.status ?? 'signal ' + r.signal})`);
    }
}
console.log(`\n${files.length - failed}/${files.length} rules test files passed`);
process.exit(failed === 0 ? 0 : 1);
