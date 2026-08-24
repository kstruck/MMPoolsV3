# Plan: Auth-hardening from the 2026-08 audits (role gates, bracket create, password-reset notice, pool passwords)

_Compiled 2026-08-24 (overnight audit-remediation session) from the backend-API
and auth/permissions audits, re-verified claim-by-claim against `origin/main` =
`6e48bd27`. Terms per CONTEXT.md. Plan-gated: touches **authorization** (role
gates, `firestore.rules` in Phase B) and — Phase B only — **production data**
(plaintext-password migration)._

## Implementation status

| Item | State |
|---|---|
| A1 claim+doc role gate on the two claim-only callables | ✅ built — this PR |
| A2 bracket create: strict settings schema, no raw spread | ✅ built — this PR |
| A3 password-reset notification email | ✅ built — this PR |
| B pool-password plaintext fix | NOT BUILT — DECISION NEEDED (options below) |

## Audit verification

| Audit claim | Verdict | Evidence |
|---|---|---|
| `siteAverages.ts` / `expertProfiles.ts` on-demand callables check the claim only | ✅ CONFIRMED | `refreshSiteAverages` (siteAverages.ts:88), `refreshExpertProfiles` (expertProfiles.ts:157): `request.auth.token?.role !== 'SUPER_ADMIN'` — a demoted admin with an un-expired token passes. Everything else uses `assertCallerRole` claim+doc agreement. |
| `createBracketPool` "writes the whole settings object with no schema" | ⚠️ PARTLY STALE, real residue | A zod schema EXISTS (`shared/schemas/bracket.ts` via `validateCreateInput`, poolCreation.ts:41). But it is non-strict AND the handler spreads raw client `...settings` into the money-pool doc (bracketPools.ts:107) — zod only *checks*, the handler consumes the ORIGINAL data, so arbitrary unknown settings keys land on the pool document. |
| No notification on password change | ✅ CONFIRMED | No `updatePassword` path exists in src/ at all — the only password change is the email reset flow (`AuthActionHandler.tsx:112` `confirmPasswordReset`). No notification anywhere; email-change has one (userManagement.ts:172 SMS + email). Stolen inbox = silent takeover. |
| Squares "private" pool password stored plaintext on a world-readable doc, checked client-side | ✅ CONFIRMED | `gridPassword` rides the permissive create path onto `pools/{id}` (`allow get: if true`, firestore.rules:63); gate is a string compare in `PoolRoute.tsx:364`. Bracket join path correctly uses PBKDF2 server-side (bracketPools.ts:202) but the dashboard writes `accessControl.password` plaintext — the two halves disagree. |

## Phase A (built in this PR)

### A1 — claim+doc gate

`refreshSiteAverages` and `refreshExpertProfiles` switch from the inline
claim-only check to `assertCallerRole(request, "SUPER_ADMIN")` — the same
C5-upgrade every other admin callable got. Read-only recompute endpoints, so
the change is strictly narrowing.

### A2 — bracket create tightening

- `bracketSettingsSchema` → `z.strictObject` (+ explicit `paymentHandles`
  already present); unknown settings keys are REJECTED at validateCreateInput
  instead of riding into the doc.
- The handler's `...settings` spread is replaced by the explicit field list
  (adding `paymentHandles`, the one field the enumeration missed — why the
  spread existed).
- Top level stays non-strict on purpose: `couponCode`/`addons` ride the top
  level and are consumed by their own server-side validators
  (`validLaunchCouponCode`, `normalizeAddonSelection`); strictifying the top
  level is a wider contract change with its own blast radius — out of scope.

### A3 — password-reset notification

New callable `notifyPasswordReset` (public — the reset flow is unauthenticated
by nature), invoked by `AuthActionHandler` after `confirmPasswordReset`
succeeds:
- Sends the templated security email ONLY to addresses with an existing
  account (silently no-ops otherwise — no account-enumeration oracle: the
  response is identical either way).
- Abuse-bounded: one notification per email hash per hour (Firestore doc
  `security_notices/{emailHash}`), so the worst an abuser can do is send one
  truthful-looking "your password was reset — if this wasn't you, contact
  support" email per target per hour. The copy asserts nothing the user must
  trust ("If you did not do this, reset your password and contact support").
- Fire-and-forget from the client: a notification failure never blocks the
  reset UX.

Why not a server-side trigger: Firebase Auth has no password-change event
without upgrading the project to Identity Platform blocking functions —
out of scope tonight, noted as the stronger future shape.

## Phase B — pool passwords (NOT built; DECISION NEEDED)

The honest options, in Kevin-decision order:

1. **RECOMMENDED — relabel + kill the field.** The feature's real value today
   is "unlisted link", and the password adds only false assurance (it is
   world-readable). Remove the gate UI, relabel "private" → "unlisted",
   stop writing `gridPassword`/`accessControl.password`, and run a
   kill-switched, dry-run-default sweep that DELETES the two fields from
   existing docs (prod-data mutation, Rule 1). Smallest surface, no new
   crypto, removes real leaked-credential risk (people reuse passwords).
2. **Full fix.** Server-side PBKDF2 (pattern exists at bracketPools.ts:202),
   password moved to `pools/{id}/private/access` (`allow read: if false`),
   join gate becomes a callable that verifies and grants, migration sweep
   moves+deletes existing plaintext. Keeps the feature; touches rules +
   client join flow + a migration; several hours + its own review rounds.
3. **Do nothing** — rejected: the audit is right that this leaks real
   user-chosen passwords to anyone with a pool link.

Until decided, the exposure is unchanged from today (no new writes make it
worse tonight; POOLS_OPEN is still false, so no new squares pools are being
created by the public).

## Tests (same PR)

- Rules-independent unit tests: strict settings schema rejects unknown keys;
  notifyPasswordReset rate-limit predicate; source invariant — no
  `token?.role !== 'SUPER_ADMIN'`-style claim-only checks in
  siteAverages/expertProfiles.

## Risks / open questions

- A3's public callable is a (bounded) email sender — the rate limit doc and
  existing-account check are the whole defense; both are unit-tested. Copy
  contains no links to click (anti-phishing: it instructs, never links).
- A2 could break a client sending unknown settings keys today — the wizard
  sends exactly the schema'd fields (shared/schemas/bracket.ts header note);
  Test Suite bracket sims ride createPool, not this handler.
