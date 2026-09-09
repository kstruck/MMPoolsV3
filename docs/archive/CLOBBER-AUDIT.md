# Clobber Audit (Step 0) — feat/superadmin-restore

Baseline: `main` @ 77b51ae. Method: diff each overhaul commit's file set against main;
check whether the commit's signature change survived.

## T3 — real health card + delete fake cards (`c7f0da2`)
| File | State | Evidence |
|------|-------|----------|
| `functions/src/adminHealth.ts` | ✅ SURVIVED | file exists, `getAdminHealthSnapshot` exported |
| `SuperAdminBentoDashboard.tsx` (fake-card deletion) | ❌ REVERTED | 3 fake-card strings present again |
**Restore:** delete Security Audit / Database Migration Tools / Automation Test Suite cards from the
brand-styled bento; keep surviving health card. Backend done.

## T7 — Operations tab + audit (`ed44d0d` foundation, `6c382cf` consolidation)
| File | State | Evidence |
|------|-------|----------|
| `functions/src/lib/adminAudit.ts` | ✅ SURVIVED | exists |
| `src/components/admin/AdminAuditViewer.tsx` | ✅ SURVIVED | exists |
| `src/components/admin/ConfirmActionModal.tsx` | ✅ SURVIVED | exists |
| `functions/src/backfill.ts`, `userManagement.ts` | ✅ SURVIVED | exist |
| `functions/src/adminOps.ts` | ❌ REVERTED | missing |
| `src/components/admin/OperationsPanel.tsx` | ❌ REVERTED | missing |
| `logAdminAction` export + Operations tab | ❌ REVERTED | 0 in index.ts |
**Restore:** `adminOps.ts` (+export) and `OperationsPanel.tsx` from `6c382cf`; re-register tab. The
audit foundation (viewer, modal, lib) survived — reuse as-is.

## T6 — 5-role model + setUserRole (`44666d6`) — FULLY REVERTED
| File | State | Evidence |
|------|-------|----------|
| `functions/src/lib/roles.ts` | ❌ REVERTED | missing |
| `src/utils/roles.ts` | ❌ REVERTED | missing |
| `tests/roles-parity.test.ts` | ❌ REVERTED | missing |
| `setUserRole` in `adminClaims.ts` (+export) | ❌ REVERTED | 0 in index.ts; adminClaims exports only setSuperAdminClaim/syncMyClaims |
| `systemGuards.ts` assertNotBanned hunk | ❌ REVERTED | main has assertPoolCreationAllowed/assertNotMaintenance only, no assertNotBanned |
| Write-path sweep (see below) | ❌ REVERTED | all legacy strings back |
| Role UI in `SuperAdmin.tsx` | ❌ REVERTED | no setUserRole/MODERATOR/COMMISSIONER refs |

### Legacy role writers live on main (grep-zero targets)
WRITE paths: `authService.ts:42,121`, `adminClaims.ts:37,71`, `lib/poolCreation.ts:64`,
`nflPools.ts:181`, `participant.ts:32,279`, `stripe.ts:160,166,197,536,542,573`, `userSync.ts:38`.
TYPE unions: `src/types/index.ts:515`, `functions/src/types.ts:246`.
READ comparisons (read-path gate): `SuperAdminBillingPanel.tsx:1416`, `SuperAdmin.tsx:1534`,
`src/utils/auth.ts:29`.
Partial canonical drift already present: `poolCreation.ts:65` `UPGRADEABLE_ROLES` includes `'MEMBER'`;
`poolCreation.test.ts` references pure `assertNotBanned('MEMBER','PARTICIPANT')`.
rules: `firestore.rules:222` writes `role == 'PARTICIPANT'`; no BANNED/COMMISSIONER in rules.
**Stored data:** live user docs/claims already contain PARTICIPANT/POOL_MANAGER → backfill required.

## T14 — revenue ledger + Overview split (`2865cac`) — SURVIVED
| File | State | Evidence |
|------|-------|----------|
| `functions/src/revenueAggregates.ts` | ✅ SURVIVED | exists |
| `functions/src/lib/billingCharges.ts` | ✅ SURVIVED | exists |
| revenue in bento + `dbService.subscribeToRevenueStats` | ✅ SURVIVED | 8 + 5 grep hits |
**No restore needed.** Verify Overview split wired during wire-audit (step 4).

## Also survived (feature-flag infra, T5)
`lib/featureFlags.ts`, `systemGuards.ts` (flags/maintenance), `useFeatureFlags.ts`,
`settingsService` flags, `PoolTypeGate` — all present. `assertNotMaintenance` exists but audit
whether it's actually called at every state-changing callable (T5 "with teeth") in step 4.

## Restore order impact
- T3: UI-only delete (backend done). Cheap.
- T7: restore 2 files + tab. Medium.
- T6: largest — pure files verbatim from `44666d6`, then re-apply setUserRole + write-path sweep +
  read-path normalize + backfill onto CURRENT (diverged) files. Gate role UI on grep-zero + backfill.
- T14: verify only.
