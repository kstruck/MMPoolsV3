# Plan: Unified Create-Pool Wizard framework

_Locked via grill-with-docs — by Claude + Kevin, 2026-07-03. Terms per CONTEXT.md. Revised after Codex rounds 1–2._

## Goal

Replace the five divergent pool-creation wizards (Squares `SetupWizard`, `BracketWizard`, `PlayoffWizard`, `PropsWizard`, `NFLPoolWizard`) with one shared wizard framework so every Commissioner gets the same creation experience regardless of Pool type: same step rhythm, same Entry Fee and Payment Handle collection, same Billing presentation, draft resilience, and one consolidated, schema-validated server-side creation path with a uniform side-effect bundle (pool audit + `POOL_CREATED` Activity Log + user pool indexes).

## Current state (verified)

- All wizards already create via Cloud Functions: Squares/Playoff/Props → `createPool` (functions/src/poolOps.ts), NFL → `createNFLPool`, Bracket → `createBracketPool`. Firestore rules already deny client `pools` creates except `sim-*` slugs (firestore.rules:87).
- The three callables have divergent validation, lifecycle statuses, side effects, and billing stamping (NFL precomputes tier/maxPlayers client-side, NFLPoolWizard.tsx:282-287).
- Pool-type enum in live use: `SQUARES`, `BRACKET`, `NFL_PLAYOFFS`, `PROPS`, `NFL_PICKEM`, `NFL_SURVIVOR`, `NFL_MARGIN`. Confidence is `settings.confidenceMode` on `NFL_PICKEM`, not a type.
- Legacy role values `POOL_MANAGER`/`PARTICIPANT` still live in claims/docs alongside the renamed `COMMISSIONER`/`MEMBER`.
- Two billing-config authorities exist: `enforceBillingStatus` reads `config/billing_config`; wizard UI/admin/Stripe read `settings/billing_config`.
- `slug` vs `urlSlug` dual fields are wired into share links and lookups.
- Lifecycle differs per type: Squares creates `DRAFT`; Bracket drafts then publishes `OPEN`; Props uses `active|archived`; NFL creates `OPEN`. Rules treat only `DRAFT|OPEN` as editable.
- Paid state is per-domain: `Square.isPaid`, `PlayoffEntry.paid`, `BracketEntry/NFLEntry.paidStatus`, `PropCard.isPaid`.

## Approach

### Phase A — server consolidation (lands first, behind existing UIs)

1. **Shared schemas (`shared/schemas/`)** — `CreatePoolInput` zod schema per pool type (existing enum above; confidence stays a Pick'em setting), built from common sub-schemas: `basics`, `entryFee` + `paymentHandles` (canonical set: Venmo, Zelle, CashApp, PayPal, Google Pay; stored nested `paymentHandles`, dual-written to legacy top-level fields during migration), `payouts`, `branding`, reminders as per-type shapes (shared UI, per-type persistence adapters — no canonical persisted reminder shape). Schemas describe create *input* only — never stored-doc shapes. Companion in-scope deliverables: per-type `UpdatePoolSettings` schemas (subset of create input, gated by the editability matrix below). Packaging: predeploy copy (item 6).
2. **Consolidate the three create callables** — one `createPool` implementation (per ADR 0001, revised): validate against the type's `CreatePoolInput` schema; authorize accepting both new and legacy role values (`COMMISSIONER|POOL_MANAGER|SUPER_ADMIN`, deny `BANNED`) from claim with user-doc fallback; enforce slug uniqueness with dual `slug`/`urlSlug` read-compat; stamp ALL billing fields server-side (tier, price, trialEndsAt, maxPlayersAllowed — removes NFL client precompute); apply per-type lifecycle config (initial status per type preserved: Squares `DRAFT`, Bracket draft→publish `OPEN`, Props `active`, NFL `OPEN`). **Contract compat:** the unified implementation accepts BOTH the current flat payloads (existing `dbService.createPool` callers) and the new `{ type, config }` envelope until all wizards migrate in Phase B; `createBracketPool`/`createNFLPool` become thin delegates, deleted once wizards migrate.
   - **`publishPool` operation** — Bracket's draft→publish is a distinct server op (successor to `publishBracketPool`, functions/src/bracketPools.ts:112-187). It — not `createPool` — owns `slugs/{slug}` reservation, `slugLower`, pool-password hashing, `lockAt` derivation, and the `DRAFT`→`OPEN` transition. Single-shot types get the same fields stamped inside `createPool` via the same shared helper so logic isn't duplicated.
   - **`updatePoolSettings` callable** — in scope (round 2 reversal): big-bang deletes the old wizards, so Playoff/Props edit flows must land on the shell, which needs a validated server update path. Per-type `UpdatePoolSettings` zod schema validated against a **per-type editability matrix** — each pool type declares which fields are editable in which of ITS lifecycle states (Squares `DRAFT|OPEN`, Bracket draft vs published, Props `active`, NFL pre-lock), replacing any single `OPEN`-named rule. Same role/ownership checks as create; replaces the rules-gated `dbService.updatePool` client path for wizard-editable pool settings only. Rules tightening deferred: other direct `updatePool` consumers (dashboards, SuperAdmin, simulators — see Risks) keep the existing rule surface until a follow-up migrates them.
3. **Unify billing-config authority** — single doc path `settings/billing_config`; migrate `enforceBillingStatus` (functions/src/billing.ts:39) off `config/billing_config`; one-off copy + delete of the stale doc.
4. **Shared side-effect bundle** — one server helper emitting, atomically with pool creation: pool audit entry (existing `audit.ts` writers), `POOL_CREATED` in `users/{uid}/activity` (new — CONTEXT.md documents it but no writer exists today), `users/{uid}/managedPools` index, AND the existing per-type owner indexes preserved: NFL's owner `participations` write (functions/src/nflPools.ts:99-104) and Bracket's owner `joinedPools` write (functions/src/bracketPools.ts:237-242). Pre-work task: repo-wide audit of every create-time owner index; any candidate for retirement needs proof nothing reads it — default is preserve. Emulator tests assert each artifact per type.
5. **Payment-handle adapter** — one shared read/write module (`shared/paymentHandles.ts`) mapping between canonical nested `paymentHandles` and legacy top-level fields, used by EVERY path that touches handles: `createPool`, `updatePoolSettings`, dashboards' display/edit (PoolRoute.tsx:527, PlayoffDashboard.tsx:464, BracketPoolDashboard.tsx:126/342/1351), and UserProfile prefill (UserProfile.tsx:516). Dual-write on mutate, nested-first read with top-level fallback — prevents immediate drift of the canonical shape. **Google Pay goes end-to-end** (decided round 4): functions types already carry `googlePay` (functions/src/types.ts:482/614) and Props collects it today; this branch adds it to the client shared types, the adapter, StepFeeAndPayment, UserProfile prefill, and the adapter-backed display surfaces (StatusCard, PoolRoute), with tests — dropping it would regress Props.
6. **Schema packaging: predeploy copy (decided)** — a `predeploy` step in firebase.json copies `shared/` into `functions/src/shared/` before `npm --prefix functions run build` (mirroring the existing predeploy hook at firebase.json:12-14); `src/` imports `shared/` directly via tsconfig path alias. Boring over clever; npm workspaces with Firebase deploy on Windows rejected as fiddlier.

### Phase B — shared wizard UI (same branch, after A)

7. **`WizardShell` component** — owns react-hook-form instance (zodResolver on the type's `CreatePoolInput` schema for create mode, `UpdatePoolSettings` schema for edit mode), progress indicator, back/next, jump-to-completed-step navigation, error display, TOS gate on final step, single brand theme (indigo). Props: `poolType`, `steps[]`, `initialValues` (edit/clone/embedded seeding), `mode: 'create' | 'edit'`, `embedded`. Per-type lifecycle config drives final CTA (Launch vs Save Draft + Publish for Bracket). Edit mode submits via `updatePoolSettings`; fields outside the type's editability matrix render read-only.
8. **Draft autosave** — localStorage keyed `{uid}:{type}:{mode}:{seedId|none}` (debounced); auto-resume suppressed when a clone/embed seed exists unless user explicitly picks the draft; Resume/Discard prompt on mount; cleared on successful launch; edit mode skips drafts. **Multi-tab:** each tab writes a session token + timestamp with the draft; a `storage`-event listener detects a foreign token overwriting the same key and shows a persistent "this draft is open in another tab — changes here may be lost" warning. No hard lock (accepted).
9. **Shared step components** (RHF-wired): `StepBasics`, `StepFeeAndPayment` (Entry Fee → when > $0 reveal handle set + instructions, via the payment-handle adapter; Paid-Status-tracking toggle), `StepPayouts`, `StepBranding`, `StepReminders` (shared UI, per-type adapter), `StepReview` (summary + TOS + `BillingInvoiceCard` w/ coupon for ALL types; launch stays free-trial; post-launch "upgrade now" → Stripe `createCheckoutSession`).
10. **Step canon** — 1 Basics → 2 Type-specific slot (1–2 sub-steps) → 3 Fee & Payment → 4 Payouts → 5 Branding → 6 Reminders → 7 Review. "Advanced" settings collapse into accordions.
11. **Paid-tracking: manager-facing API only** — one client-side accessor/mutator interface over the existing per-domain fields (`isPaid`/`paid`/`paidStatus`); no doc-shape migration, no backfill.
12. **Migration (big bang, one branch `feat/wizard-unification`)** — all five wizards rebuilt on the shell; old wizards + dead root-level `WizardStep*.tsx` duplicates deleted same branch. Preserve: Playoff/Props edit modes (now via shell edit mode + `updatePoolSettings`), NFL `?cloneFrom`, Props `embedded`/`initialData`, NFL premium flags + estimated-players input (type slot).
13. **Routes** — `/create/:type` formalized; every route wraps its wizard in the existing `PoolTypeGate` (src/components/PoolTypeGate.tsx) and preserves CreatePoolSelection's seasonal/offseason availability rules at route level, so deep links can't bypass availability. `CreatePoolSelection` links to the routes.

### Verification

14. Schema round-trip tests: each type's `CreatePoolInput` accepts current wizard payload shapes; `UpdatePoolSettings` rejects fields outside the type's editability matrix. Callable emulator tests: legacy+new role auth, legacy flat payload + new envelope both accepted, slug collision (both fields), billing stamping, lifecycle status per type, publish op (slug reservation, password hash, DRAFT→OPEN), side-effect bundle artifacts per type (incl. NFL `participations`, Bracket `joinedPools`), and `updatePoolSettings` across each type/state boundary of the editability matrix — including negative cases: NFL post-lock denial, Bracket published-field denial, Props archived denial. Playwright: one full create run per pool type; Bracket also exercises draft→publish; edit-mode runs for Playoff AND Props; one negative UI case (attempt edit of a locked/published field, expect read-only/rejection).

## Key decisions & tradeoffs

- **Consolidate three existing callables into one** — [ADR 0001](docs/adr/0001-unified-createpool-callable.md) (revised: the win is uniform validation/billing/side-effects, not closing a client-write hole — that hole is already closed).
- **react-hook-form + zod** (new deps) — Kevin chose full stack; accepts step-component rewrite cost.
- **Big bang, sequenced** — Kevin locked one branch. Codex pushed staged rollout; rejected as a branch strategy, adopted as ordering: Phase A lands behind existing UIs first within the branch, so server hardening is independently revertable.
- **Billing trial-default** — pricing in every Review via `BillingInvoiceCard`; checkout post-launch, optional.
- **Player money stays P2P** — Paid Status bookkeeping API only.
- **One brand theme** — indigo; type identity via header icon/title.

## Risks / open questions

- Consumers of `createBracketPool`/`createNFLPool`/`publishBracketPool` beyond the wizards (re-run CTA, admin GameOps) must be audited before deleting delegates.
- `updatePoolSettings` scope add (round 2) grows the branch — its per-type editability matrix (fields × that type's lifecycle states) needs definition during Phase A schema work, informed by what the current dashboards actually let commissioners change.
- Direct `dbService.updatePool` survives OUTSIDE wizard settings: dashboards (PlayoffDashboard.tsx:544, PropsManager.tsx:112, NFLManagerView.tsx:243), SuperAdmin.tsx:763/863, and test simulators (playoffSimulator.ts, propsSimulator.ts) all mutate pools directly. This branch migrates only the wizard settings path; those consumers keep the existing rule surface, and Firestore `pools` update rules are NOT tightened until a follow-up enumerates/migrates each one. Pre-work: inventory of every direct `updatePool` call site checked into the branch.
- `settings/billing_config` migration touches the daily enforcement job — verify with emulator before deploy; stale `config/billing_config` readers besides billing.ts must be grepped.
- Dashboards/readers must keep tolerating legacy pools untouched by this project (no doc migration).
- Predeploy copy of shared/ must be verified in CI: a deploy-dry-run task confirms functions build contains the copied schemas and src/ alias resolves in vite build.
- New `POOL_CREATED` activity writer adds a per-create write — negligible volume, but include in emulator cost sanity check.

## Out of scope

- In-app player payments (Stripe checkout for Entry Fees).
- Doc-shape migration or backfill of paid status, reminders, or `slug`/`urlSlug` normalization (dual-compat only).
- Post-creation dashboards, pool pages, admin panel wizard system.
- Billing tier/pricing/coupon logic changes (only the config doc-path unification).
