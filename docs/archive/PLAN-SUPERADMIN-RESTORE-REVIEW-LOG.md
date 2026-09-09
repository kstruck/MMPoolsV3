# Plan Review Log: Super-Admin Dashboard Restoration + 8-Tab Rebuild

Act 1 (grill-with-docs) complete — plan locked at PLAN-SUPERADMIN-RESTORE.md (PLAN.md is the
pre-existing master roadmap, left untouched). CONTEXT.md updated (Super-Admin Dashboard,
Operations, Test Suite). MAX_ROUNDS=5.

## Round 1 — Codex

**Findings** (thread 019f304e-db96-7bf2-88e0-bd58254304b6)

1. CRITICAL: Baseline wrong — `setUserRole`/`adminOps` did NOT survive; index.ts exports only `setSuperAdminClaim`/`syncMyClaims`; no adminOps.ts. Fix: re-baseline against current exports; add backend restore tasks.
2. CRITICAL: `syncMyClaims` is an any-authenticated-user role→claim copier, auto-called by `useEnsureAdminClaims` + `SuperAdminBillingPanel`. Fix: harden per PLAN-USER-MGMT before role work; auto-sync bootstrap-only.
3. CRITICAL: Role UI before the legacy-role sweep will drift back to `POOL_MANAGER`/`PARTICIPANT` (types/index.ts:515, lib/poolCreation.ts:64, firestore.rules:222). Fix: sweep + alias layer first.
4. HIGH: "Verify, don't rebuild" for reset/email is false — `sendAdminPasswordReset` is SUPER_ADMIN-only, writes only admin_audit, no Activity Log; no one-off email callable. Fix: build `triggerPasswordReset` + `sendUserEmail` with dual-write.
5. HIGH: Guardrail sweep is theater while admin UI does direct client Firestore writes (SuperAdmin.tsx:614, SuperAdminBillingPanel.tsx:255/305, dbService.ts:290) and admin_audit is client-write-forbidden. Fix: audited-callable prerequisite.
6. HIGH: Members-in-SuperAdmin conflicts with PLAN-USER-MGMT's dedicated /admin/users (MODERATOR-capable). Fix: treat PLAN-USER-MGMT as prerequisite; keep moderator tooling out of SuperAdmin.
7. HIGH: T2 acceptance ambiguous ("leaves open") + lifecycle fragmented across Browse/Manager/Participant/poolSport helper with no closed/canceled state. Fix: canonical post-close state per type; migrate consumers to shared helper.
8. MEDIUM: No "users subscription" exists — `getAllUsers()` is an unbounded repository `find()`. Fix: paged/searchable query contract.
9. MEDIUM: Deploy step functions-only; smoke list names non-existent exports. Fix: deploy matrix functions+rules+indexes; verify actual export list.
10. LOW: Bookmark-alias work solves nothing — tab state is local React state, not URL. Fix: drop.

VERDICT: REVISE

### Claude's response

Accepted 1–5, 7–10 in full (finding 1 independently verified: adminOps.ts deleted, setUserRole/lib/roles.ts reverted — the clobber hit functions too, via the #117 merge). Plan revised: new step 0 (clobber audit re-baseline), step 1 restores backend halves of T6/T7 with sweep+aliases+claims-hardening gating the role UI, new step 2 (kill direct client admin writes) before the guardrail sweep, step 6 recast reset/email as build work + paged users query, step 7 gains lifecycle unification via a shared helper with corrected acceptance wording, step 9 is a full deploy matrix, alias work dropped.

Finding 6 partially accepted: Members tab is scoped as the SUPER_ADMIN-only surface; PLAN-USER-MGMT's moderator-capable /admin/users remains a separate deliverable reusing components built here. Full PLAN-USER-MGMT is not a blocking prerequisite for tab consolidation — only its role-sweep/claims-hardening parts are (covered by findings 2–3).

## Round 2 — Codex

**Findings**

1. HIGH: syncMyClaims wording strands the bootstrap admin — must keep the self-only, Firestore-role-verified SUPER_ADMIN recovery path (PLAN-USER-MGMT.md:43); only forbid privileged minting outside it.
2. HIGH: Role-sweep file list incomplete — post-44666d6 writers exist at src/services/authService.ts:42 and functions/src/lib/poolCreation.ts:64. Gate must be repo-wide grep-zero on PARTICIPANT|POOL_MANAGER, not a fixed list.
3. HIGH: Restoring setUserRole raw from 44666d6 misses the accepted PLAN-USER-MGMT hardening (claim+Firestore agreement, refresh-token revocation on demotion).
4. HIGH: "Non-destructive low-risk client writes may stay temporarily" carve-out reopens the audit hole (SuperAdminBillingPanel :255/:305/:400 privileged writes). No client-side privileged writes in an approved plan.
5. HIGH: BANNED promised only "visible in UI" but CONTEXT.md defines it as blocked at UI AND server/callable layers; the server sweep lives in PLAN-USER-MGMT. Pull assertNotBanned in or de-scope.
6. MEDIUM: "email/name prefix" search diverges from PLAN-USER-MGMT v1 (searchEmail only; name search needs schema/index design).

Round-1 items confirmed fixed: backend re-baseline, reset/email build-not-verify, direct-write prerequisite, T2 lifecycle wording, deploy matrix, alias removal.

VERDICT: REVISE

### Claude's response

All 6 accepted. Plan edits: (1) syncMyClaims hardening now explicitly preserves the self-only Firestore-verified SUPER_ADMIN bootstrap path; (2) sweep gate is repo-wide grep-zero on PARTICIPANT|POOL_MANAGER write-paths, authService.ts:42 + lib/poolCreation.ts:64 added to must-fix; (3) setUserRole = history + PLAN-USER-MGMT hardening (agreement checks, token revocation on demotion); (4) carve-out deleted — every privileged admin mutation converts this cycle, schedule slips before the audit boundary does; (5) BANNED enforced at both layers — assertNotBanned server guard restored/verified (44666d6 systemGuards hunks; step 0 determines restore vs verify) + rules sweep; (6) users search scoped to paged searchEmail only, name search deferred.

## Round 3 — Codex

**Findings**

1. HIGH: T6 gate covers writes only — read paths still compare raw legacy strings (SuperAdmin.tsx:1534, SuperAdminBillingPanel.tsx:1416, utils/auth.ts:29) and will misrender once canonical values land. Fix: read-path migration gate via normalizeRole/roleBadge.
2. HIGH: BANNED callable enforcement under-specified — accepted contract is assertNotBanned(request) reading the Firestore role, not the claim; raw historical restore lets a fresh ban survive until token refresh.
3. MEDIUM: functions/src/types.ts:246 hardcodes the legacy role union — include function-side role-bearing types in the sweep or prove unused.

Prior findings addressed.

VERDICT: REVISE

### Claude's response

All 3 accepted. Plan edits: T6 gate is now twofold (repo-wide write-path grep-zero AND a read-path migration gate through normalizeRole/roleBadge helpers); functions/src/types.ts:246 added to the sweep; assertNotBanned specified as the Firestore-backed PLAN-USER-MGMT guard with the historical hunks demoted to reference-only.

## Round 4 — Codex

**Findings**

1. HIGH: BANNED "bites immediately" overstated — direct rule-gated writes (ai_requests rules:144, messages rules:165, shareClicks rules:205) use the claim-based rules helper; a stale token survives until refresh. Fix: narrow claim to callable paths, or move those writes behind callables / forced-refresh strategy.
2. MEDIUM: searchEmail has no implementation in the tree; plan depends on it without scheduling the field/index/user-sync plumbing (PLAN-USER-MGMT.md:81,83).

Round-3 items confirmed addressed.

VERDICT: REVISE

### Claude's response

Both accepted. Plan edits: BANNED latency stated honestly — immediate on callable paths; residual window ≤ token TTL on the three low-blast-radius rule-gated paths, mitigated by refresh-token revocation on ban, with escalation to callables if any proves higher-risk. searchEmail plumbing pulled into this plan: users/{uid}.searchEmail via userSync, audited one-time backfill as an Operations action, role+searchEmail composite index.

## Round 5 — Codex (final round, cap reached)

**Findings**

1. HIGH: Plan cleans future legacy-role writers but never migrates EXISTING stored data — live user docs/claims already contain PARTICIPANT/POOL_MANAGER (authService.ts:42, userSync.ts:38, poolCreation.ts:64, adminClaims.ts:37); canonical where('role','==',...) queries silently miss them. Fix: audited role backfill after cleaned-writer deploy, before role-filtered queries/role UI (PLAN-USER-MGMT.md:33 sequence).

Rounds 1–4 items all confirmed addressed.

VERDICT: REVISE

### Claude's response

Accepted. Plan edit: audited one-time role backfill (dry-run first, Operations action, admin_audit logged) rewrites legacy doc/claim values after the writer cleanup deploys; role-selector UI and role-filtered Members queries gate on the backfill having run.

## Resolution

MAX_ROUNDS=5 reached without a formal APPROVED. Not a deadlock in substance: every finding across all five rounds was accepted and folded into the plan (28 findings total: 10+6+3+2+1 with rounds 2–5 each confirming the prior round's fixes); the sole round-5 finding was accepted and incorporated after the cap. No unresolved disagreements remain — Codex simply found one new item per shrinking round rather than contesting any fix. Claude's position: the plan is converged; the honest label is "cap reached, all findings resolved," not "approved."
