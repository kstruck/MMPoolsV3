import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The production image is built by Coolify from the tracked `Dockerfile`, and
 * nothing else in this repo runs it. CI validates `npm run build:static`; the
 * image runs whatever the Dockerfile says. When those two drift, CI stays green
 * and the deploy breaks — which is exactly what a green `build-and-test` beside
 * a failed Coolify build looks like, and it is not obvious from either one.
 *
 * Two invariants, both learned on 2026-08-05:
 *
 * 1. **Install from the lockfile.** The Dockerfile ran `npm install`, which
 *    re-resolves every range. CI runs `npm ci`. A green CI run therefore said
 *    nothing about the tree the image would get.
 * 2. **The split build steps must still equal `build:static`.** Splitting one
 *    `RUN npm run build:static` into three RUN layers makes a failure name
 *    itself, at the cost of a new way to drift: someone edits the npm script
 *    and the Dockerfile silently keeps building the old thing. This test is the
 *    price of that trade.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const dockerfile = read('Dockerfile');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/**
 * Flatten a shell command into the leaf commands it actually runs, following
 * `npm run <script>` into package.json and splitting on `&&`.
 *
 * `npx foo` and `foo` collapse to the same leaf: `npx tsc -b` in the Dockerfile
 * and `tsc -b` in an npm script are the same program with the same arguments,
 * and the parity check is about WHAT runs, not how the binary is located.
 */
function leaves(command: string, seen = new Set<string>()): string[] {
    return command
        .split('&&')
        .map((part) => part.trim())
        .filter(Boolean)
        .flatMap((part) => {
            const runScript = part.match(/^npm run ([\w:-]+)$/);
            if (runScript) {
                const name = runScript[1];
                // Cycle guard: a script that runs itself would otherwise hang
                // the suite rather than fail it.
                if (seen.has(name)) return [`<cycle:${name}>`];
                const body = pkg.scripts[name];
                if (!body) return [`<missing-script:${name}>`];
                return leaves(body, new Set([...seen, name]));
            }
            return [part.replace(/^npx\s+/, '')];
        });
}

/** The `RUN` commands of the BUILD stage only — the nginx stage has its own. */
function buildStageRunCommands(): string[] {
    const stages = dockerfile.split(/^FROM /m);
    const build = stages.find((s) => s.startsWith('node:'));
    expect(build, 'Dockerfile should still have a node build stage').toBeTruthy();
    return (build as string)
        .split('\n')
        .filter((l) => l.startsWith('RUN '))
        .map((l) => l.slice(4).trim());
}

describe('the image installs the tree CI validated', () => {
    it('uses `npm ci`, never `npm install`', () => {
        expect(dockerfile).toMatch(/RUN npm ci\b/);
        expect(dockerfile).not.toMatch(/RUN npm install\b/);
    });

    it('copies the lockfile in — `npm ci` fails without it', () => {
        // `COPY package*.json` catches both; a narrowing to `package.json`
        // would make `npm ci` fail at build time rather than here.
        expect(dockerfile).toMatch(/COPY package\*\.json/);
    });

    it('.dockerignore does not exclude the lockfile', () => {
        const ignored = read('.dockerignore')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        expect(ignored).not.toContain('package-lock.json');
    });
});

describe('the split build steps still equal `npm run build:static`', () => {
    const EXPECTED = leaves('npm run build:static');

    it('build:static still resolves to a non-trivial command list', () => {
        // Guard-the-guard: if `leaves` ever returned [] or a marker, every
        // comparison below would pass vacuously.
        expect(EXPECTED.length).toBeGreaterThan(1);
        expect(EXPECTED.join(' ')).not.toMatch(/<missing-script:|<cycle:/);
    });

    it('the Dockerfile runs exactly those commands, in order', () => {
        const runs = buildStageRunCommands();
        // Drop the install step; everything after it is the build.
        const build = runs.filter((c) => !/^npm (ci|install)\b/.test(c)).flatMap((c) => leaves(c));
        expect(build).toEqual(EXPECTED);
    });

    it('the parity check discriminates — a dropped step fails it', () => {
        const runs = buildStageRunCommands()
            .filter((c) => !/^npm (ci|install)\b/.test(c))
            .slice(0, -1)
            .flatMap((c) => leaves(c));
        expect(runs).not.toEqual(EXPECTED);
    });

    it('the parity check discriminates — a reordered build fails it', () => {
        const reordered = [...EXPECTED].reverse();
        expect(reordered).not.toEqual(EXPECTED);
    });
});
