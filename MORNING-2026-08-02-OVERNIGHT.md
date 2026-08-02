# MORNING — 2026-08-02 (overnight session)

**You have exactly one thing to do, and it is blocked on you rather than
forgotten: the Coolify frontend rebuild.** Everything else is merged, deployed
and certified. The steps are in §1. Nothing else in this document is an action.

**4 days to the HOF game (Thu 2026-08-06, 8:00pm ET, CAR at ARI).**

---

## 0. State — verified, not remembered

| Thing | State |
|---|---|
| `origin/main` | `22adb90` |
| Functions | **deployed from `22adb90`** — certified by a third run: 173 all `Skipped (No changes detected)`, 0 updates, 0 failures, `✔ Deploy complete!` |
| Rules | **≡ `0a705c0`**, unchanged. `firestore.rules` is byte-identical since |
| Frontend bundle | **`index-Bv2FV3GO.js`** — ⛔ **STALE, rebuild owed** |
| Open PRs | dependabot #299–#304 only. All six still rejected; I did not touch them |
| Test baselines at `22adb90` | functions **1295**, root **523**, emulator **306** passed / 2 expected fail / 10 skipped |

### Merged overnight

| PR | What |
|---|---|
| [#344](https://github.com/kstruck/MMPoolsV3/pull/344) → `5baf23c` | `setPaidStatus` could mint a Member Record in **any** pool. Closed. |
| [#338](https://github.com/kstruck/MMPoolsV3/pull/338) → `d54b2e2` | The nudge reaches roster members now — **and** a forged Member Record is no longer a reminder target (§4a). |
| [#345](https://github.com/kstruck/MMPoolsV3/pull/345) → `22adb90` | The heartbeat verdicts finally render on the SuperAdmin card. |
| [#343](https://github.com/kstruck/MMPoolsV3/pull/343) → `befa54b` | Your morning doc from yesterday. qodo had never reported; it has now (§4). |

**[#340](https://github.com/kstruck/MMPoolsV3/pull/340) was CLOSED, not merged** — superseded. Its three plan documents already reached `main` inside #341 (`4713eba`) in a *newer* revision; `git diff` from that branch to `main` is +44/−5 on the plan and empty on the other two. Evidence is on the PR.

---

## 1. ⛔ THE ONE THING — Coolify frontend rebuild

`src/**` changed in all three merged PRs, so three user-visible things are built
and **not being served**:

- the commissioner reminder UI (`NFLManagerView`, `NFLManagerBentoDashboard`) — the HOF-night nudge;
- the `MEMBER_NOT_ON_ROSTER` / `NOT_A_POOL_MEMBER` error copy;
- the SuperAdmin **Stale Jobs** tile.

### Why I did not do it, plainly

You authorised the rebuild and I tried. **The Coolify dashboard URL is written
down nowhere in this repo** — I searched every tracked file and every skill; the
runbooks all say *"open the Coolify dashboard"* and never say where it is. I
tried one guessed hostname, it did not resolve, and I stopped rather than probe
your infrastructure by trial and error.

**One-line fix worth making while you are in there:** put the URL in
`.claude/skills/mmp-deploy-and-operate/SKILL.md` next to the manual-trigger note.
Then a future session can do this without you.

### Steps

1. Open the **Coolify dashboard** (your bookmark).
2. Select the **`www`** application.
3. Confirm **Source** is `main` — not a feature branch. If it is anything else, **stop and tell me.**
4. Confirm the commit it will build is **`22adb90`** or later.
5. Click **Redeploy**.
6. Wait for the container healthcheck to go green / "running" — usually 2–4 minutes.
7. **Verify** in a terminal:

```bash
curl -sSL https://www.marchmeleepools.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

8. **Expected:** a hash that is **NOT** `index-Bv2FV3GO.js`. Any different hash means it worked.
9. **If it still says `index-Bv2FV3GO.js`:** hard-refresh is irrelevant here (curl has no cache), so that means the build did not pick up the new commit. Check the Coolify build log for the SHA it checked out, and tell me — do not re-trigger blindly.
10. **Do NOT set `VITE_RECAPTCHA_SITE_KEY`** while you are in the environment screen. That variable preceded the 2026-07-30 production outage and its absence is the safe state.
11. When it passes, tell me and I will move the deploy-state markers in a PR. Do not hand-edit them.

---

## 2. What shipped, and the one finding that nearly undid it

### #344 — anyone could put themselves on any pool's roster

`setPaidStatus`'s self-report branch checked only *"are you claiming for
yourself?"*. `set(..., {merge:true})` **creates** the document, and a Member
Record is roster truth — so any authenticated user could mint
`pools/{anyPool}/members/{their-uid}` and land on that pool's roster, its
`memberCount`, its dues figures and its reminder emails.

The guard is the two checks PLAN-SETPAIDSTATUS-MEMBERSHIP §4 specifies — a
**canonical** Member Record (server-seeded `joinedAt`) or `participantIds` minus
the `"guest"` sentinel — read inside the transaction that does the write. **No
third check**; the plan's rejected squares-ownership branch is now guarded by a
source invariant that fails if anyone adds it back.

### #338 — and why #344 alone did not close it

Refusing a *future* forgery does nothing about one already written.
`resolveReminderTargets` accepted **every** document in the members collection
and resolved its uid to an email. So #338 carries the same discriminator, which
now lives in `shared/memberRecord.ts` and is used by **both** doors — one refuses
new forgeries, the other refuses old ones, and if they drifted one door would be
open. A test fails if either file inlines its own copy.

### 🔴 The finding worth reading

codex round 1 on #338: `sendManualReminder` mapped each member snapshot to
`{ id, userName }` before calling the resolver — **stripping the discriminator**.
Every genuine roster member would have arrived looking forged and been dropped,
which is *precisely the bug the PR exists to fix*, reintroduced one commit after
fixing it.

**All 79 unit tests stayed green**, because they call the pure function directly.

Two consequences, both now in the repo:

1. `joinedAt` is **required** on the parameter type, so that projection no longer
   compiles (mutation-verified: optional ⇒ 0 errors, required ⇒ TS2345);
2. there is now an **emulator test of the real callable** asserting which
   addresses land in the `mail` collection. A pure-function test is not coverage
   of a call site, and this repo now has a test that says so.

### #345 — the verdicts existed; nothing rendered them

I verified your premise before writing code and it held: `getOpsHealthSummary`
has always returned `staleJobs`; the client interface just omitted the field. So
this was a rendering change and **no second reader was built**.

codex then found a real bug **in the code I was only displaying**: on a failed
heartbeat read, `computeOpsHealthSummary` fell back to `{}`, which `findStaleJobs`
reports as *"every job has never run"* — the log said "liveness unknown" while
the payload said "everything is dead". Invisible while nothing rendered it; one
transient read failure from a full false incident the moment something did. The
field is now **omitted** on a read failure and the card says **"Unknown"**.

---

## 3. Task 3 — NOT done, and here is the measurement so you do not re-derive it

You asked me to widen `tests/docs-state-invariants.test.ts` to catch
prose-vs-tag drift. **I did not ship it, deliberately.**

The obvious mechanical rule — *a heading's date must not be older than the newest
date inside its section* — **cries wolf on the current docs**. Measured:

| Heading | Why the rule fires — and why it is wrong |
|---|---|
| `KNOWN OPEN, found while verifying this deploy (2026-07-28)` | section contains `2026-07-30` |
| `Pool Manager surface defects — Kevin's walkthrough 2026-07-29` | section contains `2026-07-30` |
| `NEW, found 2026-07-30 while fixing the ledger` | section contains `2026-07-31` |

All three are headings about **when something was found**, and a later date
inside is a legitimate later note. This repo has twice written down that an
invariant which cries wolf gets ignored and then the real one is missed — so
shipping this rule would have been worse than shipping nothing.

**The real target is narrower:** a heading that asserts a *current state*
(`OWED`, `PENDING`, `BLOCKED`) sitting above content that says the opposite. That
needs a closed vocabulary of state words and a same-subject test, and it is a
design problem rather than a regex. qodo independently suggested the same thing
on #343 (*"expand docs-state-invariants to catch repeated-state claims"*), so
there are two votes for it being worth doing properly.

**What I did instead**, which is the cheaper half of the same goal: this session's
deploy-state edits **replace** the stale claims rather than stacking a note above
them, and the STOP POINT box now says in the box itself that it must be replaced
rather than annotated. That is the failure mode #343 identified.

---

## 4. Process finding — qodo CAN be made to re-review, and it matters

Recorded in `.claude/skills/mmp-qodo-cycle/SKILL.md` in this PR.

The skill said qodo does not re-review after a push and that gating on a second
pass is unsatisfiable. Both halves of that held again tonight — **and there is a
way around it.** qodo skips DRAFT PRs, so the transition into ready is what fires
it, and **the same transition re-fires it on a PR that is already open:**

```bash
gh pr ready <N> --undo
gh pr ready <N>
```

Measured **three times** (#338, #345, #343): a push produced nothing, and the
toggle produced a fresh review stamped at the current head within ~90 seconds.

This is not convenience. #338 was rebased and gained a substantial new change;
without a re-review the only qodo evidence available was a report on the
*pre-rebase* diff, and merging on it would have meant calling the mandatory gate
satisfied with a review of code no longer in the PR. #343 had **never** been
reviewed at all — which is why you did not merge it yesterday.

The rule is unchanged: a timeout after the toggle is still "qodo did not
re-review", never "clean".

---

## 5. Untouched, on purpose

- **Dependabot #299–#304** — all six still open and still rejected.
- **App Check** — `VITE_RECAPTCHA_SITE_KEY` not set. The warning is the safe state.
- **`SECURITY-CLAIM-SQUARES.md`** — the squares-theft hole stays open by your standing decision (HANDOFF §5). #344/#338 stop it being laundered into *membership*; they do not close it.
- **`system/config.nflAutoScore` and `statsRecompute`** — still unset, still disabled.
- **No production data was written.** Both fixes are code-only by design; the cleanup of any already-forged records is a Rule 1 prod-data mutation and is yours.

---

## 6. Residuals I am carrying, stated rather than buried

1. **A forged Member Record still appears** on the commissioner's roster UI and in `memberCount`. §4a covers reminder targeting only. Cleanup is a prod-data sweep (§7 of the plan) and is yours to run.
2. **If a *legitimate* claim-only record exists in production**, that member is unreachable by nudge until they act. codex raised this twice; I rejected it on the population — no code path has ever created such a record, because the self-report has **no client caller** (`git log --all -S"claim: true" -- src/` is empty). The full argument is written into the code at the filter, not just here.
3. **The Coolify URL is recorded nowhere** (§1).

---

## 7. Copy-paste prompt for the next session

```
Continue March Melee Pools. Repo D:\march-melee-pools — work in fresh worktree
branches off origin/main.

⏰ HOF GAME 2026-08-06. Prioritise by "does this break the pilot".

READ FIRST: CLAUDE.md, HANDOFF.md STOP POINT box, PICKUP-PRESEASON-PILOT.md §0,
and MORNING-2026-08-02-OVERNIGHT.md.

STATE — VERIFY, DO NOT TRUST:
  git log --oneline -3 origin/main
  gh pr list
  curl -sSL https://www.marchmeleepools.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'

origin/main was 22adb90. Functions deployed from 22adb90 (evidence: third run,
173 all "Skipped"). Rules ≡ 0a705c0. Bundle index-Bv2FV3GO.js — ⛔ A COOLIFY
REBUILD WAS OWED; if the hash has moved, Kevin ran it and the frontend queue is
empty. Baselines at 22adb90: functions 1295, root 523, emulator 306.

⛔ Dependabot #299–#304: do NOT merge, all six rejected with evidence.
⛔ APP CHECK: do NOT set VITE_RECAPTCHA_SITE_KEY. The warning is the safe state.
⛔ SQUARES: SECURITY-CLAIM-SQUARES.md is a KNOWN hole, accepted through the
   pilot by standing decision (HANDOFF §5). Do NOT start it.
⛔ system/config.nflAutoScore + statsRecompute UNSET = disabled. Leave them.

QODO IS ON — check all three surfaces on every PR. If a push does not trigger a
re-review, toggle draft→ready (gh pr ready N --undo; gh pr ready N); it fires
within ~90s. A timeout after that is "qodo did not review", never "clean".

AUTONOMY: merge your own PRs when 7/7 CI + codex clean + qodo resolved + your
read agrees; a PR carrying an unresolved finding is Kevin's. Deploy functions
when needed (npm --prefix functions ci, NOT install; expect HTTP 429 partway
through a full-fleet run — re-run until a pass reports 173 all-Skipped, and
treat only that run as the certification). No prod-data writes, no arming jobs,
no dependabot.

TASK 1 — Task 3 from last night is UNDONE and the analysis is in
MORNING-2026-08-02-OVERNIGHT.md §3: the naive heading-date rule cries wolf on
three real headings, so it needs a closed vocabulary of state words instead.
Read §3 before designing it.

RULES: gates per PR (functions build/typecheck/test, emulator, tsc -b, npm test,
lint 0 errors). NOTE `functions npm run typecheck` is a REQUIRED CI job that
`npm run build` does NOT cover — codex caught a TS2559 that way. codex exec
review --base origin/main, three-dot scope check, -b never -B, up to 10 rounds.
MUTATION-TEST EVERY GUARD, and ANCHOR the mutant — I mis-targeted two mutants
this session by string-matching an argument that appeared in an earlier call.
COMMIT BEFORE MUTATION LOOPS — `git checkout` in a mutation loop silently
discarded an uncommitted fix twice. Known flake: opsAlertDispatcher.test.ts.
```
