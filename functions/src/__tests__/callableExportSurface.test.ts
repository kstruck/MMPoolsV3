import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every callable AND every scheduled job defined in functions/src MUST be
 * re-exported from index.ts.
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
 * SCHEDULED JOBS HAVE THE SAME TRAP AND ARE WORSE. A callable at least fails
 * loudly the first time a button calls it. An unexported scheduled job has no
 * caller — it is simply never deployed, never runs, and nothing anywhere says
 * so. heartbeat.test.ts proves every onSchedule() is wrapped in withHeartbeat()
 * and that every wrapped job has a staleness expectation, but a job that was
 * never deployed emits no heartbeat at all, so it reads as `never-ran` rather
 * than "you forgot the export". This is the check that names the actual cause.
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

/**
 * Blank out comments so PROSE cannot invent a function. Both `onSchedule(` and
 * `onCall(` are named in doc comments in this repo (lib/heartbeat.ts and
 * revenueAggregates.ts for the former), and a commented-OUT declaration would
 * otherwise be demanded in index.ts — a guard failing on code that does not
 * exist. Replaced with spaces rather than removed so byte offsets stay exact.
 *
 * Same helper as heartbeat.test.ts, including the `(?<!:)` that keeps `https://`
 * from being read as a line comment. Duplicated rather than shared: two ~5-line
 * copies beat a test-helper module that both suites then have to import, and
 * each copy is verified by its own matched-a-plausible-minimum check below.
 */
function blankComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

// Matches the three ways this repo declares a callable.
const CALLABLE_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:validated|onCall|functions\.https\.onCall)\s*\(/g;

// The two ways it declares a scheduled job: the bare v2 import, and the
// namespaced `functions.scheduler.onSchedule`. Both are in live use.
const SCHEDULED_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:functions\.scheduler\.)?onSchedule\s*\(/g;

function definedAs(re: RegExp): Array<{ name: string; file: string }> {
  const found: Array<{ name: string; file: string }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = blankComments(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(re)) {
      found.push({ name: m[1], file: path.relative(SRC, file).replace(/\\/g, '/') });
    }
  }
  return found;
}

/**
 * The names index.ts actually RE-EXPORTS, parsed from its `export { ... } from
 * '...'` clauses.
 *
 * This used to be a raw `\bname\b` search over the whole file, and codex holed
 * it: a name that appears only in a COMMENT satisfied the search. index.ts:70
 * names `releaseStaleCouponReservations` in exactly that position, so deleting
 * its export while leaving the comment would have kept this test green while
 * the job stopped deploying — a guard vouched for by a comment ABOUT the code
 * it is checking, which is the same shape the whole file exists to stop.
 *
 * For `X as Y` the LOCAL name X is recorded: that is what the source-side scan
 * finds, and the function ships either way, under the alias.
 *
 * Only this one export form is parsed because it is the only one index.ts uses
 * (no `export *`, no `export const`). Any other form under-reports, which
 * surfaces as a FALSE orphan — loud and wrong, not quiet and wrong, which is
 * the safe direction for a guard to break in.
 */
function indexExports(): Set<string> {
  const text = blankComments(fs.readFileSync(INDEX, 'utf8'));
  const names = new Set<string>();
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const spec of m[1].split(',')) {
      const local = spec.trim().split(/\s+as\s+/)[0].trim();
      if (local) names.add(local);
    }
  }
  return names;
}

const exported = indexExports();

/** Names defined in the codebase that index.ts does not re-export. */
function orphansOf(defined: Array<{ name: string; file: string }>): string[] {
  return defined
    .filter(({ name }) => !exported.has(name))
    .map(({ name, file }) => `${name} (${file})`)
    .sort();
}

describe('callable export surface', () => {
  const defined = definedAs(CALLABLE_RE);

  it('finds the callables (guards against the regex silently matching nothing)', () => {
    // Without this, a refactor of how callables are declared would make the
    // real assertion below vacuously pass.
    expect(defined.length).toBeGreaterThan(100);
  });

  it('exports EVERY defined callable from index.ts', () => {
    expect(orphansOf(defined), [
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

describe('scheduled job export surface', () => {
  const defined = definedAs(SCHEDULED_RE);

  it('finds the scheduled jobs (guards against the regex silently matching nothing)', () => {
    // 23 as of 2026-07-25. Floored well below that so ordinary churn does not
    // trip it, but a regex that stops matching the declaration shape cannot
    // make the real assertion vacuous.
    expect(defined.length).toBeGreaterThanOrEqual(20);
  });

  it('every onSchedule() call is in the `export const` shape the scan looks for', () => {
    // SCHEDULED_RE is anchored on `export const X = ... onSchedule(`, so a job
    // written `const j = onSchedule(...)` — never exported at all — would be
    // invisible to the scan and pass by absence. That is the one direction this
    // guard can be wrong in QUIETLY, so the convention gets an assertion rather
    // than a comment: every onSchedule() call site must be one the scan sees.
    //
    // Counted over the same comment-blanked text, so prose (lib/heartbeat.ts,
    // revenueAggregates.ts) does not inflate it. `import { onSchedule } from`
    // has no paren after the identifier and is not counted.
    let callSites = 0;
    for (const file of sourceFiles(SRC)) {
      const text = blankComments(fs.readFileSync(file, 'utf8'));
      callSites += [...text.matchAll(/onSchedule\s*\(/g)].length;
    }
    expect(
      defined.length,
      `${callSites} onSchedule() call sites but only ${defined.length} match ` +
        '`export const X = onSchedule(`. A job declared some other way is not ' +
        'checked for its index.ts export. Use the standard shape, or widen ' +
        'SCHEDULED_RE to cover the new one.',
    ).toBe(callSites);
  });

  it('exports EVERY defined scheduled job from index.ts', () => {
    // NO EXEMPTIONS, and there is deliberately no allowlist to add one to.
    // Every scheduled job in the codebase is exported today, so a failure here
    // means a NEW job is missing its export — not that the guard needs a hole.
    // If this fails and the job looks exported, the scanner is wrong; fix the
    // scanner.
    expect(orphansOf(defined), [
      'These scheduled jobs are defined but never re-exported from index.ts.',
      'Firebase deploys only what index.ts exports, so each one is simply never',
      'deployed: no Cloud Scheduler trigger is created, the job never runs, and',
      'unlike a callable there is no caller to fail loudly and tell you. It just',
      'silently does nothing forever.',
      'Add it to index.ts, or delete it if it is genuinely dead.',
    ].join('\n')).toEqual([]);
  });
});
