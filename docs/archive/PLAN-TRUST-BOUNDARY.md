# Harness Trust Boundary — audit + redesign

Audit method: 6-domain risk×leverage calibration (95 action classes) + two
adversarial skeptics (reckless-lens / timid-lens). Source data in workflow
`wf_8c30df93-78c`. Proposed config: `scratchpad/trust-gate-hook.mjs` +
`scratchpad/proposed-settings-deltas.md`.

## The one finding everything hangs on

`C:/Users/kevin/.claude/settings.json` sets `defaultMode: bypassPermissions`
and `skipDangerousModePermissionPrompt: true`, globally, no deny rules. So the
harness **asks for nothing, ever** — Bash, PowerShell, Write to any path, all
MCP tools, in every project, silently. Every safety rule you think you have
(change-control skill, CLAUDE.md, kill-switch/dry-run conventions) lives in
**prose the harness never reads**. It's honor-system on a machine that deploys
to prod Firebase and drives your logged-in Chrome.

## The boundary is inverted

- Agent has, silently: prod deploy, arbitrary shell, self-config edit, external
  MCP that can spend money / email people / drop another project's DB.
- You reserve, by hand with numbered runbooks: PR merge, Coolify click, a
  Firestore flag flip — mechanical, verifiable things.

You gave away the irreversible stuff and kept the clerical stuff.

## Redesign principle: enforce with a hook, not `ask`

`ask` prompts don't work here — under bypass they're ignored, and in an
autonomous loop (qodo cycle, cron) there's nobody awake to answer one, so it
either stalls the loop or silently proceeds. A **PreToolUse hook** is the only
primitive that works in every mode: hard-DENY the irreversible class always;
for the GATE class, prompt when interactive, block-and-defer when headless.
Deny rules in settings are cheap redundancy on top.

See the two scratchpad files for the exact hook + settings.
