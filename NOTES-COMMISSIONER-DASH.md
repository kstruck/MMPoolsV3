# Commissioner Dash — overnight progress + morning list

Branch: `feat/commissioner-dash` (off `main`). Nothing deployed. Test Suite work untouched.

## Done overnight (Phase 1 — shipped, typecheck clean, committed)

1. **Nav split** — `My Entries` → `/participant?tab=entries` (new membership-filtered tab); `Manage My Pools` → `/participant?tab=commissioner` (Commissioner Hub). Query-param drives the active tab. (`Header.tsx`, `ParticipantDashboard.tsx`)
2. **Killed the fake Roster Hub stats** — dropped the never-written `managerStats` blob. Commissioner Hub now shows **Pools Managed**, **Total Participants**, **Dues Expected** (fee × real participants, `guest` excluded) computed live; **Dues Collected** shows `—` until the Phase 2 aggregate. Replaced the phantom "Top Pools Revenue" chart with **Dues Expected by Pool** + a real empty state. (`GlobalCommissionerDashboard.tsx`)
3. **Top-row cards** — "Active Entries" now counts NFL season pools too (was Squares/Bracket/Playoff only); "Prize Payouts" (a win **count**, not money) relabeled **Wins**. (`ParticipantDashboard.tsx`)
4. **Live Weekly Pick'em** — now renders the **full week slate**, not a single game; the Live/Scheduled badge moved to top-center so it no longer covers the away-team logo. (`NFLUserBentoDashboard.tsx`)
5. **Type-gated homepage** — Pick'em pool sidebar shows Pick'em + Rules only (no Survivor/Margin); **Survivor Attrition** card only on `NFL_SURVIVOR`, **Margin Pool Stats** only on `NFL_MARGIN`; "Global Standings" relabeled **Pool Standings** (it is this pool's leaderboard). (`NFLUserBentoDashboard.tsx`)

Commits: `ab21ebf` (docs) → `be1892c` (nav + stats) → `594417c` (homepage).

## BLOCKER for the morning — needs your call

**Phase 2 (Member Record roster + payments + aggregate stats + backfill, per ADR 0003) collides with the Test Suite NFL wave.** The membership rewrite has to modify `functions/src/nflPools.ts` join/submit/rebuy and other NFL function hot paths — the same files the NFL Test Suite work edits. You said Test Suite takes priority and must not conflict. I did **not** start the Phase 2 backend to avoid clobbering that work.

Options (pick one in the AM):
- **A** — Land the NFL Test Suite wave first, then I do Phase 2 on a fresh branch off the updated main. Safest for the Test Suite.
- **B** — I build Phase 2 now as **additive new files only** (`memberRecord.ts` helper, `setPaidStatus` callable, `rosterAggregate.ts`, migration script), leave the wiring-into-existing-writers as a small, isolated final commit you merge after the Test Suite lands. Gets most of the work done without touching hot files yet.
- **C** — You confirm the Test Suite wave won't touch `nflPools.ts`/`bracketPools.ts`/`squares.ts`/`participant.ts` this cycle, and I proceed with full Phase 2 wiring tonight.

Recommendation: **B** — maximizes overnight progress with near-zero conflict risk.

## Morning list (things needing you regardless)
- Deploy Phase 1 frontend when ready (standard `npx firebase` deploy; frontend only, no functions/migrations in Phase 1).
- Decide A/B/C above.
- When Phase 2 backend lands: review the backfill **dry-run + invariant report** before it runs against prod; review the Firestore **rules** change (member `memberReportedPaid` exact-diff + new `members`/`rosterSummary` reads).
- Visual QA of Phase 1 on a real logged-in pool (I could not drive an authenticated prod pool unattended): confirm the slate list, badge position, type-gated cards, and the nav split on desktop + mobile.

## Not yet started
Phase 2 (all), Phase 3 redesign (Homepage + Roster Hub toward the mockup), Phase 4 polish + the full UX-review write-up. Rules & Rulesets commissioner editing (Phase 2 item 14) is frontend-light and low-conflict — a good first pickup under option B.
