# MORNING 2026-08-10 — launch week: merge, deploy, walk the invite path, send

**Overnight result in one line:** the survivor-exemption fix is built, reviewed
and gated ([PR #405](https://github.com/kstruck/MMPoolsV3/pull/405)); the invite
path is proven end to end in the emulator ([PR #406](https://github.com/kstruck/MMPoolsV3/pull/406),
test-only); `LAUNCH-READINESS.md` is the measured audit — its bottom line:
**nothing blocks a stranger joining a pool and playing once #405 is deployed.**

Tasks are ordered by what unblocks invite sends soonest. Tasks 1–3 get you to
"send the invites". Tasks 4–8 are the same-week hardening.

---

## TASK 1 — Merge PR #405 and deploy functions (~15 min)

The survivor scoring fix. Gate evidence is in the PR body and
`PLAN-SURVIVOR-EXEMPTION-RESERVATIONS.md`: CI 7/7, codex clean, qodo settled
(1 finding fixed, 2 rejected with reasoning), 4 mutations killed.

⚠️ **Functions only. No rules, no indexes, no Coolify** — the PR touches no
`firestore.rules`, no `firestore.indexes.json`, and its only `src/**` files are
test-harness scenario fixtures that change no member-facing surface.
⚠️ **The live scorer runs every 5 minutes with `dryRun:false`** — from the first
pass after this deploy, any not-yet-scored survivor week grades under the new
strictly-before rule. Already-scored weeks are untouched (fix-forward).

1. Where: any browser.
   Merge: https://github.com/kstruck/MMPoolsV3/pull/405 → **Squash and merge**.
   **What you should see:** the PR shows purple "Merged".
   **If not:** a red X on a check means CI moved since tonight — stop, tell the
   next session.

2. Where: PowerShell, main checkout.

   ```powershell
   cd D:\march-melee-pools
   ```

   ```powershell
   git pull
   ```

   **What you should see:** `Fast-forward` ending at a commit whose subject is
   the #405 squash ("fix(survivor): auto-survive eligibility counts only weeks
   strictly before the scored week").
   **If not:** `Already up to date` means the merge did not land — re-check
   step 1.

3. Install functions deps (ci, NOT install — install rewrites the lockfile):

   ```powershell
   npm --prefix functions ci
   ```

   **What you should see:** ends with an `added NNN packages` line, exit
   without error.

4. Deploy functions:

   ```powershell
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
   ```

   ```powershell
   npx firebase deploy --only functions --project gridiron-gamble-uzuqo
   ```

   **What you should see:** possibly HTTP 429s partway through the fleet — this
   is normal, re-run the same deploy command until it ends `Deploy complete!`.
   A mid-run `Error: There was an error deploying functions` after a 429 is
   usually a lost poll, not a failure — re-run before concluding anything.

5. Certify with one more run:

   ```powershell
   npx firebase deploy --only functions --project gridiron-gamble-uzuqo
   ```

   **What you should see:** every function `Skipped (No changes detected)` and
   `Deploy complete!` — that all-Skipped pass is the positive evidence the
   deployed code is byte-identical to the merge.
   **If some functions still update:** run it again; if it never converges,
   stop and tell the next session.

## TASK 2 — Merge PR #406 (~1 min, nothing to deploy)

Test-only: the invite-path emulator journey. Merge
https://github.com/kstruck/MMPoolsV3/pull/406 the same way. **No deploy of any
kind is owed** — it adds one emulator test file.

## TASK 3 — The 10-minute prod invite-path walkthrough, then SEND

Prove the launch action with your own hands before a stranger does it.

1. Create (or reuse) a real survivor pool from your commissioner account.
   Where: https://www.marchmeleepools.com → create the pool you actually want
   to host. (Pool creation is SUPER_ADMIN-only in the client while
   `POOLS_OPEN=false` — that is you, so it works; invitees never need it.)
2. Copy the pool's share link (the `/pool/<id>` or `/join/<id>` URL from the
   pool page).
3. Open a **private/incognito** window (so you are signed out).
4. Paste the link. **What you should see:** the pool landing/join page, not an
   error.
5. Register a brand-new throwaway account (real email you control; NOT your
   admin account).
6. Join the pool from that account.
   **What you should see:** you land on the pool dashboard as a member; the
   roster in your admin view now shows the new name.
7. Submit a survivor pick for the current week from the throwaway account.
   **What you should see:** the pick sheet accepts it and shows it saved.
   (No betting line needed — the "Spreads Not Yet Finalized" block is Pick'em
   ATS-only since #382.)
8. Back in your admin/commissioner view: confirm the pick is visible on the
   entry.
   **If any step fails:** screenshot it and note the step number — that exact
   journey passed 5/5 in the emulator tonight (`invitePath.emulator.test.ts`),
   so a prod failure is environment-specific and the next session needs the
   step number.
9. ⚠️ **Free-plan pools cap at 10 participants** (`joinNFLPoolInternal`) —
   joiner #11 gets an upgrade message. If you expect more than 10 in a pool,
   put it on trial/premium BEFORE sending its link.
10. **Send the invites** (A9 — your ~10 known commissioners). Include the A8
    price + free-period end date (Task 4) in the same message if at all
    possible.

## TASK 4 — A8: publish the 2026 price + free-period end date (overdue)

Was due 2026-08-06. Board decision (5–0): free-with-no-published-price anchors
expectations at zero. Steps in `TOMORROW-TASKS.md` §7: decide price, decide the
free-period end date (suggestion: regular-season week 1, 2026-09-09), update
the site copy / commissioner messaging. **Best sent WITH the invites.**

## TASK 5 — Arm `nflDeepSweep` (two-stage, stage 1 today)

Closes the one gap the auto-scorer has: with it unset, a game reaching FINAL or
corrected **more than 24h after kickoff** is never re-read from ESPN. Full
context: `PLAN-AUTOSCORE-GOLIVE.md` §5.

1. Where: Firebase console → Firestore →
   https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data/~2Fsystem~2Fconfig
2. On the `system/config` document, add a **map** field named `nflDeepSweep`
   containing:
   - `enabled` — boolean — `true`
   - `dryRun` — boolean — `true`
3. **What you should see next:** the job runs daily at 11:30 ET
   (`nflDeepScoreSweepJob`). After the next run, `system/heartbeats` has an
   `nflDeepScoreSweepJob` entry, and any detected correction appears in the
   Admin Audit Log — dry-run still DETECTS and REPORTS; it only suppresses the
   `nfl_games` write.
4. **Stage 2 (flip `dryRun` to `false`):** after one or two clean daily reports
   — same field, one boolean. If a report ever shows a correction that looks
   wrong, don't flip; bring it to the next session.

## TASK 6 — NFL-6: arm the finalize sweep (read the report FIRST)

Full canonical steps: `TOMORROW-TASKS.md` → **NFL-6** (line ~849). Summary:

1. SuperAdmin → Admin Audit Log → filter `NFL_FINALIZE_SWEEP`.
2. **What you should see:** dry-run entries with a `bySeasonType` breakdown —
   candidates under `"1"` (preseason) and **zero** under `"2"`. Non-zero `"2"`
   → STOP, tell the next session.
3. If right: Firestore console → `system/config` → edit the `nflFinalize` map
   to hold all three: `enabled: true` (boolean), `dryRun: false` (boolean),
   `liveSeasonTypes: [1]` (array of number).
   ⚠️ `dryRun: false` alone does nothing — the third field is the arm (#210).
4. **What you should see** on the next 04:30 ET run: an `NFL_FINALIZE_SWEEP`
   audit entry with `dryRun: false`, `liveSeasonTypes: [1]`.
   A log line `STAYING DRY: ... liveSeasonTypes is missing` means step 3's
   array was missed — add it; nothing was finalized meanwhile.

## TASK 7 — Backups: verify the remaining two (PITR is DONE)

✅ **PITR is ENABLED — measured tonight**, 7-day window, versions back to
2026-08-04. `PLAN-BACKUPS-PHASE3.md` has been corrected to say so. Remaining:

1. **Scheduled exports** (protects against corruption found >7 days late):
   console → Firestore → Disaster Recovery → check whether a backup schedule
   exists. If not, `PLAN-BACKUPS-PHASE3.md` item 16 has the steps.
2. **Auth export** (the un-recreatable half): `PLAN-BACKUPS-PHASE3.md` step 6 —
   one Cloud Shell command. **What you should see:** a dated export in the GCS
   bucket.

## TASK 8 — Confirm the SA key is revoked (not just deleted)

The local file `C:\keys\gridiron-admin.json` is **already gone** (verified
tonight — the directory is empty). What tonight could NOT verify is the
console side:

1. https://console.cloud.google.com/iam-admin/serviceaccounts?project=gridiron-gamble-uzuqo
2. Service account containing **`firebase-adminsdk`** → **KEYS** tab.
3. **What you should see:** NO user-managed key dated <!-- hof-date:ignore --> 2026-08-07
   (the key's creation date, not the game). If one is there, trash-icon →
   confirm (sort by creation date; touch only the <!-- hof-date:ignore --> 2026-08-07
   one).

## TASK 9 — Dependency PRs (T4 verdicts, measured tonight in isolated worktrees)

✅ **#400 (minor-and-patch group ×6) is MERGED** — gates in the PR comment:
build green, root 844/844 (one retry over a cold-install load flake), functions
1360/1360. Merged 04:43Z per your "merge if green" instruction. Its lockfile
change will make dependabot rebase #401–#403; the verdicts below survive a
rebase because they are about the packages, not the diffs.

| PR | Bump | Verdict (measured, not asserted) | Your call |
|---|---|---|---|
| #401 vite 7→8 | major, build tool | **BLOCKED UPSTREAM — cannot even install.** `npm ci` fails: `@vitejs/plugin-react@5.1.4` peer-requires `vite ^4‖^5‖^6‖^7`. Nothing to fix in this repo | Leave open; re-check when plugin-react ships vite-8 support (dependabot will bump it) |
| #402 framer-motion 12→13 | major, runtime animation | **All gates green**: build clean, root 844/844, functions 1360/1360. But no test covers animation BEHAVIOUR, and a major here can change motion without breaking one import | Mergeable when you want it — deserves a 5-min visual smoke of animated surfaces (wizard steps, modals) after the next rebuild. Not merged overnight per your instruction |
| #403 lucide-react 0.556→1.29 | major, icon lib | **REAL BREAKAGE — 7 TS2305 build errors.** lucide 1.x removed the brand icons; `ShareModal.tsx` and `UserProfile.tsx` import `Twitter`/`Facebook`/`Linkedin`/`Instagram` | Do NOT merge. Needs a small migration PR first (inline SVGs or a brand-icon package) — next session's queue |

🛑 #380, #304, #302, #300 untouched, standing instruction.

---

## What changed in the repo overnight (for the record)

| Artifact | State |
|---|---|
| PR #405 — survivor exemption fix | OPEN, fully gated (CI 7/7, codex clean, qodo settled: 1 fixed / 2 rejected with reasoning). Awaits Task 1 |
| PR #406 — invite-path emulator test | OPEN, gated (5/5 new tests, full emulator 353 green, codex clean). Test-only. Awaits Task 2 |
| `LAUNCH-READINESS.md` | NEW — the measured audit; read top to bottom in 5 min |
| `PLAN-BACKUPS-PHASE3.md` | corrected: PITR is ON (measured), stale "No PITR" claim replaced |
| `docs/NFL_POOLS_README.md` | survivor exemption bullet now states the strictly-before rule (qodo finding on #405) |
| Plan/review-log/sweeps for the exemption fix | rounds 9 (plan, clean) and 10 (code, clean) logged; sweeps re-run 2026-08-10 with shape-proofs |
