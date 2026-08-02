# HANDOFF — Session entry point (updated 2026-08-02 overnight: functions deployed from `22adb90` — the setPaidStatus membership hole is CLOSED (#344) and forged Member Records can no longer be emailed (#338); the SuperAdmin card finally renders the heartbeat verdicts (#345); the frontend was rebuilt for them, `index-Bv2FV3GO.js` → **`index-DlH8liQe.js`**; the pool manager counts as a player; App Check took production down on 07-30 and was rolled back — do NOT set `VITE_RECAPTCHA_SITE_KEY`; ALL THREE DEPLOY QUEUES ARE EMPTY)

> ## ✅ STOP POINT **2026-08-02 (overnight)** — everything through #345 shipped AND deployed, frontend included
>
> The heading date is the date of the facts immediately below. It is REPLACED
> on every deploy rather than annotated, because a note added above a stale
> claim leaves two live-looking claims and the reader takes whichever they
> reach first — the lesson #343 recorded and this box kept re-learning.
>
> **Functions are deployed from <!-- deploy-state:current --> `main` @ `22adb90`.**
> **Rules remain ≡ `0a705c0`** — `firestore.rules` is byte-identical since, so no
> rules deploy is owed. (`shared/memberRecord.ts` DID change; nothing generates
> `firestore.rules` from `shared/`, so that does not imply one.)
> ✅ **Frontend rebuilt 2026-08-02 08:38 UTC** for the `src/**` changes in #344,
> #338 and #345: live bundle moved `index-Bv2FV3GO.js` →
> **`index-DlH8liQe.js`**, read off the prod HTML. Coolify reported
> `Deployment is Finished`, healthcheck `"healthy"`, `Rolling update completed.`
> **ALL THREE QUEUES EMPTY.**
>
> ⬆️ **Deployed 2026-08-02 overnight for #344 + #338 + #345.** Evidence: two
> runs were needed because Cloud Functions returned HTTP 429 (`Per project
> mutation requests per minute per region`) partway through each first pass —
> the retry completed them. The certification is the THIRD run: **173 all
> `Skipped (No changes detected)`, 0 updates, 0 failures, `✔ Deploy complete!`**.
> That quota 429 is normal for a full-fleet deploy here and is not a failure;
> what would be a failure is stopping after a partial run and calling it done.
>
> ⬇️ **EVERYTHING BELOW THIS LINE IS THE HISTORICAL DEPLOY RECORD.** `22adb90`
> above is the current state.
>
> ⬆️ **Deployed 2026-08-01 for #341**, which stopped the repair jobs
> (`fixParticipantIds`, `backfillMemberRecords`) promoting a guest-square claim
> into roster membership. Evidence: 173 `Successful update operation`, then a
> second run of 173 all `Skipped (No changes detected)`, zero updates,
> `✔ Deploy complete!`. `shared/` and `firestore.rules` untouched, so rules are
> unaffected. **`src/components/admin/OperationsPanel.tsx` changed, so a Coolify
> rebuild was owed and Kevin ran it 2026-08-01** — live bundle moved
> `index-Db6JwMWs.js` → **`index-Bv2FV3GO.js`**, read off the prod HTML. The Run
> Log now shows `squaresSkipped`. (All three queues were empty at that point;
> the frontend queue is NOT empty now — see the current claim above.)
>
> ⬇️ **EVERYTHING BELOW THIS LINE IS THE HISTORICAL DEPLOY RECORD**, kept for
> provenance. `4713eba` above is the current state.
>
> ⬆️ **Deployed 2026-07-31 at ~17:45 ET for #334**, which stopped shipping
> the 113-file test suite to Cloud Functions (`firebase.json` ignore + tsconfig
> excludes). **Measured effect: the uploaded package went 2.33 MB → 1.55 MB**, a
> third smaller. Evidence: 173 `Successful update operation`, then a second run
> of 173 all `Skipped (No changes detected)`, zero updates, `✔ Deploy complete!`.
> `shared/`, `firestore.rules` and `src/**` all untouched by #334, so rules and
> frontend are unaffected.
>
> The deploy immediately before it was **2026-07-31 ~17:10 ET** for **#333**, the
> NFL-7 chaos-drill fixes, which changed
> `nflScoringEngine.ts`, `lib/weekCompletion.ts`, `nflPools.ts`, `nflSchedule.ts`,
> `nflFinalize.ts` and `feedReplay.ts`. **`shared/` was deliberately NOT touched**,
> so rules are unaffected and stay ≡ the tag above.
> **Evidence:** a first full-fleet run reported **173 functions
> `Successful update operation`** and ended `✔ Deploy complete!`; a SECOND
> full-fleet run reported **173 functions all `Skipped (No changes detected)`**,
> zero updates, and ended `✔ Deploy complete!` — that all-Skipped run is the
> positive evidence.
>
> ✅ **The #341 rebuild is DONE** (Kevin, 2026-08-01) — the Run Log shows
> `squaresSkipped` and the bundle moved to `index-Bv2FV3GO.js`. An earlier
> revision of this box warned that rebuild was owed; it no longer is.
>
> ⬇️ **HISTORICAL from here — the state as of #333/#334**, kept for the deploy
> record.
> ✅ **NO frontend rebuild was owed then.** Neither #332 nor #333 touches `src/**`
> (verified with `git diff --name-only <sha>^ <sha> -- src/` on both merge
> commits, both empty), so the live bundle stayed `index-Db6JwMWs.js` AT THAT
> TIME. ⚠️ HISTORICAL — it is now **`index-Bv2FV3GO.js`** (#341 rebuild, top of box).
> **ALL THREE QUEUES EMPTY.**
>
> 📌 **A production fact established 2026-07-31 and worth keeping:** `nfl_games`
> filtered `status == FINAL` returns **zero documents** — the 2026 season has not
> started, and every stored game is `SCHEDULED`. That is what resolved the one
> open finding on #333 (legacy scoreless-FINAL documents cannot exist if no FINAL
> documents exist). It stops being true the moment the HOF game ends.
>
> ⚠️ **THREE deploys happened on 2026-07-31 — do not conflate them.** `efea033`
> (#329, the member-record change) went out earlier in the day and carried a
> frontend rebuild to `index-Db6JwMWs.js`. `bca457c` (#333) went out that evening
> and is FUNCTIONS ONLY — it touches no `src/**`, so the bundle did not move and
> was not supposed to. **`68d121b` (#334) went out ~35 minutes after that, also
> functions-only, and IS the current deploy state** — `bca457c` and `efea033` are
> both history now. THREE functions deploys happened on 2026-07-31.
>
> ⚠️ **All of that is now HISTORY too.** `4713eba` (#341) went out on 2026-08-01
> and is the current deploy state — see the tagged claim above, which is the only
> place that fact is written down.
>
> ✅ **Frontend rebuilt the same day**: live bundle moved `index-CR5oJEHh.js` →
> **`index-Db6JwMWs.js`**, read off the prod HTML. **That was the live hash THEN;
> it is now `index-Bv2FV3GO.js` — see the top of this box.** `index-Db6JwMWs.js` was the
> current live hash. ALL THREE QUEUES EMPTY.**
>
> 🕐 **Not to be confused with the three App Check rebuilds earlier the same day**
> (04:54 / 05:12 / 05:17 UTC, all at `fe3d7c3`), across which the hash did NOT
> move and prod stayed on `index-CR5oJEHh.js`. Two different events on 2026-07-31
> with opposite hash behaviour; PICKUP §0 carries the table.
> Five PRs merged and deployed the same morning: #313 (payment fallback removal +
> the post-commit projection fix), #314 (reminder delivery outcomes), #315 (one
> definition of the sim-pool rule), #316 and #317 (docs).
>
> **Verified, not assumed.** The first full-fleet run reported every function
> `Successful update operation` and ended `✔ Deploy complete!`; a SECOND
> full-fleet run reported every function `Skipped (No changes detected)` and
> ended `✔ Deploy complete!` — **that all-Skipped run is the positive evidence**,
> and it is the check that caught ten silently-stale functions on the #279
> deploy. The whole fleet moved on run 1 because `npm --prefix functions ci`
> rebuilt `node_modules` and every uploaded bundle hash changed. Expected, not a
> defect.
>
> **Rules did not change in any of the five**, so they remain ≡ this tag.
>
> ✅ **#319 (seasonType filter) is MERGED AND LIVE.** Merged `31d1b8c`; Kevin
> rebuilt Coolify 2026-07-29 and the live bundle moved `index-gn5gQtFU.js` →
> **`index-DYJ4N7zt.js`**, confirmed from his own browser console. That rebuild
> also cleared the #297/#298 dependency-bump debt and #313/#315's frontend
> changes carried by the previous one.
>
> ✅ **The CSP fix (#320) is MERGED, REBUILT and VERIFIED LIVE.** Confirmed by
> reading the prod response header on all three nginx location blocks — `/`,
> `/pool/:id` and `/join/:id` all return `https://*.ingest.us.sentry.io` in
> `connect-src` — and then by an event landing in Sentry (see the correction box
> below). Checking all three mattered: patching two of three would have looked
> identical from the homepage.
>
> ✅ **The AdminRoute fix (#321) is MERGED AND LIVE.** The rebuild it owed was
> done 2026-07-29; the live bundle moved `index-DYJ4N7zt.js` →
> **`index-D1wLGiMy.js`**, read straight off the prod HTML. Kevin then confirmed
> in the browser that the cog opens the NFL commissioner surface and Back works.
>
> ✅ **The Bento truth pass (#322, merged `6676580`) is REBUILT AND VERIFIED
> LIVE.** The rebuild was triggered 2026-07-30 and the live bundle moved
> `index-D1wLGiMy.js` → **`index-C31xivRN.js`**, read straight off the prod HTML.
>
> ✅ **The tabbed commissioner split (#324, merged `245f3d4`) is REBUILT AND
> VERIFIED LIVE** — `index-C31xivRN.js` → **`index-CR5oJEHh.js`**, same check.
> ⚠️ **Its APPEARANCE is unverified**: nobody has clicked the four sections in a
> browser. Structure is pinned by 36 invariants and 12 mutations, and control
> placement is asserted by source offset, but a pure layout change deserves one
> human look. See `MORNING-2026-07-30.md` task 1b.
>
> ⚠️ **A moved bundle hash proves the rebuild shipped; an UNMOVED one does not
> disprove it.** The rule "the hash must change for a `src/**` change" is the
> right default and it held here, but it is not universal, and treating it as
> universal will one day condemn a perfectly good deploy. Vite hashes the
> **emitted** bundle: a `src/**` change confined to test files, or to code the
> tree-shake drops, emits byte-identical assets and leaves the hash alone. #322
> itself contains such a file (`src/utils/poolRoster.test.ts`) — it happened to
> ship emitted changes too, so the hash moved.
>
> So: a changed hash is **positive evidence**, and it is the check to reach for
> first. A hash that has NOT changed is **inconclusive** — go read the Coolify
> deployment log and confirm the run finished, rather than concluding the rebuild
> failed. An absent error is not evidence either way; that mistake is what hid
> the Sentry outage for thirteen days.
>
> An `nginx.conf`-only change never moves the hash at all — verify that class by
> curling the prod response header instead (see PICKUP §0).
>
> ✅ **ALL THREE DEPLOY QUEUES ARE EMPTY.** #322 touches `src/`, `tests/` and docs
> only, so functions and rules remain ≡ the tagged SHA above. It deliberately
> avoided `shared/`, which is compiled into functions and would have pulled a
> functions deploy along with it. **Do NOT deploy functions or rules for
> frontend-only work.**
>
> Check it against the MERGE COMMIT:
>
> ```
> git diff --name-only <sha>^ <sha> -- functions/ shared/ firestore.rules firestore.indexes.json
> ```
>
> That form works from `main`, which is where a later session actually stands. Do
> **not** reach for `origin/main...HEAD` to re-check a MERGED PR: from a branch cut
> off post-merge `main` it compares only what landed afterwards and reports empty
> whatever the PR did. (It is not vacuous everywhere — this repo squash-merges, so
> the original PR branch never becomes an ancestor of `main` and the three-dot diff
> still lists that PR's files *from the branch itself* — verified on
> `claude/bento-truth` after #322 merged. Whether that branch is still THERE
> depends on repo settings: `gh pr merge --delete-branch` did not remove
> `origin/claude/bento-truth`, and the merged branches for #319/#320/#321 are all
> still on the remote too.) Three-dot remains the right scope check for an **open**
> PR, exactly as CLAUDE.md §2c says.
>
> For `6676580` the merge-commit form returns empty, and
> `git show --name-only --format= 6676580` lists nine files: three docs, five
> under `src/`, one under `tests/`. **None of them is relevant to the FUNCTIONS or
> RULES queues** — but **four** of them are EMITTED `src/**` code
> (`NFLManagerBentoDashboard.tsx`, `NFLManagerView.tsx`, `PaymentsPanel.tsx`,
> `poolRoster.ts`), which is precisely why the frontend rebuild recorded above was
> required. "No backend deploy" is not "no deploy".
>
> The fifth `src/**` path, `poolRoster.test.ts`, is loaded only by Vitest and has
> no production importer, so Vite never emits it — it is the live example of the
> warning above. Counting `src/**` PATHS and counting EMITTED files are different
> numbers, and only the second one predicts the bundle hash.
>
> Dashboard, for the next time a `src/**` change lands:
> <http://72.60.68.7:8000/project/ycoooow0g4c08ogso404k8o4/environment/ogs0cg0gg0kcgkgc8sg4c8g4/application/ics4kkww0c8oo0gw4wkg8w4o/deployment>
> → **Redeploy**.
>
> ### ⚠️ NEW IN PROD: `runReminders` can send SMS for the first time
>
> #314 bound `COURIER_AUTH_TOKEN` to `runReminders`. Gen-2 functions see only the
> secrets they bind, and this job bound none — so `courierAuthToken.value()` was
> empty inside it and **every SMS reminder it ever tried to send silently was not
> sent**, for the life of the job. Nothing surfaced it because
> `sendCourierSMS`'s boolean had no reader; adding that reader is what exposed
> it. As of this deploy those texts actually go out, to members with a phone
> number who have opted in. Kevin merged #314 knowing this. To back it out, delete
> the `secrets:` option from the schedule and redeploy — the job keeps working,
> minus SMS.
>
> `runReminders`' heartbeat now carries `queued` / `skipped` / `deliveryFailures`
> / `poolErrors` beside `failedPools`. **Healthy is `failedPools`,
> `deliveryFailures` and `poolErrors` ALL zero**; `skipped` is informational
> (opt-outs, missing addresses, Courier unconfigured) and never graded.
>
> ### KNOWN OPEN, found while verifying this deploy (2026-07-28)
>
> Four display/consistency defects, none caused by these five PRs. None is a
> data-integrity problem — the authoritative stores are correct in every case.
> **Item 2 is CLOSED (#319, merged `31d1b8c` and deployed)**; 1, 3 and 4 are
> open. Items 5–10 below came from Kevin's 2026-07-29 walkthrough.
>
> 1. ✅ **CLOSED 2026-07-30 — the Buy-In Ledger reads ROSTER truth.** Every figure
>    on that card was `entries`-derived, so a pool whose members have Member
>    Records but no entry documents showed `$0` projected/collected and "No
>    members matching filter criteria" — while the Member Roster panel on the SAME
>    page read Member Records and showed them correctly. This was the half of D13
>    that P1 could not reach: `setPaidStatus` mirrors display fields onto the entry
>    only `if (entrySnap.exists)`, so an entry-backed reader cannot see a member
>    who never submitted one.
>
>    Fixed by extracting the roster merge and the dues maths into
>    `src/utils/poolRoster.ts` — `buildPoolRoster` and `rosterPotStats` — and
>    pointing **three** surfaces at them: the Bento card, the Advanced Payment
>    Ledger modal (item 7) and `PaymentsPanel`'s member-facing pot, which is where
>    the codex-hardened dues maths came FROM. Nothing was re-derived; a third
>    definition is what caused the disagreement. Grep the symbols, not line
>    numbers.
>
>    Two further fabrications fell out of the same card: the fee defaulted to
>    `entryFee || 20`, so a free pool projected a pot nobody owed, and Clearing
>    Rate divided by entry holders rather than by everyone who joined — 100% on a
>    pool where one of four members had paid. Guarded by
>    `src/utils/poolRoster.test.ts` (29 cases) plus wiring invariants in
>    `tests/admin-surface-invariants.test.ts`; **38 mutations applied across the
>    two. 37 killed on the first attempt; one SURVIVED — a guard that pinned the
>    plumbing of a fix without pinning that the fix CHANGED anything — and was
>    strengthened until it did not. The mutation caught it; reading it did not.**
>
>    **codex ran six rounds and found seven more, all valid, all absorbed,
>    none rejected** — full detail in `PLAN-PAYMENT-TRUTH` §6b's review log.
>    Rounds 2, 4 and 5 each found defects in the PREVIOUS round's fix, which is
>    the pattern CLAUDE.md §2c predicts and the reason a clean round 1 is not the
>    review. Two are worth knowing here because they
>    are about the FIX, not the original defect: the replacement pick deadline
>    showed the first kickoff rather than the lock the server enforces
>    (`lockBufferMinutes` earlier, up to an hour on Survivor/Margin), and the green
>    "all buy-ins cleared" state could sit directly above a positive Outstanding
>    Due, because base dues and rebuy dues settle independently under P3 and the
>    unpaid list is empty in exactly that case. The third — a head count taken as
>    `Math.max` of three source sizes rather than their union — was **inherited
>    verbatim from `PaymentsPanel`**, so the member-facing pot had it too and is
>    fixed by the same change.
>
>    ⚠️ **One stale comment is knowingly left behind:** `functions/src/setPaidStatus.ts`
>    still explains the entry mirror as REQUIRED because "the Bento ledger UI is
>    entry-backed". It no longer is. The mirror itself is still correct and still
>    wanted (`reconcilePaymentTruth` depends on the two stores converging), but the
>    stated reason is obsolete. Not fixed here because `functions/` is deployed
>    separately and a comment-only edit there would have owed a full functions
>    deploy. Fold it into the next PR that touches `functions/`.
> 2. ✅ **CLOSED 2026-07-29 — the seasonType filter now has ONE definition.**
>    Manager surfaces filtered `g.week === week` alone while member surfaces also
>    required the pool's season type, so on a pool holding a week-1 game of the
>    other season type the manager counted it and the member checklist did not —
>    observed live as "Total Matchups: 1" beside a `W1 —` (no-games) chip and a
>    "Week 2 picks not in yet" banner. Not only cosmetic: the manager's
>    `isWeekFullyFinal` gate for Score & Recap counted the unfiltered set.
>    `src/utils/nflPending.ts` now holds the only two definitions —
>    `gamesForPoolWeek` (8 call sites) and `poolSeasonType` (10) — and every
>    manager, member and service surface delegates to them. Grep the symbols
>    rather than trusting a line number.
>
>    **The sweep found a second, worse bug in the surfaces that were "correct".**
>    `seasonType` is OPTIONAL on a pool and omitting it means REGULAR season
>    (`shared/schemas/nfl.ts`, `shared/testPool.ts`), but every member-side copy
>    read it as bare `Number(pool.seasonType)` — which is `NaN` when unset, and
>    `NaN` matches no game. Such a pool rendered with **no schedule at all**: no
>    games to pick, `seasonOpenTime` null so the rules-edit lock never engaged,
>    and `subscribeToSiteConsensus` queried on `NaN`. The shared helper applies
>    the documented `|| 2` default, so those pools now behave as regular season.
>    Pools created through the wizard can legitimately omit the field
>    (`buildNFLPayload.test.ts` asserts it), so the affected population is
>    plausibly non-zero — **unverified in prod, no census was run.**
> 3. ✅ **CLOSED 2026-07-30 (#324) — one save control, and the page is split into
>    four sections.** There were five `SaveSettingsControl` instances, all calling
>    the same `handleSaveSettings`. Harmless and deliberate per the component's own
>    docblock, but they read as a bug, and they existed only because the page was
>    one ~870-line scroll that left the save button nowhere near whatever you had
>    just edited. The tabbed split (Overview / Members & Payments / Scoring /
>    Settings) removes the reason rather than the control: four in-section copies
>    are gone and the one at the foot of Settings remains. The three-column grid
>    that made the roster share a row with the scoring console is dissolved too.
>    Guarded by `tests/nfl-surface-invariants.test.ts`, which pins by source
>    OFFSET that each control sits inside the section claiming it — a moved block
>    landing in no branch compiles, lints and renders nothing.
> 4. **NO UI RENDERS `system/heartbeats`.** Every scheduled job's liveness and
>    verdict is written there (`lib/heartbeat.ts:46,84`), and the only way to
>    read it is the Firebase console. The SuperAdmin **Overview** tab's "Ops
>    Health" card is NOT it — that shows open monetization alerts and failed
>    Stripe webhooks plus a Sentry deep-link, nothing about jobs. The one
>    heartbeat the client does subscribe to is `system/scoreSync`, a different
>    doc for bracket score-sync freshness. So the whole `withHeartbeat`
>    investment — every verdict in `heartbeatVerdicts.ts`, including #314's new
>    delivery counters — is invisible to the operator by default. **Read it at**
>    <https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data/~2Fsystem~2Fheartbeats>
>    until a panel exists. Found 2026-07-28 while trying to verify #314 in prod.
>
> **First post-deploy `runReminders` beat: all counters zero** (Kevin,
> 2026-07-28). That proves the new build is live — `deliveryFailures` and
> `poolErrors` exist only in code that shipped this morning — but it does NOT
> exercise the delivery accounting: `queued: 0` / `skipped: 0` means no pool was
> inside a reminder window. Same trap as the PR-B2 queue watch below: a quiet run
> exercises the scheduler wrapper, not the path. Unproven until a real reminder
> window opens.
>
> ### Pool Manager surface defects — Kevin's walkthrough 2026-07-29
>
> Kevin worked the commissioner surfaces on a live Pick'em pool and raised five;
> two more turned up while verifying them. Every one is confirmed in source. None
> is a data-integrity problem — the authoritative stores are correct throughout.
>
> 5. ✅ **CLOSED 2026-07-29 — the cog was a dead end for every non-SQUARES pool.**
>    Root cause was NOT the cog. `AdminRoute` branched on PROPS, NFL_PLAYOFFS,
>    BRACKET and SQUARES — four of the seven `POOL_TYPES` — so the three NFL season
>    types fell through to the branch its own comment calls
>    `// Fallback for unknown types`. Fixing it in the router closed all three
>    entry points at once instead of patching each card. NFL pools now redirect to
>    `/pool/:id?tab=manager`, which is where their commissioner surface actually
>    lives; the tab rides in the URL by design, so mounting a second copy of the
>    dashboard at `/admin/:id` would have given that tab two URLs and nowhere to
>    keep state. **No authorization change** — the ownership guard at
>    `AdminRoute:78-81` sits above every branch, and `PoolRoute` computes
>    `isManager` itself, so the redirect defers the check rather than widening it.
>    Guarded by `tests/admin-route-invariants.test.ts`, which fails if an eighth
>    pool type is added without an admin destination. Original report:
>    `GlobalCommissionerDashboard.tsx:102` navigates to `/admin/${pool.id}`
>    unconditionally; `AdminRoute.tsx:143` serves only `SQUARES` and renders
>    *"Admin panel is only available for SQUARES pools"* for anything else — its
>    own comment calls that branch `// Fallback for unknown types`, so a Pick'em
>    pool is being treated as unknown. That is every NFL pool, on the
>    commissioner's primary navigation. `ManagerDashboard.tsx:713,785` route the
>    same way. Small fix, disproportionate reach.
> 6. ✅ **CLOSED 2026-07-30 — the chart's NEGATIVE left margin is gone.** It set
>    `left: -25` on a `layout="vertical"` BarChart, where the Y axis IS the label
>    column, so the category labels were dragged off the left edge. Now `left: 4`
>    with an explicit `YAxis width={68}` — without the explicit width recharts
>    falls back to its 60px default and re-crops the same labels, so the margin
>    alone was not the whole fix. **Was distinct from item 1** — that was the empty
>    data, this was the layout. Both were on the same card.
> 7. ✅ **CLOSED 2026-07-30 with item 1** — the "Advanced Payment Ledger" modal's
>    four tiles (Total Projected / Collected / Outstanding Due / Clearing Rate) and
>    its member table now read the same roster helpers as the card. Its empty state
>    also distinguishes "nobody has joined" from "nothing matches your filter";
>    it used to report the filter wording for both, which read as a filter problem
>    on pools that had members.
> 8. **The manager "AI Commissioner Chat" contains no AI.**
>    `handleSendBanter` (`NFLManagerBentoDashboard.tsx:220-233`) prepends a
>    hardcoded prefix to the typed text and pushes it into local React state — no
>    API call, no Gemini, no persistence, gone on refresh. The Savage/Pro/Analyst
>    selector only changes which prefix string is used; "AI MODERATION ACTIVE" and
>    "BANTER ENGINE STATUS" are decorative. **Not to be confused with
>    `AICommissioner.tsx`, which IS real** — it persists to
>    `pools/{id}/ai_requests` and `ai_artifacts` with comments. Two different
>    things share the name.
>
>    🔨 **KEVIN'S RULING 2026-07-29: make it real.** Gemini-backed, persisted, and
>    deletable by the pool manager, **rate-limited to no more than 5 posts per day
>    per pool**. ⚠️ **This is PLAN-GATED** — it needs a new callable, a new
>    Firestore collection and new `firestore.rules`, which trips the
>    **authorization** trigger in `mmp-change-control` §1. The limit MUST be
>    enforced server-side in the callable against a stored counter, and the rules
>    must forbid direct client writes to the banter collection; a client-side
>    limit is decoration and is bypassed by writing to Firestore directly.
> 9. ✅ **CLOSED 2026-07-30 — the fabricated commissioner analysis is gone.** The
>    top-player fallback hardcoded a mock roster name from
>    `DevDashboardPreview.tsx` and used it to seed the banter feed with a scouting
>    report about a late-season collapse — on a one-player pool where no week had
>    ever been played. Per Kevin's ruling the seed and the fallback are deleted and
>    the feed opens on an honest empty state that also says posts are not saved.
>
>    **The T3 "no fake dashboard cards" invariant now covers this file.** It only
>    ever read `SuperAdminBentoDashboard.tsx`, which is precisely why the same
>    defect class survived untouched on the commissioner one. The new
>    `T3 — no fabricated data on the commissioner bento` block asserts eleven
>    removed literals absent from the source, and it carries a guard-the-guard
>    assertion so a rename cannot make it pass vacuously.
>
>    ⚠️ **Extending that guard immediately found three more fabrications on the
>    same card, all now removed** (they were not in the original five reports):
>
>    * **Two commissioner buttons that did nothing.** "Recalculate Scores" popped
>      a toast announcing an ESPN score recalculation had begun and called
>      NOTHING; "Toggle Locks" did the same for locks. The real control ("Score &
>      Recap Week N") is further down the same page. This was the most dangerous
>      of the set: seven days from the HOF game, a commissioner clicking the decoy
>      would have been told scores were recalculating when nothing had happened.
>    * **An invented audit trail.** The "League operations log" rendered hardcoded
>      relative timestamps against a standings finalization and an ESPN schedule
>      sync, neither of which had run on the pool. The card carried nothing real,
>      and the genuine equivalent already exists and is already reachable — the
>      Payments tab renders the append-only `pools/{id}/payments` ledger with real
>      timestamps, for the commissioner too — so the card was REMOVED rather than
>      rebuilt against a second reader of the same data.
>    * **A hardcoded sixteen-hour pick deadline**, rendered unconditionally on
>      every pool whether or not the week held a game. It now shows the real first
>      kickoff of the displayed week, through `formatDeadline`, and renders nothing
>      when the week has no games.
>
>    Also corrected: the banter card's footer claimed an active AI moderation
>    capability. There is none (item 8); the label now says the panel is a draft.
> 10. ❌ **RETRACTED 2026-07-29 — this finding was NOT REAL.** It claimed
>    `ManagerDashboard.tsx:786` built its target with backslashes
>    (`` `\pool\${pool.id}` ``). It does not, and it never has:
>    `git log -S '`\pool\${pool.id}`' -- src/components/ManagerDashboard.tsx`
>    returns **no commits**, and the line reads `` `/pool/${pool.id}` `` at the
>    byte level (`od -c`). It was a misread of rendered grep output, asserted
>    without reproducing — the exact "a scary reading of a command's output is a
>    hypothesis, not a finding" failure CLAUDE.md §2c warns about. Left in place
>    rather than deleted so the retraction is visible to whoever read the claim.
>
>    **The related finding that IS real** — same class, different file:
>    `AdminRoute.tsx:85` built the Bracket share URL as
>    `` `${window.location.origin} /pool/${identifier} ` `` — a space on each side
>    of the path, so every Bracket share link carried
>    `https://host /pool/abc `. Verified at the byte level before acting on it
>    this time. **FIXED 2026-07-29** and guarded by
>    `tests/admin-route-invariants.test.ts`. Stray whitespace in a template
>    literal fails no typecheck, no lint and no existing test, which is why it
>    survived.
> 11. **`src/utils/poolSport.ts` kept a private copy of `NFL_SEASON_TYPES`**
>    while `shared/poolTypes.ts:21` holds the canonical list plus an
>    `isNflSeasonType` predicate. Same one-definition defect as #315 and #319, in
>    a file #315 had already touched. **FIXED 2026-07-29** — it now delegates.
>
> **Items 1, 6, 7 and 9 all shipped together on 2026-07-30** as the Bento truth +
> honesty pass, since they were all on `NFLManagerBentoDashboard`; **item 3
> followed the same day** as the tabbed split (#324). Of the walkthrough findings
> only **item 8** remains, and it waits on `PLAN-BANTER-PANEL`.
>
> ### NEW, found 2026-07-30 while fixing the ledger — NOT fixed
>
> 12. ✅ **CLOSED 2026-07-31 — Submission Health reads ROSTER truth.**
>    `submissionStats` and `unsubmittedPlayers` on `NFLManagerBentoDashboard`
>    were the last surface on that card still `entries`-derived, so a member who
>    joined and has no entry document was counted in NEITHER the total nor the
>    pending list. Readiness was computed over a SUBSET of the pool. Same root
>    cause as item 1 — `setPaidStatus.ts:162` mirrors onto the entry only
>    `if (entrySnap.exists)` — and the same fix: `buildPoolRoster`.
>
>    ⚠️ **This item's own description was wrong about the symptom, and the truth
>    is worse.** It claimed a pool with members but no entries reports "0 of 0" at
>    **100%**. It does not: `percentage` is guarded `total > 0 ? … : 0`, so that
>    pool showed **0%** — alarming, but not misleading. The real 100% case was
>    never described: **any pool where every entry holder has submitted and other
>    members have not.** One submitted entry beside three joined-but-unpicked
>    members read "1 of 1 — 100%". On kickoff night that tells a commissioner
>    everyone is in while three quarters of the room is not, and leaves the nudge
>    list empty. The original note also called the nudge list able "only to
>    under-report", which is true and was the reason this was deprioritised —
>    under-reporting *pending* is exactly what makes the percentage over-report
>    *ready*.
>
>    The rule now lives in `src/utils/poolRoster.ts` as `unsubmittedRoster`,
>    extracted rather than left inline so it could be unit-tested — #322 shipped a
>    plumbing-only guard on this card that survived mutation.
>
>    **Test counts, measured 2026-07-31** (date-stamped per `mmp-docs-and-writing`;
>    a bare number here reads as current forever, and qodo caught the first version
>    of this paragraph stating counts with no date — they were also already stale):
>    `src/utils/poolRoster.test.ts` **39**, `functions/.../memberRecord.plan.test.ts`
>    **13**, `functions/.../emulator/proxyPickLatch.emulator.test.ts` **5**,
>    `tests/admin-surface-invariants.test.ts` **84**.
>
>    **Mutation testing, 2026-07-31: 16 applied, 15 killed, 1 survived.** The
>    survivor was the result: `weeklyGameIds.length > 0 &&` could never change an
>    answer (`[].every()` is `true`), so it was dead code carried over from the
>    inline version, found by mutation rather than by reading, and deleted. ⚠️ Three
>    of the killed mutations targeted a host-exemption predicate that Kevin's
>    2026-07-31 ruling later removed, so those no longer correspond to live guards.
>
>    Also removed with it: the pending list rendered a **hardcoded placeholder
>    email address** for every member with none on file, shown as if it were
>    theirs, on the list a commissioner uses to chase people for picks. Now "No
>    email registered", matching the other two member lists on the card, and added
>    to the T3 no-fabricated-data invariant.
>
>    ⚠️ **The first version of this fix OVER-CORRECTED, and cross-model review
>    caught it.** Pool creation seeds the owner's Member Record with
>    `hasPlayableEntry: false` (`nflPools.ts:154-161`) because hosting is not
>    playing — `ensureMemberRecord` gives such a MANAGER `feeOwed: 0`. Counting
>    that host as an outstanding pick means a pool where every actual player has
>    submitted can **never reach 100%**: a permanently-wrong readiness number in
>    place of an intermittently-wrong one. Now excluded by `isPlayingMember`,
>    applied to the pending list AND the denominator. The discriminator is
>    `isOwner && !hasEntry`, **not** `hasPlayableEntry`, because that flag is
>    never persisted to any document — it is an input to the fee maths only
>    (`lib/memberRecord.ts:61-63`), so no client can read it.
>
>    ✅ **The limitation codex raised is CLOSED by Kevin's ruling 2026-07-31:
>    assume every pool manager is also playing, 99% of the time.**
>
>    The first version of this fix exempted `isOwner && !hasEntry`, which let a
>    pool read 100% while the commissioner personally had not picked — a host who
>    intends to play but has not submitted is indistinguishable from a host-only
>    commissioner. **Persisting `hasPlayableEntry` does not fix that on its own**:
>    the flag means "has committed an entry", a synonym for `hasEntry` the client
>    already had. Settling the prior is what fixes it. The exemption is gone, so
>    an entry-less manager is a genuine outstanding pick and the card reaches
>    100% when they submit.
>
>    ⚠️ **The DUES rule is untouched.** A manager still owes nothing until they
>    commit an entry (`feeOwed` stays 0). Money liability and pick liability are
>    different questions, and conflating them is what produced a wrong answer in
>    both directions.
>
>    **`hasPlayableEntry` is now PERSISTED** on the Member Record
>    (`shared/memberRecord.ts`) as a one-way latch — `false` at create, upgraded
>    to `true` on first submit, never lowered. It used to be computed in
>    `planMembershipWrite` and thrown away, so nothing could ask a Member Record
>    "has this person ever entered?" without also joining the entries collection.
>    The dangerous direction is DOWN: `ensureMemberRecord` is touched on every
>    re-join (`nflPools.ts:238`) with the fact omitted, and a naive
>    `!!facts.hasPlayableEntry` on the update branch would un-submit those
>    members. Mutation-tested in both directions.
>
>    ⚠️ **`undefined` means UNKNOWN, not `false`** — every record written before
>    2026-07-31 lacks the field. **NO BACKFILL IS NEEDED**: readers fall back to
>    entry evidence and `ensureMemberRecord` heals records on touch. The plan
>    stamps the latch **only when the caller established the fact**; codex caught
>    the first version coercing `undefined` to `false` on the backfill-on-touch
>    path (`nflPools.ts:238`), which reaches the CREATE branch for a legacy
>    participant who may *already* have an entry and would have recorded a durable
>    "never entered" for them. The brand-new-join site states `false` explicitly,
>    because that caller genuinely knows. Nothing keys
>    on the latch today; it is carried so an explicit host "I'm not playing"
>    opt-out has a durable field when one exists.
>
>    ✅ **A hypothesised fee defect was CHECKED AND DISPROVED rather than
>    written down.** The reasoning was that a MANAGER touch omitting
>    `hasPlayableEntry` would compute `liableFee` as 0 and heal a record to owe
>    nothing. It cannot happen on any current call site: the two join-touch paths
>    hardcode `role: 'PARTICIPANT'` (`nflPools.ts:238,271`), the submit path
>    passes `true` (`:633`), creation passes `false` explicitly (`:156`), and
>    `poolCreation.ts:166` passes no `entryFee` at all. Recorded because *not*
>    finding a bug is also a result, and because the previous version of this file
>    shipped a plausible-sounding mechanism that turned out to be impossible.
>
> 13. **`sendManualReminder` cannot reach a member who has never submitted, and
>    said nothing about it.** It resolves targets from the ENTRIES collection
>    (`functions/src/manualReminders.ts:66-72`), so an entry-less member's uid
>    filters to nothing and the callable returns `sent: 0, skipped: 0` **without
>    erroring** — which the Bento card rendered as "Sent 0 reminder(s), 0 skipped"
>    in a *success* toast. Third instance of the same class in this codebase after
>    #314's unbound `COURIER_AUTH_TOKEN` and the zero-counter reminder heartbeat:
>    an absent error read as a pass.
>
>    **Partly fixed 2026-07-31, frontend only.** A zero-send now reports as an
>    error naming the reason, and the button on an entry-less row reads "Not
>    Started" and is disabled. **The durable fix is still OPEN**: resolve reminder
>    targets from Member Records (or user docs) rather than entries, so the
>    commissioner can actually chase the people least likely to have picked. That
>    is a `functions/` change and owes a functions deploy — fold it into the next
>    PR that touches `functions/`, alongside the stale `setPaidStatus` comment
>    already queued there.
>
> ### ⛔⛔ APP CHECK TOOK PRODUCTION DOWN ON 2026-07-30. DO NOT "FIX" THE WARNING.
>
> **`VITE_RECAPTCHA_SITE_KEY` is absent from the Coolify build environment, so
> `src/firebase.ts:25` skips App Check and every prod bundle logs
> `⚠️ SECURITY: App Check is NOT active`. THAT WARNING IS THE CORRECT AND SAFE
> STATE. LEAVE IT.**
>
> **What happened.** Setting that env var in Coolify and rebuilding took the site
> down: it hung on a spinner and rendered nothing. Confirmed from two independent
> machines on two networks, so it was not one browser's cache. Rolled back by
> DELETING the variable and redeploying.
>
> ⚠️ **WHEN this happened is NOT pinned down, and two accounts of the bundle
> hashes conflict.** The incident report describes the add and the rollback as
> two Coolify rebuilds *after #321* with no code change between them, which would
> make them the `index-D1wLGiMy.js` → `index-C31xivRN.js` → `index-CR5oJEHh.js`
> transitions. But this same document (lines 41 and 44) attributes those two
> transitions to the **#322** and **#324** rebuilds, each verified against the
> prod HTML at the time. Both attributions cannot be right about the same two
> hashes. Most likely the incident sits somewhere else in the sequence and its
> rebuilds were never recorded — but that is a guess, and it is written here as a
> guess. **Do not use "a bundle hash moved without a merge" as evidence about this
> incident in either direction until Kevin reads the Coolify deployment history;
> the morning task list has that step.** Found by self-review after codex round 4
> came back clean, which is the reason a clean round is not the end of the review.
>
> ### What is OBSERVED, and what is only HYPOTHESIS — they are not the same here
>
> **OBSERVED (act on this).** Variable set → rebuild → site dead. Variable
> deleted → redeploy → site alive. Two machines, two networks. The operative
> instruction — *do not set it* — rests on this alone and does not depend on any
> mechanism being right.
>
> **HYPOTHESIS (do NOT repeat as established).** The proposed mechanism was: the
> key flips `src/firebase.ts:25` from the skip branch to the initialize branch;
> `ReCaptchaEnterpriseProvider` loads
> `https://www.google.com/recaptcha/enterprise.js`; `nginx.conf`'s `script-src`
> lists no Google reCAPTCHA host so the browser refuses it; the App Check token
> never resolves; and the Firestore SDK — which waits on that token before its
> first request — times out after ~10s and goes offline.
>
> ⚠️ **Cross-model review holed that story, and it has not been repaired.** The
> tracked `Dockerfile` declares `ARG`/`ENV` for exactly **six** variables, all
> `VITE_FIREBASE_*` (`Dockerfile:15-27`), and `.dockerignore` excludes `.env`.
> Vite only bakes in variables present at `npm run build:static` (`Dockerfile:30`).
> So a Coolify variable named `VITE_RECAPTCHA_SITE_KEY` has **no tracked path into
> the bundle at all**, and a runtime variable cannot alter an already-built static
> bundle. If the tracked Dockerfile is what Coolify builds, the key never reached
> `src/firebase.ts:24` and the branch never flipped.
>
> Something took the site down and removing that variable brought it back. But
> **why** is now an open question, and it is a live one, because an unexplained
> way to kill production eight days before the pilot is worse than an understood
> one. Three candidates, none checked: (a) Coolify's build for this app does not
> use the tracked `Dockerfile`; (b) the Dockerfile was edited and reverted, or an
> `ARG` was added out-of-band; (c) the variable was coincidental and the real
> cause was something else in those two rebuilds. **Kevin's morning task list has
> the steps to distinguish them.**
>
> **Server-side `monitor` mode does NOT save you, and believing it did is what
> made this look safe.** App Check is enforced nowhere — verified, not assumed:
> `functions/src/lib/validated.ts:94` defaults to `"monitor"` and `:97` sets
> `enforceAppCheck: appCheck === "enforce"`; `functions/src` contains **98
> `appCheck:` declarations passed to `validated()`, all `monitor`, zero
> `enforce`**, plus **26 bare `onCall(` sites** across 12 files that pass no App
> Check option whatsoever (`logClientError.ts:35` is the only one that names it,
> and it sets `false`). ⚠️ Say "98 validated callables", not "98/98 callables" —
> the bare endpoints are neither monitored nor enforcing, and calling the whole
> fleet `monitor` overstates the coverage. But that whole paragraph governs
> whether the SERVER rejects a tokenless call, and any client-side theory of this
> outage is unaffected by it: a server-side allowance cannot rescue a client that
> never gets far enough to make a request. The previous version of this block drew
> exactly the wrong inference from a true fact, and that inference is deleted.
>
> **Four faults, ALL STILL UNFIXED. Re-enabling App Check needs all four.**
>
> 1. **CSP is missing the reCAPTCHA hosts.** Verified in `nginx.conf` at the byte
>    level: all three `Content-Security-Policy` headers (lines 33, 52, 82 — `/`,
>    `/pool/:id`, `/join/:id`) omit `https://www.google.com/recaptcha/` and
>    `https://www.gstatic.com/recaptcha/` from `script-src`, and
>    `https://www.google.com/recaptcha/` from `frame-src`. Same class as #320's
>    Sentry gap, in the same file, in a directive nobody checked while fixing
>    `connect-src`. **Inert while the env var is unset** — it may be fixed
>    opportunistically by a PR already editing the CSP, but fixing it does NOT
>    make it safe to set the key, because faults 2 and 3 remain.
> 2. **Wrong reCAPTCHA product.** `src/firebase.ts:27` constructs a
>    `ReCaptchaEnterpriseProvider`, which requires a reCAPTCHA **Enterprise** key
>    from Google Cloud. The key that was created is reCAPTCHA **v3**. Different
>    products; incompatible even with the CSP fixed. *(The provider is verified in
>    the repo; **which key was created is Kevin-attested** — no console was read.)*
> 3. **The web app was never registered in the Firebase console's App Check
>    section.** Required regardless of key type. *(**Kevin-attested**, not
>    repo-verifiable, and it contradicts the 2026-07-06 attestation below — one of
>    the two is wrong.)*
> 4. **The build cannot receive the key.** `Dockerfile:15-27` declares `ARG`/`ENV`
>    for six variables and none of them is `VITE_RECAPTCHA_SITE_KEY`, and
>    `.dockerignore` excludes `.env`, so nothing puts it in front of
>    `npm run build:static` at `Dockerfile:30`. This fault was **found by codex
>    reviewing this very record** and it is why the mechanism above is labelled
>    hypothesis: whatever killed the site, the tracked build has no way to hand
>    that key to Vite. Enabling App Check would need this ARG added — which also
>    means adding it is the thing that would make the key dangerous, so do not add
>    it "for later".
>
> **Re-enabling App Check is a scoped project, not a warning to clear.** Do not
> set `VITE_RECAPTCHA_SITE_KEY`; do not tell Kevin the warning is safe to clear;
> do not schedule it before the pilot.
>
> ⚠️ **A contradicted claim, flagged rather than silently rewritten.** Several
> skills carry an owner attestation dated 2026-07-06 that "App Check is ENFORCED
> in the Firebase console". Fault 3 above says the app was never registered, which
> cannot both be true. The code is unambiguous (98 validated callables on
> `monitor`, zero `enforce`, and 26 bare `onCall` sites with no App Check option),
> and Firestore itself is plainly not enforcing — an enforcing Firestore with no
> registered app would reject every read, and the site works. Treat the 2026-07-06
> attestation as **superseded and UNVERIFIED**. Nobody has read the console App
> Check page in this session.
>
> The skills that carried that attestation were corrected in the same PR:
> `mmp-architecture-contract`, `mmp-build-and-env`, `mmp-change-control`,
> `mmp-config-and-flags`, `mmp-debugging-playbook`, `mmp-deploy-and-operate`,
> `mmp-diagnostics-and-tooling`, `mmp-docs-and-writing`, `mmp-failure-archaeology`
> and `mmp-superadmin-surface` — **ten**, plus `PRESEASON-READINESS-CHECKLIST`
> (G3), `PICKUP`, and `PHASE0-DEPLOY-CHECKLIST` Step 4, which told an operator to
> confirm App Check enforcement on the strength of three separately false
> premises and is now marked VOID.
>
> ⚠️ **An earlier draft of this paragraph asserted the sweep was complete when it
> was not**, naming eight skills while `mmp-docs-and-writing` and
> `mmp-superadmin-surface` still reported enforcement as done — and the latter
> still listed "re-enable `enforceAppCheck` on logClientError" as open work. codex
> caught it as a P1. Recorded because the failure is instructive: the sweep step
> was performed, its own completeness was then asserted from memory rather than
> re-grepped, and a claim of thoroughness is exactly the kind that nobody
> re-checks. If you extend this record, **re-run the grep and count** rather than
> trusting this list:
>
> ```
> Get-ChildItem .claude\skills,*.md -Recurse -Filter *.md | Select-String -Pattern 'App Check (is )?ENFORCED'
> ```
>
> ### Historical: the 2026-07-27 stop point (superseded by the box above)
>
> **Functions + rules were deployed from <!-- deploy-state:ignore --> `main` @ `d3d2b0d`.**
> #311 (`nfl_rescore_queue`, PLAN-REALTIME-SCORING §5b) merged and deployed the
> same hour, verified three ways: an all-`Successful update operation` first run
> ending `✔ Deploy complete!`; a SECOND full-fleet run reporting every function
> `Skipped (No changes detected)`; and `firebase functions:list` showing
> `nflSpreadRescoreTrigger` as v2 on
> `google.cloud.firestore.document.v1.updated`, us-central1, nodejs22. Rules did
> not change in #311.
>
> ### The queue is DEPLOYED but INERT
>
> `system/config.nflAutoScore` stays UNSET = disabled. The enqueue side starts
> writing events immediately, and they ACCUMULATE — nothing drains them while the
> job is off. **A dry run does not drain them either:** it reads the queue,
> reports what it would do, and acknowledges NOTHING by design (codex r30), so
> the events survive the flip to live and are applied then. So during the
> dry-run watch, judge the queue against what the run REPORTED: every event the
> heartbeat says it observed must still be there afterwards. An empty queue is
> not a fault on its own — it just means nothing was enqueued, which is the
> normal state before the season starts — but see prerequisite 2 below: an empty
> queue also means the watch has proven nothing about the queue path.
>
> ### Arming prerequisites: 1 of 3 CLOSED
>
> 1. ✅ **The `publishedWeeks` cold-start backfill is CLOSED — and it never needs
>    running.** The dry run executed in prod on 2026-07-27:
>    `{"dryRun":true,"poolsScanned":15,"poolsChanged":0,"weeksMarked":0,"plannedWrites":[],"failures":[]}`.
>    `poolsScanned: 15` matches the census exactly, and the migration queries ALL
>    NFL-season-type pools with no season filter — so that zero covers the whole
>    population, not just 2026. There are no legacy manually-scored weeks to
>    stamp because the season has not started. **Do NOT click the destructive
>    button**; it would be a no-op. It stays closed with no maintenance:
>    `scoreNFLWeekInternal` is the only scoring path and the manual "Score Week"
>    callable delegates to it, and the `publishedWeeks.{week}` stamp lives inside
>    that function — so hand-scoring the HOF week marks it too. **Precisely:** the
>    stamp is written only when `games.some(revealed)` is true, so a mid-week
>    provisional click that reveals nothing does not mark the week. (Grep the
>    symbols rather than trusting line numbers — an earlier draft of this box
>    cited three that #311 had already shifted.)
> 2. ⬜ **PR-B2 must be watched in DRY RUN before live — and the watch only
>    counts if it SAW something.** Arm `{ enabled: true, dryRun: true }` and read
>    the heartbeat detail. Before the preseason starts there is nothing to
>    enqueue, so `queuedEvents: 0` for a day proves only that the scheduler
>    wrapper runs — it exercises none of the read/group/no-ack path. The bar is
>    **at least one event observed AND still in the queue afterwards** (a dry run
>    acknowledges nothing, so it must survive). If no natural event appears
>    before the HOF game, either accept that this prerequisite is UNPROVEN and
>    say so out loud when arming, or arm live only after the first real slate has
>    produced one.
> 3. ⬜ **The >24h stale-finalize path** (plan §7) — still open. Either arm
>    `nflDeepSweep` with writes after its own dry-run trial, or build the
>    uncapped stale-slate re-fetch.
>
> ### What #311 carries
>
> **11 codex rounds, 21 findings, all absorbed, none carried** (Kevin raised the
> cap from 5 → 10 mid-effort and authorized round 11 specifically). Round 4 came
> back clean and self-review still found a stale counter name; round 8's first
> finding was a REGRESSION introduced by round 6's own fix. The R11 fix — widening
> the transition predicate so a reinstated `CANCELLED` game enqueues — is the one
> change that has not itself been through a round.
>
> **Risk is concentrated in one place: queued Survivor rescoring.** A queued pass
> may score Survivor only when no week AT OR AFTER the queued one carries a
> `scoredWeeks` or `publishedWeeks` marker. Everything else is refused, because
> `computeSurvivorWeekUpdate` retains later strikes while rewriting
> `eliminatedWeek` — both a replay and an out-of-order run corrupt the ledger.
> What remains is a **deferral, not a corruption**: it surfaces as
> `survivorQueuedDeferred` in the heartbeat and waits for the reset-and-replay
> sub-PR. **A late Survivor correction has NO safe manual repair — do not
> hand-score a Survivor week to fix one.** Pick'em and Margin are unaffected.

> ### Historical: the 2026-07-27 night stop point (superseded the same night)
>
> **Functions + rules were deployed from <!-- deploy-state:ignore --> `main` @ `6b7e439`.**
> P3 (#308, the rebuy-paid control — `rebuyPaid` finally has a writer) merged
> and deployed the same hour: `--only functions:setPaidStatus`, Coolify
> rebuilt (bundle `index-Na2D7cdu.js`). The only runtime files changed since
> the previous tag are setPaidStatus + its schema, both deployed; rules
> unchanged — fleet ≡ tag. #308 carries ONE named residual (client-side legacy
> rebuy pricing vs the server's ledger-priced settle; display-only,
> self-correcting, plausibly-zero population — see the PR body).
>
> **PLAN-PAYMENT-TRUTH IS CLOSED.** Every build item shipped and deployed
> (P4 backfill live-run 72 records · P1 Bento repoint · P2 reconciliation
> with prod divergence count = ZERO · P3 rebuy control), and **Kevin ran
> Recalculate Global Stats on 2026-07-27**:
> `{"success":true,"message":"Recalculated from 31 pools. Skipped 0 errors.","totalPrizes":645,"totalDonated":0}`.
> The homepage now shows **$645 Total Prizes Awarded** (verified live) —
> down from the $5,535 the public doc carried before, which was inflated by
> test-pool money; $645 is the discriminator-filtered honest figure the whole
> stats+payment-truth chain existed to produce. D11 (Props payment model)
> stays an open product question; #308's one named display residual stands.

> ### Historical: the 2026-07-27 evening stop point (superseded same day)
>
> **Functions + rules were deployed from <!-- deploy-state:ignore --> `main` @ `b1df185`.**
> P2 (#306, `reconcilePaymentTruth`) merged and deployed the same hour:
> `--only functions:reconcilePaymentTruth,functions:setPaidStatus` (the second
> carries the undefined-amount ledger-write fix — this project has no
> ignoreUndefinedProperties), Coolify rebuilt (bundle `index-Bb038KuO.js`).
> No other functions-runtime source and no rules changed between the previous
> tag and this one, so the live fleet ≡ the tag.
>
> **The P2 dry run RAN in prod and the answer is ZERO divergence**: 15 NFL
> season pools scanned (+8 test-skipped +112 other-type = 135 docs, matches
> the census exactly), 3 consistent-paid pairs, 0 promotions, 0 mirrors,
> 0 orphaned paid entries, 0 ambiguous, 0 failures. Nobody ever hit the D13
> trap on a pool that had Member Records — the live reconciliation is
> vacuously satisfied. **The only remaining gate before Recalculate Global
> Stats is Kevin's own click** (destructive card, type-RUN): backfill ✓,
> P1 ✓, P2 count ✓ = 0. After Recalculate: P3 (rebuy-paid control) is the
> last plan item.

> ### Historical: the 2026-07-27 afternoon stop point (superseded same day)
>
> **Functions + rules were deployed from <!-- deploy-state:ignore --> `main` @ `25e730e`.**
> Everything between the two named states was deployed as it landed
> (2026-07-27, Kevin's execution grant): the full fleet at the #290 merge
> (164 functions, one 429-quota solo-redeploy of `syncGameStatus`), rules the
> same hour, then `backfillMemberRecords` + `backfillPublishedWeeks` at #296
> and `setPaidStatus` at #294. No other functions-runtime file changed in
> between (verified by diff), and rules did not change after their deploy —
> so the live fleet ≡ the tagged SHA. Frontend: Coolify rebuilt TWICE
> (manual, via dashboard; bundle now `index-CYTPq50I.js` from the same
> commit, healthcheck healthy both times).
>
> **The D25 backfill RAN, live, and verified three ways:** dry run predicted
> 72 member creations across 127 pools (= census exactly: 135 docs − 2 sim −
> 6 flagged; testPoolsSkipped 8); the live run (Kevin typed the RUN confirm)
> created exactly 72 with zero failures and stamped 127 pools; the follow-up
> dry run reported 0 to create / 152 already present. **D13 is closed**: the
> P1 Bento (both paths through `setPaidStatus`, entry mirror in-transaction)
> is the deployed frontend.
>
> **Found-in-prod during the run, fixed same night (#296):** the backfill's
> FIRST page failed schema validation — the Firebase JS SDK encodes the
> panel's explicit-undefined `startAfter` as null on the wire, and
> `z.string().optional()` rejected it. The emulator suite was green because
> firebase-functions-test bypasses the client serializer. Cursor schemas now
> take null as first-page; the panel conditional-spreads the cursor.
>
> **Still gated (unchanged):** Recalculate Global Stats waits for P2's
> reconciliation (NOT BUILT — next session's job, PLAN-PAYMENT-TRUTH §4/P2),
> then P3 (rebuy-paid control). `nflAutoScore` / `statsRecompute` stay unset.
> Open PRs: only #133 (tailwind major, deliberately untouched).

> ### Historical: the 2026-07-25 stop point (superseded)
>
> **Functions + rules were deployed from <!-- deploy-state:ignore --> `main` @ `8a55b84`.**
> Deployed 2026-07-25 in this order: `--only functions`, then
> `--only firestore:rules`, then the manual Coolify frontend rebuild. The order is
> load-bearing here — the new rules DENY a client-direct `settings` write on NFL
> pools, and the old frontend bundle still did exactly that, so commissioner
> "Save Settings" is broken between the rules deploy and the Coolify rebuild. Both
> deploys ended `✔ Deploy complete!`; Coolify's deployed SHA was checked against
> `git rev-parse origin/main`.
>
> **Prod-verified, not assumed:** an NFL Pick'em pool (Confidence Mode + Weekly
> lock — so the `confidenceMode`/`lockMode` lock-affecting path) saved from its
> Manager tab through the new `updatePoolSettings` callable: "Pool settings saved
> successfully!". That is the one check that exercises the rules-deny + callable
> pair end to end.
>
> **The FUNCTIONS and FRONTEND queues are both EMPTY.**
>
> ### The deploy lesson from this run — a FOURTH silent-success incident
>
> **The first `--only functions` run ended WITHOUT `✔ Deploy complete!` and left 10
> functions stale**, printing no error at all — the command simply returned. The
> stale set included `nflAutoScoreJob` and `nflFinalizeSweepJob`, both changed by
> #279. A second identical run reported every other function `Skipped (No changes
> detected)` and updated exactly those 10, then printed `Deploy complete!`.
>
> **What the evidence actually is, stated precisely.** The second run accounted
> for the WHOLE fleet with no gaps: every function reported either `Skipped (No
> changes detected)` or `Successful update operation`, and the run ended
> `✔ Deploy complete!`. That is sound coverage. It is **not** an all-Skipped
> report — that pass updated 10 functions, so it cannot be its own confirmation.
> A third pass reporting nothing but Skipped has NOT been run; it would be
> belt-and-braces, not a gap.
>
> **Rule for future deploys: keep re-running the full-fleet deploy until a run
> reports EVERY function `Skipped (No changes detected)`.** That report is the
> positive evidence. The absence of an error message is not evidence of anything —
> the same lesson as the three silent-success incidents already recorded below
> (`--only functions:a,b,c` deploying only `a`, and the two stale-checkout
> deploys).
>
> ### What #279 shipped — G1 PR-B′, concurrency + authorization hardening
>
> The guards `PLAN-REALTIME-SCORING.md` §7 requires **before `nflAutoScoreJob` can
> be armed live**: the fenced scoring lease (`pool.autoScore.scoringLease`) as the
> mutex across every scorer, `settings.lockRevision`, the `extendWeekDeadline`
> publish guard reading `pool.publishedWeeks`, server-only scorer fields with a
> merge-preserving `updatePoolSettings`, and the per-entry submission watermark.
>
> Baselines moved: functions unit **1004 → 1048**, emulator **177 → 187** pass (10
> skipped, unchanged), root vitest **291 → 301**.
>
> **`nflAutoScore` is still UNSET = disabled** (fail-safe). **THREE prerequisites
> remain before arming** — all three, not any two:
> 1. **PR-B2** — the `nfl_rescore_queue` durable tier (not started; next PR).
> 2. **`nflDeepSweep` live WITH WRITES** — a dry-run deep sweep does not write
>    `nfl_games`, so a game finalizing >24h after kickoff is never observed.
>    **This is a BOUNDED fix, not a complete one** (plan §3a crit. 6): the deep
>    sweep only re-fetches inside its own `lookbackDays` window (default 7, max
>    30), so a game that first goes terminal beyond that window is still never
>    fetched and stays unscored. Adequate for the preseason pilot — no realistic
>    postponement exceeds 30 days — and the arming note must say so out loud. The
>    general answer is the **uncapped stale-slate re-fetch** (query `nfl_games`
>    for past-start non-terminal games with no age cap, re-fetch ESPN, enqueue),
>    which must be built **before the regular season**.
> 3. **The `publishedWeeks` backfill must have been RUN** (see below). Arming
>    without it leaves every manually-scored pre-#279 week unmarked, so the new
>    publish guard cannot stop those weeks being reopened after their results were
>    shown — exactly the hole it exists to close.
>
> `PRESEASON-READINESS-CHECKLIST.md` G1 carries the same three; keep them in sync.
>
> ⚠️ **#279 did NOT reach a clean codex round.** 3 rounds ran — 8 findings, all
> absorbed with a regression guard each — and round 4 returned `Quota exceeded.
> Check your plan and billing details` on two attempts, so the PR merged carrying
> an un-run round rather than a converged one.
>
> **The quota RECOVERED later the same evening** and `codex exec review` works
> again — it reviewed the docs PR that wrote this box. **Cross-model review is NOT
> blocked; do not skip it on the next PR.** The failure is recorded because it is
> a real availability risk mid-effort, not because it is still in force.
>
> ⚠️ **A pending prod-data action:** the `publishedWeeks` cold-start backfill has
> NOT been run. Until it is, the new publish guard does not fire on weeks scored
> before this release — no worse than before it shipped, but run it before the
> auto-scorer is ever armed. **SuperAdmin → Operations → "Backfill Published
> Weeks (dry run)"** first, review `plannedWrites`, then the live button. Steps in
> `MORNING-2026-07-26.md` §2c.

> ## ✅ STOP POINT 2026-07-24 — #265 functions deployed (SUPERSEDED by the box above)
>
> **Functions were deployed from <!-- deploy-state:ignore --> `main` @ `49c12a9`.**
> Deployed 2026-07-23 (bare `--only functions --project gridiron-gamble-uzuqo`,
> confirmed `✔ Deploy complete!`). Carries #261, #262 and #265 — the
> public-profile header/footer fix, the `runReminders` read-amplification fix
> (~966K Firestore reads/day removed; verify the drop via Query Insights), and
> the 15-minute reminder cadence. `createCheckoutSession` / `handleStripeWebhook`
> each needed an isolated redeploy to clear a secret/plain env-var overlap after
> a stray `functions/.env` (now comment-only) — both landed clean.
>
> ✅ **The FRONTEND was CURRENT as of 2026-07-24.** Kevin merged #266 and triggered
> the Coolify rebuild; the #261 profile fix went live — verified against
> `/profile/:uid` (header + footer render for a logged-out viewer, bundle
> `index-BhilVMpo.js`). Both queues were empty **at that date**; the 2026-07-25
> box above is the current state.
>
> ⚠️ The SHA appears **once** in this file, in the tagged claim above. Every
> other mention says "the tagged SHA" on purpose: `docs-state-invariants` only
> guards the tagged deploy-state construction, so a bare copy of the hash is
> invisible to it and rots on the next deploy while the suite stays green.
> (This note deliberately does not reproduce that construction — doing so makes
> the scanner read the example as a third claim, which failed the suite once
> already while writing this very paragraph.)
>
> ### What shipped since the morning
>
> **2026-07-23:** #261 (frontend — profile header/footer, **now live** after the
> 2026-07-24 Coolify rebuild),
> [#262](https://github.com/kstruck/MMPoolsV3/pull/262) (functions —
> `runReminders` read fix, **deployed**) and
> [#265](https://github.com/kstruck/MMPoolsV3/pull/265) (functions — 15-min
> reminder cadence + bracket-window widening, **deployed**) landed on top of the
> list below.
>
> The three morning PRs plus three more, all merged and now deployed:
>
> | PR | What |
> |---|---|
> | [#255](https://github.com/kstruck/MMPoolsV3/pull/255) | BANNED owner rejected on `recordPoolPayouts` / `simulateGameUpdate` / `simFillSquares` — the live authz gap, now CLOSED in prod |
> | [#256](https://github.com/kstruck/MMPoolsV3/pull/256) | Heartbeat verdicts extracted to `lib/heartbeatVerdicts.ts` + unit tests |
> | [#257](https://github.com/kstruck/MMPoolsV3/pull/257) | Emulator coverage: finalize sweep + `replayFeedSnapshot` |
> | [#243](https://github.com/kstruck/MMPoolsV3/pull/243) | `functions/` body-parser 1.20.5 → 1.20.6 |
> | [#259](https://github.com/kstruck/MMPoolsV3/pull/259) | Every wall-clock job pinned to `America/New_York` — see §4 for the schedule |
> | [#260](https://github.com/kstruck/MMPoolsV3/pull/260) | PLAN gate scoped to money/authz/prod-data/scoring (docs) — did NOT need a deploy |
>
> Kevin's two rulings (2026-07-22): **pin all wall-clock jobs to ET** (#259), and
> **scope the PLAN gate to blast radius, not file count** (#260). Both live.
>
> Test counts now: functions vitest **962** (+9 from #262's
> `reminderWeekContext` guards, +6 from #265's `reminderBracketCadence`),
> emulator **132**, root vitest **291**.
>
> **qodo is billing-blocked** as of 2026-07-21 and reviewed none of these six.
> codex (CLAUDE.md §2c) is the only working reviewer. See CLAUDE.md §2b.
>
> ### The evening's second effort (overnight of 2026-07-22)
>
> Kevin queued four product items — profile-page header/footer, SuperAdmin
> Overview stats (reset + exclude test pools), a filterable Stats tab, and a
> Sentry error triage. See **MORNING-2026-07-23.md** (if present) for what got
> built and what needs Kevin.
>
> ---
>
> ## ✅ STOP POINT 2026-07-21 (~17:00Z / 13:00 ET) — historical
>
> **Deployed <!-- deploy-state:ignore --> `main` @ `6ca9e7f`.** Functions
> deployed 2026-07-21 ~16:40Z (12:40 ET); Coolify rebuilt the frontend on the
> same commit and its container passed healthcheck at 16:54Z (12:54 ET). This
> box is kept for the verification pattern it records; the deploy state above
> supersedes it.
>
> ### 1. What shipped
>
> Six PRs merged overnight — #245 and #250 (heartbeats across the whole
> scheduled fleet, and making them report failure honestly), #247 (spread-lock
> write-path coverage), #248 (docs-state invariant), #249 (CI audits
> `functions/` too), #251 (the morning runbook +
> `SECURITY-BARE-ONCALL-CLASSIFICATION.md`).
>
> The deploy also carried six PRs pending since before that run — **#239, the
> Firestore-reads fix** — plus #240, #237, #238, #241, #244.
>
> ### 2. The finding that mattered — the deep-sweep schedule is alive
>
> `nflDeepScoreSweepJob` stamped `system/heartbeats` at **11:30:08 ET on
> 2026-07-21** — about 70 minutes before the 12:40 ET deploy that same day — and that stamp carried **no `detail`
> field**. The post-#245 code always writes `detail: { enabled: false }` on the
> disabled path, so its absence proves the stamp came from the PRE-deploy build.
>
> **Cloud Scheduler fires this job on time.** That is the question that went
> unanswered for ten days on the finalize sweep, and it is now answered.
>
> ### 3. First production evidence for the new heartbeat code
>
> Read off `system/heartbeats` ~15 minutes after the deploy:
>
> | Job | Evidence |
> |---|---|
> | `syncNFLScoresJob` | all six counters present, all zero, `ok: true` — **#245** |
> | `autoLockPools` | `detail.duePools: 0` — #250 |
> | `runReminders` | `detail.failedPools: 0` — #250 |
>
> That is **two of #250's nine** handlers, plus one of #245's.
> `syncNFLScoresJob` lives in `nflSchedule.ts` and was changed by #245, not #250
> — worth keeping straight so #250's coverage is not overstated.
>
> Note what `syncNFLScoresJob` did: `slates: 0` — no games in the active window,
> correct for July — and it reported that as **healthy, not degraded**. The
> cry-wolf case behaves.
>
> ### 4. Heartbeat timing — every wall-clock job is pinned to ET
>
> **Kevin's ruling 2026-07-22: pin them all to `America/New_York`.** Previously
> seven daily-or-slower jobs declared no `timeZone`, so Cloud Scheduler ran them
> in UTC and they landed in the small hours ET — which is how this box came to
> document `nflFinalizeSweepJob` as an 08:30 job when it ran at 04:30 ET.
>
> **The five clock-scheduled jobs keep their current (EDT) run time** — the
> declaration moved from a UTC hour to the equivalent ET hour. Be precise about
> what that trades, though: an unpinned job is fixed in UTC and its ET hour
> moves across DST; a pinned job is fixed in ET and its **UTC** hour moves. So
> in winter these fire an hour later in UTC than they used to. That is the point
> of the ruling — stability in the zone everyone actually reads — not a
> side-effect.
>
> The two that used `every 24 hours` changed more: an interval anchored to the
> last run cannot carry a timeZone, so they became explicit nightly crons.
>
> No schedule sits in 02:00-02:59 ET (does not exist on spring-forward) or
> 01:00-01:59 ET (happens twice on fall-back).
>
> | Job | Schedule (all ET) | Changed? |
> |---|---|---|
> | `aggregateRevenueDaily` | `30 0 * * *` | was `every 24 hours` — now a fixed time |
> | `gradeExpertProfilesJob` | `0 3 * * *` | same time, was `0 7 * * *` UTC |
> | `siteAveragesJob` | `30 3 * * *` | same time, was `30 7 * * *` UTC |
> | `autoClosePools` | `0 4 * * *` | same time, was `every day 08:00` UTC |
> | `nflFinalizeSweepJob` | `30 4 * * *` | same time, was `every day 08:30` UTC |
> | `webhookDurabilitySweep` | `15 5 * * *` | was `every 24 hours` — now a fixed time |
> | `lockNFLSpreadsJob` | `0 9 * * 2` | already pinned |
> | `nflDeepScoreSweepJob` | `30 11 * * *` | already pinned |
> | `enforceBillingStatus` | `0 23 * * *` | same time, was `every day 03:00` UTC |
>
> `functions/src/__tests__/scheduleTimezones.test.ts` now fails if any
> wall-clock schedule omits `timeZone` or pins a zone other than ET. Interval
> schedules are deliberately out of scope — a timeZone means nothing on them.
>
> ⚠️ **`lockNFLSpreadsJob` will read `never-ran` for a FULL WEEK.** 2026-07-21
> was a Tuesday and its 09:00 ET run happened *before* the wrapping deployed, so
> its first heartbeat is 2026-07-28. Ops Health showing it never-ran until then
> is expected, not an outage.
>
> ### 5. Still to verify — cheap, and not yet done
>
> **5a. Firestore reads.** #239 went live *with* this deploy, so the graph could
> not have moved before it. Console → Firestore → Usage, **on 2026-07-23**, so a
> full post-deploy day (2026-07-22) has elapsed and been ingested. Expect a step change down from ~1.4M
> reads/day. A missing step change *then* is a real regression worth chasing
> that day — largest cost item on the project. Immediate evidence meanwhile: the
> Functions log for `scheduledBracketSync` should show it skipping the stale
> tournaments.
>
> **5b. Two mid-frequency jobs.** `checkPlayoffScores` (30 min) and
> `nflLockWatchJob` (60 min) had not stamped as of 12:55 ET. If they still have
> no `system/heartbeats` entry, the wrapper has a problem on those two — check
> their Functions logs. Everything else missing was legitimately hours or a week
> away.
>
> ### 6. Kevin-only, in priority order
>
> 1. **A8 — publish the 2026 price and free-period end date. DUE 2026-08-06.**
>    The only calendar-bound item. **The target is the Hall of Fame game,
>    2026-08-06** (Thu, 8:00pm ET) — set by Kevin on 2026-07-21, one week
>    earlier than the 2026-08-13 these docs previously carried. The first
>    16-game preseason slate is 2026-08-13.
>
>    The HOF date was wrong here until 2026-07-21: ESPN reports kickoff as
>    `2026-08-07T00:00Z` (8:00pm ET = midnight UTC next day) and the UTC date
>    was copied down as the calendar date. See `PICKUP-PRESEASON-PILOT.md` §0.
> 2. **NFL-6 — arm the finalize sweep.** Firestore → `system` → `config` →
>    `nflFinalize`. Read a `NFL_FINALIZE_SWEEP` entry in SuperAdmin → Admin Audit
>    Log first: want candidates under `"1"` and **zero** under `"2"` in
>    `bySeasonType`. Then add `liveSeasonTypes`, type **array**, containing the
>    number `1`. **`dryRun:false` alone does nothing** — deliberate. Full steps:
>    `TOMORROW-TASKS.md` → NFL-6.
> 3. **Arm `nflDeepSweep`** (safe): `system/config.nflDeepSweep` →
>    `{ enabled: true, dryRun: true }`. Dry-run still DETECTS and REPORTS stat
>    corrections; it only suppresses the `nfl_games` write.
> 4. **Backups — the biggest exposure, and unverified.**
>    `PLAN-BACKUPS-PHASE3.md` still says "No PITR, no scheduled backups, no
>    exports, no Auth export." **Database location is `nam5`**, which supports
>    PITR — no blocker.
>    - **PITR first**: Firestore → `(default)` → Disaster Recovery → Edit. One
>      checkbox, no `gcloud` install, buys a 7-day recovery floor.
>    - **Then the Auth export** (`PLAN-BACKUPS-PHASE3.md` step 6). Firestore and
>      Auth are the half that cannot be recreated; the VPS is snapshotted daily
>      and the frontend rebuilds from git.
>    - If PITR is already on and the plan doc is stale, update that doc so the
>      next session stops re-raising it.
> 5. **`claimMySquares` timing decision.** ⚠️ Repo is PUBLIC, hole is unfixed,
>    documented in `SECURITY-CLAIM-SQUARES.md`. On file: accept through the
>    pilot, fix before the regular season.
> 6. **Retire the 3 stale tournaments** (optional — #239 already skips them).
>
> Standing: **leave `nflLockWatch.dryRun: true`** — only 1 of 49 preseason games
> has a betting line, so arming it pages nightly about a known condition.
>
> ### 7. What is still NOT proven
>
> - **The per-job heartbeat verdicts are not individually tested.** The guard is
>   a source-level check that a job *can* report failure; it cannot prove each
>   path is wired. Verified rather than assumed: deleting `autoLock`'s failure
>   count, or reverting the `playoffPools` `resp.ok` verdict, produces **no build
>   error and no test failure**. Extracting each verdict into a pure helper — as
>   `sweepRunVerdict` and `lockWatchVerdict` already are — is the follow-up.
> - **#250's nine rewritten handlers have no emulator coverage.** Its only test
>   addition is the source-level invariant. **Two of the nine** have produced
>   correct heartbeats in production (§3) — better evidence than CI gave, but two
>   of nine, on their healthy path only. No failure path has run in prod.
> - **`runReminders` cannot see failures its nested helpers swallow** —
>   `sendEmail` catches queue failures, `sendCourierSMS` returns a boolean nobody
>   reads. A run where every reminder email failed to queue still reports zero
>   failed pools.
> - **Eight files wrap a job that cannot report failure at all** — `adminHealth`,
>   `consensus`, `espnBracket`, `expertPicks`, `expertProfiles`,
>   `revenueAggregates`, `stripe`, `winProbability`. Shrink-only list.
>   `adminHealth` is the pointed one: a health check that cannot report its own
>   ill health.
> - **`nflFinalizeSweepJob` has still never completed a run in production**, and
>   its scheduled sweep path still has no emulator coverage.
> - **`replayFeedSnapshot` has still never been invoked against production.**
> - **`spread.locked` has still never been exercised end-to-end in prod**,
>   because `lockNFLSpreadsJob` has always been dry-run.
> - **The chaos drill (NFL-7) has not been run.** Needs a live preseason week.

> ## ✅ DEPLOY STATE 2026-07-21 — prod matches the SHA tagged in the STOP POINT box
>
> **Deployed 2026-07-21 ~16:40Z** (functions, bare `--only functions`) and
> **~16:54Z** (Coolify frontend, same commit, healthcheck passed). The queue is
> EMPTY — see the STOP POINT box at the top for what shipped and what still
> needs verifying. The box below describes the *2026-07-21* deploy and is kept
> for the verification pattern it records, not as current state.
>
> Two things learned doing it, both now folded into the runbook above:
>
> - **Use `npm --prefix functions ci`, not `install`.** `install` rewrites
>   `functions/package-lock.json`, dirtying the very tree `firebase deploy`
>   packages — so a clean-tree gate after it can never pass, and one before it
>   never sees the rewrite. `ci` installs strictly from the committed lockfile
>   and mutates nothing (verified 2026-07-21, exit 0, tree clean). The full
>   recipe is in `PICKUP-PRESEASON-PILOT.md` §4.
> - **The deploy hit HTTP 429 `Per project mutation requests per minute`** on
>   ~14 functions. firebase-tools retried each and all landed; `Deploy
>   complete!` at the end is the signal that matters. Not an error to chase.
>
> ---
>
> ### Historical: DEPLOY STATE 2026-07-21 <!-- deploy-state:ignore --> `main` @ `84e080c`
>
> **Deployed 2026-07-21 ~04:30Z**, full-fleet `--only functions`. The queue was
> empty as of that date. Verified from the deploy output, not assumed:
>
> - `nflDeepScoreSweepJob` — **Successful create**
> - `replayFeedSnapshot` — **Successful create**
> - `syncNFLScoresJob` — **Successful update** (this is the spread-unlock fix)
>
> Everything from PRs #231-#236 is live: the deep score sweep, the snapshot
> replay callable, the backups runbook, the security writeup, the doc-precedence
> fix, and the `brace-expansion` CI pin.
>
> **Both new functions are INERT until armed** — see "What is armed" below.
>
> ### ⚠️ The bug that shipped fixed, and why it did no damage
> `syncNFLScoresJob` was silently unlocking and re-pricing spreads for games
> later in the week: the ESPN fetch returns the whole week and every game is
> written back, but lock preservation only consulted the docs inside the
> `[now-24h, now+2h]` query window. The parser emits `spread.locked: false`, so
> any game outside that window had its lock reset AND its frozen line replaced.
>
> **No production data was harmed**, because the only writer of
> `spread.locked: true` is `lockNFLSpreadsJob`, which has been `dryRun: true`
> throughout and returns before its batch (`nflSchedule.ts`, the `if (gate.dryRun)`
> early return). No locks existed to destroy. The fix landed *before* spread
> locking is armed for preseason — which is exactly when it would have begun
> quietly eating locked lines. Found by qodo on PR #235, not by reading the code.
>
> ---
>
> ### Historical: DEPLOY STATE 2026-07-20 (superseded by the box above)
> The long-standing "merged but NOT deployed" backlog was **CLEARED as of
> `5e481c0`**. A
> full-fleet `--only functions` deploy plus `--only firestore:indexes` landed
> everything: the 33 callable-sweep batches, sweep batch 17, the NFL pilot work
> (A2/A3a/A4/A5p1/A6/A10), the spread-gate fix, the importer season filter, and
> both missing composite indexes. A subsequent bare deploy reported *every*
> function "Skipped (No changes detected)" — that is the confirmation.
>
> **Armed in prod, all dry-run:** `nflSpreadLock`, `nflLockWatch`,
> `nflFeedSnapshots` (+ `retentionDays: 45`). `nflFinalize` is
> `enabled:true, dryRun:true` and still needs `liveSeasonTypes` — see NFL-6.
>
> **Prod data:** 49 preseason games (2026 / seasonType 1) imported.
>
> **Smoke test PASSED:** `recalculateGlobalStats` (batch 17 changed it from a
> soft-return to a thrown permission-denied) returns an identical result pre-
> and post-deploy — 35 pools, totalPrizes 5535, 0 errors.
>
> ### THE LESSON FROM 2026-07-19/20 — read before trusting any "armed" claim
> **Two features were armed, deployed, and completely dead, both from missing
> Firestore composite indexes, both silent:**
> 1. **A5 feed snapshots** — `nfl_feed_snapshots(slate, fetchedAt)` was missing;
>    the `catch` that stops a snapshot failure breaking score sync swallowed it
>    on every run.
> 2. **`nflFinalizeSweepJob`** — `pools(type, scoredThroughWeek)` was missing, so
>    its `in`+inequality candidate query threw FAILED_PRECONDITION **every day
>    from 2026-07-10 to 2026-07-20** and produced ZERO audit entries.
>
> Neither was findable by reading code. Both surfaced from asking *"has this
> actually produced anything?"* **Treat "armed" and "working" as separate
> claims.** Any scheduled job should write something on EVERY run so
> "never fired" and "never ran" cannot be confused — `nflLockWatchJob` does this
> by design, and #223 retrofitted it onto the finalize sweep. The other
> schedulers still lack it.
>
> **Deploy hygiene (three silent-success incidents in two days):**
> `--only functions:a,b,c` deploys ONLY `a` — repeat `functions:` per name, or
> use a bare `--only functions`. And ALWAYS `git log --oneline -1` plus confirm
> the change is in the file on disk before deploying; a stale checkout will
> deploy old config and still print "Deploy complete!".

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## 🌅 MORNING TAKEOVER — overnight NFL preseason-pilot run (2026-07-18, ~03:50–05:00)

**Read `TOMORROW-TASKS.md` first — it has TWO halves.** The sweep session's
sections are numbered `1`-`10`; this session's are `NFL-1`-`NFL-8`, below the
divider. In the top half, §1 is done (prod audit, no damage) and §2/§6 are
superseded/done — banners are in place. Everything needing Kevin lives there
with full numbered steps; this section is the engineering state.

### What shipped — all 6 engineering items from `PLAN-NFL-PRESEASON-PILOT.md`

| Item | What | PR | State |
|---|---|---|---|
| **A2** | Kill-switch + dry-run gate on `lockNFLSpreadsJob`, then exported it from index.ts (it had **never been deployed**) | [#205](https://github.com/kstruck/MMPoolsV3/pull/205) `d3dba97` | merged |
| **A4** | New `emulator-tests` CI job — the 45-fixture NFL matrix now gates every PR | [#206](https://github.com/kstruck/MMPoolsV3/pull/206) `7b9e08b` | merged |
| **A3a** | Pre-kickoff spread-lock tripwire (`nflLockWatchJob`) that pages ops via the Phase 2 dispatcher | [#207](https://github.com/kstruck/MMPoolsV3/pull/207) `869911b` | merged |
| **A10** | Finalizer/postponed-game investigation + surfaced the blocked reasons | [#208](https://github.com/kstruck/MMPoolsV3/pull/208) `87c46bd` | merged |
| **A5** (part 1) | ESPN feed snapshots + stat-correction detection | [#209](https://github.com/kstruck/MMPoolsV3/pull/209) `7d842a3` | merged |
| **A6** | `liveSeasonTypes` scope guard so the finalize sweep can be armed **preseason-only** | [#210](https://github.com/kstruck/MMPoolsV3/pull/210) `a1f3569` | merged |
| **NFL-1** | scope `SPREADS_NOT_LOCKED` to spread-consuming pools (follow-up, 2026-07-18 daytime) | [#214](https://github.com/kstruck/MMPoolsV3/pull/214) `8c8e9c5` | merged |

**Baselines moved — re-measured on merged <!-- deploy-state:ignore --> `main` @ `dd93629`, not summed from
PRs**: functions unit **685 → 771** (+86 tests), root vitest **257** (unchanged),
emulator **97 pass / 10 skipped** (unchanged), both typechecks clean. Every PR
ran all five gates before commit, and all five were re-run against merged main.

**qodo**: 16 findings across the run. 12 valid and absorbed, 4 rejected with
written evidence (a `firebase-tools` dependency-placement suggestion that
contradicted the repo's existing root-install pattern, an `: any`-count rule
aimed at pre-existing lines this PR only relocated, and snake_case naming twice —
which does not apply to this camelCase TypeScript codebase).

**Its best catch of the night, worth recording:** A5's snapshot query needed a
Firestore composite index that did not exist, and the `catch` that keeps a
snapshot failure from breaking score sync would have swallowed that error on
every run — the feature would have shipped silently dead, hidden by its own
safety net. Two other real saves: the finalize sweep applied its per-run cap
BEFORE the season-type scope filter (so a preseason-only arm could have
finalized nothing while reporting a full run), and `safeInt()` made "ESPN
dropped the score field" indistinguishable from "the team scored 0", which
would have paged a false `21-17 → 0-0` stat correction.

### Decisions: one resolved, one still open

1. ✅ **RESOLVED — the spread gate blocked pools that do not use spreads.**
   `SPREADS_NOT_LOCKED` ran unconditionally, 30 lines before the pool-type
   dispatch, so it blocked straight-up pick'em (the wizard's only mode — it
   hardcodes `pickMode: 'STRAIGHT'` with no ATS control), plus survivor and
   margin, none of which read a spread. Production was gating pick submission on
   data no production pool consumed; preseason (1 betting line across 49 games)
   merely exposed it. Fixed in **PR #214 (`8c8e9c5`, merged, NOT deployed)** by
   scoping the gate to `nflScoringEngine.poolUsesSpreads`, with the A3 tripwire
   scoped identically so it cannot page about pools that are no longer blocked.
   Zero behavior change for existing pools. qodo reviewed and raised no defects.
2. ⏳ **OPEN — alarm A3(b) (synthetic pick probe) was deliberately not built.**
   Doing it honestly needs a probe identity + probe pool in prod (Kevin's gate);
   doing it in-process would only duplicate A3(a)'s predicate. Recommendation
   and options in TOMORROW-TASKS **NFL-2**.

### Deploy state — NOTHING from tonight is deployed

Five functions change/appear: `lockNFLSpreadsJob` (**new**), `nflLockWatchJob`
(**new**), `syncNFLScoresJob`, `nflFinalizeSweepJob`, `submitNFLPicks` — **plus a Firestore index
deploy** (`firestore.indexes.json` gained a `nfl_feed_snapshots` composite
index; A5's snapshot writes fail silently without it). This queue sits **on top of**
the 33 undeployed callables below. Deploy command + verification steps are
TOMORROW-TASKS **NFL-4**. No frontend change tonight, so no Coolify trigger needed.

**Everything shipped is fail-safe OFF.** Three new config maps
(`nflSpreadLock`, `nflLockWatch`, `nflFeedSnapshots`) do nothing until armed —
console steps in TOMORROW-TASKS **NFL-3**.

### Behavior change worth knowing before you touch `nflFinalize`

A6 made arming **stricter**: setting `dryRun: false` *without* also setting
`liveSeasonTypes` now **keeps the sweep dry** and logs a refusal. There is no
unscoped way to arm the finalizer any more. This changes the long-standing open
loop "flip nflFinalize dryRun to false" — the flip now needs a third field.
See TOMORROW-TASKS **NFL-6**.

### Not built, deliberately (all recorded in TOMORROW-TASKS **NFL-8**)

- **A5 part 2**, the snapshot replay callable — prod-data mutator, wants its own PR.
- **The plan's "approve gate before payouts"** — already satisfied; finalization
  never touches money (`nflFinalize.ts:24-25`). The plan's premise was wrong here.
- **The "recalculated" banner** — frontend, and only meaningful once replay exists.
- **A7 chaos drill** — a runbook for Kevin to execute during a preseason week, not
  code. Written out in TOMORROW-TASKS **NFL-7**.

---

## ✅ SWEEP-LATER worklist CLOSED 2026-07-19 (batch 17, PR #220) — but read the caveat

The 10 callables HANDOFF listed as "actionable remaining" are wrapped. That
closes the SWEEP-LATER worklist **as written**.

⚠️ **It does NOT mean every callable is wrapped.** ⚠️ **The count below is
STALE — it is 26, not 25, and `searchUsersByEmail` has since been migrated to
`validated()`. See `SECURITY-BARE-ONCALL-CLASSIFICATION.md` (2026-07-21) for the
verified per-callable breakdown; this paragraph is kept for history.** A grep of
`main` was said at the time to find
**25 bare `onCall(`** exports: ~16 sim-harness (own `requireAuth`/SUPER_ADMIN
gates, never SWEEP-LATER rows), 3 aiTesting, `createBracketPool` (deliberately
deferred — `...settings` passthrough), plus `getServerTime`, `logClientError`,
`recordPoolPayouts`, `getProfilePoolDetail`, `refreshExpertProfiles`,
`backfillProfileData`, `simulateGameUpdate` (mix of PUBLIC-EXEMPT and rows
wanting re-classification). None is a regression. **Do not quote "the sweep is
complete" without this qualifier** — PR #220's own title overclaims it.

Batch 17 carries ONE deliberate behavior change: `recalculateGlobalStats` now
THROWS permission-denied instead of soft-returning `{success:false}`. Smoke-test
the SuperAdmin stats surface after deploying.

## Prior state: **11 SWEEP-LATER callables remain** (10 actionable + createBracketPool deferred) — batches 1-4 deployed, batches 5-13 + 3 fixes merged to main but UNDEPLOYED

The trust-boundary `validated()` sweep of the parked SWEEP-LATER callables is underway. Kickoff/recipe doc: `PICKUP-CALLABLE-SWEEP.md`; classification authority: `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`.

> **Count caveat — trust the grep, not the fraction.** The SWEEPS matrix header says 51 SWEEP-LATER rows, but 43 swept + 11 still-unwrapped = 54, so the header or the row classifications are off by ~3. Don't quote an "N/51" fraction. The authoritative check is:
> ```
> grep -rn "export const <name> = " functions/src --include=*.ts
> ```
> — `= onCall(` means unwrapped, `= validated(` means done. The 11 remaining are listed at the bottom of this section.

**Fully swept files:** `bracketEntries.ts` (6/6), `adminClaims.ts` (4/4), `poolOps.ts` (3/3), `nflPools.ts` (3/3 SWEEP-LATER; `calculatePlayoffScores`-style legacy noop N/A here), `billing.ts` (2/2 SWEEP-LATER), `couponTemplates.ts` (2/2 SWEEP-LATER; 3 others already TARGET-NOW), `espnBracket.ts` (5/5), the 4 no-input SUPER_ADMIN callables (`getAdminHealthSnapshot`/`backfillPools`/`refreshExpertPicks`/`syncPlayoffPools`, one each in 4 different files). `bracketPools.ts` at 2/3 (`createBracketPool` deliberately deferred, see below).

> ⚠️ **The "Deploy state" column below is HISTORICAL and no longer accurate.**
> Every batch in this table was deployed by the 2026-07-20 full-fleet deploy and
> again on 2026-07-21. Rows reading "merged, NOT deployed" reflect the state at
> the time each row was written, not today. Prod still matches
> <!-- deploy-state:ignore --> `main` @ `84e080c` **but the deploy queue is NO
> LONGER EMPTY** — that sentence was true on 2026-07-21 and is not true now.
> See the STOP POINT box at the top of this file. The table is kept for the
> PR/batch mapping, which is still useful.

| Batch | PR | Callables | Deploy state |
|---|---|---|---|
| 1 | #176 | `createBracketEntry` / `updateBracketEntry` / `deleteBracketEntry` | deployed |
| 2 | #177 | `updateEntryPayment` / `adminUpdateEntryOverrides` / `adminDeleteEntry` (admin two upgraded claim-only → C5 claim+doc) | deployed |
| 3 | #179 | `publishBracketPool` / `joinBracketPool` | deployed |
| 4 | #180 | `syncMyClaims` / `backfillUserRoles` (+ null-input fix) | deployed |
| 5 | #183 | `poolOps.ts`: `recalculatePoolWinners` / `toggleWinnerPaid` / `fixParticipantIds` | **merged, NOT deployed** |
| 6 | #184 | `nflPools.ts`: `joinNFLPool` / `executeSurvivorRebuy` / `scoreNFLWeek` | **merged, NOT deployed** |
| 7 | #185 | `billing.ts`: `validateBillingAccess` / `getPoolQuote` | **merged, NOT deployed** |
| 8 | #186 | no-input quartet: `getAdminHealthSnapshot` / `backfillPools` / `refreshExpertPicks` / `syncPlayoffPools` | **merged, NOT deployed** |
| 9 | #187 | `couponTemplates.ts`: `deleteCouponTemplate` / `acknowledgeMonetizationAlert` | **merged, NOT deployed** |
| 10 | #188 | `espnBracket.ts`: `importTournamentFromESPN` / `adminInitTournament` / `syncBracketTournament` / `importConferenceTournamentFromESPN` / `syncPlayInPicks` (closes a C5 auth-fallback finding for all 5) | **merged, NOT deployed** |
| 11 | #191 | `bracketScoring.ts`: `scoreBracketEntries` / `finalizeTournamentPayouts` (both claim-only → C5 claim+doc) | **merged, NOT deployed** |
| 12 | #192 | `conferenceTournaments.ts`: `initializeBigEastTournamentHttp` / `initializeBig12TournamentHttp` (both were **doc-only** role checks — last two in the fleet) | **merged, NOT deployed** |
| 13 | #194 | `squares.ts`: `updatePlayer` / `releaseSquares` | **merged, NOT deployed** |
| — | #190 | `backfillPools` dry-run gate (defaults true, `plannedWrites` report, FE dry/live button pair) | **merged, NOT deployed** |
| — | #193 | `backfillPools` status-clobber fix + per-entry fold marker | **merged, NOT deployed** |
| — | #195 | squares lookup-key `.trim()` regression fix (follow-up to #194) | **merged, NOT deployed** |
| 14 | #197 | `propBets.ts`: `gradeProp` / `updatePropCard` | **merged, NOT deployed** |
| 15 | #199 | `referral.ts`: `generateReferralToken` / `resolveReferralToken` (public) | **merged, NOT deployed** |
| 16 | #200 | admin singles: `lockPool` / `logAdminAction` / `recomputeConsensus` / `recomputeRevenue` | **merged, NOT deployed** |

Batches 1-4 deployed 2026-07-17/18 (see prior narrative below). **Batches 5-13 plus the three fix PRs (2026-07-18) are merged to `main` but explicitly NOT deployed** — deploy is Kevin's gate per `mmp-change-control`; nothing has run `firebase deploy`. Before deploying, verify every merge landed (`git log origin/main --oneline -20`), then follow the functions-first ritual:

> ⚠️ **`functions:` MUST be repeated before EVERY name.** `--only functions:a,b,c`
> deploys **only `a`** — firebase-tools splits on `,` and silently discards any
> segment that does not start with `functions:` (`functionsDeployHelper.js`,
> `getEndpointFilters`). It then prints `✔ Deploy complete!`, so the failure is
> invisible. This bit us for real on 2026-07-18: a 33-name deploy shipped 1
> function and reported success.

```
npm --prefix functions ci
npx firebase deploy --only functions:recalculatePoolWinners,functions:toggleWinnerPaid,functions:fixParticipantIds,functions:joinNFLPool,functions:executeSurvivorRebuy,functions:scoreNFLWeek,functions:validateBillingAccess,functions:getPoolQuote,functions:getAdminHealthSnapshot,functions:backfillPools,functions:refreshExpertPicks,functions:syncPlayoffPools,functions:deleteCouponTemplate,functions:acknowledgeMonetizationAlert,functions:importTournamentFromESPN,functions:adminInitTournament,functions:syncBracketTournament,functions:importConferenceTournamentFromESPN,functions:syncPlayInPicks,functions:scoreBracketEntries,functions:finalizeTournamentPayouts,functions:initializeBigEastTournamentHttp,functions:initializeBig12TournamentHttp,functions:updatePlayer,functions:releaseSquares,functions:gradeProp,functions:updatePropCard,functions:generateReferralToken,functions:resolveReferralToken,functions:lockPool,functions:logAdminAction,functions:recomputeConsensus,functions:recomputeRevenue --project gridiron-gamble-uzuqo
```

**The frontend also has undeployed changes** (`OperationsPanel.tsx` gained a "Backfill Pools (dry run)" button in #190) — that needs the manual Coolify trigger, which does NOT happen on push to `main`.

### ⚠️ `backfillPools` behavior change — read before running it
PR #190 changed `backfillPools` to **default to dry-run**. The existing "Backfill Pools" button now sends `dryRun: false` explicitly, so it still writes — but any *other* caller that omits the flag now reports instead of writing. PR #193 then fixed two real defects in it:
- It used to reset **COMPLETED pools to DRAFT** (it recomputed `status` from `isLocked`/`isFinal`, ignoring the existing value). If this backfill has ever been run against prod, **finished pools may already have been un-completed** — worth an audit query before running it again.
- The historical-stats fold (`FieldValue.increment` on `users/{uid}.historicalStats`) is now guarded per-entry so it can't double-count. **Limitation:** entries folded by a run predating that marker carry none and would fold again. Dry-run first and read `plannedWrites`.

### ✅ PROD backfillPools damage audit — RAN 2026-07-18, NO DAMAGE FOUND

Read-only Firestore queries against prod (Firebase console; nothing written).
The pre-#193 bug wrote `status = isLocked ? 'LOCKED' : (isFinal ? 'FINAL' : 'DRAFT')`.
The load-bearing claim is narrow and was re-verified after review: **`backfill.ts:55` is
the only production path that WRITES a pool `status: 'FINAL'`** — so that stored value is
a fingerprint for the bug. (It is NOT true that every other `'FINAL'` is an nfl_games
status: `'FINAL'` is in the pool status type unions and is read at `payoutRecords.ts:60`.
Nor are `'LOCKED'`/`'OPEN'` the only other writes — the create paths write `'DRAFT'`,
which is why the 28 DRAFT pools need no special explanation.)

`status=='FINAL'` → **0 pools**. `DRAFT`∩`isFinal:true` → **0**. `LOCKED`∩`isFinal:true` → **0**.
Positive control `status=='OPEN'` → 15 ✓. Verdict: the clobber never hit prod; the 28
DRAFT pools carry no finished-pool signals. PR #193 still ships as prevention, but there
is **no remediation task and no pool IDs to repair**. Detail in TOMORROW-TASKS §1.

⚠️ **Console-audit gotcha learned the hard way:** the Firestore filter panel reopens
COLLAPSED, so edits to the value box silently don't register and the PREVIOUS query
re-runs looking like a new one. Three readings were bogus before a positive control
caught it. Always verify the `.where(...)` preview string before Apply, and always
include a control query that must return rows.

### Backfill / migration audit (2026-07-18, report only — no fixes applied)

Ran after the `backfillPools` defects, to check whether the same two bug classes appear in sibling
batch operations. **Both classes turned out to be unique to `backfillPools`.** Nothing else needs fixing;
recorded so this isn't re-derived.

*Class A — deriving a field from inputs that cannot express all its states, ignoring the stored value.*
`grep -rn "isLocked ?.*'LOCKED'\|isFinal ?.*'FINAL'"` over `functions/src` + `src` returns exactly one
write site: `backfill.ts:55` (now guarded by `if (!pool.status)`). Every other hit is display-only JSX.

*Class B — non-idempotent `FieldValue.increment` in a re-runnable batch op.* Ten files use `increment`.
Classified:
- `backfill.ts` — was the only re-runnable batch offender; now guarded per entry (#193).
- `statsTrigger.ts` `recalculateGlobalStats` — **safe**: recomputes and writes ABSOLUTE totals (`set`, not
  increment), so re-running is idempotent by construction. This is the pattern the other backfills should
  copy.
- `bracketEntries.ts` / `bracketPools.ts` / `participant.ts` / `propBets.ts` / `billing.ts` — per-user-action
  counters (`entryCount` etc.), one increment per real event, not batch ops.
- `stripe.ts` — webhook path, already de-duped by event id (PR #166 durability work).

*One genuine pre-existing risk found, NOT fixed (needs a decision):* `statsTrigger.ts`'s
`onDocumentUpdated` trigger increments `stats/global.totalPrizes` / `.totalDonated` on the
`!before.isLocked && after.isLocked` edge. Cloud Functions triggers are **at-least-once**, so a duplicate
delivery of the same event re-runs the guard with identical before/after and increments twice. Low
probability, silent when it happens, and self-correcting only if someone runs `recalculateGlobalStats`
(which overwrites with absolute values). Options if it ever matters: stamp the pool with a
`statsFoldedAt` marker and check it in the trigger, or rely on periodic `recalculateGlobalStats` as the
reconciler. Not urgent — flagged so it's on record.

**Verify-before-strict lessons banked** (all now encoded in the PICKUP recipe):
1. `createBracketEntry` accepts a handler-*ignored* `tiebreakerScore` — must stay accepted or real calls break.
2. `updateEntryPayment`'s `paidAt`/`paymentNote` use explicit `null` to CLEAR the field → schema uses `.nullable()` NOT `nullish()` (nullish maps null→undefined and silently kills the clear feature). A test pins null-preservation.
3. **No-input callables must `z.preprocess((v) => v ?? {}, z.strictObject({}))`** — a no-arg `httpsCallable(fn)()` delivers `request.data` as `null`, which a bare strict object rejects. Shipped as a real bug in batch 4 (`syncMyClaims`), caught in review, fixed in #180. Batch 8 (#186) promoted this to a shared `noInputSchema` helper in `lib/zodHelpers.ts` (5th occurrence) and used it for all 4 remaining no-input callables — that gotcha is now fully closed across the fleet.
4. **A prod batch-mutation callable's `dryRun` flag must fail SAFE (default true) at the SCHEMA layer, not the handler.** qodo caught this on PR #183: `fixParticipantIds`'s pre-existing handler logic (`dryRunInput === true`) silently ran LIVE when the flag was omitted — contradicted the schema's own "default true" doc comment and the repo's dry-run-by-default convention (PRs #127/#129/#180). Fixed with `z.boolean().optional().default(true)` at the schema layer instead of a handler-side truthy check. Check any other dryRun-flag callable you retrofit for the same footgun. (`backfillPools` had NO dry-run at all — since fixed in #190, which also uncovered two real defects in it; see the warning box above.)
5. **Shared cross-boundary schemas (anything under `shared/schemas/`, generated into `functions/src/shared/`) are OUT OF SCOPE for `.strict()`-ifying** even when a SWEEP-LATER row uses one — `getPoolQuote`'s `poolQuoteInputSchema` was deliberately left non-strict (batch 7, PR #185): it's consumed by both the callable and the checkout flow, and the matrix documents its current shape as intentional. Move the auth+parse gate onto `validated()` using the existing schema as-is; don't tighten a shared contract on a drive-by.
6. **The C5 finding (some admin callables read a spoofable Firestore `users/{uid}.role` as a fallback when the JWT claim is absent) resolves for free** when you retrofit with `validated()`'s `role:` option — it calls `assertCallerRole`, which requires claim AND doc to agree, not claim-OR-doc. Batch 10 (#188, `espnBracket.ts`) closed 5 instances in one pass; batch 12 (#192, `conferenceTournaments.ts`) closed the last two, which were **doc-only** (weaker still — the JWT claim was never consulted at all). **No admin callable in the fleet now authorizes off a Firestore doc alone.**
7. **NEVER `.trim()` a string the handler uses as a LOOKUP KEY.** Regression shipped in batch 13 (#194), caught by qodo, fixed in #195. `updatePlayer.originalName` / `releaseSquares.ownerName` are matched with `===` against the stored `squares[].owner`; `reserveSquare` stores names untrimmed, so `" Alice "` is reachable. Trimming at the boundary made that player un-editable and silently un-releasable (released nothing, still returned success). Rule: `.trim()` is safe on server-generated identifiers (`poolId`, `tournamentId`), never on user-supplied strings used to match stored data. Normalizing at a trust boundary is only correct if the stored side was normalized identically.
8. **Some optional fields are load-bearing — omission can be a MEANING, not a mistake.** `scoreBracketEntries`'s `tournamentId` is optional because omitting it is the *global* form (score every pool-linked tournament), which is exactly what the OperationsPanel button does. A required schema would have broken it. Check what a *missing* field does in the handler before making it required.
9. **A callable can have more than one caller sending different shapes.** Batch 12's two callables are hit by OperationsPanel (`{}`) *and* TournamentManager (five fields, three of which those handlers ignore). Grep every call site, not the first one.
10. **An idempotency marker must be written in the SAME batch as the write it guards.** qodo caught this on #193: a per-pool marker written after the entry loop is not safe, because a pool with >400 entries flushes mid-loop and can commit increments before the marker exists. Marker moved per-entry, staged alongside its own increment, with the flush check after both — batch commits are atomic, so an applied increment can never be unmarked.
7. **A handler that soft-returns `{success:false, message}` instead of throwing on missing input** can still get a `.strict()`+required-field schema — just verify the FE always sends those fields (never omits them) and already wraps the call in try/catch, so a thrown `invalid-argument` surfaces the same way to the user as the old soft-return did. Two espnBracket.ts callables hit this in batch 10; both verified safe via the FE call site before tightening.

**Next on the fleet — 10 actionable remaining, grep-verified as still `= onCall(`:**

`markEntryPaidStatus` (bracketOps.ts), `calculatePlayoffScores` (playoffPools.ts, legacy noop),
`backfillMemberRecords` (migrations/), `importNFLSchedule` (nflSchedule.ts), `searchUsersByEmail`
(userManagement.ts — declared `functions.https.onCall`, a bare `grep onCall(` misses it),
`recomputeMyProfile` (userProfile.ts), `fixPoolScores` (scoreUpdates.ts), `syncAllUsers`
(userSync.ts), `recalculateGlobalStats` (statsTrigger.ts), `claimMySquares` (participant.ts).

Two carry a wrinkle worth knowing BEFORE you wrap them:

- `recalculateGlobalStats` — its SUPER_ADMIN check **`return`s a `{success:false}` object instead of
  throwing**, deliberately (a comment says it avoids CORS masking the message). `validated()`'s `role:`
  gate THROWS `permission-denied`. Wrapping it therefore changes the failure contract for that endpoint;
  check the SuperAdmin caller handles a thrown error before flipping it.
- `syncAllUsers` — **the matrix note claiming it has no role gate is STALE.** It already calls
  `assertCallerRole(request, "SUPER_ADMIN")` (the C4 sweep fixed it). Wrapping is a straight
  like-for-like; the in-handler call becomes redundant and can go.

Same recipe, runnable unattended.

### 🔴 Security finding: `claimMySquares` treats a readable field as a bearer secret (NOT fixed)

Found while triaging the remaining rows. **Not a schema problem — wrapping it in `validated()` will not
fix it, so it was left alone.**

`claimMySquares` (participant.ts) claims squares by matching a client-supplied `guestDeviceKey` against
`squares[].guestDeviceKey`. Knowing the key IS the proof of ownership. But `reserveSquare` stores that key
**on the square inside the pool document**, and `firestore.rules` has `allow get: if true` for
`/pools/{poolId}` — so anyone with a pool id can read every guest square's device key.

Net effect: any authenticated user who can read a pool can claim that pool's **unclaimed** guest squares
to their own uid. Partly mitigated — the handler refuses to take a square already bound to a different
`reservedByUid`, so registered owners can't be robbed; the exposure is guest-reserved squares that the
guest has not claimed yet (i.e. someone who paid but hasn't made an account).

Fixing it needs a data-model or rules change (move `guestDeviceKey` out of the public pool doc, or require
a different proof), not a drive-by — and firestore.rules write/read-path changes are a separate parked
effort per PICKUP's hard don'ts. Flagged for a decision.

**Deliberately deferred:** `createBracketPool` (SWEEPS row 7) — rich nested `settings` with a `...settings` passthrough spread that stores arbitrary client fields; a flat `.strict()` would reject data it currently persists. Needs a passthrough envelope or client cutover, same treatment as the ADR-0001 PERMISSIVE creates. Its own careful batch, not a drive-by.

Baselines measured on merged `main` at 0a7b9b6 (2026-07-18): root vitest **257** (unchanged all session), functions unit **685**, emulator **97 pass / 10 skipped**, frontend `tsc -b` clean. Counts rise with every batch — re-measure, don't trust a stale number.

---

## Phase 2 observability (#8–14) — SHIPPED, merged, deployed, prod-verified

PR [#171](https://github.com/kstruck/MMPoolsV3/pull/171) (all 7 plan items — Sentry FE spine, correlation id, business-failure→Sentry wiring, ops alert dispatcher, readiness endpoint, in-app Ops Health card, SLOs) merged `7b2a522`, functions + frontend deployed, qodo's 4 findings fixed pre-merge. **One post-deploy bug found+fixed**: `readiness` was configured at 128MiB and OOM'd at cold start (Admin SDK + Node 22 alone use ~131MiB) — Kevin's live GCP Uptime Check test caught it as a 503, fixed in a same-day follow-up PR #173 (bumped to 256MiB, merged, redeployed) — Uptime Check now green. Firestore `system/config.opsAlerts` populated (Kevin). ⚠️ **The "Sentry confirmed live in prod" claim that stood here from 2026-07-17 was FALSE and is corrected below.**

> ### ⚠️ CORRECTION 2026-07-29: browser-side Sentry never sent a single event
>
> This section used to read *"Sentry confirmed live in prod (`window.__SENTRY__`
> present, real DSN baked into the bundle, verified via direct browser check)"*.
> Every one of those observations was TRUE. The conclusion drawn from them was
> not. They prove `Sentry.init()` **ran**; they say nothing about whether an
> envelope could **leave the browser**. It could not: `nginx.conf`'s CSP
> `connect-src` never listed Sentry's ingest host, so the browser refused every
> send with `Refused to connect because it violates the document's Content
> Security Policy`.
>
> The CSP was hardened 2026-07-03 (`e13f6c9`, T11); the Sentry FE spine landed
> 2026-07-16 (`96811cf`). Thirteen days apart, and `connect-src` was never
> updated — so **every client-side error from 2026-07-16 to 2026-07-29 was
> silently dropped**, and the empty Sentry dashboard read as "no errors".
>
> **Server-side Sentry was never affected.** `functions/src/lib/sentryServer.ts`
> sends from Cloud Functions, where no browser CSP applies. If the 2026-07-22
> triage saw events, those are the likely source — that has NOT been confirmed
> either way.
>
> Fixed 2026-07-29 by adding `https://*.ingest.us.sentry.io` to all four CSP
> declarations (#320), guarded by `tests/csp-invariants.test.ts`.
>
> **PROVEN END-TO-END, at the destination — 2026-07-29.** Before the fix the
> project had received exactly ONE event in its entire lifetime:
> `phase2-sentry-smoke-test`, Jul 17 05:32 UTC, tagged `url
> http://localhost:5173/` **100%** and `environment development` **100%**. That is
> the Vite dev server — no nginx, therefore no CSP — which is precisely why the
> smoke test passed while prod never worked. `MARCH-MELEE-POOLS-WEB-2` did not
> exist; Sentry rejected the short ID as invalid (checked `WEB-1` as a control to
> confirm that was a real absence and not bad filter syntax). So production
> events, ever: **zero**.
>
> After the rebuild, Kevin threw an uncaught error on the live site — the same
> mechanism the Jul 17 event used, `auto.browser.browserapierrors.setTimeout` —
> and `csp-verify 2026-07-30T04:35:36.261Z` arrived within a minute as
> **`MARCH-MELEE-POOLS-WEB-2`**, tagged `environment production`. **That short-ID
> counter incrementing for the first time in the project's life is the proof**,
> not the absence of a console error.
>
> Two practical notes for next time: `Sentry.captureMessage` does NOT work from
> the console — `src/sentry.ts` loads the SDK by dynamic `import()` and never puts
> it on `window`, so throw an uncaught error instead. And `tracesSampleRate` is
> `0.2` outside dev, so a passive page-load check is a 1-in-5 dice roll and its
> silence means nothing. **This is the third
> instance of the same failure mode** — after #314's unbound
> `COURIER_AUTH_TOKEN` and the zero-counter reminder heartbeat: a send path that
> swallowed everything, where the absence of output read as health. When
> verifying a reporting path, the bar is *an event observed at the destination*,
> never *the client initialized*.

**Not done (optional, not urgent):**
- GCP Cloud Monitoring SLO objects + burn-rate alerting policies (uptime check alone is done; the other 3 SLOs — checkout success, webhook error rate, latency p95 — still need console setup). Target numbers in `PLAN-SECURITY-OBSERVABILITY.md`'s Phase 2 SLO section.
- Cosmetic: the Sentry lazy-load (dynamic `import('@sentry/react')` in `src/sentry.ts`) didn't actually get code-split into its own chunk by Vite's bundler in the prod build — it got merged into the main bundle. Functionally harmless (Sentry works), just didn't achieve the "defer off initial load" perf intent. Kevin said fix "when it makes sense" — not urgent.
- `SENTRY_DSN` functions secret (optional — activates backend Sentry events for Stripe webhook failures; Firestore alerts + ops email/SMS already work without it).

Below this: prior narrative (sim harness — still COMPLETE, deployed, prod-verified; unrelated to Phase 2).

**NFL Sim Harness (PLAN-NFL-SIM-HARNESS.md) — ALL PHASES SHIPPED.**
Core (0/1/2/3/4-core/6) 2026-07-10 via PR #156 + qodo PRs #157-159. **Phase 4
(matrix, items 25-27) + Phase 5 (legacy migration + rules-backdoor removal, items
28-30) shipped 2026-07-11 via PRs #161/#162**, expectations human-verified
(PHASE4-EXPECTATIONS.md, signed-margin rule confirmed), qodo cycle absorbed (3
findings: 4 surviving raw entry writes migrated onto new `updateEntryPayment`/
`adminUpdateEntryOverrides`/`adminDeleteEntry` callables; slug fix; audit-comment
honesty). Functions (7 new) + **firestore.rules (both backdoors DROPPED)** +
Coolify deployed 2026-07-11 evening, functions-first. **Prod smoke: 45/45 NFL
scenarios + squares/playoff/props/bracket-E2E + Tournament Simulator + Fill Grid
all green through the migrated guarded-callable path.** 45-fixture matrix runs in
emulator CI; `simRuns` manifests carry per-assertion run history (`simReportRun`).
No client can raw-create pool docs or raw-write entries anymore — including
SUPER_ADMIN sessions.

## ⚡ Kevin's pending 5-minute item

**Arm the finalize sweep** (safe — deployed stack has all guards):
1. Firestore console → `system` collection → `config` doc.
2. Add field `nflFinalize`, type **map**, containing `enabled` (boolean) = `true` and
   `dryRun` (boolean) = `true`.
3. Sweep runs daily 08:30, REPORTS ONLY while dryRun. After 1-2 days check
   SuperAdmin → Admin Audit Log for `NFL_FINALIZE_SWEEP` entries; when candidate
   lists look sane, ask Claude for the flip-to-live step.

## Phase 2 observability — CLOSED 2026-07-17

PR #171 merged+deployed, PR #173 (readiness OOM fix) merged+deployed, Firestore
`opsAlerts` populated, GCP Uptime Check green. **Browser-side Sentry was NOT
live** despite the claim that stood here — CSP-blocked from 2026-07-16 until
2026-07-29; see the correction box above.
Remaining optional items (SLO objects, cosmetic chunk-splitting) listed in the
"Current state" section above — not blocking, not time-sensitive.

## Next-effort menu (pick one to start a session)

1. **Security/Observability plan — Phase 1 COMPLETE (callables + webhook durability) and DEPLOYED.**
   Webhook durability (PR #166, merge 6c87891, deployed 2026-07-17): handleStripeWebhook
   no longer deletes failure state — a failed event flips to status:"failed" + attemptCount,
   de-dupes on Stripe's retry, and alerts ops once (=== threshold) via monetization_alerts/
   WEBHOOK_FAILED_<id>; claimEvent() re-claims failed docs (set/merge, safe on raced delete);
   added handlers for checkout.session.async_payment_failed + payment_intent.payment_failed
   (were falling through the silent default). Pure decideEventClaim/shouldAlertOnFailure in
   lib/webhookDurability.ts, 9 unit tests. qodo: 3 findings (2 fixed, 1 rejected w/ evidence).
   NOTE (deploy gotcha, 2026-07-17): a first merge attempt silently didn't take — git pull
   said "Already up to date" and deploy skipped every function as "No changes detected"
   because main never advanced. ALWAYS verify `gh pr view <N> --json state` == MERGED and
   `git log origin/main` shows the merge commit BEFORE trusting a deploy; a no-op skip on a
   change you expect to ship means the merge/pull didn't land.
   CLOSED SECURITY ITEM: npm critical websocket-driver<=0.7.4 (GHSA-mp7j-qc5w-4988 +
   GHSA-xv26-6w52-cph6) — fixed PR #170 (merge c95edb4, 2026-07-17). Transitive via
   firebase-admin AND the root firebase client SDK → @firebase/database → faye-websocket.
   Added "websocket-driver":">=0.7.5" to the overrides block in BOTH package.json (root +
   functions) — the CI security-audit runs `npm audit --audit-level=high` at ROOT, so a
   functions-only fix left it red (qodo + CI both caught this). App is Firestore-only so the
   WS path never loads; low real risk, but it's a critical + blocked CI. Lockfiles regen'd
   --package-lock-only (only websocket-driver moved). NOT merged as a functions deploy — the
   change is a lockfile-only bump of an unused transitive; rides with the next functions deploy.
   REMAINING (low-pri backlog): 2 moderate npm advisories below the high gate —
   @opentelemetry/core (via @google-cloud/pubsub→firebase-tools, DEV) and morgan (log-forging).
   Neither blocks CI. firebase-admin pinned ^12.7.0 (latest 14.2.0) — a future major-bump task
   would clear these + the whole transitive chain naturally.

   Prior wave (callables): 
   Wave 1: PR #164 (16 callables, deployed 2026-07-11 night). Wave 2: PR #165
   (remaining 25, merged f4df975 + functions deployed by Kevin 2026-07-12 late
   night; functions:list + post-deploy log sweep clean — zero invalid-argument
   or Invalid-request rejections). Every TARGET-NOW callable now runs through
   validated() (App Check monitor → auth → role claim+doc → strict zod);
   schemas in functions/src/schemas/* with unit tests pinning real client
   payloads. qodo lifetime on this plan: 3 findings, 3 VALID, all absorbed.
   Baselines now: functions unit 545, root vitest 244, emulator 84+10 skipped.
   Note: root tests mock onCall in tests/mocks/firebase-functions-v2-https.ts
   — it now supports the two-arg onCall(options, handler) form validated()
   uses, and onboarding-flow assertions pin the NEW gate error messages.
   Phase 2 (observability, #8-14) is now SHIPPED+DEPLOYED — see "Current
   state" at the top of this file, PR #171 + #173.
   Remaining Phase-1-adjacent follow-ups (pick one): (a) App Check
   monitor→enforce flips per endpoint (PLAN #5) after a
   coverage-measurement window; (b) firestore.rules write-path sweep (the
   pools allow-update isSuperAdmin() rule + playoff/props raw writes
   deliberately parked for it); (c) SWEEP-LATER callable fleet (63, includes
   the correlation-id sweep's ~13 remaining direct-httpsCallable files);
   (d) tighten the two PERMISSIVE create envelopes (ADR-0001); (e) Phase 3
   (backups #15-19).
   Note from Phase 5: the general pools `allow update: isSuperAdmin()` rule + playoff/props
   pool-doc/propCards raw writes were deliberately left for THIS plan's write-path sweep.
2. **Player Profiles follow-ups** — flip `profileBackfill`/`nflFinalize` dry-runs after
   reports look right; Achievements engine requirements (Kevin gathering); Expert Picks
   UI surface (`nfl_games/{id}.expertPredictions` is ingesting, nothing displays it yet).
3. **Small follow-ups parked from Phase 4/5:** settingsMatrix test uses wrong key
   `autoSurviveExemption` (engine reads `autoSurviveExemptionEnabled`; inert, 1-line);
   `profileField` assertion implemented but unwired (needs a `simRecomputeProfile`
   callable if a browser golden ever wants profile asserts); optional margin/survivor
   "season teams strip" UI (all 32 teams, used ones crossed out — pick sheets already
   gray out used teams per game).

## Key documents

| Doc | What |
|---|---|
| `HANDOFF.md` | THIS FILE — session entry point |
| `PLAN-NFL-SIM-HARNESS.md` + `-REVIEW-LOG.md` | Locked harness plan + Codex trail |
| `TAKEOVER-NFL-SIM-HARNESS.md` | Overnight-build narrative + deploy runbook (historical) |
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 + Phase 2 both shipped+deployed (PR #171, #173); Phase 3 not started |
| `PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Deploy: `npm --prefix functions ci` first (NOT `install` — it rewrites the lockfile and dirties the tree the deploy packages), then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify — **manual trigger only**, pushing to `main` does NOT auto-deploy it (corrects a stale claim that lived here; matches CLAUDE.md + the mmp-deploy-and-operate skill).
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- **PR review = TWO reviewers.** `codex exec review --base origin/main` before opening the PR, judgement up to 10 rounds, past 10 ask Kevin with a reason (CLAUDE.md §2c — it was 5, raised 2026-07-27). **AND qodo on the PR itself — Kevin, 2026-07-31: *"Qodo is now active and must be used."*** (§2b; it was off from 2026-07-25 only while the trial had lapsed, and an overnight prompt on 2026-07-30 repeated that stale line). Stop when both are clean and your own read of the diff agrees. qodo costs nothing per run and codex is billed per call, so the round budget is spent on codex. Validate every finding before fixing; a rejection needs written reasoning **on the PR**.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
