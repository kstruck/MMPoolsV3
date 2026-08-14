# CONTEXT.md — March Melee Pools Ubiquitous Language

## Glossary

### User
A person with a Firebase Auth account in the system. Stored in the `users/{uid}` Firestore collection. Every User has exactly one Role.

### Role
The authorization tier assigned to a User. Enforced via Firebase custom claim (`request.auth.token.role`) for Firestore rules and mirrored in `users/{uid}.role` for display. The custom claim is authoritative for Firestore rules. The Firestore field is the fallback for server-side checks during the token refresh window and is the source for admin UI queries.

Valid roles (exhaustive):
- `SUPER_ADMIN` — site-wide god mode; no restrictions
- `MODERATOR` — can view all Users and monetization (read-only), trigger password resets, send one-off emails to any User; cannot change billing, Roles, or any pool state
- `COMMISSIONER` — can create and manage their own Pools, email their own Pool members; formerly called `POOL_MANAGER` in code
- `MEMBER` — default; can enter Pools and submit picks; formerly called `PARTICIPANT` in code
- `BANNED` — blocked from entering or interacting with Pools at both UI and server (callable) layers

### Activity Log
A per-User subcollection (`users/{uid}/activity`) of timestamped events recording what a User did on the platform. Written exclusively by Cloud Functions (callable or triggered) — never directly by the client.

Activity event types (exhaustive for v1):

- `LOGIN` — user authenticated (written by `logActivity` callable)
- `LOGOUT` — user signed out (written by `logActivity` callable)
- `POOL_CREATED` — user created a Pool (written server-side in pool creation function)
- `POOL_ENTERED` — user joined a Pool (written server-side in pool join function)
- `PICKS_SUBMITTED` — user submitted picks (written server-side in picks function)
- `EMAIL_SENT` — admin sent a manual email to this User
- `ROLE_CHANGED` — an admin changed this User's Role
- `PASSWORD_RESET_SENT` — a password reset email was triggered for this User

### Admin Audit Log
A top-level `admin_audit` collection keyed by actor UID and timestamp. Records every administrative action (role changes, emails sent, password resets) from the actor's perspective. Enables forensic queries like "what did moderator X do today?" without scanning per-user activity subcollections. Written by the same Cloud Functions that write to the target User's Activity Log.

### Pool
A contest (bracket, squares grid, pick'em, survivor, margin, prop bet) managed by a Commissioner or Super Admin. A Pool has one owner (`ownerId`) and optionally a separate manager (`managerUid`).

### Commissioner
A User with Role `COMMISSIONER`. Can create Pools and manage their own Pools. Corresponds to the existing `POOL_MANAGER` role value being renamed.

### Member
A User with Role `MEMBER`. The default role assigned on registration. Formerly called `Participant` in code.

### User Management
The admin feature set enabling SUPER_ADMIN and MODERATOR users to view all Users, change Roles (SUPER_ADMIN only), view Activity Logs, send one-off emails, and trigger password resets.

### Entry Fee
The amount a Member pays the Commissioner to enter a Pool. Money moves outside the platform (peer-to-peer); the platform only records the amount and whether a Member has paid. Distinct from Billing.

### Payment Handle
A Commissioner's identifier on a peer-to-peer payment service (Venmo, Zelle, CashApp, PayPal, Google Pay) displayed to Members so they can pay the Entry Fee. The platform never moves Entry Fee money.

### Paid Status
The authoritative per-Member flag recording that a Member has paid the Entry Fee. Set only by a Commissioner (or Super Admin), server-side; never writable by the Member. Stored on the Member Record. Some Pool types gate play on it (e.g. a Bracket may require `PAID` to submit), so it must stay commissioner-authoritative. Distinct from a Member Payment Claim.

### Member Payment Claim
A Member's honor-system self-report that they have sent the Entry Fee (`memberReportedPaid` on their own Member Record). Advisory only: it never sets Paid Status and never gates play. A Commissioner reviews claims and confirms them into Paid Status.

### Billing
The commissioner-side subscription relationship between a Commissioner and the platform for a Pool (trial, tier, price, coupon) or a Bundle. Paid via Stripe. Entirely separate from Entry Fees, which flow between Members and Commissioners.

### Bundle
A prepaid multi-pool purchase made by a Commissioner. Exactly two kinds: a Credit Bundle, which grants a fixed number of Pool Credits, and an Unlimited Pass, which grants unlimited pool activations for a fixed term. Bundle products are defined by a Super Admin in the billing configuration and purchased via Stripe.

### Pool Credit
A single redeemable right to activate one Pool, granted by purchasing a Credit Bundle or by Super-Admin adjustment. A Pool Credit never expires on its own; it remains redeemable until it is used or a Super Admin revokes it. A Pool Credit may carry constraints (allowed pool format, maximum players per pool).

### Unlimited Pass
A Bundle granting unlimited Pool activations during its stated term (e.g. one year). Unlike Pool Credits, an Unlimited Pass expires at the end of its term. A Super Admin may also revoke it early.

### Coupon
A discount code a Commissioner applies to a Billing purchase (pool activation or Bundle). Attributes: discount (percentage or flat), active flag, optional expiration date, optional global max uses, optional per-user limit, optional allowed pool formats. A Coupon use belongs to exactly one completed purchase; abandoned checkouts do not consume uses.

### Coupon Template
A saved, reusable Coupon definition (e.g. "Black Friday", "Pre-Season") from which a Super Admin mints new Coupons. A template is never itself redeemable.

### Billing Charge
An immutable ledger record of one completed platform payment (pool activation, Bundle purchase, or its refund/dispute adjustment). The Billing Charge ledger is the source of truth for the accounting view in the Monetization tab.

### Pool Draft
An in-progress, unlaunched Pool configuration a Commissioner is building in the creation wizard. Exists only on the Commissioner's device; becomes a Pool when launched.

### Password Reset
An admin-triggered action that sends a Firebase password-reset email to a User via the `mail` collection + Trigger Email extension. Callable by SUPER_ADMIN or MODERATOR. Logged as `PASSWORD_RESET_SENT` in the target User's Activity Log.

### Super-Admin Dashboard
The single admin surface for SUPER_ADMIN users, organized as exactly eight tabs: Overview, Pools, Members, Operations, Test Suite, Monetization, Themes, System. Every admin capability lives in exactly one tab; no capability is duplicated across tabs.

### Operations
The Super-Admin Dashboard tab that is the sole home for one-off administrative data actions (initialize, import, sync, backfill, score, fix). Every action runs behind an explain-then-confirm guardrail and is recorded in the Admin Audit Log.

### Test Suite
The Super-Admin Dashboard tab that is the sole home for simulation and testing tools (pool simulations, tournament simulation, AI testing). Testing capabilities exist nowhere else in the admin surface.

### Sim Run
A single execution of the simulation harness, identified by a Run ID. Every artifact a Sim Run creates carries the Run ID so it can never be confused with real play and can be completely removed afterward. A Sim Run that leaves residue after cleanup is a defect.

### Test Pool
A Pool created by a Sim Run. Permanently marked with the Run's identity and excluded from all real statistics, aggregates, member-facing surfaces, and automatic season processing.

### Scenario
A declarative fixture describing one simulated contest end to end: pool settings, a synthetic schedule with predetermined results, simulated participants and their picks (hand-authored or deterministically generated), and the assertions that define pass/fail. A Scenario with no assertions is invalid — "it ran" is never a pass.

### Golden Scenario
A Scenario that exercises the real member-facing action paths (submitting picks, rebuys, scoring, finalization, payout recording) rather than fabricating state directly, so a green result certifies the production path a real Member would travel.

### Scenario Oracle
An independent computation of a Scenario's expected outcomes derived only from the fixture itself, never from the engine under test. Any disagreement between the Scenario Oracle and the engine is a finding to investigate, not a value to sync.

### Pool Lifecycle State
The derived status of a Pool over its life: `OPEN` (accepting entries), `LOCKED` (entries closed, awaiting/underway play), `LIVE` (games in progress), `FINAL` (scored, results settled), `CLOSED` (archived by admin/commissioner via `closePool`, removed from active operation). Computed by `getPoolLifecycleState`. Distinct from the raw `status` field; `CLOSED` is set by the `closePool` callable and must be visible in every Pool listing.

### Health Snapshot
The result of probing external integrations (ESPN API, Firestore, email delivery, Cloud Functions) via the `getAdminHealthSnapshot` callable, surfaced in the Overview tab's API Status Center. A Health Snapshot is a point-in-time reading; persisting a history of snapshots and running them on a schedule is a stated goal.

### Roster
The canonical list of every Member of a single Pool, together with each Member's Paid Status and Entry Fee owed. Materialized as one Member Record per Member per Pool. The Roster always includes the Commissioner (seeded as a Member on Pool creation) and every Member who has joined, whether or not they have played. It is the single surface a Commissioner uses to see who is in the pool and who has paid, and the same source both the member-facing payments view and the commissioner-facing payments management view read from.

### Member Record
The one document per Member per Pool (`pools/{poolId}/members/{uid}`) that is the Roster and payment truth for every Pool type. Carries the Member's identity (`userName`), role, join time, Paid Status, any Member Payment Claim, per-square dues for Squares (`unitsOwned`/`unitsPaid`), and rebuy dues where applicable (`rebuyOwed`/`rebuyPaid`, written in the rebuy transaction). Created when a Member joins (and for the owner when the Pool is created), independent of whether they have played. Deliberately separate from the playable Entry: it exists for pick-less Members and Commissioners, and it does not vary in cardinality or shape by Pool type. Membership across `participantIds`, `participations`/`joinedPools`, and Member Records is kept consistent by a single `reconcileMembership` helper that recomputes a Member's state from authoritative Pool state inside each membership write's own transaction.

### Entry
A Member's playable participation record in one Pool — the picks, bracket, squares, or selections themselves. Its cardinality and shape are per Pool type: some types allow more than one Entry per Member (Bracket, Playoff). Distinct from the Member Record: an Entry is about play, a Member Record is about membership and money. A Member may appear on the Roster (Member Record) before any Entry exists.

### Pool Homepage (Overview)
The member-facing landing view for a single Pool (the "Pool Home" tab, formerly "Overview"). Shows that Pool's slate, live scores, standings, consensus, and the member's own performance — only the cards that apply to the Pool's type. The tab is reflected in the URL so the browser Back button steps through tabs rather than leaving the Pool.

### Consensus
The distribution of how players picked each game — the share who picked each team. Distinct from Live Win Probability (a game-outcome estimate). Consensus has two scopes: Pool Consensus and Site-Wide Consensus. Consensus replaces the former fabricated "win probability" pick tile.

### Pool Consensus
Consensus over the entries of one Pool: of the members who picked a given game, what percentage took each team. Produced as a Pool-scoped server aggregate and **visible live, at all times** — recomputed on every submit, never gated on a lock. It is never computed on the client from raw entries, so it exposes counts only and never says who picked what.

> 🔨 **Kevin's ruling, 2026-08-11** (`PLAN-COMMISSIONER-BLIND-PICKS` Q4, overruling that plan's own recommendation). This entry previously read *"revealed per game only after that game's effective lock"*, and the client enforced that in `PickDistribution`. Both are gone: a live crowd split is a product feature, and what commissioner-blind picks protects is an **individual's** pick, which an aggregate cannot express. Known and accepted consequence: in a very small Pool the split is close to identifying. Reopening that is a product decision, not a bug.

### Pick Reveal
When one Member's actual pick becomes visible to another. Enforced **server-side only**, by the `getPoolPicks` callable — no client re-derives it, and raw entry documents stay unreadable until the Pool is `FINAL`/`COMPLETED`.

The boundary is the **same instant the picker's own deadline was**, so nobody is shown a pick the picker could still change:

| Pool shape | A pick reveals |
|---|---|
| Pick'em, per-game lock | per GAME, as each kicks off |
| Pick'em in confidence or weekly-lock mode, Survivor, Margin | the whole WEEK at once, at its single deadline |

**Who may read a reveal:** any **proven Member** of the Pool (Kevin's ruling, 2026-08-14 — *"make it visible for all users if pool is locked"*), the Commissioner, and Super Admin. A non-member is refused. Membership is proved by `isProvableMember`, and `participantIds` is server-owned for that reason — it is an authorization input, so it is protected in `firestore.rules` rather than manager-writable.

> ⚠️ **This SUPERSEDES `PLAN-COMMISSIONER-BLIND-PICKS` Q5**, which read *"Does anything change for ordinary members? **No.**"* Members now see the same reveal a Commissioner does. What did **not** change is the TIMING — the widening is about **who**, never **when**.

**One Commissioner-only exception:** the per-Member *completeness count* ("14 of 16 Picks Set") is returned live, before any reveal, because chasing missing picks is the Commissioner's job. Members receive it only once the week reveals — otherwise the whole Pool could watch each other's sheets fill in before kickoff. A Member who has left the Pool is filtered out of a Member's view entirely, though the Commissioner still sees their entry.

### Site-Wide Consensus
Consensus aggregated across every Pool on the platform for a given game/week: of all players site-wide who picked that game, the percentage on each team. Maintained by a server aggregation (no client may read every Pool's entries) built from per-Pool shards and rolled up idempotently. Scoped by Pool type (never one blended figure across types) and **published live**, as aggregate counts only — individual picks are never exposed. The client reads the resulting projection. Same ruling as Pool Consensus above: the former "only after a game's effective lock" wording is superseded.

### Live Win Probability
A real, game-outcome win estimate for an in-progress or scheduled NFL game, sourced from ESPN's win-probability data and stored on the game record. Distinct from Consensus (which is about picks, not outcomes). Shown alongside the live score and Consensus on the Pool Homepage.

### Performance Stats
The persisted, real per-player performance record used by metrics and Player Profiles: per-week correct/incorrect (W-L), accuracy, rank percentile, streaks, and pool-type-specific figures (survival, margin). Derived when a week is scored and rolled into per-user aggregates. Replaces the previously fabricated radar/accuracy values. "League average" comparisons are the real Pool or Site-Wide averages of these stats, never hardcoded constants.

### Player Profile
A per-player page showing that player's Performance Stats across all Pools they have entered: performance chart, weekly record, pick history, team-by-team performance, yearly record, and Profit. Reads a sanitized public projection of the player's stats — never the player's private per-user aggregates or per-Pool history, which stay owner-readable because they span unrelated private Pools. The projection exposes aggregate and finalized/scored data only, and carries no Pool identifiers — an anonymous visitor can never infer which (possibly private) Pools a player belongs to; per-Pool detail is revealed only to the player themself, co-members of that Pool, and admins. A player's pick history shows only picks that have already been scored (stricter than the per-game lock gate), so the profile never leaks un-revealed picks. Modeled on a public expert profile but without gambling "units." Achievements are hosted by the profile but awarded by a separate future feature. Every Pool member has one, and an Expert renders through the same profile.

### Profit
The net money a player has won across all Pools they have participated in: prizes recorded for them via Payout Records (whether or not the Commissioner has settled them yet) minus Entry Fees owed. Aggregated per player for the Player Profile. Entry Fees and prizes move peer-to-peer; Profit is a recorded figure, not money the platform holds. A Pool whose payouts have not yet been recorded still counts its Entry Fees, and the profile discloses how many Pools have payouts pending — the figure is never silently incomplete.

### Payout Record
A Commissioner's server-logged statement that a prize amount was awarded to a Member in a Pool, including whether it has been settled yet. The platform records the figure and the settlement state; the money itself moves peer-to-peer. Payout Records are the sole source of the prizes side of Profit — the platform never computes or fabricates a payout a Commissioner did not record.

### Season Finalization
The automatic settling of an NFL Pool's competitive results once its last scheduled week is scored: final ranks and season history are written for every Member who actually played, without any human action, and are re-derived (not frozen) if results are later corrected. Distinct from admin close (an administrative archival that settles nothing) and from recording payouts (a separate Commissioner action). Stats never wait on a human; money always does.

### Profile Subject
The entity a Player Profile page describes: either a Player (a User) or an Expert. Both kinds share one profile shape and one public projection; an Expert carries no money figures.

### Expert
A synthetic Profile Subject representing a non-player pick source tracked against real game results — e.g. ESPN FPI or the Vegas line. An Expert has a per-game pick record like a Player but no Pools, Entries, Entry Fees, or Profit.

### Achievement
A badge earned by a Player and displayed on their Player Profile. The awarding engine is a separate future feature; the profile hosts earned Achievements from day one and shows an honest empty state until the engine exists.

### Expert Picks
A planned feature surfacing outside "expert" picks per game (and their records) to Pool members, modeled on public pick-aggregator sites. Deferred: it depends on choosing a compliant data source (licensed feed / official API / admin-curated import) before implementation — third-party scraping is out of scope pending that decision.

### Roster Summary
A server-maintained projection per Pool (`pools/{poolId}/rosterSummary`) holding aggregate figures — member count, Dues Collected, Dues Expected, paid/unpaid counts, and a derived guest/unclaimed-squares dues bucket (so unclaimed Squares money is not lost when the `"guest"` sentinel is excluded from Member Records). Readable only by the Pool's Members, Commissioner, and admins. Updated in the same transaction as every membership/payment mutation, so it never lags the Member Records it summarizes. Exists so a Member can see the honest pot before the Pool locks, without being granted read access to other Members' raw Entries.

### Pool Homepage
The member-facing landing view for a single Pool, showing that Pool's standings, charts, deadline state, and only the cards that apply to that Pool's type (e.g. a Survivor card appears only on a Survivor Pool, a Margin card only on a Margin Pool). Every Pool has exactly one Pool Homepage regardless of type. Distinct from the Commissioner Hub, which spans many Pools.

### Commissioner Hub
The multi-Pool management surface for a Commissioner, listing every Pool they own or manage and summarizing them with Commissioner Aggregate Stats. Reached from the header's "Manage My Pools" entry. Distinct from "My Entries", which lists the Pools a User participates in as a Member. The two are separate destinations even though a Commissioner is usually both.

### Commissioner Aggregate Stats
The server-maintained rollup describing a Commissioner's footprint across all their Pools: number of Pools managed, total Members, Dues Collected, Dues Expected, and total Payouts recorded. Maintained by a Cloud Function that triggers on Member Record writes (membership/payment changes), not on Entry pick/score writes; never trusted from a client-computed blob. Dues are computed by per-Pool-type adapters — Squares dues come from per-square units, and rebuy dues (e.g. Survivor rebuys) are included from the payment ledger — so the figures are not a naive `fee × members`. Only Pools passing the shared inclusion predicate count (excluding COMPLETED, archived, CANCELED, ADMIN_CLOSE, and `sim-*` test pools). "Revenue" language is avoided on Commissioner surfaces because Entry Fees move peer-to-peer and the platform never holds the money — the honest words are Dues Collected and Dues Expected.
