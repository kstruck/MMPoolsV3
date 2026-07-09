# Grill prompt — Player Profiles for every pool member

Paste the block below to kick off tomorrow's planning session. It invokes the
adversarial Codex planning skill (same process that hardened the pool-homepage
and commissioner-dash plans). Use `/grill-with-docs-codex` (pulls Firestore/React
docs) — or `/grill-me-codex` for the lighter variant.

---

/grill-with-docs-codex

**Goal:** Design (do not build yet) a per-member Player Profile page for March Melee Pools — a public profile for EVERY player in every pool, modeled on the AP Pro Picks expert profile, tracking each member's real stats and metrics across all pools they've participated in. Produce a locked, adversarially-reviewed implementation plan with phases, a data model, and acceptance criteria.

**Reference design (AP Pro Picks profile the owner likes):** a profile page with tabs — Stats, Weekly Records, Pick History, Achievements — plus, on Stats: a Performance Chart (this player's wins vs. an average line, by week/season/lifetime), a "Team by Team Performance" card (most- and least-accurately-picked teams with record + % + profitability), and a Yearly Record table (season, W-L, %, profit, rank). We want that same shape for our pool members.

**Explicit owner requirements:**
- A profile page per pool member (like `/profile/:uid`, which already exists as a stub), tracking all their stats/metrics across every pool they've joined.
- Include: Performance Chart, Team-by-Team Performance, Yearly Record, Weekly Record, Pick History, and Achievements.
- **Do NOT include "units"** — that's a gambling metric we don't track. Replace/omit unit-based columns.
- **Profit** = real money the member has won across all pools they participated in (not units). Must reconcile with our payout ledger and the honor-system/commissioner-hosting-only money model (the platform never touches participant entry money — see `stripe-commissioner-only`; entry fees are P2P honor-system).
- **Achievements** is a separate feature whose requirements the owner is still gathering — design the profile to HOST achievements (a slot + data contract) but treat the achievement engine itself as out of scope / a stub with a clean extension point.

**What already exists (extend, don't reinvent):**
- `functions/src/userProfile.ts` recomputes `publicProfiles/{uid}` (real overall stats, weekly record, performance chart) with an `onEntryChangedRecomputeProfile` trigger. `src/pages/PlayerProfile.tsx` renders `/profile/:uid`.
- Current stubs rendering "coming soon": Team-by-Team, Profit, Achievements.
- Member Record model (ADR 0003, `docs/adr/0003-*.md`, `shared/memberRecord.ts`, `functions/src/lib/memberRecord.ts`) = cross-pool roster + payment truth at `pools/{id}/members/{uid}`.
- Per-week W-L already persisted by `scoreNFLWeek` (`weeklyResults` + `resultsVersion`). Consensus/weeklyResults live in `functions/src/consensus.ts`, `shared/consensus.ts`.
- Expert Picks ingestion just landed (`functions/src/expertPicks.ts`) — per-game ESPN FPI + Vegas predictions. The "expert as a tracked profile" (an expert that appears in the profile system with its own W-L record, like AP Pro Picks) shares THIS profile's data model — design the profile so a synthetic "expert" is just another profile subject.
- Pool types: NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN, plus SQUARES/BRACKET/NFL_PLAYOFFS/PROPS. A profile spans all of them.

**Known blockers the plan MUST resolve (these are why this was deferred):**
1. **Per-pick result persistence** — Team-by-Team and full Pick History need each pick's graded outcome stored per member per game, which we don't persist today. Define the schema + who writes it (scoring engine) + backfill story.
2. **A NFL "finalized" lifecycle distinct from admin pool-close, plus `PAYOUT_PAID`/`PAYOUT_UNPAID` ledger events** — needed for Profit to be real. Define how a member's winnings are recorded and summed across pools without the platform holding money.
3. **Achievements data contract** — a slot the future engine fills; no engine now.

**Constraints / non-negotiables:**
- Leak-safe: a profile must never expose another member's un-locked picks (respect the same pre-lock gating as consensus). Public profile aggregates only.
- Scale: recompute must stay bounded (mirror the consensus/profile trigger pattern; document the shard path if needed).
- Match the existing design system (Tailwind tokens, `font-display`, card styles) and the dev preview harness `/dev/dashboards` (has a Player Profile mock tab).
- Firestore rules must gate every new collection; writes server-only via Admin SDK.

**Deliverables from the grill:**
- A phased plan (like `PLAN-POOL-HOMEPAGE.md`) with an ADR for the profile data model.
- Concrete Firestore schema for per-pick results, profit/ledger, and the achievements slot.
- Acceptance criteria per phase + a verification story (unit + emulator + `/dev/dashboards`).
- Explicit list of what stays stubbed (achievement engine) with its extension point.

Run the full adversarial review (multiple rounds). Challenge the money model, the leak surface, the backfill, and whether Team-by-Team/Profit can be made real without the platform holding funds. Do not write feature code — output the plan.
