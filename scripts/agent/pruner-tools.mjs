// Wraps the pruner's handlers (loop-lib.mjs) as in-process Agent SDK tools.
//
// Kept apart from loop-lib.mjs because this file needs the SDK and zod, and
// loop-lib.mjs must stay importable without either (see its first comment).

import { PRUNER } from './loop-lib.mjs';

/**
 * An in-process MCP server that exposes exactly the four pruner tools.
 *
 * The handlers run in THIS process, with this process's `gh` and its token.
 * The model's subprocess gets the tool names and the JSON they return, and
 * nothing it could run a command with.
 */
export async function createPrunerToolServer(handlers) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  const { z } = await import('zod');

  const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const number = { number: z.number().int().positive().describe('The pull request number.') };

  return createSdkMcpServer({
    name: PRUNER.TOOL_SERVER,
    version: '0.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'list_open_prs',
        'List every open pull request with its last-activity date, days idle, whether it carries the keep label, and whether it is stale. Call this first.',
        {},
        async () => reply(handlers.list_open_prs()),
      ),
      tool(
        'inspect_pr',
        'Read one pull request fresh and report which action the loop rules allow for it now: WARN, CLOSE, or none (KEEP, NOT_STALE, NOT_OPEN).',
        number,
        async (args) => reply(handlers.inspect_pr(args)),
      ),
      tool(
        'warn_pr',
        'Post the stale warning on one pull request. Refused unless the rules allow WARN for it.',
        number,
        async (args) => reply(handlers.warn_pr(args)),
      ),
      tool(
        'close_pr',
        'Close one pull request that was warned earlier and is untouched since, then re-read it to confirm it is CLOSED. Refused unless the rules allow CLOSE for it.',
        number,
        async (args) => reply(handlers.close_pr(args)),
      ),
    ],
  });
}
