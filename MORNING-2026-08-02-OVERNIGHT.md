# MORNING — 2026-08-02 (overnight session)

**You have nothing you must do.** Everything is merged, deployed and verified —
functions *and* frontend. §1 is the read-only evidence for the deploy, not a
runbook. Nothing in this document is an action.

**4 days to the HOF game (Thu 2026-08-06, 8:00pm ET, CAR at ARI).**

⚠️ **`MORNING-2026-08-02.md` (no `-OVERNIGHT`) is SUPERSEDED by this file.** It
was written earlier the same day and still says `4713eba` is deployed and that
#338 and #340 are open — all three untrue now. Same date, two files, and the
shorter name is the one a session reaches for first, so it now carries a banner
pointing here.

---

## 0. State — verified, not remembered

| Thing | State |
|---|---|
| Deployed application source | `22adb90` — this is what functions and the frontend were built from |
| `origin/main` tip | moved past `22adb90` after the docs merges (`befa54b`, then this PR). **Docs-only commits do not change what is deployed** — check with `git diff --name-only 22adb90..origin/main` before assuming a deploy is owed |
| Functions | **deployed from `22adb90`** — certified by a third run: 173 all `Skipped (No changes detected)`, 0 updates, 0 failures, `✔ Deploy complete!` |
| Rules | **≡ `0a705c0`**, unchanged. `firestore.rules` is byte-identical since |
| Frontend bundle | **`index-DlH8liQe.js`** — rebuilt 08:38 UTC, healthcheck `"healthy"` |
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

## 1. ✅ Coolify frontend rebuild — DONE

`src/**` changed in all three merged PRs, so three user-visible things were built
and not being served:

- the commissioner reminder UI (`NFLManagerView`, `NFLManagerBentoDashboard`) — the HOF-night nudge;
- the `MEMBER_NOT_ON_ROSTER` / `NOT_A_POOL_MEMBER` error copy;
- the SuperAdmin **Stale Jobs** tile.

**Rebuilt 2026-08-02 08:38 UTC.** App was already on `main` and `Running (healthy)`
before I touched it. Coolify reported `Deployment is Finished`, healthcheck
`"healthy"` on attempt 1 of 10, `Rolling update completed.`

**Verified from outside**, which is the evidence that counts. If you want to
re-check it yourself — **PowerShell 5.1 form**, since plain `curl` there is
`Invoke-WebRequest` and rejects `-sSL`, and `grep` does not exist:

```powershell
(curl.exe -sSL https://www.marchmeleepools.com/ | Select-String -Pattern 'index-[A-Za-z0-9_-]+\.js' -AllMatches).Matches.Value | Select-Object -First 1
```

`index-Bv2FV3GO.js` → **`index-DlH8liQe.js`**. I polled it across the deploy, so
the move is observed rather than inferred.

`VITE_RECAPTCHA_SITE_KEY` was not touched — I never opened the environment screen.

### ⚠️ I nearly handed this back to you on a false claim

The first version of this document told you the rebuild was yours because *"the
Coolify dashboard URL is written down nowhere in this repo"*. **That was wrong,
and qodo caught it on the PR.** `HANDOFF.md` records the dashboard URL —
`http://72.60.68.7:8000/project/.../application/.../deployment` — under the
heading *"Dashboard, for the next time a `src/**` change lands"*, which is
precisely this situation.

**How I got it wrong is the part worth keeping.** My first search filtered for
lines containing the word "coolify", and that URL is a bare IP with no such word.
My second search would have found it, but it ran long, was moved to the
background, and **I read its output while it was still empty and treated that as
a negative result.** An unfinished command is not evidence of absence — this repo
has a rule about exactly that, and I broke it while writing a document whose job
is to be trusted.

So: no repo change is needed, the URL was always there, and the reason you are
reading this instead of doing the rebuild is that a second reviewer checked a
claim I had already convinced myself of.

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

**A live example landed in this very PR.** codex found that I had updated the
content of PICKUP §2 to 2026-08-02 while leaving its heading reading *"Live
state (deploy state verified 2026-08-01)"*. That is the pattern, committed by
me, in the PR explaining why the naive test for it does not work — and it is
the shape the narrow rule should catch: **a heading that both names a state
(`Live state`, `deploy state verified`) and carries a date, above content
carrying a newer one.** Headings that merely record *when something was found*
have no state word and would be exempt, which is what kills the three false
positives above.

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
3. ~~The Coolify URL is recorded nowhere.~~ **False — retracted.** It is in
   `HANDOFF.md`. See §1 for how I got that wrong.

   ⚠️ Find it by SEARCHING, not by line number — codex caught me writing
   `HANDOFF.md:200` and the anchor had already rotted by two edits within this
   same PR:

   ```bash
   grep -n "72.60.68.7" HANDOFF.md
   ```

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

origin/main was 22adb90 (plus the docs PR #346). Functions deployed from 22adb90
(evidence: third run, 173 all "Skipped"). Rules ≡ 0a705c0. Bundle
index-DlH8liQe.js. ALL THREE QUEUES EMPTY unless a merge since touched a deploy
input. The COMPLETE set, because a wrong path name here is a change left
undeployed:
  functions deploy -> functions/, shared/
  rules deploy     -> firestore.rules, firestore.indexes.json  (no root rules/ dir)
  Coolify rebuild  -> src/, nginx.conf, Dockerfile, package.json, package-lock.json
An nginx.conf change does NOT move the bundle hash, so verify that class by
curling the response headers instead (PICKUP §4). Baselines at 22adb90: functions 1295, root
523, emulator 306. Coolify dashboard URL: grep -n "72.60.68.7" HANDOFF.md

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

TASK 1 — the docs-state-invariants widening is UNDONE and the analysis is in
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
