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
Per-entry bookkeeping flag a Commissioner sets to record that a Member has paid the Entry Fee. Informational only; does not gate participation by itself.

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

### Pool Lifecycle State
The derived status of a Pool over its life: `OPEN` (accepting entries), `LOCKED` (entries closed, awaiting/underway play), `LIVE` (games in progress), `FINAL` (scored, results settled), `CLOSED` (archived by admin/commissioner via `closePool`, removed from active operation). Computed by `getPoolLifecycleState`. Distinct from the raw `status` field; `CLOSED` is set by the `closePool` callable and must be visible in every Pool listing.

### Health Snapshot
The result of probing external integrations (ESPN API, Firestore, email delivery, Cloud Functions) via the `getAdminHealthSnapshot` callable, surfaced in the Overview tab's API Status Center. A Health Snapshot is a point-in-time reading; persisting a history of snapshots and running them on a schedule is a stated goal.
