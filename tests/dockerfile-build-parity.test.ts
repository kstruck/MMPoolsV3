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
 *
 * ⚠️ The parsing below is deliberately more careful than it looks like it needs
 * to be. qodo's review of the first version was right: a guard that misreads a
 * `FROM --platform=… node:…`, an indented instruction or a backslash-continued
 * RUN either blocks legitimate Dockerfile edits or silently guarantees nothing.
 * A brittle guard is worse than no guard, because it is trusted.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const dockerfile = read('Dockerfile');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

// ─────────────────────────────────────────────────────────────────────────────
// Dockerfile parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logical instructions: comments and blank lines dropped, leading whitespace
 * tolerated, and backslash-continued lines joined into one instruction.
 */
export function dockerInstructions(source: string): string[] {
    const out: string[] = [];
    let pending: string | null = null;

    for (const raw of source.split(/\r?\n/)) {
        const line = raw.trim();
        if (pending === null && (line === '' || line.startsWith('#'))) continue;

        const continues = line.endsWith('\\');
        const body = continues ? line.slice(0, -1).trim() : line;

        if (pending === null) {
            pending = body;
        } else if (body !== '' && !body.startsWith('#')) {
            pending = `${pending} ${body}`;
        }

        if (!continues) {
            if (pending !== '') out.push(pending);
            pending = null;
        }
    }
    if (pending) out.push(pending);
    return out;
}

/**
 * The `RUN` commands of the NODE build stage only — the nginx stage has its own
 * (`chmod`), and counting it would make the parity comparison fail for no
 * reason. The stage is located by matching the `FROM` line itself, so
 * `FROM --platform=$BUILDPLATFORM node:20-alpine AS build` still resolves.
 */
export function buildStageRunCommands(source: string): string[] {
    const instructions = dockerInstructions(source);
    const isFrom = (i: string) => /^FROM\s/i.test(i);
    const isNodeStage = (i: string) => /^FROM\s+(?:--\S+\s+)*node:/i.test(i);

    const start = instructions.findIndex(isNodeStage);
    expect(start, 'Dockerfile should still have a node build stage').toBeGreaterThan(-1);

    const rest = instructions.slice(start + 1);
    const nextFrom = rest.findIndex(isFrom);
    const stage = nextFrom === -1 ? rest : rest.slice(0, nextFrom);

    return stage.filter((i) => /^RUN\s/i.test(i)).map((i) => i.replace(/^RUN\s+/i, '').trim());
}

/**
 * The SOURCE paths of every `COPY` in the node build stage — the arguments
 * before the destination, with flags like `--from=…` and `--chown=…` dropped.
 */
export function copiedSources(source: string): string[] {
    const instructions = dockerInstructions(source);
    const isFrom = (i: string) => /^FROM\s/i.test(i);
    const start = instructions.findIndex((i) => /^FROM\s+(?:--\S+\s+)*node:/i.test(i));
    const rest = instructions.slice(start + 1);
    const nextFrom = rest.findIndex(isFrom);
    const stage = nextFrom === -1 ? rest : rest.slice(0, nextFrom);

    return stage
        .filter((i) => /^COPY\s/i.test(i))
        .flatMap((i) => {
            const args = i
                .replace(/^COPY\s+/i, '')
                .split(/\s+/)
                .filter((a) => !a.startsWith('--'));
            return args.slice(0, -1); // last arg is the destination
        });
}

// ─────────────────────────────────────────────────────────────────────────────
// .dockerignore semantics
// ─────────────────────────────────────────────────────────────────────────────

/** Placeholders, so the star rewrites cannot re-match each other's output. */
const ANY_DEPTH = '\u0001';
const ANY = '\u0002';

/**
 * One `.dockerignore` pattern to a regex. Supports a double-star, `*` and `?`.
 *
 * A leading double-star followed by a slash is an OPTIONAL path prefix, not a
 * required one: Docker matches the name at any depth INCLUDING the context
 * root. Treating it as a mandatory directory prefix was this function's first
 * bug — the recursive pattern then failed to match a root-level
 * `package-lock.json`, which is precisely the case the guard-the-guard test
 * exists to catch, and it did.
 */
function patternToRegExp(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, ANY_DEPTH)
        .replace(/\*\*/g, ANY)
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .split(ANY_DEPTH)
        .join('(?:.*/)?')
        .split(ANY)
        .join('.*');
    return new RegExp(`^${escaped}$`);
}

/**
 * Would `.dockerignore` keep `target` OUT of the build context?
 *
 * Docker evaluates every pattern and the LAST match wins, with `!` negating.
 * A raw `lines.includes('package-lock.json')` check — the first version of this
 * test — misses `*.json`, `package*.json` and the recursive double-star form,
 * any of which would break `npm ci` in the image while the guard stayed green
 * (qodo). Those cases are enumerated as string literals in the tests below.
 */
export function dockerignoreExcludes(target: string, source: string): boolean {
    const patterns = source
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

    let excluded = false;
    for (const raw of patterns) {
        const negated = raw.startsWith('!');
        const pattern = (negated ? raw.slice(1) : raw).replace(/^\.\//, '').replace(/\/$/, '');
        if (patternToRegExp(pattern).test(target)) excluded = !negated;
    }
    return excluded;
}

// ─────────────────────────────────────────────────────────────────────────────
// npm script expansion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten a shell command into the leaf commands it actually runs, following
 * `npm run <script>` into package.json and splitting on `&&`.
 *
 * `npx foo` and `foo` collapse to the same leaf: `npx tsc -b` in the Dockerfile
 * and `tsc -b` in an npm script are the same program with the same arguments,
 * and the parity check is about WHAT runs, not how the binary is located.
 */
export function leaves(
    command: string,
    scripts: Record<string, string> = pkg.scripts,
    seen = new Set<string>(),
): string[] {
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
                const body = scripts[name];
                if (!body) return [`<missing-script:${name}>`];
                const next = new Set([...seen, name]);
                // npm LIFECYCLE HOOKS. `npm run build` also runs `prebuild` and
                // `postbuild` when they exist — CI gets them for free, and the
                // Dockerfile's direct `npx tsc -b` would silently skip them
                // (codex). Modelling them here means adding a hook makes the
                // parity test FAIL, which is the point: it forces the Dockerfile
                // to be updated instead of quietly diverging.
                //
                // Looked up by exact name, so `prerender` is NOT read as a hook
                // of a `render` script that does not exist — which is exactly
                // how npm resolves it too.
                return [
                    ...(scripts[`pre${name}`] ? leaves(scripts[`pre${name}`], scripts, next) : []),
                    ...leaves(body, scripts, next),
                    ...(scripts[`post${name}`] ? leaves(scripts[`post${name}`], scripts, next) : []),
                ];
            }
            return [part.replace(/^npx\s+/, '')];
        });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the image installs the tree CI validated', () => {
    it('uses `npm ci`, never `npm install`', () => {
        const runs = buildStageRunCommands(dockerfile);
        expect(runs.some((c) => /^npm ci\b/.test(c))).toBe(true);
        expect(runs.some((c) => /^npm install\b/.test(c))).toBe(false);
    });

    it('copies the lockfile in — `npm ci` fails without it', () => {
        // Match the COPY SOURCES as globs against the real filename, rather
        // than pattern-matching the instruction text. `/package\*?\.json/`
        // — the first version — also matches `COPY package.json ./`, which
        // would leave the build context without a lockfile and `npm ci` dead,
        // while the guard reported success (codex).
        expect(copiedSources(dockerfile).some((src) => patternToRegExp(src).test('package-lock.json')))
            .toBe(true);
    });

    it('the lockfile-COPY check discriminates — package.json alone fails it', () => {
        const narrowed = dockerfile.replace(/COPY package\*\.json/g, 'COPY package.json');
        expect(narrowed).not.toEqual(dockerfile);
        expect(copiedSources(narrowed).some((src) => patternToRegExp(src).test('package-lock.json')))
            .toBe(false);
    });

    it('.dockerignore does not exclude the lockfile', () => {
        const ignore = read('.dockerignore');
        expect(dockerignoreExcludes('package-lock.json', ignore)).toBe(false);
        expect(dockerignoreExcludes('package.json', ignore)).toBe(false);
    });

    it('the .dockerignore check understands globs and negation', () => {
        // Guard-the-guard. A raw-line check passes all three of these, which is
        // why the first version of this test guaranteed nothing.
        expect(dockerignoreExcludes('package-lock.json', '*.json')).toBe(true);
        expect(dockerignoreExcludes('package-lock.json', 'package*.json')).toBe(true);
        expect(dockerignoreExcludes('package-lock.json', '**/package-lock.json')).toBe(true);
        // A double-star prefix must match at the ROOT too, not only in a subdir.
        expect(dockerignoreExcludes('nested/package-lock.json', '**/package-lock.json')).toBe(true);
        // Last match wins, and `!` re-includes.
        expect(dockerignoreExcludes('package-lock.json', '*.json\n!package-lock.json')).toBe(false);
        // Order matters the other way too.
        expect(dockerignoreExcludes('package-lock.json', '!package-lock.json\n*.json')).toBe(true);
        // A comment must not be read as a pattern.
        expect(dockerignoreExcludes('package-lock.json', '# *.json')).toBe(false);
        // A single star must not cross a directory boundary.
        expect(dockerignoreExcludes('nested/package-lock.json', '*.json')).toBe(false);
    });
});

describe('the Dockerfile parser survives valid syntax it has not seen yet', () => {
    // Each case is a shape the FIRST version of this parser got wrong.
    it('handles --platform, AS aliases, indentation and line continuations', () => {
        const exotic = [
            '# a comment',
            'FROM --platform=$BUILDPLATFORM node:20-alpine AS build',
            '  WORKDIR /app',
            '  RUN npm ci \\',
            '      --legacy-peer-deps',
            '',
            '  RUN npx tsc -b',
            'FROM nginx:alpine',
            'RUN chmod -R 755 /usr/share/nginx/html',
        ].join('\n');
        expect(buildStageRunCommands(exotic)).toEqual(['npm ci --legacy-peer-deps', 'npx tsc -b']);
    });

    it('does not pick up RUN commands from the nginx stage', () => {
        expect(buildStageRunCommands(dockerfile).join(' ')).not.toMatch(/chmod/);
    });

    it('drops comments rather than treating them as instructions', () => {
        expect(dockerInstructions('# RUN rm -rf /\nRUN echo ok')).toEqual(['RUN echo ok']);
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
        const build = buildStageRunCommands(dockerfile)
            .filter((c) => !/^npm (ci|install)\b/.test(c))
            .flatMap((c) => leaves(c));
        expect(build).toEqual(EXPECTED);
    });

    it('the parity check discriminates — a dropped step fails it', () => {
        const runs = buildStageRunCommands(dockerfile)
            .filter((c) => !/^npm (ci|install)\b/.test(c))
            .slice(0, -1)
            .flatMap((c) => leaves(c));
        expect(runs).not.toEqual(EXPECTED);
    });

    it('the parity check discriminates — a reordered build fails it', () => {
        expect([...EXPECTED].reverse()).not.toEqual(EXPECTED);
    });

    it('an npm lifecycle hook would break parity rather than hide', () => {
        // codex: CI's `npm run build:static` runs `prebuild`/`postbuild` for
        // free; the Dockerfile's direct `npx tsc -b` would skip them. If the
        // expansion ignored hooks, that divergence would ship with a green
        // guard. Adding one must change the expected list.
        const withHook = {
            ...pkg.scripts,
            prebuild: 'node scripts/codegen.mjs',
        };
        const expanded = leaves('npm run build:static', withHook);
        expect(expanded).not.toEqual(EXPECTED);
        expect(expanded).toContain('node scripts/codegen.mjs');
        // …and it must land BEFORE the build it hooks, not merely somewhere.
        expect(expanded.indexOf('node scripts/codegen.mjs')).toBeLessThan(expanded.indexOf('tsc -b'));
    });

    it('a post hook is expanded too, and after the script', () => {
        const withHook = { ...pkg.scripts, postbuild: 'node scripts/after.mjs' };
        const expanded = leaves('npm run build:static', withHook);
        expect(expanded.indexOf('node scripts/after.mjs')).toBeGreaterThan(expanded.indexOf('vite build'));
    });

    it('`prerender` is NOT mistaken for a hook of a non-existent `render`', () => {
        // npm resolves hooks by exact name. There is no `render` script, so
        // `prerender` is a standalone script — as it is used here.
        expect(Object.keys(pkg.scripts)).toContain('prerender');
        expect(Object.keys(pkg.scripts)).not.toContain('render');
        expect(EXPECTED.filter((c) => c.includes('prerender')).length).toBe(1);
    });
});
