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

**RESOLVED (2026-07-03):** stamp **`free`, no auto-lock** — preserve today's behavior
exactly. `createPool` sets `billing.status='free'` (or leaves it absent, equivalent);
`enforceBillingStatus` never touches it; cap stays enforced at join; commissioners
upgrade via Stripe when they want more. Confirms PlayoffWizard already sends a
client `billing.status='trial'` that `stripPrivilegedPoolFields` discards
(PlayoffWizard.tsx:393-405 → poolOps.ts:22) — so nothing changes on the wire.

## 6. Phase A progress / still needed

Done + verified (branch `feat/wizard-unification`, in worktree `D:/mmp-wizard`):
- ✅ **Payment-handle adapter** — `shared/paymentHandles.ts` (self-check green).
- ✅ **Pool-type enum** — `shared/poolTypes.ts`.
- ✅ **CreatePoolInput schemas — all 7 types** — `shared/schemas/*` + registry
  (self-check green). Payloads captured from every wizard build site.
- ✅ **Billing decision** — free-default (§5 resolved).

- ✅ **Predeploy-copy packaging** — `functions/scripts/copy-shared.mjs` mirrors
  `shared/`→`functions/src/shared/` (gitignored) in build + test; zod added to functions.
- ✅ **Consolidated create path** — `functions/src/lib/poolCreation.ts` core; all three
  create callables route through it (schema gate, deny-BANNED w/ legacy+new roles, free
  billing, uniform side-effect bundle). Bracket now transactional + gains managedPools.
- ✅ **`POOL_CREATED` activity writer** — new, in the side-effect bundle (§2).
- ✅ **Publish op** — `publishBracketPool` already owns slug reservation / password hash /
  lockAt / DRAFT→OPEN; kept as-is (only bracket has draft→publish; a `publishPool` rename
  is cosmetic, deferred).

- ✅ **`updatePoolSettings` callable + editability matrix** — `shared/editability.ts`
  (matrix grounded in real dashboard affordances) + `functions/src/lib/poolUpdate.ts`
  (pure gate + handle reconciliation) + the callable. Locked pools freeze structural
  money fields; unknown/phase-locked keys rejected. 9 unit tests.

Phase A CODE complete. Remaining is env-dependent verification + minor follow-ups:
- **Emulator tests** (plan-mandated, pre-merge): per-type create side-effect bundle
  (pool doc, managedPools, participations[NFL], POOL_CREATED activity, role upgrade),
  slug/publish, updatePoolSettings phase boundaries incl. negative cases. Needs the
  Firestore emulator.
- **Playwright** (Phase B, pre-merge): one create per type + Playoff/Props edit + a
  negative locked-edit case.
- **Deploy dry-run** of the predeploy copy (`firebase deploy --only functions`) — locally
  validated (build+test green), not yet run against the live project.
- **Per-value validation** on edit (updatePoolSettings) — reuse the create sub-schemas to
  validate edited payouts/settings values (currently gates WHICH fields, not their values).
- **`settings/billing_config` unification** — DEFERRED / off critical path: with
  free-default billing, `enforceBillingStatus` (reads `config/billing_config`) never
  touches new pools. Fold into a later billing cleanup.
- **`publishPool` rename** (cosmetic) + deleting the create-callable delegates — Phase B,
  after the wizards migrate onto the shell.
