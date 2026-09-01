/**
 * Verify the docs/archive/ criterion (PR #653, 2026-09-01).
 *
 * Two invariants, both of which the docs cleanup must keep true:
 *
 *   1. No kept doc names an ARCHIVED file without its `docs/archive/` prefix —
 *      otherwise an operator following a cited runbook lands on a missing file.
 *   2. No kept doc — including the archived ones — names a DELETED file at all;
 *      a deleted doc is only safe to delete because nothing cites it.
 *
 * Run from the repo root:  node scripts/verifyArchiveRefs.mjs
 * Compare against a different base with:  --base <ref>   (default origin/main)
 *
 * FAILS CLOSED. If the base ref cannot be read, invariant 2 is unverifiable and
 * the script exits non-zero rather than reporting success — a guard that cannot
 * check its own invariant must not look like a guard that passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARCHIVE_DIR = 'docs/archive';
const MD_NAME = /[A-Za-z0-9_][A-Za-z0-9_.-]*\.md/g;
const PATH_SEP = /[/\\]$/;

/** Directories that are never part of the citation graph. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out',
  'playwright-report', 'test-results', '.firebase', '.claude',
]);

const baseArg = process.argv.indexOf('--base');
const BASE = baseArg !== -1 ? process.argv[baseArg + 1] : 'origin/main';

const archived = new Set(
  fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md'),
);

/** Every markdown doc a reader could follow a citation from, at any depth. */
function keptDocs(dir = '.', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      keptDocs(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Files the working tree deletes relative to BASE.
 * Throws rather than returning empty — see FAILS CLOSED above.
 */
function deletedDocs() {
  execFileSync('git', ['rev-parse', '--verify', `${BASE}^{commit}`], { stdio: 'pipe' });
  const raw = execFileSync(
    'git',
    ['diff', `${BASE}...HEAD`, '--diff-filter=D', '--name-only', '--', '*.md'],
    { encoding: 'utf8' },
  );
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).map((f) => path.basename(f));
}

let deleted;
try {
  deleted = new Set(deletedDocs());
} catch {
  console.error(
    `FAIL: cannot read base ref '${BASE}', so the deleted-reference invariant ` +
    `cannot be checked.\n` +
    `      Run 'git fetch origin', or pass --base <ref> naming a ref that exists.`,
  );
  process.exit(1);
}

let unprefixed = 0;
let dangling = 0;

for (const file of keptDocs()) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const inArchive = rel.startsWith(ARCHIVE_DIR);

  for (const m of text.matchAll(MD_NAME)) {
    const name = m[0];
    const precededByPath = PATH_SEP.test(text.slice(Math.max(0, m.index - 20), m.index));

    // Invariant 1 — archived files must be cited by path. Archived docs
    // themselves link to siblings by bare name, which resolves correctly.
    if (archived.has(name) && !precededByPath && !inArchive) {
      console.log(`UNPREFIXED  ${rel} -> ${name}`);
      unprefixed++;
    }

    // Invariant 2 — nothing may cite a deleted file.
    if (deleted.has(name)) {
      console.log(`DANGLING    ${rel} -> ${name}`);
      dangling++;
    }
  }
}

console.log(`\nbase ref:                         ${BASE}`);
console.log(`unprefixed refs to archived docs: ${unprefixed}`);
console.log(`refs to deleted docs:             ${dangling}`);

if (unprefixed || dangling) process.exit(1);
console.log('\nOK — archive citation graph is closed.');
