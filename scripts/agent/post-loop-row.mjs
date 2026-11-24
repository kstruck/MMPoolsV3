// Posts one loop-log row as a comment on the loop-log GitHub issue.
//
// Usage:
//   node scripts/agent/post-loop-row.mjs --loop pr-pruner --issue <n> --row-file row.tsv
//
// Why an issue and not LOOP-LOG.tsv: a scheduled GitHub Actions run cannot push
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
import { commentBody, rowToPost } from './loop-lib.mjs';

function main() {
  const args = parseArgs(process.argv.slice(2), {
    loop: { default: '' },
    issue: { default: 0, type: 'number' },
    'row-file': { default: '' },
    repo: { default: 'kstruck/MMPoolsV3' },
    'run-url': { default: '' },
  });
  if (!args.loop) throw new Error('--loop is required');
  if (!Number.isInteger(args.issue) || args.issue <= 0) throw new Error('--issue must be the loop-log issue number');

  const fileText = args['row-file'] && existsSync(args['row-file']) ? readFileSync(args['row-file'], 'utf8') : null;
  const row = rowToPost({ loop: args.loop, fileText });
  console.log(row);

  const r = spawnSync('gh', ['issue', 'comment', String(args.issue), '--repo', args.repo, '--body-file', '-'], {
    encoding: 'utf8',
    input: commentBody(row, args['run-url']),
  });
  if (r.error) throw new Error(`gh could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh issue comment failed: ${String(r.stderr).trim()}`);
  console.error(`Posted to ${args.repo}#${args.issue}.`);
}

try {
  main();
} catch (error) {
  console.error(`POST-LOOP-ROW FAILED: ${error.message}`);
  process.exit(2);
}
