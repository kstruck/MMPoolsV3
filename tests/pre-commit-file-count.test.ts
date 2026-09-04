import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * `.husky/pre-commit` warns when a commit stages more than 10 paths — PR #664.
 *
 * WHY THIS EXISTS, MEASURED. The first version counted with
 * `--diff-filter=ACMR`, so a commit that DELETED thirty files printed nothing
 * (codex round 1 on #664). The fix added `D`; qodo then pointed out that `T`
 * (type change) was still excluded (#664 finding 5). The counter now has no
 * filter at all: every staged path counts. This pins that, and the threshold
 * boundary, by running the real hook against a throwaway git repository.
 *
 * The secret scanner runs first in the same hook and would need the repo's
 * `scripts/scan_secrets.py`, which the throwaway repo does not have. A stub
 * `python` is placed first on PATH so the hook reaches the counter. The stub is
 * only for THIS test's PATH; nothing here touches the real interpreter.
 *
 * Reported, not silently skipped, if `sh` cannot be found: a hook test that
 * passes because it never ran is the failure this repo keeps re-learning.
 */

const REPO_ROOT = resolve(__dirname, '..');
const HOOK = join(REPO_ROOT, '.husky', 'pre-commit');
const THRESHOLD = 10;

function findSh(): string {
  if (process.platform !== 'win32') return 'sh';
  // Git for Windows ships sh.exe beside git; PowerShell users have git on PATH
  // but not usr/bin, so derive it from git's own location.
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  const gitExe = (where.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!gitExe) throw new Error('git.exe not on PATH; cannot locate sh.exe for the hook test');
  let dir = dirname(gitExe);
  for (let i = 0; i < 4; i++) {
    for (const candidate of [join(dir, 'bin', 'sh.exe'), join(dir, 'usr', 'bin', 'sh.exe')]) {
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error(`sh.exe not found near ${gitExe}; cannot run the hook test`);
}

let SH: string;
let sandbox: string;
let stubBin: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

/**
 * Launch `sh` on the real hook inside the throwaway repo. `spawnSync` does not
 * throw on a launch failure (missing shell, EACCES): it returns `error` with a
 * null `status`, which would surface below as "expected null to be 0". Turn it
 * into a descriptive failure instead (qodo on #668).
 */
function launchHook(shArgs: string[], pathPrefix: string): { out: string; status: number | null } {
  const hookResult = spawnSync(SH, shArgs, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${pathPrefix}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
  });
  if (hookResult.error) {
    throw new Error(`could not launch ${SH} ${shArgs.join(' ')}: ${hookResult.error.message}`);
  }
  return { out: `${hookResult.stdout ?? ''}${hookResult.stderr ?? ''}`, status: hookResult.status };
}

/** Run the real hook with the passing stub scanner on PATH. */
function runHook(): { out: string; status: number | null } {
  return launchHook([HOOK], stubBin);
}

function resetRepo(): void {
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo);
  git('init', '-q');
}

beforeAll(() => {
  SH = findSh();
  sandbox = mkdtempSync(join(tmpdir(), 'mmp-precommit-'));
  stubBin = join(sandbox, 'stub-bin');
  mkdirSync(stubBin);
  // Stub `python` (and `python.exe` — sh on Windows resolves either) that exits 0.
  const stub = '#!/bin/sh\nexit 0\n';
  writeFileSync(join(stubBin, 'python'), stub, { mode: 0o755 });
  writeFileSync(join(stubBin, 'python.exe'), stub, { mode: 0o755 });
  repo = join(sandbox, 'repo');
  mkdirSync(repo);
  git('init', '-q');
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('.husky/pre-commit staged-path warning', () => {
  it('the counter has no --diff-filter, so every staged status (A, D, M, R, T…) counts', () => {
    const hook = readFileSync(HOOK, 'utf8');
    const counter = hook.match(/file_count=\$\((.+)\)/);
    expect(counter, 'the file_count= line must exist').not.toBeNull();
    expect(counter![1]).toContain('git diff --cached --name-only');
    expect(counter![1]).not.toContain('--diff-filter');
    expect(hook).toMatch(new RegExp(`-gt ${THRESHOLD}\\b`));
  });

  it(`stages exactly ${THRESHOLD} added files → no warning (boundary is "more than", not "at least")`, () => {
    resetRepo();
    for (let i = 0; i < THRESHOLD; i++) writeFileSync(join(repo, `a${i}.txt`), `${i}\n`);
    git('add', '-A');
    const { out, status } = runHook();
    expect(status).toBe(0);
    expect(out).not.toContain('WARNING');
  });

  it(`stages ${THRESHOLD + 1} added files → warns with the real count`, () => {
    resetRepo();
    for (let i = 0; i <= THRESHOLD; i++) writeFileSync(join(repo, `a${i}.txt`), `${i}\n`);
    git('add', '-A');
    const { out, status } = runHook();
    expect(status).toBe(0); // advisory: never blocks
    expect(out).toContain(`WARNING: this commit stages ${THRESHOLD + 1} files`);
  });

  it(`stages ${THRESHOLD + 1} DELETIONS → warns (the codex-r1 regression)`, () => {
    resetRepo();
    for (let i = 0; i <= THRESHOLD; i++) writeFileSync(join(repo, `d${i}.txt`), `${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    for (let i = 0; i <= THRESHOLD; i++) rmSync(join(repo, `d${i}.txt`));
    git('add', '-A');
    expect(git('diff', '--cached', '--name-status').trim().split('\n')).toHaveLength(THRESHOLD + 1);
    const { out, status } = runHook();
    expect(status).toBe(0);
    expect(out).toContain(`WARNING: this commit stages ${THRESHOLD + 1} files`);
  });

  it('a mixed commit of 6 deletions + 5 modifications → warns (11 total, no single status reaches 11)', () => {
    resetRepo();
    for (let i = 0; i < 11; i++) writeFileSync(join(repo, `m${i}.txt`), `${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    for (let i = 0; i < 6; i++) rmSync(join(repo, `m${i}.txt`));
    for (let i = 6; i < 11; i++) writeFileSync(join(repo, `m${i}.txt`), `changed ${i}\n`);
    git('add', '-A');
    const { out } = runHook();
    expect(out).toContain('WARNING: this commit stages 11 files');
  });

  it('a failing secret scan still aborts the commit before the counter runs (sh -e contract)', () => {
    // husky invokes the hook as `sh -e <hook>`; this reproduces that and makes
    // the stub interpreter fail, proving the new lines cannot swallow its exit.
    resetRepo();
    for (let i = 0; i <= THRESHOLD; i++) writeFileSync(join(repo, `s${i}.txt`), `${i}\n`);
    git('add', '-A');
    const failBin = join(sandbox, 'fail-bin');
    mkdirSync(failBin, { recursive: true });
    const stub = '#!/bin/sh\necho "SECRET FOUND"\nexit 3\n';
    writeFileSync(join(failBin, 'python'), stub, { mode: 0o755 });
    writeFileSync(join(failBin, 'python.exe'), stub, { mode: 0o755 });
    const { out, status } = launchHook(['-e', HOOK], failBin);
    expect(status).toBe(3);
    expect(out).not.toContain('WARNING');
  });
});
