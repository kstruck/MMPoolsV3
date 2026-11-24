// A throwaway checkout that holds TRACKED files only, for the reviewer to read.
//
// Why: the diff under review is untrusted text, and reads inside the reviewer's
// working directory need no approval. Pointed at the developer's own checkout,
// one injected line could have it read an ignored `.env`, a service-account
// key or anything else that lives beside the code but is not in git, and send
// it to the API (codex round 2 on the PR that added this). A detached
// worktree of the commit contains none of that: no ignored files, no
// untracked files, no node_modules, and `.git` is a one-line pointer file
// whose target is outside the directory and therefore unreadable.
//
// No SDK import here: the root test suite loads this module.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args.join(' ')} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  return r.stdout;
}

/**
 * Check `commit` out into a new temp directory, run `fn(dir)`, then remove it.
 *
 * The removal runs whether `fn` resolves or throws. If the removal itself
 * fails, that is reported on stderr and does not replace `fn`'s outcome: the
 * review is the product, the cleanup is housekeeping.
 */
export async function withCleanWorktree(repoRoot, commit, fn) {
  // mkdtemp gives a unique, empty parent; the worktree goes one level below it
  // because `git worktree add` wants to create the directory itself.
  const parent = mkdtempSync(path.join(os.tmpdir(), 'mmp-pre-review-'));
  const dir = path.join(parent, 'tree');
  git(repoRoot, 'worktree', 'add', '--detach', '--quiet', dir, commit);
  try {
    return await fn(dir);
  } finally {
    try {
      git(repoRoot, 'worktree', 'remove', '--force', dir);
    } catch (error) {
      console.error(`NOTE: could not remove the review worktree at ${dir}: ${error.message}. Run "git worktree prune" after deleting it.`);
    }
    if (existsSync(parent)) {
      try {
        rmSync(parent, { recursive: true, force: true });
      } catch {
        // Left behind in the OS temp directory; nothing depends on it.
      }
    }
  }
}
