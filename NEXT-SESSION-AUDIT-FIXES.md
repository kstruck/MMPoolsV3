# Paste-ready prompt — audit-remediation continuation

Copy everything inside the fence into a fresh session:

```
Continue the audit-remediation effort. Read MORNING-2026-08-24-AUDIT-FIXES.md
first (session record), then HANDOFF.md top box. The six audits' remaining
items, in priority order — work them one PR at a time per CLAUDE.md §2c/§2d
(codex review every PR; qodo stays DORMANT):

1. PLAN-AUDIT-AUTH-HARDENING Phase B — pool-password plaintext. My decision:
   [OPTION 1 relabel-unlisted / OPTION 2 full server-side hash+callable —
   FILL IN]. Option 1: stop writing gridPassword/accessControl.password,
   relabel UI "unlisted", kill-switched dry-run-default sweep deleting the
   two fields (prod-data mutation — Rule 1 + plan gate). Option 2: PBKDF2
   like bracketPools.ts:202, password doc at pools/{id}/private/access with
   allow read: if false, join via callable, migration sweep. Either way:
   plan doc exists, add a phase + review log rounds + sweeps.
2. Firebase Auth backup (VCS audit F3, PLAN-BACKUPS-PHASE3.md says "none"):
   scheduled function exporting Auth users (admin.auth().listUsers) to a GCS
   bucket, weekly + on-demand callable, SUPER_ADMIN-gated, restore steps
   documented. Firestore PITR does not cover Auth.
3. E2E in CI (if I approved D4): new non-blocking workflow job — Java 21 +
   firebase emulators + `npx playwright test`; cache browsers; artifact the
   traces. Flip to required only after a week of green.
4. Scan-bounds Phase 2 decision gate: pull a week of syncGameStatus
   system_logs summaries (totalPoolsFound vs skippedDead) and recommend
   build/skip for the denormalized syncActive flag.
5. Design-system adoption, first tranche: replace the two dominant hardcoded
   colors (text-[#0F7B4A] ~180 uses, text-[#9FB0CC] ~186 uses) with tokens
   mapped in tailwind.config.js; mechanical sweep + visual spot-check; do
   NOT touch spacing/fonts this pass.
6. SuperAdmin.tsx split, phase 1 only: extract the Members tab into its own
   file with zero behavior change (clobber-guard tests must stay green).
7. Babysit dependabot #550 (mmp-loop-babysit-deps skill; isolated worktree).
8. Re-audits I want re-run to verify the fixes: [FILL IN which of the six,
   or "none"]. Re-run each audit prompt verbatim from the originals and diff
   the scores against: DB/storage 3/6 → expect ~5/6; backend 5/6 → 6/6;
   auth 4/6 → 5/6; hosting 3/6 (unchanged until my console tasks are done);
   cloud 1.5/6 → ~4/6; VCS 5/6 (unchanged until required checks).
Overnight rules as usual: merges on green gates OK, no deploys, no console
actions, no prod-data mutations past dry-run; runbook + decisions inline in
chat by morning.
```
