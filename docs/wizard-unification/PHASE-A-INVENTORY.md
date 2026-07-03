# Phase A pre-work inventory

Evidence gathered before touching the create path. Line refs are current as of
branch `feat/wizard-unification`. This is the audit the plan (and Codex rounds
1–4) required before consolidating callables, tightening rules, or unifying
billing.

## 1. Create-callable map (the three paths being consolidated)

| Callable | File | Types | Initial status | Slug | Billing stamped? | Owner-side writes |
|---|---|---|---|---|---|---|
| `createPool` | functions/src/poolOps.ts:41 | SQUARES (+ Playoff/Props pass their own `type` through `...data`) | `DRAFT` | none | **no** (billing stripped, never re-added) | pool doc, role upgrade, `managedPools` |
| `createNFLPool` | functions/src/nflPools.ts:32 | NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN | `OPEN` | none | **no** | pool doc, role upgrade, `managedPools`, `participations` |
| `createBracketPool` | functions/src/bracketPools.ts:14 | BRACKET | `DRAFT` | temp random, finalized by publish | **no** | pool doc only (**no** role upgrade, **no** index) |

`publishBracketPool` (bracketPools.ts:112) owns: `slugs/{slugLower}` reservation,
`slugLower`, PBKDF2 password hash, `lockAt` from the tournament doc, `DRAFT`→`OPEN`.

**Consequences confirmed:**
- No callable writes the `users/{uid}/activity` `POOL_CREATED` event that CONTEXT.md
  documents. The "POOL_CREATED" writes that exist go to the pool/top-level `audit`
  collection (nflPools.ts:109, bracketPools.ts:97) — a different concept.
- `stripPrivilegedPoolFields` (poolOps.ts:22-38) strips `billing`, so the NFL
  wizard's client-computed tier/maxPlayers never reach the doc. **All pools are
  created with no `billing` field.**

## 2. Owner-index inventory (side-effect bundle must preserve these)

| Index | Written by | On |
|---|---|---|
| `users/{uid}/managedPools/{poolId}` | createPool:126, createNFLPool:91 | create |
| `users/{uid}/participations/{poolId}` | createNFLPool:99, joinNFLPool:174 | create + join |
| `users/{uid}/joinedPools/{poolId}` | joinBracketPool:239 | **join only** (bracket create writes no owner index) |

Decision for the unified bundle: **preserve `managedPools` for all types, plus
`participations` for NFL types**, matching current behavior exactly. `joinedPools`
is a join-time index, out of the create path. No index retired without a
repo-wide read audit (not yet done — flagged, not assumed safe).

## 3. Direct `dbService.updatePool` / `updateDoc(pools)` call sites

These are the writers the plan does **not** migrate this branch (rules stay as-is
until a follow-up). Enumerated per Codex round-4 finding #2:

- Manager/commissioner flows: `PlayoffDashboard.tsx:544` (isLocked), `Props/PropsManager.tsx:112`, `NFLPoolDashboard/NFLManagerView.tsx:243`, `PropsWizard.tsx:132` (edit via initialData)
- Super admin: `SuperAdmin.tsx:763,863,143,185,3033`, `admin/SuperAdminBillingPanel.tsx:347,366,384`, `modals/PlayoffSettingsModal.tsx:41`
- Wizard edit today: `PlayoffWizard.tsx:425` (updateDoc)
- Test simulators (never production): `playoffSimulator.ts:144,192`, `propsSimulator.ts:135,140,171,173`, `bracketSimulator.ts:231`, `bracketE2ESimulator.ts:207,334`, `TournamentSimulator.tsx:409`, `simulationUtils.ts:184`
- Generic service path: `dbService.ts:118,135,292` (updateDoc)

Only the **wizard-editable settings** path (PlayoffWizard/PropsWizard edit) moves
to `updatePoolSettings`. Everything above keeps its current rule surface. Firestore
`pools` update rules are **not** tightened this branch.

## 4. Payment-handle field-shape map (adapter reconciles these)

| Location | Shape |
|---|---|
| Squares pool (src/types/index.ts:86-89) | top-level `venmo/zelle/cashapp/paypal` |
| NFL pools (src/types/nflPoolTypes.ts:75-78,121-124,162-165) | top-level `venmo/zelle/cashapp/paypal` |
| Wizard config (src/types/index.ts:183-188) | nested `paymentHandles{venmo,cashapp,paypal,zelle}` |
| UserProfile prefill (src/types/index.ts:528-531) | nested `paymentHandles{venmo,zelle}` |
| Functions types (functions/src/types.ts:483,615) | includes `googlePay` (nested-only) |

Canonical target: nested `paymentHandles{venmo,zelle,cashapp,paypal,googlePay}`,
legacy top-level dual-written. **googlePay has no legacy top-level field** — nested
only. Implemented + unit-tested in `shared/paymentHandles.ts`.

## 5. Billing reality — a spec-vs-reality gap (BLOCKING the callable's billing stamp)

Confirmed:
- `BillingStatus = 'free' | 'trial' | 'active' | 'grace_period' | 'locked'` (functions/src/types.ts:671).
- No create path stamps billing → new pools have **no `billing` field**.
- `checkBillingAccess` (billing.ts:164) treats missing billing as **free / always allowed**.
- The free-plan cap (10 participants) is enforced at **join** time (nflPools.ts:164), not via billing status.
- `enforceBillingStatus` (billing.ts:34) only acts on pools with `billing.status == 'trial'`
  and an expired `trialEndsAt`, transitioning trial→grace→locked and emailing the commissioner.

**The gap:** the plan says "stamp billing defaults (trial/free_tier), launch stays
free-trial." But today new pools are effectively **`free` and never auto-lock**.
If `createPool` starts stamping `billing.status='trial'` + `trialEndsAt`, every new
pool will auto-transition to grace→locked after the trial and email its commissioner —
a material change to the monetization funnel that does **not** match current behavior.
This is a T14-class premise gap and needs an explicit decision before the unified
`createPool` billing stamp is written (see the open decision raised with the user).

## 6. Still needed before writing the remaining Phase A code

- **Per-type `CreatePoolInput` schema archaeology:** exact submit payloads for the
  Playoff and Props wizards (Squares/NFL/Bracket payloads are captured above).
- **Editability matrix source:** what each current dashboard actually lets a
  commissioner change, per lifecycle state, per type — read before encoding the matrix
  (avoid guessing; plan risk).
- **Billing decision** (§5) — hard blocker for the billing stamp + `settings/billing_config` unification.
- **Predeploy-copy packaging validation:** wire `shared/` into the functions build and
  confirm a deploy dry-run contains the copied modules (not done blind).
