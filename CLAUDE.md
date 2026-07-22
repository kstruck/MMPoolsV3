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
subagent, not just the main checkout). **`ls .claude/skills/` is the only
list** — most are prefixed `mmp-`, but do not treat that as exhaustive;
run the command rather than trusting any roster written down here.

Each skill carries a "When NOT to use this skill" routing table to its
siblings and provenance/re-verify commands — trust the commands over the
prose if they disagree; skills are point-in-time snapshots.

## 2b. Opening a PR is not the end of the task — wait for qodo

> ⚠️ **DO NOT BLOCK ON QODO — 2026-07-21.** Kevin reported the qodo plan is out
> of tokens, so reviews may be intermittent or stop entirely. **Never wait on a
> review before reporting a PR, and never call a PR blocked on one.**
>
> Stated precisely, because the distinction matters: qodo was still posting
> reviews when this note was written, so do not assume silence means it is dead,
> and do not assume a review will come. `gh pr checks <n>` is still required and
> still gates.
>
> **THE PROCEDURE, single-valued (Kevin, 2026-07-21).** Before you push a
> follow-up commit, poll the three surfaces below for up to **3 minutes**.
> If a report lands in that window, absorb or reject every finding with written
> evidence before pushing. If nothing has appeared after 3 minutes, assume qodo
> is not going to respond on this PR and proceed — do not wait longer, and do not
> report the PR as blocked. A silent reviewer must never become a stalled PR.
>
> **This note OVERRIDES the "wait for the qodo review" instruction below for as
> long as it stands.** Read the rest of §2b as: *when a qodo report EXISTS, read
> every finding and absorb or reject each one with written evidence.* The
> waiting half is suspended — an unconditional "wait before reporting" can block
> a PR indefinitely against a reviewer that may never answer, which is the
> opposite of what the rule is for. Kevin will say when it resumes.
>
> Meanwhile the review burden falls back on the author, and §2c is now the
> primary cross-model gate rather than a supplement to qodo.

**After opening ANY pull request, check for a qodo review — and when one
exists, read every finding and absorb or reject each with written evidence
before reporting the PR as done.** Kevin should never have to ask whether qodo
was checked. (Per the box above, the *waiting* part is currently suspended:
poll for up to 3 minutes, then proceed if nothing is there.)

This lived in `mmp-qodo-cycle` and in auto-memory and was still dropped
under load on 2026-07-21 (checked on two PRs only when asked, skipped on
three others), so it is promoted here where a fresh session cannot miss it.

Why it earns a top-level rule: qodo's **defect** findings on this repo are
17/17 valid and have caught things code-reading did not — a live production
spread-unlock bug (#235), a `RangeError` on corrupt feed data (#231), and a
vulnerable `brace-expansion` in `functions/` that a root-only fix missed and
that CI's root-scoped audit could never catch (#240). Its **style/compliance**
findings are miscalibrated to this camelCase TypeScript repo and are 7/7
rejected (snake_case ×3, import order, `:any` counts, dependency placement).
Judge on evidence and **reply either way** — a rejection needs written
reasoning on the PR, not silence.

Mechanics. qodo spreads a single report across **three** surfaces and any
one of them can be empty on a given PR, so check all three — a report is
not absent until all three are:

```
gh pr checks <n>                                        # CI
gh pr view <n> --json comments                          # numbered findings
gh api repos/kstruck/MMPoolsV3/pulls/<n>/comments       # inline detail
gh api repos/kstruck/MMPoolsV3/pulls/<n>/reviews        # review-surface report
```

The `reviews` line is not optional padding: qodo can post as a review plus
inline comments while the issue-comment list is empty, so a procedure
without it can conclude "no findings" on a PR that has them. (Caught by
qodo, on the PR that introduced this very section.)

Re-check after pushing fixes: qodo marks absorbed findings `✓ Resolved`,
and that is the confirmation — not your own belief that you addressed them.

## 2c. Cross-model review is REQUIRED before opening a PR

`codex` (OpenAI) is installed and on PATH — verified `codex-cli 0.144.5`.
**Run it on your own diff before opening any PR:**

```
git fetch origin                                  # ALWAYS first — see below
codex exec review --base origin/main              # the whole PR diff
codex exec review --uncommitted                   # work not yet committed
```

⚠️ **`--base main`, not `origin/main`, is a trap in this repo.** Every worktree
shares one `main` ref, and it is only advanced by whoever runs `git pull` in the
main checkout — so in a worktree it is routinely stale. Reviewing against it
pulls unrelated already-merged upstream commits into the diff and reports on
code the PR never touched. Measured on 2026-07-21 mid-session: local `main` was
`e84dfa3` while `origin/main` was two merges ahead at `a28030d`. Fetch, then
name `origin/main` explicitly.

`--uncommitted` reviews only the working tree, so on its own it reports NOTHING
once the work is committed. Use it before a commit; use `--base origin/main`
for the PR. Found by codex reviewing this very section.

**Why this is a hard rule and not a nicety.** On 2026-07-21 a single session
produced 12 self-inflicted defects. Seven were facts asserted from memory that
one command would have checked. Four were the same class of bug the session had
just spent hours fixing in someone else's code — including reintroducing a
deploy-state SHA contradiction 30 minutes after fixing one. **Every single one
was caught by an external reviewer, none by self-review.**

The lesson is not "be careful". It is that a second model does not share the
first one's blind spots, and self-review reliably fails to catch the thing you
just did. When the qodo plan ran out, this replaced it.

Proof it works: the FIRST codex review run under this rule was on the docs-state
invariant in `tests/docs-state-invariants.test.ts`, and it found that the guard
matched only one of the three phrasings the docs actually use — i.e. a guard
that looked like it guarded and did not, which is precisely the class the guard
existed to stop. Written, reviewed, and holed in the same hour.

**Absorb or reject each finding with written evidence, same as the qodo rule in
§2b.** Codex is not automatically right — verify its claims against the code
before acting, as with any reviewer.

**Expect several rounds, and keep going until one comes back clean.** Measured
over the 2026-07-21 run: #245 took 4 rounds / 11 findings, #248 took 9 rounds,
#250 took 4 rounds / 15 findings. The pattern is consistent and worth knowing in
advance — **round 1 finds defects in the code, and rounds 2+ find defects in the
fixes**, including in the guards written to prove the fixes. Three separate
times it holed a test that looked like it guarded and did not. Budget for that
rather than treating round 1 as the review.

A rejection is a legitimate outcome and must be written down with reasoning. Of
those 30 findings, 3 were rejected: two would have made a monitor cry wolf
(marking a job unhealthy forever over a config choice), and one asked for an
incident-latching mechanism that does not exist. Judge on evidence.

## 2d. Cadence near a deadline

The target is the Hall of Fame game, **2026-08-06** (Thu, 8:00pm ET; the first
16-game preseason slate follows 2026-08-13). From 2026-07-21, at Kevin's direction:
**one PR at a time** — build it, run all five gates, run `codex exec review`,
absorb findings, report to Kevin, and only then start the next. Batching ~10 PRs
in a night is what produced the defect count above; throughput was never the
constraint, correctness is.

## 3. Deploy facts (do not re-derive)

- Functions + rules: `npx firebase deploy`, project `gridiron-gamble-uzuqo`.
  Run `npm --prefix functions ci` first — **`ci`, not `install`**, which
  rewrites the lockfile and dirties the tree `firebase deploy` packages.
  Deploy functions BEFORE rules.
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
   suites, do not claim a coverage percentage) or its plan-gate convention
   (PLAN-*.md, not a fresh planning template).

   **RESOLVED 2026-07-22 (Kevin).** The `PLAN-*.md` gate was "any 2+ file
   change", and it was systematically not followed — none of the twelve PRs
   merged 07-21 carried one, nor did the four opened overnight. It is now scoped
   to **blast radius, not file count**: a plan is required when a change touches
   **money, authorization, production data, or scoring**, and not otherwise.
   `mmp-change-control` §1 carries the trigger list and is authoritative.

   So: a 14-file refactor with no money/authz surface needs no plan; a one-line
   `firestore.rules` edit does. Against the sixteen PRs from 07-21/22 the new
   rule fires on exactly one — #255, the BANNED-owner authorization fix — which
   is the change where a plan would actually have helped.

   Stop flagging the skip on ordinary changes; it was a workaround for a rule
   nobody could follow. Do state the classification when a change is close to a
   trigger, and take the gate when in doubt.

## 5. Global CLAUDE.md overrides for this repo

- The graphify-first navigation mandate does not apply here (see above).
- The `ARCHITECTURE.md` mandate is satisfied by `mmp-architecture-contract`
  (stack/data-flow/integrations) plus this file — no separate file needed.
