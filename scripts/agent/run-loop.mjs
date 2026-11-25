// Loop runner: runs one `mmp-loop-*` loop through the Claude Agent SDK, so the
// run is paid by the Claude plan's API credit and not by Claude Code.
//
// Usage (from the repo root, after `npm --prefix scripts/agent ci`):
//   node scripts/agent/run-loop.mjs pr-pruner                    # DRY RUN: changes nothing on GitHub
//   node scripts/agent/run-loop.mjs pr-pruner --mode live        # warns and closes
//   node scripts/agent/run-loop.mjs pr-pruner --row-file row.tsv # also write the log row to a file
//   node scripts/agent/run-loop.mjs pr-pruner --mode check       # NO model call: prove the tools register
//
// 🛑 THE DEFAULT IS A DRY RUN. A live run needs `--mode live` typed out, so a
// bare invocation, a copied command or a typo can never close a pull request.
//
// The run ALWAYS ends with exactly one loop-log row on stdout (and in
// --row-file), whatever happened: no key, an SDK failure, a budget stop. A run
// with no row is a run with no evidence that it happened
// (docs/plans/PLAN-LOOPS.md, "One row per INVOCATION").
//
// Exit codes: 0 = CLEAN, 1 = FINDING, 2 = anything else. Only CLEAN is 0.
//
// Which loops it runs, and why the others are refused: LOOP_PROFILES and
// UNRUNNABLE_LOOPS in loop-lib.mjs.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChildEnv, costLogPath, inheritedSessionVars, parseArgs, resolveApiKey, tryAppendCostRow } from './lib.mjs';
import {
  PRUNER,
  PRUNER_ALLOWED_TOOLS,
  PRUNER_SYSTEM_PROMPT,
  buildLoopOptions,
  buildPrunerPrompt,
  createPrunerSession,
  fallbackRow,
  loopExitCode,
  resolveLoop,
  runFailure,
  stripGithubCredentials,
  summarizePrunerRun,
} from './loop-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_REPO = 'kstruck/MMPoolsV3';
const MODES = ['dry-run', 'live', 'check'];

/** Run the GitHub CLI. Never throws: a missing binary is a non-zero status like any other failure. */
function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: `gh could not run: ${r.error.message}` };
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * The short SHA of the checkout this runner is in, or `-`.
 *
 * The loop reads its procedure (SKILL.md) and its rules (loop-lib.mjs) from
 * this checkout, so this is the version of the loop that ran. GITHUB_SHA is
 * used first: in Actions it is exact even on a shallow clone.
 */
function observedCommit() {
  const fromActions = String(process.env.GITHUB_SHA ?? '').trim();
  if (/^[0-9a-f]{40}$/.test(fromActions)) return fromActions.slice(0, 8);
  const r = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const sha = String(r.stdout ?? '').trim();
  return r.status === 0 && /^[0-9a-f]{7,40}$/.test(sha) ? sha : '-';
}

/**
 * `--mode check`: start the subprocess with a key that cannot work, read the
 * init message, stop. It proves the four tools register under the names the
 * allow list uses, and it cannot spend anything: the key is not a real one.
 */
async function checkWiring({ mcpServers, cwd }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const env = stripGithubCredentials(buildChildEnv(process.env, 'sk-ant-not-a-key-wiring-check-only'));
  let tools = null;
  let thrown = null;
  try {
    for await (const message of query({
      prompt: 'wiring check',
      options: { ...buildLoopOptions({ cwd, env, model: 'claude-haiku-5-5', maxTurns: 1, maxBudgetUsd: 0.01, systemPrompt: 'wiring check', mcpServers, allowedTools: PRUNER_ALLOWED_TOOLS }), abortController },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        tools = message.tools ?? [];
        abortController.abort();
        break;
      }
    }
  } catch (error) {
    // The abort, or the rejected key: both are expected once init has arrived.
    thrown = error instanceof Error ? error.message : String(error);
  }
  // No init at all means the subprocess never started properly: a sandbox that
  // blocks it, a missing binary. Measured 2026-11-24: on the Windows box init
  // arrives before the key is ever used (4 runs of 4); inside codex's review
  // sandbox it did not (codex round 6 on #807). The cause is printed, because
  // "no init message" alone sends the reader to the wrong place.
  if (!tools) throw new Error(`the subprocess sent no init message${thrown ? ` (${thrown.slice(0, 300)})` : ''}. This check needs to start the Agent SDK's subprocess; it cannot pass where that is blocked`);
  const missing = PRUNER_ALLOWED_TOOLS.filter((name) => !tools.includes(name));
  const extra = tools.filter((name) => !PRUNER_ALLOWED_TOOLS.includes(name));
  console.error(`Tools the model would hold: ${tools.join(', ') || '(none)'}`);
  if (missing.length) throw new Error(`these loop tools did not register: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`the model would hold tools the loop does not use: ${extra.join(', ')}`);
  console.error('WIRING OK: exactly the four loop tools, and no built-in tool. No model call was made.');
}

async function runPruner({ profile, args, dryRun, commit }) {
  const repo = args.repo;
  const session = createPrunerSession({ gh, repo, dryRun });
  const { createPrunerToolServer } = await import('./pruner-tools.mjs');
  const mcpServers = { [PRUNER.TOOL_SERVER]: await createPrunerToolServer(session.handlers) };
  // The model reads and writes no file. An empty directory keeps it that way
  // even if a built-in tool were ever switched back on by mistake.
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'mmp-loop-'));
  try {
    if (args.mode === 'check') {
      await checkWiring({ mcpServers, cwd });
      return null;
    }

    let key;
    try {
      key = resolveApiKey(process.env);
    } catch (error) {
      return summarizePrunerRun({ ledger: session.ledger, blocked: error.message, dryRun, commit });
    }

    const sessionVars = inheritedSessionVars(process.env);
    if (sessionVars.length) {
      console.error(`NOTE: started from inside a Claude Code session. ${sessionVars.length} CLAUDE* variables are NOT passed to the agent.`);
    }
    console.error(`Loop ${profile.name} on ${repo}, ${dryRun ? 'DRY RUN' : 'LIVE'}, model ${args.model}, budget $${args['max-budget-usd']}.`);

    const { runQuery } = await import('./run.mjs');
    const { result, model, refused, error } = await runQuery({
      prompt: buildPrunerPrompt({ skillText: readFileSync(path.join(REPO_ROOT, PRUNER.SKILL), 'utf8'), repo, dryRun }),
      options: buildLoopOptions({
        cwd,
        env: stripGithubCredentials(buildChildEnv(process.env, key)),
        model: args.model,
        maxTurns: args['max-turns'],
        maxBudgetUsd: args['max-budget-usd'],
        systemPrompt: PRUNER_SYSTEM_PROMPT,
        mcpServers,
        allowedTools: PRUNER_ALLOWED_TOOLS,
      }),
    });

    const summary = summarizePrunerRun({
      ledger: session.ledger,
      failure: runFailure({ result, refused, error }),
      dryRun,
      commit,
      model: model ?? args.model,
      costUsd: result?.total_cost_usd,
      turns: result?.num_turns,
    });
    const logFailure = tryAppendCostRow(costLogPath(process.env), {
      date: new Date().toISOString(),
      script: `loop:${profile.name}`,
      model: model ?? args.model,
      head: commit,
      verdict: summary.verdict,
      costUsd: result?.total_cost_usd,
      turns: result?.num_turns,
      durationMs: result?.duration_ms,
      note: dryRun ? 'dry run' : 'live',
    });
    if (logFailure) console.error(`NOTE: ${logFailure}. The outcome is unaffected.`);
    return summary;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main() {
  const [loopArg, ...rest] = process.argv.slice(2);
  if (!loopArg || loopArg.startsWith('--')) throw new Error('Usage: node scripts/agent/run-loop.mjs <loop> [--mode dry-run|live|check] [--row-file <path>]');
  const profile = resolveLoop(loopArg);
  const args = parseArgs(rest, {
    mode: { default: 'dry-run' },
    repo: { default: DEFAULT_REPO },
    model: { default: profile.model },
    'max-budget-usd': { default: profile.maxBudgetUsd, type: 'number' },
    'max-turns': { default: profile.maxTurns, type: 'number' },
    'row-file': { default: '' },
  });
  if (!MODES.includes(args.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}, got: ${args.mode}`);

  const commit = observedCommit();
  let summary;
  try {
    summary = await runPruner({ profile, args, dryRun: args.mode !== 'live', commit });
  } catch (error) {
    if (args.mode === 'check') throw error;
    summary = { verdict: 'ERROR', row: fallbackRow({ loop: profile.name, verdict: 'ERROR', reason: error instanceof Error ? error.message : String(error), commit, dryRun: args.mode !== 'live' }) };
  }
  if (!summary) return 0; // --mode check: no run, so no row

  // STDOUT FIRST. The row file is optional; the row is not. A path that cannot
  // be written must not cost the run its only record (qodo on this PR).
  console.log(summary.row);
  let exit = loopExitCode(summary.verdict);
  if (args['row-file']) {
    try {
      writeFileSync(args['row-file'], `${summary.row}\n`, 'utf8');
    } catch (error) {
      console.error(`\nROW FILE NOT WRITTEN (${args['row-file']}): ${error instanceof Error ? error.message : String(error)}. The row is on stdout above.`);
      exit = 2;
    }
  }
  console.error(`\nLOOP ${profile.name} ${summary.verdict}.`);
  return exit;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`LOOP RUNNER FAILED: ${error.message}`);
    process.exit(2);
  },
);
