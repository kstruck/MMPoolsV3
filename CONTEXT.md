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

### Password Reset
An admin-triggered action that sends a Firebase password-reset email to a User via the `mail` collection + Trigger Email extension. Callable by SUPER_ADMIN or MODERATOR. Logged as `PASSWORD_RESET_SENT` in the target User's Activity Log.
