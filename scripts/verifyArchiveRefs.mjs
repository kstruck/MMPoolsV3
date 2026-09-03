/**
 * Verify the docs/archive/ criterion (PR #653, 2026-09-01).
 *
 * Three invariants, all of which the docs cleanup must keep true:
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
 *   3. EVERY DELETION IS RECORDED in docs/archive/deleted-docs.txt. Invariant 2
 *      learns about deletions from the branch diff, which empties the moment
 *      the branch merges — so without a manifest entry a deletion is enforced
 *      today and silently unenforced tomorrow. The manifest is the only half
 *      that outlives the branch.
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

/**
 * Files skipped outright: lockfiles, which are enormous, generated, and cannot
 * meaningfully cite a document. Everything else is classified by CONTENT, not
 * by extension — an allowlist silently skips whatever it forgot (`nginx.conf`,
 * `Dockerfile`, `.env.e2e`), and a citation hiding in a skipped file is exactly
 * the miss this guard exists to catch.
 */
const SKIP_FILES = new Set(['package-lock.json', 'functions/package-lock.json']);

/** A file is binary if a NUL byte appears early in it. Cheap and reliable. */
function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

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
    git(['diff', '--no-renames', `${BASE}...HEAD`, '--diff-filter=D', '--name-only', '--', '*.md']),
  );
  const uncommitted = lines(
    git(['diff', '--no-renames', 'HEAD', '--diff-filter=D', '--name-only', '--', '*.md']),
  );
  // A doc that left the root and ARRIVED in docs/archive/ in this same change
  // was MOVED, not deleted — git reports the old path as a deletion either
  // way, so subtract those or every archived file reads as dangling.
  //
  // Keyed on "added under docs/archive/ by THIS diff", not on "some file with
  // that basename sits in the archive". The weaker test would silently exempt
  // a genuine future deletion whose basename happens to collide with
  // something archived long ago, and references to it would then pass.
  // Both halves, mirroring `committed` and `uncommitted` above. Without the
  // second, a run mid-move — the workflow the README documents — sees the
  // deleted root file but not its uncommitted arrival in the archive, and
  // calls a move a deletion.
  const movedIn = new Set(
    [
      ...lines(git([
        'diff', '--no-renames', `${BASE}...HEAD`, '--diff-filter=A', '--name-only', '--', `${ARCHIVE_DIR}/*.md`,
      ])),
      ...lines(git([
        'diff', '--no-renames', 'HEAD', '--diff-filter=A', '--name-only', '--', `${ARCHIVE_DIR}/*.md`,
      ])),
    ].map((f) => path.basename(f)),
  );

  // What matters is the FINAL state, not every intermediate commit. A doc
  // deleted in one commit and restored at the same path in a later one (an
  // amend, a revert, a change of mind mid-branch) is not deleted, and demanding
  // a manifest entry for a file that plainly still exists would block an
  // ordinary workflow.
  const fromDiff = [...committed, ...uncommitted]
    .filter((f) => !fs.existsSync(f))
    .map((f) => path.basename(f))
    .filter((name) => !movedIn.has(name));

  // INVARIANT 3 — every genuine deletion must be RECORDED in the manifest.
  // Without this the guard has an expiry date: a deletion is enforced today
  // because the branch diff carries it, and stops being enforced the moment
  // the branch merges and that diff empties. The manifest is the only half
  // that outlives the branch, so a deletion missing from it is a reference
  // check that silently switches itself off later.
  const recorded = new Set(manifestDocs().map((f) => path.basename(f)));
  const unrecorded = [...new Set(fromDiff)].filter((name) => !recorded.has(name));
  if (unrecorded.length > 0) {
    fail(
      `${unrecorded.length} deleted doc(s) are missing from ${DELETED_MANIFEST}.\n` +
      `      Without an entry there, nothing catches a reference to them once this\n` +
      `      branch merges and the diff that currently carries them goes empty.\n` +
      `      Add these lines:\n` +
      unrecorded.map((n) => `        ${n}`).join('\n'),
    );
  }

  // The manifest is APPEND-ONLY. Recording a deletion is worthless if the
  // record can be quietly dropped later: removing a line (or the whole file)
  // takes that document straight out of the checked set, and references to it
  // start passing again. Deletions are permanent, so their record is too.
  // At the MERGE BASE, not at BASE's tip — matching the three-dot diffs above.
  // Reading the tip would flag an entry another PR appended after this branch
  // was cut as "removed by this branch", which it plainly was not. That is the
  // two-dot-versus-three-dot trap CLAUDE.md §2c records, in a new costume.
  const wasRecorded = manifestDocsAt(mergeBase(BASE));
  const dropped = wasRecorded.filter((name) => !recorded.has(name));
  if (dropped.length > 0) {
    fail(
      `${dropped.length} entr(y/ies) were REMOVED from ${DELETED_MANIFEST}.\n` +
      `      That file is append-only: dropping a line stops anything from catching\n` +
      `      a reference to that deleted doc. Restore these lines:\n` +
      dropped.map((n) => `        ${n}`).join('\n'),
    );
  }

  return new Set([...fromDiff, ...recorded]);
}

/** Entries in a manifest's text: one filename per line, `#` comments ignored. */
function parseManifest(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

/** The tracked list of docs previous cleanups deleted, as it stands now. */
function manifestDocs() {
  if (!fs.existsSync(DELETED_MANIFEST)) return [];
  return parseManifest(fs.readFileSync(DELETED_MANIFEST, 'utf8'));
}

/**
 * Where `ref` and HEAD diverged — the point the three-dot diffs compare from.
 *
 * `merge-base` exits 1 with no output when the histories are genuinely
 * unrelated, which is a real state (a fixture repo, an orphan branch) and means
 * "compare against ref itself". Any OTHER failure is a broken repository, and
 * treating it the same would quietly change what this check compares.
 */
function mergeBase(ref) {
  try {
    return git(['merge-base', ref, 'HEAD']).trim();
  } catch (err) {
    const status = err?.status;
    const stderr = String(err?.stderr ?? '').trim();
    if (status === 1 && !stderr) return ref; // no common ancestor
    fail(
      `cannot resolve the merge base of '${ref}' and HEAD, so the append-only\n` +
      `      manifest check cannot run: ${stderr || err?.message || 'unknown git failure'}`,
    );
  }
}

/**
 * The same list as of `ref`. A manifest that simply did not exist at that ref
 * is the legitimate first-cleanup case and means "no entries". ANY OTHER git
 * failure is not: swallowing it would make an unreadable history look like an
 * empty one, and the append-only check would then pass by knowing nothing.
 */
function manifestDocsAt(ref) {
  try {
    return parseManifest(git(['show', `${ref}:${DELETED_MANIFEST}`])).map((f) => path.basename(f));
  } catch (err) {
    const stderr = String(err?.stderr ?? '');
    const absent = /does not exist|exists on disk, but not in|invalid object name/i.test(stderr);
    if (absent) return [];
    fail(
      `cannot read ${DELETED_MANIFEST} at '${ref}', so the append-only check on it\n` +
      `      cannot run: ${stderr.trim() || err?.message || 'unknown git failure'}`,
    );
  }
}

/**
 * Every tracked file, so a citation in code, config, or a skill cannot hide.
 * Binary content and lockfiles are dropped; nothing else is inferred from a
 * file's name. Cached — the scan reports these counts as well as using them.
 */
let trackedCache = null;
function trackedTextFiles() {
  if (trackedCache) return trackedCache;
  trackedCache = lines(git(['ls-files'])).filter((f) => {
    if (SKIP_FILES.has(f)) return false;
    if (!fs.existsSync(f)) return true; // skipped in the scan loop below
    try {
      return !isBinary(fs.readFileSync(f));
    } catch {
      return true; // let the scan loop's fail-closed handler report it
    }
  });
  return trackedCache;
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
  // The manifest is the registry OF those names, so it is the one file allowed
  // to contain them; scanning it would make the guard fail on its own record.
  if (file === DELETED_MANIFEST) continue;

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
