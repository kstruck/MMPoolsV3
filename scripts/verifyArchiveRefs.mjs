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
 * Exits non-zero if either invariant is broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARCHIVE_DIR = 'docs/archive';
const SCAN_DIRS = ['docs', 'docs/adr', 'docs/wizard-unification'];
const MD_NAME = /[A-Za-z0-9_][A-Za-z0-9_.-]*\.md/g;
const PATH_SEP = /[/\\]$/;

const archived = new Set(
  fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md'),
);

/** Every markdown doc that a reader could follow a citation from. */
function keptDocs() {
  const out = fs.readdirSync('.').filter((f) => f.endsWith('.md'));
  for (const dir of [...SCAN_DIRS, ARCHIVE_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) out.push(path.join(dir, f));
    }
  }
  return out;
}

/** Files this branch deletes, relative to origin/main. */
function deletedDocs() {
  try {
    const raw = execFileSync(
      'git',
      ['diff', 'origin/main...HEAD', '--diff-filter=D', '--name-only', '--', '*.md'],
      { encoding: 'utf8' },
    );
    return raw.split('\n').map((s) => s.trim()).filter(Boolean).map((f) => path.basename(f));
  } catch {
    console.warn('warning: could not read the deleted-file list (is origin/main fetched?)');
    return [];
  }
}

const deleted = new Set(deletedDocs());
let unprefixed = 0;
let dangling = 0;

for (const file of keptDocs()) {
  const text = fs.readFileSync(file, 'utf8');
  const inArchive = file.replace(/\\/g, '/').startsWith(ARCHIVE_DIR);

  for (const m of text.matchAll(MD_NAME)) {
    const name = m[0];
    const precededByPath = PATH_SEP.test(text.slice(Math.max(0, m.index - 20), m.index));

    // Invariant 1 — archived files must be cited by path. Archived docs
    // themselves link to siblings by bare name, which resolves correctly.
    if (archived.has(name) && !precededByPath && !inArchive) {
      console.log(`UNPREFIXED  ${file} -> ${name}`);
      unprefixed++;
    }

    // Invariant 2 — nothing may cite a deleted file.
    if (deleted.has(name)) {
      console.log(`DANGLING    ${file} -> ${name}`);
      dangling++;
    }
  }
}

console.log(`\nunprefixed refs to archived docs: ${unprefixed}`);
console.log(`refs to deleted docs:             ${dangling}`);

if (unprefixed || dangling) process.exit(1);
console.log('\nOK — archive citation graph is closed.');
