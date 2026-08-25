import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The client Sentry setup can only work if the Dockerfile passes its config in.
 *
 * WHY THIS GUARD EXISTS. `src/sentry.ts` reads `import.meta.env.VITE_SENTRY_DSN`,
 * and Vite inlines `import.meta.env.*` at BUILD time from the build environment.
 * The production image is built by Coolify from this Dockerfile, so a variable
 * Kevin sets in the Coolify UI reaches the build ONLY if the Dockerfile declares
 * it as an `ARG` and re-exports it as an `ENV` before `RUN npx vite build`.
 * It did neither until 2026-08-24, which meant `loadSentry()` saw an empty DSN in
 * every production image and the whole error-tracking path was dead code — the
 * finding the error-tracking audit scored 2/6 over. Nothing failed; there was
 * simply never any telemetry.
 *
 * That failure is INVISIBLE: no build error, no runtime error, no missing file.
 * So the guard is derived from the source rather than hardcoded — every
 * `VITE_*` name `src/sentry.ts` reads must be wired, which means adding a new
 * knob to that file and forgetting the Dockerfile fails here instead of shipping
 * inert.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const dockerfile = read('Dockerfile');
const sentrySource = read('src/sentry.ts');

/** Only the BUILD stage matters — an ENV in the nginx stage is inlined nowhere. */
function buildStage(text: string): string {
    const lines = text.split(/\r?\n/);
    const stageStarts = lines
        .map((l, i) => ({ l: l.trim(), i }))
        .filter(({ l }) => /^FROM\s/i.test(l))
        .map(({ i }) => i);
    // First stage runs the vite build; it ends where the next FROM begins.
    const start = stageStarts[0] ?? 0;
    const end = stageStarts[1] ?? lines.length;
    return lines.slice(start, end).join('\n');
}

const BUILD_STAGE = buildStage(dockerfile);

/** Every VITE_* name the Sentry module reads out of import.meta.env. */
function viteEnvNamesReadBy(source: string): string[] {
    const names = new Set<string>();
    for (const m of source.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) names.add(m[1]);
    return [...names].sort();
}

const SENTRY_ENV_NAMES = viteEnvNamesReadBy(sentrySource);

describe('Dockerfile passes the client Sentry config into the Vite build', () => {
    it('src/sentry.ts still reads its config from import.meta.env (guard is not vacuous)', () => {
        // Without this, a refactor that stopped reading import.meta.env would make
        // every assertion below pass over an empty list — a guard that guards nothing,
        // which this repo has shipped before (tests/docs-state-invariants.test.ts).
        expect(SENTRY_ENV_NAMES).toContain('VITE_SENTRY_DSN');
        expect(SENTRY_ENV_NAMES).toContain('VITE_SENTRY_REPLAY_SAMPLE_RATE');
    });

    it.each(SENTRY_ENV_NAMES)('declares ARG %s in the build stage', (name) => {
        expect(BUILD_STAGE).toMatch(new RegExp(`^\\s*ARG\\s+${name}\\s*$`, 'm'));
    });

    it.each(SENTRY_ENV_NAMES)('re-exports ENV %s from that ARG', (name) => {
        // `ARG` alone is NOT enough: a build arg is not an environment variable, so
        // Vite's loadEnv/process.env lookup would still see nothing. The ENV line is
        // the half that actually makes it reachable.
        expect(BUILD_STAGE).toMatch(new RegExp(`^\\s*ENV\\s+${name}=\\$${name}\\s*$`, 'm'));
    });

    it.each(SENTRY_ENV_NAMES)('sets ENV %s BEFORE the vite build runs', (name) => {
        const envAt = BUILD_STAGE.search(new RegExp(`^\\s*ENV\\s+${name}=`, 'm'));
        const buildAt = BUILD_STAGE.search(/^\s*RUN\s+npx\s+vite\s+build\s*$/m);
        expect(envAt).toBeGreaterThan(-1);
        expect(buildAt).toBeGreaterThan(-1);
        expect(envAt).toBeLessThan(buildAt);
    });
});
