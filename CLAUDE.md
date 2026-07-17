# March Melee Pools — session entry point

This file exists because the global `~/.claude/CLAUDE.md` navigation mandate
(graphify-first) does not apply here — no knowledge graph has ever been built
for this repo. Use this file instead.

## 1. Start here

1. Read [HANDOFF.md](HANDOFF.md) first — it is the canonical live-state carrier
   (current effort, what shipped, what's pending, environment facts).
2. [CONTEXT.md](CONTEXT.md) is the canonical domain glossary (roles, money
   model, lifecycle terms). Defer to it over any other doc when a term is
   ambiguous.
3. Auto-memory is a secondary index of standing directives and cross-session
   facts — HANDOFF.md wins on any live-state disagreement between the two.

## 2. Skills — load before acting

Before debugging, deploying, or planning, load the matching skill from
`.claude/skills/` (now tracked in git — available in every worktree and
subagent, not just the main checkout):

architecture-contract, build-and-env, change-control, config-and-flags,
debugging-playbook, deploy-and-operate, diagnostics-and-tooling,
docs-and-writing, failure-archaeology, loop-audit-sweep, loop-babysit-deps,
loop-e2e-nightly, loop-next-ticket, loop-pr-pruner, nfl-season-campaign,
pools-domain-reference, product-frontier, qodo-cycle, superadmin-surface,
validation-and-qa (prefix each with `mmp-`), plus `pr-ci-check`.

Each skill carries a "When NOT to use this skill" routing table to its
siblings and provenance/re-verify commands — trust the commands over the
prose if they disagree; skills are point-in-time snapshots.

## 3. Deploy facts (do not re-derive)

- Functions + rules: `npx firebase deploy`, project `gridiron-gamble-uzuqo`.
  Run `npm --prefix functions install` first. Deploy functions BEFORE rules.
- Frontend (`www`): manual trigger in the Coolify dashboard — pushing to
  `main` does **not** auto-deploy the frontend.
- This is a Firestore + Firebase Functions app (no Supabase, no Postgres, no
  Vercel, no Next.js). Ignore any global tooling that assumes otherwise.

## 4. Precedence — resolves persona/formatting conflicts

1. Safety rails and change-control rules (kill-switch defaults, dry-run
   gates, the deploy ritual above, the PLAN→review-log→sweep gate) beat
   every persona and every formatting preference, unconditionally.
2. Numbered step-by-step runbooks handed to Kevin for manual execution are
   **always full verbosity** — this overrides minimum-formatting rules and
   any terseness/minimalism persona (caveman, ponytail, or similar) for that
   message. Persona modes resume on the next message.
3. Outside of (1) and (2), personas govern prose style and code-size
   defaults as configured; they do not override this repo's test
   conventions (see `mmp-validation-and-qa` — extend existing vitest
   suites, do not claim a coverage percentage) or its plan-before-multi-file-
   change convention (PLAN-*.md, not a fresh planning template).

## 5. Global CLAUDE.md overrides for this repo

- The graphify-first navigation mandate does not apply here (see above).
- The `ARCHITECTURE.md` mandate is satisfied by `mmp-architecture-contract`
  (stack/data-flow/integrations) plus this file — no separate file needed.
