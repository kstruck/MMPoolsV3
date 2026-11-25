// Posts one loop-log row as a comment on the loop-log GitHub issue.
//
// Usage:
//   node scripts/agent/post-loop-row.mjs --loop pr-pruner --issue <n> --row-file row.tsv --mode dry-run|live
//
// Why an issue and not LOOP-LOG.tsv: a GitHub Actions run cannot push
// to `main` (the branch ruleset needs an approver), and the charter says a run
// that cannot push must put its row somewhere durable and never drop it
// (docs/plans/PLAN-LOOPS.md, "Where the row is written"). An issue comment
// needs no merge and is readable from any session with `gh`.
//
// This is PLAIN CODE on purpose. No model runs here. It is a separate job in
// the workflow, with a token that can write issue comments and nothing else,
// and it runs even when the loop job failed.
//
// A missing or malformed row file is not an excuse to post nothing: it posts
// an ERROR row that says so.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from './lib.mjs';
import { commentBody, postRowOnce, rowToPost } from './loop-lib.mjs';

function main() {
  const args = parseArgs(process.argv.slice(2), {
    loop: { default: '' },
    issue: { default: 0, type: 'number' },
    'row-file': { default: '' },
    repo: { default: 'kstruck/MMPoolsV3' },
    'run-url': { default: '' },
    // The mode the loop job ran in. Needed only for the row this script writes
    // itself, when the loop job left none: a failed dry run must still say DRY RUN.
    mode: { default: 'live' },
  });
  if (!['dry-run', 'live'].includes(args.mode)) throw new Error(`--mode must be dry-run or live, got: ${args.mode}`);
  if (!args.loop) throw new Error('--loop is required');
  if (!Number.isInteger(args.issue) || args.issue <= 0) throw new Error('--issue must be the loop-log issue number');

  const fileText = args['row-file'] && existsSync(args['row-file']) ? readFileSync(args['row-file'], 'utf8') : null;
  const row = rowToPost({ loop: args.loop, fileText, dryRun: args.mode === 'dry-run' });
  console.log(row);

  // One id per attempt of this job, so a re-run of the job posts its own row
  // and a retry inside one attempt never posts a second.
  const postId = `${process.env.GITHUB_RUN_ID ?? 'local'}.${process.env.GITHUB_RUN_ATTEMPT ?? '1'}.${args.loop}.${Date.now().toString(36)}`;
  const gh = (ghArgs, input) => {
    const r = spawnSync('gh', ghArgs, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { status: 127, stdout: '', stderr: `gh could not run: ${r.error.message}` };
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const failure = postRowOnce({ gh, repo: args.repo, issue: args.issue, body: commentBody(row, args['run-url'], postId), postId });
  // The row is on stdout above either way, so a failed post still leaves it in the job log.
  if (failure) throw new Error(`the row was NOT posted to ${args.repo}#${args.issue}: ${failure}`);
  console.error(`Posted to ${args.repo}#${args.issue}.`);
}

try {
  main();
} catch (error) {
  console.error(`POST-LOOP-ROW FAILED: ${error.message}`);
  process.exit(2);
}
