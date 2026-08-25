# RUNBOOK — git history scrub (the `.env` blob)

**Status: PREP ONLY. NOT EXECUTED.** Kevin decision **D5**, approved as prep.
Everything below is written down so it can be executed deliberately, once, by
the owner — not so that it happens.

# 🛑 **THE FORCE-PUSH IS KEVIN'S MANUAL ACTION AND MUST NEVER BE RUN BY A SESSION.** 🛑

No agent, session, script, or automation runs step 6 or step 7. Not with
approval in chat, not overnight, not "because the runbook says so". A session
that reaches step 5 stops, hands the remaining commands to Kevin inline, and
waits. This is a rewrite of every commit in a repository with dozens of live
checkouts; the failure mode is unrecoverable work loss across other people's
in-flight branches, and it is not delegable.

---

## 1. Why this is queued, and why it is LAST

**The urgency is COSMETIC.** The exposed value is dead:

- The Gemini API key was in public git history from 2025-12-13
  (`.env`, removed by commit `3340fff0`, *"chore: Remove .env from git and add
  to gitignore (Security fix)"*).
- **Rotation is CLOSED** (Kevin ruling, 2026-08-24). The leaked value returns
  `API_KEY_INVALID` when tested live. The key in production today
  ("New MarchMeleePoolsAPI2", Jan 2026) **was never in git**, and a full sweep
  of `.env` across history found no other private key.

So this scrub buys **hygiene, not safety**. A dead credential sitting in public
history is embarrassing and shows up in every automated secret scan forever; it
is not an exposure. That is why D5 rides last behind every functional item, and
why the cost/benefit below has to actually clear.

**The honest counter-argument, stated once so it is not skipped:** the cost of
this scrub is high (§4), the benefit is cosmetic, and "do nothing, the value is
dead" is a legitimate outcome. Nothing here recommends executing it. It exists
so that IF Kevin chooses to, the procedure is correct rather than improvised.

---

## 2. What gets removed, and how it was identified

**One path: `.env` at the repository root.** It appears in exactly four commits
and was deleted in the fourth:

```
1c28f9d8  Initial commit
0a50c374  Add Firebase Auth
33f23a86  Implement Charity Functionality v3.1
3340fff0  chore: Remove .env from git and add to gitignore (Security fix)
```

Because the blob is present in the **initial commit**, the rewrite touches
**every commit in the repository**. There is no partial version of this.

**The count-only check that never reprints the secret** (this is the same form
used to establish the leak in the first place, and the same form used to verify
afterwards in §5):

```powershell
git show 3340fff0^:.env | Select-String -Pattern "VITE_API_KEY" | Measure-Object -Line
```

Expect `Lines : 1` today. Never `git show 3340fff0^:.env` on its own, and never
paste its output anywhere — the whole point of a count is that the value stays
unread.

---

## 3. Tooling

`git-filter-repo` is the tool. `git filter-branch` is deprecated and
`BFG` needs a JVM; neither is used here.

**Already installed and verified on this machine:**

```powershell
pip show git-filter-repo      # Name: git-filter-repo / Version: 2.47.0
git filter-repo --version     # prints an internal build hash, exit code 0
```

If it is ever missing: `pip install git-filter-repo` (Python 3.6+; this machine
has 3.14.0 and pip 25.2). Confirm `git filter-repo --version` exits 0 before
proceeding — an install that is not on `PATH` as a git subcommand fails at the
worst moment.

---

## 4. What breaks — read this before deciding

This is the section that decides whether to do it at all.

1. **EVERY commit SHA in the repository changes.** The blob is in the initial
   commit, so nothing survives with its current id.
2. **Every open PR is invalidated.** There are **13 open PRs** at the time of
   writing. Their base and head commits will no longer exist on `origin`.
   GitHub does not rebase them for you — each one must be closed and re-opened
   from re-applied work, or merged BEFORE the rewrite. **Merging everything
   first is the cheaper path by a wide margin.**
3. **`npm test` goes red, and it is right to.**
   `tests/docs-state-invariants.test.ts` asserts that every deploy-state SHA
   claimed in the operator docs *is a real commit reachable from `origin/main`*.
   There are **29 such claims** in the markdown today. After the rewrite every
   one of them names a commit that no longer exists. **This is a required
   follow-up commit, not an optional cleanup** — plan for a docs pass that
   re-stamps them, on the rewritten history, immediately after.
4. **Coolify rollback targets become unidentifiable.** `§2b` of
   `mmp-deploy-and-operate` identifies retained container images **by commit
   SHA**. Every retained image is tagged with a SHA that no longer exists in the
   repo, so "roll back to the commit before the bad one" stops being answerable
   until enough new deploys have cycled through. **Do not schedule this near a
   risky deploy.**
5. **Every existing clone and worktree must be re-cloned.** See §5 — this is
   the biggest operational cost here, and it is quantified there.
6. **Every SHA reference outside git breaks:** `HANDOFF.md`, `DECISION-LOG.md`,
   the `MORNING-*.md` series, the `mmp-*` skill provenance blocks, auto-memory
   bodies, PR descriptions, and any bookmarked GitHub permalink.
7. **The old objects do not disappear from GitHub by force-pushing.** They stay
   reachable by direct SHA URL until GitHub garbage-collects, which it does not
   do on request as part of a push. Removing them requires opening a **GitHub
   Support** request to purge the unreachable objects and cached views. **Until
   that request completes, the scrub has not achieved its only goal.** Factor
   the support round-trip into the decision.
8. **Branch protection blocks the push.** `main` protection / rulesets must be
   temporarily lifted and then restored. **Verify the restore with
   `gh api repos/kstruck/MMPoolsV3/rulesets`, never by looking at the UI** — a
   required-checks config on this repo was once believed saved and had not been.
   Ruleset `11714546` is the one that matters; as measured on 2026-08-25 it is
   main-scoped, enforcement active, and carries `required_status_checks` for
   `build-and-test`, `emulator-tests`, `security-audit` and `nginx-validate`.
   Restoring it means getting all of that back, not just re-enabling the rule.

---

## 5. Worktree coordination — the part that actually loses work

**Measured on this machine: `git worktree list` reports 36 entries** — the main
checkout at `D:\march-melee-pools` plus **35 linked worktrees**, spread across
`D:\march-melee-pools\.claude\worktrees\*`, `D:\mmp-wt\*`, `D:\mmp-buyflow`, and
`D:\mmp-cost-controls`. Several are detached HEADs and several carry branches
that have never been pushed.

**Why this is dangerous rather than annoying:** every one of those worktrees
shares the main checkout's object store and refs. After the rewrite, their
HEADs point at commits that exist nowhere on `origin`. Anything not pushed is
recoverable only from the local reflog of a repository you are about to
replace.

**The pre-flight, in order. Do not skip any of it.**

1. **Inventory.** From `D:\march-melee-pools`:

   ```powershell
   git worktree list
   ```

   Success: a list you can account for, entry by entry.

2. **Find unpushed work.** For each worktree path:

   ```powershell
   git -C <worktree-path> status --short
   git -C <worktree-path> log --oneline origin/main..HEAD
   ```

   Success: clean status and an empty commit list. If not: that worktree has
   work that the rewrite will strand.

3. **Push or export everything that is not empty. COMMITTED and UNCOMMITTED
   work need different handling — doing only the first silently loses the
   second.**

   Preferred for committed work: push the branch to `origin` and **merge it
   before the rewrite** — merged work survives, because it will be in the
   rewritten history too. Fallback for commits that cannot be merged yet:

   ```powershell
   git -C <worktree-path> format-patch origin/main..HEAD -o D:\mmp-scrub-patches\<name>
   ```

   Success: `.patch` files on disk, outside the repository. These re-apply onto
   the rewritten history with `git am` afterwards. (`-o` also creates missing
   leading directories — same measurement as §6 step 1 — so
   `D:\mmp-scrub-patches` needs no pre-creation either.)

   🛑 **`format-patch` exports COMMITS ONLY.** A worktree that step 2 flagged
   with a dirty `git status --short` has changes that no patch series contains,
   and step 5's `git worktree remove` will then refuse — leaving you stuck
   mid-freeze with no instruction. Deal with the dirty tree FIRST, by whichever
   of these fits:

   ```powershell
   # BEST: commit it, then it is covered by the format-patch above
   git -C <worktree-path> add -A
   git -C <worktree-path> commit -m "WIP before history scrub"

   # OR, if it truly cannot be committed: export it in TWO parts, because
   # one command does not cover both. `git diff HEAD` covers TRACKED changes
   # only and silently omits every untracked file.
   git -C <worktree-path> diff HEAD > D:\mmp-scrub-patches\<name>-dirty.patch

   # ...and then actually COPY the untracked files. `ls-files --others` only
   # PRINTS paths; on its own it preserves nothing.
   $wt = "<worktree-path>"
   $out = "D:\mmp-scrub-patches\<name>-untracked"
   git -C $wt ls-files --others --exclude-standard | ForEach-Object {
       $dest = Join-Path $out $_
       New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
       Copy-Item (Join-Path $wt $_) $dest -Force
   }
   ```

   Verify the copy before removing anything — the counts must match:

   ```powershell
   (git -C $wt ls-files --others --exclude-standard | Measure-Object -Line).Lines
   (Get-ChildItem -Recurse -File $out | Measure-Object).Count
   ```

   **This is why "commit it" is listed first.** `git add -A` picks up tracked
   and untracked in one operation and needs no verification step; the two-part
   export exists only for work that genuinely cannot be committed, and it is
   the path where files get left behind.

   🛑 **DO NOT USE `git stash` FOR THIS.** The stash is a **repository-global
   ref stack shared by every worktree** — all 35 of them here — so a
   `git stash push` in one worktree and a `git stash pop` in another operate on
   the same stack. With parallel sessions running, a pop can hand you somebody
   else's work and drop yours. **Measured on 2026-08-25**, during the session
   that wrote this runbook: a `stash push`/`pop` pair in one worktree came back
   holding a different workstream's uncommitted changes, and the author's own
   files were recoverable only through `git fsck --unreachable`. Committing is
   free and safe; stashing across a shared `.git` is neither.

4. **Announce a freeze.** No commits, no merges, no deploys from any checkout
   between the mirror clone (§6 step 1) and the re-clone (§7). A commit made
   during the window is a commit that only exists in the pre-rewrite history.

5. **Remove the worktrees.** From `D:\march-melee-pools`:

   ```powershell
   git worktree remove <worktree-path>
   git worktree prune
   ```

   Success: `git worktree list` shows only the main checkout. If a removal
   refuses because of local changes, go back to step 3 — do not `--force` past
   it.

---

## 6. The rewrite — commands for Kevin

**Run in a NEW directory, on a FRESH mirror clone. Never in
`D:\march-melee-pools`.** `git filter-repo` is designed to run on a fresh clone
precisely so that a mistake costs a re-clone rather than the repository.

A mirror clone is used rather than a normal clone because it carries **all
branches and tags**; a plain clone would rewrite only `main` and leave every
other ref on `origin` still containing the blob.

**Step 1 — mirror clone.**

```powershell
cd D:\
git clone --mirror https://github.com/kstruck/MMPoolsV3.git D:\mmp-scrub\MMPoolsV3.git
```

Success: a bare repo at that path. Verify it has the history:
`git -C D:\mmp-scrub\MMPoolsV3.git rev-list --all --count`.

ℹ️ **`D:\mmp-scrub` does not need to exist first.** `git clone` creates missing
leading directories, so no `New-Item` step is needed — measured on this machine
(git 2.52.0.windows.1): `git clone --mirror ./srcrepo ./deep/nested/path/mirror.git`
into a path with three absent parents exits 0 and creates all of them. Noted
because a review round raised the opposite as a defect; it is not one.

**Step 2 — confirm the target is present before removing it** (count only):

```powershell
git -C D:\mmp-scrub\MMPoolsV3.git rev-list --objects --all | Select-String -SimpleMatch " .env" | Measure-Object -Line
```

Success: a non-zero count. If it is already `0`, the clone is wrong or the blob
is already gone — stop and re-check rather than "fixing" it.

**Step 3 — the rewrite.**

```powershell
git -C D:\mmp-scrub\MMPoolsV3.git filter-repo --invert-paths --path .env
```

`--path .env` names the exact root path; `--invert-paths` means *remove it*
rather than *keep only it*. **Getting `--invert-paths` wrong deletes the entire
repository except `.env`** — which is exactly why this runs on a throwaway
mirror.

Success: filter-repo prints a progress summary and writes a report under
`D:\mmp-scrub\MMPoolsV3.git\filter-repo\`. It also **removes the `origin`
remote** on purpose, so that a reflexive `git push` cannot happen.
If it does not: a *"not a fresh clone"* refusal means the clone was touched —
delete the directory and redo step 1. Do **not** add `--force` to talk it past
that check.

**Step 4 — verify BEFORE pushing** (all count-only; none of these print the
secret):

```powershell
# a) the path is gone from every object in every ref — expect 0
git -C D:\mmp-scrub\MMPoolsV3.git rev-list --objects --all | Select-String -SimpleMatch " .env" | Measure-Object -Line

# b) no commit anywhere still touches it — expect 0
git -C D:\mmp-scrub\MMPoolsV3.git log --all --oneline -- .env | Measure-Object -Line

# c) the history is otherwise intact — compare to step 1's count
git -C D:\mmp-scrub\MMPoolsV3.git rev-list --all --count

# d) all the branches are still there — compare to GitHub
git -C D:\mmp-scrub\MMPoolsV3.git for-each-ref --format="%(refname)" | Measure-Object -Line
```

Success: (a) and (b) are `0`, (c) is unchanged or nearly so, (d) matches the
branch/tag count on `origin`.
If (c) collapsed to a handful of commits, `--invert-paths` was omitted or
mistyped. **Delete the mirror and start over. Do not push it.**

**Step 5 — sanity-check the tip builds.** Clone the rewritten mirror to a scratch
working directory and run the suite there before anything reaches `origin`:

```powershell
git clone D:\mmp-scrub\MMPoolsV3.git D:\mmp-scrub\check
cd D:\mmp-scrub\check
npm ci
npm test
```

Success: the suite behaves as it did before, **except** the docs-state SHA
assertions, which are expected to fail for the reason in §4.3. Any OTHER new
failure means the rewrite damaged content — stop.

---

## 7. 🛑 The push and the recovery — KEVIN ONLY

**Everything from here is Kevin's, executed by hand, with the repository
freeze in force.** A session may hand these commands over inline; a session
never runs them.

**Step 6 — lift branch protection.** GitHub → repo → Settings → Rules /
Branches. Disable the `main` ruleset. Confirm with
`gh api repos/kstruck/MMPoolsV3/rulesets`.

**Step 7 — the force-push.**

```powershell
git -C D:\mmp-scrub\MMPoolsV3.git remote add origin https://github.com/kstruck/MMPoolsV3.git
git -C D:\mmp-scrub\MMPoolsV3.git push --force --mirror origin
```

⚠️ **`--mirror` makes `origin` match the local mirror EXACTLY — it DELETES any
remote ref the mirror does not have.** That is the intended behaviour (it is how
every branch gets the scrubbed history), and it is also why the freeze in §5.4
is not advisory: a branch someone pushed after step 1 is deleted by this
command without a prompt.

Success: the push completes and `gh api repos/kstruck/MMPoolsV3/commits/main`
returns a SHA you do not recognise — the rewritten tip.

**Step 8 — restore branch protection**, and verify it saved with
`gh api repos/kstruck/MMPoolsV3/rulesets` rather than by looking at the UI.

**Step 9 — open the GitHub Support request** to purge unreachable objects and
cached views. Until this completes the old commits remain fetchable by direct
SHA and **the scrub has not achieved anything**.

**Step 10 — re-clone. Every checkout, no exceptions.**

```powershell
# archive, do not delete, until everything is confirmed working
Rename-Item D:\march-melee-pools D:\march-melee-pools-PRE-SCRUB
git clone https://github.com/kstruck/MMPoolsV3.git D:\march-melee-pools
cd D:\march-melee-pools
npm ci
npm --prefix functions ci
```

Then re-create only the worktrees still needed, and re-apply any patches
exported in §5.3 with `git am`.

⚠️ **A pre-rewrite checkout that survives is a live hazard.** Pulling into one
produces a merge of two unrelated histories, and deploying from one ships
pre-rewrite code while printing `✔ Deploy complete!` (CLAUDE.md §3). Keep
`D:\march-melee-pools-PRE-SCRUB` for recovery only, and delete it once the new
clone has been verified.

**Step 11 — the docs follow-up.** Re-stamp the 29 deploy-state SHA claims and
get `npm test` green again, as its own PR on the rewritten history. Until that
lands, CI is red and the repo's own state invariant is unsatisfied.

---

## 8. Final verification — count only, never reprint

From the fresh clone at `D:\march-melee-pools`:

```powershell
git rev-list --objects --all | Select-String -SimpleMatch " .env" | Measure-Object -Line   # expect 0
git log --all --oneline -- .env | Measure-Object -Line                                     # expect 0
```

And from GitHub, confirming the removal is live rather than local:

```powershell
gh api repos/kstruck/MMPoolsV3/contents/.env    # expect HTTP 404
```

**Never verify by printing the file.** `git show <sha>:.env` re-publishes the
value into a terminal, a scrollback buffer, and a session transcript — which is
the failure this whole runbook exists to undo. Count lines, compare to zero, and
leave the bytes unread.
