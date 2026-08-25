# MORNING 2026-08-24 — Overnight audit-remediation session

Kevin's brief: work every finding from the six audits (DB/storage, backend
API, auth, hosting/deploy, cloud/compute, VCS/CI) plus the 8/8-red Playwright
suite. This file is the repo copy; the chat message is the delivery (per the
standing rule). All times local (MDT).

## Merged tonight — 9 PRs, every one with a clean final codex round + own read

| PR | What | Rounds/findings |
|---|---|---|
| [#547](https://github.com/kstruck/MMPoolsV3/pull/547) | Backend quick wins: HttpsError details leak (3 sites), method guards on 6 HTTP endpoints, `searchUsersByEmail` allowlist, **Gemini-leak doc correction in 9 skill files** | 5 rounds, 4 findings absorbed |
| [#548](https://github.com/kstruck/MMPoolsV3/pull/548) | `setGlobalOptions({maxInstances: 10})` + runWith caps on the 3 v1 triggers — first fan-out ceiling this project has had | 1 round, clean |
| [#549](https://github.com/kstruck/MMPoolsV3/pull/549) | PLAN-AUDIT-SCAN-BOUNDS Phase 1: reminders 3-query union (was a full pools scan ×96/day), syncGameStatus dead-pool guards, checkPlayoffScores season window | 3 rounds; r2 found a P1 in the fix (derived `CLOSED` label nothing persists) |
| [#551](https://github.com/kstruck/MMPoolsV3/pull/551) | Perf: crest 935KB→8KB webp, heroes/features→webp+lazy, og/email/placeholder shrunk in place, recharts modulepreload off the landing page | 1 round, clean |
| [#552](https://github.com/kstruck/MMPoolsV3/pull/552) | Deleted 3 dead wizard-step components (516 lines, zero imports) | 1 round, clean |
| [#553](https://github.com/kstruck/MMPoolsV3/pull/553) | Build hygiene: dead root deps (express, firebase-functions) out, `.dockerignore` widened (a MORNING-*.md edit no longer forces a full image rebuild), npm cache in security-scan | 1 round, clean |
| [#554](https://github.com/kstruck/MMPoolsV3/pull/554) | PLAN-AUDIT-AUTH-HARDENING Phase A: claim+doc gates on the 2 claim-only callables, strict bracket settings (recursive), `notifyPasswordReset` security email | 5 rounds, 8 findings (2 partially accepted with reasoning) |
| [#555](https://github.com/kstruck/MMPoolsV3/pull/555) | A11y: focus-trapped the 3 aria-modal dialogs, contact labels wired, real header links + 24px targets, alt text, toggle focus rings, jsx-a11y lint (+ .npmrc/@testing-library/dom fallout fixes) | 1 round clean + 2 CI-found env fixes |
| [#556](https://github.com/kstruck/MMPoolsV3/pull/556) | **E2E revival: 8/8 GREEN** (red since ~2026-07-09). All selector drift from the buy-flow overhaul + SuperAdmin nav redesign; zero product bugs. Full 2.2m emulator run on this machine | 1 round, clean |

Suites: functions 1820 → **1861**; root 2105 → **2153** (2150 green locally —
3 pre-existing Windows CRLF artifacts in `addon-purchase.test.ts`, green in CI);
e2e **0/8 → 8/8**.

## Corrected on the record

**The Gemini key WAS leaked.** `git show 3340fff0^:.env | grep -c VITE_API_KEY`
(count-only — never reprint the value) in the PUBLIC repo: the key sat exposed
since 2025-12-13. The 2026-07-06 "owner ground truth: NOT leaked" was false and
had propagated into nine skill files — all corrected in #547. Rotation was
ALREADY Kevin's owed action in HANDOFF; the audits independently rediscovered
the same key. **CLOSED 2026-08-24 morning (Kevin ruling): rotation verified
already done** — leaked value tested live → `API_KEY_INVALID`; `.env` history
carries no other private key; the live key (Jan 2026) never touched git.
Runbook Task 1 and decision D5's urgency are void — D5 is cosmetic now.

## Stale audit findings (no action needed)

- "No hamburger menu" — shipped by the 2026-08-23 header redesign.
- "createBracketPool has no schema at all" — a schema existed
  (`shared/schemas/bracket.ts`); the REAL residues (non-strict + raw spread)
  are fixed in #554.
- "App Check: flip monitor→enforce in validated.ts" — **do NOT**: enforcement
  is BLOCKED repo-wide (2026-07-30 outage, four faults open, HANDOFF STOP
  POINT).

## Rejected audit suggestions (with reasoning, logged in the plans)

- `.limit()` on the reminders scan — silently drops pools (lost reminders and
  lost hard-lock freezes). The type/flag union bounds reads without dropping.
- Removing `notifyPasswordReset` because it's spoofable — the copy asserts no
  false fact, the induced action is protective, caps bound abuse; the real fix
  (Identity Platform blocking functions) is decision D6 below.

## NOT built tonight — Kevin's decisions (D1–D7) + backlog

Decisions are restated in the chat message with recommendations; backlog items
are in the next-session prompt at the bottom of this file:

- D1 pool-password plaintext (PLAN-AUDIT-AUTH-HARDENING Phase B, 3 options)
- D2 auto-deploy webhook (recommend NO — ordering hazard, see chat)
- D3 delete legacy heavyweight PNGs from public/
- D4 e2e suite into CI as a job
- D5 git history scrub (filter-repo) after key rotation
- D6 Identity Platform blocking functions upgrade
- D7 require emailVerified before pool create/join
- Backlog: SuperAdmin.tsx split (4,367 lines), design-system adoption (~800
  hardcoded colors, 659 raw buttons, 1,133 px font sizes), wizard-tree
  consolidation, Firebase Auth backup job, scan-bounds Phase 2 (measure
  first), deploy workflow on tag, preview deploys, lint backlog (~540),
  dependabot #550.

## Kevin's runbook — delivered in full in the chat message

1. Rotate the Gemini key (leaked + unrestricted — first priority).
2. Deploy functions (four merged PRs change `functions/`; #542's guard may
   also still be owed — the deploy covers both).
3. Coolify `www` rebuild (perf/a11y/dead-code PRs all have frontend halves).
4. GCP budget ($100/mo, 50/75/90/100% — Phase 0.2 of the signed cost plan).
5. GitHub required status checks (the "Level 1" ruleset blocks nothing today).
6. Coolify rollback test (never tested; steps in chat).
7. Answer D1–D7.

## Next-session prompt

The ready-to-paste prompt for continuing this effort is at the end of the chat
message and duplicated in `NEXT-SESSION-AUDIT-FIXES.md`.
