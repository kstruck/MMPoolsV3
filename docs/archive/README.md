# docs/archive — superseded session and status docs

Dated session records (MORNING-*, checklists, memos, readiness audits) whose
work has shipped. Moved here from the repo root by the 2026-09-01 docs cleanup
(PR #653) because living docs, plans, ADRs, or code comments still cite them as
provenance. Citations elsewhere may use the bare filename — resolve it against
this directory.

**Nothing here is a source of current state.** `HANDOFF.md` is the live-state
carrier and `CONTEXT.md` the glossary. Read a file here only to recover the
reasoning behind a decision that another doc cites.

## The archive criterion, and how it was checked

A root doc was **archived** rather than deleted if any kept file still names it.
A doc was **deleted** only when nothing anywhere cited it; git history is its
archive. Both halves were verified by command, not by reading.

`scripts/verifyArchiveRefs.mjs` checks both halves and exits non-zero if either
breaks. Run it from the repo root after any doc move:

**When you delete a doc, add its filename to `deleted-docs.txt` in this
directory.** That file is the durable half of the check: the verifier learns
about deletions from `git diff <base>...HEAD`, which is empty once a cleanup
merges, so without the manifest a re-added reference to a long-deleted doc
would pass on `main`. You will not forget silently — the verifier **fails and
prints the missing lines** if a deletion in the diff has no manifest entry.

The verifier runs in CI as part of the suite
(`tests/archive-refs-invariants.test.ts`, inside the required `build-and-test`
check), so a broken archive link or a re-cited deleted doc fails the PR rather
than relying on someone remembering to run it.

```bash
node scripts/verifyArchiveRefs.mjs
```

Its output when this cleanup landed, verbatim:

```
unprefixed refs to archived docs: 0
refs to deleted docs:             0

OK — archive citation graph is closed.
```

Counts at the time of the cleanup, from `git diff origin/main...HEAD`:
**202 root `.md` files before → 164 after**; of the 38 that left the root,
**25 were archived here** and **13 were deleted** with zero citations.

The criterion is not "looks old". Three files were restored to the root during
review precisely because they are still live: `NOTES-WAVE2.md` (about ten
comments in `functions/src/` cite it as the A1/A2 billing spec, **without** the
`.md` suffix), `MORNING-2026-07-30.md` (`PICKUP-PRESEASON-PILOT.md:280` points
an operator at its still-outstanding task 1b), and the `MORNING-2026-08-18*`
help chain (its T9 defects remain open).

## Round 2 — 2026-09-08: shipped plans and consumed session docs

The first round left every `PLAN-*.md` at the root, shipped or not. Round 2
applies a **status** criterion on top of the citation one: a root doc moved
here when its work is **shipped, closed, superseded, or consumed** — verified
per file by its own status block, the merged PR (`gh pr view`), the commit
subjects that cite it, and `HANDOFF.md`. A plan whose implementation is
**still open** (unsigned, awaiting a deploy decision, or with phases not
started) stays at the root. Companion `-REVIEW-LOG` and `-SWEEPS` docs travel
with their plan and are never split from it.

Root `.md` files: **170 → 52.** 120 files moved here: 44 shipped plans, their
45 companion review logs and sweeps, 29 consumed status docs (MORNING-*,
audits, checklists, pickups), plus `docs/UI-REVAMP-GUIDE.md`, whose
source-of-truth `design/` folder no longer exists, and
`docs/wizard-unification/PHASE-A-INVENTORY.md`.
Nothing was deleted this round, so `deleted-docs.txt` is unchanged; the only
removal is `scripts/espn_output.txt`, an uncited 2026-01 debug dump.

Three files that look archivable were kept at the root on purpose:
`MORNING-2026-08-22-FIXES.md` (§7 is the only list of the open help-system T9
defects), `PLAN-BILLING-ENFORCEMENT.md` + `PLAN-BILLING-INDEX-DEPLOY.md` (the
deploy decision is still Kevin's), and `SECURITY-BARE-ONCALL-CLASSIFICATION.md`
(superseded only in part). Code comments that name an archived plan by its bare
filename still resolve here, per the convention at the top of this file.

Link repointing was done by script from each file's **new** location and checked
two ways: `scripts/verifyArchiveRefs.mjs` (0 unresolved, 0 dangling) and a
whole-repo scan for markdown links whose `.md` target does not exist (0 before,
0 after).
