# MORNING 2026-08-09 — survivor parity settings (PR #399)

One PR, one session, per your one-PR-at-a-time rule (§2d). Everything below is
measured; each claim names the command that produced it.

**Nothing was deployed, no production data was mutated, and no config flag was
flipped.** The deploy is yours, and it has an ordering constraint — read §3
before running anything.

---

## 0. TL;DR

| # | Task | Risk |
|---|---|---|
| 1 | Review and merge [PR #399](https://github.com/kstruck/MMPoolsV3/pull/399) | merge only |
| 2 | Deploy **functions**, then **rules** — in that order, not the other | ⚠️ ordered deploy |
| 3 | Rebuild the frontend in Coolify | routine |

Not time-critical. The settings default to today's behaviour, so nothing changes
for any existing pool until a commissioner opts in.

---

## 1. What #399 does

Two commissioner settings on `NFL_SURVIVOR` pools:

| Setting | Absent means | Otherwise |
|---|---|---|
| `settings.tieCountsAs` | `'LOSS'` — a tie is a strike in **both** modes, today's rule | `'WIN'` grades the tie as the picked team winning: survive in standard, strike in pick-loser |
| `settings.maxTeamUses` | `1` — one use per team per season, today's rule | `N ≥ 2` allows N distinct weeks; `0` is unlimited |

No existing pool doc carries either field, and none needs a migration — defaults
are applied at read sites only. **Every existing survivor pool behaves exactly as
it does today after this deploy.**

It also fixes a defect that is live in production right now: the pick-entry mode
header told members *"If they win or tie, you survive"* in **both** modes, while
the engine has always struck a tie. Wrong before this PR, and wrong in the
direction that costs a member their season.

---

## 2. ⚠️ The deploy ORDER is load-bearing — functions BEFORE rules

This is the one thing in this document that can hurt you.

`firestore.rules` gains a deny for client writes to those two settings fields —
for **every** principal, super-admin included. The legitimate edit path is the
`updatePoolSettings` callable, which the same PR teaches to accept them.

**Deploy rules first and you lock out the very path the callable needs.** The
callable would not yet exist in its new form, and the rules would already be
refusing the direct write, so survivor settings would be uneditable in the gap.

This is Rule 2 in `mmp-change-control`, and #399 is currently the **only** pending
work that touches `firestore.rules`.

---

## 3. Deploy runbook

Every command runs from `D:\march-melee-pools` — the **main checkout**, not a
worktree. One command per block; run them in order and read the expected output
before moving on.

### Step 1 — merge the PR

1. Open <https://github.com/kstruck/MMPoolsV3/pull/399>.
2. Confirm the checks list shows **7 green checks** (`build-and-test`,
   `emulator-tests`, `lint`, `nginx-validate`, `security-audit`, `Analyze`,
   `CodeQL`).
3. Click **Merge pull request**, then **Confirm merge**.
4. ✅ You should see *"Pull request successfully merged and closed"*.
5. ❌ If a check is red, stop and tell me which one — do not merge.

### Step 2 — get the merge onto your main checkout

Open PowerShell and run, in `D:\march-melee-pools`:

```powershell
cd D:\march-melee-pools
```

```powershell
git checkout main
```

```powershell
git pull
```

✅ Expect the last line to name a new merge commit and to list
`firestore.rules`, `functions/`, `shared/` and `src/` among the changed files.
❌ If `git pull` reports a conflict or refuses because of local changes, stop —
`git status` and send me the output.

### Step 3 — install functions dependencies

```powershell
npm --prefix functions ci
```

✅ Expect `added N packages` and no error.
⚠️ **`ci`, not `install`.** `install` rewrites the lockfile and dirties the tree
that `firebase deploy` is about to package.
❌ If it fails, stop here — do not deploy on a failed install.

### Step 4 — deploy FUNCTIONS (first)

```powershell
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

✅ Expect `✔  Deploy complete!`. Functions that did not change report
`Skipped (No changes detected)`; that is normal and correct.
❌ If it fails partway, **do not proceed to Step 5.** The rules change is only
safe once the callable is live. Send me the error.

### Step 5 — deploy RULES (second, only after Step 4 succeeded)

```powershell
npx firebase deploy --only firestore:rules --project gridiron-gamble-uzuqo
```

✅ Expect `✔  Deploy complete!` and a line naming `firestore.rules`.
❌ If it fails, the system is still consistent — functions accept the new
settings and rules simply have not tightened yet. Not urgent; send me the error.

**Indexes are NOT touched by this PR** — `firestore.indexes.json` is unchanged,
so there is no third deploy surface here. Verify if you want:

```powershell
git diff --name-only HEAD~1 HEAD -- firestore.indexes.json
```

✅ Expect **no output**.

### Step 6 — rebuild the frontend in Coolify

The wizard, the manager Settings tab, the Rules page and the corrected member
copy are all frontend. Pushing to `main` does **not** deploy the frontend.

1. Open the Coolify dashboard.
2. Select the `www` application.
3. Click **Redeploy** (or **Deploy**).
4. ✅ When it finishes, the deployed commit SHA should match `main`. Check with:

```powershell
git rev-parse origin/main
```

5. ❌ If the build fails, send me the Coolify build log.

### Step 7 — smoke test (2 minutes)

1. Open any existing NFL Survivor pool → **Rules** tab.
2. ✅ You should see two new rows: **Tie Outcome** (*"A tied game is a strike."*)
   and **Team-Use Limit** (*"1 per team"*). Those are the defaults rendering —
   the pool was not modified.
3. Open the same pool → **Manage** → **Settings**.
4. ✅ You should see **Tie Outcome** and **Team-Use Limit** controls under
   Survivor Rules. Save without changing anything.
5. ✅ Expect the save to succeed. (If that pool has already had a week scored,
   saving the *unchanged* values is still fine — the gate compares effective
   values, so a no-op save is not a change.)
6. ❌ If a save on a scored pool is refused with `SETTINGS_LOCKED_AFTER_SCORING`
   while you changed nothing, that is a bug — tell me, do not work around it.

---

## 4. Things worth knowing before you touch a live pool

- **Automated scoring is live** (`nflAutoScoreJob`, `*/5`, `dryRun: false`), so
  the scorer picks these changes up as soon as the functions deploy lands. That
  is why `computeWeekFingerprint` now hashes both settings: without those terms
  an allowed settings change would leave the hash identical and the pool would
  take the skip path forever.
- **Changing either setting is refused once a pool has published a scored week.**
  Deliberate — the engine recomputes past weeks with current settings, so a flip
  would rewrite results members have already seen. Set them before the season
  starts, or leave them alone.
- **Lowering `maxTeamUses` is refused while a member already exceeds the new
  limit.** Raise it, or set `0` for unlimited.
- **Margin pools are untouched.** One use per team per season, as today.

---

## 5. Gate evidence

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm --prefix functions run typecheck` | clean |
| Root vitest | **852 / 852** |
| Functions vitest | **1428 / 1428** |
| Emulator suite | **348 passed / 2 expected-fail / 10 skipped** |
| `survivorParitySettings.rules.test.mjs` | **8 / 8** |
| CI on #399 | **7 / 7 green** |
| `codex exec review --base origin/main` | 3 rounds — see below |

**Codex rounds.** Round 1 clean; self-review of the diff then found a real issue
(every survivor settings save read every entry in the pool inside a transaction)
and fixed it. Round 2 found one P2 — the create schema and the update validator
disagreed on the `maxTeamUses` upper bound, so a pool created with `24` could
never save its settings again; fixed with one shared constant. Round 3 clean.

**Every new guard was mutation-checked** — deleted, proved the test goes red,
restored. Including the Firestore rule: putting back the root-level `diff()` (the
version review round 9 caught) lets all four denied writes through, and the rules
test says so.

---

## 6. One deliberate departure from the approved plan

Decision 2's code snippet folded **both** tie outcomes into won/lost before the
mode branch. Taken literally that changes today's behaviour on every pick-losers
pool with no setting written: under the default `'LOSS'` the picked team would
have "lost", which in losers mode is a **survive** — while today a tie strikes in
both modes.

That contradicts the harder locked constraint ("defaults preserve current
behaviour exactly"), so only `'WIN'` folds and `'LOSS'` means "today's rule". All
four cells are pinned by test in the engine and, independently, in the sim
oracle. Recorded in the plan's status ledger. Flagging it because it is a
knowing deviation from a document you signed off, not because it is in doubt.
