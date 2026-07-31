import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * Deploy-bundle invariants for Cloud Functions.
 *
 * `firebase deploy --only functions` zips the whole `functions/` directory minus
 * `firebase.json`'s `functions.ignore`, and `firebase.json`'s predeploy hook runs
 * `npm --prefix functions run build` (tsc) first. So both the TypeScript sources
 * and everything tsc emits into `lib/` reach production.
 *
 * Before 2026-07-31 that included every test: `functions/tsconfig.json` had
 * `include: ["src"]` with a single file excluded, so all 113 `src/__tests__/**`
 * suites compiled into `lib/__tests__/`. Measured with firebase-tools' own
 * `readdirRecursive` and the real ignore list: 331 of 898 uploaded files and
 * 2.47 of 6.83 MiB were tests, with no runtime purpose.
 *
 * Two mechanisms keep them out now, and they cover different holes — neither is
 * redundant:
 *
 *  1. `functions/tsconfig.json` excludes `src/__tests__`, so tsc never emits
 *     `lib/__tests__` in the first place.
 *  2. `firebase.json`'s ignore list drops any `__tests__` directory, which also
 *     covers the `.ts` sources (never compiled, still uploaded) and a stale
 *     `lib/__tests__` left on a developer's machine from before the change.
 *
 * The cost of (1) would be losing type coverage on the tests, since `npm run
 * typecheck` was the only thing checking them. `functions/tsconfig.test.json`
 * exists to carry that: it is the build config plus `src/__tests__`, and the
 * typecheck script points at it. If someone "simplifies" that script back to a
 * bare `tsc --noEmit`, type errors in 112 test files stop being caught and
 * nothing else notices — hence the assertion below.
 *
 * Re-measure the upload set with:
 *   node -e "const f=require('firebase-tools/lib/fsAsync');const c=require('./firebase.json').functions[0];f.readdirRecursive({path:'functions',ignoreStrings:c.ignore}).then(r=>console.log(r.length,r.filter(x=>x.name.includes('__tests__')).length))"
 */

const root = resolve(__dirname, '..');

/** tsconfig files are JSONC (comments allowed), so JSON.parse is not enough. */
function readJsonc(relPath: string): Record<string, unknown> {
  const text = readFileSync(resolve(root, relPath), 'utf8');
  const parsed = ts.parseConfigFileTextToJson(relPath, text);
  expect(parsed.error, `${relPath} failed to parse`).toBeUndefined();
  return parsed.config as Record<string, unknown>;
}

const readJson = (relPath: string) =>
  JSON.parse(readFileSync(resolve(root, relPath), 'utf8'));

describe('Cloud Functions deploy bundle', () => {
  it('firebase.json ignores every __tests__ directory in the upload', () => {
    const firebaseJson = readJson('firebase.json');
    const codebases = Array.isArray(firebaseJson.functions)
      ? firebaseJson.functions
      : [firebaseJson.functions];

    for (const codebase of codebases) {
      // firebase-tools matches these with minimatch `{ matchBase: true }`, so a
      // slash-free pattern matches the basename at any depth — one `__tests__`
      // entry prunes both `src/__tests__` and a stale `lib/__tests__`.
      expect(codebase.ignore, `codebase ${codebase.codebase}`).toContain('__tests__');
      expect(codebase.ignore).toContain('node_modules');
    }
  });

  it('the deploy build config emits no test output into lib/', () => {
    const build = readJsonc('functions/tsconfig.json');
    expect(build.exclude).toContain('src/__tests__');
    // Pins lib/ to mirror src/. Without it a single cross-boundary import moves
    // the emitted index.js and breaks `main` on the deployed function.
    expect((build.compilerOptions as Record<string, unknown>).rootDir).toBe('src');
  });

  it('typecheck still covers the tests the build config drops', () => {
    const script = readJson('functions/package.json').scripts.typecheck as string;
    expect(script).toContain('tsconfig.test.json');

    const testCfg = readJsonc('functions/tsconfig.test.json');
    expect(testCfg.extends).toBe('./tsconfig.json');
    expect(testCfg.include).toContain('src');
    // The whole point: this config must NOT inherit the build's test exclusion.
    // `exclude` replaces rather than merges, so it has to be restated here, and
    // it may only drop fixtureMatrix — which imports the repo-root scenario
    // runner from outside functions/ and is compiled by vitest, never by tsc.
    expect(testCfg.exclude).toEqual([
      'src/__tests__/emulator/fixtureMatrix.emulator.test.ts',
    ]);
  });
});
