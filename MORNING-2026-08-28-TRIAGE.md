# MORNING 2026-08-28 — overnight triage takeover

**Session:** overnight triage, worktree `overnight-triage-8347cb`.
**Baseline:** `origin/main` = `f161b51d` at start; unchanged at end (nothing was merged — merging is yours).
**Brief:** *"triage, don't trust"* — HANDOFF was stale, so every claim below was
re-derived from the code or from a command, not carried forward.

---

## 0. THE SHORT VERSION

| | |
|---|---|
| PRs ready for you to merge | **#616, #618, #629, #630, #631** — all reviewed, gates in each body |
| PRs closed with written reasons | **#448** (superseded), **#582** (recommended, left open for you) |
| PR verified and left alone | **#380** — re-checked against code, still accurate |
| Tasks that turned out DONE | help-system **T4** and **all four T9 defects** |
| Dependabot | **6 verdicts below. Nothing merged. Nothing is a clean "safe".** |
| Deploys owed | **ONE Coolify rebuild.** No functions deploy. No rules deploy. |

🛑 **The one thing to do first:** merge **#618**, then trigger the Coolify
rebuild. That unblocks the partial-dues backfill, which has been stuck since
2026-08-27 because the number that decides it could not be displayed.

🛑 **And before ANY deploy decision, read §1.** `HANDOFF.md` on `origin/main`
currently names the WRONG deploy SHA, and the stale answer and the true answer
are opposite: it implies a functions deploy is owed, and one is not. #616 fixes
the doc; §1 has the production measurement that settles it.

---

## 1. Deploy state — and `origin/main`'s HANDOFF is WRONG about it right now

🛑 **READ THIS BEFORE ANY DEPLOY DECISION. The two answers are opposite.**

On `origin/main` today, the tagged `deploy-state:current` claim in **both**
`HANDOFF.md` and `PICKUP-PRESEASON-PILOT.md` says the functions are deployed
from `6d92dc61`. **That is stale**, and the gap is not cosmetic — **24 files and
2,874 insertions** of deployable code sit between `6d92dc61` and `291e949a`:

```
git diff --stat 6d92dc61..291e949a -- functions/ shared/ firestore.rules
```

So the stale claim says *"a functions deploy is owed"* and the true state says
*"it is not"*. **#616 is the PR that moves the tag**, and until it merges the
canonical docs disagree with reality.

### Which one is right was MEASURED, not argued

Two new callables were added between those SHAs:

```
git diff 6d92dc61..291e949a -- functions/src/index.ts | grep "^[+-]export"
+export { deleteNFLEntry } from "./nflEntryDelete";
+export { getPoolDues } from "./nflPoolDues";
```

That makes the verify-by-name check from CLAUDE.md §3 actually work here — the
check that "usually proves nothing because the deploy adds no new callable". Both
are **LIVE in production**:

```
npx firebase functions:list --project gridiron-gamble-uzuqo
│ deleteNFLEntry │ v2 │ callable │ us-central1 │ 256 │ nodejs22 │
│ getPoolDues    │ v2 │ callable │ us-central1 │ 256 │ nodejs22 │
```

**Therefore the deployed source is at or after `291e949a`, and `6d92dc61` is
wrong.** #616's original source-timestamp evidence agreed; this is a second,
independent method, and it is the stronger one.

> This section originally stated the newer SHA and tagged it
> `deploy-state:ignore`. **Codex holed that as a P1** — tagging it made
> `docs-state-invariants` pass *instead of detecting the disagreement*, so an
> operator reading the canonical handoff could still deploy from stale state.
> That was right, and it is the exact failure the guard exists to catch. The
> contradiction is now stated rather than suppressed, and settled with evidence.

### What is actually owed

```
git diff --stat 291e949a..origin/main -- functions/ shared/ firestore.rules
```

is **empty** across all eleven merges since (#617, #619–#628). Nothing deployable
has moved.

- ❌ **No `npx firebase deploy` is owed** — given the measurement above.
- ❌ **No rules deploy is owed.** `firestore.rules` is unchanged since #579.
- ✅ **ONE Coolify rebuild is owed, and it now covers thirteen merges** — #614 → #628.

**Two of the thirteen are not cosmetic**, which is why the rebuild is not
optional:

- **#626** — a live Sentry fix (`c810a001`): bracket standings read `publicProfiles`.
- **#628** — **wrong rules copy shown to members**: the opposite auto-survive rule, and a rebuy window a week short.

---

## 2. `nflDeepScoreSweepJob` — read, not armed. YOUR DECISION.

You said reporting the count was fine and arming was yours. Read tonight from
the job's own log (read-only, nothing was changed):

```
[nflDeepScoreSweepJob] 7d sweep: 1 slate(s), 0 correction(s), 0 game(s) written.   2026-08-26 15:30Z
[nflDeepScoreSweepJob] 7d sweep: 1 slate(s), 0 correction(s), 0 game(s) written.   2026-08-27 15:30Z
```

With the 08-25 run already recorded in HANDOFF, that is **three consecutive days
at `0 correction(s)`** — the low-risk signal you were waiting for.

**My recommendation: still do not arm it, and the reason is not caution.**
`reportStatCorrections` **pages in dry run**, so a real correction reaches you
without any write; the lookback is 7 days (configurable to 30), so arming
*reactively* still catches it. Meanwhile `dryRun:false` writes **all 20 games of
the slate every day** — the live path writes every `freshGame`, not just changed
ones. Arming today buys nothing and costs 20 writes/day.

**Arm when a correction actually pages.** Either way it is your call.

---

## 3. What I did, PR by PR

### ✅ [#616](https://github.com/kstruck/MMPoolsV3/pull/616) — HANDOFF truth pass — READY TO MERGE

Rebased onto `f161b51d` and rewritten as a truth pass. Its top box listed
**#611/#612/#613 as open** — all three are merged.

The new box records the deploy-state measurement above, the Coolify list, why the
dues backfill is blocked, the sweep counts, and a verdict for every open PR.
`PICKUP-PRESEASON-PILOT.md` §2 is kept in step. `PLAN-CO-COMMISSIONERS.md` §7
still said work "IN A PR" that shipped on 2026-08-16 — fixed.

**Gates:** `npx vitest run` 2969/157 green (incl. `docs-state-invariants` 84/84);
lint 1881/0, delta zero. Docs-only, so the four functions-scoped gates are
skipped and named in the PR body. **1 codex round, clean.** CI 9/9.

### ✅ [#618](https://github.com/kstruck/MMPoolsV3/pull/618) — Run Log counters — READY TO MERGE, DO THIS ONE FIRST

It was `BEHIND` only. I merged `origin/main` into it locally — **no conflicts** —
and re-ran every gate **on the merged tree**:

| Gate | Result |
|---|---|
| `npx vitest run` | **2978 passed / 158 files / 0 failed** (main alone is 2969, so the claimed +9 checks out) |
| `npx tsc -b` | clean |
| `npm run build` | clean, 8.92s |
| `npm run lint` | **1881 / 0 — delta zero** |

**Mutations re-run on the merged tree, 3/3 still red** (dropping `countsStamped`,
reverting a loop to a hand-kept list, summing only pre-declared keys).

**One named residual, non-blocking** and written on the PR: the counter-parity
test covers two of the three migrations. `backfillPublishedWeeks` is covered by
the "exactly three `addReportPage` calls" assertion but not by the
server-vs-client declaration check, because the extractor matches `name: 0,` and
that report opens `poolsScanned: snap.docs.length`. The consequence is small and
is **not** the bug being fixed: a new counter there would still be summed and
would still reach the Run Log; it would only be missing from an *empty* run.

**1 further codex round on the merged diff, clean.**

### ✅ [#629](https://github.com/kstruck/MMPoolsV3/pull/629) — NEW — the only part of #582 that was not already shipped

**#582 is ~95% superseded.** Its rebase **skipped its first commit as "previously
applied"**, then conflicted on all four remaining files. Reading `main` explained
both: commit 1 shipped as **#568**, commits 2–3 as **#578**. `main`'s prose is
also *better* — it names #568 as the PR that could only gate the sheet — so
rebasing #582 would have overwritten accurate history with an earlier draft.

Two things it carried were genuinely absent from `main`, and they are #629:

1. **`hasReportedScores` existed TWICE** — a private, byte-identical copy in
   `pickemResult.ts` *and* in `pickOutcome.ts`. Two mirrors of one server rule is
   two places to fix when the server rule moves, and the failure is silent: the
   copy that did not move keeps returning a plausible answer.
2. **Nothing pinned `picksGridCell`** — the surface the defect actually reached.
   A future edit that re-derived the result inside the cell would pass both
   existing suites and still print a confident W or L for a game the scorer
   refuses to grade.

**Gates:** vitest **2972** (+3), tsc clean, build clean, lint **1881/0 delta
zero**. **Mutation-tested 3/3.** **1 codex round, clean.** CI **9/9 green**.

**🔴 DECISION FOR YOU: close #582?** My recommendation is **yes** — everything
else in it is already live behaviour on `main`, and the triage comment on the PR
lists each commit and where it shipped. I left it open because closing it is
your call, not mine.

### ✅ [#631](https://github.com/kstruck/MMPoolsV3/pull/631) — NEW — dependabot never watched `functions/`

The most valuable thing tonight's dependabot task turned up, and it was not one
of the six bumps. Full write-up in §5. One YAML entry plus a guard that
DISCOVERS manifests recursively rather than listing them — a hand-kept list is
the same defect one layer up.

**Codex round 1 holed my first version** (the walker was depth-1, so a future
`functions/tools/package.json` would slip through) — fixed, and the correction is
written into the walker's own doc block rather than quietly applied. **Round 2
clean. Mutation-tested 4/4.**

**Gates:** vitest **2979** (+10), tsc clean, build clean, lint **1881/0 delta
zero**.

### ✅ [#630](https://github.com/kstruck/MMPoolsV3/pull/630) — NEW — five toggle switches had no accessible name

Found while scoping the label work. Five components each hand-rolled the same
toggle: a `<label>` wrapped around nothing but a visually-hidden checkbox and a
decorative track, with the words a sighted person reads in a **sibling** heading,
outside the label.

A `<label>` with no text names nothing, so **all five announced as a bare
"checkbox, unchecked"** — which setting was being toggled was unknowable without
sight. eslint already knew; the warnings were inside the 1881 nobody reads.

`ui/Switch.tsx` is now the one home, with `label` a **required** prop. It also
unblocks the "zero raw `<label`" half of PLAN-HELP-SYSTEM T5–T7 for four files.
`UserProfile.tsx`'s sixth toggle is deliberately exempt (its label carries
visible text, so it is already named) with the reason written into the invariant.

**Gates:** vitest **2981** (+12), tsc clean, build clean, **lint 1872 — delta
−9**, broken down per rule: `label-has-for` 249→245, `label-has-associated-control`
198→193, nothing else moved. **All nine removed warnings are the defect being
fixed.** **Mutation-tested 4/4.** **1 codex round, clean.**

⚠️ **The lint baseline for the next PR is 1872, not 1881**, if #630 merges.

### ✅ [#448](https://github.com/kstruck/MMPoolsV3/pull/448) — CLOSED, one line salvaged

| Its three edits | Verdict |
|---|---|
| `HANDOFF.md` — co-commissioners live 08-16 | **Already recorded** at `HANDOFF.md:1463`. |
| `PLAN-MULTI-ENTRY.md` §7 | **Would have REGRESSED it** — that header now reads "SHIPPED AND LIVE 2026-08-25". |
| `PLAN-CO-COMMISSIONERS.md` §7 | **Genuinely unrecorded — salvaged into #616.** |

It was also `CONFLICTING`, so it could not have merged as it stood.

### ✅ [#380](https://github.com/kstruck/MMPoolsV3/pull/380) — verified, still accurate, ready to merge

README-only, `MERGEABLE`, additive; `README.md` has not moved on `main`, so
"BEHIND" was the only thing wrong with it. Every named feature was checked
against **code**, not docs — deep-sweep job, rescore queue, fenced scoring lease
(`functions/src/lib/scoringLease.ts`), feed snapshots, `lockNFLSpreadsJob`,
`src/pages/PlayerProfile.tsx`, `setPaidStatus` as the canonical writer. All
present. Evidence table posted as a comment.

**Not fixed by me:** it still says nothing about the August wave (help system,
header regroup, partial dues, co-commissioners). Separate catch-up, not a reason
to hold it.

---

## 4. Task 4 turned out to be DONE — all five items

You asked for help-system **T4** and **the four T9 defects**, both written up in
`MORNING-2026-08-22-FIXES.md` §7, and told me to verify that doc before believing
it. **I did, and five of the items it lists have shipped since it was written.**

| Item | Status | Evidence |
|---|---|---|
| (a) `pointsPerPick` / `primetimeBonus` inert | **CLOSED — deleted** | You ruled it 2026-08-22 in `PLAN-DELETE-INERT-PICKEM-SCORING.md`. Controls and member rows gone; `coverage-allowlist.ts:119` carries the PERMANENT row. |
| (b) Pick'em proxy pick never worked | **CLOSED** | `src/utils/proxyPickPayload.ts` keys per pool type and refuses an unkeyable slate *before* the confirm dialog. Tested. |
| (c) "List Pool Publicly" toggle did nothing | **CLOSED** | `publicListingUpdate()` writes both halves from one call, with a comment naming this defect. Tested. |
| (d) `HelpCopy.template` can never render | **CLOSED** | `TopicScope` carries `settings`; `registry.ts:45` says so where it used to be impossible. |
| **T4** — 35 raw `<label>` in `NFLManagerView.tsx` | **CLOSED AND GUARDED** | `grep -c '<label'` returns **0**; `tests/help-manager-label-coverage.test.ts` fails the build if one returns. |

`MORNING-2026-08-22-FIXES.md` §7 is corrected in the docs PR below, with the
original struck through rather than deleted — it is a dated record.

### What IS still open on the help plan

**T5, T6, T7, T8, T15, T16.** The **~270 raw `<label>` across `src/`** you
mentioned are theirs, not T4's. Heaviest files: `BracketPoolDashboard.tsx` (23),
`admin/SuperAdminBillingPanel.tsx` (20), `WizardStepReminders.tsx` (18),
`SuperAdmin.tsx` (18).

**I did not start T5, on purpose, and here is the reason.** Its markup half is
mechanical and I proved it is cheap: **13 of 14** field ids in the legacy Squares
admin wizard (`name`, `managerName`, `contactEmail`, `paymentHandles`,
`paymentInstructions`, `isPublic`, `branding.*`, `reminders.*`) **already resolve
for a `SQUARES` commissioner** — the copy exists and is simply not wired up. But
its *other* files (`WizardStepPayouts`, `WizardStepReminders`) are Squares
rule-variation and charity fields with **no topics at all**, and placing new
topics needs a page/placement decision that belongs to the plan's author, not to
a guess made at 2am. **That is a decision for you, listed in §6.**

What I did instead was the one uncontested prerequisite: **#630**, which gives
the toggle a single home so four of T5's files can reach "zero raw `<label`" at
all. A switch genuinely needs a `<label>`; the rule cannot be met by deleting it.

---

## 5. Dependabot — six verdicts, nothing merged

Six open, **all major bumps**, exactly as you expected. Each was built and tested
in an **isolated worktree** (never the shared tree) with `npm ci` → `npm --prefix
functions ci` → `copy-shared.mjs` → `tsc -b` → `build` → `vitest` → `functions
test`. **Exit codes were the gate, not "the commands ran". Nothing was merged and
no auto-merge was proposed** — `mmp-loop-babysit-deps` says a major always needs a
human, and auto-merge is off regardless.

**A per-PR comment with the full evidence is posted on each PR.**

| PR | Bump | Verdict | What actually breaks |
|---|---|---|---|
| [#463](https://github.com/kstruck/MMPoolsV3/pull/463) | lucide-react 0.556 → **1.31** | 🔴 **NEEDS WORK** | 1.x **removed the brand icons**. 7 × `TS2305` — `Twitter`, `Facebook`, `Instagram`, `Linkedin`. Build fails. |
| [#462](https://github.com/kstruck/MMPoolsV3/pull/462) | framer-motion 12.43 → **13.1.1** | 🟢 **GREEN, confirmed ON CURRENT MAIN** | Every gate clean: tsc 0, build 0, vitest **2969/2969**, functions **2138/2138**, lint delta zero. |
| [#401](https://github.com/kstruck/MMPoolsV3/pull/401) | vite 7.3 → **8.2.2** | 🔴 **NEEDS WORK** | Vite 8 ships Rollup 5, which **removed the object form of `manualChunks`**. `vite.config.ts:37`, `TS2769`. |
| [#304](https://github.com/kstruck/MMPoolsV3/pull/304) | firebase-admin 13.10 → **14.3** | 🟡 **GREEN, BUT THE GREEN IS EMPTY** | Every gate clean on current main — and **nothing tests it**: `vite.config.ts:22-23` aliases `firebase-admin` to a mock. Also bumps the wrong copy; see below. |
| [#302](https://github.com/kstruck/MMPoolsV3/pull/302) | typescript 6.0 → **7.0.2** | 🔴 **NEEDS WORK** | `TS5102` — `baseUrl` **removed**. The repo predicted this in a comment: *"Revisit before TS 7.0."* |
| [#300](https://github.com/kstruck/MMPoolsV3/pull/300) | tailwindcss 3.4 → **4.3.3** | 🔴 **NEEDS WORK** | PostCSS plugin moved to `@tailwindcss/postcss`. Three files change. **`tsc -b` passes** — it is a CSS failure, so a green typecheck proves nothing here. |

### The two greens were RE-RUN on current `main`, not trusted from the branch

Those branches are 49–175 commits behind, so "green on the branch" is not "green
on what would actually merge". Both were re-tested by applying the bump on top of
`f161b51d`:

| | tsc | build | root vitest | functions test | lint |
|---|---|---|---|---|---|
| framer-motion 13.1.1 | 0 | 0 | **2969/2969** | **2138/2138** | 1881/0, delta zero |
| firebase-admin 14.3.0 | 0 | 0 | **2969/2969** | **2138/2138** | — |

Both installs were confirmed in place by reading the installed version back out of
`node_modules`, and the worktree was restored to `origin/main` afterwards.

🛑 **#304's green is close to meaningless, and that is the finding.**
`vite.config.ts:22-23` aliases **both** `firebase-admin` and
`firebase-admin/firestore` to `tests/mocks/firebase-admin.ts`, so the four test
files that import it get the **mock**. The suite would be just as green with the
package uninstalled. Its real consumers are the `scripts/*.mjs` ops scripts, and
**no test runs any of them.**

### The four breakages were each re-verified against CURRENT `main`

These branches are **49–175 commits behind**, so a failure on one could have been
stale. None is:

- `ShareModal.tsx:5` and `UserProfile.tsx:14` still import the four lucide brand icons.
- `vite.config.ts:36-44` still uses the `manualChunks` **object** form.
- `tsconfig.app.json:21` still carries `"ignoreDeprecations": "6.0"` + `baseUrl`.
- `postcss.config.js` still names `tailwindcss` as the plugin; `src/index.css:1-3` still uses the three `@tailwind` directives.

### 🛑 THE REAL FINDING — and it is not any of the six

**`.github/dependabot.yml` lists `directory: "/"` and nothing else, and
`directory` is NOT recursive.** Cloud Functions — **the code that actually runs in
production** — has never been watched.

| | declared | installed |
|---|---|---|
| `functions/` firebase-admin | `^12.7.0` | **12.7.0** |
| root firebase-admin | `^13.6.1` | **13.10.0** |
| `functions/` typescript | `^5.0.0` | — |
| root typescript | `~6.0.3` | — |

**#304 bumps the ROOT firebase-admin to 14 — widening that split to two majors
while production stays on 12.** The root copy is used by ops scripts and four
test files; it is **not** what `firebase deploy` ships.

CI's `npm audit` was already fixed to run in **both** directories after the #240
`brace-expansion` incident — so a `functions/` vulnerability is **detected today
and produces no PR**. The fix has to be found and written by hand.

This is the repo's **third** instance of root-scoped tooling mistaken for
repo-scoped tooling (CLAUDE.md §2b's audit, §2e's `npx tsc -b`), so it ships as a
guard over the shape: **[#631](https://github.com/kstruck/MMPoolsV3/pull/631)**.
Writing that guard found a **third** manifest — `shared/package.json` — which is
exempt with a written reason and a drift assertion instead.

### ⚠️ Three test failures that were NOT any dependency's fault

`tests/addon-purchase.test.ts` failed identically under **three different** bumps,
which is the tell. It reads `functions/src/stripe.ts` off disk and asserts on
multi-line `\n` literals. `.gitattributes` exists to keep that working on Windows,
but **`git checkout` only renormalises files it rewrites** — so a worktree first
materialised on a branch predating `.gitattributes` keeps CRLF in every unchanged
file afterwards. Measured:

```
functions/src/stripe.ts   dependabot worktree: 1871 CR bytes
functions/src/stripe.ts   clean worktree:         0 CR bytes
```

Not a defect in any bump, and not a defect in the repo — a worktree-reuse trap
worth knowing before it reads as breakage again.

---

## 6. 🔴 DECISIONS I NEED FROM YOU

Every one of these is also in my final chat message, so you do not have to open
this file to answer.

**D1 — Merge order.** Recommended: **#618 → Coolify rebuild → #616 → #629 →
#630 → #631 → #380.** They touch disjoint files, so any order works; this one is
by value.

⚠️ **If #630 merges, the lint baseline becomes 1872, not 1881.** #618 first because it is the block on the dues backfill; the
rebuild next because it is owed for thirteen merges either way.
*On "approve as recommended" I do nothing — merging is yours.*

**D2 — Close #582?** Recommended: **yes.** ~95% of it shipped as #568 and #578;
the residual is #629 and the triage comment on #582 shows commit-by-commit where
each part went. *Nothing is lost by closing it.*

**D3 — `nflDeepSweep` stage 2.** Recommended: **do not arm yet.** Three days at
`0 correction(s)`, but dry run already **pages**, so arming buys nothing today
and costs 20 writes/day. Arm reactively when a correction pages.

**D4 — T5 scope.** The blocker is content, not markup. Recommended: **do the
Basics/Branding slice next** (13 of 14 ids already resolve — pure wiring, no new
copy), and treat the Squares rule-variation and charity fields as a **separate
content ticket** that needs your call on where their topics live. *Alternative:
allowlist them with a T-number and wire the markup now — faster, but it leaves
`?` buttons that explain nothing.*

**D5 — Dependabot: merge [#631](https://github.com/kstruck/MMPoolsV3/pull/631)?**
Recommended: **yes, and expect a batch of PRs on Monday.** It makes the deployed
surface visible for the first time; `functions/` is behind on several majors, so
the queue will not be short. The limit there is 5, not the root's 10, on purpose.
*If you would rather not have the queue right now, hold it — nothing degrades by
waiting, it just stays invisible.*

**D6 — the six bumps themselves.** Recommended: **fix none of them tonight, and
take them in this order when you do** — #462 (**green on current main, and the
only one of the six that is**) → #304 (only after D5, since it widens a split
#631 exists to close, and its green tests nothing) → #401 (one config rewrite) →
#463 (two files, needs replacement icons) → #302 (config only, but pairs with the
`functions/` TS 5 gap) → #300 (three files, and the failure mode is a GREEN build
with no styles). Full evidence is commented on each PR.

---

## 7. Things I did NOT touch, as instructed

- `firebase deploy`, Coolify, any production Firestore write, any `dryRun` /
  `enabled` flag, and **every merge**.
- **#613 / PLAN-COST-CONTROLS D2–D5**, and the **#521 / #518** drafts — plans
  blocked on your sign-off, no code written.
- **`nflDeepSweep` stage 2** — log read only, as you allowed.

## 8. Two things worth knowing for the next session

1. **A fresh worktree fails 7 test files before you run `copy-shared`.**
   `npx vitest run` reports `Cannot find module '../shared/schemas/…'` because
   `functions/src/shared` is generated, not committed. Run
   `node functions/scripts/copy-shared.mjs` first. This is the setup step, not a
   defect, and it is why "2143 passed, 3 failed" appears in older PR bodies.

2. **A reused worktree can carry CRLF across branch switches, and it looks like a
   test failure.** `git checkout` only renormalises files it *rewrites*, so a
   worktree first materialised on a branch that predates `.gitattributes` keeps
   CRLF in every unchanged file afterwards. Measured tonight:
   `functions/src/stripe.ts` had **1871 CR bytes** in the dependabot worktree and
   **0** in mine, and that alone accounts for the three `tests/addon-purchase.test.ts`
   failures that appeared under three different dependency bumps. Details in §5.
