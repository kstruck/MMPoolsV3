import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every callable defined in functions/src MUST be re-exported from index.ts.
 *
 * WHY THIS EXISTS. `syncPlayInPicks` was defined as a hardened `validated()`
 * callable (SUPER_ADMIN + strict schema, swept in PR #188) but was never added
 * to index.ts. Firebase only deploys what the entry point exports, so:
 *   - it never existed in prod;
 *   - the SuperAdmin "Sync Play-In Picks" button
 *     (TournamentManager.tsx:410) called a function that isn't there and failed
 *     with functions/not-found;
 *   - and a `--only functions:syncPlayInPicks` deploy filter matches nothing,
 *     which can abort an otherwise-good multi-function deploy.
 *
 * None of that is visible from reading the callable's own file, and typecheck
 * cannot catch it — an unexported export is still valid TypeScript. So it gets
 * an assertion instead of vigilance.
 *
 * ponytail: source-text scan, not an import of index.ts. Importing index.ts
 * pulls in the whole function graph (Stripe, Admin SDK, secrets) for what is a
 * question about text.
 */

const SRC = path.resolve(__dirname, '..');
const INDEX = path.join(SRC, 'index.ts');

/** Recursively list .ts files under functions/src, skipping tests + generated. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'shared' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

// Matches the three ways this repo declares a callable.
const CALLABLE_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:validated|onCall|functions\.https\.onCall)\s*\(/g;

function definedCallables(): Array<{ name: string; file: string }> {
  const found: Array<{ name: string; file: string }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALLABLE_RE)) {
      found.push({ name: m[1], file: path.relative(SRC, file).replace(/\\/g, '/') });
    }
  }
  return found;
}

describe('callable export surface', () => {
  const defined = definedCallables();
  const indexText = fs.readFileSync(INDEX, 'utf8');

  it('finds the callables (guards against the regex silently matching nothing)', () => {
    // Without this, a refactor of how callables are declared would make the
    // real assertion below vacuously pass.
    expect(defined.length).toBeGreaterThan(100);
  });

  it('exports EVERY defined callable from index.ts', () => {
    const orphans = defined
      .filter(({ name }) => !new RegExp(`\\b${name}\\b`).test(indexText))
      .map(({ name, file }) => `${name} (${file})`);

    expect(orphans, [
      'These callables are defined but never re-exported from index.ts.',
      'Firebase deploys only what index.ts exports, so each one:',
      '  - does not exist in prod, and any caller gets functions/not-found;',
      '  - makes a `--only functions:<name>` filter match nothing, which can',
      '    abort an otherwise-good multi-function deploy.',
      'Add it to index.ts, or delete it if it is genuinely dead.',
    ].join('\n')).toEqual([]);
  });

  // Deliberately NOT tested here: the mirror case of index.ts naming something
  // that no longer exists. That one already fails loudly at `tsc` — an export
  // of a missing binding is a compile error — so it needs no assertion. The
  // orphan case above is the one the compiler cannot see.
});
