# Sweeps: Player Profiles (PLAN-PLAYER-PROFILES.md)

Deterministic grep-built instance lists for the plan's coverage claims. Built 2026-07-10 in
worktree `feat/player-profiles` (base 382afc7). Grep patterns noted per sweep so they can be
re-run.

## Sweep 1 — every client Firestore read/write of `pools/{id}/entries` (entry-read tightening blast radius)

Pattern: `collection\([^)]*'entries'|doc\([^)]*'entries'` over `src/`.

| Site | Access | Who runs it | Impact of own-entry-only rule |
|---|---|---|---|
| `src/services/dbService.ts:1481` `subscribeToNFLEntries` | reads ALL entries (onSnapshot) | every NFL pool member via `NFLPoolDashboard.tsx:110` | **BREAKS member views** — see conclusion |
| `src/services/dbService.ts:272` `getBracketEntries` | reads all entries | bracket dashboards | unaffected if rule keeps coarse read for single-lock types (bracket lock = one moment; post-lock full reveal is by design) |
| `src/services/dbService.ts:302` `subscribeToBracketEntries` | reads all entries ordered by score | bracket standings | same as above |
| `src/services/dbService.ts:402` `updateBracketEntryPayment` | WRITE paidStatus | commissioner UI | write path — rules already SUPER_ADMIN-only for writes; callable path unaffected |
| `src/services/nflStatusService.ts:28` | reads own entry (`where ownerUid == uid`) | member | safe under own-entry-only |
| `src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx:95` | WRITE (manager payment mark) | pool owner | owner retains management read/write via callables/owner rule |
| `src/components/SuperAdmin.tsx:178,209,227` | admin entry writes | SUPER_ADMIN | admin rule retained |
| `src/components/TournamentSimulator/TournamentSimulator.tsx:132,198,274,414` | sim pool entries | SUPER_ADMIN via `sim-` backdoor | out of scope (Test Suite; see PLAN-SUPERADMIN-CONTROL sweep history) |
| `src/utils/testing/simulators/*.ts` (bracketSimulator 166/203/245, bracketE2ESimulator 167/245/345, nflSeasonSimulator 191) | sim pool entries | SUPER_ADMIN | same |

Consumers of the NFL entries array (prop-drilled from `NFLPoolDashboard.tsx`):
`NFLStandings.tsx`, `NFLUserBentoDashboard.tsx` (rank, attrition, league-average radar,
participation), `PickDistribution.tsx` (client-computed consensus from raw picks —
`NFLPoolDashboard.tsx:483`), `NFLManagerView.tsx` + `NFLManagerBentoDashboard.tsx` (manager).

Server-side consensus already exists and is client-subscribable
(`dbService.ts:424` pool-scoped, `:435` site-wide) but `PickDistribution` still computes from
raw entries.

**CONCLUSION (plan correction, logged):** Phase 1 as written treats entry-read tightening as
rules + client-audit work. The sweep shows the rule flip has a hard dependency: NFL member
views consume the raw entries collection wholesale. Flipping to own-entry-only without a
replacement breaks standings/rank/attrition/consensus for every NFL member. Resequenced:

1. Phase 1 ships the rules groundwork that has no dependency (achievements subcollection rule,
   shared contracts) + this audit.
2. Phase 2 (scoreNFLWeek already being touched) ALSO writes a member-readable standings
   projection `pools/{id}/standings/current` (reveal-safe scored fields only: uid, userName,
   totalScore, weeklyResults summary, survivor status/strikes, margin seasonTotal).
3. Client rewire: member views read the projection; `PickDistribution` switches to server
   consensus docs; manager/admin views keep raw entries (owner/admin rule).
4. THEN the entries rule flips to: own always; owner/admin always; non-owner participant only
   when pool `status == 'FINAL'`/`COMPLETED` (single-lock types keep the current coarse
   post-lock read — bracket reveal-by-design).
The flip and the projection land in the same phase/PR so no intermediate broken state exists.

## Sweep 2 — every writer/reader of `weeklyResults` (Phase 2 additive-write safety)

Pattern: `weeklyResults` over repo `*.ts,*.tsx`.

Writers (server): `functions/src/nflPools.ts:710-715` (scoreNFLWeek, Pickem branch — the ONLY
writer today; Survivor/Margin write other fields, confirming plan's per-type additions are new).
Readers: `functions/src/userProfile.ts:43-44,81` (profile recompute + trigger change-detection);
`src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx:304,313` (radar/participation).
Type declarations (BOTH must gain the per-game map): `functions/src/nflPoolTypes.ts:185`,
`src/types/nflPoolTypes.ts:195` (duplicated client/server types — keep in sync or lift to
`shared/`).

## Sweep 3 — every reader of `publicProfiles` (projection shape change / weekly[] leak fix)

Pattern: `publicProfiles|subscribeToPublicProfile`.

| Site | Role |
|---|---|
| `firestore.rules:36` | world-read / server-write rule (stays) |
| `functions/src/userProfile.ts:70` | sole writer |
| `src/services/dbService.ts:450` | subscription |
| `src/pages/PlayerProfile.tsx:19` | the page (renders `weekly[]` incl. poolName today — the live leak; Phase 5 removes) |
| `src/pages/DevDashboardPreview.tsx` (mockProfile) | dev harness mock — must track new shape |

No other consumer exists; the weekly[] shape change is safe once page + mock update together.

## Sweep 4 — `PAYOUT_PAID`/`PAYOUT_UNPAID` writers (Profit source-of-truth claim)

Pattern: `PAYOUT_PAID|PAYOUT_UNPAID|writeLedgerEvent`.

`writeLedgerEvent` callers: `functions/src/bracketOps.ts:55` and `functions/src/nflPools.ts:593`
(both MARKED_* / rebuy events). PAYOUT_* appears ONLY in type declarations
(`functions/src/paymentLedger.ts:17-18`, `src/services/paymentService.ts:9`). Zero writers —
confirms plan premise; `payoutRecords` writer will be net-new with no legacy data to reconcile.
