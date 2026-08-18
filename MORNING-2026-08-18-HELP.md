# MORNING 2026-08-18 (help system) — T0 and T1 merged, T2 is next

This file continues `MORNING-2026-08-18.md` for a different effort and supersedes nothing in it.

That doc remains the entry point for the PLAN-PAYMENT-LEDGER T2 work; this one
covers only `PLAN-HELP-SYSTEM.md`. Read whichever matches what you are doing.

> 🔴 **ONE THING NEEDS YOU: the frontend needs a Coolify redeploy.** T1 (#475)
> is the first help work that changes the shipped bundle, and Coolify has no CLI
> path from this machine. Nothing else here is blocking. Steps in §7.

**Two PRs merged: #472 (T0) and #475 (T1).** Everything below is detail.

---

## 1. The headline

- **`PLAN-HELP-SYSTEM.md` §6 is signed.** K1–K13 adopted exactly as each
  Recommendation column reads, on Kevin's 2026-08-17 *"start building"*. The
  board memo's *"build none during the live weeks"* is overridden by that; the
  memo stays on file as the dissent.
- **T0 merged** — `0090af09` (PR #472). The content model and its guards.
- **T1 merged** — `a1ee5faa` (PR #475). The first thing on screen.
- **T2–T16 unstarted.** Order is fixed: T2 next, then T9 (NFL Pick'em content —
  this week's invites are Pick'em), then T4, T3, T10/T11.

## 2. What T1 shipped

The tooltip, the scope it resolves through, and the copy for the whole create
wizard.

| File | What |
|---|---|
| `src/components/ui/HelpTip.tsx` | The `?` affordance. Takes an id and **nothing else**. Portalled `role="tooltip"` bubble, positioned from `getBoundingClientRect` with a scroll/resize re-measure. |
| `src/help/scope.tsx` | `HelpScopeProvider` / `useHelpScope`, plus the typed `HelpPanelContext` the click reads. Published by `WizardShell`, `PoolRoute` and `AdminRoute`. |
| `src/help/content/wizard-shared.ts` | 30 topics, 120 placements — every shared wizard step, and the 14 hint strings that used to live at call sites. |
| `src/help/content/wizard-pages.ts` | The seven `/create/*` help pages. |
| `src/components/wizard/fields.tsx` | `helpId` defaulting to `name`; **the `hint` prop is gone**. |
| `src/utils/publicListing.ts` | New. See the production defect in §3. |
| `tests/help-ui-coverage.test.ts` | 27 tests. The primary coverage guard. |
| `src/__tests__/helpTip.test.tsx` | 22 tests. The rendered contract and the placement maths. |
| `src/__tests__/browsePublicListing.test.ts` | 7 tests. Regression cover for §3. |

Every number in that table was measured on 2026-08-18 — test counts with
`npx vitest run --reporter=json`, registry counts by reading `helpRegistry` in a
throwaway test. None was read off the diff.

**Three of them were wrong in the first draft**, all because I counted by eye:
helpTip 23 (really 22) and browsePublicListing 8 (really 7), both caught by
qodo, and **topics 32 (really 30)**, caught by codex on the round §2b required
after the qodo fixes. The merged PR #475 body carries the same wrong "32
topics"; nothing depends on it, but it is wrong there and this is the
correction. The lesson is the cheap one: a count nobody ran is a guess.

**What a commissioner now sees:** a small `?` beside every field on all seven
create wizards that has copy written. Hover or focus shows the short copy; a
tap pins it (there is no panel to open yet — that is T2). Fields whose copy
lands in T9–T13 render no `?` at all, and each one is named in
`WIZARD_FIELD_ALLOWLIST` with its ticket.

**24 schema-allowlist rows and 7 route rows came out.** That emptying is the
ticket's "done when", and the two counts moving in opposite directions is how
you can tell coverage is real.

## 3. The production defect T1 uncovered

**qodo #11, and it is the reason this PR is worth more than its diff.**

`BrowsePools.tsx` treated **every** `NFL_PLAYOFFS` pool as public:

```ts
const isPublic = isBracket ? ... : (isPlayoff ? true : ...)
```

So a host who unticked *"List this pool publicly"* on a playoff pool was still
listed in Browse — while `buildPlayoffPayload` had been faithfully persisting
their choice to both `isPublic` and `settings.isListedPublic` the whole time.
The host had no way to tell.

It surfaced **only because T1 wrote copy promising the option works.** The copy
was right about what the option means and the code was wrong, so the code moved:
the predicate is now `src/utils/publicListing.ts` with 7 regression tests.

It can only ever hide a pool whose host explicitly asked for it to be hidden —
every wizard defaults `isPublic` to `true`, and a legacy playoff pool carrying
neither field stays listed. **It is listing, not access:** a share link still
works either way, and Firestore rules govern reads. Nothing was deployed, so
this is live only after the Coolify redeploy in §7.

## 4. Review — what it cost and what it caught

| Reviewer | Rounds | Findings | Rejected |
|---|---|---|---|
| codex | 3 | 0 | — |
| qodo | 1 (reported, settled) | 8 | 2 |
| my own read | — | 4 | 0 |

**Three codex rounds, all clean — and that was not the review.** Self-review
after round 1 found four defects codex did not, three of them the same class:

- **`isPublic` copy said "Off by default".** All seven wizards default it to
  `true`.
- **`lockDate` copy said "defaults to Wild Card kickoff".** Nothing sets that —
  the field is optional, the wizard default is empty, and an unset value renders
  as "Date TBD". **The hint I was moving was already wrong**, and had been for
  as long as it existed.
- **The four reminder toggles named no default.** All four default to on.
- The tooltip re-added its scroll listeners on every scroll frame.

Voice rule 5 says *name the default, and name it exactly*, and nothing checked
that the name was right. Now something does: `help-ui-coverage` pins each "by
default" sentence to the wizard line that makes it true, and asserts `lockDate`
claims none.

qodo's own calibration held exactly as `CLAUDE.md` §2b predicts — **4 of 4 bug
findings valid, both pure-style findings rejected** (snake_case in a camelCase
repo; an `sr-only` span that `aria-label` would suppress anyway, in a directory
with zero `sr-only` uses). Both rejections are written on the PR with evidence.

Its sharpest non-bug finding was **#15: the new coverage guard did not guard.**
It accepted a help id resolving under *any* pool type, where `HelpTip` resolves
under the one type `WizardShell` publishes — so a Survivor-scoped topic would
have satisfied coverage for a Bracket-only control showing no tooltip. It now
derives each wizard's type from its `<WizardShell poolType=…>` and import graph.
That is the fourth guard in this repo holed the same way.

**No §2c overage.** Three rounds against a cap of ten, so the new exception
Kevin ruled on 2026-08-18 did not fire and there is nothing to record under it.

## 5. Corrections written into the plan

`PLAN-HELP-SYSTEM.md` §3 D2 now carries what T1 measured against it. The one
that matters for the next ticket:

**`ui/FieldLabel` already exists.** It is exported from
`src/components/ui/Field.tsx` and used by `ContactPage`, `HowItWorksPage`,
`SupportPage` and `PlayoffSettingsModal`. The plan told T1 to create
`src/components/ui/FieldLabel.tsx`, which would have collided with it in the
`ui` barrel. **T4–T6 must EXTEND that component, not add a second one.** T1 did
not touch it — nothing in the wizard uses it, and adding an unused prop is
speculation.

Also corrected: there were **14** literal hints, not 13; `HelpTip` renders
nothing for an unknown id in dev as well as prod (the plan said "throws in dev",
which would break the wizard for every field whose copy is not written yet); and
the tooltip footer reads "More in Help" rather than a tap/click variant, because
choosing between those needs a render-time media query and this app is
prerendered.

**T1 also added the seven `/create/*` help pages**, nominally T2's column — the
registry refuses a topic nothing places, and a placement needs a page. T2 still
owns route→page matching, the panel, per-step pages and search.

**Three allowlist rows were re-ticketed** after measuring that they have no
create-wizard control: `contactPhone` → T4, both `settings.payouts.bonuses.*`
rows → T6.

## 6. What I could not verify — stated, not skipped

1. **No interaction tests.** This repo has no jsdom and no
   `@testing-library/react`; `billingGate.test.tsx` uses `renderToStaticMarkup`
   and T1 follows it. So **hover, blur and Escape are not exercised.** What is:
   the trigger element and its ARIA, the label-sibling rule, scoped resolution
   across pool types and audiences, an unknown id rendering nothing, and the
   placement maths. T2 needs a DOM for the panel and the `?` shortcut regardless,
   so the dev dependency is bought once, there. I did not want to add jsdom to a
   lockfile a parallel session may be touching.
2. **No browser walkthrough.** `/create/*` is gated on a signed-in user and I
   will not sign in. I confirmed the app boots and renders with the change on a
   dev server from the T1 worktree; **the tooltip itself is unproven in a
   browser.** Your redeploy in §7 is the first real look at it. T15 is the
   formal walkthrough ticket.

## 7. Runbook — do these in order

### Step 1 — pull, so your checkout has both merges

Open a terminal. You do not need to be in any particular folder.

```bash
git -C D:/march-melee-pools pull
```

**You should see** either a list of updated files or `Already up to date.`

Then confirm T1 is actually in what you just pulled:

```bash
git -C D:/march-melee-pools log --oneline --grep="PLAN-HELP-SYSTEM T1" -1
```

**You should see** one line ending `(#475)`. **If you see nothing**, the pull did
not bring T1 down — tell me before deploying. **If the pull errors** about local
changes, run `git -C D:/march-melee-pools status` and tell me what it says; do
not force anything.

> ⚠️ **Do not check for the exact commit `a1ee5faa`.** By the time you read this,
> `main` has moved past it — this document itself is a later commit. What
> matters is that the revision being deployed CONTAINS T1, which is what the
> `--grep` above asks. (Pinning a runbook to a SHA that the runbook's own merge
> invalidates is a mistake this repo has made before; qodo caught this one
> before it reached you.)

### Step 2 — redeploy the frontend in Coolify ⚠️ THE ONE THING THAT NEEDS YOU

This is the first help change that alters the shipped bundle, so nothing you see
in production has tooltips until this runs. Pushing to `main` does **not**
auto-deploy the frontend.

1. Open your browser and go to the **Coolify dashboard**.
2. Select the **`www` / march-melee-pools frontend** application (the same one
   you redeploy after any frontend PR — not a Firebase Function).
3. Confirm the branch shown is **`main`**. Do **not** try to match a specific
   commit — `main` moves, and the newest commit on it is the right one. If the
   commit shown looks stale, click **Refresh** or reload the page first.
4. Click **Redeploy** (some versions label it **Deploy**).
5. **You should see** the build log start streaming, then finish with a success
   state after roughly 2–5 minutes.
6. **If the build fails**, copy the last ~30 lines of the log and send them to
   me. Do not retry more than once — the same failure twice is a real failure.

### Step 3 — confirm it worked, in about 60 seconds

1. Go to **https://marchmeleepools.com/create/pickem** (sign in if asked).
2. On the first step you should see a small **`?` icon** beside **Pool name**,
   **Your name (commissioner)**, **Contact email** and **List this pool
   publicly**.
3. **Hover over the `?` beside "List this pool publicly".** A small dark bubble
   should appear reading *"Lists your pool on the public Browse page so anyone
   can find it. On by default…"*.
4. **On your phone**, open the same page and **tap** a `?`. The bubble should
   appear and stay until you tap it again.
5. **If no `?` icons appear at all**, the deploy did not pick up the new build —
   hard-refresh once (Ctrl+Shift+R), and if they are still missing, tell me.
6. **If a `?` appears but hovering shows nothing**, tell me which field — that is
   a real defect and I want the field name.

### Step 4 — the playoff privacy fix, worth one look

Because §3 changed who appears in Browse:

1. Go to **https://marchmeleepools.com/browse**.
2. Set the type filter to **Playoff**.
3. **You should see** the same playoff pools you saw before — unless one of them
   had public listing turned off, in which case it is correctly gone now.
4. **If a pool you expected to be public has vanished**, tell me its name; that
   means its stored setting disagrees with what you intended, and I will look.

### Step 5 — nothing else needs you

No `functions/` deploy, no `firestore.rules` deploy, no indexes, no prod data
migration. T1 touched none of them.

## 8. What is NOT done

- **T2–T16 unstarted.** There is still no Help panel, no `?` keyboard shortcut,
  no header button, no search, and no glossary on screen — T2 is all of that.
- Only the create wizards have tooltips. Manager settings, pick sheets, rules
  pages and the admin surface have none (T4–T7).
- The per-pool-type rules copy (survivor strikes, bracket scoring, squares grid,
  margin payout mode) is unwritten — T9–T13. Every one of those fields is named
  in `WIZARD_FIELD_ALLOWLIST` with its ticket.

## 9. Worktrees

- `.claude/worktrees/help-t1-helptip` — T1 branch, merged. Removable.
- `.claude/worktrees/help-t1-docs` — this doc. Removable once merged.
- `.claude/worktrees/help-system-impl-4ebe5f` — untouched, no commits.
