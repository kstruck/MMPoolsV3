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

- [x] Infrastructure & Tooling
  - [x] Skill: Security Scanner Integration (vulnerability scanning & SAST)

---

## 📝 Current Trajectory

**Step**: Footer Audit & Missing Pages Plan
**Goal**: Update footer links to ensure all menu items point to real pages and plan for creation of missing pages.

## 🚥 Squad Status

| Agent | Task | Status |
| :--- | :--- | :--- |
| **🐎 Design Lead** | Create Missing Pages (Landing, About, Pricing, etc.) | 🔴 Pending |
| **🏗️ Builder** | Backend Endpoints for Auto-Release | 🟢 Idle |
| **🤓 Nerd** | E2E Audit of Current User Flow | 🟢 Idle |
| **📚 Researcher** | Footer Audit & Missing Pages Plan | 🟢 Complete |

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

## 🛠️ Squad Mission

- **Design Lead**: Visual beauty and high-end UX. Focus: /frontend, /components, /styles.
- **Builder**: Performance and reliability. Focus: /backend, /api, /lib.
- **Nerd**: Quality Control and Testing. Focus: /**tests**, E2E.
- **Researcher**: Intel and blueprints. Focus: PLAN.md, Research docs.
