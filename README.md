# March Melee Pools & Gridiron Gamble (MMPoolsV3)

A premium, modern, real-time sports pool platform designed for ultimate engagement and commissioner ease of use. MMPools supports classic **NCAA March Madness Brackets**, a complete **NFL Season Pool Suite (Weekly Pick'em, Survivor, Margin)**, high-fidelity **Gameday Squares**, and custom **Prop Bet Sheets**. 

Built with React 19, TypeScript, and Tailwind CSS on the frontend, and backed by a robust Firebase serverless infrastructure, the application features real-time scores, automatic winner calculations, secure audit trails, and an AI Commissioner to resolve disputes instantly.

---

## 🚀 Features

### 🏈 NFL Season Pools Suite (NEW!)
A comprehensive full-season NFL suite equipped with robust scoring engines, scheduled locks, and dynamic configurations.
* **Weekly Pick'em Pools:** Outright winner selection of every scheduled game each week.
  * **Confidence Mode:** Assign unique confidence weights (from 1 to N games). Correct picks earn points equal to the weight assigned.
  * **Primetime Game Bonuses:** Configure custom bonus points for Thursday Night Football (TNF), Sunday Night Football (SNF), and Monday Night Football (MNF) selections.
  * **Flex-Lock Modes:** Choose between per-game kickoff lock or a weekly lock (locks at kickoff of first game of the week).
  * **Payout Modes:** Supports Season-long standings, Weekly "Sharp" payouts, or Hybrid (Season + Weekly) payout formats.
  * **Weekly Tiebreaker:** Predict the combined score of the Monday Night Football game.
* **Survivor Pools:** The ultimate test of endurance.
  * **Double Play Modes:** Standard mode (pick a team to win) or "Pick Losers Mode" (pick a team to lose).
  * **Mulligans & Strikes:** Configure "Sudden Death" (0 strikes) or allow up to N strikes/mulligans before elimination.
  * **Rebuys:** Set up custom rebuy rules allowing users to buy back in before a specific deadline week (e.g., Week 4) at a custom rebuy price.
  * **Bye Week Exemption:** Smart "Auto-Survive" exemption prevents elimination when a participant has zero eligible teams left to pick.
* **Margin Pools:** High-stakes point differential tracking.
  * **Margin Scoring:** Pick a single team each week. Your score is their victory or defeat margin (e.g., win by 14 = +14, lose by 7 = -7). No team can be picked twice.
  * **Default Penalty:** Missing submissions penalize the participant with an automatic `-14` margin score.
  * **5-Level Tiebreaker Standings Cascade:**
    1. Highest Season Total victory margin.
    2. Lowest Negative Burden (sum of absolute values of negative margins).
    3. Most Positive Weeks (winning selections > 0 margin).
    4. Highest Single-Week margin score.
    5. Deterministic ID comparison.
* **NFL Playoff Challenge (Rank 'Em):** Confidence pool designed specifically for the NFL postseason.
  * **Drag-and-Drop Picker:** Interactive UI to reorder and rank all 14 playoff teams from 14 (most confident) to 1 (least confident).
  * **Round Multiplier Scoring:** Points scale with each round (x1 Wild Card, x2 Divisional, x4 Conference, x8 Super Bowl).
  * **Seed Underdog Bonus:** Optional configuration to reward underdog wins with extra points.
* **Real-Time Scoring Pipeline (NEW!):** A multi-tier automated scoring engine built for a live NFL season. The jobs that grade picks or lock spreads ship behind kill-switches and dry-run gates (fail-closed) and are enabled explicitly per season; the score-feed sync itself runs continuously.
  * **Provisional Live Scoring:** Scores update as games go final, with a fenced scoring lease so only one scorer can grade a week at a time.
  * **Durable Reconciliation Queue:** A rescore queue re-grades weeks when late stat corrections land, and a deep-sweep job catches corrections that arrive more than 24 hours after a game.
  * **Feed Snapshots & Replay:** When enabled, ESPN payloads are snapshotted best-effort (deduplicated against the previous response); a week can be rebuilt from a stored snapshot, and the scorer only grades what the feed actually reported.
  * **Automated Spread Locks:** Scheduled spread-lock job with a kill-switch, dry-run gate, and a pre-kickoff tripwire that pages ops if spreads aren't locked in time.
* **Polished Pick Flow (NEW!):** Saved picks are unmistakable — green saved highlights, a saved banner, and a pick-status strip that always speaks about the current week. Plus one-tap registration from the join page, a picks call-to-action on the dashboard, live lock countdowns, team win/loss records in the picker, and consistent week labels across every surface (including preseason/HOF weeks).
* **Straight Up or Against the Spread:** The setup wizard lets Pick'em commissioners choose straight-up or ATS picking (with a heads-up that ATS requires locked spreads), and straight-up Pick'em, Survivor, and Margin pools open for picks without waiting on spreads at all.
* **Smart Setup Wizard:** Prefills the commissioner's contact details from their profile (and remembers what it learns), stamps the season automatically instead of asking, and links the Terms of Service inline.
* **Hard Weekly Deadlines:** Survivor and Margin pools enforce a hard weekly pick deadline server-side — no late submissions, no exceptions.

---

### 🏀 College Basketball (March Madness & Conference Tournaments)
Fully featured tournament suite designed to maximize excitement during Selection Sunday and the tournament run.
* **Multi-Tournament Engine:** Full-fledged bracket engines for the NCAA Tournament (6 rounds), Big 12 Tournament (5 rounds, bye-team support), and Big East Tournament (4 rounds).
* **Interactive Bracket Builder:** Sleek, drag-and-drop-like picker with "Smart Fill" capability for rapid bracket completion.
* **Upset Bonus Logic:** Configure multiplier or flat bonuses for selecting lower-seeded underdog upsets.
* **Standings & Live Leaderboard:** Round-by-round scoring, active leaderboards, and real-time standings.
* **What-If Simulator:** Interactive sandbox that lets users simulate remaining games to see hypothetical standings.
* **Advanced Analytics:** "Who to Root For" engine calculates exact win probabilities and potential ranks in real-time.
* **Export Utilities:** Export standings to CSV files or generate beautiful brackets as printable PDFs.

---

### ⏹️ Gameday Squares (Super Bowl & Football Grids)

> 🛑 **Creation is temporarily closed (2026-08-30).** New Squares pools cannot be
> created or purchased — the entry points read "Coming Soon" and the `createPool`
> callable refuses the type. **Existing Squares pools are unaffected**: they still
> open, score, and pay out.
>
> Why: the wizard defaulted `maxSquaresPerPlayer` to `0` and labelled it
> "(0 = no limit)", but the claim gate refuses whenever
> `mySquares >= maxSquaresPerPlayer` — so at `0` every non-owner was refused their
> **first** square and the pool was unplayable by anyone but its commissioner.
> Shipping that to buyers was worse than not shipping it. The fix list, and the
> decision already taken (`0` means unlimited — fix the callable, not the wizard),
> is in [`SQUARES-BACKLOG.md`](SQUARES-BACKLOG.md). Reopening is two constants and
> a deploy.

A high-fidelity implementation of the classic football squares grid.
* **Interactive 100-Square Grid:** Real-time square reservations, payments, and live axis numbers.
* **Hybrid Winner Highlighting:** Visually distinguishes between standard period winners (Gold/Trophy) and "Every Score" event winners (Purple/Zap), with custom dual gradients.
* **CSPRNG Numbers Generation:** Transactional axis numbers generator that supports a new set of random coordinates for every quarter ("4 Sets" mode).
* **Final Prize Randomizer:** Secure final draw button that picks a winner from occupied squares if the final score lands on an empty grid intersection.
* **Off the Top Charity:** Automated charity calculations that deduct a custom percentage of the pot to support non-profit causes.

---

### 🎯 Custom Prop Bets ("Side Hustle" Pools)
Add custom betting cards alongside any major sport event.
* **Dual-View Dashboard:** Enter and view picks on the left, check the live leaderboard on the right.
* **Global Seed Catalog:** SuperAdmins can manage standard question templates to spin up a pool in seconds.
* **Manager Grading Deck:** Quick-grading panel to award points instantly for correct props.
* **Integrated Tiebreaker:** Custom score predictor to break ties at the top of the leaderboard.

---

### 🛠️ Core Experience & Smart Engine
The foundational system powering MMPools.
* **Live Scoreboard V2:** Intelligent, robust syncing with ESPN API featuring:
  * **Fuzzy Match Game Detection:** Pairs active pools with scheduled matches without hardcoded IDs.
  * **Score Locking:** Lock and persist quarter scores as they happen, preventing data corruption from API fluctuations.
  * **Live Ticker:** Real-time ticker displaying active scores, TV networks, and game clocks.
* **Participant Dashboard V2:** Redwood-styled home for players featuring unified entries (public, joined, private), smart status tracking (badges, progress bars), and real-time tabs for "Open", "Live", and "Completed" pools.
* **Player Profiles:** Public player profile pages with season stats, a league-average comparison chart line, and shareable entry points across the app.
* **AI Commissioner (Gemini-Powered):** Neutral, zero-hallucination assistant providing:
  * **"Why I Won":** Generates human-friendly explanations of winning coordinates.
  * **Dispute Helper:** Validates the immutable audit trail to verify that coordinates were generated fairly and payouts are mathematically sound.
* **Immutable Audit Trail:** All critical operations (locking, number generation, transactions) are logged to an append-only collection. Client writes are locked down via Firestore rules for absolute integrity.
* **Global Stats & Prizes:** Total prize money tracker updates via secure Cloud Functions (`onPoolCompleted`) to display all-time winnings on the home landing page.

---

### 🧑‍💼 Commissioner Console (NEW!)
A rebuilt manager experience focused on truth, not guesswork.
* **Four-Section Manager Page:** The pool manager view is organized into focused sections with a save control in every settings section and a floating save confirmation — no more hunting for the right button.
* **Submission Health:** At-a-glance view of who has and hasn't submitted picks this week — including the manager's own entry.
* **Buy-In Ledger:** Complete payment picture covering every member, not just those with entries.
* **Payment Truth:** Member payment state has a single canonical writer (`setPaidStatus`) carrying method/date detail fields, and rebuys have their own paid control. (Bracket entries keep their own entry-level payment writer.)
* **Hosting-Fees Banner:** Managers see a clear "hosting fees paid" confirmation banner, dismissible once acknowledged.

---

### 📢 Management, Communications & Invites
Streamline pool administration and communication.
* **Reorganized Pool Selection Hub:** Modern `/create-pool` dashboard prioritizing active NFL & Gameday pools. Features "Offseason Muting & Gray-out" to hide basketball pools during spring/summer.
* **Customizable Host Profiles:** Pool managers can set their name, custom contact methods (email, phone, both, or none), and paste clickable **Venmo**, **Zelle**, or **Google Pay** links directly into setup wizards and pool invites.
* **Communication Suite:** Pre-styled HTML emails sent via Cloud Functions and Trigger Email extension:
  * **Welcome & Pick Confirmations:** Detailed breakdowns sent immediately upon entry.
  * **Smart Payment Receipts:** Instantly generated when marked PAID by a manager.
  * **Payment Due Alerts:** Automatically sent exactly **2 hours before pool lock**.
  * **Post-Game Recaps:** Automated summaries with winners and payout highlights.
* **Email Broadcast Tool:** Rate-limited BCC mass emails with custom targets (All, Paid, Unpaid).
* **Waitlist Engine:** Secure waitlist collection and admin invite deck for grids exceeding 100 entries.
* **Viral Referral System:** Attribution-based referral links (`?ref=`) that reward managers and track signups.
* **Smart Reminders:** Integrated with SMS (Courier/Twilio) and Web-Push (FCM) to notify users of locks, payment deadlines, and scores.
* **Submission Tracking:** Email and SMS sends report whether the email queue and SMS provider accepted them, so the reminder engine can see (and surface) submission failures instead of silently swallowing them.

---

### 👑 Super Admin & Simulation Suite
Full-control dashboards for site administrators.
* **Real-time Feature Flags:** Instantly toggle "Bracket Pools" or trigger "Maintenance Mode" globally.
* **Simulation Dashboard:** Verify game logic, standings math, and automated email/SMS alerts:
  * **Scenario Runner:** Simulate entire matches or tournaments round-by-round.
  * **Auto-Fill Grids:** Stress-test payment splits with 1,000+ random entries.
  * **Kill-Switch Bypass:** Super-admin simulation runs bypass pool-type kill-switches, so disabled pool types can still be tested safely.
* **Targeted Pool Repair:** Emergency "Fix Pool Scores" tool to recalculate specific pools without affecting global data.
* **Production Watchdog (NEW!):** A single dashboard showing the last 24 hours of real user activity — signups, entries, picks, payments — so admins can see the platform breathing.
* **Scheduled-Job Heartbeats (NEW!):** Every scheduled job in the fleet reports a heartbeat with a rendered health verdict, making "never ran" instantly distinguishable from "ran clean" or "ran and failed".
* **Config Audit Trail:** Every write to system configuration is logged (`SYSTEM_CONFIG_CHANGED`) to the immutable audit trail.
* **Stats Integrity Engine:** Real pot calculation across all pool types, a shared test-pool predicate that keeps simulations out of public stats, and a daily scheduled recompute to keep global numbers honest.

---

## 💸 Pricing & Plans

Flexible plans that scale with your pool size. Every plan starts with a **14-day free trial**, and an interactive **price estimator** calculates exact cost based on active entries.

| Plan | Price | Best For |
| --- | --- | --- |
| **Free Sandbox** (Casual Friends) | `$0` / forever | Small groups — full premium engine, no setup or host fees. |
| **Dynamic Premium Pool** ⭐ *Featured* | Starts at `$9` / pool | Medium-to-massive pools. Scale-with-size tiers based on active entries — pay only for active players. |
| **3-Pool Bundle** | `$49` / bundle | Hosts running multiple pools across a season. |

> Setting up a pool, configuring rules, and registering members is always free. Premium tiers unlock massive leagues and branded layouts.

**The free plan holds 10 participants.** The 11th person is refused at the join
gate with *"This pool is full, so your spot could not be reserved. Ask the
commissioner to make room — they can upgrade the pool to raise its limit."* The
commissioner is emailed at 8 and again at 10, and the create wizard states the
limit before they invite anyone. One constant
(`FREE_PLAN_PARTICIPANT_CAP`, `shared/freePlanCap.ts`) is read by every gate,
every email, the commissioner banner and the wizard, so the number promised is
the number enforced. On entry-counted formats (Bracket, Playoffs, Props) the cap
counts **entries**, not distinct people.

### 💳 Where the money actually moves

This distinction is load-bearing and easy to get wrong:

* **Stripe handles hosting fees only** — what a *commissioner* pays *us* to run a
  premium pool. Live since 2026-08-30.
* **Entry fees never touch the platform.** Members pay their commissioner
  peer-to-peer (Venmo, Zelle, CashApp, PayPal, Google Pay). The app records the
  amount and whether someone has paid; it moves none of it. Every prize figure on
  every screen is an **estimate the commissioner settles** — which is why the
  Payment Ledger says so in as many words.

---

## 🛠️ Tech Stack

* **Frontend:** React 19, TypeScript, Vite
* **Styling:** Tailwind CSS, Lucide React (Icons)
* **Backend / Data:** Firebase (Firestore, Auth, Cloud Functions v2)
* **APIs:**
  * **Data:** ESPN (Scoreboard)
  * **AI:** Google Gemini (AI Commissioner Features)
  * **Email & SMS:** EmailJS, Courier API, Twilio, & Firebase Trigger Email
* **Deployment:** Docker (Nginx serving static assets)

---

## 💻 Local Developement Setup

1. **Clone the repository**

    ```bash
    git clone https://github.com/kstruck/MMPoolsV3.git
    cd MMPoolsV3
    ```

2. **Install Dependencies**

    ```bash
    npm install
    ```

3. **Environment Configuration**
    Create a `.env` file in the root directory with your Firebase configuration:

    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```

4. **Install Cloud Functions dependencies and stage `shared/`**

    ```bash
    npm --prefix functions ci
    node functions/scripts/copy-shared.mjs
    ```

    `shared/` is compiled INTO the functions bundle, so it is copied to
    `functions/src/shared` rather than imported across roots. Skip this and the
    root test suite fails several files with `Cannot find module '../shared/...'`.

5. **Run Development Server**

    ```bash
    npm run dev
    ```

    The app will be available at `http://localhost:5173`.

---

## 🧪 Testing

⚠️ **`npx vitest run` is one of SEVEN gates, not the suite.** The root
`tsconfig` does not include `functions/`, so `npx tsc -b` can never see a type
error in Cloud Functions code — a PR touching `functions/src/**` needs the
functions-scoped commands explicitly. CI runs all of them.

```bash
node functions/scripts/copy-shared.mjs      # FIRST on a fresh clone - see below
npx vitest run                              # root suite
npm --prefix functions test                 # functions unit suite
npm --prefix functions run test:emulator    # against live Firestore emulators
npm --prefix functions run test:rules       # firestore.rules
npx tsc -b && npm run build                 # frontend typecheck + build
npm --prefix functions run typecheck        # functions typecheck
npm --prefix functions run build            # functions build
npm run lint                                # delta must be ZERO
```

**Current green baseline** (`main`, 2026-08-31): root **3067** passed across 159
files · functions **2149** · emulator **606** passed / 2 expected-fail / 10
skipped · rules **13/13** · lint **1872 warnings, 0 errors**.

Two environment notes that otherwise cost an hour each:

* **`copy-shared` first.** `shared/` is copied into `functions/src/shared` at
  build time. On a fresh clone or worktree the root suite fails several files
  with `Cannot find module '../shared/...'` until you run it.
* **The emulator and rules suites bind ports 4400/8080 machine-wide.** Two runs
  at once fail instantly with "Could not start emulator hub, port taken". That is
  a collision, not a red gate — wait and re-run.

What the suites cover, beyond unit scope:
* **2025 Tournament Replay:** validates the scoring engine against realistic bracket scenarios.
* **Synthetic Scenarios:** stress-tests with 1,000+ random pick/result combinations to hold invariants (e.g. Max Possible Score >= Current Score).
* **Emulator arcs:** whole-season NFL runs — scoring, finalization, rescore, multi-entry, member records — against real Firestore.
* **Rules tests:** every Firestore security rule that guards money, membership, or admin surfaces.
* **Copy-vs-code guards:** a large set of tests assert that member-facing sentences match the code that enforces them, so reversing a rule fails the build rather than shipping a lie.

---

## 🔒 Authentication & Security

This project relies on **Firebase Cloud Functions (2nd Gen)** to enforce game integrity and prevent cheating.

### Cloud Functions (`/functions`)

Sensitive operations are moved off the client-side to a trusted Node.js environment:
* `lockPool(poolId)`: Securely locks the grid and generates the random 0-9 axis numbers using server-side CSPRNG. Logs the action to the secure Audit Trail.
* `reserveSquare(poolId, squareId)`: Handles square purchases transactionally with race-condition prevention. Added to Audit Log.
* `syncGameStatus` (Scheduled): Polls ESPN every 5 minutes (during games) to update scores and **generate new quarterly numbers** if the "4 Sets" rule is active.
* `runReminders` (Scheduled): Runs periodically to check for unpaid squares or upcoming locks and sends notifications.
* `onWinnerComputed` (Trigger): Listens for game score updates to instantly notify winners via email.

That list is the Squares-era core. The deployed surface is now ~24 scheduled jobs
plus the callables; the ones worth knowing:

* `createPool` / `createNFLPool`: the only way a pool is created. Enforce
  maintenance mode, pool-type kill-switches, and the hard-closed type list.
* `submitNFLPicks`: membership, spread-lock, per-game and weekly deadline gates.
  Refuses `SPREADS_NOT_LOCKED` **only** for against-the-spread Pick'em —
  straight-up, Survivor and Margin never wait on a line.
* `nflAutoScoreJob` (runs `*/5`): the live scorer, behind a kill-switch and a fenced
  per-week lease so two passes can never grade the same week.
* `lockNFLSpreadsJob` (Tue 09:00 ET): freezes the week's betting lines. The pool
  page tells members that day and time, read from this schedule.
* `nflLockWatchJob`: pre-kickoff tripwire — pages ops if spreads aren't locked.
* `handleStripeWebhook`: the only writer of paid billing state. Ledger rows are
  written in the SAME transaction as the pool mutation, so a ledger failure fails
  the webhook and Stripe retries.
* `enforceBillingStatus` (23:00 ET nightly): trial → grace → locked.
* `recordPoolPayouts` / `setPayoutSettled`: the Payment Ledger's writers.
  Deterministic ids, so recording twice records once.
* `runReminders`, `sendPoolInvites`, `manageEmailPrefs`: mail, with a global and
  per-category unsubscribe that **fails open** — broken opt-out infrastructure
  must never silently suppress a deadline email.

### Trust-Boundary Hardening (NEW!)
* **Trust-Boundary Sweep:** Sensitive Cloud Function callables — across billing, pools, squares, brackets, props, referrals, and admin ops — were retrofitted with input validation (zod schemas) and role checks at the trust boundary via a shared `validated()` wrapper. Remaining plain-`onCall` endpoints are classified and tracked for hardening in `SECURITY-BARE-ONCALL-CLASSIFICATION.md`.
* **Server-Side Billing Enforcement:** Billing status is enforced in Cloud Functions, not the client — a modified client cannot bypass hosting-fee gates.
* **Membership Integrity:** Payment and repair operations can no longer mint or launder member records; membership has one legitimate write path.
* **Error Monitoring:** Client-side Sentry with a correctly scoped CSP, so production errors surface instead of silently dropping.

### Firestore Security Rules
* **Audit Log:** `read: true` for transparency, `write: false` for everyone (Client-side writes blocked).
* **Clients:** Explicitly blocked from writing to sensitive fields like `isLocked` and `axisNumbers`.
* **Users:** Can only write to their own user profile.
* **Server-Only Fields:** Scoring, settings-publish state, and stats flags are writable only by Cloud Functions.

### Email Service (Extension)
Uses the **"Trigger Email from Firestore"** extension to send transaction confirmations.

---

## 🚀 Deployment Guide (Coolify / Docker)

This project is configured for deployment using **Docker**.

### Prerequisites
* A Coolify instance (or any Docker-based hosting platform).
* A connected GitHub repository.

### Steps
1. **Create Service:** In Coolify, add a new resource -> "Git Repository".
2. **Select Repository:** Choose `kstruck/MMPoolsV3` and the `main` branch.
3. **Build Pack:** Select **Dockerfile**. The included `Dockerfile` handles the multi-stage build (Vite build -> Nginx serve).
4. **Environment Variables:** Add your Firebase config variables (same as `.env` above) into the Coolify Secrets/Environment Variables section.
5. **Expose Port:** Ensure Coolify maps the container's internal Port `80` to your desired domain.
6. **Deploy:** Click "Deploy".

### Production Notes
* **Nginx:** The project uses a custom `nginx.conf` to handle client-side routing (SPA fallback to `index.html`).
* **Caching:** A script in `index.html` automatically unregisters legacy Service Workers to prevent caching issues from older versions of the app.

---

## 🔁 The backend is a SEPARATE deploy

The Coolify steps above ship **only the frontend**. Anything touching
`functions/`, `shared/`, `firestore.rules` or `firestore.indexes.json` also needs
a Firebase deploy — and a change can easily need both.

```bash
git -C <path-to-main-checkout> pull --ff-only origin main   # STEP ZERO
npm --prefix functions ci                                   # ci, NOT install
npx firebase deploy --project gridiron-gamble-uzuqo
```

🛑 **Step zero is not optional, and skipping it fails silently.**
`firebase deploy` builds from **local files, not GitHub**. Deploying from a
checkout that has not pulled ships the OLD code and still prints
`Deploy complete!`. The tell is an *absence* — a newly added function simply
never appears in the output — so verify by name afterwards:

```bash
npx firebase functions:list | Select-String "<newCallableName>"
```

`npm --prefix functions ci` rather than `install`: `install` rewrites the
lockfile and dirties the tree that `firebase deploy` packages.

**Verify the frontend actually shipped** by diffing the bundle hash before and
after the Coolify redeploy — an unchanged hash means it shipped nothing:

```bash
curl.exe -s https://www.marchmeleepools.com/ | Select-String "index-[A-Za-z0-9_-]*\.js"
```

Note that the app is code-split: a feature's strings often live in a lazy chunk
(`PaymentsPanel-*.js`, `launchFields-*.js`, …), not in `index-*.js`. Grepping
only the index bundle will tell you a shipped feature is missing.

### Secrets

Server secrets are Firebase Secret Manager values, never `.env`:

```bash
npx firebase functions:secrets:set STRIPE_SECRET_KEY --project gridiron-gamble-uzuqo
npx firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project gridiron-gamble-uzuqo
```

**A new secret version is inert until the functions are redeployed.** Setting it
alone changes nothing.

Stripe is **live** as of 2026-08-30 — test cards now decline, and that is the
correct behaviour. The code cannot tell test from live (any `sk_`/`rk_` key is
accepted), so check the deployed value rather than assuming:
`npx firebase functions:secrets:access STRIPE_SECRET_KEY`. Probing the webhook
endpoint, **400** means healthy (missing/bad signature) and **503** means the key
is not usable in the deployed function.
