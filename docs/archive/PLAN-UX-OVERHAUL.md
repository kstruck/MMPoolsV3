# PLAN-UX-OVERHAUL.md — End-to-End UX Remediation Plan

Source: full UX audit (2026-07-02). Goal: move the experience from "inconsistent" to "solid" by fixing the feedback layer — pick safety, state visibility, money trust, deadline honesty, mobile, notifications, accessibility. The backend engine (server lock enforcement, Stripe validation, reminders, score sync) is sound and stays untouched except where noted.

Legend: each item = **Problem → Fix → Files → Done-when**. Effort: S (<½ day), M (1–3 days), L (1–2 wks).

---

## Phase 0: Shared foundations (build once, everything else depends on these)

These unblock 80% of the later items. Do them first, in this order.

### 0.1 Toast / inline-notice system — M
- **Problem:** Success/failure feedback is `alert()` / `window.confirm()` / scroll-away banners (PickemPickEntry.tsx:131, SurvivorPickEntry.tsx:106/117, MarginPickEntry.tsx:91, Grid.tsx).
- **Fix:** One `<ToastProvider>` + `useToast()` (success / error / info, auto-dismiss, aria-live="polite" region) and one `<ConfirmModal>` for destructive/money confirms. No new dependency needed — small custom component, framer-motion already installed for animation.
- **Files:** new `src/components/ui/Toast.tsx`, `src/components/ui/ConfirmModal.tsx`; mount provider in `App.tsx`.
- **Done when:** zero `alert(`/`window.confirm(` calls remain in `src/` (grep gate in CI or husky hook).

### 0.2 Error-code → message map — S
- **Problem:** 8:1 generic-to-specific error ratio; raw `err.message` shown (PickemPickEntry.tsx:134, AuthActionHandler.tsx:93–95).
- **Fix:** `src/utils/errorMessages.ts`: map Firebase auth codes, callable error codes (`WEEK_LOCKED`, `GAME_LOCKED`, `ELIMINATED`, `failed-precondition`, `unauthenticated`, `resource-exhausted`, network) → actionable copy. Single `getUserMessage(err)` used by every catch block.
- **Done when:** all catch blocks in pick/join/create/billing flows route through `getUserMessage`; `WEEK_LOCKED` renders "Week locked at {time} — your submission arrived after the deadline."

### 0.3 Server-time service + time formatting util — M
- **Problem:** All lock/countdown UI uses device `Date.now()` (PickemPickEntry.tsx:54–58, BracketCountdown.tsx:8–13); no timezone labels anywhere (DateTimePicker.tsx:14–79, ~19 bare `toLocaleString()` calls); hardcoded offsets (Countdown.tsx:3, functions/src/espnBracket.ts:88,96).
- **Fix:**
  - Tiny callable `getServerTime` (or reuse any existing callable response to piggyback `serverTime`); `src/utils/serverClock.ts` computes offset once per session, exposes `now()`; warn banner if |drift| > 60s.
  - `src/utils/formatTime.ts`: `formatDeadline(ts)` → "Sun, Sep 13 · 1:00 PM ET (10:00 AM your time)" — always renders explicit zone; single source for every deadline render.
  - Replace hardcoded ISO-offset dates with epoch ms constants; **must land before March DST boundary**.
- **Files:** new utils; `functions/src/index.ts` (callable); sweep: Countdown.tsx, PoolTimer.tsx, BracketCountdown.tsx, DateTimePicker.tsx, WizardStepSummary.tsx, all pick entry lock checks, espnBracket.ts.
- **Done when:** no bare `Date.now()` in lock logic, no `toLocaleString()` without explicit handling, every rendered deadline shows a zone label.

### 0.4 Pick draft persistence hook — S
- **Problem:** Picks live only in React state (PickemPickEntry.tsx:24); tab close/back = total loss.
- **Fix:** `src/hooks/useDraft.ts` — debounced (500ms) localStorage write keyed `draft:{poolId}:{week|entryId}`; restore on mount with "Draft restored" toast; clear on successful submit.
- **Done when:** kill tab mid-entry → reopen → picks restored, in pick'em, survivor, margin, bracket builder, and props entry.

### 0.5 Firestore offline persistence + network banner — S
- **Problem:** No offline handling (firebase.ts); false-success submits on dead connections.
- **Fix:** `persistentLocalCache` in firebase.ts init; `useOnline()` hook (`navigator.onLine` + online/offline events) → global slim banner "You're offline — changes will sync when reconnected"; submit buttons disabled with reason while offline.
- **Done when:** airplane-mode pick attempt shows offline state instead of spinner/false success.

---

## Phase 1: Quick wins (pick safety, first-run, legal) — target: 1 sprint

### 1.1 Submission receipts — S (needs 0.1)
- **Fix:** On successful submit: toast + persistent pinned card on entry screen: "✓ Week {n} picks submitted · {serverTimestamp} ET". Server already returns success; include timestamp in callable response (`functions/src/nflPools.ts`). Same pattern for bracket save, margin, survivor, props, squares claim.
- **Done when:** reload after submit still shows submitted state + timestamp (read from entry doc, not local state).

### 1.2 Dashboard empty states — S
- **Fix:** `ParticipantDashboard.tsx:610` — `filteredPools.length === 0` branch: zero pools → "No pools yet" card with [Browse Public Pools] [Create a Pool] [Paste invite link]; zero search results → "No pools match '{q}'" + clear-search.
- **Done when:** new account sees CTAs, never a blank grid.

### 1.3 Signup confirmation + landing — S (needs 0.1)
- **Fix:** After successful registration: close modal → navigate `/participant` → toast "Account created — check {email} to verify." Align Header banner copy (Header.tsx:41–62) with reality: "Verify your email to secure your account" (drop the false "unlock all features" claim), OR actually gate pool creation on verification — pick one; recommend copy fix now, gating later.
- **Files:** Auth.tsx:40–50, AuthModal.tsx:47, Header.tsx.

### 1.4 Email unsubscribe link — S ⚠ legal
- **Fix:** Footer link in `functions/src/emailStyles.ts` → `/email-prefs?u={uid}&token={hmac}`; signed-token route flips `users/{uid}.emailPrefs.all=false`; `sendEmail()` in reminders.ts checks prefs before writing to `mail`. Category prefs come in Phase 3 (item 3.5) — the compliance link ships NOW with a global opt-out.
- **Done when:** every outbound template has the link; opted-out user receives nothing.

### 1.5 Accessibility floor — M
- **Fix:**
  - alt text on all `<img>` (team logos: `alt={team.name}`) — BrowsePools.tsx, ESPNBracket.tsx, article components.
  - `aria-label` on icon-only buttons and the unlabeled search input (live-verified on /browse).
  - MatchNode.tsx:127–165: pair color states with icon+text (✓ correct / ✗ incorrect / — pending) for all rounds, not just finals.
  - Floor help text at 12px (replace `text-[10px]` in wizard steps).
  - Modal focus restore: store trigger element, refocus on close (AuthModal.tsx, ShareModal, PlayoffSettingsModal); add simple Tab-cycle trap.
- **Done when:** axe-core clean of criticals on /, /browse, auth modal, pick entry, standings.

### 1.6 Copy fixes — S
- **Fix:** Label the landing hero countdown ("Kickoff: NFL Week 1 — Sep 9"); reconcile /browse subtitle ("Super Bowl squares and March Madness brackets") and type filter with NFL-first positioning — add NFL pool types to browse filters or update copy.
- **Files:** LandingPage.tsx, Countdown.tsx, BrowsePools.tsx:27–123.

### 1.7 Password reset error handling — S (needs 0.2)
- **Fix:** AuthActionHandler.tsx:93–95 — map `auth/invalid-action-code`/`auth/expired-action-code` → "This link has expired. [Send a new one]" with inline re-request; auto-redirect to login 3s after successful reset.

---

## Phase 2: Flow-level fixes — target: 2–3 sprints

### 2.1 Invite auto-join — M
- **Problem:** Signup from `/join/:poolId` requires a second manual join click (JoinPool.tsx:43–46, AuthModal.tsx:47).
- **Fix:** `onOpenAuth({ intent: 'join', poolId })`; AuthModal invokes `onAuthSuccess(intent)` → JoinPool auto-runs `handleJoin()` with "Joining {pool}…" state → land on pool dashboard with welcome banner (entry fee, payment method, first deadline).
- **Done when:** invite link → signup → inside pool, zero extra clicks.

### 2.2 Join confirmation — S (needs 0.1)
- **Fix:** ConfirmModal before join: "Join {pool}? Entry ${fee} · Picks due {formatDeadline}". Success toast on arrival. JoinPool.tsx:42–61.

### 2.3 Pending-vs-done dashboard state — L (highest-leverage item in the plan)
- **Problem:** No signal of unpicked weeks/unpaid dues anywhere (NFLPoolDashboard.tsx:34+, ParticipantDashboard.tsx:176–209).
- **Fix:**
  - Compute per-pool member status (has entry? current week picked? paid?) — extend the pool/entry fetch or a lightweight `getMyStatus` callable.
  - ParticipantDashboard pool card: "⚠ Picks due Sun 1:00 PM ET" / "🟡 $20 unpaid" / "✓ All set" badges; action-needed pools sort to top.
  - NFLPoolDashboard: week checklist strip `W1 ✓ W2 ✓ W3 ☐(due Sun)`; tap → that week's entry.
  - Show bracket entry count on cards (data already fetched, ParticipantDashboard.tsx:176–178).
- **Done when:** one glance at /participant answers "what do I still owe?"

### 2.4 Entry-screen progress + next-week loop — S
- **Fix:** "X of Y games picked" progress bar in PickemPickEntry (derive from `canSubmit` inputs, lines 81–96); after submit success card, "Pick Week {n+1} →" button when next week's spreads are final.

### 2.5 Mobile pass on core product screens — L
- **Problem:** PickemPickEntry 0 `sm:` breakpoints, SurvivorPickEntry same, StandingsTable truncates with no scroll container, sub-44px inputs.
- **Fix:**
  - Game cards: `flex-col sm:flex-row`; full-width team buttons on <640px.
  - Confidence/tiebreaker inputs: min 44×44 (`py-2.5`, larger font).
  - StandingsTable: wrap in `overflow-x-auto` w/ sticky first column, or card layout under `sm:`.
  - Squares Grid: verify pinch/zoom controls actually wired (Grid.tsx:97 zoomLevel set but unused).
  - Add PWA manifest (name, icons, theme #0A192F) — cheap install-to-homescreen win.
- **Done when:** all pick flows completable one-handed at 375px; no horizontal body scroll.

### 2.6 Deadline hardening — M (needs 0.3)
- **Fix:**
  - Countdown components consume `serverClock.now()`.
  - T-0 behavior: entry UI flips in place to locked state showing what was/wasn't submitted.
  - Near-lock submit failure: one auto-retry w/ backoff inside final 10 min; on server `WEEK_LOCKED` show exact lock time vs arrival time (0.2 map).
  - Error banner on submit failure: scroll-into-view + pin until dismissed (PickemPickEntry.tsx:134).
  - Idempotency: client-generated `requestId` in submit payload; functions dedupe on `entries/{id}.lastRequestId`.
- **Done when:** clock-skew test (±5 min) and T-1s/T+1s submit tests pass; skewed client shows drift warning.

### 2.7 Commissioner roster board + remind-now — L
- **Problem:** No who-picked/who-paid view, no on-demand nudge (AdminPanel.tsx:1155–1180; reminders.ts scheduled-only).
- **Fix:**
  - AdminPanel "Roster" tab: table — member / paid ✓✗ / picked-this-week ✓✗ / last active; filters (unpaid, unpicked).
  - "Remind now" per row + bulk: callable `sendManualReminder` reusing reminders.ts templates + dedupe (rate-limit 1/user/4h).
  - Member removal: `removeMember` callable (audit-logged, strips from participantIds, marks entry withdrawn) + confirm modal warning about their entries.
- **Done when:** commissioner finds and nudges all non-pickers in <30s.

### 2.8 Standings freshness — M
- **Problem:** Standings recompute only on prop change; ticker live, table stale (StandingsTable.tsx:11–50); ESPN failures silent (scoreUpdates.ts `return null`).
- **Fix:** `onSnapshot` listener on pool scores/entries feeding StandingsTable props; "Updated {n}s ago" stamp; scoreUpdates.ts writes `lastSyncAt`/`lastSyncStatus` to pool doc → UI shows "Scores delayed — retrying" if stale >3 min during live games.
- **Done when:** score change reflects in open standings tab <90s, no manual refresh.

### 2.9 Scoring transparency — M
- **Fix:** "Rules & Scoring" panel per pool, auto-generated from settings: round values (CLASSIC/FIBONACCI from bracketScoring.ts:10–12), upset bonuses, confidence rules, tiebreaker explanation ("Ties broken by closest championship total prediction" — StandingsTable.tsx:44–60), lock mode, payout summary (links to 3.2). Member-visible from standings + entry screens.
- **Done when:** "why do I have N points?" answerable in-app; PickHistory gains per-game drill-down (extend roundBreakdown to per-pick detail).

---

## Phase 3: Trust & money (before scaling users/money) — target: 2–3 sprints

### 3.1 Member payment ledger — L (the big one)
- **Problem:** Dues = free-text + commissioner boolean; invisible to members; no audit trail (types.ts:36–40,130; PayoutGallery.tsx:77–92).
- **Fix:**
  - Schema: `pools/{poolId}/payments/{paymentId}` — { uid/entryId, amount, direction: DUE|PAYOUT, status: UNPAID|MARKED_PAID|CONFIRMED, method, markedBy, markedAt, note }. Firestore rules: members read own + pool totals; only commissioner/co-managers write.
  - Mark-paid flows write ledger events (replace bare `isPaid` toggle; keep field mirrored for compat).
  - Member view: "Payments" tab — "You owe $20 · Unpaid · [Pay via Venmo]" (deep-link from paymentInstructions, structured: method selector Venmo/Zelle/CashApp/Cash in wizard instead of free text).
  - Receipt email on MARKED_PAID (reuse mail collection; README claims this exists — verify `postGameEmail`-style trigger, wire if absent).
  - Pool pot total visible to all members.
- **Done when:** member can self-serve answer "am I marked paid, when, by whom"; every status change timestamped and attributed.

### 3.2 Pre-game payout table — M
- **Fix:** Member-facing "Prizes" panel computed from WizardStepPayouts config: pot, per-payout dollar amounts (quarterly % or every-score-pays schedule), tie policy, unsold-square policy, charity deduction, rollovers. Shown on join confirm (2.2) + pool dashboard.
- **Done when:** member knows exact dollar value of every winnable outcome before paying dues.

### 3.3 Rebuy flow — S (needs 0.1)
- **Fix:** SurvivorPickEntry.tsx:117 `window.confirm` → ConfirmModal ("Rebuy for ${cost} — added to your dues, commissioner collects via {method}") → writes DUE ledger event (3.1) → receipt card + email.

### 3.4 Billing-lock member experience — M
- **Fix:** BillingGate locked state: keep standings/picks **read-only visible** (blur only entry actions); copy: "Pool is paused pending host payment — your picks and standings are safe." Email commissioner at grace start + T-24h before lock (extend reminders.ts). Document Stripe checkout cancel/fail path: return to BillingInvoiceCard with specific failure message + retry.
- **Files:** BillingGate.tsx:309–509, stripe.ts:238+, reminders.ts.

### 3.5 Notification preference center — M (extends 1.4)
- **Fix:** `users/{uid}.emailPrefs` = { lockReminders, results, payments, announcements, digest } booleans; UserProfile settings UI + tokenized `/email-prefs` page (no-login edit); every sender in reminders.ts / postGameEmail.ts checks category.
- **Done when:** each email category individually controllable; unsubscribe-all honored everywhere.

### 3.6 Commissioner exception tools — L
- **Fix (all audit-logged, all visible in member-readable audit view for money/deadline events):**
  - Extend deadline: edit `lockAt`/week lock with reason; auto-notifies members ("Deadline extended to {time}").
  - Proxy pick: commissioner enters picks on behalf of member; entry flagged "entered by commissioner" in standings tooltip.
  - Pool cancel/archive: status → CANCELED with member notification + dues-refund note in ledger.
- **Files:** AdminPanel, new callables in poolOps.ts (respect PRIVILEGED_POOL_FIELDS pattern — these are server-side sanctioned mutations, not client writes).

### 3.7 Bulk email invites + optional join approval — M
- **Fix:** PoolShareModal: paste-emails field → `sendInvites` callable writes to mail collection (rate-limited, reuses broadcast infra); wizard toggle "Require approval to join" → join requests queue in Roster tab.

---

## Phase 4: Delight & retention — target: ongoing after 1–3

### 4.1 Champion moment — S
- Championship finalized → full-screen banner + canvas-confetti (dep installed) for winner, podium card for all; add "Grand Champion" atop BracketAwards.tsx; season recap email (extend postGameEmail.ts with standings context: "You finished 3rd of 20").

### 4.2 Season history / career stats — M
- On pool completion write `users/{uid}/seasonHistory/{poolId}` (rank, points, pool name, season); UserProfile "History" tab; surface "returning champ" badges next season.

### 4.3 Re-engagement emails — M (needs 2.3 status data + 3.5 prefs)
- "You haven't picked Week {n}" T-36h to non-pickers only (distinct from all-member lock reminders); weekly standings digest (opt-in); missed-week win-back ("You're still only 6 back — Week {n+1} opens now").

### 4.4 Season re-run — M (retention keystone for paying customers)
- "Re-run this pool" on completed pools: clones settings into wizard, pre-fills roster, one-click re-invite emails to last season's members. Pre-season commissioner email ("Kickoff in 3 weeks — relaunch {pool}?") via scheduled function.

### 4.5 Polish backlog
- Optimistic UI on pick select w/ pending indicator; skeleton loaders on dashboard/standings; per-game point drill-down everywhere; web-push lock reminders (FCM — README claims infra exists, verify + surface opt-in).

---

## Sequencing & dependencies

```
Phase 0 (0.1→0.5, ~1.5 wks, serial-ish)
  ├─ Phase 1 items — all parallelizable after their listed deps; 1.4 + 0.3 offsets are DEADLINE-SENSITIVE (legal / March DST)
  ├─ Phase 2: 2.1/2.2 (join), 2.3 (state) ← biggest retention lever, start early
  │           2.5 (mobile) parallel; 2.6 needs 0.3; 2.7 feeds 4.3
  ├─ Phase 3: 3.1 schema decisions first (blocks 3.2, 3.3, 3.6 ledger events)
  └─ Phase 4 after 2.3/3.5
```

## Verification gates (per release, from audit's testing strategy)

- **Gate (must pass):** deadline sim tests (T-1s/T+1s vs callable, ±5min clock skew), payment-state tests (Stripe test cards × BillingGate states), draft-restore test (kill tab mid-entry), grep gate: no `alert(`/`window.confirm(`/bare `Date.now()` in lock paths, axe-core criticals = 0 on core routes.
- **Ship-and-iterate:** copy, empty states, delight features, digests.
- **Manual before each phase ships:** 375px walkthrough of every touched flow; one VoiceOver pass on pick entry (Phase 1+2).

## Explicitly out of scope (for now)

- Stripe Connect / in-app member payouts (audit long-term rec) — revisit after 3.1 ledger proves demand.
- Native apps. PWA manifest only.
- Multi-language.
