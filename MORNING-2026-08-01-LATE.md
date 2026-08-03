# MORNING — 2026-08-01 (second session, ran overnight)

**HOF game: 2026-08-06 (Thu, 8:00pm ET = `2026-08-07T00:00Z`), CAR at ARI. Five days.**

> This is the SECOND handoff doc for 2026-08-01, and it **continues**
> `MORNING-2026-08-01.md` rather than replacing it: that file covers the chaos
> drill and the two deploys that followed it, and everything in it is done. This
> one covers the work after you asked me to merge dependabot and start Tasks 2
> and 3.

## 0. TL;DR

| | |
|---|---|
| **Dependabot** | 1 merged (#336), **6 rejected with evidence**. §1. |
| **Task 3 — reminder targets** | 🟡 **[#338](https://github.com/kstruck/MMPoolsV3/pull/338) is OPEN and YOURS to merge.** It carries **two named unresolved findings**, one of them a security exposure. §2. |
| **Task 2 — heartbeats UI** | ❌ **Not started.** §4. Honest reason: Task 3 took 10 codex rounds. |
| **Deploys** | ✅ Nothing owed. All three queues empty at `15a0c73`. |

**What I did not do:** no production data written, no scheduled job armed, no
Coolify change, no credentials entered, and **#338 not merged.**

---

## 1. Dependabot — 1 of 7 merged

You said "if safe", so I checked each rather than merging the lot. Only one was.

✅ **[#336](https://github.com/kstruck/MMPoolsV3/pull/336) merged** (re2 1.23.3 → 1.26.1). Lockfile only, dev-only transitive dependency, 5/5 CI green, 1 commit behind main. I diffed the lockfile package sets before merging: it changes only re2's own native-build toolchain (`node-gyp` 12→13, `nan`, `nopt`, `abbrev`) and drops 31 transitive packages that toolchain no longer needs. **No direct dependency lost, no unrelated downgrades.**

❌ **The other six are not safe, and it is not a close call:**

| PR | Bump | Why not |
|---|---|---|
| #299 | vite 7 → 8 | **4 CI checks failing** |
| #302 | typescript 6 → 7 | **4 CI checks failing** |
| #303 | @vitejs/plugin-react 5 → 6 | **4 CI checks failing** |
| #300 | tailwindcss 3.4 → 4.3 | **build-and-test failing.** Tailwind v4 is a config-model rewrite |
| #301 | lucide-react 0.556 → 1.27 | **build-and-test failing** |
| #304 | firebase-admin 13 → 14 | CI green, but **does not merge cleanly** — 35 commits behind, `git merge-tree` reports conflicts. Needs a dependabot rebase |

Every one is a **major** version bump. Five days before the pilot, with green CI on none of them, the answer is no. They will keep.

Worth knowing: `firebase-admin` is declared **twice** — root `package.json` at `^13.6.1` and `functions/package.json` at `^12.7.0`. Only `functions/` deploys, so #304 was never going to touch the production runtime anyway.

---

## 2. ⛔ TASK 3 — [#338](https://github.com/kstruck/MMPoolsV3/pull/338) IS YOURS TO MERGE

**All 7 CI checks green. qodo reported and absorbed. codex ran 10 rounds. It still carries two open findings, so under the autonomy rules it is not mine to merge.**

### What it fixes

`sendManualReminder` resolved targets from the **entries** collection, so a member who never submitted matched nothing — `sent: 0, skipped: 0`, no error. #329 made the frontend honest by disabling the button. This makes the backend actually reach them, from the Member Record roster.

### 🔴 Open finding 1 — a non-member can mint their own Member Record

I verified this in the code, it is not a hypothesis. `functions/src/setPaidStatus.ts:30`:

```
await mRef.set({ memberReportedPaid: !!claim, memberReportedAt: Date.now() }, { merge: true });
```

`.set(..., {merge: true})` **creates** the doc, and nothing checks the caller ever joined the pool — only that they claim for themselves. So any signed-in user can mint `pools/{anyPoolId}/members/{their-uid}`.

**That gap already exists and is not caused by #338.** What #338 changes is the consequence: a Member Record is now a trusted reminder target, so a self-added non-member would receive that pool's commissioner-triggered emails.

I did **not** fix it. The fix is a membership check on the self-report branch — that is **authorization**, a PLAN-gated trigger under CLAUDE.md §4, and not something to do unilaterally at the end of a ten-round session five days out.

**Your call, three options:**
1. **Fix `setPaidStatus` first** in its own plan-gated PR, then merge #338. ← my recommendation
2. **Merge #338 now** and accept it. An attacker needs a pool id and must want that pool's reminder mail.
3. **Narrow #338** to entries only — which loses the never-submitted member, i.e. the whole point.

### 🟡 Open finding 2 — wrong debt named in the email

A Survivor member who paid their entry but still owes rebuys is now correctly selected for a PAYMENT reminder, but the template still says *"Entry payment due"*. Small and safe to fix; I left it because new code earns its own review round and I was at the cap.

### Why it took 10 rounds

Nine of the twelve findings were the **same shape**: a rule that was accidentally correct while targets came from entries, and wrong once they came from the roster. The worst would have emailed a **hosting-only commissioner "your entry payment is still due"** for money they do not owe — three separate times, in three different ways (new pools, legacy un-stamped records, and pools naming the host in `createdByUid`/`managerUid`).

Round 9 also reversed round 1: `participantIds` was added as a roster source, then removed, because `firestore.rules` `protectedFieldsUnchanged()` protects `participants` but **not** `participantIds`. A pool manager can append any Firebase UID they know, which would have made this callable an arbitrary-email primitive.

📌 **Worth its own ticket regardless of what you do with #338: add `participantIds` to `protectedFieldsUnchanged()` in `firestore.rules`.**

### qodo earned its keep

It found a defect ten codex rounds and my own reads missed: **`rebuyPaid` was deducted twice**, because `memberDues` already nets it. Two rebuys at $20 with $20 paid computed as **$0 owing instead of $20** — marking a real debtor as settled and silently suppressing their reminder. Every earlier test used `rebuyPaid: 0`, so nothing exercised it.

1/1 of its defect findings valid, 5/5 of its style findings rejected — almost exactly the split CLAUDE.md §2b records.

### Guards

**32 mutants across eight rounds.** Four survived first time: one was equivalent code (deleted rather than guarded), three were real holes.

---

## 3. If you merge #338 — the deploy

PowerShell 5.1. One command per block, no `&&`.

### Step 0 — pick a directory that has the Firebase CLI

`npx firebase` failed for you earlier in `D:\march-melee-pools` for one specific
reason: **that checkout has no root `node_modules`**, so npx could not find the
CLI. It is not that the main checkout is wrong to deploy from.

Either fix works.

**(a) Use the main checkout** — install once and it works there permanently:

```powershell
Set-Location D:\march-melee-pools
```

```powershell
npm ci
```

**(b) Use a worktree that already has it.** LIST them rather than trusting a path
written here — worktrees get pruned, and this doc will outlive them:

```powershell
git -C D:\march-melee-pools worktree list
```

Then `Set-Location` to the one you pick.

### Step 1 — get current

Run every command below from the directory you chose in step 0.

```powershell
git fetch origin
```

```powershell
git checkout -b deploy-338 origin/main
```

**You should see:** `Switched to a new branch 'deploy-338'`.
**If it says the branch exists:** use a different name, e.g. `deploy-338b`.
Never `-B` — it force-resets an existing branch and silently discards its commits.

### Step 1a — the tree must be CLEAN before you deploy

```powershell
git status --short
```

**You should see NOTHING.** Empty output is the pass.

⚠️ **If anything is listed, stop and tell me.** `git checkout -b` CARRIES
compatible uncommitted changes along onto the new branch rather than discarding
them, and `firebase deploy` packages the WORKING TREE, not the commit. A dirty
tree means shipping something other than what CI reviewed.

### Step 1b — CONFIRM #338 IS ACTUALLY IN `origin/main` FIRST

```powershell
git log --oneline -3 origin/main
```

**You should see** a commit mentioning the reminder targets / #338 at or near the top.

⚠️ **Do not skip this.** If #338 has not merged, everything below still runs
happily and the second deploy reports **every function skipped** — because the
deployed code already matches. This runbook calls an all-Skipped run positive
evidence, so it would read as a clean deploy of code that was never deployed.
The all-Skipped check only proves anything once you know WHICH commit you are
deploying.

### Step 2 — install and build

```powershell
npm --prefix functions ci
```

**`ci`, not `install`** — install rewrites the lockfile and dirties the tree.

```powershell
npm --prefix functions run build
```

**You should see** it end with the `[copy-shared]` line and no `error TS`.

### Step 3 — deploy, twice

```powershell
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

**You should see** a long list ending `+ Deploy complete!`.

```powershell
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

**You should see** every function `Skipped (No changes detected)`. **That second run is the evidence** — it is what caught ten silently-stale functions on the #279 deploy.
**If any function still says `Successful update operation`:** run it a third time and tell me which.

### Step 4 — Coolify rebuild (REQUIRED for #338)

#338 changes `src/**`, so a rebuild is owed. Dashboard URL is in HANDOFF's STOP POINT box. Use the **Chrome extension**, not the in-app browser — the in-app one hits a login page.

**Verify it worked:**

```powershell
curl.exe -sSL https://www.marchmeleepools.com/ | Select-String -Pattern 'index-[A-Za-z0-9_-]+\.js'
```

**You should see** a hash that is **NOT** `index-Db6JwMWs.js`.

⚠️ **An unchanged hash is INCONCLUSIVE, not proof of failure.** Vite can emit a
byte-identical bundle when a `src/**` change is tree-shaken away or affects only
code paths that do not ship. This exact ambiguity is what made the App Check
timeline so hard to pin down — three rebuilds ran and the hash never moved. If
the hash is unchanged, **read the Coolify deployment log** and confirm the build
ran against the right commit, rather than concluding the deploy failed.

---

## 4. Task 2 — heartbeats UI, not started

Nothing was written. Task 3 consumed the session.

When it is picked up, one thing has changed since the task was written: **#333 added a `scorelessFinals` signal** to the score-sync heartbeat. The card should surface it — a `FINAL` game the feed reported no scores for is exactly the HOF-night condition that used to grade as a real 0-0.

The rest of the brief stands: read-only card on the SuperAdmin **Overview** tab (not the "Ops Health" card, which is monetization alerts), `findStaleJobs` already computes the verdicts server-side, respect the eight-tab invariant in CONTEXT.md, honest empty states, extend `tests/admin-surface-invariants.test.ts`.

---

## 5. State

- `origin/main` = `15a0c73` (+ `#336`). Functions deployed from `68d121b`; nothing under `functions/`, `shared/` or `firestore.rules` has changed since. Live bundle `index-Db6JwMWs.js`. **All three queues empty.**
- Open PRs: **#338** (yours), and the six rejected dependabot ones.
- `system/config.nflAutoScore` and `statsRecompute` still unset. Untouched.
- App Check still off. Untouched.
