// Loop runner: runs one `mmp-loop-*` loop through the Claude Agent SDK, so the
// run is paid by the Claude plan's API credit and not by Claude Code.
//
// Usage (from the repo root, after `npm --prefix scripts/agent ci`):
//   node scripts/agent/run-loop.mjs pr-pruner                    # DRY RUN: changes nothing on GitHub
//   node scripts/agent/run-loop.mjs pr-pruner --mode live        # warns and closes
//   node scripts/agent/run-loop.mjs pr-pruner --row-file row.tsv # also write the log row to a file
//   node scripts/agent/run-loop.mjs pr-pruner --mode check       # NO model call: prove the tools register
//
//   node scripts/agent/run-loop.mjs audit-sweep --mode offline   # the checks in code, NO model call, row printed only
//   node scripts/agent/run-loop.mjs audit-sweep                  # DRY RUN: model-driven, row printed only
//   node scripts/agent/run-loop.mjs audit-sweep --mode live      # model-driven, row posted to the loop-log issue
//
// audit-sweep reads PRODUCTION Firestore (read-only, audit-reader.mjs). It needs
// `npm --prefix functions ci` and a credential in GOOGLE_APPLICATION_CREDENTIALS,
// so it runs by hand on the Windows box and nowhere else.
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
import { AUDIT, AUDIT_ALLOWED_TOOLS, AUDIT_SYSTEM_PROMPT, buildAuditPrompt, createAuditSession, runAuditChecks, summarizeAuditRun } from './audit-lib.mjs';
import {
  PRUNER,
  PRUNER_ALLOWED_TOOLS,
  PRUNER_SYSTEM_PROMPT,
  buildLoopOptions,
  buildPrunerPrompt,
  createPrunerSession,
  fallbackRow,
  commentBody,
  loopExitCode,
  postRowOnce,
  resolveLoop,
  runFailure,
  stripGithubCredentials,
  summarizePrunerRun,
} from './loop-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_REPO = 'kstruck/MMPoolsV3';
/** The issue that holds runner rows (docs/plans/PLAN-LOOPS.md, "Where the row is written"). */
const DEFAULT_LOG_ISSUE = 806;

/**
 * The environment of the model's subprocess: the parent's, minus everything a
 * Claude Code session exports, minus every GitHub credential, minus the
 * Firestore credential path. The tools run in THIS process and are the only
 * thing that needs any of them.
 */
function agentEnv(key) {
  const env = stripGithubCredentials(buildChildEnv(process.env, key));
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (upper === 'GOOGLE_APPLICATION_CREDENTIALS' || upper === 'FIREBASE_TOKEN' || upper === 'FIREBASE_CONFIG') delete env[name];
  }
  return env;
}

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
async function checkWiring({ mcpServers, cwd, allowedTools }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const env = agentEnv('sk-ant-not-a-key-wiring-check-only');
  let tools = null;
  let thrown = null;
  try {
    for await (const message of query({
      prompt: 'wiring check',
      options: { ...buildLoopOptions({ cwd, env, model: 'claude-haiku-5-5', maxTurns: 1, maxBudgetUsd: 0.01, systemPrompt: 'wiring check', mcpServers, allowedTools }), abortController },
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
  const missing = allowedTools.filter((name) => !tools.includes(name));
  const extra = tools.filter((name) => !allowedTools.includes(name));
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
      await checkWiring({ mcpServers, cwd, allowedTools: PRUNER_ALLOWED_TOOLS });
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
        env: agentEnv(key),
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

/**
 * Loop 1, the audit sweep. Read-only, so `dry-run` and `live` do the same
 * work; the difference is whether main() posts the row afterwards.
 *
 * Order: the API key is checked BEFORE Firestore is opened, so a run that
 * cannot pay for a model call does not read production first. `offline` needs
 * no key and makes no model call.
 */
async function runAuditSweep({ profile, args, commit }) {
  const mode = args.mode;
  const blockedRow = (reason) => summarizeAuditRun({ ledger: createAuditSession({ reader: {} }).ledger, blocked: reason, mode, commit });
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'mmp-loop-'));
  try {
    const { createAuditToolServer } = await import('./audit-tools.mjs');
    if (mode === 'check') {
      // No reader: the wiring check never calls a tool.
      const mcpServers = { [AUDIT.TOOL_SERVER]: await createAuditToolServer(createAuditSession({ reader: {} }).handlers) };
      await checkWiring({ mcpServers, cwd, allowedTools: AUDIT_ALLOWED_TOOLS });
      return null;
    }

    let key = null;
    if (mode !== 'offline') {
      try {
        key = resolveApiKey(process.env);
      } catch (error) {
        return blockedRow(error.message);
      }
    }

    const { openAuditReader } = await import('./audit-reader.mjs');
    let opened;
    try {
      opened = await openAuditReader({ repoRoot: REPO_ROOT, env: process.env });
    } catch (error) {
      return blockedRow(error instanceof Error ? error.message : String(error));
    }
    try {
      console.error(`Loop ${profile.name}, ${mode.toUpperCase()}. Reading ${opened.describe}. READ-ONLY.`);
      const session = createAuditSession({ reader: opened.reader });
      if (mode === 'offline') {
        await runAuditChecks(session);
        return summarizeAuditRun({ ledger: session.ledger, mode, commit });
      }

      const sessionVars = inheritedSessionVars(process.env);
      if (sessionVars.length) {
        console.error(`NOTE: started from inside a Claude Code session. ${sessionVars.length} CLAUDE* variables are NOT passed to the agent.`);
      }
      const mcpServers = { [AUDIT.TOOL_SERVER]: await createAuditToolServer(session.handlers) };
      const { runQuery } = await import('./run.mjs');
      const { result, model, refused, error } = await runQuery({
        prompt: buildAuditPrompt({ skillText: readFileSync(path.join(REPO_ROOT, AUDIT.SKILL), 'utf8'), mode }),
        options: buildLoopOptions({
          cwd,
          env: agentEnv(key),
          model: args.model,
          maxTurns: args['max-turns'],
          maxBudgetUsd: args['max-budget-usd'],
          systemPrompt: AUDIT_SYSTEM_PROMPT,
          mcpServers,
          allowedTools: AUDIT_ALLOWED_TOOLS,
        }),
      });
      // What the model made of it, for the operator. It is not an input to the row.
      if (result?.subtype === 'success' && !result.is_error && result.result) console.error(`\nThe agent's summary (not part of the row):\n${String(result.result).slice(0, 1500)}`);

      const summary = summarizeAuditRun({
        ledger: session.ledger,
        failure: runFailure({ result, refused, error }),
        mode,
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
        note: mode,
      });
      if (logFailure) console.error(`NOTE: ${logFailure}. The outcome is unaffected.`);
      return summary;
    } finally {
      await opened.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main() {
  const [loopArg, ...rest] = process.argv.slice(2);
  if (!loopArg || loopArg.startsWith('--')) throw new Error('Usage: node scripts/agent/run-loop.mjs <loop> [--mode dry-run|live|check|offline] [--row-file <path>]');
  const profile = resolveLoop(loopArg);
  const args = parseArgs(rest, {
    mode: { default: 'dry-run' },
    repo: { default: DEFAULT_REPO },
    model: { default: profile.model },
    'max-budget-usd': { default: profile.maxBudgetUsd, type: 'number' },
    'max-turns': { default: profile.maxTurns, type: 'number' },
    'row-file': { default: '' },
    'log-issue': { default: DEFAULT_LOG_ISSUE, type: 'number' },
  });
  if (!profile.modes.includes(args.mode)) throw new Error(`--mode must be one of ${profile.modes.join(', ')} for ${profile.name}, got: ${args.mode}`);
  if (!Number.isInteger(args['log-issue'])) throw new Error('--log-issue must be an issue number');

  const commit = observedCommit();
  let summary;
  try {
    summary =
      profile.name === AUDIT.LOOP ? await runAuditSweep({ profile, args, commit }) : await runPruner({ profile, args, dryRun: args.mode !== 'live', commit });
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
  // A hand-run loop has no log job behind it, so a LIVE run posts its own row.
  // Not in dry-run, and never in offline: only a completed, model-driven live
  // run is an invocation of the loop as the charter means it.
  if (profile.postsOwnRow && args.mode === 'live') {
    const postId = `hand.${profile.name}.${Date.now().toString(36)}`;
    const failure = postRowOnce({ gh, repo: args.repo, issue: args['log-issue'], body: commentBody(summary.row, '', postId), postId });
    if (failure) {
      console.error(`\nROW NOT POSTED to ${args.repo}#${args['log-issue']}: ${failure}. The row is on stdout above.`);
      exit = 2;
    } else {
      console.error(`\nRow posted to ${args.repo}#${args['log-issue']}.`);
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
