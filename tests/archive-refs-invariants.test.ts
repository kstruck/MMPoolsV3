/**
 * Runs scripts/verifyArchiveRefs.mjs as part of the suite.
 *
 * WHY A TEST AND NOT A README LINE. The verifier was added by PR #653 to prove
 * the docs-cleanup criterion: no markdown link to an archived doc that fails to
 * resolve, no reference anywhere to a deleted one, and every deletion recorded
 * in docs/archive/deleted-docs.txt. Documented-only, it protects nothing — a
 * later PR can break an archive link or re-cite a deleted doc and pass every
 * required check. `build-and-test` is a required check, so putting it here is
 * what makes the guard enforced rather than advisory.
 *
 * BASE REF. The verifier compares against `origin/main` and FAILS CLOSED when
 * that ref is unreadable, so this test does too: it requires a real base rather
 * than falling back to HEAD. A HEAD base makes the diff empty, which would
 * quietly switch off invariant 3 — a deletion missing from the manifest would
 * pass while the test still reported success, which is the precise failure this
 * guard exists to prevent.
 *
 * That is safe here rather than brittle: `build-and-test` checks out with
 * `fetch-depth: 0`, which fetches every branch, and the same job already runs
 * `docs-state-invariants.test.ts`, which resolves SHAs against `origin/main`
 * and (per the workflow's own comment) "fails loudly rather than skipping".
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * These tests spawn git and node subprocesses — several per case, and the
 * fixtures run `git init` plus commits. That is comfortably past vitest's 5s
 * default on a cold or loaded Windows runner, where it showed up as flaky
 * timeouts rather than real failures.
 */
const TEST_TIMEOUT = 60_000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join('scripts', 'verifyArchiveRefs.mjs');

function refExists(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const BASE_CANDIDATES = ['origin/main', 'main'] as const;

/**
 * A real base to diff against. Deliberately NOT falling back to HEAD — see the
 * BASE REF note above; an empty diff disables invariant 3 silently.
 */
function resolveBase(): string | null {
  return BASE_CANDIDATES.find(refExists) ?? null;
}

function runVerifier(base: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--base', base], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * A throwaway git repo containing only what the verifier reads: the script, an
 * archive dir, a manifest, and whatever docs the scenario needs. Hermetic, so
 * the invariant-3 FAILURE paths can be exercised without touching this repo's
 * real history — and so removing invariant 3 from the script makes these tests
 * go red, which the happy-path test alone does not.
 */
function fixture(build: (dir: string, run: (...args: string[]) => void) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-refs-'));
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  try {
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'test');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs', 'archive'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, SCRIPT), path.join(dir, SCRIPT));
    build(dir, run);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runIn(dir: string, base: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--base', base], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const MANIFEST = path.join('docs', 'archive', 'deleted-docs.txt');

describe('invariant 3 — deletions must be recorded, and stay recorded', () => {
  it('fails when a deleted doc is missing from the manifest', () => {
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'DOOMED.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'DOOMED.md'));
      run('add', '-A');
      run('commit', '-qm', 'delete it, without recording it');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('missing from');
      expect(output).toContain('DOOMED.md');
    });
  }, TEST_TIMEOUT);

  it('passes once that deletion is recorded', () => {
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'DOOMED.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'DOOMED.md'));
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\nDOOMED.md\n');
      run('add', '-A');
      run('commit', '-qm', 'delete it and record it');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
    });
  }, TEST_TIMEOUT);

  it('sees a RENAMED-away doc as a deletion', () => {
    // git reports `git mv a.md b.md` as R, not D, so a rename would slip past
    // the deletion diff entirely and leave references to the old name dangling
    // while everything reported green. The diffs pass --no-renames for this.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'OLD-NAME.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      run('mv', 'OLD-NAME.md', 'NEW-NAME.md');
      run('commit', '-qm', 'rename it');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('OLD-NAME.md');
    });
  }, TEST_TIMEOUT);

  it('still treats a move INTO the archive as a move, not a deletion', () => {
    // The mirror of the case above: --no-renames makes `git mv x docs/archive/x`
    // read as a delete plus an add, so the add side must be seen too or every
    // archived doc would be reported as deleted.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'MOVED.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      run('mv', 'MOVED.md', path.join('docs', 'archive', 'MOVED.md'));
      run('commit', '-qm', 'archive it');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
    });
  }, TEST_TIMEOUT);

  it('treats a move into ANY docs/ folder as a move, not a deletion', () => {
    // Since the 2026-09-09 root declutter, live docs sit in docs/plans/,
    // docs/runbooks/, docs/backlog/ and docs/decisions/, not only the archive.
    // A `git mv PLAN-X.md docs/plans/PLAN-X.md` must not demand a manifest entry
    // and must not flag every existing citation of PLAN-X as dangling.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'PLAN-X.md'), 'content\n');
      fs.writeFileSync(path.join(dir, 'CITES.md'), 'see PLAN-X for the plan\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
      run('mv', 'PLAN-X.md', path.join('docs', 'plans', 'PLAN-X.md'));
      run('commit', '-qm', 'file it under docs/plans');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
      expect(output).not.toContain('DANGLING');
    });
  }, TEST_TIMEOUT);

  it('does NOT let an unrelated namesake under docs/ exempt a real deletion', () => {
    // The move exemption pairs on CONTENT (git rename detection), not on
    // basename. Otherwise deleting a root doc for real and adding some other
    // file with the same name anywhere under docs/ in the same change would
    // skip both the manifest requirement and the dangling-reference check
    // (qodo on #681). The namesake here shares nothing with the original, so
    // git sees a delete plus an add, and the guard must fail naming the file.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'DOOMED.md'), 'the original plan, paragraph after paragraph\n'.repeat(20));
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'DOOMED.md'));
      fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs', 'plans', 'DOOMED.md'), 'a completely different document\n');
      run('add', '-A');
      run('commit', '-qm', 'delete one, add a namesake');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('DOOMED.md');
      expect(output).toContain('missing from');
    });
  }, TEST_TIMEOUT);

  it('treats a move into docs/ that CHANGES the basename as a deletion of the old name', () => {
    // Citations use the bare filename, so OLD-NAME.md → docs/plans/NEW-NAME.md
    // deletes the identity every citation of OLD-NAME relies on, even though
    // git pairs the contents as a rename. The old name must stay under
    // enforcement: manifest entry required, and the surviving citation flagged
    // (qodo on #681, the mirror of the root-level rename fixture above).
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'OLD-NAME.md'), 'the plan, paragraph after paragraph\n'.repeat(20));
      fs.writeFileSync(path.join(dir, 'CITES.md'), 'see OLD-NAME for the plan\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
      run('mv', 'OLD-NAME.md', path.join('docs', 'plans', 'NEW-NAME.md'));
      run('commit', '-qm', 'move and rename');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('OLD-NAME.md');
    });
  }, TEST_TIMEOUT);

  it('ignores a markdown deletion OUTSIDE the root and docs/ — vendored files are not project docs', () => {
    // Deletion tracking is scoped to the root and docs/**. Removing a vendored
    // skill pack's SKILL.md must not demand a manifest entry, and must not turn
    // the word "SKILL" into a dangling reference everywhere it survives
    // (the 2026-09-09 skills/ removal, 180+ such files).
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.mkdirSync(path.join(dir, 'skills', 'skill-x'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'skills', 'skill-x', 'SKILL.md'), 'vendored\n');
      fs.writeFileSync(path.join(dir, 'KEPT.md'), 'this repo has a SKILL.md convention elsewhere\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      run('rm', '-r', '-q', 'skills');
      run('commit', '-qm', 'drop the vendored pack');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
      expect(output).not.toContain('DANGLING');
    });
  }, TEST_TIMEOUT);

  it('still tracks a deletion under public/ — the hosted auth.md is a project doc', () => {
    // Firebase Hosting serves public/auth.md at /auth.md (firebase.json). The
    // scope that excludes vendored packs must not exclude it (qodo on #683).
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'public', 'auth.md'), 'agent policy\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'public', 'auth.md'));
      run('add', '-A');
      run('commit', '-qm', 'delete the hosted doc without recording it');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('auth.md');
      expect(output).toContain('missing from');
    });
  }, TEST_TIMEOUT);

  it('does not treat a delete-then-restore as a deletion', () => {
    // Only the FINAL state matters. A doc removed in one commit and put back at
    // the same path in a later one still exists, and demanding a manifest entry
    // for a file plainly sitting in the tree would block an ordinary amend or
    // revert mid-branch.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      fs.writeFileSync(path.join(dir, 'KEPT.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'KEPT.md'));
      run('add', '-A');
      run('commit', '-qm', 'delete it');

      // Restored in the WORKING TREE and not committed — this is the case that
      // matters. HEAD still records the deletion, so the base..HEAD diff names
      // it, while the file plainly sits in the tree. Committing the restore
      // instead would make the net diff clean and exercise nothing.
      fs.writeFileSync(path.join(dir, 'KEPT.md'), 'content, revised\n');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
    });
  }, TEST_TIMEOUT);

  it('accepts a manifest that did not exist at the base ref — the first cleanup', () => {
    // The legitimate absent case. It must stay distinguishable from a git
    // failure, which fails closed rather than reading as "no entries".
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, 'DOOMED.md'), 'content\n');
      run('add', '-A');
      run('commit', '-qm', 'base with no manifest at all');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.rmSync(path.join(dir, 'DOOMED.md'));
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\nDOOMED.md\n');
      run('add', '-A');
      run('commit', '-qm', 'first cleanup: delete and start the manifest');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(0);
    });
  }, TEST_TIMEOUT);

  it('does not blame a branch for an entry appended to the base after it was cut', () => {
    // The append-only check must read the manifest at the MERGE BASE, not at
    // the base branch's tip. A stale branch that never touched the manifest
    // would otherwise be told it removed an entry another PR had added.
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\nORIGINAL.md\n');
      run('add', '-A');
      run('commit', '-qm', 'base');
      run('branch', 'mainline');

      // A later commit on mainline appends an entry this branch never sees.
      run('checkout', '-q', 'mainline');
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\nORIGINAL.md\nLATER.md\n');
      run('add', '-A');
      run('commit', '-qm', 'another PR appends an entry');

      // Our branch, cut before that, changes something unrelated.
      run('checkout', '-q', '-');
      fs.writeFileSync(path.join(dir, 'UNRELATED.md'), 'x\n');
      run('add', '-A');
      run('commit', '-qm', 'unrelated work');

      const { status, output } = runIn(dir, 'mainline');
      expect(status, output).toBe(0);
    });
  }, TEST_TIMEOUT);

  it('fails when an existing manifest entry is removed — the record is append-only', () => {
    fixture((dir, run) => {
      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\nOLD-DELETION.md\n');
      run('add', '-A');
      run('commit', '-qm', 'base with a recorded deletion');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      fs.writeFileSync(path.join(dir, MANIFEST), '# deleted docs\n');
      run('add', '-A');
      run('commit', '-qm', 'quietly drop the record');

      const { status, output } = runIn(dir, base);
      expect(status, output).toBe(1);
      expect(output).toContain('REMOVED from');
      expect(output).toContain('OLD-DELETION.md');
    });
  }, TEST_TIMEOUT);
});

describe('docs/archive citation graph', () => {
  it('is closed — no unresolved archive links, no references to deleted docs', () => {
    const base = resolveBase();
    expect(
      base,
      `no base ref among ${BASE_CANDIDATES.join(', ')} — the deletion invariant cannot ` +
        `be checked against an empty diff, so this fails rather than passing vacuously. ` +
        `Ensure the checkout fetches branches (actions/checkout with fetch-depth: 0).`,
    ).not.toBeNull();

    const { status, output } = runVerifier(base as string);
    expect(output, `verifyArchiveRefs.mjs failed:\n${output}`).not.toMatch(
      /UNRESOLVED|DANGLING|^FAIL:/m,
    );
    expect(status, `verifyArchiveRefs.mjs exited ${status}:\n${output}`).toBe(0);
  }, TEST_TIMEOUT);

  it('fails closed on an unreadable base ref rather than reporting success', () => {
    // The guard's own contract. If this ever passes, the verifier has started
    // treating "cannot check" as "checked and fine", and every green run above
    // stops meaning anything.
    const { status, output } = runVerifier('definitely/not/a/ref');
    expect(status).toBe(1);
    expect(output).toContain('cannot read base ref');
  }, TEST_TIMEOUT);
});
