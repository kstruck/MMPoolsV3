// One tiny Agent SDK call that proves the key spends the plan's API credit.
//
// Usage (from the repo root, after `npm --prefix scripts/agent ci`):
//   node scripts/agent/probe.mjs
//
// What it proves, and what it does not:
//   - PROVES the subprocess authenticated with the injected key (the init
//     message's apiKeySource) and that a model call completed.
//   - DOES NOT prove which balance paid. Only the Console can: open
//     https://platform.claude.com/settings/billing and confirm that
//     "Promotional credits" went down by about the printed cost.

import { EXIT, appendCostRow, buildChildEnv, costLogPath, parseArgs, resolveApiKey } from './lib.mjs';
import { runQuery } from './run.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2), { model: { default: 'claude-haiku-5-5' } });
  const key = resolveApiKey(process.env);

  const { result, apiKeySource, model, refused, error } = await runQuery({
    prompt: 'Reply with exactly: OK',
    options: {
      env: buildChildEnv(process.env, key),
      model: args.model,
      maxTurns: 1,
      tools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      systemPrompt: 'You are a connectivity probe. Reply with exactly the text you are asked for.',
    },
  });

  if (refused) {
    console.error(`PROBE REFUSED: ${refused}. No model call was made.`);
    return EXIT.INCONCLUSIVE;
  }
  const ok = !error && result?.subtype === 'success' && !result.is_error;
  const failure = error ?? String(result?.result ?? result?.errors?.join('; ') ?? result?.subtype ?? 'no result');
  appendCostRow(costLogPath(process.env), {
    date: new Date().toISOString(),
    script: 'probe',
    model: model ?? args.model,
    head: '',
    verdict: ok ? 'OK' : 'FAILED',
    costUsd: result?.total_cost_usd,
    turns: result?.num_turns,
    durationMs: result?.duration_ms,
    note: ok ? '' : failure.slice(0, 200),
  });

  if (!ok) {
    console.error(`PROBE FAILED (apiKeySource=${apiKeySource}): ${failure}`);
    return EXIT.INCONCLUSIVE;
  }
  console.log(`PROBE OK. model=${model} apiKeySource=${apiKeySource} reply=${JSON.stringify(result.result)}`);
  console.log(`Estimated cost: $${result.total_cost_usd.toFixed(4)} (an estimate, not a billing statement).`);
  console.log('Now confirm in the Console that "Promotional credits" went down: https://platform.claude.com/settings/billing');
  return EXIT.CLEAN;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`PROBE FAILED: ${error.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  },
);
