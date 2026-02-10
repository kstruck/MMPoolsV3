# Phase 1 Design — Pre-Tournament Features

> **Target:** Ship by March 14, 2026 (5 weeks)
> **Approach:** Phased rollout — these features ship for bracket pool launch; Phase 2 (admin, reviews, forums) ships post-tournament.

---

## 1. Brackets Tab (inside BracketPoolDashboard)

**Current state:** 4 tabs — My Entry, Standings, All Entries, Settings (manager-only)

**New tab structure:**

| Tab | Visible To | Priority |
|---|---|---|
| My Brackets | All members | P0 |
| Results | All members | P0 |
| Poolwide Picks | All members | P1 |
| Pick History | All members | P1 |
| Who to Root For | All members | P1 |
| What-If Simulator | All members | P2 |
| Reports | All members | P0 |
| Manager | Manager only | P0 |

### 1a. My Brackets (replaces current "My Entry")

Rename existing tab. Shows all user entries with status, score, and rank. Add:

- Quick-action buttons: Edit (if unlocked), Duplicate, Delete
- Entry comparison view (side-by-side two of your own brackets)

### 1b. Results

Live bracket view showing actual tournament results overlaid on the bracket. Shows:

- Completed games with scores
- In-progress games with 🔴 live indicator + current score
- Upcoming games grayed out
- Each game shows how many pool entries picked each team

### 1c. Poolwide Picks

Aggregate view showing **what % of the pool picked each team** to advance to each round. Rendered as a bracket heatmap — darker = more popular pick.

Data source: aggregate all `BracketEntry.picks` for the pool.

### 1d. Pick History

Timeline view of the user's bracket performance round-by-round:

- Round 1: 24/32 correct (+48 pts)
- Round 2: 11/16 correct (+44 pts)
- Shows cumulative score progression as a sparkline chart

### 1e. Who to Root For

For each **upcoming game**, calculate the standings impact for the current user:

- "If Duke beats Gonzaga → you gain 8 pts, move 5th → 3rd"
- "If Gonzaga beats Duke → you lose nothing, stay 5th"

**Algorithm:** For each remaining game, simulate both outcomes through the scoring engine, recalculate all standings, and diff the user's position.

### 1f. What-If Simulator

Interactive bracket where the user can click to toggle outcomes of remaining games. Standings table updates live below the bracket. Uses the existing `BracketBuilder` component in read-only "simulation mode."

**Data flow:**

1. Load actual results (locked games) + user's hypothetical picks (unlocked games)
2. On each toggle → recalculate all entry scores → re-sort standings
3. Show user's projected rank + point total

---

## 2. Reports Tab

All reports visible to all members. Manager gets CSV export + print buttons.

### 2a. Standings Report

Enhanced version of the existing `StandingsTable`:

- Add rank # column, rank change indicator (↑↓), and a "Max Possible Score" column
- Highlight eliminated entries (all remaining picks are busted)
- Filter: by round, by score range

### 2b. Breakdown by Round

Table showing each entry's correct picks per round:

| Entry | R64 | R32 | S16 | E8 | F4 | Final | Total |
|---|---|---|---|---|---|---|---|
| Kevin's Bracket | 24 | 11 | 5 | 3 | 1 | 0 | 156 |

### 2c. Teams Picked

For each team in the tournament:

- How many entries picked them in each round
- Bar chart visualization
- Sortable by seed, popularity, or actual result

### 2d. Live Scores

Real-time game scores panel (see Section 4). Embedded within the Reports tab as a live Game Center view showing all active + upcoming games.

### 2e. Pool Winners

Post-tournament summary:

- Final standings (top 10 highlighted)
- Payout distribution based on pool's payout settings
- "Best Pick" and "Worst Pick" awards (which pick gained/lost the most points)
- Manager can mark as "official" to lock results

---

## 3. Pool Manager Tab

Replaces current "Settings" tab for managers. Sub-sections:

### 3a. Edit Setup

Move existing pool settings UI here. Add ability to edit:

- Pool name, description, branding
- Entry limits, fees
- Lock date, deadlines (see Section 5)

> [!WARNING]
> Editing scoring system or payouts after entries are submitted needs a confirmation modal: "This will recalculate all scores. Are you sure?"

### 3b. Accounting

**New Firestore subcollection:** `pools/{poolId}/payments`

```typescript
interface PaymentRecord {
  id: string;
  entryId: string;        // Links to BracketEntry
  userName: string;
  amount: number;          // Amount paid
  amountOwed: number;      // Entry fee
  method: 'venmo' | 'zelle' | 'cashapp' | 'paypal' | 'cash' | 'other';
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
  paidAt?: number;
  note?: string;
  markedBy: string;        // Manager UID who marked it
  updatedAt: number;
}
```

**UI:**

- Table of all entries with payment status toggle
- Filter: Paid / Unpaid / Partial
- Summary card: Total Collected ($X of $Y), Outstanding ($Z)
- CSV Export button

### 3c. Send Invitation

- Text field for custom invitation message
- Share link with UTM params (reuse wizard share logic)
- Bulk email via existing `emailService` (send to list of emails)
- Copy-paste invite template

### 3d. Commissioner Message

- Rich text field for manager to post an announcement
- Stored in `pools/{poolId}` as `commissionerMessage: string`
- Displayed as a banner at top of pool dashboard for all members
- Dismissable per-user (tracked in localStorage)

---

## 4. Real-time Scoring Polish

**Current state:** ESPN sync runs on schedule via Cloud Functions. Firestore updates trigger UI re-renders.

**Additions:**

### 4a. Live Game Indicators

In bracket views, games currently in progress show:

- Pulsing 🔴 dot + "LIVE" badge
- Current score overlay
- Time remaining / period

**Data source:** `tournament.games[].status` field (already synced from ESPN)

### 4b. Last Updated Indicator

Add to dashboard header:

- "Scores updated 3 min ago" with auto-refresh countdown
- Manual "Refresh Now" button that triggers `syncBracketTournament`
- Rate limit: 1 manual refresh per 5 minutes per user

### 4c. Auto-refresh Standings

When a game completes:

- Firestore listener triggers re-render
- Flash animation on standings rows that changed position
- Toast notification: "Game complete! Standings updated."

---

## 5. Pool Deadlines

**Type changes to `BracketPool`:**

```typescript
// Add to BracketPool interface
registrationDeadline?: number;    // After this, no new members can join
submissionDeadline?: number;      // After this, no new/edited brackets
// Existing: lockAt (tournament start — auto-lock everything)
```

**UI enforcement:**

- Registration deadline: Hide "Join Pool" / "Create Entry" buttons after deadline
- Submission deadline: Hide "Edit" / "Submit" buttons after deadline
- Show countdown timers on dashboard: "2d 14h until brackets lock"
- Wizard Step 2 (Rules): Add date pickers for both deadlines

---

## 6. Test Scripts

### 6a. 2025 Tournament Replay

**Script:** `scripts/replay-2025.ts`

- Import actual 2025 NCAA tournament results (manual JSON or ESPN historical API)
- Create a mock pool with 20 entries using varied bracket strategies
- Run scoring engine against each round's results
- Assert final scores match manual calculation
- Output: pass/fail + score comparison table

### 6b. Synthetic Scenario Generator

**Script:** `scripts/generate-scenarios.ts`

- Generate N random bracket entries for a pool
- Simulate tournament outcomes: chalk, upset-heavy, Cinderella
- Test all scoring systems (Classic, ESPN, Fibonacci, Custom)
- Test edge cases: ties, all-wrong bracket, perfect bracket
- Test payouts: verify payout math under each scenario

### 6c. Integration into CI

- Add `npm run test:brackets` script
- Run the replay + 3 synthetic scenarios
- Fails build if any assertion breaks

---

## Implementation Order

```mermaid
gantt
    title Phase 1 Implementation Timeline
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Foundation
    Pool Deadlines (types + UI)     :f1, 2026-02-11, 2d
    Manager Tab scaffold            :f2, 2026-02-11, 1d

    section Core Features
    Accounting                      :c1, after f2, 3d
    Commissioner Message            :c2, after c1, 1d
    Send Invitation                 :c3, after c2, 1d
    Reports Tab scaffold            :c4, after f1, 2d
    Standings Report                :c5, after c4, 2d
    Round Breakdown                 :c6, after c5, 1d
    Teams Picked                    :c7, after c6, 2d

    section Brackets Tab
    Tab restructure                 :b1, after c3, 1d
    Poolwide Picks                  :b2, after b1, 2d
    Pick History                    :b3, after b2, 1d
    Results view                    :b4, after b3, 2d
    Who to Root For                 :b5, after b4, 3d
    What-If Simulator               :b6, after b5, 4d

    section Scoring & QA
    Live game indicators            :s1, after c7, 2d
    Auto-refresh + toast            :s2, after s1, 1d
    2025 Replay script              :t1, after s2, 2d
    Scenario generator              :t2, after t1, 2d
    Pool Winners report             :t3, after t2, 1d
