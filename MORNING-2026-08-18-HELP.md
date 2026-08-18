# MORNING 2026-08-18 (help system) — T0, T1, T2 merged, deployed and prod-verified

This file continues `MORNING-2026-08-18.md` for a different effort and supersedes nothing in it.

That doc remains the entry point for the PLAN-PAYMENT-LEDGER T2 work; this one
covers only `PLAN-HELP-SYSTEM.md`. Read whichever matches what you are doing.

> ✅ **NOTHING NEEDS YOU. This whole runbook is DONE.** You took §7 step 2's
> option A, redeployed `www`, and verified the panel and the privilege guard on
> the live site. Kept as the record of what shipped and what was checked — the
> steps below are history, not a to-do list.
>
> ⚠️ **What that decision leaves owed: T16.** You knowingly took T15 before it, so
> the `?` shortcut is live resting on the CSS-class fallback for ~35 overlay
> shells. See §5.

**Three PRs merged: #472 (T0), #475 (T1) and #477 (T2).** You already deployed and
verified T1 — tooltips on the create wizard, playoff pools still listing correctly
in Browse. That is closed and this document does not ask you to look at it again.

---

## 1. The headline

The help system now has a panel. Press `?` anywhere, or click the new `?` button
in the header beside the theme toggle, and a drawer slides in from the right with
a guide to the screen you are on, a search box, the glossary, and a list of every
screen you can reach.

T1 wrote the copy. T2 is the thing that reads it.

**96 help pages, up from 7** — one per wizard step, one per pool tab, one per
squares-manager tab. Most of them carry a summary and no per-option copy yet;
that is what T9–T13 add, and the panel is useful before them.

## 2. What T2 shipped

- **The panel** — `src/components/help/{HelpPanel,HelpPanelBody,HelpPanel.components,
  useHelpPanel,useHelpShortcut,HelpHeaderButton,useUrlTab}`. Mounted once in
  `App.tsx`. Title is "Help" (K6). It does **not** remember being open across a
  reload (K7) — that was a deliberate call and it is why your phone will not have
  half its screen taken by a panel you closed yesterday.
- **The `?` key**, with four guards. It stays quiet while you are typing in any
  field (a commissioner writing "who wins if it ties?" gets a question mark, not a
  panel), while a modal owns the screen, and on Ctrl/Cmd/Alt chords.
- **Escape closes exactly one thing.** A new overlay stack
  (`src/components/ui/overlayStack.ts`) arbitrates: with the Help panel open over
  a modal, Escape closes the panel and leaves the modal alone. All six of this
  app's accessible modals are registered.
- **Knowing which screen you are on.** The panel is mounted above the router and
  every screen that knows its own tab sits below it, so screens now *publish*
  where you are. Eleven surfaces do this, including the ones whose help copy is
  still unwritten, so T3 and T14 add content only.
- **Tabs moved into the URL** (K13) for Props, Playoff, the Squares manager panel
  and the NFL commissioner sections. Two things fall out of that for free: help
  search results can link to those tabs, and the browser **Back button now works**
  on them, which it did not before.
- **Search**, an expandable topic list per section, the glossary with this page's
  terms first, "All pages" filtered to the pool you are in with an expander for
  the rest (K5), and a `?help=<topic>` deep link (K11) so a support email can open
  the panel on one setting.
- **The admin guidance is a separate download** that only a super admin ever
  fetches, gated on the same check that decides whether `/super-admin` renders at
  all. Empty until T14 writes the copy; the mechanism is in and tested.

## 3. Review — what it cost and what it caught

**13 codex rounds, qodo's full report, and 3 rounds of my own reading.** 12
findings were real and all 12 are fixed. Nothing is carried unresolved.

**The two that matter most were the same mistake, and they were mine.** Moving
those in-memory tabs into the URL (K13, above) made screens URL-reachable that had
never been reachable at all — and their code checks whether the *button* is
visible, not whether you have permission, because until now a hidden button was
the whole gate. So `/pool/<id>?tab=admin` would have shown any member the props
commissioner panel, and `?tab=ai` would have shown the AI insights tab in a pool
that has not paid for it. codex found both, as P1s, on round 4. The fix is that a
URL may only name a tab the screen is actually offering, and there is now a test
file whose whole job is to prove a member cannot type their way in.

**qodo found one bug and I had written the comment that hid it.** A pending help
navigation that missed its target was never dropped, so it could fire later in the
session on a screen you had reached for your own reasons. My comment one commit
earlier said the code dropped it. It did not. That is the fourth time in this
effort that a comment described behaviour nobody had checked, and twice this PR it
was member-facing copy: a Payments summary that said you could mark a payment
(you cannot — that tab is read-only for members) and an All-picks summary that
implied picks reveal a week at a time (they reveal per game, at each game's own
lock).

**qodo's other 11 findings were style, and all 11 are rejected with measurements**
on the PR — `userEvent` over `fireEvent` (the package is not a dependency and was
removed in this same PR as unused), a `hooks/` subdirectory (this repo has zero of
those), barrel imports for icons (152 files do it, 1 does not), line length (no
rule configured, 6,762 existing lines already exceed it), `sr-only` text on icon
buttons (an `aria-label` overrides it, so it would make screen readers *worse*).
That is the same 100 %-reject rate its style findings had on #475 and #476.

**And CI caught one thing no local gate could.** `jsdom` installed at its newest
version needs Node 22; the CI job that runs the tests is on Node 20. Every suite
passed on my machine and CI died with a message that named a missing function and
no version at all. Pinned back, and there is now a test that reads CI's own Node
version out of the workflow file and fails if a test dependency stops supporting
it.

## 4. Round accounting — a paid overage, on purpose

**13 codex rounds against a cap of 10.** Rounds 11–13 were forced by CLAUDE.md
§2b: code written to close a qodo finding has never been seen by codex, so it earns
its own round, and your 2026-08-18 ruling waives the *ask* for exactly that case
while keeping the *audit*. This is the audit.

Both paid rounds earned it. Round 11 found that help links rebuilt the query string
from scratch, so picking another page from Help silently reset an NFL reader's
`?week=3`. Round 12 found a bug in that fix: pool links were built from whatever
path you were on, so a commissioner in the create wizard got
`/create/pickem?tab=picks`, which is not a pool. Round 13 is clean. Three of the
five rounds the exception allows.

## 5. The decision that was taken, and two I made alone

✅ **ANSWERED — §7 step 2: deploy T2 before T16? Kevin took option A on
2026-08-18.** T2 is live. **T16 is therefore OVERDUE, not pending**: T15's
prerequisite was consciously skipped, so the `?` shortcut is in production resting
on the CSS-class fallback for ~35 overlay shells. All 41 current backdrops carry
the class pair it matches, so nothing slips through today — but a new overlay
written without it would, and nothing fails when one is. **T16 is the highest
priority non-content ticket in this plan.**

The two below needed no decision from you, but are written down so you can
overrule them.

1. **The monetization dashboard's own six tabs do not publish to the help panel.**
   They are a third level down (admin tab → billing sub-tab → money tab) and the
   panel tracks two. No help page in T2's scope or T14's tells those six apart, so
   a third level would be a field nothing reads. The reason is in a comment at the
   code, not only here.
2. **T16 is still a prerequisite of T15.** About 35 overlay shells in this app have
   no accessibility role, so the `?` key's "is a modal open" check falls back to
   matching a CSS class pattern for them. That is fine for now and is not fine for
   production-forever; T16 migrates them, and the plan already says the shortcut
   does not ship to prod on the class heuristic alone. The panel and the header
   button are unaffected either way.

## 6. What I could not verify — stated, not skipped

- **There is no browser walkthrough of the panel.** `/create/*`, `/pool/:id` and
  `/admin/:id` are all behind a login and the preview server serves the primary
  checkout rather than the worktree. The keyboard and focus behaviour is covered by
  22 real DOM tests in `src/__tests__/helpPanel.test.tsx` — `?` toggling, Escape
  returning focus, the tooltip's ARIA, the search, the pool-type filtering (count
  taken from `npx vitest run` on the merge commit, 2026-08-18, not from reading the
  file). **How it looks is unverified.** Your redeploy in
  §7 is the first real look, which is why §7 step 3 asks you to press one key.
- The admin chunk's retry-after-a-failed-download path is proved by its cache
  contract and by reading the code, not by a test that makes a download fail.

## 7. Runbook — step 2 is a decision; the rest follow from it

### Step 1 — pull, so your checkout has T2

Open a terminal. You do not need to be in any particular folder.

```bash
git -C D:/march-melee-pools pull
```

**You should see** either a list of updated files or `Already up to date.`

Then confirm T2 is actually in what you just pulled:

```bash
git -C D:/march-melee-pools log --oneline --grep="PLAN-HELP-SYSTEM T2" -1
```

**You should see** one line ending `(#477)`. **If you see nothing**, the pull did
not bring T2 down — tell me before deploying. **If the pull errors** about local
changes, run `git -C D:/march-melee-pools status` and tell me what it says; do not
force anything.

> ⚠️ **Do not check for a specific commit hash.** By the time you read this, `main`
> has moved past T2 — this document itself is a later commit. What matters is that
> the revision being deployed CONTAINS T2, which is what the `--grep` above asks.

### Step 2 — DECIDE whether to redeploy `www` yet ✅ ANSWERED: OPTION A

> ✅ **CLOSED 2026-08-18. Kevin chose A and redeployed.** Verified independently by
> fetching the live bundle: `/assets/index-CDG-Ki-M.js` contains `help-panel`,
> `Search help` and `Press … to toggle`. **Do not re-ask this.** What it leaves
> owed is T16 — see §5. The reasoning is kept below because the trade is worth
> re-reading when T16 is scheduled.

**I did not ask you to press Redeploy, because the plan you signed said not to
yet.** `PLAN-HELP-SYSTEM.md` §3 D3 makes **T16 a prerequisite of T15**: *"the
shortcut does not ship to prod on the class heuristic alone."* T2's `?` key uses
exactly that heuristic for the ~35 overlay shells that carry no accessibility
role. Telling you to deploy anyway — which an earlier draft of this document did —
would be me quietly overruling a signed decision in a runbook step. codex caught
it as a P1 on the docs review.

**What I actually measured, so you can weigh it rather than guess:**

- All **41** overlay backdrops in `src/` carry the literal `fixed inset-0` class
  pair, and that pair is one clause of the fallback selector. So today the
  heuristic **does** cover every one of them, and the `?` key stays quiet behind
  each. The plan's objection is that a class name is a fragile thing to depend on —
  a future overlay written differently would slip through — not that a current
  overlay slips through.
- The **panel and the header button carry none of that risk.** They are ordinary
  UI. The only thing T16 protects is the keyboard shortcut.
- T16 is described in the plan as **mechanical, one PR**: give ~35 shells
  `role="dialog"` + `data-overlay-root` + `useOverlayOwner`. It also fixes their
  missing Escape and focus behaviour as a side effect, which is a real
  accessibility gain independent of help.

**Your three options.**

| | Option | What you get | What you carry |
|---|---|---|---|
| **A** | **Redeploy now** (recommended) | The panel, the header button and the `?` key live today, before this week's Pick'em invites go out | A shortcut resting on a class heuristic that I measured as covering all 41 current overlays. You are consciously taking T15 before T16 |
| **B** | Hold the redeploy until T16 lands | The plan's bar met exactly as written | T2 sits on `main` undeployed — and the next unrelated frontend deploy ships it anyway, so this is a delay rather than a control |
| **C** | Have me do T16 next instead of T9 | The bar met properly, then deploy both together | Pick'em option copy (T9) slips, and this week's invites are Pick'em |

**I would take A**, and say so on the record: the measurement says the heuristic
covers today's overlays, the panel is where the value is, and B does not actually
prevent the thing it looks like it prevents. But it is a signed plan and the call
is yours. **If you want A, do this:**

1. Open your browser and go to the **Coolify dashboard**.
2. Select the **`www` / march-melee-pools frontend** application — the same one you
   redeployed for T1 yesterday, not a Firebase Function.
3. Confirm the branch shown is **`main`**. Do **not** try to match a specific
   commit; `main` moves and the newest commit on it is the right one. If the commit
   shown looks stale, click **Refresh** or reload the page first.
4. Click **Redeploy** (some versions label it **Deploy**).
5. **You should see** the build log start streaming, then finish with a success
   state after roughly 2–5 minutes.
6. **If the build fails**, copy the last ~30 lines of the log and send them to me.
   Do not retry more than once — the same failure twice is a real failure.

**If you want B or C, reply with which one and stop here** — steps 3 to 5 below all
require the deploy, so skip them.

### Step 3 — press one key ✅ DONE

1. Go to **https://marchmeleepools.com/create/pickem** and sign in if asked.
2. **Press the `?` key.** A panel should slide in from the right, titled **Help**,
   headed **"Pick'em wizard — Basics"**, with a **Search help** box at the top.
3. **Press `?` again.** It should slide away.
4. **If nothing happens**, hard-refresh once (Ctrl+Shift+R) and try again. If it
   still does nothing, tell me — that is a real defect and it is mine.
5. **If the panel opens but is empty below the title**, tell me. That means the
   content did not ship with the bundle.

### Step 4 — check the guard that matters ✅ DONE, AND IT HOLDS

> ✅ **Verified by Kevin on the live site, 2026-08-18: signed in as neither the
> commissioner nor an admin, `?tab=admin` does NOT show the admin panel.** The P1
> codex found on round 4 is confirmed fixed against the deployed build, not only
> against its test.
>
> ⚠️ **The step below asked for a test account IN the pool. That was wrong and the
> requirement is dropped.** Membership is irrelevant to this guard: `PoolRoute` has
> no membership check before `PropsPoolDashboard`, and the unlock is
> `isManager || isAdmin`. So a **signed-out window is a sufficient test**, and a
> **SUPER_ADMIN account is not a valid one** — it unlocks the panel by design, so
> using it would look like a failure while the code is correct.

1. Open one of your own **props** pools as yourself (you are its commissioner):
   **https://marchmeleepools.com/pool/&lt;that pool's id or slug&gt;**
2. In the address bar, add **`?tab=admin`** to the end and press Enter.
3. **You should see** the props commissioner panel, because you ARE the
   commissioner. That is correct.
4. Now do the same thing while signed in as a **non-commissioner** — if you have a
   second test account, use it; if not, skip this and tell me and I will script it.
5. **You should see** the ordinary Overview tab, **not** the admin panel. **If a
   non-commissioner sees the admin panel**, stop and tell me immediately — that is
   the exposure codex caught and it would mean the fix did not ship.

### Step 5 — the type-a-tab check, and Back ✅ DONE

1. Still in a pool, click through two or three tabs.
2. **Press the browser Back button.** You should return to the previous tab rather
   than leaving the pool. Before T2 this worked on NFL and Bracket only; it now
   works on Props, Playoff and the Squares manager panel too.

### Step 6 — nothing else needs you

No `functions/` deploy, no `firestore.rules` deploy, no indexes, no production data
migration. T2 touched none of them.

## 8. What is NOT done

- **T9 is next and is NOT started.** It is the NFL Pick'em option copy — every
  `settings.*` on the wizard rules step, the dashboard tabs, the manager sub-tabs
  and the pick sheet. This week's invites are Pick'em, so it is the highest-value
  content ticket. I stopped rather than start it half-built; the order after it is
  unchanged (T4, T3, T10/T11).
- **T3–T8 and T10–T16 unstarted.** The pool and admin pages have summaries but no
  per-option copy, the site and account pages have neither (T3), and manager
  settings, pick sheets and rules pages still have no tooltips (T4–T7).
- **T16 before T15**, per §5 above.
- The per-pool-type rules copy is still named in `WIZARD_FIELD_ALLOWLIST` with its
  ticket, field by field. A ticket is done when its rows are gone.

## 9. Worktrees

- `.claude/worktrees/help-t1-helptip` — T1 branch, merged. Removable.
- `.claude/worktrees/help-t1-docs` — T1's doc, merged. Removable.
- `.claude/worktrees/help-t2-panel` — T2 branch, merged, now holding this doc's
  branch. Removable once this doc is merged.
- `.claude/worktrees/help-system-impl-4ebe5f` — untouched, no commits. Removable.
