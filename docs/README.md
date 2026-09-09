# docs/ — where every project document lives

Since 2026-09-09 the repo root carries only four documents: `README.md` (product),
`CLAUDE.md` (session entry point), `HANDOFF.md` (live state) and `CONTEXT.md`
(glossary). Everything else is filed here by **purpose**, so a reader can tell
from the folder whether a document is live, an operator procedure, or history.

Check the claim rather than trusting it — tracked markdown at the root, nothing
deeper:

```bash
git ls-files '*.md' | grep -v /
```

Expected output, four lines: `CLAUDE.md`, `CONTEXT.md`, `HANDOFF.md`, `README.md`.
A fifth line means something was dropped at the root instead of filed below.

| Folder | What goes here | Lifecycle |
|---|---|---|
| `plans/` | `PLAN-*.md` whose work is still **open** — unsigned, awaiting a deploy decision, or with phases not started — plus their `-REVIEW-LOG.md` and `-SWEEPS.md` companions. **New plans go here.** | Moves to `archive/` when the plan is shipped, closed, or superseded. Companions move with it. |
| `runbooks/` | Operator procedures someone follows step by step: `RUNBOOK-*.md`, the annual/season runbooks, and `PICKUP-PRESEASON-PILOT.md` (an authoritative deploy-state doc — `tests/docs-state-invariants.test.ts` reads it by this path). | Living until superseded. |
| `backlog/` | Open lists of work and unfixed findings: `TOMORROW-TASKS.md`, `SQUARES-BACKLOG.md`, the two `SECURITY-*.md` notes, and `MORNING-2026-08-22-FIXES.md` (§7 holds the open help-system T9 defects). | Each entry dies when its list empties. |
| `decisions/` | `DECISION-LOG.md` and the standalone `DECISION-*.md` records. | Append-only. |
| `adr/` | Architecture decision records, numbered. | Append-only; mark superseded, never delete. |
| `archive/` | Shipped plans, consumed session docs (`MORNING-*`), audits, checklists. **Nothing here is a source of current state.** `archive/README.md` has the criterion and the guard. | Permanent. Deletions are recorded in `archive/deleted-docs.txt`. |
| loose files | Evergreen subsystem references (`NFL_POOLS_README.md`, `bracket-pool-architecture.md`, `help-voice.md`, `UI-REVAMP-GUIDE.md`, `annual-bracket-setup-runbook.md`, `nfl-spreads-runbook.md`, `wizard-unification/`). | Living; cited by full path from code and skills, so they stay put. |

## Citing a document

Code comments, skills, and older docs cite most of these by **bare filename**
(`PLAN-HELP-SYSTEM.md`, `NOTES-WAVE2`). Resolve a bare name against the folders
above, in this order: `plans/`, `runbooks/`, `backlog/`, `decisions/`, then
`archive/`. A markdown **link** must use the real relative path — the archive
guard (`scripts/verifyArchiveRefs.mjs`, run by `tests/archive-refs-invariants.test.ts`
in CI) fails a link to an archived doc that does not resolve, and fails any
reference to a doc that was deleted.

## Moving or deleting a document

- **Shipped?** `git mv docs/plans/PLAN-X*.md docs/archive/`, then run
  `node scripts/verifyArchiveRefs.mjs` and repoint the links it names.
- **Deleting?** Only when nothing cites it — and add the filename to
  `archive/deleted-docs.txt`, or the verifier fails and tells you to.
- A `git mv` into any folder under `docs/` is a move, not a deletion; the guard
  understands that.
