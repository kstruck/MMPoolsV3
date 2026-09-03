/**
 * Verify the docs/archive/ criterion (PR #653, 2026-09-01).
 *
 * Two invariants, both of which the docs cleanup must keep true:
 *
 *   1. LINKS RESOLVE. No kept markdown doc names an ARCHIVED file by a path
 *      that does not land in `docs/archive/` — otherwise an operator following
 *      a cited runbook opens a missing file. Checked against markdown only,
 *      because this is a statement about link resolution.
 *
 *   2. NOTHING CITES A DELETED DOC. A doc is only safe to delete because no
 *      file references it. Checked across EVERY tracked text file — code,
 *      tests, skills, workflows, docs — and matched with OR WITHOUT the `.md`
 *      suffix, because the citation this repo actually missed was
 *      `NOTES-WAVE2` (no suffix) in ~10 `functions/src/` comments.
 *
 * Run from the repo root:
 *   node scripts/verifyArchiveRefs.mjs [--base <ref>]
 *
 * FAILS CLOSED. If the base ref is unreadable or the argument is malformed the
 * script exits non-zero rather than reporting success — a guard that cannot
 * check its own invariant must never look like a guard that passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARCHIVE_DIR = 'docs/archive';
const DELETED_MANIFEST = 'docs/archive/deleted-docs.txt';

/** Extensions worth scanning for a citation. Anything else is binary or generated. */
const TEXT_EXT = new Set([
  '.md', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.yml', '.yaml', '.rules', '.txt', '.html', '.css', '.sh', '.py',
]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// --- arguments -------------------------------------------------------------

const USAGE = 'usage: node scripts/verifyArchiveRefs.mjs [--base <ref>]';

/**
 * Parse argv strictly. Anything unrecognized — a mistyped flag, a stray
 * positional, `--base=<ref>` — exits non-zero rather than falling back to the
 * default, because a silent fallback would compare the wrong base and then
 * print OK. That is the failure mode this whole script exists to prevent.
 */
function parseBase(argv) {
  const args = argv.slice(2);
  let base = 'origin/main';
  let seen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--base') {
      fail(`unrecognized argument '${arg}'.\n      ${USAGE}`);
    }
    if (seen) fail(`--base given more than once.\n      ${USAGE}`);
    const value = args[i + 1];
    if (!value || value.startsWith('-')) {
      fail(`--base requires a ref, e.g. --base origin/main.\n      ${USAGE}`);
    }
    base = value;
    seen = true;
    i++; // consume the value
  }
  return base;
}

const BASE = parseBase(process.argv);

// --- inputs ----------------------------------------------------------------

const archived = new Set(
  fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md'),
);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function lines(out) {
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Docs deleted relative to BASE, including deletions that are only staged or
 * only in the working tree — the README tells contributors to run this after a
 * move, which is exactly when the deletion is not committed yet.
 *
 * UNIONED WITH A TRACKED MANIFEST, and that half is the durable one. A diff
 * against BASE is empty once the cleanup merges, which would leave invariant 2
 * a permanent no-op on main: re-adding a reference to a long-deleted doc would
 * pass with `references to deleted docs: 0`. DELETED_MANIFEST outlives the
 * branch, so the guard keeps working after the diff stops carrying it.
 */
function deletedDocs() {
  try {
    git(['rev-parse', '--verify', `${BASE}^{commit}`]);
  } catch {
    fail(
      `cannot read base ref '${BASE}', so the deleted-reference invariant cannot be checked.\n` +
      `      Run 'git fetch origin', or pass --base <ref> naming a ref that exists.`,
    );
  }
  const committed = lines(
    git(['diff', `${BASE}...HEAD`, '--diff-filter=D', '--name-only', '--', '*.md']),
  );
  const uncommitted = lines(
    git(['diff', 'HEAD', '--diff-filter=D', '--name-only', '--', '*.md']),
  );
  // A doc that left the root but now lives in docs/archive/ was MOVED, not
  // deleted — git reports the old path as a deletion either way, so subtract
  // the archive or every archived file would be reported as dangling.
  return new Set(
    [...committed, ...uncommitted, ...manifestDocs()]
      .map((f) => path.basename(f))
      .filter((name) => !archived.has(name)),
  );
}

/** The tracked list of docs previous cleanups deleted. */
function manifestDocs() {
  if (!fs.existsSync(DELETED_MANIFEST)) return [];
  return fs
    .readFileSync(DELETED_MANIFEST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

/** Every tracked text file, so a citation in code or a skill cannot hide. */
function trackedTextFiles() {
  return lines(git(['ls-files'])).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

// --- checks ----------------------------------------------------------------

const deleted = deletedDocs();
const deletedStems = new Map(); // stem -> original filename
for (const name of deleted) deletedStems.set(name.replace(/\.md$/, ''), name);

/**
 * Markdown LINK targets only — `](path/to/doc.md)`. Invariant 1 is about link
 * resolution, so a prose mention of a repo-root-relative path (common in the
 * skills, which describe paths rather than link to them) is not a subject of it.
 */
const MD_LINK =
  /\]\(\s*<?((?:[A-Za-z0-9_.-]+\/)*)([A-Za-z0-9_][A-Za-z0-9_.-]*\.md)>?\s*(?:[)#?]|"|')/g;

let unresolved = 0;
let dangling = 0;

for (const file of trackedTextFiles()) {
  // A file git still tracks but that is gone from the working tree — the normal
  // state mid-move, which is exactly when the README says to run this — has no
  // content to check. That is not the same as a file we failed to read.
  if (!fs.existsSync(file)) continue;

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // FAILS CLOSED: a tracked file that exists but cannot be read is a file
    // whose citations we cannot check, which is not the same as one with none.
    fail(`cannot read tracked file '${file}': ${err.message}`);
  }
  const isMarkdown = path.extname(file).toLowerCase() === '.md';

  // Invariant 1 — an archived doc must be cited by a path that resolves to it.
  // Archived docs are checked too: they link to root plans with ../../ paths,
  // and a regression there is exactly as broken as one in a root doc.
  if (isMarkdown) {
    for (const m of text.matchAll(MD_LINK)) {
      const [, dir, name] = m;
      if (!archived.has(name)) continue;
      // Resolve the citation the way a reader's browser would, then require it
      // to land on the real file. A bare name or a wrong directory both fail.
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.replace(/\\/g, '/')), dir, name),
      );
      if (resolved !== `${ARCHIVE_DIR}/${name}`) {
        console.log(`UNRESOLVED  ${file} -> ${dir}${name}  (resolves to ${resolved})`);
        unresolved++;
      }
    }
  }

  // Invariant 2 — a deleted doc may not be named anywhere, suffix or not.
  for (const [stem, original] of deletedStems) {
    // Word-boundary match so `NOTES-WAVE2` is caught but `NOTES-WAVE20` is not.
    const re = new RegExp(`(?<![A-Za-z0-9_-])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);
    if (re.test(text)) {
      console.log(`DANGLING    ${file} -> ${original}`);
      dangling++;
    }
  }
}

// --- report ----------------------------------------------------------------

console.log(`\nbase ref:                          ${BASE}`);
console.log(`archived docs:                     ${archived.size}`);
console.log(`deleted docs:                      ${deleted.size}`);
console.log(`markdown files scanned for links:  ${trackedTextFiles().filter((f) => f.endsWith('.md')).length}`);
console.log(`tracked text files scanned:        ${trackedTextFiles().length}`);
console.log(`citations that do not resolve:     ${unresolved}`);
console.log(`references to deleted docs:        ${dangling}`);

if (unresolved || dangling) process.exit(1);
console.log('\nOK — archive citation graph is closed.');
