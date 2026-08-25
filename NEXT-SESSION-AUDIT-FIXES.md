# Paste-ready prompt — audit-remediation continuation

Copy everything inside the fence into a fresh session:

```
Continue the audit-remediation effort. Read MORNING-2026-08-24-AUDIT-FIXES.md
first (session record), then HANDOFF.md top box. The six audits' remaining
items, in priority order — work them one PR at a time per CLAUDE.md §2c/§2d
(codex review every PR; qodo stays DORMANT):

1. PLAN-AUDIT-AUTH-HARDENING Phase B — pool-password plaintext. KEVIN
   DECIDED (2026-08-24): OPTION 2, the full fix — keep the feature. PBKDF2
   like bracketPools.ts:202, password doc at pools/{id}/private/access with
   allow read: if false, join gate via callable, migration sweep
   (kill-switch + dry-run default, Rule 1). Plan doc exists; add the phase +
   review-log rounds + sweeps. Plan-gated: authorization + prod data.
2. Firebase Auth backup (VCS audit F3, PLAN-BACKUPS-PHASE3.md says "none"):
   scheduled function exporting Auth users (admin.auth().listUsers) to a GCS
   bucket, weekly + on-demand callable, SUPER_ADMIN-gated, restore steps
   documented. Firestore PITR does not cover Auth.
3. E2E in CI (D4 APPROVED 2026-08-24): new non-blocking workflow job — Java 21 +
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
8. KEVIN LOGO DECISION (D3, 2026-08-24): mmp-logo-full.png becomes THE site
   logo — the crest cuts off the bottom of the artwork. (a) Generate a
   properly sized WebP from mmp-logo-full.png (source 1.3MB — resize to
   header scale ~2x display, budget-test it like mmp-crest-small.webp);
   swap Logo.tsx to it everywhere the site logo renders. (b) Email
   templates: regenerate email-logo.png FROM the full-logo artwork (same
   size class as today's 589x150, keep PNG + the /email-logo.png URL so
   functions/src/emailStyles.ts LOGO_URL and sent-mail caches keep working).
   (c) Keep all legacy PNGs in public/ (his call — no deletions). Update
   tests/imagePerfBudget.test.ts accordingly.
9. KEVIN DECISION D7 (approved as recommended): require verified email
   before pool CREATE and JOIN, behind a server config flag (e.g.
   system/config.requireVerifiedEmail), DEFAULT OFF until Kevin flips it.
   Server-authoritative check in the create/join callables (client banner
   already exists). Plan-gated: authorization — add as a phase to
   PLAN-AUDIT-AUTH-HARDENING with review rounds.
10. KEVIN DECISION D5 (approved): git history scrub PREP only — write the
   exact git filter-repo command set + fresh-clone coordination steps into a
   doc and hand them to Kevin in chat. The force-push itself is Kevin's
   manual action, never the session's. Urgency is cosmetic (leaked value is
   dead), so this rides last.
11. KEVIN FEATURE REQUEST (2026-08-24, do this one high priority): on the
   pool picks view (e.g. /pool/<id>?tab=picks&week=3) users misread the
   green check next to their own pick as "I won this game". Remove that
   pick-indicator checkmark entirely and replace with result feedback:
   (a) green check ONLY when the pick was CORRECT, (b) red X when the pick
   was INCORRECT, (c) highlight the whole game card green for correct / red
   for incorrect. Pending/unscored games get neither mark nor highlight.
   Theme-safe (light+dark), and ships with tests per the standing rule.
SETTLED — do NOT reopen (Kevin 2026-08-24): D2 auto-deploy webhook REJECTED
as recommended (frontend auto-deploy breaks the functions-first ordering —
the #539 double-charge hazard; manual Coolify trigger IS the safety
mechanism). D6 Identity Platform blocking-functions upgrade DEFERRED until
after season launch (best-effort reset notice stands, limits documented in
securityNotices.ts). Gemini rotation CLOSED with evidence (PR #559).

RE-AUDIT RESULTS (all six re-run 2026-08-24 evening by parallel auditors at
7e265e20; scores: frontend 2->4, backend 5->6, auth 4->5, hosting 3->5,
cloud 1.5->4.5, VCS 5->5; total 20.5->29.5 of 36). NAMING NOTE: what Kevin's
original message labeled "database and storage" carried FRONTEND-quality
results (organization/mobile/a11y/consistency/speed/forms) — that is the
"frontend" line here. A TRUE database/storage audit (Firestore schema,
indexes, backups) has never been run; it is on Kevin's remaining-audits
list, not this one. Remaining FAILs are
either queued (D1, SuperAdmin split, tokenization, job sizing) or settled
(D2 pipeline). NEW findings from the re-audit, all queued below:

13. AUTH D1 SPEC ADDITIONS (fold into item 1): (a) the bracket dashboard
    settings-edit writes `accessControl.password` PLAINTEXT via direct client
    updateDoc (BracketPoolDashboard.tsx:380 + dbService.ts:550-553) AND
    joinBracketPool only enforces passwordHash — exposed and unenforced;
    route through a hashing callable and stop persisting the field. (b) Fix
    at the choke point: createPoolPermissiveSchema
    (functions/src/schemas/poolCore.ts:20) is z.record-permissive — strip or
    hash gridPassword there, not per wizard. (c) Legacy unsalted SHA-256
    fallback in joinBracketPool (~bracketPools.ts:304): rehash-on-
    successful-join while in this code.
14. JOB SIZING (cloud re-audit): add timeoutSeconds/memory to
    syncNFLScoresJob (nflSchedule.ts:703), runReminders (reminders.ts:151 —
    the concrete 10x failure: 60s wall kills the run mid-send), and
    nflDeepScoreSweepJob (nflSchedule.ts:1383). Peer jobs use 270-540s /
    512MiB. Feeds item 4's Phase 2 case: the != "post" query still bills a
    read per dead pool per minute (scoreUpdates.ts:1106).
15. A11Y RESIDUALS (frontend re-audit): focus-trap the three remaining
    aria-modal surfaces (help/HelpPanel.tsx:145, modals/ShareModal.tsx:69,
    NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx:98 — useFocusTrap
    exists, wire it); focus rings + 24px targets on three more toggles
    (Grid.tsx:728, PlayoffPool/RankingForm.tsx:420,
    Props/PropCardForm.tsx:536); role="alert" on the Auth.tsx and
    ContactPage.tsx error messages (screen readers never hear failures);
    lazy-load the two article images (BracketPoolGuideArticle.tsx:150 —
    675KB, also convert to webp; SuperBowlOddsArticle.tsx:109).
16. DEAD/DUPLICATE WIZARD CODE (frontend re-audit): delete
    src/components/wizard/steps/ (six files, zero importers). Consolidate
    the DIVERGED live duplicates WizardStepBranding.tsx +
    WizardStepReminders.tsx (PropsWizard) vs src/components/admin/ same-name
    files (AdminPanel) — behavior-preserving, pick one canonical copy.
17. BACKEND RESIDUE (backend re-audit, none score-blocking): (a) three
    claim-only SUPER_ADMIN gates in aiTesting.ts:100,152,204 ->
    assertCallerRole; (b) migrations/backfillProfileData.ts:43 raw onCall,
    no schema -> validated(); (c) stale header comment in
    schemas/bracketPools.ts:1-10 still describes the pre-A2 spread; (d)
    five claim-only admin-bypass branches on owner-gated paths
    (playoffPools.ts:280, scoreUpdates.ts:1335, userProfile.ts:113,138,
    nflPools.ts:2019, poolOps.ts:782) -> claim+doc; (e) last four
    non-strict input schemas (opsHealth, prodWatchdog, squaresProps,
    tournamentAdmin); (f) userProfile.ts:126 getProfilePoolDetail ->
    validated() wrap.
18. HOSTING NITS (hosting re-audit): (a) scripts/scan_secrets.py scans
    STAGED files only — add an --all tracked-files mode so a tree scan
    means something; (b) apex->www redirect is a 307 — find where it's
    minted and make it 301/308; (c) HANDOFF.md mid-file "STILL OWED:
    ROTATE" box needs the strikethrough its siblings got (may already be
    fixed by the time you read this).
19. GITHUB REQUIRED CHECKS — VERIFY KEVIN'S REDO TOOK (VCS re-audit found
    the 2026-08-24 config never saved: ruleset 11714546 still only
    delete/force-push, untouched since January). After Kevin creates the
    main-scoped "Required checks (main)" ruleset, verify via
    `gh api repos/kstruck/MMPoolsV3/rulesets` that required_status_checks
    exists with the four contexts, main-scoped, no bypass actors.

20. Re-audits already re-run 2026-08-24 (this block) — only re-run again
    if tonight's work claims to close items 13-19: [FILL IN which of the six,
   or "none"]. Re-run each audit prompt verbatim from the originals and diff
   the scores against: DB/storage 3/6 → expect ~5/6; backend 5/6 → 6/6;
   auth 4/6 → 5/6; hosting 3/6 (unchanged until my console tasks are done);
   cloud 1.5/6 → ~4/6; VCS 5/6 (unchanged until required checks).
Overnight rules as usual: merges on green gates OK, no deploys, no console
actions, no prod-data mutations past dry-run; runbook + decisions inline in
chat by morning.
```
