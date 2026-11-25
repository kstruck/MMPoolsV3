// Wraps the audit sweep's handlers (audit-lib.mjs) as in-process Agent SDK tools.
//
// 🛑 EVERY TOOL TAKES NO INPUT. The model cannot name a collection, a document,
// a date or a query. It can only ask for one of four fixed checks, and each
// check returns counts, action names and document ids (audit-lib.mjs says
// exactly what, and why nothing else).

import { AUDIT } from './audit-lib.mjs';

export async function createAuditToolServer(handlers) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

  return createSdkMcpServer({
    name: AUDIT.TOOL_SERVER,
    version: '0.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'read_audit_window',
        `Read the last ${AUDIT.WINDOW_DAYS} days of the admin audit trail into the runner. Returns the row count only. Call this first.`,
        {},
        async () => reply(await handlers.read_audit_window()),
      ),
      tool(
        'check_row_shape',
        'Check every row that was read against the audit schema. Returns how many are malformed, which field names are wrong, and a sample of document ids.',
        {},
        async () => reply(await handlers.check_row_shape()),
      ),
      tool(
        'check_action_coverage',
        'Count rows per action type, and report recurring jobs that have logged before and have no row in the window.',
        {},
        async () => reply(await handlers.check_action_coverage()),
      ),
      tool(
        'check_targets',
        'Check that the pools named by rows still exist. Returns counts and a sample of audit document ids.',
        {},
        async () => reply(await handlers.check_targets()),
      ),
    ],
  });
}
