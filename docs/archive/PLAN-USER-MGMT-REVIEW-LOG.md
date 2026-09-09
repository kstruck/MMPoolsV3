# Plan Review Log: Full User Management System

Act 1 (grill-with-docs) complete — plan locked, CONTEXT.md created, no ADRs needed. MAX_ROUNDS=5.

## Round 1 — Codex

VERDICT: REVISE

Findings (10 total — all accepted):

- **Critical**: Stale tokens for demoted SUPER_ADMIN/MODERATOR keep admin power up to 1 hour. Fix: `revokeRefreshTokens` on downward role changes + Firestore role double-check in sensitive callables.
- **Critical**: `syncMyClaims` defaults to `PARTICIPANT` (legacy), contradicts authoritative-claim model after rename. Fix: update fallback to `MEMBER`, map legacy `PARTICIPANT` → `MEMBER` at read time.
- **High**: `PARTICIPANT`/`POOL_MANAGER` rename blast radius understated — write paths in `userSync.ts`, `poolOps.ts`, `nflPools.ts`, `stripe.ts` missed. Fix: explicit write-path checklist, backfill only after all paths deployed.
- **High**: BANNED is UI-only; server callables and Firestore rules don't deny BANNED users. Fix: `assertNotBanned` guard in all pool-mutation callables + Firestore rule function.
- **High**: Client-side `LOGIN`/`LOGOUT` activity logging is forgeable/spammable. Fix: move to `logActivity` callable with rate limiting.
- **High**: No `lastLoginAt` writer, no search schema for admin user list. Fix: denormalize `lastLoginAt`, `searchName`, `searchEmail` on user doc.
- **High**: `setUserRole` is 3-system write (Auth claim + Firestore + activity) with no failure model. Fix: fail closed on Auth + Firestore; activity log is best-effort.
- **Medium**: Wrong file references (`poolParams.ts` vs `poolOps.ts`, `src/types.ts` vs `src/types/index.ts`, existing `userManagement.ts`). Fix: corrected in plan.
- **Medium**: `SuperAdmin.tsx` already has user management surface. Fix: extend existing component, don't create parallel surface.
- **Medium**: Actor-centric audit missing; MODERATOR email permission ambiguous. Fix: add `admin_audit` collection, clarify MODERATOR can email in CONTEXT.md.

### Claude's response — Round 1

All 10 findings accepted. Key changes to plan: `revokeRefreshTokens` on downward role changes; `assertCallerRole` Firestore double-check; `logActivity` callable replacing client writes; `lastLoginAt` + search fields; `admin_audit` collection; corrected file references; extend `SuperAdmin.tsx` not create new surface; CONTEXT.md clarified.

---

## Round 2 — Codex

VERDICT: REVISE

Findings (6 new, 5 prior addressed):

- **Critical**: Auth+Firestore writes in `setUserRole` are not truly atomic — split-brain risk remains even with "fail closed." Fix: make idempotent (re-run recovers); document explicitly.
- **High**: `syncMyClaims` (even updated) still lets Firestore re-mint privilege if the two stores drift. Fix: restrict `syncMyClaims` to SUPER_ADMIN callers only (bootstrap path).
- **High**: Planned Firestore rule for `users/{uid}` (only `name`/`picture` self-writes) will break current auth bootstrap which writes `email`, `registrationMethod`, `provider`, `createdAt`, `role`, `emailVerified`, `welcomeEmailSent`. Fix: explicitly whitelist all fields the auth flow currently needs.
- **High**: BANNED enforcement still incomplete — `ai_requests`, `messages`, `shareClicks` paths in `firestore.rules` unguarded. Fix: exhaustive audit of ALL interactive write paths.
- **Medium**: Search design unspecified, no indexes. Fix: `searchEmail`-only prefix range + role filter; composite index `searchEmail ASC + role ASC` in `firestore.indexes.json`.
- **Medium**: `searchEmail` not updated on email change (Firebase Auth-driven). Fix: refresh in `userSync.ts` on every sync.
- **Medium**: `SuperAdmin.tsx` has destructive actions (`deleteUserAccount`, billing edits) MODERATOR must not see — gating role-change writes alone is not enough. Fix: extract `UserManagementPanel` subcomponent for `/admin/users`; keep rest of `SuperAdmin.tsx` SUPER_ADMIN-only.

### Claude's response — Round 2

All 6 accepted. Key changes: `setUserRole` documented as idempotent (re-run is recovery path); `syncMyClaims` restricted to SUPER_ADMIN callers only; Firestore rule self-write whitelist expanded to cover all auth bootstrap fields; `assertNotBanned()` applied exhaustively to ALL write paths in rules + callables; search simplified to `searchEmail`-only + composite index; `searchEmail` refreshed in `userSync.ts`; `SuperAdmin.tsx` NOT extended — dedicated `UserManagementPanel` extracted instead.

---

## Round 3 — Codex

VERDICT: REVISE

Findings (6 new, all prior criticals confirmed closed):

- **High**: Write-path checklist still missing `functions/src/participant.ts:31,278`, `firestore.rules:186`, `src/components/SuperAdmin.tsx:1445`, `src/components/admin/SuperAdminBillingPanel.tsx:1409`. Fix: turn step 2 into a repo-wide grep gate; do not backfill until grep returns zero.
- **High**: Firestore create rule allows client to write `role` field — no constraint to `MEMBER` means user could self-assign `SUPER_ADMIN` on account creation. Fix: rule must enforce `request.resource.data.role == 'MEMBER'` on create.
- **High**: `logActivity` callable accepts any `eventType` — users can forge `POOL_CREATED`, `PICKS_SUBMITTED`, etc. Fix: hard-limit callable to `LOGIN`/`LOGOUT` only; all other events from trusted server paths.
- **Medium**: Rate limit counter has no minute window or reset — counter never resets or races under parallel calls. Fix: time-windowed counter doc `users/{uid}/_rateLimits/{minuteTimestamp}` with transactional increment.
- **Medium**: Existing `userManagement.ts` exports still use old claim-only validation — plan only adds `assertCallerRole` to new functions. Fix: apply to ALL existing admin callables or remove deprecated exports.
- **Medium**: Composite index field order wrong — equality before range required. Fix: `role ASC + searchEmail ASC` (not `searchEmail + role`), verified in emulator.

### Claude's response — Round 3

All 6 accepted. Key changes: step 2 is now a grep gate with all missed files added; Firestore create rule enforces `role == 'MEMBER'`; `logActivity` hard-limited to `LOGIN`/`LOGOUT` only; rate limit uses time-windowed counter doc with transactional increment; `assertCallerRole` applied to ALL existing admin callables; index order corrected to `role ASC + searchEmail ASC`.

---

## Round 4 — Codex

VERDICT: REVISE

Findings (4 new, all Round 3 items confirmed closed):

- **High**: Create-rule whitelist still missing `id`, `referralCode`, `referralCount`, `referredBy` from current `authService.ts` bootstrap writes. Proposed `name`/`picture`-only update rule would also block `emailVerified`/`welcomeEmailSent` updates. Fix: expand whitelist to match exact current client writes.
- **Medium**: `syncMyClaims` authorization "SUPER_ADMIN only" ambiguous for bootstrap case where claim is absent. Fix: self-only + Firestore role check; deny any attempt to sync another UID.
- **Medium**: Admin client writes to `email`, `referralCredits`, `freePoolsAvailable` in `SuperAdmin.tsx:637` and `SuperAdminBillingPanel.tsx:393` unaddressed — rule tightening will break these. Fix: migrate to callables before rules ship.
- **Medium**: Grep gate misses `firestore.rules`. Fix: include explicitly in grep command.

### Claude's response — Round 4

All 4 accepted. Key changes: create whitelist expanded to all current `authService.ts` bootstrap fields; update whitelist expanded to include `emailVerified`/`welcomeEmailSent`; `syncMyClaims` spec tightened (self-only, Firestore role check, deny other UIDs); migration prerequisite added for admin client writes before rule tightening; grep gate updated to include `firestore.rules`.

---

## Round 5 — Codex (FINAL — cap hit)

VERDICT: REVISE

Finding (1 remaining — all Round 4 items confirmed closed):

- **High**: Tightened `users/{uid}` read rules break commissioner pool flows — `BracketPoolDashboard.tsx:421` and `PaymentLedger.tsx:24` do client-side bulk reads of user docs for payment ledger and email features. These will break for pool owners when the rules ship.

### Resolution — cap hit (deadlock)

**Claude's counter-position**: Finding is valid and the fix is clear. Added to plan step 10: `users/{uid}` read also allowed for authenticated pool owners/managers reading participant docs (cross-doc lookup via `get()` on a pool doc). This preserves commissioner payment-ledger and email flows without loosening rules for arbitrary users.

Plan updated with this final fix. Ready for implementation sign-off.
