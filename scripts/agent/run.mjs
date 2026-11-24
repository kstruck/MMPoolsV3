// The one place that loads the Agent SDK and drives a query().
//
// Kept apart from lib.mjs so the pure helpers stay importable without the SDK
// installed (see the note at the top of lib.mjs).

import { isCreditKeySource } from './lib.mjs';

/**
 * Run one query() to its result message.
 *
 * Aborts BEFORE the first model call when the subprocess did not authenticate
 * with the injected key, so a run can never bill the Claude subscription or a
 * settings-file key by accident.
 *
 * `error` is set when the SDK threw. The caller must treat that as a run that
 * did not complete, whatever `result` holds.
 *
 * @returns {{ result: object | null, apiKeySource: string | null, model: string | null, refused: string | null, error: string | null }}
 */
export async function runQuery({ prompt, options, onText }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = options.abortController ?? new AbortController();
  let result = null;
  let apiKeySource = null;
  let model = null;
  let refused = null;
  let error = null;

  try {
    for await (const message of query({ prompt, options: { ...options, abortController } })) {
      if (message.type === 'system' && message.subtype === 'init') {
        apiKeySource = message.apiKeySource;
        model = message.model ?? null;
        if (!isCreditKeySource(apiKeySource)) {
          refused = `the subprocess authenticated with "${apiKeySource}", not the injected API key`;
          abortController.abort();
          break;
        }
      } else if (message.type === 'assistant' && onText) {
        for (const block of message.message?.content ?? []) {
          if (block.type === 'text' && block.text) onText(block.text);
        }
      } else if (message.type === 'result') {
        result = message;
      }
    }
  } catch (thrown) {
    // An abort we asked for is the refusal above, not a failure of its own.
    //
    // Anything else is RETURNED, not rethrown. Measured 2026-11-23 with an
    // invalid key: the SDK throws ("Claude Code returned an error result:
    // Invalid API key") instead of only yielding an error result. Rethrowing
    // would skip the caller's cost-log row, and a failed run is exactly the
    // row that explains a missing review.
    if (!refused) error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  return { result, apiKeySource, model, refused, error };
}
