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

## 2b. qodo — CHECK IT ON EVERY PR (Kevin, 2026-07-30 ET)

<!-- Dates in this repo are ET (#259). Commits from a late-evening session stamp
     the PREVIOUS day in local MT (-0600) — e.g. 07-24 22:24 MT is 07-25 00:24 ET.
     A git date one day behind a doc date is expected, not a defect. -->

✅ **RESTORED 2026-07-30. Kevin's subscription is active again: "Please add that
check for every PR going forward."** This section previously said DO NOT CHECK
and every word of that is now revoked — the 2026-07-25 removal, the "pure
overhead" reasoning, and the instruction not to mention qodo in a PR body or a
report. It was removed only because the trial had lapsed and the bot posted
nothing but a "your trial has ended" notice.

**Run it on every PR.** A single report spreads across **three** surfaces and any
one of them can be empty, so a report is not absent until all three are:

```
gh pr view <n> --json comments                          # numbered findings
gh api repos/kstruck/MMPoolsV3/pulls/<n>/comments       # inline detail
gh api repos/kstruck/MMPoolsV3/pulls/<n>/reviews        # review-surface report
```

**Absorb or reject each finding with written evidence.** A rejection is a
legitimate outcome and needs reasoning **on the PR**, not silence. qodo marks
absorbed findings `✓ Resolved`, and that mark is the confirmation — not your own
belief that you addressed it.

### Calibration — what its findings were actually worth here

Judge on evidence, but this is the prior. Over its previous run on this repo:

- **Defect findings: 17/17 valid**, and they caught things code-reading did not —
  a live production spread-unlock bug (#235), a `RangeError` on corrupt feed data
  (#231), and a vulnerable `brace-expansion` in `functions/` that a root-only fix
  missed and CI's root-scoped audit could never catch (#240).
- **Style/compliance findings: 7/7 rejected** as miscalibrated to this camelCase
  TypeScript repo (snake_case ×3, import order, `:any` counts, dependency
  placement).

So: take its defect findings seriously, and expect to reject its style ones with
a one-line reason.

### How qodo and codex divide the work (Kevin's ruling, 2026-07-30)

**Both run on every PR.** qodo costs nothing per run — it is a subscription —
while each `codex exec review` is a paid API call, so the round budget is spent
on codex, not qodo.

**The stopping rule is joint.** Stop when **qodo is clean AND a codex round is
clean AND your own read of the diff agrees**. Two independent reviewers coming
back clean is stronger evidence than one doing so, so when qodo is also clean you
should reach that bar in **fewer codex rounds** than the §2c cap allows — spend
the cap only when the reviewers disagree, when findings keep landing, or on a
plan-gated change. The cap is a ceiling, never a target.

`gh pr checks <n>` (CI) is required and gates independently of both.

`.claude/skills/mmp-qodo-cycle/SKILL.md` carries the absorption loop — watch the
PR, pull all three surfaces, make a validity call on every finding BEFORE fixing,
rerun the full gate set, report a per-finding verdict table. It was marked DORMANT
on 2026-07-25 and is **live again**.

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

⚠️ **USE A THREE-DOT DIFF TO CHECK PR SCOPE. `..` LIES.**

```
git fetch origin
git diff --stat origin/main...HEAD    # THREE dots - what YOUR branch introduces
```

Two-dot `origin/main..HEAD` compares the two TIPS, so every commit `origin/main`
has gained since you branched shows up as a **reverse** change in your diff.
Three-dot diffs against the merge base and shows only what your branch actually
did.

This is written down because it produced a false alarm worth more than the true
positive would have been. On 2026-07-22 a two-dot diff on a security PR showed a
125-line `package-lock.json` "reversal", and the session concluded the PR would
revert the `fast-uri` fix from #254 and rebuilt the branch. Codex reviewed the
resulting write-up and disproved it. Verified after: no commit on that branch
ever touched `package-lock.json`, and `git diff origin/main...HEAD --
package-lock.json` was **empty**. Git's three-way merge would have preserved
`origin/main`'s lockfile. The PR was fine; the diff command was wrong.

The real lesson is the general one: **a scary reading of a command's output is a
hypothesis, not a finding.** Confirm which commits touched the file
(`git log origin/main..HEAD -- <path>`) before acting on it, and certainly
before writing it into a rule.

Branching cleanly is still worth doing - starting a PR from `origin/main` keeps
its history to its own commits - but it is hygiene, not a correctness fix, so it
is not something to reach for on a hunch.

⚠️ **Use `-b`, not `-B`, and never on a branch that already has commits.**

```
git fetch origin
git status --short                              # expect empty first
git checkout -b <NEW-branch-name> origin/main   # -b: fails if the branch exists
```

`-B` force-RESETS an existing branch's ref to `origin/main`, silently discarding
every commit on it. A clean `git status` does not protect you: it reports
uncommitted changes, and this destroys COMMITTED ones. Recovery is `git reflog`,
if you notice.

`-b` fails loudly when the branch already exists, which is the behaviour you
want. To move an existing branch onto a newer `origin/main`, rebase it
(`git rebase origin/main`) rather than resetting it.

One more thing `-b`/`-B` do NOT do: discard uncommitted work. Compatible changes
are CARRIED ALONG onto the new branch, and conflicting tracked changes abort the
checkout. The carried-along case is the quiet one - it is how unrelated edits
end up in a PR - which is why the `git status --short` check above comes first.

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

**Expect several rounds. Use judgement up to 10 per artifact; past 10, ask
Kevin first and say WHY that artifact needs more (Kevin, 2026-07-27).** The cap
was 5 earlier that week; it was raised after a 5-round stop left two P1 findings
unresolved on #311, and resolving them turned out to need six more rounds — the
new code written to close a finding has never been reviewed, so it earns its own
round. Codex runs are paid, so do not burn rounds on trivial diffs.

**The stopping rule is evidence, not the counter**: stop when a codex round comes
back clean **AND qodo is clean** (§2b — restored 2026-07-30, and it is required,
not optional) **AND your own read of the diff agrees**. All three, not two. If you
stop with findings still open, write them into the PR body as named, unresolved
findings, say plainly that the PR carries them, and let Kevin decide. Never report
a PR as done while silently holding findings.

Measured over the 2026-07-21 run (before the cap): #245 took 4 rounds / 11
findings, #248 took 9 rounds, #250 took 4 rounds / 15 findings. The pattern is
worth knowing in advance — **round 1 finds defects in the code, and rounds 2+
find defects in the fixes**, including in the guards written to prove the fixes.
Three separate times it holed a test that looked like it guarded and did not. So
do not treat a clean round 1 as the review: **self-review the diff yourself**.
That is a third opinion now rather than the only other one — qodo was restored
2026-07-30 (§2b) — and it still earns its keep: on 2026-07-30 codex came back
clean on #322 round 3 and self-review immediately found a reachable error path
with copy that blamed the wrong subsystem.

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

   So: a 14-file refactor touching none of the four triggers — no money, no
   authorization, no production data, no scoring — needs no plan; a one-line
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
