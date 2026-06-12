# Plan: Full User Management System
_Locked via grill-with-docs — by Claude + Kevin Struck. Terms per CONTEXT.md._

## Goal
Build a complete User Management system accessible to SUPER_ADMIN and MODERATOR roles at `/admin/users`. The system allows viewing all Users, changing Roles (SUPER_ADMIN only), browsing per-User Activity Logs, sending one-off emails, and triggering password resets. Activity is tracked in `users/{uid}/activity` subcollections written by auth flows, pool actions, and Cloud Functions.

## Approach

### 1. Extend the Role type system
- In `src/types.ts`: expand `UserRole` to `'SUPER_ADMIN' | 'MODERATOR' | 'COMMISSIONER' | 'MEMBER' | 'BANNED'`.
- Rename `PARTICIPANT` → `MEMBER` and `POOL_MANAGER` → `COMMISSIONER` throughout the type system.
- In `src/utils/auth.ts`: add `isModerator`, `isCommissioner`, `isBanned`, `canManageUsers` (SUPER_ADMIN or MODERATOR), `canChangeRoles` (SUPER_ADMIN only). Update `canCreatePool` to check `COMMISSIONER`.

### 2. Data migration for existing PARTICIPANT users
- `mapUser()` in `authService.ts`: map incoming `role: 'PARTICIPANT'` → `'MEMBER'` at read time (zero-downtime compat).
- One-time backfill function callable by SUPER_ADMIN in the admin panel to update all `role: 'PARTICIPANT'` docs to `'MEMBER'` in Firestore.
- `POOL_MANAGER` has zero live users — rename is safe, no backfill needed.

### 3. Replace `setSuperAdminClaim` Cloud Function
- New function `setUserRole({ targetUid, role })` in `functions/src/adminClaims.ts`.
- Caller must have `SUPER_ADMIN` custom claim.
- Accepts any valid Role value: `SUPER_ADMIN | MODERATOR | COMMISSIONER | MEMBER | BANNED`.
- Sets custom claim `{ role }` via `admin.auth().setCustomUserClaims()`.
- Mirrors role to `users/{uid}.role` in Firestore.
- Writes `ROLE_CHANGED` event to `users/{targetUid}/activity`.
- Keep `setSuperAdminClaim` as a deprecated passthrough calling `setUserRole` for backward compat.
- Keep `syncMyClaims` unchanged.

### 4. New `sendUserEmail` Cloud Function
- New file `functions/src/userManagement.ts`.
- Callable by SUPER_ADMIN or MODERATOR (check `request.auth.token.role`).
- Params: `{ targetUid, subject, body }`.
- Fetches email via `admin.auth().getUser(targetUid)`.
- Writes to `mail` collection (Trigger Email extension handles delivery).
- Writes `EMAIL_SENT` event to `users/{targetUid}/activity` with `{ subject, sentBy: callerUid }`.

### 5. New `triggerPasswordReset` Cloud Function
- In `functions/src/userManagement.ts`.
- Callable by SUPER_ADMIN or MODERATOR.
- Params: `{ targetUid }`.
- Fetches email via `admin.auth().getUser(targetUid)`.
- Generates link via `admin.auth().generatePasswordResetLink(email)` and sends via `mail` collection.
- Writes `PASSWORD_RESET_SENT` event to `users/{targetUid}/activity`.

### 6. Activity logging at auth and pool action sites
- `authService.ts` sign-in flows: write `LOGIN` event to `users/{uid}/activity` after successful auth.
- `authService.ts` sign-out: write `LOGOUT` event.
- `poolParams.ts` `createPool`: write `POOL_CREATED` to `users/{ownerId}/activity` server-side.
- Pool join flows (client-side, on confirmed entry): write `POOL_ENTERED`.
- Pick submission flows: write `PICKS_SUBMITTED`.
- Activity doc shape: `{ type: ActivityEventType, timestamp: FieldValue.serverTimestamp(), metadata: Record<string, unknown> }`.

### 7. Firestore rules update
- `users/{uid}`: read by SUPER_ADMIN, MODERATOR, or own uid. Client write restricted to own non-sensitive fields.
- `users/{uid}/activity`: read by SUPER_ADMIN, MODERATOR, or own uid. Write blocked from client for sensitive events (ROLE_CHANGED, EMAIL_SENT, PASSWORD_RESET_SENT); LOGIN/LOGOUT written from trusted client paths.

### 8. New `/admin/users` route + components
- Route in `App.tsx`: `/admin/users`, guarded by `canManageUsers(user)`. Redirect unauthorized to home.
- `src/components/admin/UserManagementPage.tsx`:
  - Paginated user list (query `users` collection, 50/page) with search by name/email.
  - Filter by Role.
  - Row: avatar, name, email, role badge, created date, last login.
  - Click row → opens `UserDetailDrawer`.
- `src/components/admin/UserDetailDrawer.tsx`:
  - User profile header.
  - Role change dropdown — disabled for MODERATOR, active for SUPER_ADMIN. Calls `setUserRole`.
  - Activity log timeline (`users/{uid}/activity`, desc, limit 100).
  - "Send Email" button → `SendEmailModal`.
  - "Reset Password" button → calls `triggerPasswordReset` with confirmation.
- `src/components/admin/SendEmailModal.tsx`:
  - Subject + body fields. Send button calls `sendUserEmail`. Success/error state.

### 9. Link from AdminPanel
- Add "User Management →" button in `AdminPanel.tsx` navigating to `/admin/users`.

### 10. BANNED enforcement
- Pool entry and pick-submission points: check `isBanned(user)` and show blocked UI.
- For BANNED specifically: check both the JWT claim AND Firestore role on page load so a freshly-banned user is blocked without waiting for token expiry (up to 1 hour gap).
- Export `isBanned` from `src/utils/auth.ts`.

## Key decisions & tradeoffs
- **Role in custom claim + Firestore (both)**: Custom claim is authoritative for Firestore rules. Firestore field is needed for admin UI queries and real-time BANNED check. `setUserRole` is the single write path.
- **`PARTICIPANT` → `MEMBER` rename**: Breaking change in data. Handled via `mapUser()` read-time mapping + backfill, not a live migration. Zero downtime.
- **`POOL_MANAGER` → `COMMISSIONER`**: No live users have this role — safe rename. `canCreatePool` updated accordingly.
- **LOGIN/LOGOUT activity from client**: Firebase Auth event triggers are not available as callable Cloud Functions. Client-side writes in `authService.ts` are practical for v1. These events are display-only, not security-critical.
- **Free-form admin email**: Template emails are handled by automated Cloud Functions. Admin one-offs are ad-hoc and unpredictable in content.

## Risks / open questions
- **Token expiry on BANNED** (up to 1 hour): Mitigated by reading Firestore role on pool entry in addition to JWT claim. Full mitigation via `admin.auth().revokeRefreshTokens(uid)` is out of scope for v1 but noted.
- **User list scalability**: Querying `users` collection works for current scale. At 10k+ users, prefer `admin.auth().listUsers()` (Admin SDK, Cloud Function) as the data source.
- **`PARTICIPANT` values during rollout window**: `mapUser()` handles these at read time. No functional regression since permissions are identical.

## Out of scope
- Email templates for admin-composed emails
- Bulk role changes
- Cross-user activity aggregate analytics
- Firebase Auth trigger-based event logging
- User deletion / account deactivation beyond BANNED
- Two-factor authentication management
- Session revocation on BANNED (`revokeRefreshTokens`)
