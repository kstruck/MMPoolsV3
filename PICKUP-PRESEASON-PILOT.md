# PICKUP — NFL 2026 preseason pilot (new-session entry point)

**Paste this to start a new session:**

> Read `PICKUP-PRESEASON-PILOT.md` §0 first, then `HANDOFF.md`'s STOP POINT box.
> The target is the Hall of Fame game, 2026-08-06. Deploy and prod-data
> mutations are Kevin's; code, tests and PRs are yours. Follow CLAUDE.md §2b
> (**qodo is ON — Kevin, 2026-07-31: "Qodo is now active and must be used."**
> Check all three of its surfaces on every PR) and §2c
> (`codex exec review --base origin/main`; judgement up to 10 rounds per
> artifact, ask Kevin with a reason before going past 10). Both reviewers run on
> every PR; stop when qodo is clean AND a codex round is clean AND your own read
> of the diff agrees. Tell me what you plan to do before you do it.

Written 2026-07-21. **The target is the Hall of Fame game, 2026-08-06** (Thu,
8:00pm ET, CAR at ARI) — that is the clock, set by Kevin on 2026-07-21. The
first 16-game preseason slate follows on 2026-08-13.

⚠️ **These docs dated the HOF game one day late until 2026-07-21.** ESPN reports
its kickoff as `2026-08-07T00:00Z`, because 8:00pm ET is midnight UTC the next
day; earlier notes copied that UTC date down as if it were the calendar date.
The `2026-08-07T00:00Z` in `functions/src/__tests__/feedSnapshot.test.ts` is the
real captured feed value and is correct as written — do not "fix" it.
`tests/docs-state-invariants.test.ts` now fails on that date written bare (i.e.
without the `T00:00Z`) in any operator doc.

Note also that the importer's preseason **week 1 is HOF Weekend**, and the
08-13 slate is importer week **2** (`TOMORROW-TASKS.md` §"four segments"). Say
which one you mean; "preseason week 1" alone is ambiguous in this repo.

---

## 0. State as of 2026-07-30 — read this before anything else

**Everything through #321 is merged AND deployed.** The deployed SHA is the
tagged claim in §2 — not repeated here, so it cannot rot.
**ALL THREE QUEUES ARE EMPTY.** Everything through #324 is merged, deployed and
verified: #313–#317, #319, #320, #321, the 2026-07-30 Bento truth pass (#322) and
the tabbed commissioner split (#324) have all been rebuilt, each confirmed by the
live bundle hash actually moving. See §4.

Five PRs shipped on 2026-07-28: #313 (payment fallback removal + the post-commit
projection fix), #314 (reminder delivery outcomes), #315 (one definition of the
sim-pool rule), #316/#317 (docs). Functions were deployed twice, the second run
reporting every function `Skipped (No changes detected)` — that all-Skipped run
is the evidence, not the absence of an error. Rules unchanged by all five.

✅ **Every rebuild owed before 2026-07-30 is DONE**, each verified by the live
bundle hash actually moving: `index-Na2D7cdu.js` → `index-gn5gQtFU.js` (#297/#298
dependency bumps plus #313/#315's frontend changes) → `index-DYJ4N7zt.js` (#319
seasonType, Kevin 2026-07-29) → **`index-D1wLGiMy.js`** (#320 CSP + #321
AdminRoute). The CSP fix needed a rebuild for a different reason worth
remembering: it changes `nginx.conf`, which is baked into the image at
`Dockerfile:37`, so it reaches nobody until Coolify rebuilds — and an
`nginx.conf`-only change does **not** move the bundle hash, so verify that class
by curling the response header instead. ✅ **The 2026-07-30 Bento truth pass
(#322) is ALSO rebuilt** — `index-D1wLGiMy.js` → **`index-C31xivRN.js`**, read off
the prod HTML — **and so is the tabbed commissioner split (#324)**,
`index-C31xivRN.js` → **`index-CR5oJEHh.js`**. Nothing is owed on the frontend.
Dashboard URL in HANDOFF's STOP POINT box for next time.
(Historical: the 2026-07-25 rebuild carried #279's `NFLManagerView` cutover onto
the `updatePoolSettings` callable and was smoke-tested in prod.)

⛔ **APP CHECK TOOK PRODUCTION DOWN ON 2026-07-30 AND WAS ROLLED BACK. DO NOT SET
`VITE_RECAPTCHA_SITE_KEY`, AND DO NOT "FIX" THE `App Check is NOT active`
WARNING — that warning is the SAFE state.** Setting the variable in Coolify was
followed by the site rendering nothing (permanent spinner, confirmed from two
machines on two networks); deleting the variable and redeploying restored it.
✅ **WHEN it happened is now PINNED DOWN** (Coolify deployment history, read
2026-07-31). **Three** manual rebuilds ran on 2026-07-31 — 04:54:22, 05:12:58 and
05:16:59 UTC — **all three at commit `fe3d7c3`**, i.e. the same commit with no
code change between them. That is the add-and-roll-back signature, and it is
AFTER #325, not after #321. The incident report's "two rebuilds after #321" was
wrong on both count and position, and §4 above is correct: the
`D1wLGiMy → C31xivRN → CR5oJEHh` moves were #322 and #324, on 2026-07-30.

⚠️ **Across those three rebuilds specifically, the bundle hash did NOT move** —
prod stayed on `index-CR5oJEHh.js` from before 04:54 UTC until after 05:17 UTC,
which is what #324 produced (`fe3d7c3` is docs-only on top of it, so it emits an
identical bundle).

🕐 **Do not confuse this with the LATER rebuild the same day.** Two separate
things happened on 2026-07-31 and the hash behaved differently in each:

| When (UTC) | What | Bundle |
|---|---|---|
| 04:54, 05:12, 05:17 | the three App Check rebuilds, all at `fe3d7c3` | **unchanged**, `index-CR5oJEHh.js` |
| later that day | the #329 rebuild, at `efea033` | **moved** → `index-Db6JwMWs.js` (the live hash *then*) |

⚠️ **SUPERSEDED: the current live bundle is `index-Bv2FV3GO.js`** (#341 rebuild,
2026-08-01 — see §2). `index-Db6JwMWs.js` was current when this section was
written and the sentence below is scoped to that day. The "hash did not move" claim
above is scoped to the three App-Check rebuilds only — it is not a statement
about the day. Written out because this runbook uses hash movement as positive
evidence for a rebuild, so an unqualified "it did not move" is the kind of
sentence that gets used to condemn a good deploy.

📌 **UNVERIFIED (inference, not measurement).** That the hash held across those
three rebuilds is *consistent with* the reCAPTCHA key never reaching the bundle,
which is what the missing Dockerfile `ARG` predicts. It is **not** proof: nobody
diffed the served JS, and a rebuild can change what is served without changing
the emitted filename (nginx config, headers, a cached or half-built image).

⚠️ **The CSP mechanism is NOT eliminated — it is conditional on the build path.**
It is ruled out *only if* Coolify builds the tracked `Dockerfile`. That is
precisely one of the open candidates: a custom or out-of-band build path, or a
mismatched cached image, would let the site key reach the app despite the tracked
Dockerfile having no `ARG`, and the CSP story would then be live again. **Verify
the build method (or diff the served JS) before eliminating anything.** Root
cause is OPEN.

One lead worth pulling: the 05:12:58 run finished in **21 seconds**, far too
fast for a real image build, yet is recorded `Success`.

⚠️ **The correlation is solid. The CAUSE IS OPEN — do not repeat the first
explanation as fact.** That explanation (CSP blocks the reCAPTCHA script → App
Check token never resolves → Firestore SDK goes offline) was holed by codex
within the hour: `Dockerfile:15-27` declares build args for six variables and
none of them is this key, so it has no known path into the Vite bundle at all.
Four faults block re-enabling regardless (CSP is missing the reCAPTCHA hosts;
`src/firebase.ts:27` wants an **Enterprise** key and the one that exists is
**v3**; the web app was never registered in the console; the Dockerfile has no
`ARG` for the key). Full detail, the three candidate explanations, and the
morning steps to distinguish them: HANDOFF's STOP POINT box. Guarded by
`tests/docs-state-invariants.test.ts`. `PRESEASON-READINESS-CHECKLIST` item G3 is
now CLOSED as accepted risk — do not reopen it before the pilot.

⚠️ **NEW IN PROD: `runReminders` can send SMS for the first time.** #314 bound
`COURIER_AUTH_TOKEN` to it; the job had never bound the secret, so every SMS
reminder it tried to send had silently not been sent for the life of the job.
Kevin merged it knowing this. Details and the back-out in HANDOFF's STOP POINT
box.

(Historical, 2026-07-25: everything through #279 (G1 PR-B′) shipped — functions,
then `firestore:rules`, then the Coolify rebuild — and both queues were empty
then. #262 removed the ~966K-reads/day `runReminders` amplification; verify the
drop via Query Insights, KEVIN-TASKS-2026-07-23.md §4.)

✅ **The `publishedWeeks` backfill is CLOSED (2026-07-27) and never needs
running.** The prod dry run returned `poolsScanned: 15, poolsChanged: 0,
weeksMarked: 0, failures: []` — no legacy manually-scored weeks exist to stamp,
across the whole NFL pool population (the migration applies no season filter).
**Do not click the destructive button; it is a no-op.** See HANDOFF's STOP POINT
box. `MORNING-2026-07-26.md` §2c describes it as owed — that doc is a dated
morning note and is now historical on this point.

⚠️ **#279 did not reach a clean codex round** (3 rounds, 8 findings all absorbed;
round 4 hit an OpenAI quota error). Noted so nobody reads "merged + deployed" as
"fully reviewed".

Earlier: the morning's #255/#256/#257 plus #243, #259, #260 all shipped; #255
closed the banned-commissioner authz gap in prod; Kevin's two rulings landed —
**timezones pinned to ET** (#259) and the **PLAN gate scoped to blast radius**
(#260). See HANDOFF's STOP POINT box.

✅ **qodo is ON.** Kevin, 2026-07-31: *"Qodo is now active and must be used."*
It was removed on 2026-07-25 only while the trial had lapsed, restored when his
subscription came back, and an overnight prompt on 2026-07-30 repeated the stale
"qodo is OFF" line — this ruling supersedes all of that (CLAUDE.md §2b).
**Both** qodo and codex run on every PR; stop when qodo is clean AND a codex
round is clean AND your own read of the diff agrees. The paid round budget is
spent on codex, not qodo.

The overnight-of-2026-07-22 effort took on four product items Kevin queued —
profile header/footer, SuperAdmin Overview stats, a filterable Stats tab, and a
Sentry triage. If **MORNING-2026-07-23.md** exists, read it for what got built
and what needs Kevin.

### The 2026-07-21 deploy, for context

**Functions and the frontend were both deployed on 2026-07-21** (~16:40Z and
~16:54Z, same commit). Twelve PRs shipped in that deploy; the state above is
*after* it, and after the 07-22 morning and evening deploys.

⚠️ **The deployed SHA lives in exactly TWO places, both tagged
`<!-- deploy-state:current -->`** — HANDOFF's STOP POINT box and §2 of this
file. `tests/docs-state-invariants.test.ts` requires exactly one tagged claim
per doc and checks they agree, so **update both or CI fails.** Any UNTAGGED copy
of the SHA is invisible to that guard and will rot silently; do not add one.

### Check what is open before you start

```
gh pr list
```

A command, not a claim — anything written here about which PRs are open is stale
the moment one merges. If a docs PR touching HANDOFF/PICKUP is open, read it
before editing those files or you will redo its work.

### What is genuinely proven now

- **Cloud Scheduler fires `nflDeepScoreSweepJob`.** It stamped 11:30:08 ET on
  07-21 with no `detail` field, i.e. from the pre-#245 build. The ten-day blind
  spot that killed the finalize sweep is not present here.
- **Two of #250's nine rewritten handlers work in prod** (`autoLockPools`,
  `runReminders`), plus `syncNFLScoresJob` from #245 — which reported a quiet
  July window (`slates: 0`) as *healthy, not degraded*. Healthy paths only.

### The biggest open risks, in order

1. **Backups.** `PLAN-BACKUPS-PHASE3.md` still says no PITR, no scheduled
   backups, no Auth export. DB is `nam5`, which supports PITR — no blocker.
   **Kevin-only:** PITR, backup schedules, the GCS bucket and IAM. **Engineering
   work, once those exist:** the scheduled Auth export is deferred CODE
   (`PLAN-BACKUPS-PHASE3.md` step 6), not a console click — keep it on the
   engineering queue rather than filing the whole gap under Kevin.
2. **A8 pricing — DUE 2026-08-06.** The only calendar-bound item. Retargeted
   from 2026-08-13 on 2026-07-21 when Kevin named the HOF game as the target.
3. ~~**A banned commissioner can still move the money ledger.**~~ **CLOSED IN
   PROD 2026-07-22** — [#255](https://github.com/kstruck/MMPoolsV3/pull/255)
   merged and deployed. `recordPoolPayouts`, `simulateGameUpdate` and
   `simFillSquares` authorized from persisted pool ownership and never consulted
   `users/{uid}.role`; all three now call `assertNotBannedLive`, and the deploy
   output confirmed each with "Successful update operation".
4. **`nflFinalizeSweepJob` has never completed a production run.** Runs
   **04:30 ET** (`30 4 * * *`, pinned since #259 — it was 08:30 UTC, same wall
   time, wrongly documented as 08:30 ET). Its sweep path now has emulator
   coverage ([#257](https://github.com/kstruck/MMPoolsV3/pull/257)) — which is
   not the same claim as "it ran in prod". Arming it is NFL-6 in
   `TOMORROW-TASKS.md`.

### Best next engineering work (no Kevin needed)

Items 1 and 2 of the previous list are DONE — [#256](https://github.com/kstruck/MMPoolsV3/pull/256)
and [#257](https://github.com/kstruck/MMPoolsV3/pull/257) are merged and
deployed. What is left:

1. ~~**Plumb an outcome through `sendEmail` / `sendCourierSMS`.**~~ **DONE
   2026-07-28** — `DeliveryTally` (`functions/src/lib/deliveryTally.ts`) carries
   queued/skipped/failed out of the helpers and `reminderPassVerdict` grades
   them, so a pass that delivered nothing is no longer a healthy beat. `skipped`
   (unsubscribed, opted out, no address) is reported and deliberately NOT graded.
2. **The scheduled Auth export** (`PLAN-BACKUPS-PHASE3.md` step 6) — deferred
   CODE, not a console click. Blocked on Kevin creating the GCS bucket + IAM.
3. ~~**Unify scheduled-job timezones.**~~ **DONE** — #259, deployed 2026-07-22.
4. **Point the Bento Buy-In Ledger at Member Records.** It is `entries`-derived
   today, so it shows `$0` and "no members" on a pool whose members have no entry
   documents — while the roster panel on the same page shows them correctly. The
   unfinished half of D13; belongs in `PLAN-PAYMENT-TRUTH`, not a new plan.
   Agreed with Kevin 2026-07-28. Detail in HANDOFF's STOP POINT box.
5. ~~**Give the manager surfaces the seasonType filter the member surfaces
   have.**~~ **DONE 2026-07-29** — `gamesForPoolWeek` and `poolSeasonType`
   (`src/utils/nflPending.ts`) are the only definitions; 18 call sites across
   manager, member and service surfaces delegate. The member side was NOT the
   correct one to copy: it read `Number(pool.seasonType)` with no default, which
   is `NaN` on a pool that omits the field — and omitting it means REGULAR season
   per `shared/schemas/nfl.ts`. Such a pool showed no games at all. Detail in
   HANDOFF's STOP POINT box. **Merged `31d1b8c` and REBUILT — live as of
   2026-07-29, bundle `index-DYJ4N7zt.js`.**
6. ~~**Add Sentry's ingest host to the CSP.**~~ **DONE 2026-07-29** — browser-side
   Sentry had been CSP-blocked since 2026-07-16 and every client error was
   silently dropped; HANDOFF's "Sentry confirmed live in prod" claim was false.
   Guarded by `tests/csp-invariants.test.ts`. **Rebuilt and verified live
   2026-07-29** — the header returns the ingest host on all three nginx location
   blocks and a real event landed in Sentry from prod.
7. ~~**Route the Manage-My-Pools cog to the right surface.**~~ **DONE
   2026-07-29** — the cog was never the bug. `AdminRoute` had no branch for the
   three NFL season types, so they hit its `// Fallback for unknown types`.
   Fixed in the router, which closed all three entry points at once. No
   authorization change: the ownership guard precedes every branch. Detail in
   HANDOFF's STOP POINT box, item 5.
8. ~~**Absorb the Bento defects into the tabbed split.**~~ **MOSTLY DONE
   2026-07-30** — the clipped chart, the entries-derived ledger card AND modal,
   and the fabricated banter seed shipped as their own PR instead, because the
   money surfaces should not wait on a layout refactor. Extending the T3 fake-card
   invariant to that file turned up three more fabrications (two no-op
   commissioner buttons, an invented audit trail, a hardcoded pick deadline), all
   removed. **The five duplicate save buttons closed the same day** with the
   tabbed split (#324) — item 6 below. Detail in HANDOFF's STOP POINT box, items
   1/3/6/7/9.
9. **Make the manager banter panel real** — Gemini-backed, persisted, deletable,
   **5 posts/day/pool enforced server-side** (Kevin's ruling 2026-07-29).
   **PLAN-GATED**: new callable + collection + rules = the authorization trigger.
6. ~~**Split the commissioner page into tabs.**~~ **DONE 2026-07-30 (#324)** —
   Overview / Members & Payments / Scoring / Settings, and four of the five
   `SaveSettingsControl` instances are gone with it. Not plan-gated: pure layout,
   no callable touched. ⚠️ **Rebuilt but not visually verified** — see
   `MORNING-2026-07-30.md` task 1b.
7. **Surface `system/heartbeats` in the SuperAdmin UI.** Every scheduled job's
   liveness and verdict is written there and NOTHING renders it — the Overview
   tab's "Ops Health" card shows alerts and webhooks, not jobs. `findStaleJobs`
   (`lib/heartbeat.ts`) already computes the never-ran/stale verdict server-side
   and has tests; it just has no reader. Until then the only way to check a job
   is the Firebase console (link in HANDOFF's STOP POINT box).

### Contradictions Kevin ruled on — 2026-07-22

- **PLAN-*.md scope — RESOLVED.** It was "any 2+ file change" and was
  systematically not followed. Now scoped to **blast radius, not file count**: a
  plan is required when a change touches **money, authorization, production
  data, or scoring**. `mmp-change-control` §1 carries the trigger list and is
  authoritative. Stop flagging the skip on ordinary changes.
- **Scheduled-job timezones — RESOLVED and DEPLOYED.** Kevin ruled "pin all to
  ET"; [#259](https://github.com/kstruck/MMPoolsV3/pull/259) merged and deployed
  2026-07-22. Seven daily-or-slower jobs had run unpinned in UTC, which is how
  `nflFinalizeSweepJob` came to be documented as an 08:30 job that actually ran
  at 04:30 ET. **HANDOFF §4 carries the resulting schedule** — read it there, not
  here. A ratchet (`functions/src/__tests__/scheduleTimezones.test.ts`) now fails
  if a wall-clock schedule omits `timeZone` or pins a non-ET zone.

### Known cosmetic artifact, not an outage

Ops Health shows `lockNFLSpreadsJob` as `never-ran` until **2026-07-28**. 07-21
was a Tuesday and its 09:00 ET run predated the wrapping.

---

## 1. The one thing to internalise before touching anything

**"Armed" and "working" are separate claims. Verify by asking whether the thing
has actually PRODUCED something.**

In one week, four things were broken while appearing healthy, and *none* was
findable by reading code:

| What | How it hid |
|---|---|
| A deploy command | `--only functions:a,b,c` deploys **only `a`** — the rest are silently dropped, then it prints `✔ Deploy complete!` |
| `syncPlayInPicks` | A hardened callable never exported from `index.ts`, so a SuperAdmin button called a function that did not exist |
| A5 feed snapshots | Missing composite index; the error was swallowed by the `catch` that protects score sync |
| `nflFinalizeSweepJob` | Missing composite index → `FAILED_PRECONDITION` **every day for ten days**, zero audit entries |

Two of those I caused myself by assuming a verified state matched the actual
state. Concretely:

- Before any deploy: `git log --oneline -1` **and** confirm the change is in the
  file on disk. Not "the PR merged" — the bytes about to ship.
- Prefer a content hash over a line count when checking a file (`git hash-object`).
- Assert concrete values in tests, never just "no error thrown".
- After adding a guard, **verify it fails** when the bug is reintroduced.

---

## 2. Live state (deploy state verified 2026-08-02)

> ⚠️ **HISTORICAL (2026-07-28 state). The live bundle is now
> `index-Bv2FV3GO.js`** — see the tagged claim below, which is current.
> This block is kept for the deploy-ritual evidence it records, not for its
> bundle hash.
>
> ✅ **FUNCTIONS, RULES and FRONTEND were ALL current at that time
> (#313–#317). Every queue was empty.** Functions deployed twice, the second run
> all-`Skipped`; rules unchanged by all five; Coolify rebuilt and the bundle
> verified in the browser as `index-gn5gQtFU.js` **(superseded)**.
>
> (Historical, 2026-07-25: both queues were empty through #279, with the frontend
> rebuilt on Coolify on the same commit, SHA checked against
> `git rev-parse origin/main`.)
>
> **HANDOFF.md's STOP POINT box is authoritative for deploy state.** Both files
> agree on the DEPLOYED SOURCE SHA below — which is what is RUNNING, not what
> `main` is. They deliberately do not claim prod equals `main`: docs-only commits
> advance `main` without a deploy, so that equality is false almost immediately.
>
> `tests/docs-state-invariants.test.ts` (PR #248) enforces **only** that the
> tagged deployed-SHA claims agree and name a real commit on `origin/main`. It
> does **not** compare deploy-QUEUE prose and does not know what `main` currently
> is — a green suite is not agreement about the queue. The limit is stated in the
> test file itself.

**Functions are deployed from <!-- deploy-state:current --> `main` @ `22adb90`.**
Rules remain ≡ `0a705c0` — `firestore.rules` is byte-identical since, so no rules
deploy is owed. (`shared/memberRecord.ts` changed; nothing generates
`firestore.rules` from `shared/`, so that does not imply one.)
✅ **Frontend rebuilt 2026-08-02 08:38 UTC** for the `src/**` changes in #344,
#338 and #345 — the commissioner reminder UI, the `MEMBER_NOT_ON_ROSTER` copy and
the SuperAdmin stale-job tile. Live bundle moved `index-Bv2FV3GO.js` →
**`index-DlH8liQe.js`**, read off the prod HTML; Coolify reported
`Deployment is Finished`, healthcheck `"healthy"`. **ALL THREE QUEUES EMPTY.**
(Deployed 2026-08-02 overnight for **#344 + #338 + #345**. Cloud Functions
returned HTTP 429 `Per project mutation requests` partway through each first
pass; the retry finished them. The certification is the THIRD run: 173 all
`Skipped (No changes detected)`, 0 updates, 0 failures, `✔ Deploy complete!`.)

(HISTORICAL — the deploy before it. 2026-08-01 for **#341**, the repair-job
narrowing: 173 `Successful update operation`, then 173 all-Skipped. Its frontend
rebuild moved `index-Db6JwMWs.js` → `index-Bv2FV3GO.js`, which is the hash still
live until tonight's rebuild superseded it.)

(HISTORICAL — the deploy before it. Deployed 2026-07-31 in the EVENING ET for **#334**, which stopped shipping the
113-file test suite to Cloud Functions — **the packaged upload went 2.33 MB →
1.55 MB**. Full fleet twice: 173 `Successful update operation`, then 173
`Skipped (No changes detected)` — that all-Skipped run is the evidence.
`shared/` untouched, so rules are unaffected. This was the THIRD functions
deploy that day: `efea033` (#329) earlier, `bca457c` (#333) at ~17:10 ET with
the same all-Skipped evidence, then this one at ~17:45 ET.)
(#313–#317 deployed as the FULL FLEET, twice: the first run reported every
function `Successful update operation` — expected, because
`npm --prefix functions ci` moved every bundle hash — and the second reported
every function `Skipped (No changes detected)`. That all-Skipped run is the
evidence. Rules unchanged by all five, so they remain ≡ this tag. FRONTEND at
that time: Coolify rebuilt, bundle `index-gn5gQtFU.js` — ⚠️ **superseded; the
live bundle is now `index-Bv2FV3GO.js` (§2)**.
Prior claim: <!-- deploy-state:ignore --> `main` @ `d3d2b0d` —)
(#311 / G1 PR-B2 deployed as the FULL FLEET, twice; rules unchanged.
Prior claim: <!-- deploy-state:ignore --> `main` @ `6b7e439` —)
(P3 #308 deployed incrementally — only setPaidStatus changed; fleet ≡ tag.
Prior claim: <!-- deploy-state:ignore --> `main` @ `b1df185` —)
(P2 #306 deployed incrementally on top of the state below — only
`reconcilePaymentTruth` + `setPaidStatus` changed; fleet ≡ tag. The prior
claim, kept for its history:)
<!-- deploy-state:ignore --> `main` @ `25e730e` —
Deployed incrementally 2026-07-27 as each PR landed: the full fleet at the
#290 merge (429-quota solo redeploy of `syncGameStatus`), rules the same hour,
then the #296 backfill-cursor functions and #294's `setPaidStatus` — no other
runtime file changed in between (diff-verified), so the fleet ≡ the tag.
Previous states: <!-- deploy-state:ignore --> `main` @ `8a55b84` (#279) on
<!-- deploy-state:ignore --> `main` @ `49c12a9` (#261/#262/#265).

✅ **The FRONTEND was current with this claim on 2026-07-28.** Coolify rebuilt
that day and the live bundle was `index-gn5gQtFU.js`, verified in the browser
with cache disabled. ⚠️ **Superseded — the live bundle is now
`index-Bv2FV3GO.js`** (§2); this paragraph records an older rebuild, not the current
state. That single rebuild cleared both the #297/#298 dependency-bump debt
(root `package.json` runtime deps — the trigger §4's own queue table names) and
#313/#315's frontend changes. See HANDOFF's STOP POINT box and §0.
(Historical: Coolify rebuilt twice on 2026-07-27 to bundle `index-CYTPq50I.js`,
and the D25 backfill live-ran in between — dry 72 predicted → live 72 created,
0 failures → dry 0 remaining.)
The paragraph below describes the 2026-07-25 state: Coolify rebuilt then on
the #279 commit (SHA verified against `git rev-parse origin/main`), and the
#279 settings cutover was smoke-tested in prod: an NFL Pick'em pool's Manager tab saved
successfully through the new `updatePoolSettings` callable.

⚠️ **The first `--only functions` run ENDED WITHOUT `✔ Deploy complete!` and left
10 functions stale** — including `nflAutoScoreJob` and `nflFinalizeSweepJob`,
both changed by #279. No error was printed; the command simply returned. A
second identical run reported every other function `Skipped (No changes
detected)` and updated exactly those 10, then printed `Deploy complete!`.
**Re-run a full-fleet deploy until every function reports Skipped.** That
all-Skipped report is the only positive evidence the fleet is current; the
absence of an error is not.

Armed in prod, all **dry-run**: `nflSpreadLock`, `nflLockWatch`,
`nflFeedSnapshots` (`retentionDays: 45`). `nflFinalize` is
`enabled:true, dryRun:true` and still needs `liveSeasonTypes` to actually arm.

**Deployed but NOT armed** (both default OFF, fail-safe):
- `nflDeepScoreSweepJob` — needs `system/config.nflDeepSweep.enabled = true`.
  Runs 11:30 ET daily. In `dryRun` it still DETECTS and REPORTS stat
  corrections and only suppresses the `nfl_games` write, so it can be watched
  for a week before the writes are armed. `lookbackDays` optional, default 7,
  clamped to [1, 30].
- `replayFeedSnapshot` — SUPER_ADMIN callable, `dryRun` defaults true at the
  schema layer. Nothing runs it on a schedule; it is a break-glass tool.

**Liveness question: ANSWERED 2026-07-21, do not reopen it.**
`nflDeepScoreSweepJob` stamped `system/heartbeats` at **11:30:08 ET**, and the
stamp carried no `detail` field — proving it came from the pre-#245 build, i.e.
the schedule fired on its own before any of this deployed. **Cloud Scheduler is
not the problem it was on the finalize sweep.**

What to check from now on: after 11:30 ET each day the stamp should be fresh AND
carry `detail: { enabled: false }` while the job stays disabled.

**A handler that THROWS still leaves a stamp.** `withHeartbeat` catches, records
`ok: false` with the message, and only then rethrows
(`functions/src/lib/heartbeat.ts`). So the differential is:

| Symptom | Means |
|---|---|
| Stamp present, `ok: false` | the handler threw or reported degraded — read `error` |
| Stamp present, `ok: true`, stale `at` | it ran, then stopped being invoked |
| **No stamp at all**, but the Functions log shows an invocation | the heartbeat WRITE failed, or the process died before the wrapper could record (timeout, OOM) |
| **No stamp and no invocation** in the log | Cloud Scheduler did not fire it |

The 2026-07-21 evidence rules out "this schedule was never wired at all". It does
**not** rule out a scheduler failure on some later day — especially right after a
deploy replaces the function — so keep the last row in the differential.

Prod data: **49 preseason games** (`season 2026`, `seasonType 1`). One
mislabeled regular-season game was deleted by hand; PR #219 stops it recurring.

Both previously-missing composite indexes are deployed and **Enabled**:
`nfl_feed_snapshots(slate, fetchedAt)` and `pools(type, scoredThroughWeek)`.

---

## 3. What is PROVEN vs what is NOT

**Proven in CI** (fixture `nfl-pickem-preseason-lifecycle`, PRs #225/#229):
create → join → submit → score → **finalize**, on a `seasonType 1` slate with
**no betting lines**, asserting concrete values (alice 3 pts / finalRank 1, bob
1 pt / finalRank 2 in `seasonHistory`). Verified non-vacuous: reverting the
PR #214 spread-gate fix makes this fixture — and only it, of 46 — fail.

**NOW PROVEN IN PRODUCTION (2026-07-21, after the deploy):**
- **The deep-sweep schedule fires.** `nflDeepScoreSweepJob` stamped
  `system/heartbeats` at **11:30:08 ET**, ~70 min before the deploy, and that
  stamp carried **no `detail` field** — the post-#245 code always writes
  `detail: { enabled: false }` on the disabled path, so it came from the
  pre-deploy build. Cloud Scheduler is not the problem it was on the finalize
  sweep.
- **Two of #250's nine rewritten handlers produced correct heartbeats** —
  `autoLockPools` (`detail.duePools: 0`) and `runReminders`
  (`detail.failedPools: 0`) — plus `syncNFLScoresJob` (all six counters, zero,
  `ok: true`), which is **#245's**, not #250's: it lives in `nflSchedule.ts`.
  Note
  `syncNFLScoresJob` reported `slates: 0` — a genuinely quiet July window — as
  **healthy, not degraded**. The cry-wolf case behaves.

**STILL NOT proven:**

> ⚠️ **#256 and #257 are merged and deployed, so two of these are now covered in
> CI — but only in CI, not in prod.** Keep the distinction: a test proving a
> verdict is correct is not the same claim as that verdict having fired in
> production. Updated 2026-07-22 evening.

- **The per-job heartbeat verdicts had no individual tests.** ~~The guard is a
  source-level check that a job *can* report failure.~~ **[#256](https://github.com/kstruck/MMPoolsV3/pull/256)
  adds unit tests for six of them** in `lib/heartbeatVerdicts.ts`, verified to
  fail when `autoLock`'s failure count is deleted. **Still true in prod:** the
  production evidence above covers three of nine handlers, on their HEALTHY path
  only — no failure path has ever executed in prod.
- ~~**`runReminders` cannot see failures its nested helpers swallow.**~~
  **CLOSED 2026-07-28** — the three swallows (`sendEmail`'s queue catch,
  `sendCourierSMS`'s unread boolean, `checkNFLNonPickerReminders`'s outer catch)
  are all counted now and graded by `reminderPassVerdict`. **Still true in prod:**
  no failure path of this job has ever executed there.
- **Eight files wrap a job that cannot report failure at all** (`adminHealth`,
  `consensus`, `espnBracket`, `expertPicks`, `expertProfiles`,
  `revenueAggregates`, `stripe`, `winProbability`), on a shrink-only list.
- **`nflFinalizeSweepJob` has never completed a run in production.** ~~It has no
  emulator coverage either.~~ **[#257](https://github.com/kstruck/MMPoolsV3/pull/257)
  covers the scheduled sweep in the emulator** — the gate, candidate selection,
  live scoping, and a thrown pool making the run unhealthy. **Still true in
  prod:** it has never completed a run there. Runs **04:30 ET** (pinned since
  #259) — see HANDOFF §4 for the full schedule.
- **`replayFeedSnapshot` has never been invoked against production.** ~~The full
  callable path is not covered.~~ **#257 exercises it end-to-end against the
  emulator** with a real `encodeSnapshot` payload: dry-run default, live rebuild,
  the error-audit path, and both refusal paths. **Still true in prod:** never
  invoked there.
- **`spread.locked` has never been exercised end-to-end in prod**, because
  `lockNFLSpreadsJob` has always been dry-run. The PR #235 fix is therefore
  *preventive* — verified by reasoning and tests, never by production behavior.
  Its first heartbeat is **2026-07-28**: 07-21 was a Tuesday and its 09:00 ET
  run predated the wrapping.
- The **chaos drill (NFL-7)** has not been run — it needs a live preseason week.

---

## 4. Deploy queue — ALL THREE EMPTY as of 2026-07-30 (#322 and #324 merged, rebuilt and verified)

> **Historical (2026-07-25), kept for the recipe — not a current queue claim;
> the current queue is the paragraph below this block.** #279 deployed functions → rules → Coolify
> frontend, in that order, and the settings save was smoke-tested in prod. The
> recipe below is kept because it is the one that has worked every time — see
> also `MORNING-2026-07-26.md` §2b, which is PowerShell-correct and carries the
> functions-before-rules-before-Coolify ordering constraint this deploy proved
> matters.
>
> ⚠️ **When you do deploy: re-run `--only functions` until EVERY function reports
> `Skipped (No changes detected)`.** On 2026-07-25 the first full-fleet run ended
> without `✔ Deploy complete!`, printed no error, and left 10 functions stale.
> The all-Skipped report is the evidence; a missing error is not.

**As of 2026-07-30 ALL THREE queues are EMPTY.** All three were empty at `0a705c0` (#313–#317 deployed, second
full-fleet run all-`Skipped`; rules unchanged by all five). Since then #319,
#320, #321 and the 2026-07-30 Bento truth pass have ALL been `src/**`,
`nginx.conf`, docs and tests only — which the table below makes a **manual
Coolify trigger** and nothing else — and every one of those triggers has been
run and verified by the bundle hash moving. **No functions or rules deploy is
owed by any of them, and none should be run.** The Bento PR deliberately avoided touching
`shared/`, which the table's second row would have turned into a functions
deploy. Verification in HANDOFF's STOP POINT box. The
deployed source SHA is the tagged claim in §2 — not repeated here, so it cannot
drift out of sync with it. `main` advances past it with every
docs-only commit — that is drift in the marker, not a deploy queue; the queue is
the table below.

**A deploy queue exists when ANY of these changed since the deployed SHA:**

| Changed | Needs |
|---|---|
| `functions/**` | `npx firebase deploy --only functions` |
| `shared/**` | same — the predeploy hook copies `shared/` into `functions/src/shared/`, so a shared-only change alters the deployed functions |
| `firestore.rules` | `--only firestore:rules` (**after** functions) |
| `firestore.indexes.json` | `--only firestore:indexes` |
| `src/**`, `package.json`, `Dockerfile`, `nginx.conf` | manual Coolify trigger |

Docs, tests, `.github/**` and `.claude/**` need nothing.

Fifteen scheduled job bodies changed in that deploy and every one reported
`Successful update operation`. Nothing was armed or disarmed; the behaviour
change is that a job which fails now REPORTS it instead of stamping a healthy
heartbeat — and **two of #250's nine** have since produced correct heartbeats
in production (HANDOFF §3), plus one of #245's.

Two operational notes worth keeping, both learned on this deploy:

- **`npm --prefix functions install` dirties `functions/package-lock.json`**,
  so a clean-worktree check placed after it can never pass.
- **HTTP 429 `Per project mutation requests per minute` is normal** on a
  full-fleet deploy; firebase-tools retries and they land. `Deploy complete!`
  is the signal that matters.

The command, which is the one that has worked every time:

```
cd D:\march-melee-pools
git checkout main && git pull origin main
git log --oneline -1
npm --prefix functions ci     # ci, NOT install — see below
if (git status --porcelain -- functions shared) { throw "functions/ or shared/ is dirty - deploy packages the WORKING TREE, not the commit. Stash or commit first." }
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

⚠️ **The gate is SCOPED to `functions` and `shared` on purpose.** An unscoped
`git status --porcelain` reports the known untracked strays at repo root
(`PLAN-LOOPS.md`, `before-deploy.txt`, `design-showcase/`, the
`DesignAlternatives*` files) that HANDOFF documents as harmless — so it would
throw on every single deploy and get stepped over, which is exactly the
behaviour it exists to prevent. `--only functions` packages `functions/`, and
the predeploy hook copies `shared/` into it; nothing else at root is uploaded.
Scoping keeps the gate true, and a gate that is true is a gate people obey.

⚠️ **`npm ci`, not `npm install`, and the clean-tree check goes AFTER it.**
`firebase deploy` packages the working tree, not the commit — uncommitted edits
ship while `git log` still shows the right SHA and any byte-check still passes.
Nothing else in this recipe catches that.

`npm install` **rewrites `functions/package-lock.json`**, so it dirties the very
tree about to be packaged. Checking before it leaves that rewrite unexamined;
checking after it can never pass. `npm ci` resolves both: it installs strictly
from the committed lockfile and mutates nothing — verified 2026-07-21, exit 0
with the tree still clean. It also fails loudly if `package.json` and the
lockfile have drifted, which is the right outcome before a deploy.

⚠️ **`functions:` must be repeated before EVERY name** if using a filtered
deploy. A bare `--only functions` avoids the trap entirely and is what has
worked every time. `FUNCTIONS_DISCOVERY_TIMEOUT` is in **seconds** and works
around a 10s source-analysis timeout on Windows.

Always confirm the change is in the file on disk before deploying — not that
"the PR merged". A stale checkout deploys old code and still prints
`Deploy complete!`.

## 5. What Kevin must do (nobody else can)

1. **NFL-6 — arm the finalize sweep.** Read a `NFL_FINALIZE_SWEEP` entry in
   SuperAdmin → Admin Audit Log first. Want candidates under `"1"` and **zero**
   under `"2"` in `bySeasonType`. Then set `nflFinalize.liveSeasonTypes` to an
   array containing the number **1** — `dryRun:false` **alone does nothing**,
   that guard is deliberate. Full steps: `TOMORROW-TASKS.md` → NFL-6.
2. **Deploy — the FUNCTIONS queue is EMPTY as of 2026-07-27** (#311 deployed;
   see HANDOFF's STOP POINT box for the verification). Next deploy recipe (with
   the ordering constraint): `MORNING-2026-07-26.md` §2b. **The `publishedWeeks`
   backfill is closed** (§0) — but TWO actions remain before `nflAutoScore` can go
   live, and both are yours: (a) **PR-B2 must be watched in dry run, and the
   watch only counts if it SAW something** — arm `{ enabled: true, dryRun: true }`
   and read the heartbeat detail. `queuedEvents: 0` for a day (the normal
   pre-HOF case) proves only the scheduler wrapper; the bar is at least one event
   observed AND still queued afterwards, since a dry run acknowledges nothing.
   If none appears before the HOF game, flip live only with that prerequisite
   named as unproven; and (b) **`nflDeepSweep` must be
   armed WITH WRITES** after its own dry-run trial (or the uncapped stale-slate
   re-fetch built), otherwise a game finalizing >24h after kickoff is never
   observed. HANDOFF's STOP POINT box carries the same two.
   (~~Also owed: the Coolify rebuild for #297/#298~~ — **DONE 2026-07-28**,
   bundle `index-gn5gQtFU.js`. For the CURRENT frontend queue see §0 and §4, not
   this line: rebuilds have been owed and cleared several times since.)
3. **NFL-2 decision** — build or skip alarm A3(b), the synthetic pick probe.
   Needs a prod probe identity + probe pool. Recommendation on file: skip for
   the pilot, revisit before charging money in September.
4. **A8 — publish the 2026 price + free-period end date.
   Deadline 2026-08-06.** The only calendar-bound item on the list.
5. **Leave `nflLockWatch.dryRun: true`** until the preseason-lines question is
   settled — only 1 of 49 games has a betting line, so going live pages nightly
   about a known condition.

---

## 6. Next engineering work (no Kevin needed)

Roughly in value order:

1. ~~**A5 part 2 — the snapshot replay callable.**~~ **DONE — PR #231.**
2. ~~**Phase 3 — backups.**~~ **Written up — PR #232.** The plan exists; the
   *work* is now yours, and step 0 is installing `gcloud` (it is not on this
   machine, and the Firebase CLI cannot configure PITR or backup schedules).
   **`--enable-pitr` is one command and buys a 7-day recovery floor. If you do
   one thing from that document, do that one.**
3. ~~**`claimMySquares` security finding.**~~ **Written up — PR #233.** Verified
   real against `firestore.rules`, and confirmed **not preseason-blocking**
   (Squares is not part of the NFL pilot). Recommendation on file: accept
   through the pilot, fix before the regular season. Needs your decision.
4. ~~**`syncNFLScoresJob` only re-reads games from the last 24h.**~~
   **DONE — PR #235**, `nflDeepScoreSweepJob`. Deployed, not yet armed.
   Deliberately a second daily job rather than a wider window on the 5-minute
   one, which would have multiplied ESPN fetches across 288 runs a day.
5. ~~**Heartbeat coverage is incomplete.**~~ **DONE — PRs #245 and #250.**
   Every `onSchedule()` in the codebase is now wrapped, with no exemptions, and
   an invariant fails if a new one is added unwrapped. The follow-up that came
   out of it is sharper and is now the top open item: **wrapping a job does not
   make its heartbeat honest.** Extract each job's verdict into a pure helper
   (as `sweepRunVerdict` and `lockWatchVerdict` already are) so the failure
   paths are individually tested, and plumb an outcome through `sendEmail` /
   `sendCourierSMS` so `runReminders` can see delivery failures.
6. **26 callables still use bare `onCall(`** — NOT 25; the count in the older
   docs was wrong, and `searchUsersByEmail` has already been migrated to
   `validated()`, so the warning about it needing a special grep is stale.
   Classification: 13 genuinely fine, 12 want `validated()`, 1 deferred by
   design (`createBracketPool`). Highest risk, in order: `simulateGameUpdate`
   (`scoreUpdates.ts`) — auth at the entry point is only "is anyone logged in",
   and an arbitrary `scores` object gets one truthiness check before deciding
   winners; `backfillProfileData` (`migrations/`) — a 540s mass mutation behind
   a claim-only gate; `recordPoolPayouts` (`payoutRecords.ts`) — the money
   ledger, and **the one item on this list that IS on the pilot path** (wired
   into `RecordPayoutsCard.tsx`).

   ⚠️ **Do NOT "fix" these by adding `validated({ role: ... })`.**
   `simulateGameUpdate`, `simFillSquares` and `recordPoolPayouts` all authorize
   ordinary owners/managers/co-managers through persisted pool ownership; only
   their SUPER_ADMIN bypass is claim-only. A `role:` gate runs before the pool
   is loaded and would reject legitimate commissioners. Use `validated()` for
   the auth+schema boundary and harden the admin bypass separately. Full detail
   and ordering: `SECURITY-BARE-ONCALL-CLASSIFICATION.md`.

---

## 7. Gates — run ALL FIVE before every commit

```
npm --prefix functions run build
npm --prefix functions test
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" npm --prefix functions run test:emulator
npx tsc -b
npm test
```

Baselines on <!-- deploy-state:ignore --> `main` @ `17fa291`: functions unit
**913**, emulator **105 pass / 10 skipped**, root vitest **273**, both
typechecks clean. **Counts only go up — re-measure, do not trust a stale
number** (I reported 828 once from a mid-merge measurement; it was 831).

`functions/node_modules` and root `node_modules` may be missing in a fresh
worktree — run `npm --prefix functions install` and `npm install` first or the
build fails confusingly.

**Known flaky:** `opsAlertDispatcher.test.ts` → *"no-ops when system/config has
no opsAlerts field"* fails intermittently. It uses a module-level
`vi.stubGlobal("fetch")` asserted with `not.toHaveBeenCalled()`, which a
floating promise from another test file can trip. Re-run before investigating.

---

## 8. Conventions that are NOT negotiable

- **One PR per logical item.** All five gates green before commit.
- **Kill-switch + dry-run** on anything scheduled or batch-mutating, fail-safe
  OFF (`enabled === true` required, `dryRun !== false` default).
- **Never deploy** — Kevin's gate, always.
- **Never `.trim()` a string used as a LOOKUP KEY** against stored data
  (regression shipped in #194, fixed in #195).
- **Check what a MISSING optional field MEANS** — omission is often a feature
  (`fixPoolScores.poolId` absent = "fix every pool").
- **`dryRun` defaults true at the SCHEMA layer**, never a handler-side check.
- **Every scheduled job should write something on every run** so "never fired"
  and "never ran" are distinguishable — `withHeartbeat()` in
  `functions/src/lib/heartbeat.ts` does this; use it for any new job.
- **Two reviewers on every PR.** `codex exec review --base origin/main` before
  opening one — judgement up to 10 rounds, Kevin's sign-off with a reason past 10
  (CLAUDE.md §2c) — **and qodo on the PR itself** (§2b; Kevin, 2026-07-31:
  *"Qodo is now active and must be used."*). Stop when both are clean and your own
  read of the diff agrees; that bar is usually reached in fewer codex rounds than
  the cap allows, because codex runs cost money and qodo does not. Judge each
  finding on evidence and reply either way — a rejection needs written reasoning
  **on the PR**.
