# MORNING 2026-08-18 (help system) — T0, T1 and T2 merged; T2 needs a Coolify redeploy

This file continues `MORNING-2026-08-18.md` for a different effort and supersedes nothing in it.

That doc remains the entry point for the PLAN-PAYMENT-LEDGER T2 work; this one
covers only `PLAN-HELP-SYSTEM.md`. Read whichever matches what you are doing.

> 🔴 **ONE THING NEEDS YOU: redeploy the frontend in Coolify.** T2 (#477) changes
> the shipped bundle and Coolify has no CLI path from this machine, so the Help
> panel is not in production until you press the button. Nothing else here is
> blocking. Numbered steps in §7.

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

## 5. Two things I decided rather than asking

Neither needed you, but both are written down so you can overrule them.

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
  22 real DOM tests — `?` toggling, Escape returning focus, the tooltip's ARIA, the
  search, the pool-type filtering. **How it looks is unverified.** Your redeploy in
  §7 is the first real look, which is why §7 step 3 asks you to press one key.
- The admin chunk's retry-after-a-failed-download path is proved by its cache
  contract and by reading the code, not by a test that makes a download fail.

## 7. Runbook — do these in order

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

### Step 2 — redeploy the frontend in Coolify ⚠️ THE ONE THING THAT NEEDS YOU

Nothing you see in production has a Help panel until this runs. Pushing to `main`
does **not** auto-deploy the frontend.

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

### Step 3 — press one key, in about 30 seconds

1. Go to **https://marchmeleepools.com/create/pickem** and sign in if asked.
2. **Press the `?` key.** A panel should slide in from the right, titled **Help**,
   headed **"Pick'em wizard — Basics"**, with a **Search help** box at the top.
3. **Press `?` again.** It should slide away.
4. **If nothing happens**, hard-refresh once (Ctrl+Shift+R) and try again. If it
   still does nothing, tell me — that is a real defect and it is mine.
5. **If the panel opens but is empty below the title**, tell me. That means the
   content did not ship with the bundle.

### Step 4 — check the guard that matters, in about 30 seconds

This is the P1 from §3, and it is worth seeing with your own eyes.

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

### Step 5 — the type-a-tab check, and Back

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
