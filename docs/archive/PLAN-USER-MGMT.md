# Plan: Full User Management System

_Locked via grill-with-docs — by Claude + Kevin Struck. Terms per CONTEXT.md._
_Revised after Rounds 1–4 Codex adversarial review._

## Goal

Build a complete User Management system accessible to SUPER_ADMIN and MODERATOR roles at `/admin/users`. The system allows viewing all Users, changing Roles (SUPER_ADMIN only), browsing per-User Activity Logs, sending one-off emails, and triggering password resets. Activity is tracked in `users/{uid}/activity` subcollections. Admin actions are also mirrored to a top-level `admin_audit` collection for actor-centric forensics.

## Approach

### 1. Extend the Role type system

- In `src/types/index.ts`: expand `UserRole` to `'SUPER_ADMIN' | 'MODERATOR' | 'COMMISSIONER' | 'MEMBER' | 'BANNED'`.
- Rename `PARTICIPANT` → `MEMBER` and `POOL_MANAGER` → `COMMISSIONER` in the type union only. Write paths updated in step 2.
- In `src/utils/auth.ts`: add `isModerator`, `isCommissioner`, `isBanned`, `canManageUsers` (SUPER_ADMIN or MODERATOR), `canChangeRoles` (SUPER_ADMIN only). Update `canCreatePool` to check `COMMISSIONER`.

### 2. Role rename write-path checklist (grep-gate before backfill)

Before backfill, run `grep -rn "PARTICIPANT\|POOL_MANAGER" src/ functions/ firestore.rules` and confirm zero results except the legacy-alias mapping. Every known location:

- `src/services/authService.ts` — `mapUser()` default and new-user creation
- `src/components/SuperAdmin.tsx:1445` — role reference in admin UI
- `src/components/admin/SuperAdminBillingPanel.tsx:1409` — role reference in billing panel
- `functions/src/adminClaims.ts` — `setSuperAdminClaim` default fallback
- `functions/src/userSync.ts` — user sync on auth events
- `functions/src/poolOps.ts` — pool creation role checks
- `functions/src/nflPools.ts` — NFL pool join/role checks
- `functions/src/stripe.ts` — billing role references
- `functions/src/participant.ts:31,278` — participant role checks
- `firestore.rules:186` — role string reference in rules

Migration order: grep-gate passes → deploy → run backfill → verify. Do NOT run backfill before the grep gate is clean.

### 3. Replace `setSuperAdminClaim` / restrict `syncMyClaims`

- New function `setUserRole({ targetUid, role })` in `functions/src/adminClaims.ts`.
- Caller must have `SUPER_ADMIN` custom claim.
- Accepts any valid Role value.
- Write sequence: (a) `admin.auth().setCustomUserClaims()` then (b) `users/{uid}.role` in Firestore. These are NOT atomic across Firebase Auth and Firestore. If Firestore write fails after Auth claim is set, the function throws and the admin must re-run. Re-running is safe because `setCustomUserClaims` is idempotent. This is the accepted split-brain recovery path.
- Activity log and `admin_audit` writes are best-effort after both authoritative writes succeed.
- Keep `setSuperAdminClaim` as a deprecated passthrough to `setUserRole`.
- **Update `syncMyClaims`**: self-only (caller UID must equal target UID — deny any attempt to sync another user's claims). Authorization gate: read caller's Firestore role; if not `SUPER_ADMIN`, deny. This handles the bootstrap case where the claim is absent but Firestore already has `SUPER_ADMIN` — the function re-mints the claim for that user only. Map legacy `PARTICIPANT` → `MEMBER` before setting claims.
- On every downward role change, call `admin.auth().revokeRefreshTokens(targetUid)` after claims are set.

### 4. Server-side role fallback for sensitive operations

- In `sendUserEmail`, `triggerPasswordReset`, and `setUserRole`: validate both the JWT claim AND read `users/{callerUid}.role` from Firestore. Require both agree. Blocks demoted-but-not-yet-refreshed tokens.
- Add shared helper `assertCallerRole(request, ...allowedRoles)` in `functions/src/adminClaims.ts`.
- Apply `assertCallerRole` to ALL existing admin callables already exported from `functions/src/userManagement.ts` (verify against `functions/src/index.ts` exports). Deprecated callables that cannot be updated must be removed from `index.ts`.

### 5. New `logActivity` Cloud Function + activity logging

- New callable `logActivity({ eventType, metadata })` in `functions/src/userManagement.ts`.
- Callable by any authenticated user for their own UID only.
- **Allowlisted event types only**: callable accepts `LOGIN` and `LOGOUT` exclusively. Any other event type is rejected with `invalid-argument`. All other event types (`POOL_CREATED`, `POOL_ENTERED`, `PICKS_SUBMITTED`) are written exclusively from trusted server code within their respective Cloud Functions.
- Rate-limited transactionally: use a time-windowed counter doc `users/{uid}/_rateLimits/{minuteTimestamp}` with `count` field. In a Firestore transaction: read the doc; if missing or expired, create with `count: 1`; if `count >= 10`, throw `resource-exhausted`; else increment. TTL field or doc deletion handles cleanup.
- Activity doc shape: `{ type: ActivityEventType, timestamp: FieldValue.serverTimestamp(), metadata: Record<string, unknown> }`.

### 6. New `sendUserEmail` Cloud Function

- In `functions/src/userManagement.ts` (verify existing exports before adding).
- Callable by SUPER_ADMIN or MODERATOR via `assertCallerRole`.
- Params: `{ targetUid, subject, body }`.
- Fetches email via `admin.auth().getUser(targetUid)`.
- Writes to `mail` collection.
- Writes `EMAIL_SENT` to `users/{targetUid}/activity` and `admin_audit`.

### 7. New `triggerPasswordReset` Cloud Function

- In `functions/src/userManagement.ts`.
- Callable by SUPER_ADMIN or MODERATOR via `assertCallerRole`.
- Params: `{ targetUid }`.
- Fetches email via `admin.auth().getUser(targetUid)`.
- Generates link via `admin.auth().generatePasswordResetLink(email)`, sends via `mail` collection.
- Writes `PASSWORD_RESET_SENT` to `users/{targetUid}/activity` and `admin_audit`.

### 8. Denormalized `lastLoginAt` + search fields on user doc

- `logActivity` for `LOGIN` events also updates `users/{uid}.lastLoginAt` (server timestamp).
- Add `searchEmail` (lowercase `email`) field to `users/{uid}` on creation. Also refreshed in `userSync.ts` on every user sync to handle Firebase Auth email changes.
- Search query: `where('role', '==', selectedRole).where('searchEmail', '>=', prefix).where('searchEmail', '<=', prefix + '')`. Equality field before range field per Firestore composite index rules.
- Required composite index: `role ASC + searchEmail ASC`. Add to `firestore.indexes.json` and verify in emulator before shipping.
- No name-based search in v1 (would require a separate query and merge; out of scope).

### 9. Admin Audit Log collection

- Top-level `admin_audit/{auditId}` collection.
- Doc shape: `{ actorUid, actorRole, actionType, targetUid, timestamp, metadata }`.
- Written by `setUserRole`, `sendUserEmail`, `triggerPasswordReset` after primary writes succeed.
- Firestore rules: read by SUPER_ADMIN only; write only via Admin SDK.

### 10. Firestore rules update

- `users/{uid}`: read by SUPER_ADMIN, MODERATOR, or own uid.
- `users/{uid}` **read**: SUPER_ADMIN, MODERATOR, own uid, OR authenticated pool owner/manager reading a participant's doc. The last case requires a cross-doc lookup: `get(/databases/$(database)/documents/pools/{any poolId}).data.ownerId == request.auth.uid` — use only on targeted single-doc reads, not list queries, to avoid cost. This preserves `BracketPoolDashboard` payment-ledger and email flows for commissioners.
- Client write on **create**: allow all fields the current auth bootstrap flow writes: `id`, `email`, `name`, `picture`, `registrationMethod`, `provider`, `createdAt`, `role`, `referralCode`, `referralCount`, `referredBy` (optional), `emailVerified`, `welcomeEmailSent`. Enforce `request.resource.data.role == 'MEMBER'` — no other role self-assignable on create.
- Client write on **update**: allow only `name`, `picture`, `emailVerified`, `welcomeEmailSent`. All other fields blocked from client updates.
- **Migration prerequisite**: before the rule tightening ships, replace all direct client `dbService.updateUser` calls in `SuperAdmin.tsx` (writes to `email`, `referralCredits`, `freePoolsAvailable`) and `SuperAdminBillingPanel.tsx` (billing field writes) with dedicated callable Cloud Functions. These admin writes must be server-side before the update rule locks down the doc.
- `users/{uid}/activity`: read by SUPER_ADMIN, MODERATOR, or own uid. Write blocked from client (all activity via `logActivity` callable).
- `admin_audit/{auditId}`: read by SUPER_ADMIN only; write only via Admin SDK.
- Add `assertNotBanned()` helper function to rules: `request.auth.token.get('role', '') != 'BANNED'`.
- Apply `assertNotBanned()` exhaustively to ALL interactive pool write paths — not just the named callables: pool squares, picks, entries, `ai_requests`, `messages`, `shareClicks`, and every other authenticated write path in `firestore.rules`.

### 11. BANNED enforcement at callable layer

- Add shared `assertNotBanned(request)` guard (reads Firestore role, not just claim).
- Apply to every pool-mutation callable: `reserveSquare`, `submitNFLPicks`, `joinNFLPool`, `scoreBracketEntries`, `purchasePropCard`, plus full audit of all exported callables in `functions/src/index.ts`.

### 12. Extract `UserManagementPanel` — do NOT reuse full `SuperAdmin.tsx`

- `src/components/SuperAdmin.tsx` contains destructive SUPER_ADMIN-only actions (`deleteUserAccount`, `sendAdminPasswordReset`, direct billing edits). MODERATOR must not see these.
- Extract a dedicated `src/components/admin/UserManagementPanel.tsx` containing only: user list, user detail drawer, role dropdown (conditionally enabled by `canChangeRoles`), activity log, email compose, password reset.
- `/admin/users` route renders `UserManagementPanel`. Accessible by SUPER_ADMIN and MODERATOR.
- `SuperAdmin.tsx` remains SUPER_ADMIN-only and retains destructive actions.
- `UserManagementPanel` is also linked from within `SuperAdmin.tsx` for SUPER_ADMIN convenience.

### 13. Update `AdminPanel.tsx` link

- Add "User Management →" pointing to `/admin/users`.

## Key decisions & tradeoffs

- **Split-brain recovery via idempotent re-run**: Auth + Firestore role writes are not atomic. If Firestore fails after Auth claim is set, admin re-runs `setUserRole`; it is idempotent. Accepted risk for v1.
- **`syncMyClaims` restricted to SUPER_ADMIN bootstrap**: Eliminates Firestore-to-Auth privilege escalation path. Breaks the "any user can self-sync" pattern but that pattern was a security hole.
- **Firestore rule self-write whitelist**: Auth bootstrap fields explicitly whitelisted rather than moving bootstrap server-side (which is a larger refactor). Role update blocked on existing docs via Firestore rules.
- **`searchEmail`-only search, no name search**: Avoids client-merge complexity and composite-index explosion. Name search deferred to v2 (or Algolia/Typesense).
- **Dedicated `UserManagementPanel` component**: Avoids MODERATOR exposure to destructive SUPER_ADMIN actions in `SuperAdmin.tsx`. Clean separation of concerns.
- **`assertNotBanned()` exhaustive in rules + callables**: Belt-and-suspenders. Rules cover direct Firestore writes; callable guards cover server mutations.

## Risks / open questions

- **`userManagement.ts` already exists**: Verify existing exports before adding new ones to avoid naming collisions.
- **`poolOps.ts` vs `poolParams.ts`**: Verify actual file names before implementing step 2 checklist.
- **`logActivity` rate limiting via counter doc**: Counter increments on every call — adds a Firestore write to every login/logout. Acceptable at current scale; monitor for contention.
- **Composite index `searchEmail + role`**: Must be added to `firestore.indexes.json` and deployed before the admin user list is live.

## Out of scope

- Email templates for admin-composed emails
- Bulk role changes
- Name-based user search (v2 or external search service)
- Cross-user activity aggregate analytics beyond `admin_audit`
- Firebase Auth trigger-based event logging
- User deletion / full account deactivation
- Two-factor authentication management
