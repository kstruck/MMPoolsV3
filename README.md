# March Melee Pools (MMPoolsV3)

A modern, real-time sports pool application supporting both **Gameday Squares** and **NCAA March Madness Brackets**. Built for performance, aesthetics, and ease of use, this application allows users to create and manage betting grids and bracket challenges with automated scoring, real-time updates, and extensive customization options.

## 🚀 Features

### Core Experience
*   **Interactive 100-Square Grid:** Real-time selection and ownership tracking.
*   **Live Scoreboard V2:** Intelligent syncing with ESPN. Features fuzzy-match game detection (no gameId required), precise Eastern Time (ET) scheduling, and "Time TBD" handling. Displays quarter-by-quarter status and game clock.
*   **Participant Dashboard V2:** **NEW!** Completely redesigned experience for players.
    *   **Smart Filtering:** Automatically categorizes pools into "Open," "Live," and "Completed" tabs.
    *   **Search:** Quickly find pools by name or team.
    *   **Status Tracking:** Visual progress bars and status badges for every entry.
    *   **Unified Entries:** "My Entries" now seamlessly aggregates every pool you've joined, including private pools you don't manage.
*   **User Profiles:** Users can manage their display name, phone number, and social links via a new Profile Manager. Changes sync instantly across Firestore and Authentication.
*   **Enhanced Visualization:** **NEW!** Dynamic grid highlighting for active rows/columns, winning squares, and paid (Emerald) vs. reserved (Amber) status. Now supports **Hybrid Winner Highlighting**—visually distinguishing between standard period winners (Gold/Trophy) and "Every Score" event winners (Purple/Zap), with special gradients for dual winners.
*   **Dynamic Layouts:** Smart responsive design that adapts to pool settings (e.g., auto-centering status cards when Charity is disabled).
*   **Mobile-Responsive:** fully optimized design for desktop, tablet, and mobile devices.
*   **How it Works Guide:** **NEW!** Comprehensive, step-by-step interactive guide for new users, accessible directly from the main menu.
*   **User Accounts:** Secure Google Authentication and email registration via Firebase.

### March Madness Brackets
*   **64-Team Bracket Challenge:** Full support for the Men's NCAA Tournament.
*   **Interactive Builder:** Mobile-friendly bracket picker with drag-and-drop-like ease.
*   **Live Scoring:** Round-by-round scoring updates with active leaderboard table.
*   **Standings Integration:** View global rankings and entry performance.
*   **Restricted Access:** Currently restricted to SuperAdmin creation only.

### Pool Management
*   **Setup Wizard:** Enhanced 7-step flow to configure teams, costs, reminder rules, and payouts.
*   **Integrated Payments:** **NEW!** Pool managers can now add their **Venmo** handle and **Google Pay** details directly in the setup wizard. Participants see clickable payment links directly on the specific pool card.
*   **Charity & Fundraising:** ❤️ **NEW!** Dedicate a percentage of the pot to a charity of your choice. Includes automated "Off The Top" calculations and public support badges.
*   **Unclaimed Prize Handling:** **NEW!** Choose how to handle empty winning squares:
    *   **Rollover:** Unclaimed money automatically moves to the next quarter's pot.
    *   **Random Draw:** **NEW!** Activate a "Randomizer" button for the Final Prize to pick a lucky winner from occupied squares. **Security-Enhanced:** Only available when the game is over AND the final winning square is empty, ensuring fairness. The UI remains visible with a grayed-out button and condition checklist, ensuring transparency about when the feature will unlock.
*   **Email Broadcast Tool:** **NEW!** Pool managers can send mass emails to participants with recipient filtering (All, Paid, Unpaid), dynamic content inclusion (Rules, Payouts, Link), BCC for privacy, and 15-minute rate limiting. Payment links are automatically included in confirmation emails.
*   **Quarterly Numbers ('4 Sets'):** Optional mode to generate brand new axis numbers for every quarter. Numbers are generated transactionally by the server.
*   **College Football Support:** **NEW!** Full support for NCAA/CFB pools including conference filters and automatic logo fetching.
*   **Public Grids Sport Filter:** **NEW!** Filter active pools by NFL, NCAA Football, or view all. (NBA/NCAA Basketball coming soon).
*   **Improved Scoreboard:** **NEW!** Fully synchronized scoreboard for both NFL and College Football, displaying live clock, quarters, and final scores. **Robust Architecture:** Implements "Score Locking" to persist quarter scores as they happen, preventing data loss, and features intelligent parsing to handle messy API data (string/number mismatches).
*   **Custom Payouts:** Configurable percentage splits for Q1, Halftime, Q3, and Final scores.
*   **Manager Controls:** Lock/unlock grid, mark squares as paid, manual score overrides, new "Fix Pool Scores" emergency tool, and legacy "Force Sync" options.
*   **Pool Setup:** Automated pre-filling of manager contact info for streamlined creation.
*   **Auto-Lock System:** **NEW!** Pools automatically lock and generate random axis numbers at the scheduled kick-off time. **Now Robust:** Fixed frontend data saving to ensure reliability and corrected Timezone inputs to handle local game times accurately.
*   **Date & Time Display:** **NEW!** Pool cards now explicitly show the scheduled Game Time or Bracket Lock Time.
*   **Payout & Score History:** **Fixed!** "Fix Pool Scores" tool now correctly recalculates all past winners and payouts, ensuring the "Score Change History" audit log is always money-perfect. "No Money Won" status is now accurately reflected.
### 🏆 NFL Playoff Challenge (NEW)
*   **Rank 'Em Style:** A brand new pool type for the NFL Postseason. Participants rank all 14 playoff teams from 14 points (Most Confident) to 1 point (Least Confident).
*   **Drag-and-Drop Interface:** Intuitive UI allows users to easily reorder teams before locking their entry.
*   **Scoring System:** Points are awarded for every win, multiplied by the round multiplier (x1 Wild Card, x2 Divisional, x4 Conference, x8 Super Bowl).
*   **Live Leaderboard:** Real-time standings sorted by **Maximum Possible Score** and current points.
*   **Tiebreaker:** Integrated Super Bowl total score prediction.
*   **Manager Controls:** Toggles for "Seed Bonus" (rewarding underdog picks) and full manual control over payment status.

### 📧 Professional Communication Suite (NEW)
*   **Unified Branding:** All system emails (Welcome, Reset Password, Receipts, Winner Alerts) now use a polished, standardized HTML template with the official logo and footer.
*   **Smart Receipts:** Automated "Payment Received" emails are triggers instantly when a manager marks an entry as PAID, giving users peace of mind.
*   **Urgency Reminders:** The system intelligently scans active Playoff Pools and sends a "Payment Due" reminder to unpaid users exactly **2 hours before the pool locks**, reducing ease of administration.
*   **Entry Confirmations:** Users receive a detailed "Entry Confirmed" email with a summary of their ranked picks immediately after submission.

### 📦 Pool Lifecycle Management (NEW)
*   **Archive Pools:** Managers can archive completed pools to keep their dashboard clean. Active/Archived tabs filter pools by status. Archived pools can be restored at any time.
*   **Pool Duplication:** One-click duplication of existing pools preserves all settings (teams, payout rules, costs) while resetting squares and scores for a fresh start.
*   **Waitlist for Full Grids:** When a pool reaches 100 squares, interested participants can join a waitlist. **Enhanced:** Now secure for unauthenticated users via Cloud Functions, with dedicated Admin management to view and invite waitlisted players.
*   **Post-Game Summary Email:** Automated email sent to all participants when a game ends, containing final scores, winner highlights, and payout breakdowns.

### 🏈 Live Scoreboard Page (NEW)
*   **Dedicated Scoreboard:** Full-page view of live NFL and College Football scores powered by ESPN API.
*   **Auto-Refresh:** Scores update every 30 seconds with manual refresh option.
*   **Smart Sorting:** Games sorted by status (Live first, then Upcoming, then Completed).
*   **League Tabs:** Toggle between NFL and College Football with one click.
*   **Scores History:** Reliable "Score Locking" ensures past quarter scores remain accurate even if the API feed fluctuates.

### 🎲 Prop Bets ("Side Hustle") V2
A fully integrated mini-game allowing pool managers to create custom prop bets (e.g., "Coin Toss Winner", "First TD Scorer").
*   **For Players:**
    *   **Dual-View Interface:** Enter picks on the left, view the live **Leaderboard** on the right.
    *   **Live Scoring:** Real-time updates on your card showing Correct/Incorrect status.
    *   **Tiebreaker:** Integrated total score prediction for close contents.
*   **For Managers:**
    *   **Global Seeds:** Import standard questions (managed by SuperAdmin) to set up a pool in seconds.
    *   **Custom Questions:** Create your own unique props with custom options.
    *   **Easy Grading:** One-click grading dashboard that instantly updates all player scores.
    *   **Cost Control:** Set a separate entry fee for the Prop Bet contest.

### 🃏 Enhanced Status Card (NEW)
*   **Tabbed Interface:** The pool status card has been completely refactored into a sleek, tabbed design ("Overview", "Rules", "Payment") to organize critical information without clutter.
*   **Live Countdown Timer:** A dynamic countdown timer shows the exact time until kickoff.
    *   **Color-Coded Urgency:** The timer changes color based on proximity to the start time (Green > 1h, Amber < 1h, Red < 10m).
    *   **Status Updates:** Automatically switches to "Game In Progress" or "Game Complete" based on live status.

### 🔔 Smart Reminder System & Notifications
*   **Automated Payment Reminders:** Scheduled system that identifies users with unpaid squares and sends focused email reminders.
*   **Game Time Alerts:** Notifies users shortly before the pool locks.
*   **Winner Announcements:** Instant email notifications sent to users when they win a quarter.
*   **Smart & Safe:** Built with rate-limiting, idempotency (never double-send), and user opt-in preferences (Global vs. Pool-specific settings).

### 🛡️ Audit & Integrity (NEW)
A military-grade audit logging system to ensure absolute fairness and transparency.
*   **Immutable Log:** All critical actions (Locking, Number Generation, Reservations) are written to an append-only `audit` collection.
*   **Tamper-Resistant:** Firestore Security Rules (`read: true, write: false`) prevent ANY client (even Pool Managers) from altering the log. Only trusted Cloud Functions can write entries.
*   **Public Verification:** A **"Fully Auditable"** badge on the pool view allows any player to inspect the complete, timestamped timeline of events, proving that numbers were generated fairly and payouts are accurate.

### 💰 Global Stats & Prizes (NEW)
*   **Total Prizes Tracker:** Persistent global counter on the landing page showing the total amount of prize money awarded across all pools.
*   **Automated Tracking:** Secure Cloud Function (`onPoolCompleted`) automatically updates the global ledger whenever a pool is finalized, ensuring the total never decreases even if old pools are deleted.
*   **Final Payouts:** **NEW!** Implemented backend logic to accurately calculate and distribute "Every Score Wins" payouts when a game goes final, ensuring a fair split of the event pot.

### 🧪 Advanced Simulation & Testing (NEW)
*   **Simulation Dashboard:** A powerful new SuperAdmin tool to verify game logic, winner calculation, and payouts without waiting for real games.
    *   **Scenario Runner:** Simulate entire games quarter-by-quarter or event-by-event (Touchdowns, Field Goals, Safeties).
    *   **Auto-Fill Grids:** Instantly populate grids with test users and random squares to stress-test payout algorithms.
    *   **Audit Verification:** Integrated view to confirm that specific game events correctly trigger "Event Winner" logs in the immutable audit trail.
    *   **Fix Scores:** Emergency tool to re-fetch ESPN data and regenerate all winner records retroactively if issues arise. Now supports **Targeted Pool Repair** to fix specific pools without affecting others.

### 🎨 Design & Experience
*   **Brand Refreshed:** Updated visual identity with a larger, cleaner logo and "collage-style" hero imagery.
*   **Feature Showcase:** New interactive landing page section highlighting key features (Live Grid, Scoreboard, Scenarios) with a staggered, modern layout.

### 🤖 AI Commissioner (Powered by Gemini)
A neutral, AI-driven referee that brings clarity and trust to the game.
*   **"Why This Square Won":** Automatically generates clear, step-by-step explanations for every quarterly winner. It cites specific axis digits, the final score, and the grid intersection logic.
*   **Dispute Helper:** Included "Ask the Commissioner" tool allows users to verify fairness. e.g., "Did the numbers change?" The AI analyzes the secure Audit Log to provide factual, evidence-based answers.
*   **Zero-Hallucinations:** Built with strict "Facts Only" system prompts. If data is missing or unverifiable, the AI will refuse to make up an answer, ensuring absolute integrity.
*   **Idempotency:** Smart hashing ensures the AI never processes the same event twice, keeping API costs low and responses consistent.

### 🔗 Referral System (NEW)
Built-in viral growth mechanism to help pool managers expand their reach.
*   **Unique Referral Links:** Each pool manager receives a personalized referral link (`marchmeleepools.com/?ref=UID`).
*   **Automatic Tracking:** New signups via referral links are automatically attributed to the referrer in Firestore.
*   **Dashboard Stats:** Pool managers can view their referral count and copy their link directly from their Profile page.
*   **SuperAdmin Visibility:** Referral performance is tracked in the SuperAdmin dashboard for analytics.
*   **Email Promotion:** All outgoing site emails include a promotional footer encouraging users to create their own pools.

### Super Admin Dashboard
*   **System Overview:** View all pools and registered users.
*   **User Management:** Edit user details or delete accounts.
*   **System Configuration:** **NEW!** Global feature flags to toggle "Bracket Pools" and "Maintenance Mode" in real-time without redeployment.
*   **Simulation Tools:** Advanced verification suite to test the full lifecycle:
    *   **Seed Test Tournament:** Populates a dummy 64-team bracket (Year 2025) with teams and R64 matchups.
    *   **Simulate Round:** Randomly decides winners for the current active round and advances the tournament state to test scoring and progressions.
    *   **Reset Scores:** Wipes simulation data to start fresh.

### Verification & Compliance
*   **Google OAuth Verified:** Fully compliant with Google API Services User Data Policy, including "Limited Use" disclosure.
*   **Legal Center:** Integrated Privacy Policy and Terms of Service pages with consistent site navigation and "Back to Home" functionality.
*   **Brand Compliance:** Uses official Google Sign-In branding and color palettes.

## 🛠️ Tech Stack

*   **Frontend:** React 19, TypeScript, Vite
*   **Styling:** Tailwind CSS, Lucide React (Icons)
*   **Backend / Data:** Firebase (Firestore, Auth, Cloud Functions v2)
*   **APIs:** 
    *   **Data:** ESPN (Scoreboard)
    *   **AI:** Google Gemini (AI Commissioner Features)
    *   **Email:** EmailJS & Firebase Trigger Email
*   **Deployment:** Docker (Nginx serving static assets)

## 💻 Local Developement Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/kstruck/MMPoolsV3.git
    cd MMPoolsV3
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory with your Firebase configuration:
    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```

4.  **Run Development Server**
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:5173`.

## 🔒 Authentication & Security

This project relies on **Firebase Cloud Functions (2nd Gen)** to enforce game integrity and prevent cheating.

### Cloud Functions (`/functions`)
Sensitive operations are moved off the client-side to a trusted Node.js environment:
*   `lockPool(poolId)`: Securely locks the grid and generates the random 0-9 axis numbers using server-side CSPRNG. Logs the action to the secure Audit Trail.
*   `reserveSquare(poolId, squareId)`: Handles square purchases transactionally with race-condition prevention. Added to Audit Log.
*   `syncGameStatus` (Scheduled): Polls ESPN every 5 minutes (during games) to update scores and **generate new quarterly numbers** if the "4 Sets" rule is active.
*   `runReminders` (Scheduled): Runs periodically to check for unpaid squares or upcoming locks and sends notifications.
*   `onWinnerComputed` (Trigger): Listens for game score updates to instantly notify winners via email.

### Firestore Security Rules
*   **Audit Log:** `read: true` for transparency, `write: false` for everyone (Client-side writes blocked).
*   **Clients:** Explicitly blocked from writing to sensitive fields like `isLocked` and `axisNumbers`.
*   **Users:** Can only write to their own user profile.

### Email Service (Extension)
Uses the **"Trigger Email from Firestore"** extension to send transaction confirmations.

## 🚀 Deployment Guide (Coolify / Docker)

This project is configured for deployment using **Docker**.

### Prerequisites
*   A Coolify instance (or any Docker-based hosting platform).
*   A connected GitHub repository.

### Steps
1.  **Create Service:** In Coolify, add a new resource -> "Git Repository".
2.  **Select Repository:** Choose `kstruck/MMPoolsV3` and the `main` branch.
3.  **Build Pack:** Select **Dockerfile**. The included `Dockerfile` handles the multi-stage build (Vite build -> Nginx serve).
4.  **Environment Variables:** Add your Firebase config variables (same as `.env` above) into the Coolify Secrets/Environment Variables section.
5.  **Expose Port:** Ensure Coolify maps the container's internal Port `80` to your desired domain.
6.  **Deploy:** Click "Deploy".

### Production Notes
*   **Nginx:** The project uses a custom `nginx.conf` to handle client-side routing (SPA fallback to `index.html`).
*   **Caching:** A script in `index.html` automatically unregisters legacy Service Workers to prevent caching issues from older versions of the app.
