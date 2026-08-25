# Plan: Auth-hardening from the 2026-08 audits (role gates, bracket create, password-reset notice, pool passwords)

_Compiled 2026-08-24 (overnight audit-remediation session) from the backend-API
and auth/permissions audits, re-verified claim-by-claim against `origin/main` =
`6e48bd27`. Terms per CONTEXT.md. Plan-gated: touches **authorization** (role
gates, `firestore.rules` in Phase B) and — Phase B only — **production data**
(plaintext-password migration)._

## Implementation status

| Item | State |
|---|---|
| A1 claim+doc role gate on the two claim-only callables | ✅ built — PR #1 (Phase A) |
| A2 bracket create: strict settings schema, no raw spread | ✅ built — PR #1 (Phase A) |
| A3 password-reset notification email | ✅ built — PR #1 (Phase A) |
| B pool-password plaintext fix | ✅ built — Phase B PR. **Kevin chose Option 2 (full fix, keep the feature) 2026-08-24.** Code is live-safe on merge; the prod-data sweep stays disarmed until Kevin arms it. |

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

## Phase B — pool passwords (BUILT)

### The decision

Three options were put to Kevin on 2026-08-24. He chose **Option 2 — the full
fix, keep the feature**. Recorded here verbatim so the rejected options are not
silently re-litigated:

1. *Relabel + kill the field* (the plan's original recommendation) — REJECTED
   by Kevin. It would have removed a feature commissioners actually use.
2. **CHOSEN.** Server-side PBKDF2, password moved to
   `pools/{id}/private/access` (`allow read: if false`), the join/unlock gate
   becomes a callable, and a migration sweep evacuates existing plaintext.
3. *Do nothing* — rejected on the audit's own terms: it leaks real user-chosen
   passwords to anyone holding a pool link, and people reuse passwords.

### What was actually wrong — all four of it

The audit named one leak. There were four, and they disagreed with each other:

| # | Where | What |
|---|---|---|
| B1 | `pool.gridPassword` (squares/props wizards) | PLAINTEXT on `pools/{id}`, which is `allow get: if true`. |
| B2 | `pool.accessControl.password` (BracketPoolDashboard:380 → dbService:550) | PLAINTEXT, written by a direct client `updateDoc` — **and `joinBracketPool` never read it**, so the field was simultaneously exposed and unenforced (item 13a). |
| B3 | `pool.passwordHash` (publishBracketPool) | PBKDF2, but still on the world-readable document, i.e. offline-crackable material handed out with the share link. |
| B4 | `PoolRoute.tsx:402` | The squares gate was `enteredPassword === squaresPool.gridPassword` — a compare **in the browser**, against a field anyone could read out of the network tab. |

### The shape that replaces it

- **One home.** `pools/{poolId}/private/access` holds `{ passwordHash }` and
  nothing else. `firestore.rules` gives the whole `private/{docId}` wildcard
  `allow read, write: if false` — closed to guests, members, the pool OWNER and
  SUPER_ADMIN alike. The only reader is a callable holding an Admin SDK handle.
- **A non-secret marker.** `pool.hasPoolPassword` (boolean) is what the UI
  renders a lock from. It is server-written and client-denied.
- **PBKDF2**, `crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512')` → `salt:hash`.
  Identical parameters to the pattern already at `bracketPools.ts:202`, so
  existing `passwordHash` values are MOVED verbatim and keep verifying. The
  iteration count is deliberately unchanged — see the header of
  `functions/src/lib/poolPassword.ts` for why raising it is a separate change.
- **Two new callables** plus the sweep, all exported from `index.ts` in one
  clause:
  - `setPoolPassword({poolId, password|null})` — commissioner/SA (claim **and**
    doc agreement on the SA branch). `password: ''` is REJECTED rather than
    treated as a clear.
  - `verifyPoolAccess({poolId, password})` — **public** (`auth: "public"`),
    because a squares share link works logged-out. Throttled 10 failures /
    15 min per **(pool, principal)**; the key is hashed, only FAILURES are
    charged, and the slot is refunded on success.
  - `migratePoolPasswords({dryRun, limit, startAfter})` — the Rule 1 sweep.
- **The choke point (item 13b).** `createPoolPermissiveSchema` — the open
  `z.record` create envelope shared by `createPool` and `createNFLPool` — now
  carries a `.transform(stripPoolPasswordFields)`. `validated()` hands the
  handler the PARSED data, so the fields cannot reach any pool document from any
  wizard, present or future. Same transform on `updatePoolSettings.updates`.
- **Rehash-on-successful-verify (item 13c).** A legacy bare-sha256 hash, or
  plaintext still on the public doc, is accepted once and upgraded to PBKDF2 in
  the same request — in `joinBracketPool` and in `verifyPoolAccess`. Both are
  best-effort: a failed rehash never turns a correct password into a rejected
  one.
- **Item 21d.** The `JSON.stringify(request.data)` dump at `bracketPools.ts:37`
  is deleted. It wrote the commissioner's contact email, payment handles and
  (pre-Phase-B) the pool password to Cloud Logging on every single create.

### The two decisions inside the fix that are not obvious

**"Empty is not a clear."** `src/constants.ts` ships `gridPassword: ''`, and
once the value no longer lives on the document every wizard reloads that field
EMPTY — so an empty value arrives on every ordinary settings save. Encoding
"clear the password" as the empty string would silently un-gate a pool each time
its commissioner saved an unrelated setting. Empty is therefore a NO-OP
everywhere (`splitPoolPassword`, `setPoolPasswordSchema`, the rules predicate),
and clearing is an explicit act: the bracket dashboard's "Remove the password"
checkbox → `setPoolPassword(poolId, null)`.

**The rules predicate bans the VALUE, not the FIELD.** An unconditional deny on
`gridPassword` would break every squares settings save, because the wizards send
a full-object update carrying the empty default. `poolPasswordNotWritten()`
allows `''`/`null` through and refuses any non-empty value — and, like
`callableOnlySettingsUnchanged()`, sits OUTSIDE the disjunction so `isSuperAdmin()`
cannot short-circuit past it. A same-value write is not an `affectedKey`, so a
pre-migration pool that still carries its plaintext stays editable until the
sweep reaches it.

### Rollout order (this is load-bearing)

1. Merge + `npx firebase deploy` — **functions BEFORE rules** (the standing
   ritual, and here it also matters: rules deny the client write, so the
   callable has to exist first).
2. Frontend (manual Coolify trigger). Until it lands, browsers still run the old
   client — which is fine, because nothing has been deleted from any document
   yet.
3. ONLY THEN the sweep, dry first. Details in
   `PLAN-AUDIT-AUTH-HARDENING-SWEEPS.md`.

Running the sweep before step 2 would delete `gridPassword` from pools whose
visitors are still served the old client, and those pools would render ungated.

### Known limitations carried

- 🛑 **THE GATE IS STILL A UI GATE.** `verifyPoolAccess` decides what the app
  RENDERS; it does not decide what Firestore serves. `pools/{id}` is
  `allow get: if true` (guest share links depend on it), so a determined visitor
  can still read a "private" squares pool's document directly. **What this phase
  fixes is the password, not the pool**: the password itself is no longer
  readable, no longer comparable in the browser, and no longer a credential the
  member has reused elsewhere and just handed to every link-holder. Making the
  pool DATA private is a different, larger change — the `get` rule, every
  read path, and the guest-link product decision — and is not attempted here.
  Say so plainly rather than letting the phase read as more than it is.
- **A squares commissioner cannot CLEAR a password from the wizard.** The
  wizard cannot distinguish "unchanged" from "cleared" (see above), so it only
  ever SETS. Bracket has an explicit removal control; squares does not yet. The
  fail-safe direction was chosen deliberately — the alternative silently opens
  pools. A "Remove password" control for the squares wizard is a follow-up.
- **The password is still a share-link speed bump, not a credential.** Members
  who know it can pass it on. That is the feature. What changed is that it is no
  longer READABLE by anyone with the link, and no longer checkable client-side.
- **App Check is `monitor`, not `enforce`,** on both new callables — repo-wide
  posture since the 2026-07-30 outage. The public `verifyPoolAccess` therefore
  leans on the per-principal throttle alone.

## Tests (same PR)

Phase A:

- Rules-independent unit tests: strict settings schema rejects unknown keys;
  notifyPasswordReset rate-limit predicate; source invariant — no
  `token?.role !== 'SUPER_ADMIN'`-style claim-only checks in
  siteAverages/expertProfiles.

Phase B (standing rule: every change ships with its own test in the same PR):

- `functions/src/__tests__/poolPassword.test.ts` — PBKDF2 round-trip, salting,
  **format compatibility with the pre-existing publishBracketPool derivation**
  (if those parameters drift, every legacy bracket pool locks its members out),
  the two legacy acceptance paths, the private-hash-beats-stale-plaintext
  precedence, the oversize-candidate early return, `safeEqual` not throwing on a
  length mismatch, the throttle predicate (cap, rollover, per-principal keying),
  the create/update choke-point strip, the callable schemas (including that `''`
  is refused and that `dryRun` defaults TRUE), the migration planner's five
  branches, and source ratchets: no `JSON.stringify(request.data)` in
  bracketPools, nothing assigns `gridPassword`, and the set of files assigning
  `passwordHash` is pinned to exactly three.
- `tests/pool-password-client.test.ts` — `splitPoolPassword` (both field shapes,
  the dotted form, empty-is-not-a-clear, no input mutation) plus client source
  invariants: PoolRoute no longer compares in the browser, the bracket dashboard
  neither writes nor seeds from the stored value, all three dbService payload
  wrappers split first, and no file under `src/` writes password material.
- `functions/scripts/poolPrivateAccess.rules.test.mjs` — the emulator half: the
  private doc is closed to all five principal classes, the wildcard covers future
  siblings, the throttle store is closed, the guest `get` on the public doc still
  works, neither the OWNER nor a SUPER_ADMIN can write any password field onto
  the pool doc, an ordinary settings save (including `gridPassword: ''`) still
  passes, and a pre-migration pool stays editable.
- `functions/scripts/run-rules-tests.mjs` `MIN_FILES` bumped 10 → 12 (it had
  drifted one below the real file count; the empty-pass guard only works when it
  tracks the count).
- `tests/nfl-settings-lockdown.test.ts` — its "applied OUTSIDE the disjunction"
  assertion pinned the literal string `callableOnlySettingsUnchanged() && (`,
  which a SECOND outside-the-disjunction guard breaks. Loosened to a regex that
  still proves the ordering. No coverage lost.

## Risks / open questions

- A3's public callable is a (bounded) email sender — the rate limit doc and
  existing-account check are the whole defense; both are unit-tested. Copy
  contains no links to click (anti-phishing: it instructs, never links).
- A2 could break a client sending unknown settings keys today — the wizard
  sends exactly the schema'd fields (shared/schemas/bracket.ts header note);
  Test Suite bracket sims ride createPool, not this handler.
