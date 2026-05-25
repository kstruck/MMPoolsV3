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
* **AI Commissioner (Gemini-Powered):** Neutral, zero-hallucination assistant providing:
  * **"Why I Won":** Generates human-friendly explanations of winning coordinates.
  * **Dispute Helper:** Validates the immutable audit trail to verify that coordinates were generated fairly and payouts are mathematically sound.
* **Immutable Audit Trail:** All critical operations (locking, number generation, transactions) are logged to an append-only collection. Client writes are locked down via Firestore rules for absolute integrity.
* **Global Stats & Prizes:** Total prize money tracker updates via secure Cloud Functions (`onPoolCompleted`) to display all-time winnings on the home landing page.

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

---

### 👑 Super Admin & Simulation Suite
Full-control dashboards for site administrators.
* **Real-time Feature Flags:** Instantly toggle "Bracket Pools" or trigger "Maintenance Mode" globally.
* **Simulation Dashboard:** Verify game logic, standings math, and automated email/SMS alerts:
  * **Scenario Runner:** Simulate entire matches or tournaments round-by-round.
  * **Auto-Fill Grids:** Stress-test payment splits with 1,000+ random entries.
* **Targeted Pool Repair:** Emergency "Fix Pool Scores" tool to recalculate specific pools without affecting global data.

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

4. **Run Development Server**

    ```bash
    npm run dev
    ```

    The app will be available at `http://localhost:5173`.

---

## 🧪 Testing

Run the automated test suite to verify scoring logic and edge cases:

```bash
npx vitest run
```

Includes:
* **2025 Tournament Replay:** Validates scoring engine against realistic bracket scenarios.
* **Synthetic Scenarios:** Stress-tests the engine with 1,000+ combinations of random picks and results to ensure invariant integers (e.g. Max Possible Score >= Current Score).

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

### Firestore Security Rules
* **Audit Log:** `read: true` for transparency, `write: false` for everyone (Client-side writes blocked).
* **Clients:** Explicitly blocked from writing to sensitive fields like `isLocked` and `axisNumbers`.
* **Users:** Can only write to their own user profile.

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
