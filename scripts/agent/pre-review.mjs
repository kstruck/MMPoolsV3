// Claude pre-review: a read-only Agent SDK reviewer for the current branch.
//
// Usage (from the repo root, after `npm --prefix scripts/agent ci`):
//   git fetch origin
//   node scripts/agent/pre-review.mjs                       # origin/main...HEAD
//   node scripts/agent/pre-review.mjs --base <ref-or-sha>   # a stacked branch: pass the PARENT'S HEAD SHA
//   node scripts/agent/pre-review.mjs --model claude-opus-5-5 --max-budget-usd 3
//
// Exit codes: 0 = CLEAN, 1 = FINDINGS, 2 = INCONCLUSIVE (the review did not
// complete, or could not start). 2 is never "clean".
//
// 🛑 WHAT THIS IS NOT (CLAUDE.md §2c). It is not a codex round and it does not
// replace codex or qodo. A second model does not share the first one's blind
// spots; this reviewer is the SAME model family as the author, so it shares
// them. It runs BEFORE the paid codex round to remove the cheap findings, and
// the stopping rule still needs codex clean, qodo clean and your own read.
//
// It reviews COMMITTED work only (HEAD), like `codex exec review --base`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  LOCKFILE_EXCLUDES,
  REVIEW_SYSTEM_PROMPT,
  buildChildEnv,
  buildReviewOptions,
  buildReviewPrompt,
  classifyRun,
  costLogPath,
  parseArgs,
  resolveApiKey,
  summarizeDenials,
  tryAppendCostRow,
} from './lib.mjs';
import { runQuery } from './run.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run git in the repo root; throw with git's own message on a non-zero exit. */
function git(...args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args.join(' ')} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  return r.stdout;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    base: { default: 'origin/main' },
    model: { default: 'claude-fable-5-2' },
    'max-budget-usd': { default: 5, type: 'number' },
    'max-turns': { default: 80, type: 'number' },
  });
  const key = resolveApiKey(process.env);

  const headSha = git('rev-parse', '--short', 'HEAD').trim();
  const mergeBase = git('merge-base', args.base, 'HEAD').trim().slice(0, 8);
  const range = `${args.base}...HEAD`; // THREE dots: what this branch introduces (CLAUDE.md §2c)
  const stat = git('diff', '--stat', range);
  // Lockfile BODIES are left out: thousands of generated lines that cost tokens
  // and that a model reviews badly. They stay in the stat, and the prompt says
  // they were left out, so the omission is stated rather than silent.
  const diff = git('diff', range, '--', '.', ...LOCKFILE_EXCLUDES);
  const prompt = buildReviewPrompt({ base: args.base, headSha, mergeBase, stat, diff });

  if (git('status', '--porcelain').trim()) {
    console.error('NOTE: the working tree has uncommitted changes. They are NOT reviewed; this reviews HEAD only.');
  }
  console.error(`Pre-review of ${range} (head ${headSha}, merge base ${mergeBase}) with ${args.model}, budget $${args['max-budget-usd']}.`);

  const { result, model, refused, error } = await runQuery({
    prompt,
    options: buildReviewOptions({
      cwd: REPO_ROOT,
      env: buildChildEnv(process.env, key),
      model: args.model,
      maxTurns: args['max-turns'],
      maxBudgetUsd: args['max-budget-usd'],
      systemPrompt: REVIEW_SYSTEM_PROMPT,
    }),
  });

  const outcome = classifyRun({ result, refused, error });

  // The reply is printed FIRST, and only for a run that completed. First,
  // because nothing after this line may cost the operator a review that was
  // already paid for. Only when complete, because a partial reply from a run
  // that then failed would read as a review.
  if (outcome.exit !== EXIT.INCONCLUSIVE) console.log(result.result);

  const denied = summarizeDenials(result?.permission_denials);
  if (denied) {
    console.error(
      `\nNOTE: the reviewer was denied these tool calls: ${denied}. A read outside the repo is denied on purpose; ` +
        'a denied read INSIDE it means the review saw less than it should have.',
    );
  }

  const logFailure = tryAppendCostRow(costLogPath(process.env), {
    date: new Date().toISOString(),
    script: 'pre-review',
    model: model ?? args.model,
    head: headSha,
    verdict: outcome.verdict,
    costUsd: result?.total_cost_usd,
    turns: result?.num_turns,
    durationMs: result?.duration_ms,
    note: [outcome.exit === EXIT.INCONCLUSIVE ? outcome.reason : `base ${args.base}`, denied && `denied: ${denied}`]
      .filter(Boolean)
      .join('; '),
  });
  if (logFailure) console.error(`\nNOTE: ${logFailure}. The outcome below is unaffected.`);

  const cost = Number.isFinite(result?.total_cost_usd) ? ` Estimated cost $${result.total_cost_usd.toFixed(4)}.` : '';
  if (outcome.exit === EXIT.INCONCLUSIVE) {
    console.error(`\nPRE-REVIEW INCONCLUSIVE: ${outcome.reason}.${cost} This is NOT a clean review.`);
  } else {
    console.error(`\nPRE-REVIEW ${outcome.verdict}: ${outcome.reason}.${cost} This is not a codex round (CLAUDE.md §2c).`);
  }
  return outcome.exit;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`PRE-REVIEW INCONCLUSIVE: ${error.message} This is NOT a clean review.`);
    process.exit(EXIT.INCONCLUSIVE);
  },
);
