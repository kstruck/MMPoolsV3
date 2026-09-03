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
merges, so without the manifest invariant 2 would quietly become a no-op on
`main` and a re-added reference to a long-deleted doc would pass.

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
