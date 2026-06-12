# CONTEXT.md — March Melee Pools Ubiquitous Language

## Glossary

### User
A person with a Firebase Auth account in the system. Stored in the `users/{uid}` Firestore collection. Every User has exactly one Role.

### Role
The authorization tier assigned to a User. Enforced via Firebase custom claim (`request.auth.token.role`) for Firestore rules and mirrored in `users/{uid}.role` for display. The authoritative value is always the custom claim.

Valid roles (exhaustive):
- `SUPER_ADMIN` — site-wide god mode; no restrictions
- `MODERATOR` — can view all Users and monetization (read-only), trigger password resets; cannot change billing or roles
- `COMMISSIONER` — can create and manage their own Pools, email their own Pool members; formerly called `POOL_MANAGER` in code
- `MEMBER` — default; can enter Pools and submit picks; formerly called `PARTICIPANT` in code
- `BANNED` — blocked from entering or interacting with Pools; read-only

### Activity Log
A per-User subcollection (`users/{uid}/activity`) of timestamped events recording what a User did on the platform. Written server-side (Cloud Functions) or from trusted client paths (auth flows). Never written directly by the client for sensitive events.

Activity event types (exhaustive for v1):
- `LOGIN` — user authenticated
- `LOGOUT` — user signed out
- `POOL_CREATED` — user created a Pool
- `POOL_ENTERED` — user joined a Pool as a participant
- `PICKS_SUBMITTED` — user submitted picks in a Pool
- `EMAIL_SENT` — admin sent a manual email to this User
- `ROLE_CHANGED` — an admin changed this User's Role
- `PASSWORD_RESET_SENT` — a password reset email was triggered for this User

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
