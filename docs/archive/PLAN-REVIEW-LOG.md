# Plan Review Log: Unified Create-Pool Wizard framework

Act 1 (grill-with-docs) complete — plan locked at PLAN-WIZARD-UNIFICATION.md (PLAN.md is the pre-existing master roadmap, left untouched). CONTEXT.md updated (Entry Fee, Payment Handle, Paid Status, Billing, Pool Draft), ADR 0001 created. MAX_ROUNDS=5.

## Round 1 — Codex

**Findings**
1. The core premise is stale: the four non-bracket wizards are not direct client writes anymore, they already call Cloud Functions (`src/services/dbService.ts:83-89`, `src/components/SetupWizard.tsx:271`, `src/components/PlayoffPool/PlayoffWizard.tsx:429`, `src/components/PropsWizard/PropsWizard.tsx:162`), and Firestore already blocks client `pools` creates except sim docs (`firestore.rules:86-87`), so `PLAN-WIZARD-UNIFICATION.md:12` is scoped at a problem that mostly no longer exists. Fix: rebase the plan/ADR around unifying the existing callables (`createPool`, `createBracketPool`, `createNFLPool`), not removing a nonexistent direct-write path.

2. “One zod schema per Pool type” is the wrong abstraction if that same schema is used for both RHF form state and persisted docs (`PLAN-WIZARD-UNIFICATION.md:11,20`): stored pools contain server-only fields, lifecycle state, and legacy shapes that are not valid create input (`src/types/index.ts:389-405`, `src/types/index.ts:657-749`, `src/types/nflPoolTypes.ts:36-86`). Fix: split this into `CreatePoolInput`, `StoredPoolDoc`, and `UpdatePoolSettings` schemas with explicit transforms.

3. The planned type taxonomy is wrong for this repo: `CONFIDENCE` is not a pool type here, it is `settings.confidenceMode` on `NFL_PICKEM`, and the live flags/pricing/routes expect `NFL_PICKEM`, `NFL_SURVIVOR`, and `NFL_MARGIN` (`PLAN-WIZARD-UNIFICATION.md:11`, `src/components/CreatePoolSelection.tsx:39-43`, `src/types/nflPoolTypes.ts:52-60`, `functions/src/stripe.ts:107-114`). Fix: keep the existing pool-type enum as the canonical contract and model confidence as a Pick’em setting.

4. The role gate will break real users if implemented literally: the plan/ADR say `COMMISSIONER`/`SUPER_ADMIN` only (`PLAN-WIZARD-UNIFICATION.md:12`, `docs/adr/0001-unified-createpool-callable.md:19`), but the live code still reads and writes `POOL_MANAGER`/`PARTICIPANT` (`src/types/index.ts:515`, `functions/src/poolOps.ts:115-123`, `functions/src/nflPools.ts:80-88`). Fix: accept old and new role values from both claim and user doc until a full claim/doc migration is complete.

5. The security story stops at create, but the shared shell explicitly includes edit mode (`PLAN-WIZARD-UNIFICATION.md:13,18`), and current Playoff/Props edits still go through direct client updates (`src/components/PlayoffPool/PlayoffWizard.tsx:408-425`, `src/components/PropsWizard/PropsWizard.tsx:130-133`, `src/services/dbService.ts:98-106`). Fix: add a validated `updatePoolSettings` callable or explicitly scope edit/embedded flows out of this project.

6. The plan ignores the live `slug` vs `urlSlug` split, which is already wired into share links and lookups (`PLAN-WIZARD-UNIFICATION.md:11-12`, `src/services/poolRepository.ts:12-18`, `functions/src/joinPreview.ts:11-19`, `functions/src/invites.ts:102-104`, `src/services/dbService.ts:679`). Fix: either keep dual-read/write compatibility during migration or normalize to one field only after patching every resolver/query/rule.

7. “Common reminders schema” is not compatible with the current data model: Squares/Props use nested `payment/lock/winner`, while Bracket/Playoff use flat `auto24h/auto1h/autoLock` flags (`PLAN-WIZARD-UNIFICATION.md:11,15-16`, `src/types/index.ts:100-107`, `src/types/index.ts:452-472`, `src/components/SetupWizard.tsx:69-73`, `src/components/BracketWizard/BracketWizard.tsx:92-99`, `src/components/PlayoffPool/PlayoffWizard.tsx:174-180`). Fix: share UI components and adapters, not one canonical persisted reminder shape.

8. The shell assumes more lifecycle uniformity than the repo has: Squares create `DRAFT`, Bracket drafts then publishes `OPEN`, Props uses `active|archived`, NFL creates `OPEN`, and rules only treat `DRAFT|OPEN` as editable (`PLAN-WIZARD-UNIFICATION.md:13,18`, `functions/src/poolOps.ts:78-88`, `functions/src/bracketPools.ts:66-69,175-183`, `src/components/PropsWizard/PropsWizard.tsx:139-145`, `functions/src/nflPools.ts:58-68`, `firestore.rules:63-65`). Fix: define per-type lifecycle adapters before sharing create and edit shells.

9. The billing section assumes one authority, but the repo has two: `enforceBillingStatus` reads `config/billing_config` while the wizard UI, admin panel, and Stripe checkout read `settings/billing_config`, and NFL create still precomputes tier/maxPlayers on the client (`PLAN-WIZARD-UNIFICATION.md:12,27`, `functions/src/billing.ts:39`, `src/components/billing/BillingInvoiceCard.tsx:177-207`, `functions/src/stripe.ts:89-120`, `src/components/NFLPoolWizard/NFLPoolWizard.tsx:282-287`). Fix: pick one billing-config document path and move all tier/maxPlayers stamping fully server-side first.

10. “One field shape across all Pool types for per-entry Paid Status” is oversold: paid state currently lives as `Square.isPaid`, `PlayoffEntry.paid`, `BracketEntry/NFLEntry.paidStatus`, and `PropCard.isPaid` (`PLAN-WIZARD-UNIFICATION.md:17`, `src/types/index.ts:225-240`, `src/types/index.ts:305-316`, `src/types/index.ts:758-767`, `src/types/nflPoolTypes.ts:175-221`). Fix: standardize the manager-facing API first and ship explicit read-compat/backfill rules per domain model.

11. The draft-resume design has a collision/race bug: a single `{uid}:{poolType}` key (`PLAN-WIZARD-UNIFICATION.md:14`) means two tabs of the same wizard stomp each other, and stale drafts can override `cloneFrom` or embedded seed data (`src/components/NFLPoolWizard/NFLPoolWizard.tsx:87-169`, `src/components/PropsWizard/PropsWizard.tsx:12-18,43-46`). Fix: namespace drafts by context (`uid:type:mode:seedId`) and suppress auto-resume when clone/embed seeds exist unless the user explicitly chooses them.

12. Observability is under-specified: the plan promises a `POOL_CREATED` Activity Log write (`PLAN-WIZARD-UNIFICATION.md:7,12,20`), but the repo has pool-audit writers and no shared `users/{uid}/activity` writer at all (`CONTEXT.md:18-33`, `functions/src/audit.ts:20-60`, `functions/src/bracketPools.ts:96-104`, `functions/src/nflPools.ts:108-116`). Fix: define one shared side-effect bundle for pool audit, user activity, and any required user indexes, then assert each artifact in emulator tests.

13. The big-bang rollout is the wrong risk tradeoff for the stated goal: the main safety win is server-side and can land independently of the UI rewrite (`PLAN-WIZARD-UNIFICATION.md:18,26,33`). Fix: ship callable/schema hardening first behind the existing UIs, then migrate one wizard at a time onto the shell behind feature flags.

**Open Questions**
- Does Bracket stay a draft-then-publish flow, or is the plan intentionally collapsing that into one “Launch” action?
- Are `users/{uid}/managedPools` and `users/{uid}/participations` still required side effects, or are those indexes being retired?
- Is the intended canonical payment-handle storage top-level fields, nested `paymentHandles`, or both during migration?

VERDICT: REVISE
### Claude's response (round 1)

Accepted 1-12, rejected 13's branch-strategy change:

- **1 (stale premise)**: VERIFIED and accepted — dbService.createPool calls the `createPool` callable (dbService.ts:85), rules deny client creates (firestore.rules:87). Plan + ADR 0001 rewritten: goal is consolidating three divergent callables (validation/billing/side-effects), not closing a client-write hole. My original exploration report was wrong; Codex caught it.
- **2**: Accepted — schemas scoped to `CreatePoolInput` only; StoredPoolDoc/UpdatePoolSettings explicitly separate (update schema deferred).
- **3**: Accepted — existing enum canonical (NFL_PICKEM/NFL_SURVIVOR/NFL_MARGIN); confidence stays a Pick'em setting.
- **4**: Accepted — dual role acceptance (new + legacy) from claim with doc fallback.
- **5**: Accepted via scoping — edit mode keeps existing rules-gated client update path; `updatePoolSettings` callable is a logged follow-up, out of scope.
- **6**: Accepted — slug/urlSlug dual-compat during migration; normalization out of scope.
- **7**: Accepted — shared reminders UI + per-type persistence adapters; no canonical persisted shape.
- **8**: Accepted — per-type lifecycle config in the callable and shell (drives Launch vs draft→publish CTA).
- **9**: Accepted — `settings/billing_config` becomes sole authority; enforceBillingStatus migrates; all billing stamping server-side (kills NFL client tier precompute).
- **10**: Accepted via scoping — manager-facing paid-status API over existing per-domain fields; no doc migration/backfill.
- **11**: Accepted — draft key `{uid}:{type}:{mode}:{seedId|none}`; auto-resume suppressed when seed present.
- **12**: Accepted — shared side-effect bundle (pool audit + new POOL_CREATED activity writer + managedPools index), each asserted in emulator tests.
- **13 (staged rollout)**: REJECTED as branch strategy — Kevin explicitly locked big bang in Act 1. Adopted as sequencing: Phase A (server) lands behind existing UIs first within the branch, independently revertable.

Open questions answered in plan: Bracket keeps draft→publish; managedPools index kept (in side-effect bundle); payment handles stored nested with legacy top-level dual-write.

## Round 2 — Codex

**Findings**
1. The Bracket draft→publish path is still not designed end-to-end: the plan says one `createPool({ type, config })` implementation, preserves Bracket draft→publish, and tests draft→publish, but it never specifies whether `publishBracketPool` survives or how its current slug reservation, `slugLower`, password hashing, and `lockAt` derivation are unified (`PLAN-WIZARD-UNIFICATION.md:25,31,41`; `functions/src/bracketPools.ts:112-187`). Fix: explicitly define a second `publishPool`/`publishBracketPool` server operation and make it the owner of `slugs/{slug}`, `slugLower`, password hashing, and draft→OPEN transition.

2. Phase A cannot actually “land first, behind existing UIs” if the canonical callable contract changes to `createPool({ type, config })`: the current callers still send flat payloads to `createPool`, while Bracket and NFL still call separate functions (`docs/adr/0001-unified-createpool-callable.md:24-32`; `src/services/dbService.ts:83-89`; `src/components/SetupWizard.tsx:271`; `src/components/PlayoffPool/PlayoffWizard.tsx:429`; `src/components/PropsWizard/PropsWizard.tsx:162`). Fix: make the unified implementation accept both legacy flat payloads and the new `{ type, config }` envelope until every caller is migrated.

3. Edit mode is still internally inconsistent: `WizardShell` is defined with `mode: 'edit'`, but the plan explicitly defers `UpdatePoolSettings` schema/hardening and keeps Playoff/Props edits on the old rules-gated client update path, while the shell resolver is the create-input schema (`PLAN-WIZARD-UNIFICATION.md:24,31,36,63-64`). Fix: either cut edit mode from this project or add a separate update schema/path before putting edit flows on the shared shell.

4. The draft-autosave design still accepts silent data loss: `{uid}:{type}:{mode}:{seedId|none}` plus “last-write-wins accepted” means two same-context tabs can overwrite each other with no warning (`PLAN-WIZARD-UNIFICATION.md:32`). Fix: add a per-tab instance ID and conflict prompt, or disable autosave when another live tab owns the same draft context.

5. The payment-handle migration is still only half-specified: the plan makes nested `paymentHandles` canonical and dual-writes top-level fields on create, but current readers and editors are asymmetric, and existing edit paths mutate top-level fields only, so the new canonical nested values will drift immediately (`PLAN-WIZARD-UNIFICATION.md:24,33,36`; `src/components/routes/PoolRoute.tsx:527-530`; `src/components/PlayoffPool/PlayoffDashboard.tsx:464-488`; `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:126-145,342-345,1351-1354`; `src/components/UserProfile.tsx:56-58,516-530`). Fix: define one read/write adapter for payment handles across create, edit, display, and profile-prefill paths before declaring a canonical storage shape.

6. The shared-schema packaging dependency is still left undecided even though Phase A depends on it, and the current deploy only builds `functions/` (`PLAN-WIZARD-UNIFICATION.md:24,57`; `firebase.json:12-14`). Fix: choose `npm` workspace or predeploy-copy now and add the exact build/deploy changes to the plan.

7. The new `/create/:type` routes are missing an explicit route-level availability gate: the repo already has `PoolTypeGate`, and the current selection page also applies seasonal/offseason availability, but the revised plan only says “formalize `/create/:type`” (`PLAN-WIZARD-UNIFICATION.md:37`; `src/components/PoolTypeGate.tsx:8-24`; `src/components/CreatePoolSelection.tsx:37-43,207-263`). Fix: require every new create route to wrap the wizard in `PoolTypeGate` and preserve the existing seasonal availability rules at route level.

Most of the first-round objections are now fixed: the revised plan no longer invents a client-write hole, uses the real pool-type enum, handles legacy role values, acknowledges per-type reminder/lifecycle differences, and correctly calls out the split billing-config authority.

VERDICT: REVISE
### Claude's response (round 2)

Accepted all 7:

- **1 (publish op)**: `publishPool` defined as distinct server op owning slugs/{slug} reservation, slugLower, password hashing, lockAt, DRAFT→OPEN; shared helper reused by createPool for single-shot types.
- **2 (contract compat)**: unified createPool accepts legacy flat payloads AND { type, config } envelope until Phase B migrates callers.
- **3 (edit mode)**: REVERSED my round-1 deferral — Codex right that big-bang wizard deletion makes it inconsistent. `updatePoolSettings` callable + per-type UpdatePoolSettings schema (editable-while-OPEN allowlist) now in scope; shell edit mode uses it; non-editable steps read-only.
- **4 (draft tabs)**: lightweight guard — per-tab session token + storage-event listener → visible cross-tab warning. Hard lock rejected (over-engineering for localStorage drafts); silent loss eliminated, which was the actual complaint.
- **5 (handle adapter)**: shared/paymentHandles.ts adapter used by create, update, dashboards, profile prefill; dual-write, nested-first read.
- **6 (packaging)**: DECIDED — predeploy copy of shared/ into functions/src/shared/ (mirrors existing firebase.json predeploy hook); tsconfig alias for src/. Workspaces rejected (Windows + Firebase deploy friction).
- **7 (route gate)**: every /create/:type route wraps wizard in PoolTypeGate + preserves seasonal availability; deep links can't bypass.

## Round 3 — Codex

**Findings**
1. The “uniform side-effect bundle” still looks lossy: it only guarantees pool audit + `users/{uid}/activity` + `users/{uid}/managedPools` (`PLAN-WIZARD-UNIFICATION.md:29`), but current NFL create also writes owner `participations` (`functions/src/nflPools.ts:99-104`) and current Bracket create writes owner `joinedPools` explicitly “to query my pools efficiently and check permissions” (`functions/src/bracketPools.ts:237-242`). Fix: audit every create-time owner index and either preserve per-type `participations`/`joinedPools` in the shared helper or explicitly retire them with repo-wide proof nothing reads them.

2. `UpdatePoolSettings` is still internally contradictory: the schema section says it is deferred/out of scope (`PLAN-WIZARD-UNIFICATION.md:24`), but the callable and shell make it in scope (`PLAN-WIZARD-UNIFICATION.md:27,35`). Fix: rewrite item 1 so `UpdatePoolSettings` schemas are explicitly in-scope companion deliverables, not deferred.

3. The editability contract still uses the wrong lifecycle language: `updatePoolSettings` is framed as an editable-while-`OPEN` allowlist (`PLAN-WIZARD-UNIFICATION.md:27`), even though the same plan says Props live in `active|archived` and Bracket has draft/publish semantics (`PLAN-WIZARD-UNIFICATION.md:17,35`). Fix: define editability as a per-type lifecycle matrix, not an `OPEN`-named rule.

4. Packaging is still contradictory: the plan decides predeploy copy (`PLAN-WIZARD-UNIFICATION.md:31`) but still says “npm workspace or predeploy copy — resolve at setup” (`PLAN-WIZARD-UNIFICATION.md:24,62`), and ADR 0001 still repeats the undecided packaging (`docs/adr/0001-unified-createpool-callable.md:43`). Fix: make predeploy copy the only documented packaging path everywhere and replace the old “decide at setup” text with concrete predeploy verification tasks.

5. The accepted ADR still does not describe the surface the plan now depends on: ADR 0001 records only one `createPool({ type, config })` callable (`docs/adr/0001-unified-createpool-callable.md:24-32`), while the plan now depends on legacy flat-payload compatibility plus companion `publishPool` and `updatePoolSettings` operations (`PLAN-WIZARD-UNIFICATION.md:25-27`). Fix: revise ADR 0001 so the accepted decision matches the actual callable contract and companion ops this branch will implement.

Most of the earlier structural objections are now closed; what remains is spec coherence plus one real side-effect regression risk.

VERDICT: REVISE
### Claude's response (round 3)

Accepted all 5:

- **1 (owner indexes)**: side-effect bundle now preserves NFL owner `participations` + Bracket owner `joinedPools`; repo-wide create-time index audit added as pre-work, default preserve.
- **2**: item 1 contradiction fixed — UpdatePoolSettings schemas are explicit in-scope companion deliverables.
- **3**: editable-while-OPEN replaced by per-type editability matrix (fields × that type's lifecycle states).
- **4**: predeploy copy is the only documented packaging path (plan item 6, risks now a CI verification task, ADR updated).
- **5**: ADR 0001 rewritten to the real contract: createPool (dual payload) + publishPool + updatePoolSettings companions, side-effect bundle incl. per-type indexes, predeploy packaging.

## Round 4 — Codex

**Findings**
1. The plan still contradicts itself once on editability: the main sections use a per-type editability matrix, but the Risks section still says “editable-while-`OPEN` allowlist” (`PLAN-WIZARD-UNIFICATION.md:27,35,59`), which is the old model and invites the wrong schema/tests. Fix: rewrite that risk to “per-type editability matrix by lifecycle state” and remove `OPEN` terminology completely.

2. `updatePoolSettings` still does not close the migration boundary for pool writes: the plan tightens rules and replaces `dbService.updatePool` only for pool settings (`PLAN-WIZARD-UNIFICATION.md:27,69`), but the repo still uses that direct update path in manager/admin/simulator flows (`src/services/dbService.ts:98-102`, `src/components/PlayoffPool/PlayoffDashboard.tsx:544`, `src/components/Props/PropsManager.tsx:112`, `src/components/NFLPoolDashboard/NFLManagerView.tsx:243`, `src/components/SuperAdmin.tsx:763,863`, `src/utils/testing/simulators/playoffSimulator.ts:144,192`, `src/utils/testing/simulators/propsSimulator.ts:135,171`). Fix: enumerate every surviving direct `updatePool` use case and either preserve its rule surface explicitly or migrate it to dedicated server ops before tightening `pools` updates.

3. The canonical payment-handle set still overreaches the repo: the plan standardizes `Google Pay` alongside Venmo/Zelle/CashApp/PayPal (`PLAN-WIZARD-UNIFICATION.md:24`), but the client types and major UI surfaces are inconsistent or missing it (`src/types/index.ts:183-187,528-530`, `src/components/UserProfile.tsx:56-58,516-530`, `src/components/StatusCard.tsx:185-206`, `src/components/routes/PoolRoute.tsx:527-530`), while functions types already include `googlePay` (`functions/src/types.ts:482-485,614-617`). Fix: either drop `Google Pay` from the canonical set for this branch or add it end-to-end across shared types, adapter, profile/edit/display UIs, and tests.

4. The verification plan is still too thin for the new editability matrix: one Playoff edit-mode Playwright run (`PLAN-WIZARD-UNIFICATION.md:45`) does not cover Props edit, Bracket draft-vs-published behavior, NFL pre-lock denial, or locked-state rejection paths. Fix: add emulator tests for `updatePoolSettings` across each type/state boundary and at least UI coverage for Props edit plus one negative locked/published edit case.

VERDICT: REVISE
### Claude's response (round 4)

Accepted all 4:

- **1**: Risks wording fixed — per-type editability matrix, `OPEN` terminology removed.
- **2**: Direct `updatePool` consumers enumerated in Risks (dashboards, SuperAdmin, simulators); rules tightening explicitly DEFERRED until a follow-up migrates them; call-site inventory added as pre-work. This branch migrates only wizard settings edits.
- **3**: Google Pay kept canonical, end-to-end (client types, adapter, StepFeeAndPayment, profile prefill, adapter-backed displays, tests) — functions types already carry it and Props collects it; dropping = regression.
- **4**: Verification widened — emulator tests across every type/state boundary of the editability matrix incl. three named negative cases; Playwright edit runs for Playoff AND Props + one negative locked-edit UI case.

## Round 5 — Codex

No new plan-blocking flaws surfaced in this revision. The prior blockers are now addressed in a way that matches the repo: the wizard-only `updatePoolSettings` boundary is explicit, Firestore rule tightening is correctly deferred until the remaining direct `updatePool` consumers are migrated, Google Pay is now intentional end-to-end rather than half-in/half-out, and the verification section finally covers the state-matrix negative cases that mattered.

What remains is execution discipline, not plan design: actually define the per-type editability matrix during schema work, complete the promised inventory of surviving direct `updatePool` call sites before any rule changes, and do not let the widened emulator/UI coverage get cut later in the branch.

VERDICT: APPROVED
---
Converged: APPROVED on round 5 of 5. No code written during either act.
