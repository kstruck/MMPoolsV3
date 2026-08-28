# Morning 2026-08-28 — launch-eve session

Overnight session, worktree `D:\march-melee-pools\.claude\worktrees\mmp-launch-blocker-fe7634`.
Started from `origin/main` at `c30a6957`.

Everything Kevin has to DO is written out in full below. Nothing in this file
says "see another document".

---

## 0. THE ONE DECISION WAITING FOR YOU

**A SQUARES pool created through the wizard and left on its default cannot be
played by anyone except you.** The wizard defaults `maxSquaresPerPlayer` to `0`
and labels it "(0 = no limit)". Nothing implements "no limit" — the callable
refuses a claim whenever `mySquares >= pool.maxSquaresPerPlayer`, and at 0 that
is every non-owner's FIRST square. Verified at `functions/src/squares.ts:93`.

**Question: does `0` mean unlimited (fix the callable), or is `0` invalid (fix
the wizard)?**

**My recommendation: Option A — 0 means "no limit".** One guard in the callable,
five client readers reconciled to one meaning, help copy rewritten.

The deciding argument: **Option A needs no production-data answer.** Any pool
already stored at 0 starts working the moment the function deploys, with zero
Firestore writes. Option B (make 0 invalid) fixes only pools created after the
redeploy and turns every existing 0-pool into a plan-gated prod-data migration —
on launch day.

**If you reply "approve as recommended", I implement Option A in one PR:** the
zero guard in `functions/src/squares.ts`, one shared helper replacing the five
disagreeing client readers, the help topic rewritten, the deliberate drift-pin
test in `tests/help-content-squares-props.test.ts` inverted, new behaviour tests,
every guard mutation-tested. Then all seven gates, codex review, and a PR.
**It needs BOTH deploys: `npx firebase deploy` AND a Coolify redeploy.**

The other options, briefly: **B** — forbid 0, wizard `min={1}`, default 100,
frontend-only so no `firebase deploy`, but existing 0-pools stay broken.
**C** — A plus changing the wizard default to a real number; two changes at
once on launch eve and it buys nothing on a 10×10 grid. **D** — ship nothing and
just type a number yourself before inviting; rejected, because the default is the
trap and every future commissioner walks into it.

Full plan of record: `PLAN-SQUARES-ZERO-LIMIT.md`, pushed on branch
`claude/squares-zero-limit-plan`.

### Optional: answer the production-data question in one command

Not required for Option A — it works either way — but it tells you whether any
of your live squares pools are broken right now. **It is READ-ONLY and never
writes.** You need a service-account key JSON.

1. Open PowerShell.
2. Point at your service-account key (substitute your real path):

```bash
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\serviceAccountKey.json"
```

3. Run the census:

```bash
node "D:\march-melee-pools\.claude\worktrees\mmp-launch-blocker-fe7634\functions\scripts\censusSquaresMaxPerPlayer.mjs"
```

4. **What you should see:** three summary lines — `scanned N SQUARES pools`, how
   many `refuse a non-owner's FIRST square today`, and how many `have no value
   stored at all`. Any blocked pool is printed as a `BLOCKED {...}` line with its
   id and name.
5. **If you don't see that:** an exit with `Set GOOGLE_APPLICATION_CREDENTIALS`
   means step 2 did not take — re-run it in the same PowerShell window as step 3.
   Skip it entirely if you have no key handy; it changes nothing about the fix.

---

## 1. What merged

**[PR #628](https://github.com/kstruck/MMPoolsV3/pull/628) — merged, squashed as
`f161b51d`.** Branch deleted. Details below.

Note: **[#627](https://github.com/kstruck/MMPoolsV3/pull/627) (`8811faf0`) landed
from another session between my last gate run and my merge**, so #628 went in
without a rebase-and-regate on top of it. I therefore re-ran **all seven gates
against merged `main` at `f161b51d`** rather than assume it. They are green:

```
npx vitest run                     157 files / 2969 passed
npm --prefix functions test        132 files / 2138 passed
functions test:emulator            605 passed, 2 expected fail, 10 skipped
functions test:rules               13/13
npx tsc -b && npm run build        clean, built in 10.98s
npm --prefix functions typecheck   clean
npm --prefix functions build       clean
npm run lint                       1881 problems, 0 errors
```

No file overlap between the two PRs, and no semantic interaction surfaced.

## 2. What is open

### PR #628 — survivor rules copy — **MERGED as `f161b51d`**

Two member-facing survivor rules were shipped saying something other than what
the code does. Display only; no scorer, callable or rule changed.

- `NFLPoolRules.tsx` rendered an ABSENT `settings.autoSurviveExemptionEnabled` as
  **"Disabled"**, while the scorer reads it as `?? true`
  (`functions/src/nflScoringEngine.ts:704`). Every survivor pool created before
  that field existed showed its members the OPPOSITE of the rule it was being
  scored under.
- The rules page said rebuys were allowed **"before"** the cutoff week.
  `executeSurvivorRebuyInternal` refuses only `week > rebuyDeadlineWeek`
  (`functions/src/nflPools.ts:1074`) — the cutoff week itself still accepts a
  buy-back. Shipped copy was one week narrower than the callable.

Codex found three more defects across three rounds, all accepted and fixed: the
displayed rebuy price ignored the callable's `?? settings.entryFee` fallback; an
ABSENT cutoff was folded into the "none can be taken" branch when it actually
means no cutoff at all; and the pick sheet's own `?? 4` default hid the buy-back
button from week 5 on a pool the server would have accepted all season. Round 3
came back clean and my read of the diff agrees.

Six guards were mutation-tested — broken one at a time, each observed RED, then
restored. The red output for each is in the PR body.

Gates on the branch: root vitest 155 files / **2943** passed (baseline 2925,
+18); functions 132 / 2138; emulator 605 passed / 2 expected fail / 10 skipped;
rules 13/13; both typechecks and both builds clean; **lint 1881 / 0 errors,
delta ZERO**.

**Classification: ordinary, not plan-gated.** No money, no authorization
(`functions/` untouched — the changed client gate governs a BUTTON, and it moves
from narrower-than-server to equal-to-server, so it cannot permit anything the
server refuses), no production data, no scoring.

### Branch `claude/squares-zero-limit-plan` — no PR, deliberately

Carries `PLAN-SQUARES-ZERO-LIMIT.md` and the read-only census script. Rebased
onto `f161b51d` and pushed (`ab6d7187`). **Waiting on your §0 decision.** No code
written.

---

## 3. What needs deploying, and how to check it shipped

### 3a. PR #628 is merged — it needs a Coolify redeploy, and nothing else

No `firebase deploy` is needed. Nothing under `functions/`, `shared/`,
`firestore.rules` or `firestore.indexes.json` changed.

1. Before anything, record the CURRENT bundle hash. In PowerShell:

```bash
curl.exe -s https://www.marchmeleepools.com/ | Select-String "index-[A-Za-z0-9_-]*\.js"
```

2. Write down the `index-XXXX.js` filename it prints.
3. Open the Coolify dashboard and trigger a manual redeploy of the `www` service.
   Pushing to `main` does **not** auto-deploy the frontend. This ships BOTH
   `f161b51d` (#628, mine) and `8811faf0` (#627), since neither has been
   deployed yet.
4. Wait for Coolify to report the deploy finished.
5. Run the same command from step 1 again.
6. **What you should see:** a DIFFERENT `index-XXXX.js` filename.
7. **If the hash is unchanged, the redeploy shipped NOTHING.** Re-trigger it, and
   check Coolify pulled the new commit.

### 3b. If you approve §0 Option A — BOTH deploys, functions FIRST

That PR does not exist yet. When it does, the order is:

1. Pull the main checkout first. **This step has silently shipped nothing twice.**

```bash
git -C D:\march-melee-pools pull --ff-only origin main
```

2. Install functions deps with `ci`, not `install`:

```bash
npm --prefix D:\march-melee-pools\functions ci
```

3. Deploy:

```bash
npx firebase deploy --project gridiron-gamble-uzuqo
```

4. **What you should see:** `Deploy complete!` and `reserveSquare` named in the
   updated-functions list.
5. **If `reserveSquare` is not named**, the deploy shipped the old code — the
   tell is an absence. Confirm the checkout actually moved (`git -C
   D:\march-melee-pools log --oneline -1`) and redo from step 1.
6. Then do the Coolify redeploy exactly as in §3a.

---

## 4. Launch-readiness audit

Every line is PASS / FAIL / UNVERIFIED with the command or `file:line` that
proves it.

### 4.1 The join flow, end to end — **PASS**

- `/join/:poolId` route exists: `src/App.tsx:500`.
- It resolves BOTH a doc id and a slug: `JoinPool.tsx:48` calls
  `dbService.subscribeToPool`, which branches at `dbService.ts:1515` (`length ===
  20` ⇒ doc id) and otherwise runs an `or(urlSlug, slug)` query with `limit(1)`.
- **It takes NO payment.** There is no Stripe call, no checkout, no card field
  anywhere in `JoinPool.tsx`. The only money on the page is display copy —
  `JoinPool.tsx:191` renders `settings.entryFee`, and `:250` explains the fee is
  charged PER ENTRY on a multi-entry pool. Nothing implies the site collects it.
- The signed-out path stores the join intent in `sessionStorage` and opens the
  Create Account face rather than a sign-in form (`JoinPool.tsx:59-65`), then
  finishes the join automatically once signed in (`:94-102`).

### 4.2 Invite and share links — **PASS**

- `firestore.rules:100` — `allow get: if true` on `pools/{poolId}`, so a
  signed-out visitor can open `/pool/<docId>`.
- `firestore.rules:107` — `allow list: if (request.query.limit <= 1) || …`, and
  the slug lookup carries `limit(1)`. So slug links work signed-out too.
- Invite emails link to `https://www.marchmeleepools.com/pool/{slug|id}`
  (`functions/src/invites.ts:82`, `BASE_URL` at `emailStyles.ts:5`) — the correct
  production domain.
- Rich link previews work on the real host: `nginx.conf:53-77` proxies social
  crawlers on `/pool/` and `/join/` to the `joinPreview` function while humans
  get the SPA. (`firebase.json`'s rewrites do NOT apply — prod www is
  nginx/Coolify, not Firebase Hosting.)

**One narrow caveat, not a blocker:** `dbService.ts:1515` decides "this is a doc
id" from `identifier.length === 20`. A slug that happens to be exactly 20
characters long is looked up as a doc id, misses, and renders "not found".
Nothing generates 20-character slugs today; I did not fix it.

### 4.3 A brand-new user's first run — **PASS**

- `users/{uid}` is created on registration AND re-synced on every login:
  `authService.ts:50-73` (`syncUserToFirestore` writes the doc when absent).
- **A user who has never entered a pool has NO `publicProfiles/{uid}` doc.**
  `recomputeUserProfile` only writes it (`userProfile.ts:131`) and is triggered by
  `pools/{poolId}/entries/{entryId}` writes. Both readers already handle the
  absence:
  - Bracket standings fall back `publicProfiles.userName → entry.name →
    'Unknown'` (never the raw uid), per-uid `try`/`catch`, and **re-read the
    names that are still fallbacks on the next snapshot** — so a profile that
    lands after the entry is picked up without a reload. That was #626's codex r1
    P2 fix.
  - `/profile/:uid` self-heals: a member viewing their own profile before one
    exists calls `recomputeMyProfile` once per visit
    (`src/pages/PlayerProfile.tsx:103-112`).

### 4.4 Email — **PASS (armed)**

- The delivery mechanism is the Firebase Trigger Email extension, and it is
  live. Measured, read-only:

```bash
npx firebase ext:list --project gridiron-gamble-uzuqo
```

  → `firebase/firestore-send-email`, instance `firestore-send-email`, state
  **ACTIVE**, v0.2.4. `sendEmail` (`functions/src/reminders.ts:74`) writes to the
  `mail` collection, which is what that extension consumes.
- The invite callable and both unsubscribe endpoints are deployed. Measured:

```bash
npx firebase functions:list --project gridiron-gamble-uzuqo
```

  → `sendPoolInvites` (callable), `manageEmailPrefs` (https),
  `emailUnsubscribe` (https), plus `joinPreview`, `reserveSquare`,
  `nflAutoScoreJob` and `enforceBillingStatus`.
- **Unsubscribe exists and is compliant.** Every non-transactional send checks a
  global opt-out and a per-category preference before sending, and stamps a
  footer link to the preference centre (`reminders.ts:52-72`,
  `emailPrefs.ts:60-74`). It **fails open**: if the opt-out store is unreachable,
  deadline and payment mail still goes out rather than being silently suppressed.

**UNVERIFIED:** whether a real message actually lands in a real inbox right now.
That needs a live send, which I did not do. If you want certainty before
inviting, send yourself one invite first and confirm it arrives.

### 4.5 Other wizards broken on their defaults — **PASS: SQUARES is the only one**

I checked every create wizard's `defaultValues` block against the callable that
consumes it, then swept the callables for the shape of the squares bug — a `>=`
against a settings number that a default of 0 makes always-true:

```bash
grep -rnE ">=\s*(pool\.)?(poolData\.)?settings\.|>=\s*(pool|poolData)\.[a-zA-Z]+\)" functions/src/*.ts functions/src/lib/*.ts
```

Exactly two hits in non-test code:

- `functions/src/squares.ts:93` — the launch blocker in §0.
- `functions/src/nflPools.ts:1103` — `entry.rebuysUsed >= settings.maxRebuys`,
  with a wizard default of `maxRebuys: 0`. **Correct**: zero buy-backs allowed
  means every buy-back is refused, which is what the setting says.

Everything else clears:

| Pool type | The default that could have blocked play | Verdict |
|---|---|---|
| BRACKET | `scoringSystem: 'CLASSIC'`; no `maxEntriesPerUser` (server stamps `-1`, `bracketEntries.ts:65` only enforces `> 0`) | fine |
| NFL_PICKEM | `maxEntriesPerUser: 1` — first entry is `0 >= 1`, false | fine |
| NFL_SURVIVOR | `maxStrikes: 1` — engine eliminates at `strikesUsed >= maxStrikes + 1` (`nflScoringEngine.ts:355`), i.e. 2 wrong picks | fine |
| NFL_MARGIN | `maxEntriesPerUser: 1`, `payoutMode: 'SEASON'` | fine |
| NFL_PLAYOFFS | `lockDate: ''` → `toMillis` returns `undefined` → field dropped; `playoffPools.ts` has no lockDate gate. `maxEntriesPerUser || 50` | fine |
| PROPS | `props.maxCards: 1`; server reads `maxCards \|\| 1` (`propBets.ts:56`), first card is `0 >= 1`, false | fine |

**One finding worth knowing, not a blocker, not fixed** (per your instruction not
to fix item-5 findings without asking): `propsCreateInputSchema` declares
`questions: z.array(...).default([])` with **no minimum**
(`shared/schemas/props.ts:21`), and the props wizard's setup step defaults to
`questions: []`. So a PROPS pool can be created with zero questions — members
would buy a card with nothing on it. Unlike SQUARES this is visible to the
commissioner on the screen where it happens, and nobody would share it, so I left
it. Say the word and it is a one-line `.min(1)` plus a wizard test.

### 4.6 Two things you should know before you send invites — **not defects, but they will bite**

**(a) A free pool hard-stops at 10 participants.** The 11th invitee is refused
with *"This pool is full, so your spot could not be reserved."* Enforced at
`nflPools.ts:338`, `bracketEntries.ts:48`, `playoffPools.ts:213` and
`propBets.ts:77`. A pool is created `free` whenever the wizard's **Estimated
players** is left at its default of 0 — `estimatedPlayersFromPayload` treats 0 as
"no estimate" and `computeLaunchMode` then returns `'free'`
(`poolOps.ts:216`, `:236`). **If you are inviting more than 10 people, set
Estimated players above 10 when you create the pool**, or the eleventh person
cannot get in.

**SQUARES is the exception:** `reserveSquare` carries no free-plan participant
cap at all, only `checkBillingAccess`. So a squares pool takes unlimited
claimers on the free plan.

**(b) Crossing that threshold starts a 14-day TRIAL, and a trial expires.**
`computeLaunchMode` returns `'trial'` when the estimate exceeds the free
threshold or any paid add-on is ticked. `enforceBillingStatus` runs nightly at
23:00 ET and moves expired trial → `grace_period` → `locked`
(`billing.ts:81`, `:180-196`), and `checkBillingAccess` refuses a `locked` pool
(`lib/billingAccess.ts:27`). For a season-long NFL pool that means it locks
mid-season unless you pay. Worth deciding deliberately rather than discovering
it in week 3.

---

## 5. What is BLOCKED

- **The SQUARES launch blocker.** Plan written and pushed; no code, because it is
  plan-gated (authorization on a money surface) and needs your §0 sign-off.

## 6. What I chose NOT to do, and why

- **Any Priority 4 item.** Payment Ledger (`getAllUsers` vs
  `firestore.rules:856`), bracket UPSET scoring, `tieBreakers.closestAbsolute`,
  the help-registry orphan guard, the coverage-guard holes. Priority 1 is
  unresolved and it is launch eve; two of those are plan-gated in their own
  right.
- **Fixing the PROPS zero-questions case** (§4.5) — your instruction was to
  report item-5 findings, not fix them, unless they are outright blockers. This
  one is not.
- **Fixing the 20-character-slug edge case** (§4.2) — unreachable today, and a
  change to link resolution on launch eve is not worth it for a case nothing
  produces.
- **Reading production Firestore.** The census that answers the §4 data question
  is written, read-only, and handed to you in §0 instead.
- **Any deploy.** Both are yours.
