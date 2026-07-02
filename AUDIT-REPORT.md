# March Melee Pools — Deep Repo Audit

_Generated 2026-07-01. Evidence-based review of the actual code, config, and architecture on `main`. Build/lint/test were run live; findings tie to specific `file:line`._

---

# Executive Summary

**Classification: FRAGILE — not safe to charge customers yet.**

The app is a well-featured, genuinely ambitious product with real engineering strengths (disciplined Stripe webhook idempotency, transactional scoring with audit-dedupe, tested pure scoring engines, real code-splitting). But it is **not bulletproof, and it is not safe to take money in its current state.** Three independent payment-bypass paths let a user get paid pools for free or near-free, any authenticated user can rig the winners of any real-money pool, the test suite is **red on `main` (13 failing)** with **no CI gate** to stop a broken deploy, and the score-sync engine silently stops updating most pools under Sunday load.

The core problem is a **client-trust boundary that leaks in multiple places**: Cloud Functions spread raw client payloads into documents, Firestore rules don't pin all the money fields, and business logic (free-plan caps, pricing, winner selection) is enforced inconsistently across four code paths. For a free hobby app this would be "decent but messy." For a product that charges credit cards, the payment and integrity holes make it **risky**.

You asked for the truth: **do not launch paid pools until the Critical list below is closed.** The pre-season is the right time to fix this — none of it is a rewrite, most are targeted patches, and the foundation underneath is salvageable.

---

# Project Understanding

**What it does:** A SaaS for creating and running NFL/sports pools — Squares (gameday grid), Survivor/Pick'em, Confidence, Margin, Bracket pools (March Madness + conference tournaments), Playoff ranking pools, and Props pools. Managers create a pool, participants join (often paying an entry fee), scores sync live from ESPN, and the app computes winners and payouts. Monetization is per-pool billing + bundles + coupons, via Stripe. There's a super-admin console, an AI "Commissioner," referral credits, and email/SMS notifications.

**Stack:**
- **Frontend:** Vite 7 + React 19 SPA, TypeScript (strict), react-router-dom 7, Tailwind 3, framer-motion, recharts, react-helmet-async, Firebase web SDK. Pure client-side rendering.
- **Backend:** Firebase Cloud Functions (~70 functions, ~14k LOC, mostly gen-2, Node 20, `firebase-functions@7`), Firestore, Stripe, Google Gemini, Courier (SMS/email).
- **Deploy:** Two contradictory paths — Firebase Hosting (`firebase.json`) **and** a Dockerfile + `nginx.conf` (Coolify). README documents only the Docker path.

**Architecture at a glance:** SPA talks directly to Firestore (reads via `onSnapshot`) and calls Cloud Functions for privileged writes. Firestore security rules are the real trust boundary for direct reads/writes; Functions are the trust boundary for money and scoring. Business logic lives partly in functions, partly in the client, and partly duplicated across both.

**Live check results:**
- `npm run build` → **passes** (tsc + vite, 29s).
- `npm run lint` → **fails: 541 errors** (458 `no-explicit-any`, 69 unused vars, **8 `react-hooks/rules-of-hooks` — real bug risk in `PropsWizard.tsx`**, 14 exhaustive-deps).
- `npm test` → **fails: 13/106 tests red across 3 files** (billing/onboarding flows returning "Pool not found").

---

# What Is Working Well

Tied to evidence, because you asked:

- **Stripe webhook idempotency is done correctly.** `functions/src/stripe.ts:474-499` creates a per-event marker doc `stripeWebhookEvents/{event.id}` inside `runTransaction`, with poisoned-marker recovery. Signature verified via `constructEvent(req.rawBody, sig, secret)` (`stripe.ts:460-468`). This is the hard part of billing and it's right.
- **Standard (non-bundle) pool pricing is server-authoritative.** `stripe.ts:250-295` resolves `serverPrice` from `settings/billing_config` and ignores client price; the `$0` path requires a validated free reason. (The bundle path does *not* — see Critical.)
- **Scoring engines are pure and genuinely tested.** `functions/src/nflScoringEngine.ts` is I/O-free; `tests/synthetic-scenarios.test.ts` runs invariant/property tests over 1,000+ random brackets; `replay-2025.test.ts` replays a real tournament. These are real assertions, not scaffolds.
- **Transactional scoring with idempotent replay.** `audit_dedupe` keyed docs (`audit.ts:29-41`); `transaction.getAll` pre-reads before writes (`scoreUpdates.ts:636-641`); correct 400-op batch chunking exists in `bracketScoring.ts:293-319` and `espnBracket.ts:1400-1452`.
- **Slug uniqueness done the correct Firestore way** — dedicated `slugs/{slug}` doc in the same transaction (`bracketPools.ts:145-169`).
- **Admin actions mostly use tamper-proof JWT claims** (`request.auth.token.role === 'SUPER_ADMIN'`) rather than mutable Firestore fields (`poolOps.ts:133`, `backfill.ts:5`, `userManagement.ts`).
- **Real code-splitting.** `App.tsx:12-48` lazy-loads ~25 routes; `vite.config.ts:28-32` splits vendor chunks; `dist/assets` confirms route-level chunks.
- **Strict TypeScript everywhere**, ESLint recommended preset with **zero rules disabled** (debt is visible, not hidden), `.env`/`dist`/`node_modules` correctly untracked.
- **Good docs exist:** `CONTEXT.md` is a real glossary; `docs/annual-bracket-setup-runbook.md` is a genuine ops runbook.

---

# Biggest Risks

1. **Three payment bypasses.** (a) Self-granted `poolCredits`/`activeBundleType` — Firestore rules don't block those fields (`firestore.rules:184-192`) and `stripe.ts:213-329` trusts them. (b) Client-supplied bundle `price` used directly for Stripe `unit_amount` (`stripe.ts:94-184`) — pay $0.50 for unlimited. (c) `createPool`/`createNFLPool` spread the raw client payload, so a client sends `billing:{status:'active'}` and skips payment entirely (`nflPools.ts:54-65`, `poolOps.ts:54-64`).
2. **Any user can rig any real-money pool.** `simulateGameUpdate` checks only `request.auth`, then processes attacker-supplied scores as ADMIN on an arbitrary pool and persists winner docs (`scoreUpdates.ts:1186-1229`). `submitPlayoffPicks` accepts arbitrary `rankings` (`rankings:{KC:100000}` = guaranteed win, `playoffPools.ts:136-157`). `syncPlayoffPools` has its auth check commented out (`playoffPools.ts:467-468`).
3. **No safety net on deploy.** Tests are red on `main` and the only CI is a security-scan workflow — **no build/lint/test gate on PRs** (`.github/workflows/security-scan.yml`). A broken change ships silently.
4. **Score sync collapses under real load.** `syncGameStatus` fetches ESPN + transacts sequentially per pool under a 60s timeout (`scoreUpdates.ts:1034-1155`) → ~100-150 pools/run max; at 1k pools most stop updating, silently.
5. **World-readable pool docs leak player PII.** `firestore.rules:24` `allow get: if true` + player email/name stored inside the pool doc's `squares` array (`squares.ts:96-98`).
6. **SEO architecture works against you.** Pure CSR, `<SEO>` component wired to 1 of ~15 routes, stale sitemap, zero crawlable internal links, no OG tags in `index.html` (social shares of invite links render blank — kills the viral loop).
7. **God components.** `SuperAdmin.tsx` is 3,976 lines / 63 `useState`; `BracketPoolDashboard.tsx` 2,222; `Grid.tsx` 1,467. Every future admin/billing change concentrates risk here.

---

# Detailed Findings By Category

## Repo and Codebase Structure

**Finding:** Junk and secrets-adjacent artifacts are committed. **Evidence:** `git`-tracked at root: `git_superadmin.txt` (190 KB, its own `.gitignore` comment says "may contain sensitive data"), `deploy_log*.txt`, `lint_report.txt`, `test-output.txt`, `user_prompt.txt`, 3× `security_scan_results*.json`, `codemod.cjs`, `replace_script*.py`, `tmp_replace.py`, `old_conference.ts`, `debug_espn.cjs`, plus `functions/lib/` (96 compiled JS files) and `.firebase/hosting.*.cache`. `.gitignore` lists many of these — but gitignore doesn't untrack. **Why it matters:** leaks internal structure + service-account email; bloats the repo; confuses new devs. **Fix:** `git rm --cached` the lot; audit `git_superadmin.txt`/scan JSON for leaked data before scrubbing.

**Finding:** 57% of tracked files are non-product tooling. **Evidence:** `skills/` (308 files) **and a full duplicate `skills_backup/` (303 files)** — 611 of 1,066 tracked files. CI depends on one file inside `skills/`. **Why:** signal-to-noise for anyone cloning this. **Fix:** delete `skills_backup/`; move the CI scanner into `scripts/`; evict `skills/`.

**Finding:** `src/components/` is a 70+ item grab-bag mixing pages, dashboards, wizards, modals with no domain grouping. **Evidence:** `ls src/components` — `LandingPage.tsx`, `SuperAdmin.tsx`, `Grid.tsx`, `NFLPoolWizard/`, `BracketWizard/` all siblings. **Why:** ownership is unclear; a new dev can't find things. **Fix:** group by domain (`marketing/`, `pools/nfl/`, `pools/bracket/`, `admin/`, `shared/`).

## Frontend Architecture

**Finding:** God components at unmaintainable scale. **Evidence:** `SuperAdmin.tsx` 3,976 lines / 63 `useState` / 61 `window.confirm|alert`; `BracketPoolDashboard.tsx` 2,222 / 51 `useState`; `admin/SuperAdminBillingPanel.tsx` 1,665; `Grid.tsx` 1,467; `routes/PoolRoute.tsx` 922 (it's a page, not a route wrapper). **Why:** any state change re-renders the whole tree; 50+ interdependent `useState` have invariants nobody can verify; this is where AI-edit regressions concentrate. **Fix:** split by tab/panel into lazy child components + `useReducer`/extracted hooks.

**Finding (live bug):** Broken redirect ships users to the homepage after saving settings. **Evidence:** `AdminPanel.tsx:205` `window.location.href = \`/ pool / ${gameState.id} \`` — literal spaces from an old codemod; falls through to the `*` catch-all. **Why:** managers lose their pool context on every settings save. **Fix:** `` `/pool/${gameState.id}` ``.

**Finding:** `react-hooks/rules-of-hooks` violated 8× in one file. **Evidence:** `PropsWizard.tsx:42-53` calls `useState` conditionally. **Why:** conditional hooks cause state to bind to the wrong slot across renders — real, hard-to-reproduce corruption. **Fix:** move all hooks above any early return.

**Finding:** No client state management; 40+ props drilled from `App`. **Evidence:** `App.tsx:260-273` repeats `user`/`isLoggedIn`/`onLogin`/`onLogout`/`onCreatePool` to every route; the only context, `ThemeContext`, is a no-op (`ThemeContext.tsx:13-23`, theme hardcoded, `toggleTheme` empty); `PoolRoute` keeps a *duplicate* auth-modal state. **Why:** unmemoized callbacks re-render ~20 lazy routes; adding auth-derived data means touching every route. **Fix:** an `AuthContext`; delete or implement `ThemeContext`.

**Finding:** Accessibility is effectively unstarted. **Evidence:** across all `.tsx`: 0 `aria-label`, 0 `role="dialog"`, 0 `aria-modal`, no focus trap/restore, no Escape handling in `modals/`, 10 clickable `<div onClick>`. **Why:** keyboard/screen-reader users can't operate auth or share flows; legal exposure for a paid consumer product. **Fix:** headless dialog primitive (Radix/HeadlessUI) for the 3 modals; aria-labels on icon buttons.

## Backend Architecture

**Finding (Critical):** `createPool`/`createNFLPool` spread the raw client payload with no allowlist. **Evidence:** `nflPools.ts:54-65`, `poolOps.ts:54-64` `const newPool = { ...data }`. **Why:** client sends `billing:{status:'active',tier:'premium',maxPlayersAllowed:9999}` / pre-seeds `participantIds`, `entryCount` — defeats every billing gate. **Fix:** explicit field allowlist on creation; billing state set server-side only.

**Finding (Critical):** Transaction-retry corrupts scores. **Evidence:** `scoreUpdates.ts:342-350` builds `espnScores` (with a home/away swap) *outside* `runTransaction` (`:1114-1123`); on retry the swap runs twice → reversed scores → wrong squares paid. **Why:** retries are most likely exactly during Sunday contention. **Fix:** deep-clone inside the callback or make the swap pure.

**Finding (Critical):** Unchunked batch breaks at 500 ops. **Evidence:** `nflPools.ts:551,691` one `batch.update` per entry in a single commit; `saveAndPropagateResults` (`playoffPools.ts:82,130`) same. **Why:** Pick'em pools >500 entries / Margin >250 throw on commit and score *nobody*. The correct chunking pattern already exists elsewhere — this is inconsistency. **Fix:** 400-op chunking (copy `bracketScoring.ts:300-319`).

**Finding (High):** Business logic duplicated and drifting across 4 paths. **Evidence:** the free-plan 10-cap is enforced against three *different* data sources — `participantIds.length` (`nflPools.ts:158`), `entryCount` (`bracketEntries.ts:38`, `propBets.ts:71`), `Object.keys(entries)` (`playoffPools.ts:169`). Role checks split between JWT claims and Firestore `users.role`. **Why:** the same pool can be "full" in one flow, open in another; the existence of `fixParticipantIds`/`fixPoolScores`/`recalculatePoolWinners` is the codebase compensating for the drift. **Fix:** one shared `poolMembership` service; standardize on JWT claims for roles.

**Finding (High):** Non-transactional read-modify-write in join/purchase paths. **Evidence:** `purchasePropCard` (`propBets.ts:57-98`) checks cap then `add()` then a *separate* `increment`; `joinBracketPool` (`bracketPools.ts:244-247`) `increment(1)` on every call (double-click inflates `participantCount`). **Why:** concurrent joins exceed caps; counters drift permanently. **Fix:** wrap in transactions; dedupe membership before incrementing.

## Database and Data Model

**Finding (High):** Playoff entries stored as a map *inside* the pool doc — 1 MB time bomb. **Evidence:** `types.ts:514`, written `playoffPools.ts:182` `entries: Record<string,PlayoffEntry>`; no total-entry cap. **Why:** ~500 entries approaches the 1 MB doc limit and bricks the whole pool; unvalidated `rankings` (Critical C3) makes it a deliberate DoS vector. Survivor/pick'em correctly use subcollections — playoff is the outlier. **Fix:** move to a `pools/{id}/entries` subcollection.

**Finding (High):** Hot, unbounded documents rewritten on every sync. **Evidence:** tournament doc `set`s the full `games` map + raw ESPN blobs (67 events of JSON) on one doc every 10 min (`espnBracket.ts:928,948-952`); `scoreEvents` unbounded `arrayUnion` on the pool doc (`scoreUpdates.ts:673`) alongside the 100-square array. **Why:** every listener re-downloads the entire doc each minute during live games; approaches size limits. **Fix:** diff-and-skip writes; move raw blobs to a separate doc.

**Finding (High):** Plaintext pool passwords in schema. **Evidence:** `types.ts:504,635` `accessControl.password` "separate from passwordHash for editing" — and pool docs are participant-readable. **Why:** the plaintext password is exposed to every participant read. (The PBKDF2 hash itself is done well.) **Fix:** drop the plaintext field; edit via a function.

**Finding (Medium):** No migration discipline. **Evidence:** no `schemaVersion` field anywhere; schema changes via ad-hoc scripts in `functions/scripts/`; `backfill.ts:68-71` uses `FieldValue.increment` (not idempotent — re-run double-counts). **Fix:** add `schemaVersion`; make backfills set-based.

**Finding (Medium):** Composite indexes may be missing. **Evidence:** only 8 indexes in `firestore.indexes.json`; queries like `season+seasonType+week` (`nflPools.ts:226`), `billing.status+trialEndsAt` (`billing.ts:31`), `referredUserId+status` (`referral.ts:23`) need indexes not obviously present. **Fix:** verify each is deployed or the query fails in prod.

## SEO Architecture

**Finding (Critical):** `<SEO>` component used on exactly 1 of ~15 routes. **Evidence:** `<SEO>` rendered only in `LandingPage.tsx:94`; `MarchMadnessLanding`, `NFLPlayoffsLanding`, `GamedaySquaresLanding`, `FeaturesPage`, `PricingPage`, etc. set no title/description/canonical. Articles set `document.title` imperatively only. **Why:** every marketing page renders with the title "March Melee Pools" and the homepage description — your keyword-targeted landers have zero title targeting. **Fix:** add `<SEO>` to every public route (the component exists — hours of work).

**Finding (Critical):** Pure CSR + catch-all rewrite; no prerender/SSR/SSG. **Evidence:** `firebase.json` + `nginx.conf` both `** → /index.html`; no SSG plugin in `vite.config.ts`. **Why:** social crawlers (Facebook/Twitter/Slack/iMessage) don't run JS, so helmet-injected OG tags are invisible — every shared invite link (`/join/:poolId`) renders blank, suppressing the core viral loop. Googlebot renders JS but LCP suffers behind the full React+Firebase chain. **Fix (in ROI order):** (1) bake default OG/Twitter/canonical into `index.html` today; (2) build-time prerender the ~15 static routes; (3) a Cloud Function bot-rewrite for `/join/:poolId` OG previews; (4) longer-term, move marketing pages to Astro/Next SSG on the same domain.

**Finding (High):** Sitemap stale and wrong; internal links are JS-only. **Evidence:** `public/sitemap.xml` lists 10 URLs, missing `/march-madness`, `/nfl-playoffs`, `/gameday-squares`, `/pricing`, articles; includes app-only `/create-pool`. Marketing pages have ~0 crawlable `<a href>` — CTAs are `onClick={()=>navigate()}`. **Why:** Google discovers URLs via `<a href>`, not button clicks; your pages are near-orphans held together only by a broken sitemap. **Fix:** regenerate sitemap from the route table in the build; replace `navigate()` CTAs with `<Link>`.

**Finding (Medium):** `SEO.tsx` default `url` canonicalizes to homepage. **Evidence:** default `url` prop → any page adopting `<SEO>` without passing `url` emits `canonical=https://www.marchmeleepools.com/` — self-deindexing. **Fix:** make `url` required or derive from `useLocation()`.

## Performance and Scalability

**Finding (High):** Global Firestore subscriptions on every page view. **Evidence:** `App.tsx:136-141` subscribes to ALL public pools (`dbService.ts:532` `where isPublic==true`, **no `limit()`**) + global stats for every visitor on every page including `/privacy`. Admin dashboard uses `subscribeToAllPools` — every pool doc streamed, re-firing on every score write (`dbService.ts:559-561`). **Why:** read billing scales with pool count × concurrent visitors; App-level re-renders on unrelated writes. **Fix:** move subscriptions into consumers, add `limit()`, use one-shot `getDocs` for stats.

**Finding (High):** Scheduled full-collection scans every minute/5-min. **Evidence:** `autoLock.ts:21-24` scans every unlocked squares pool each minute (`lockAt` checked in memory — the bracket query right below does it correctly); `reminders.ts:82-89` `db.collection("pools").get()` every 5 min + N+1 user reads; `nflSchedule.ts:227-229` unbounded historical scan every 5 min. **Why:** ~1.4M wasted reads/day at 1k pools, and the 1PM lock wave locks grids *after* kickoff. **Fix:** queryable `lockAt` filters; diff-before-write.

**Finding (High):** No ESPN fetch caching/timeout/retry. **Evidence:** `scoreUpdates.ts:86-92` one `summary` fetch per pool per minute; P pools on the same game = P identical fetches; nulls each write an error doc; no `AbortController`. **Why:** ~1k un-cached fetches/min from one IP → throttling → error-doc flood. **Fix:** fetch each `gameId` once with timeout + retry/backoff, fan out to pools.

**Finding (Medium):** Entry-path bundle is heavy. **Evidence:** first paint loads `index` 313 KB + `vendor-firebase` 390 KB + `vendor-react` 47 KB + CSS 140 KB ≈ 890 KB pre-gzip before any route chunk; `constants.ts` is 888 lines of hardcoded tournament data (76 KB chunk). **Fix:** move constants to JSON fetched on demand; ensure `vendor-charts` (404 KB) isn't pulled by an eager module.

## Security and Production Readiness

**Finding (Critical):** Self-granted paid plan via unprotected user fields. **Evidence:** `firestore.rules:184-192` blocks only `role`/`referralCredits`/`freePoolsAvailable` on self-write — `poolCredits`/`activeBundleType`/`bundleExpiresAt` are writable; `stripe.ts:213-329` trusts them. **Attack:** `updateDoc(users/me, {poolCredits:[{id:'x',isUsed:false}]})` then `createCheckoutSession({usedCredit:true,customCreditId:'x'})` → $0 active pool. **Fix:** add all billing fields to the denied `affectedKeys()` set; credits minted only by functions.

**Finding (Critical):** Bundle checkout trusts client `price`. **Evidence:** `stripe.ts:94-184` builds Stripe `unit_amount: Math.round(price*100)` from client `price` and returns before the server-price resolution; webhook grants purely from `metadata.bundleType` (`:511-559`). **Attack:** `createCheckoutSession({bundleType:'unlimited_1yr', price:0.5})` → pay 50¢ for a year. **Fix:** resolve bundle price server-side; validate `session.amount_total` in the webhook.

**Finding (High):** World-readable pool docs leak PII. **Evidence:** `firestore.rules:24` `allow get: if true`; `squares.ts:96-98` stores `playerDetails:{email,...}` + full `billing` inside the pool doc. **Fix:** gate reads; move PII to a function-written restricted subcollection.

**Finding (High):** Unauthenticated expensive AI callables. **Evidence:** `aiTesting.ts:95,142,189` are `onCall` with 300s/1GiB and Gemini secrets, **no `request.auth` check**. **Why:** anyone drains your Gemini quota / does financial DoS + prompt injection. **Fix:** require SUPER_ADMIN + App Check.

**Finding (Medium):** App Check initialized but never enforced. **Evidence:** `src/firebase.ts:24-31` inits App Check; no function sets `enforceAppCheck`. **Fix:** enforce on money/admin/AI callables with a staged rollout.

**Finding (Medium):** Cross-pool data exposure in rules. **Evidence:** `firestore.rules:129-134` pool `messages` readable by any signed-in user; `:149-157` locked `entries` readable by any authenticated user; `:110-115` `ai_requests` same. **Fix:** scope to participants/owner.

**Finding (Low):** Mock-Stripe fallback activates real billing when the key is absent. **Evidence:** `stripe.ts:28-34,98-150` — missing key → grants credits with a mock session id. **Why:** a prod deploy that forgets the secret makes everything free. **Fix:** gate behind explicit `ALLOW_MOCK_CHECKOUT`; hard-fail in prod if unset.

**Finding (Low):** Previously-committed Gemini key. **Evidence:** `.env` self-warning "ROTATE IT IMMEDIATELY"; `CODE_REVIEW_REPORT.md:183`. `.env` now untracked, but history isn't purged. **Fix:** rotate; `git filter-repo` to scrub history.

## Maintainability and Developer Experience

**Finding (Critical):** Red tests on `main`, no CI gate. **Evidence:** `npm test` → 13/106 failing (`onboarding-flow.test.ts:473` etc.); only CI is `security-scan.yml`; `.husky/pre-commit` is one line (`python scripts/scan_secrets.py`) — no lint/test. **Fix:** add a `pull_request` job running `tsc -b && eslint . && vitest run`; fix/quarantine the 13 reds first.

**Finding (Critical):** Functions tests never run anywhere. **Evidence:** `functions/src/__tests__/{billing,coupon,referral}.test.ts` (1,094 LOC, 69 tests) excluded from root vitest; `functions/package.json` has no `test` script; their compiled JS is committed under `functions/lib/`. **Fix:** add `"test":"vitest run"` to `functions/package.json`; run in CI.

**Finding (High):** Type-safety erosion despite `strict:true`. **Evidence:** ~385 `any`/`as any` total (130+143 in src, 80+32 in functions); `functions/src/stripe.ts:18` types the Stripe client `any` — in the money path; `noUncheckedIndexedAccess` off everywhere. **Fix:** type the Stripe client; chip away at `any` in billing/scoring first.

**Finding (High):** `defineString` for a secret. **Evidence:** `stripe.ts:14` `STRIPE_SECRET_KEY` via `defineString` (value visible in config) where `gemini.ts:5`/`smsService.ts:3` correctly use `defineSecret`. **Fix:** switch to `defineSecret`.

**Finding (High):** Contradictory deploy story. **Evidence:** `firebase.json` (with CSP header) vs `Dockerfile`+`nginx.conf` (no CSP); README documents only Docker. **Fix:** pick one, document it, align security headers, mark the other legacy.

**Finding (Medium):** Zero component/rules tests. **Evidence:** 132 components, 1 component test; no `@firebase/rules-unit-testing` for the actual security boundary. **Fix:** rules-emulator tests for the billing fields (would have caught the Criticals).

---

# Top 10 Priority Fixes

| # | Fix | Priority | Effort | Impact | Area | Why now |
|---|-----|----------|--------|--------|------|---------|
| 1 | Allowlist fields in `createPool`/`createNFLPool`; block `poolCredits`/`activeBundleType`/`bundleExpiresAt` in `firestore.rules` | **Critical** | Small | Large | Security/Backend | Two of the three free-pool bypasses; trivial to exploit, direct revenue loss |
| 2 | Server-authoritative bundle pricing in `stripe.ts` + webhook amount check | **Critical** | Small | Large | Security | 50¢-for-unlimited bypass |
| 3 | Lock down `simulateGameUpdate`, restore `syncPlayoffPools` auth, validate playoff `rankings` | **Critical** | Small | Large | Backend | Any user can rig any real-money pool's winners |
| 4 | Add CI gate (build+lint+test on PR); fix the 13 red tests | **Critical** | Medium | Large | DX | Nothing stops a broken paid-flow deploy today |
| 5 | Deep-clone `espnScores` per txn attempt; chunk `scoreNFLWeek` batches; fix Margin re-rank | **Critical** | Medium | Large | Backend | Silent score corruption + total scoring failure >500 entries |
| 6 | Fix score-sync scale: dedupe ESPN fetch by gameId, bounded concurrency, timeout/retry, raise timeout | **High** | Medium | Large | Backend/Infra | Most pools stop updating on a busy Sunday |
| 7 | Stop world-readable PII: gate pool `get`, move emails to restricted subcollection | **High** | Medium | Large | Security/DB | Player email/name harvestable by pool-ID |
| 8 | SEO pass: `<SEO>` on all routes, OG tags in `index.html`, regenerate sitemap, `<Link>` CTAs | **High** | Medium | Large | SEO | Blank invite-link previews kill the growth loop |
| 9 | Queryable `lockAt` filter + Fisher-Yates in `autoLock`; App Check on money/AI callables | **High** | Small | Medium | Backend/Security | Grids lock after kickoff; AI quota drain |
| 10 | Repo cleanup: `git rm --cached` junk + `functions/lib/`; delete `skills_backup/`; audit `git_superadmin.txt` | **Medium** | Small | Medium | DX | Info leakage + repo hygiene before more devs touch it |

---

# Files and Folders That Need the Most Attention

- **`functions/src/stripe.ts`** — bundle pricing bypass, `any`-typed client, `defineString` secret, mock-billing fallback. The money path; highest scrutiny.
- **`functions/src/scoreUpdates.ts`** (1,200+ lines) — `simulateGameUpdate` auth hole, transaction-retry corruption, sequential ESPN loop, unbounded `scoreEvents`. The live-scoring heart, and the load bottleneck.
- **`functions/src/playoffPools.ts`** — commented-out auth, unvalidated rankings, entries-in-doc 1 MB bomb, non-transactional writes. Multiple Criticals in one file.
- **`firestore.rules`** — the direct-access trust boundary; unprotected billing fields, world-readable pools, cross-pool reads.
- **`functions/src/nflPools.ts`** / **`poolOps.ts`** — raw payload spread on pool creation (bypass #3), unchunked batches, counter drift.
- **`src/components/SuperAdmin.tsx`** (3,976 lines) — largest maintainability risk; every admin change lands here.
- **`src/services/dbService.ts`** (1,097 lines) — unbounded global subscriptions; bypasses the `BaseRepository` abstraction.
- **Repo root** — 16 junk/log/secret-adjacent tracked files + `skills_backup/`.

---

# Architectural Smells

- **God components / god services:** `SuperAdmin.tsx`, `dbService.ts`, `scoreUpdates.ts`, `playoffPools.ts`.
- **Duplicated business logic:** free-plan cap in 4 places over 3 data sources; wizard step/state logic quadruplicated (`BracketWizard`/`PlayoffWizard`/`NFLPoolWizard`/`PropsWizard`), with `WizardStepBranding.tsx` existing in two directories.
- **Weak boundaries / client trust leakage:** raw payload spread into docs; client-supplied price; role checks split between JWT and Firestore.
- **Hidden coupling:** 6 `onDocumentWritten` triggers on `pools/{id}` all fire on every score write; `syncMyClaims` copies Firestore role into the JWT — safe *only* because one rules clause holds.
- **SEO bolted on, not designed in:** one page tagged, CSR-only, JS-only nav.
- **MVP shortcuts that age badly:** the fleet of `fix*`/`recalculate*` functions is the system patching over counter drift and the `reservedByUid` bug rather than fixing roots; `window.confirm/alert` ×61 in an admin billing surface.
- **Config sprawl:** two deploy targets with divergent security headers; `vite.config.ts` doubles as prod build config *and* test-mock harness (`resolve.alias` mocks apply to prod builds).

---

# What Will Hurt Later If Ignored

- **Counter/membership drift** (`participantIds` via `arrayUnion` in 5 places, never pruned on delete) → free-plan slots consumed by deleted users; billing disputes.
- **Playoff entries + tournament blobs in single docs** → silent 1 MB wall that bricks a pool mid-season.
- **No `schemaVersion` + non-idempotent backfills** → every future migration is a hand-run script with double-count risk.
- **The `any` epidemic in scoring/billing** → the exact paths where a type error silently pays the wrong person.
- **SEO CSR debt** → compounding; every month without crawlable content is lost ground to SSR incumbents.
- **God components** → merge-conflict and regression magnets as the team grows.

---

# SEO Verdict

**Is it architected well for SEO? No.** It's a pure CSR SPA with a catch-all rewrite; one of ~15 pages has proper meta/JSON-LD; the sitemap is stale and internal links aren't crawlable; `index.html` has no OG tags, so every shared invite link previews blank — which hurts the *viral* loop as much as search. **What's missing today:** per-route titles/descriptions/canonicals, OG/Twitter defaults, a correct sitemap, crawlable `<a>` links, route-specific structured data, and any server-rendered HTML. **What must change for strong organic performance:** bake OG into `index.html` and wire `<SEO>` to every route now; add build-time prerender + a bot-rewrite for `/join/:poolId`; then migrate marketing/content pages to SSG (Astro fits, same domain) and invest in a real content hub. **Is the model helping or hurting? Hurting** — the rendering strategy actively works against both SEO and social sharing.

---

# Scalability Verdict

**Can the backend scale as-is? No, not to your stated 1k pools / 50k users on a Sunday.** **What breaks first, in order:** (1) `syncGameStatus`'s sequential ESPN+transaction loop hits the 60s timeout at ~100-150 pools and silently stops updating the rest; (2) the 1PM `autoLockPools` wave locks grids *after* kickoff and the `stats/global` single-doc increment burst contends; (3) ESPN throttles ~1k un-cached fetches/min and floods `system_logs`; (4) ~6k trigger invocations/min from the 6 pool-doc triggers. **Refactor before growth:** fetch dedupe + bounded concurrency + caching in score sync; queryable `lockAt` filters; sharded counters for `stats/global`; playoff entries → subcollection; chunked batches everywhere. **Can wait:** cold-start lazy-loading of Stripe/Gemini SDKs, `BaseRepository` consolidation, trigger consolidation.

---

# Maintainability Verdict

**Could a good dev maintain this without pain? Partially.** The strict TS, clean scoring engines, and good domain docs help; but god components (SuperAdmin 3,976 lines), duplicated wizard/cap logic, ~385 `any`, red tests with no CI gate, and repo junk mean day-to-day changes are riskier than they should be. **Organized enough for a growing team? Not yet** — too many changes concentrate in a few mega-files, and there's no automated gate to catch regressions. **Highest-leverage refactors:** (1) CI gate + green tests; (2) `AuthContext` to kill prop drilling; (3) decompose `SuperAdmin.tsx` and `dbService.ts`; (4) one shared pool-membership/cap service; (5) one `useWizard` hook + shared step components.

---

# Suggested Ideal Structure

```
src/
  app/                      # App shell, router, providers
    routes.tsx              # nested layout routes + <RequireAuth>
  contexts/
    AuthContext.tsx         # user, claims, openAuth, logout  (replaces prop drilling)
  features/
    marketing/              # landing + landers + articles (candidate for SSG extraction)
    pools-nfl/              # wizard, dashboard, scoring views
    pools-bracket/
    pools-squares/
    pools-playoff/
    pools-props/
    billing/
    admin/                  # super-admin split into panel-per-file
  shared/
    components/             # Button, Dialog (a11y), Card...
    hooks/                  # useWizard, usePoolSubscription
    seo/                    # SEO.tsx + schema builders
  services/
    firebase.ts
    repositories/           # one data-access style (extend BaseRepository); delete raw dbService sprawl

functions/src/
  domains/{billing,scoring,pools,brackets,playoff,props,notifications}/
  lib/                      # shared: poolMembership (caps), fieldAllowlists, espnClient (cached), auth guards
  triggers/                 # consolidated pool-doc triggers
  index.ts                 # thin barrel; lazy-import heavy SDKs in handlers
```

**Boundaries:** all money + winner + cap logic lives in Functions behind explicit field allowlists and JWT-claim guards; the client never writes billing/score/role fields (enforced by rules AND allowlists). **SEO concerns** live in `shared/seo` + prerender/SSG config, applied per route. **Shared utilities** (caps, allowlists, ESPN client, auth guards) live in `functions/src/lib` and are the *single* source of truth the four pool types call.

---

# Refactoring Plan

## Phase 1: Quick wins (days)
- Close Criticals #1-#3 (field allowlists, bundle pricing, `simulateGameUpdate`/`syncPlayoffPools` auth, rankings validation).
- Fix the 8 `rules-of-hooks` in `PropsWizard.tsx` and the `AdminPanel.tsx:205` redirect.
- Bake OG tags into `index.html`; regenerate the sitemap.
- `git rm --cached` junk + `functions/lib/`; delete `skills_backup/`; rotate/scrub the Gemini key.
- Switch `STRIPE_SECRET_KEY` to `defineSecret`; gate the mock-Stripe path.

## Phase 2: Structural cleanup (weeks)
- Add CI gate; fix/quarantine the 13 red tests; wire up functions tests.
- Introduce `AuthContext`; delete/implement `ThemeContext`.
- Extract one shared pool-membership/cap service and a `useWizard` hook; de-dupe wizard step components.
- Decompose `SuperAdmin.tsx` and `dbService.ts`; add `<SEO>` + `<Link>` to all marketing routes.

## Phase 3: Scale-readiness (weeks)
- Score-sync: ESPN fetch dedupe/cache/timeout/retry + bounded concurrency; raise timeouts.
- Queryable `lockAt`; sharded `stats/global`; playoff entries → subcollection; chunk all batches.
- Move global subscriptions into consumers with `limit()`; verify composite indexes.

## Phase 4: Production hardening (ongoing)
- Enforce App Check on sensitive callables; add rules-unit-tests + gitleaks to CI.
- Add `schemaVersion` + idempotent backfills; structured error logging (no raw `err.message` to client).
- Accessibility pass on modals; performance budget in CI; decide + document the single deploy target.

---

# Testing Strategy Recommendation

- **Unit:** keep/extend the pure scoring-engine tests (already strong); add unit tests for the new cap/allowlist/ESPN-client `lib` utilities.
- **Integration:** `@firebase/rules-unit-testing` against the emulator for `firestore.rules` — specifically the billing-field write attempts (would have caught two Criticals); functions integration tests for `createCheckoutSession`, the Stripe webhook, `createPool` allowlist, and playoff rankings validation.
- **E2E:** Playwright for the money-critical journeys — create pool → pay → join → live score → payout; run against emulators in CI.
- **Contract:** snapshot/contract test the ESPN response parser so upstream format changes fail loudly, not silently.
- **SEO validations:** CI check that every route emits a unique `<title>`/canonical and that the sitemap matches the route table; Lighthouse budget on marketing pages.
- **Performance:** bundle-size budget in CI; a load test simulating N pools through `syncGameStatus`.
- **CI gates:** `tsc -b` + `eslint .` + `vitest run` (root **and** functions) required on every PR; block merge on red.

---

# Final Score

| Area | Score (1-10) |
|------|:---:|
| Architecture | 5 |
| Frontend structure | 5 |
| Backend structure | 5 |
| Database design | 4 |
| SEO architecture | 2 |
| Performance/scalability | 4 |
| Security | 3 |
| Maintainability | 5 |
| Developer experience | 4 |
| Production readiness | 3 |
| **Overall** | **4 / 10** |

**Justification:** There's real skill here — the Stripe idempotency, the transactional audit-dedupe scoring, the tested pure engines, and the code-splitting are the work of someone who knows what they're doing, and none of the problems are unfixable. But the score reflects readiness *to charge customers*, and by that bar the app is not ready: three independent payment bypasses, any-user winner-rigging, red tests with no CI gate, PII exposure, and a score engine that quietly fails under the exact Sunday load you're building for. Close the Critical list (most are small, targeted patches — a focused week or two), add a CI gate so it stays closed, and this moves to a 6-7 quickly. Ship paid pools before then and you will lose money and trust.
