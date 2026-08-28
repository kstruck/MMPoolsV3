import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * EVERY `package.json` IN THIS REPO MUST BE WATCHED BY DEPENDABOT.
 *
 * 🛑 WHY THIS EXISTS, MEASURED 2026-08-28.
 *
 * `.github/dependabot.yml` listed `directory: "/"` and nothing else. `directory`
 * is NOT recursive, so `functions/` — the code that actually runs in production —
 * had never been watched. The drift that had accumulated unseen:
 *
 *   functions/  firebase-admin ^12.7.0   (installed 12.7.0)
 *   root        firebase-admin ^13.6.1   (installed 13.10.0)
 *   functions/  typescript     ^5.0.0
 *   root        typescript     ~6.0.3
 *
 * A one-major gap in the SDK and a one-major gap in the compiler, and no PR had
 * ever been opened for either, because nothing was looking. The six open
 * dependabot PRs on that date were all root-only — including #304, which bumps
 * the ROOT `firebase-admin` to 14 and would have widened the split to two
 * majors while leaving production on 12.
 *
 * THIS IS THE REPO'S THIRD INSTANCE OF THE SAME SHAPE, which is why it is a
 * test and not a note:
 *
 *   1. CLAUDE.md §2b — a vulnerable `brace-expansion` in `functions/` that a
 *      root-only fix missed and CI's then root-scoped audit could never catch.
 *   2. CLAUDE.md §2e — `npx tsc -b` at the root does not typecheck `functions/`,
 *      so a type error there passed all five gates and would have failed the
 *      deploy.
 *   3. This one.
 *
 * Each time, root-scoped tooling was mistaken for repo-scoped tooling. A guard
 * over the SHAPE catches the fourth manifest somebody adds; a note does not.
 *
 * ⚠️ NOT AN AUDIT OF WHAT THE CONFIG SAYS. This asserts coverage — that a
 * manifest is watched at all. Schedule, grouping and PR limits are deliberately
 * left to the config, because pinning them here would fail on every legitimate
 * tuning change and an invariant that cries wolf gets deleted.
 */

const REPO_ROOT = resolve(__dirname, '..');
const CONFIG = resolve(REPO_ROOT, '.github/dependabot.yml');

/**
 * Every tracked `package.json`, DISCOVERED rather than listed.
 *
 * A hand-kept list is the same defect one layer up: it can only name the
 * manifests somebody remembered, which is exactly how `functions/` went unwatched.
 *
 * Depth is capped at one level below the root and `node_modules` / dot-dirs are
 * skipped — a manifest inside `node_modules` belongs to a dependency, not to us,
 * and `dist/` is build output.
 */
function trackedManifests(): string[] {
    const out: string[] = [];
    if (existsSync(join(REPO_ROOT, 'package.json'))) out.push('/');
    for (const e of readdirSync(REPO_ROOT, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        if (existsSync(join(REPO_ROOT, e.name, 'package.json'))) out.push(`/${e.name}`);
    }
    return out.sort();
}

/**
 * The `directory:` values the config declares.
 *
 * A line-level read rather than a YAML parse: `yaml` is not a dependency here,
 * and adding one to a guard makes the guard depend on the thing it guards.
 * `directory:` appears once per update entry and nowhere else in this file.
 */
function watchedDirectories(): string[] {
    const text = readFileSync(CONFIG, 'utf8');
    // Comments in this file MENTION directories by name, so only real keys count
    // — a line whose first non-space characters are `- ` or `directory:`.
    return [...text.matchAll(/^\s*(?:-\s+)?directory:\s*"?([^"\s#]+)"?/gm)].map((m) => m[1]).sort();
}

/**
 * `/shared` is a manifest with NO lockfile and NO `node_modules`, deliberately.
 *
 * It is not installed. `functions/scripts/copy-shared.mjs` copies the `.ts`
 * files into `functions/src/shared`, and `vite.config.ts` aliases `@shared` at
 * the root — so both consumers resolve `zod` from THEIR OWN tree, never from
 * here. Its `dependencies` block states the contract those consumers must
 * satisfy; it does not install anything.
 *
 * Pointing dependabot at it would open PRs against a range nothing resolves
 * from. So it is exempt — but NOT unguarded: the range is asserted to match
 * both consumers below, which catches the drift the exemption would otherwise
 * hide. That is the whole reason an exemption here is acceptable and a bare
 * omission was not.
 */
const WATCH_EXEMPT: Record<string, string> = {
    '/shared':
        'No lockfile and no node_modules — not installed. Both consumers resolve its deps from their own tree; ' +
        'its `dependencies` state a contract, which is asserted against them instead.',
};

describe('dependabot watches every package.json in the repo', () => {
    it('the config exists at all', () => {
        expect(existsSync(CONFIG), '.github/dependabot.yml is missing').toBe(true);
    });

    it('finds more than one manifest — the walker is live', () => {
        // A discovery guard that discovers nothing passes for the wrong reason.
        // This repo has at least the root and `functions/`.
        const found = trackedManifests();
        expect(found).toContain('/');
        expect(found).toContain('/functions');
    });

    it('🛑 no package.json is left unwatched', () => {
        const watched = new Set(watchedDirectories());
        const unwatched = trackedManifests().filter(
            (d) => !watched.has(d) && WATCH_EXEMPT[d] === undefined,
        );
        expect(
            unwatched,
            'these manifests have no `directory:` entry in .github/dependabot.yml, ' +
            'so nothing will ever open a PR for their dependencies — including security ones. ' +
            '`directory` is NOT recursive.',
        ).toEqual([]);
    });

    it('no watched directory points at a manifest that does not exist', () => {
        // The mirror of the rule above. A stale entry is not harmful, but it
        // makes the config read as covering something it does not, and a reader
        // counting entries would get the wrong answer.
        const tracked = new Set(trackedManifests());
        const phantom = watchedDirectories().filter((d) => !tracked.has(d));
        expect(phantom, 'these `directory:` entries name no package.json').toEqual([]);
    });

    it('the parser discriminates — it reads keys, not prose', () => {
        // A guard that matched the word "functions" anywhere in a comment would
        // have passed on the OLD config, whose comments talk about directories.
        // These are the exact shapes this file distinguishes.
        const parse = (s: string) =>
            [...s.matchAll(/^\s*(?:-\s+)?directory:\s*"?([^"\s#]+)"?/gm)].map((m) => m[1]);
        expect(parse('    directory: "/functions"\n')).toEqual(['/functions']);
        expect(parse('  - directory: "/"\n')).toEqual(['/']);
        expect(parse('    directory: /functions\n')).toEqual(['/functions']);
        // Prose is not a key.
        expect(parse('# the directory: /functions was never watched\n')).toEqual([]);
        expect(parse('# `functions/` held firebase-admin 12.7.0\n')).toEqual([]);
    });

    it('no exemption is stale', () => {
        // An exemption for a manifest that no longer exists is an exemption
        // nobody reviewed, and it would silently cover a future directory that
        // happened to reuse the name.
        const tracked = new Set(trackedManifests());
        const stale = Object.keys(WATCH_EXEMPT).filter((d) => !tracked.has(d));
        expect(stale).toEqual([]);
    });

    it('every exemption gives a reason, not a TODO', () => {
        const vague = Object.entries(WATCH_EXEMPT)
            .filter(([, reason]) => reason.trim().length < 40)
            .map(([d]) => d);
        expect(vague).toEqual([]);
    });
});

/**
 * The price of exempting `/shared`: its declared ranges must not drift from the
 * trees that actually install them.
 *
 * Without this, a dependabot bump of `zod` in the root and in `functions/` would
 * leave `shared/package.json` naming an older range, and the file that DOCUMENTS
 * the contract would be the only one stating it wrongly. Nothing would fail —
 * `shared` is never installed — so the drift would be invisible until somebody
 * read it and believed it.
 */
describe('the un-watched `shared` manifest still cannot drift', () => {
    const deps = (rel: string): Record<string, string> => {
        const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, rel), 'utf8'));
        return { ...(pkg.dependencies ?? {}) };
    };

    it('every dependency `shared` declares is declared identically by BOTH consumers', () => {
        const shared = deps('shared/package.json');
        expect(
            Object.keys(shared).length,
            'shared/package.json declares no dependencies — this guard has nothing to check',
        ).toBeGreaterThan(0);

        const root = deps('package.json');
        const fns = deps('functions/package.json');

        const drift: string[] = [];
        for (const [name, range] of Object.entries(shared)) {
            if (root[name] !== range) drift.push(`root ${name}: ${root[name] ?? '(absent)'} !== shared ${range}`);
            if (fns[name] !== range) drift.push(`functions ${name}: ${fns[name] ?? '(absent)'} !== shared ${range}`);
        }
        expect(
            drift,
            'shared/package.json states the contract its consumers must satisfy. It is not installed, ' +
            'so a mismatch fails nothing at runtime and would go unnoticed — update all three together.',
        ).toEqual([]);
    });
});
