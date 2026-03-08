# 🗺️ Master Roadmap

- [x] Phase 1: Core Experience (interactive grid, live scoreboard V1)
- [x] Phase 2: Participant Dashboard V2 & User Profiles
- [x] Phase 3: NFL Playoff Challenge & Professional Communication Suite
- [/] Phase 4: Lifecycle Management & Advanced Simulation
  - [x] Archive/Duplicate Pools
  - [x] Waitlist for Full Grids
  - [ ] Auto-Release Unpaid Squares (Scheduled for Implementation)
  - [ ] Waitlist Notifications Integration
- [ ] Upcoming: March Madness 2026 Readiness
  - [x] Audit Bracket Builder
  - [x] Verify Standings Integration
  - [x] Load Testing for Tournament Selection Sunday
- [/] Phase 5: Advanced Pool Management & Engagement (NEW)
  - [ ] Global Dark/Light Mode Toggle Fix
  - [ ] Payment Tracking Checkmarks & "Lock Unpaid" Toggle
  - [ ] Commissioner Messaging / Trash Talk Board
  - [ ] Custom Branding for Pools
  - [ ] Historical "Hall of Fame"
  - [ ] Gamification & Badges
  - [ ] Head-to-Head Mini Leagues
  - [ ] Automated SMS & Push Notifications
  - [ ] Prop Bet Tie-Breakers

- [x] Infrastructure & Tooling
  - [x] Skill: Security Scanner Integration (vulnerability scanning & SAST)

---

## 📝 Current Trajectory

**Step**: Planning Implementation for 2026 Engagement Features
**Goal**: Integrate user-approved features from the feature gap analysis into the roadmap and assign them to the squad.

## 🚥 Squad Status

| Agent | Task | Status |
| :--- | :--- | :--- |
| **🐎 Design Lead** | Global Dark/Light Mode Fix, Custom Branding UI, Badges | 🔴 Pending |
| **🏗️ Builder** | Payment Tracking, SMS Integration, Head-to-Head Logic | 🔴 Pending |
| **🤓 Nerd** | E2E Audit of New Features | 🟢 Idle |
| **📚 Researcher** | Feature Gap Analysis & Implementation Planning | 🟢 Complete |

---

## 🏗️ Missing Pages Plan (Design Lead & Builder)

During the Footer Audit, several menu links were identified that do not map to actual routes in the application (`App.tsx`). Below is the plan to build them out.

### Pages to Create

1. **March Madness Landing (`/march-madness`)**
    - **Focus**: A bespoke landing page promoting bracket pools. Similar formatting to `/gameday-squares`.
    - **Components**: Hero sections highlighting rules, pricing, or instructions tailored to March Madness, calling `<CreatePoolSelection>` or redirecting to `/bracket-wizard`.
2. **NFL Playoff Pools (`/nfl-playoffs`)**
    - **Focus**: A dedicated landing page selling the NFL Playoff Challenge features.
    - **Components**: Feature showcase, mockups of the Playoff Pool UI.
3. **Custom Sports Betting (`/custom-sports`)**
    - **Focus**: Landing page for Props/Custom Sports product.
    - **Components**: Showcase of "Build Your Own Prop Sheet" functionality.
4. **Pricing (`/pricing`)**
    - **Focus**: Detailed breakdown of cost model (e.g., free tier vs premium, custom processing fees).
    - **Components**: Pricing tables comparing pool types (e.g., free up to 10 entries context).
5. **About Us (`/about`)**
    - **Focus**: The story and team behind March Melee Pools.
6. **Contact (`/contact`)**
    - **Focus**: Provide an email entry form to submit support queries.
    - **Builder Requirement**: Set up backend Firebase function/mail service route to handle form submission.
7. **Charity Partnerships (`/charity`)**
    - **Focus**: Detailed breakdown of the $1,000,000 donation goals, stats, and partnered 501(c)(3) charities.

### Next Steps for Squad

1. **🐎 Design Lead**: Create visual scaffolds for each missing page inside `/src/components/articles/` or `/src/components/`, utilizing Tailwind and Framer Motion for high-fidelity interactive elements.
2. **🏗️ Builder**: Add `Route` entries for each of the new components in `App.tsx` and provision backend endpoints/features (like a contact form emailer function).
3. **🤓 Nerd**: Ensure each new route passes E2E navigation audits without console errors or 404 dead-ends.

---

## 🚀 2026 Engagement Features Implementation Plan

Based on recent feature analysis, the following features will be implemented to entice users and pool managers:

### 1. Global Dark/Light Mode Toggle Fix

- **Focus**: Ensure Dark/Light mode toggle works seamlessly across the entire site, modifying text and graphics colors appropriately.
- **Squad**: 🐎 **Design Lead** to fix `index.css` and Tailwind config for robust `dark:` dynamic prefixing across all components.

### 2. Payment Tracking Checkmarks

- **Focus**: Admin UI for managers to check off paid users, with a "Lock Unpaid Brackets" toggle.
- **Squad**: 🏗️ **Builder** to add `hasPaid` field to `BracketEntry` schema and add toggle controls to the Admin Participant table.

### 3. Commissioner Messaging / Trash Talk Board

- **Focus**: In-app message board or email blast tool for commissioners.
- **Squad**: 🏗️ **Builder** to create a `messages` subcollection and UI in the Admin Dashboard.

### 4. Custom Branding

- **Focus**: Allow managers to upload custom logos/covers for their pool dashboard.
- **Squad**: 🏗️ **Builder** to implement Firebase Storage upload; 🐎 **Design Lead** to build the image cropper and header UI.

### 5. Historical "Hall of Fame"

- **Focus**: Track legacy stats (all-time points, championships) for annual pools.
- **Squad**: 🏗️ **Builder** to aggregate historical data across linked archived pools to display on the pool homepage.

### 6. Gamification & Badges

- **Focus**: Digital badges ("Perfect First Round", "Biggest Upset") on user profiles.
- **Squad**: 🐎 **Design Lead** to design badges; 🏗️ **Builder** to write Cloud Functions to award them based on scoring events.

### 7. Head-to-Head Mini Leagues

- **Focus**: Random weekly H2H matchups within a pool.
- **Squad**: 🏗️ **Builder** to create matchup generation logic and DB schema.

### 8. Automated SMS/Push Notifications

- **Focus**: Send SMS reminders for upcoming locks or results.
- **Implementation Strategy**:
  - **Free/Cheap SMS Routing:** Use **Courier API** (which offers an excellent free tier of 10,000 messages/month) integrated with an aggregator, or use **Twilio** directly (very cheap pay-as-you-go per SMS). Another great free/cheap alternative for startups is **Amazon SNS** (first 100 SMS free, then extremely cheap).
  - **Free Push Notifications:** Implement Firebase Cloud Messaging (FCM) for 100% free web-push notifications. This can be combined with SMS for users who opt-in.
- **Squad**: 🏗️ **Builder** to implement FCM for web push and Twilio/Courier for SMS routing via Cloud Functions.

### 9. Prop Bet Tie-Breakers

- **Focus**: Customizable prop tie-breakers beyond just "Total Points".
- **Squad**: 🏗️ **Builder** to extend the tie-breaker schema to support multiple custom Q&A fields during Pool Creation.

### 10. Quick-Pick / Auto-Fill Helpers

- **Focus**: Add "Fill Favorites", "Fill Random", and "Finish for Me" buttons to the Bracket Builder to lower the barrier to entry.
- **Squad**: 🏗️ **Builder** to implement selection algorithms; 🐎 **Design Lead** to build UI buttons in the Bracket Builder header.

### 11. Printable / Exportable Brackets & Standings

- **Focus**: Allow pool managers to download master standings (CSV) and individual brackets (PDF) for offline tracking and bulletin boards.
- **Squad**: 🐎 **Design Lead** and 🏗️ **Builder** to integrate `jspdf`/`html2canvas` and `papaparse` for clean document generation.

---
**Verification Note:**
✅ The **"What-If" Scenario Generator** and **"Pick Analytics & Trends"** were reviewed via grep search and code inspection. They are confirmed to be fully implemented and working! Both components (`WhatIfSimulator.tsx` and `PoolAnalytics.tsx`) are actively integrated under the 'whatif' and 'analytics' subtabs inside the Pool Dashboard.

---

## 🛠️ Squad Mission

- **Design Lead**: Visual beauty and high-end UX. Focus: /frontend, /components, /styles.
- **Builder**: Performance and reliability. Focus: /backend, /api, /lib.
- **Nerd**: Quality Control and Testing. Focus: /**tests**, E2E.
- **Researcher**: Intel and blueprints. Focus: PLAN.md, Research docs.
