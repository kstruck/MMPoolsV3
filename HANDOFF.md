# HANDOFF — Session entry point

> ## 🟢 2026-09-08 — **HANDOFF.md CUT FROM 4,206 LINES TO A HANDOFF. HISTORY MOVED TO `docs/archive/`, VERBATIM. NO CODE, NO DEPLOY, NO PROD DATA TOUCHED.**
>
> - Everything older than the 2026-08-26 box — the 2026-08-25 launch-day box
>   back through the 2026-07-17 Phase-2 notes and the July "Next-effort menu" —
>   now lives in
>   [docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md](docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md)
>   with its TEXT unchanged and exactly 11 markdown link destinations
>   rewritten (`../../` prefix, so they resolve from `docs/archive/`); nothing
>   was reworded. Reproducible: the moved range and the archived body hash the
>   same at the move commit —
>   `git show fdea3c8e:HANDOFF.md | sed -n '271,4184p' | md5sum` and
>   `git show 406ee3ee:docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md | tail -n +18 | md5sum`
>   both print `3a541bd212e9d202844dad6eab34e7c5`; the link rewrite is the
>   whole of `git diff 406ee3ee ffa28a1c -- docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md`
>   (11 links + the header sentence that says so); a Box index was added to
>   the archive header afterwards. `tests/docs-state-invariants.test.ts` scans
>   `docs/` two levels deep, so every guard that held on those boxes here still
>   holds on them there.
> - Why: this file is read at the start of every session, and ~3,900 lines of
>   stacked stop-point boxes spent context before any work began. The
>   permanent App Check warning that used to live in the 2026-07-30 box is
>   restated in **Standing warnings** below so it is never archived.
> - **The 2026-09-01 box below is stale on one point.** The trust-boundary
>   remediation it calls "UNCOMMITTED" merged the same day as
>   [#654](https://github.com/kstruck/MMPoolsV3/pull/654). #654 has TWO deploy
>   halves and this PR verifies NEITHER; the tagged live SHA in the 2026-08-26
>   box is unchanged and has not been re-checked since it was written.
>   1. **Functions — MEASURED 2026-09-09, NOT DEPLOYED, DEPLOY OWED.** #654
>      changed 20+ existing callables and added NO new export, so
>      `functions:list` by name proves nothing (the 2026-08-26 box says why).
>      The timestamp method does answer the cheaper question: `npx firebase
>      functions:list --json --project gridiron-gamble-uzuqo`, read every
>      `source.storageSource.generation` (microseconds; ÷1000 for epoch ms) —
>      195 functions, 192 with a timestamp, latest upload
>      **2026-08-31T01:34:30Z**, **zero** uploads after 2026-09-01. #654 merged
>      2026-09-01, so nothing from it is in production. The deploy that ships
>      it is CLAUDE.md §3's ritual from `D:\march-melee-pools` at `origin/main`
>      (`npm --prefix functions ci`, then `npx firebase deploy --only functions
>      --project gridiron-gamble-uzuqo`); the same run is the certification —
>      re-run it afterwards and every function must print
>      `Skipped (No changes detected)`. Kevin action (a session's deploy was
>      refused by the permission classifier on 2026-09-09).
>   2. **Frontend — MEASURED 2026-09-09, PRESENT, nothing owed.** #654 also
>      changed `src/components/admin/OperationsPanel.tsx` (the paged runner for
>      `backfillPools` / `fixParticipantIds`). Coolify's deployment history shows
>      a Success build at `fdea3c8e` (#674, ten hours before this check), which
>      is after #654, and the live bundle agrees: needle `oversizedPools` (absent
>      from `src/` before #654, present after; a property name, so it survives
>      minification) is in `assets/SuperAdmin-DRh4aHr0.js`, found by crawling
>      all 113 JS chunks reachable from `index-D7S5x1zU.js`. ⚠️ A one-level
>      check of `index-*.js` alone reported ABSENT — the panel is code-split
>      into the SuperAdmin chunk — which is the same false-ABSENT the 2026-08-26
>      box warned about. Crawl recursively; never conclude from the index chunk.
> - Merged to `main` 2026-09-01 → 2026-09-08, besides #654: #655 and #661
>   (lockfile-only advisories), #656 (this file: ruleset restore command),
>   #653 (docs cleanup), #666 (draft plan), #664 (lint required check),
>   #665 (archive guard in CI), #667 (tailwindcss-animate, `src/` only),
>   #674 (sitemap dates). Only #654 touches `functions/src/` — measured, not
>   asserted: `git log fdea3c8e --since=2026-08-31 --format=%h -- functions/src`
>   prints exactly one commit, `4404a45e` (#654); the same command on
>   `functions/` adds only `96acd181` (#655, lockfile). Re-run it from a
>   fetched checkout if `main` has moved since `fdea3c8e`.

> ## 🟡 2026-09-01 — **API TRUST-BOUNDARY REMEDIATION IS CODE-COMPLETE AND UNCOMMITTED IN THE MAIN CHECKOUT. NOT COMMITTED, NOT DEPLOYED, NO PROD DATA TOUCHED.**
>
> The codex API audit's four remaining failures are fixed on the working tree
> (47 files, +768/−202) under the full Rule-3 gate:
> [PLAN-API-TRUST-BOUNDARY-REMEDIATION.md](PLAN-API-TRUST-BOUNDARY-REMEDIATION.md)
> (+ -REVIEW-LOG: plan APPROVED codex round 8 of 10, 23 findings, 1 reasoned
> rejection; implementation diff clean at codex round 2; + -SWEEPS: complete
> grep-derived instance lists).
>
> **What changed, one line each:**
> 1. **Safe errors** — new `lib/safeError.ts`; 13 sites no longer send a caught
>    `error.message` to clients (incl. Stripe checkout, getPoolQuote,
>    simulateGameUpdate — which also now passes expected HttpsErrors through
>    instead of re-wrapping them as `internal`). Source invariant in
>    `__tests__/apiTrustBoundary.test.ts`.
> 2. **Input validation** — named schemas kill the null-payload crash class
>    (simulateGameUpdate, createBracketPool, aiTesting ×3,
>    refreshExpertProfiles); `rawCallableExceptions.test.ts` enforces the
>    26-entry reviewed raw-`onCall` allowlist.
> 3. **Authorization** — every remaining claim-only/doc-only SUPER_ADMIN
>    decision now resolves claim+`users/{uid}.role`: simHarness (11),
>    simLegacy (3), setPaidStatus, bracketEntries, payoutRecords ×2,
>    squares ×3, coCommissioners, nflEntryDelete/Rename, submitNFLPicks +
>    rebuy contexts, both sim-mint gates, 8 helper call sites
>    (invites/manualReminders/poolParams/updatePoolSettings/poolExceptions ×4
>    incl. closePool), and the two privileged HTTP endpoints
>    (`inspectPoolState`, `testSmsHttp` via new `confirmedSuperAdminHttp`).
> 4. **Bounded reads** — backfillPools + fixParticipantIds are paged
>    (25/run, 10k inner cap, 5k write budget, mode-bound cursors,
>    OperationsPanel auto-continues); **backfillPools live runs now require
>    `system/config.backfillPools.enabled === true`** (dry runs unaffected);
>    siteAverages pages with abort-on-cap; getPoolPicks gets a 2k-entry +
>    8MB-UTF-8 loud-overflow ceiling (reveal privacy boundary untouched).
>
> **Gate evidence (all run 2026-09-01):** root 3076/3076 · functions
> 2195/2195 (134 files) · emulator 607 passed / 2 expected fail / 10 skipped /
> 0 failed (9 fixture files updated to seed `users/{uid}` docs — claim+doc now
> applies to sim tooling) · rules 13/13 files · both typechecks + both builds
> exit 0 · lint 1871 (baseline 1872 — delta ≤ 0).
>
> ✅ **KEVIN RULED Q1–Q3 (2026-09-01), all as recommended:** Q1 kill-switch
> KEPT (live backfillPools runs need `system/config.backfillPools.enabled =
> true` — flip in the Firebase console when a live run is wanted), Q2
> fixPoolScores global-default deferred to its own future plan (tracked in
> TOMORROW-TASKS.md), Q3 reveal/repair ceilings APPROVED. No code change
> needed — the implementation already matches all three.
>
> 🛑 **DELIBERATELY NOT DONE:** no commit, no PR, no deploy, no rules change,
> no backfill run. Deploy, when authorized, is functions-only + a Coolify
> rebuild (OperationsPanel changed).

> ## 🟡 2026-08-27 (later) — **TWO PRs OPEN AND GREEN: #611 (tiebreaker) AND #612 (a duplicate money event). NEITHER MERGED. ONE PLAN NEEDS KEVIN'S SIGN-OFF (#613).**
>
> **#609 MERGED** as `a85c6fbf`, and the **functions deploy landed** —
> `getPoolDues` is live, verified by name:
> `npx firebase functions:list --project gridiron-gamble-uzuqo | Select-String "getPoolDues"`
> returns one row. The Phase 2 deploy is no longer owed.
>
> ### [#611](https://github.com/kstruck/MMPoolsV3/pull/611) — the Monday-less tiebreaker (Kevin ruled A & D)
>
> A legacy `MNF_COMBINED` pool (absent `settings.weeklyTiebreaker`) on a week
> with no Monday game rendered **no tiebreaker input** while the rules page
> promised the closest prediction wins. Seen in prod on a preseason slate:
> 16/16 picks saved, no input. 4 codex rounds, 4 findings, all fixed; round 4
> clean. CI 9/9.
>
> 🛑 **IT DOES NOT RESTORE THE WEEK IN THE SCREENSHOT.** That week froze `[]` on
> its first submission and the freeze is kept ON PURPOSE — adding a target under
> members who already submitted is the harm it exists to prevent. The fix applies
> from the next unfrozen week. Option C (clearing a frozen empty target) is **not
> signed** and not built.
>
> **Deploy: functions + a Coolify rebuild** (`src/` changed). No rules deploy.
>
> ### [#612](https://github.com/kstruck/MMPoolsV3/pull/612) — codex round 11 on `6f15ec54` was NOT clean
>
> Kevin authorised the over-cap round; it found a **P1**. #609's `staleFullyPaid`
> repair fell through into the promotion transaction, which always appends a
> `MARKED_PAID` — so repairing a stale FLAG appended a **second money event for
> one payment** into the participant-readable ledger, and overwrote the dues
> row's original method/note. Now writes the summary only, reported as
> `staleSummariesRepaired`. 3 rounds, round 3 clean. CI 9/9.
>
> **#609's PR body flags `6f15ec54` as un-reviewed — that flag can now be
> replaced with #612.**
>
> ⚠️ **GATE-LIST GAP, MEASURED.** #612 round 2 found a **red `npm --prefix
> functions run typecheck`** that every gate in the standing five-gate list was
> green on. `npx tsc -b` at the root does **not** typecheck `functions/`. Add
> `npm --prefix functions run typecheck` and `npm --prefix functions run build`
> to the list. #611 was re-checked against both and is clean.
>
> ### [#613](https://github.com/kstruck/MMPoolsV3/pull/613) — PLAN only, BLOCKED ON KEVIN
>
> The partial-payment under-count (finding #1 carried out of #609). Kevin ruled
> **Option A** (mirror a `paidEntryCount`). **D2–D5 are open and no code is
> written until they are signed** — Rule 3 step 5.
>
> ### ✅ `nflDeepSweep` IS NOW VERIFIED — `{enabled: TRUE, dryRun: TRUE}`
>
> Read from the Firebase console by Kevin, 2026-08-27. **Half-armed, and that is
> the designed stage 1.** `nflSchedule.ts:1387-1389` is explicit: dry-run still
> DETECTS and REPORTS corrections and only suppresses the `nfl_games` write, "so
> the alarm can be observed for a week before the writes are armed."
>
> So `nflDeepScoreSweepJob` **is running** daily (`30 11 * * *`) and **is
> finding** anything it finds — but a FINAL or a scoring correction arriving >24h
> after kickoff is still **never applied**. Stage 2 is `dryRun: false`, and the
> gate for it is reading the job's own log line first:
>
> ```
> npx firebase functions:log --only nflDeepScoreSweepJob --project gridiron-gamble-uzuqo
> ```
>
> The line to look for is `Nd sweep: N slate(s), N correction(s), N game(s)
> written.` **`correction(s)` is the number that decides.** Zero for several days
> ⇒ arming writes is low-risk. Non-zero ⇒ read WHICH games before arming, because
> those writes will rescore finished weeks.
>
> ⚠️ This session could NOT read it directly: the machine has a `firebase` CLI
> login but no Application Default Credentials, so a Firestore read fails with
> `Could not load the default credentials`. Console or `functions:log` only.

> ## 🟡 2026-08-27 (latest) — **PHASE 2 IS CODE-COMPLETE. T3–T7 SHIPPED AS #603–#609. #609 IS OPEN AND GREEN, NOT MERGED.**
>
> **Merged overnight:** #603, #604 (T3), #605 (T5a), #606 (T5b), #607 (T6), #608.
> **Open:** [#609](https://github.com/kstruck/MMPoolsV3/pull/609) — **P2-T7**, the
> last ticket. All 9 CI checks green. Needs Kevin: merge, then a functions deploy.
>
> 🛑 **A FUNCTIONS DEPLOY IS OWED once #609 merges** — `reconcilePaymentTruth`,
> `getPoolDues`, `lib/poolDues`. `getPoolDues` is a NEW callable, so for once the
> verify-by-name check DOES work:
>
> ```
> npx firebase functions:list | Select-String "getPoolDues"
> ```
>
> **No Coolify rebuild for #609** (no `src/` change). One IS still owed for #607
> and #608, which changed the ledger UI.
>
> 🔴 **#609 CARRIES ONE OPEN FINDING AND ONE OPEN DECISION. Both are in the PR
> body; neither blocks the merge.**
>
> 1. **The partial-payment under-count.** Three aggregate money surfaces
>    (`shared/memberRecord.ts:487`, `src/utils/poolRoster.ts:387,432`) treat a
>    partially paid member as having paid nothing, because they read the
>    all-or-nothing summary and Phase 2 made partial payment representable for the
>    first time. It reaches the **world-readable** `stats/global.prizePot`.
>    Direction is an UNDER-count. Every fix changes a money figure or adds a field
>    to a participant-readable document, so it is a Rule 3 plan decision — three
>    options in `PLAN-MULTI-ENTRY-DUES-SWEEPS.md` §7, pinned by a test so it
>    cannot be lost.
> 2. **Commit `6f15ec54` is past the 10-round codex cap and un-reviewed.** Round
>    10 came back clean; self-review then found the round-8 fix was inert in
>    production. The repair is tested and mutation-caught but has had no codex
>    round. CLAUDE.md §2c needs Kevin's sign-off for round 11.
>
> **`firestore.rules` is untouched across all of Phase 2** (D11), verified by
> `git log e6882d21..origin/main -- firestore.rules` being empty. **No rules
> deploy at any point in Phase 2.**


> ## 🟢 2026-08-26 (latest) — **PER-ENTRY DUES PHASE 2 T1+T2 ARE MERGED AND DEPLOYED. #599–#602 IN. FUNCTIONS DEPLOY VERIFIED BY SOURCE TIMESTAMP, NOT BY `Deploy complete!`.**
>
> **Functions are deployed from <!-- deploy-state:current --> `main` @ `6d92dc61`.**
> ⚠️ Updated 2026-08-26 evening — Kevin deployed after #602 merged. The previous
> tagged claim, `e6882d21`, is now `<!-- deploy-state:ignore -->`.
>
> 🛑 **THIS DEPLOY ADDED NO NEW CALLABLE, SO THE USUAL VERIFY-BY-NAME DOES NOT
> WORK — AND THAT IS A TRAP WORTH WRITING DOWN.** CLAUDE.md §3 says an absent
> function is the tell. #601 and #602 changed `setPaidStatus`, `lib/multiEntry.ts`
> and `shared/`, and added `lib/poolDues.ts` — a lib, not an export. `git diff
> origin/main~2 origin/main -- functions/src/index.ts` shows **no export change at
> all**, so `functions:list | Select-String` would return the same rows before and
> after and prove nothing.
>
> ✅ **WHAT DOES PROVE IT: the source-upload timestamp.**
>
> ```
> npx firebase functions:list --json
> ```
>
> Every v2 function carries `source.storageSource.generation` — a MICROSECOND
> timestamp of when its source zip was uploaded. Divide by 1000 for epoch ms.
> Compare it against the merge time and the question is settled:
>
> | Function | Source uploaded | vs #602 merge (13:42:45Z) |
> |---|---|---|
> | `setPaidStatus` | 2026-08-26T13:52:01Z | **AFTER** |
> | `submitNFLPicks` | 2026-08-26T13:51:45Z | **AFTER** |
> | `proxyPick` | 2026-08-26T13:52:39Z | **AFTER** |
> | `renameNFLEntry` | 2026-08-26T13:51:50Z | **AFTER** |
>
> **189 of 190 functions re-uploaded after the merge.** The one that did not is
> `ext-firestore-send-email-processqueue` — a Firebase EXTENSION, updated by the
> extension and not by `deploy --only functions`, so its December 2025 source is
> correct and expected. Three more report no source field at all
> (`createParticipantProfile`, `onAnnouncementCreated`, `onUserCreated`): they are
> `gcfv1`, and the v1 API does not expose `storageSource`.
>
> 🛑 **WHAT THIS PROVES, AND WHAT IT DOES NOT — STATED BECAUSE THE GAP IS THE
> WHOLE FAILURE MODE.** The timestamps prove a deploy RAN, after the merge, and
> re-uploaded essentially the whole fleet. **They do NOT bind that zip to
> `6d92dc61`.** A deploy run from a STALE CHECKOUT produces exactly the same
> timestamps — and that is precisely the failure CLAUDE.md §3 exists for, the one
> that has silently shipped nothing twice. So the tagged SHA above rests on the
> timestamps **plus** Kevin having pulled before deploying, not on the timestamps
> alone. (Found by cross-model review of this very box, which had claimed more
> than the evidence carried.)
>
> ✅ **THE UPGRADE, WHEN CERTAINTY IS WANTED — and this repo already has the
> standard for it.** Every function carries a CONTENT hash:
>
> ```
> labels."firebase-functions-hash"   e.g. setPaidStatus = 5ae3837134853ad9…
> ```
>
> `firebase deploy` compares that hash and skips what has not changed. So a
> SECOND deploy from a checkout at the intended commit, reporting every function
> `Skipped (No changes detected)`, is the certification — **the all-Skipped run is
> the evidence, not the absence of an error.** That is the same bar the
> 2026-07-28 box below records. It is a Kevin action (a no-op deploy), cheap, and
> the only thing that closes the gap above.
>
> **Use the timestamp method whenever a deploy adds no new export** — a rename, a
> bug fix or a refactor is exactly the shape that cannot be verified by name — but
> record it for what it is: evidence a deploy happened, not proof of which commit
> it carried.
>
> **RULES ARE *NOT* AT THIS COMMIT** and that is deliberate and unchanged:
> `firestore.rules` has not changed since #579, whose rules deploy Kevin ran on
> 2026-08-25. Do not read "functions are at `6d92dc61`" as "everything is".
>
> ✅ **FRONTEND: BOTH MERGES ARE LIVE.** Kevin's Coolify rebuild at ~03:20Z on
> 2026-08-26 carried #597 AND #598. Verified by a recursive chunk crawl —
> **116 chunks fetched**, seeded from `index` and searching `index` itself:
>
> | String | Verdict | Chunk | From |
> |---|---|---|---|
> | `renameNFLEntry` | PRESENT | `index-DR2gWNnz.js`, `PoolRoute-TGFaQu44.js` | #597 |
> | `Rename this entry` | PRESENT | `PoolRoute-TGFaQu44.js` | #597 |
> | `LXI` | PRESENT | `index-DR2gWNnz.js` | #598 |
> | `2027-02-14T16:30:00-07:00` | PRESENT | `index-DR2gWNnz.js` | #598 |
> | `America/Denver` | PRESENT | `index-DR2gWNnz.js` | #598 |
> | `Sep 10` | **ABSENT** *(negative control — #598 deleted it)* | — | pre-#598 |
>
> 🛑 **A NEEDLE THAT IS A TEMPLATE LITERAL CAN NEVER BE FOUND, AND THIS SESSION
> PRODUCED THAT FALSE ABSENT BEFORE CATCHING IT.** The first crawl searched for
> `Super Bowl LXI` and reported **ABSENT** on a build that was in fact correct.
> The string does not exist in the source: `season.ts` defines
> ``SUPER_BOWL_TITLE = `Super Bowl ${SUPER_BOWL_NUMERAL}` `` and the minifier does
> not fold it, so the bundle holds `"Super Bowl "` and `"LXI"` as separate
> operands. **Pick needles that are whole string literals in the source** — here
> `LXI` and the ISO date — and read the source to confirm the literal exists
> before trusting either verdict.
>
> 🛑 **AND CARRY A NEGATIVE CONTROL.** `Sep 10` is the string #598 DELETED. Its
> absence, alongside the new strings' presence, distinguishes "the new build
> shipped" from "my crawl finds nothing anywhere" — which is the failure mode the
> template-literal miss had already demonstrated is easy to hit. A crawl that
> reports only ABSENTs has not proven a stale deploy; it has proven nothing.
>
> ⚠️ **The 2026-08-25 crawl guidance below still stands and was followed**: crawl
> RECURSIVELY, seed from `index`, and search `index` itself. A one-level scan
> produced a false ABSENT on 2026-08-25.

---

## Standing warnings — never archive these

- **App Check took production down on 2026-07-30. DO NOT SET
  `VITE_RECAPTCHA_SITE_KEY` in the Coolify build environment.** Its absence
  makes `src/firebase.ts` skip App Check, and every prod bundle logs
  `⚠️ SECURITY: App Check is NOT active` — that warning is the correct, safe
  state. Leave it. Setting the variable and rebuilding hung the site on a
  spinner from two machines on two networks; the rollback was deleting the
  variable and rebuilding again. Full account, including the still-unresolved
  bundle-hash timeline, is in the archived 2026-07-30 box
  (`docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md`).
  `tests/docs-state-invariants.test.ts` fails if this warning leaves this file.
- **Any review requirement on `main` MUST keep "Repository admin" in the
  ruleset's bypass list, or every PR in the repo deadlocks.** Every PR is
  authored by the `kstruck` account, GitHub never lets an author approve their
  own PR, and every session's tooling authenticates as that same account — so
  a required review with no bypass actor is unsatisfiable. It deadlocked the
  repo on 2026-08-25 (#585) and again on 2026-09-01 (#655), when
  `bypass_actors` was found empty with no known editor. Verify any time:
  `gh api repos/kstruck/MMPoolsV3/rulesets/11714546 --jq '.bypass_actors'`
  (an empty array = the deadlock is back). Restore with ONE command that
  re-reads the ruleset, sets the bypass list, and PUTs the whole object back
  so no other setting is dropped (bash; the read half was exercised on
  2026-09-08, the PUT was not because the bypass was present that day):

  ```bash
  gh api repos/kstruck/MMPoolsV3/rulesets/11714546 \
    --jq '.bypass_actors=[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}] | {name,target,enforcement,bypass_actors,conditions,rules}' \
    | gh api -X PUT repos/kstruck/MMPoolsV3/rulesets/11714546 --input -
  ```

  Then re-run the verify command; it must print the one-element array.
  ⚠️ `docs/archive/NEXT-SESSION-AUDIT-FIXES.md` (archived by the 2026-09-09
  cleanup, still readable) lists "remove the Repository admin bypass actor" as
  an optional task; doing that recreates the deadlock. Do not.
  The full 2026-08-25 and 2026-09-01 accounts are in the archived history.
- **Never `git reset --hard` or `git clean` in `D:\march-melee-pools`.** That
  is the main checkout and other sessions leave uncommitted work in it. The
  2026-08-25 box warned of 351 uncommitted changes there (an archive pass);
  that pass shipped as #653 and is gone, but the rule outlives it — measured
  2026-09-08: `git -C D:\march-melee-pools status --short` shows 4 entries
  (a modified `src/components/LandingPage.tsx`, an untracked
  `src/components/prototype/`, a dev-UI script and a review doc), none of
  them yours to discard. Set work aside with a WIP commit or a tagged stash,
  never a reset. `.gitattributes` renormalise steps
  (`git rm --cached -r . && git reset --hard`) are Kevin's, in a clean tree.
- **Firebase Auth has NO effective backup.** The code shipped (#575:
  `authBackupJob` weekly, `runAuthBackup` on demand) but is gated on
  `system/config.authBackup.enabled === true` plus a bucket, and it is not
  armed — measured 2026-09-06 in `npx firebase functions:log --only
  authBackupJob`: `[authBackupJob] disabled (system/config.authBackup.enabled
  !== true); nothing to do.` Firestore has 7-day PITR; user accounts, emails
  and password hashes do not. Do not read "backup job deployed" as "backed
  up". Arming steps and the bucket work are in `PLAN-BACKUPS-PHASE3.md`.
- **`claimMySquares` is still an open security hole, and the repo is public.**
  `guestDeviceKey` is a bearer token written onto each square inside the
  publicly readable `pools/{poolId}` document; the claim check is one equality
  test, so anyone who opens a share link can claim an unclaimed guest square.
  Full write-up and the correct repair (reserve path, two claim callables, a
  live-data migration): `SECURITY-CLAIM-SQUARES.md` — status there is still
  "open, unfixed". Evidence, re-runnable: `git log --format=%h --
  SECURITY-CLAIM-SQUARES.md` prints one commit, `9e7411e2` (#233, 2026-07-20);
  the equality check is still `s.guestDeviceKey === guestDeviceKey` at
  `functions/src/participant.ts:115`; `git log 9e7411e2..origin/main --
  functions/src/participant.ts` shows three later commits (#341 ownership
  laundering, `f4ec2754` maxInstances, `f7fe7dfd` member removal), none of
  which touches that check. The decision on file (2026-07-2x box, archived):
  accept through the preseason pilot, fix before Squares carry real entry
  money again. What limits the blast radius today: Squares pool CREATION is
  switched off — `SQUARES_CREATION_OPEN = false` in `src/config/season.ts`,
  landed as `66d365d2` on 2026-08-30 (`git log -S 'SQUARES_CREATION_OPEN =
  false' -- src/config/season.ts`) — but existing Squares pools remain
  exposed. This is a Kevin decision, not a drive-by fix.
- **Known product limit, still open: confidence-mode proxy picks are refused
  on the client.** `src/components/NFLPoolDashboard/NFLManagerView.tsx` (the
  comment above the proxy form, ~line 1115) refuses a CONFIDENCE pool on
  purpose: `proxyPick` writes `picks` and never `confidence`, and a confidence
  pool scores a correct pick at `confidence[gameId] ?? 0`, so a proxied pick
  would look right in the grid and be worth nothing. Closing it needs a
  confidence control in the proxy form AND a callable change — a functions
  deploy, not a UI tweak. Recorded in the archived 2026-08-25 box and
  MORNING-2026-08-25 §5; still true in the code today. Re-check with three
  greps: `grep -n "CONFIDENCE pool is still refused"
  src/components/NFLPoolDashboard/NFLManagerView.tsx` → `1115` (the client
  gate); `grep -n confidence functions/src/schemas/poolExceptions.ts` → no
  output (the proxyPick payload has no confidence field); `grep -n
  "confidence?.\[gameId\] ?? 0" functions/src/nflScoringEngine.ts` → `175`
  (why an unset value scores zero). The limit is closed only when the second
  grep starts matching AND the form has a control for it.
- **`onPoolLocked` double-counts global money totals on a duplicate delivery —
  known, unfixed.** `functions/src/statsTrigger.ts` (~186–219) increments
  `stats/global.totalPrizes` / `.totalDonated` with `FieldValue.increment` on
  the `!before.isLocked && after.isLocked` edge and checks nothing else; Cloud
  Functions triggers are at-least-once, so a redelivered event increments
  twice, silently. Self-correcting only when someone runs
  `recalculateGlobalStats` (absolute overwrite). On record since the 2026-07-18
  backfill audit (archived); options there: a `statsFoldedAt` marker on the
  pool, or periodic `recalculateGlobalStats` as the reconciler. Not urgent;
  do not read a money-total mismatch as corruption before checking this.

## History

Boxes from 2026-07-17 through 2026-08-25 — stop points, deploy-state boxes,
the SWEEP-LATER worklist, the Phase-2 observability notes and the July
"Next-effort menu" — are in
[docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md](docs/archive/HANDOFF-HISTORY-2026-07-17-to-2026-08-25.md),
moved verbatim on 2026-09-08. **Nothing there is current state.** Open a
box there only to recover the reasoning behind something a live doc cites.
Its header carries a **Box index** — every archived box by date and label —
so a citation such as "HANDOFF's STOP POINT box" in `PICKUP-PRESEASON-PILOT.md`
(dated sections) or "the 2026-08-12 DEPLOY STATE box" resolves by searching the
date there, not by reading 3,900 lines.

## Key documents

| Doc | What |
|---|---|
| `HANDOFF.md` | THIS FILE — session entry point |
| `PLAN-NFL-SIM-HARNESS.md` + `-REVIEW-LOG.md` | Locked harness plan + Codex trail |
| `docs/archive/TAKEOVER-NFL-SIM-HARNESS.md` | Overnight-build narrative + deploy runbook (historical) |
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 + Phase 2 both shipped+deployed (PR #171, #173); Phase 3 not started |
| `docs/archive/PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Coolify dashboard for the `www` app (deployment history, manual rebuild,
  rollback): `http://72.60.68.7:8000/project/ycoooow0g4c08ogso404k8o4/environment/ogs0cg0gg0kcgkgc8sg4c8g4/application/ics4kkww0c8oo0gw4wkg8w4o/deployment`
  — this is the URL other runbooks mean by "the dashboard URL in HANDOFF's box".
- Deploy: `npm --prefix functions ci` first (NOT `install` — it rewrites the lockfile and dirties the tree the deploy packages), then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify — **manual trigger only**, pushing to `main` does NOT auto-deploy it (corrects a stale claim that lived here; matches CLAUDE.md + the mmp-deploy-and-operate skill).
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- **PR review = TWO reviewers.** `codex exec review --base origin/main` before opening the PR, judgement up to 10 rounds, past 10 ask Kevin with a reason (CLAUDE.md §2c — it was 5, raised 2026-07-27). **AND qodo on the PR itself — Kevin, 2026-07-31: *"Qodo is now active and must be used."*** (§2b; it was off from 2026-07-25 only while the trial had lapsed, and an overnight prompt on 2026-07-30 repeated that stale line). Stop when both are clean and your own read of the diff agrees. qodo costs nothing per run and codex is billed per call, so the round budget is spent on codex. Validate every finding before fixing; a rejection needs written reasoning **on the PR**.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
