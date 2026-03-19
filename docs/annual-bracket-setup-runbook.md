# Annual NCAA Bracket Setup Runbook
> Last updated: March 2026 | March Melee Pools — `gridiron-gamble-uzuqo`

This runbook captures everything learned from the 2026 bracket setup so that next year's process is smooth and bug-free.

---

## Overview

The bracket data flows like this:

```
ESPN API → Cloud Function (importTournamentFromESPN) → Firestore → React Frontend
```

**Important**: The ESPN API is the single source of truth. Do NOT use static maps or manual data entry.

---

## Pre-Tournament Checklist (Run ~1 week before Selection Sunday)

### 1. Verify the ESPN API Endpoint

The Cloud Function fetches from:
```
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=200
```

Before Selection Sunday, confirm this URL still returns NCAA tournament data. Known fields to check:
- `competition.notes[0].headline` → region string (e.g. "NCAA Men's Basketball Championship - East Region - 1st Round")
- `competitor.curatedRank.current` → **the tournament seed** (1–16)
- `competitor.team.displayName` → team's full name (used as the team ID in Firestore)
- `competitor.records[0].summary` → win-loss record (e.g. "28-5")

Run a quick test fetch from your browser and confirm the JSON structure hasn't changed. If ESPN changes their API structure, update `fetchAndMapESPNGameData` in `functions/src/espnBracket.ts` accordingly.

---

### 2. Key Code Rules to Never Break

These rules were hard-won in 2026. Do not change them without careful thought:

#### Rule 1 — Seed must come from `curatedRank.current`
```typescript
// ✅ CORRECT — in fetchAndMapESPNGameData
const seed = competitor.curatedRank?.current ?? 99;
```
ESPN no longer includes the seed in the team display name (e.g., they stopped using "(1) Duke Blue Devils"). The only reliable seed source is `curatedRank.current`.

#### Rule 2 — Region must come from `notes[0].headline`
```typescript
// ✅ CORRECT — in parseRegionAndRound
const headlineLower = headline.toLowerCase();
if (headlineLower.includes('east'))    region = 'East';
else if (headlineLower.includes('midwest')) region = 'Midwest'; // ← MUST be before 'west'
else if (headlineLower.includes('west'))    region = 'West';
else if (headlineLower.includes('south'))   region = 'South';
```
**⚠️ CRITICAL**: `'midwest'` check MUST come before `'west'` because "midwest" contains the substring "west". Getting this order wrong causes ALL Midwest games to be labeled as West, mixing up two entire regions.

#### Rule 3 — Never use `NCAA_2026_BRACKET` static map for seeds or regions
The static bracket map in `espnBracket.ts` should be treated as a **deprecated fallback only**. It is wrong every year until manually updated, and the ESPN API has the correct data directly. If you find code overriding the ESPN region/seed with data from this map, remove the override.

#### Rule 4 — Team ID is the full display name
```
"Duke Blue Devils", "Ohio State Buckeyes", "UConn Huskies"
```
Team IDs in the system are full ESPN display names. The old regex `^[A-Z]+?(\d+)-` (which matched `E1-Duke`) does not work. Seed lookup in the frontend uses `TeamDataContext`, which maps `displayName → { seed, record, ... }`.

---

### 3. The Import Process

1. Log in as Super Admin
2. Go to **Game Ops → Tournament Manager**
3. Select **"Men's 2026"** (or the current year's NCAA tournament) from the dropdown
   - ⚠️ Do NOT select conference tournaments (Big 12, Big East, etc.) by mistake
4. Click **"Import Data from ESPN"**
5. Wait for the success toast — it will report the number of games and teams imported (expect ~67 games, ~69 teams for a standard 68-team field)

**Verify in the Cloud Function logs (Firebase Console → Functions → importTournamentFromESPN):**
```
R1 mapped: East-1-1 = Duke Blue Devils(1) vs Siena Saints(16)   ← seed 1 at top
R1 mapped: East-1-2 = Ohio State Buckeyes(8) vs TCU Horned Frogs(9)
...
R1 mapped: Midwest-1-1 = [#1 seed](1) vs [#16 seed](16)  ← Midwest NOT labeled as West
```

If you see Midwest teams in `West-1-x` slots, Rule 2 above has been broken.

---

### 4. Frontend Seed Display Architecture

Seeds are displayed via React context. The data flow is:

```
tournament.importedTeams  →  TeamDataContext.Provider  →  MatchNode → TeamSlot → seed badge
```

**Key files:**
| File | Role |
|------|------|
| `functions/src/espnBracket.ts` | Imports ESPNdata, writes `importedTeams` to Firestore |
| `src/components/BracketBuilder/teamDataContext.ts` | Shared React context definition |
| `src/components/BracketBuilder/ESPNBracket.tsx` | Full canvas bracket — wraps with `TeamDataContext.Provider` |
| `src/components/BracketBuilder/BracketBuilder.tsx` | Tabs/region view — also wraps with `TeamDataContext.Provider` |
| `src/components/BracketBuilder/MatchNode.tsx` | Renders each matchup card + seed badge |

**Provider locations** — both views must provide the context:
```tsx
// ESPNBracket.tsx (full canvas)
<TeamDataContext.Provider value={importedTeams}>
  ...
</TeamDataContext.Provider>

// BracketBuilder.tsx (tabs/region view)
<TeamDataContext.Provider value={tournament.importedTeams ?? {}}>
  ...
</TeamDataContext.Provider>
```

If seeds ever go missing again, check that these providers are still in place and that `tournament.importedTeams` is non-empty.

---

### 5. Post-Import Verification Checklist

After clicking "Import Data from ESPN", verify the following in the app UI:

- [ ] **East Region**: Duke Blue Devils (1) is at the very top
- [ ] **East Region**: Ohio State (8) vs TCU (9) is the second pairing
- [ ] **East Region**: UConn Huskies (2) is at the bottom (slot 8)
- [ ] **West Region**: Has its own #1 seed, not Midwest teams
- [ ] **Midwest Region**: Has its own #1 seed, separate from West
- [ ] **Seed numbers visible**: Small numbers (1–16) appear to the left of every Round 1 team name
- [ ] **Win-loss records showing**: e.g. "28-5" appears next to team names (fetched from ESPN records)
- [ ] **No horizontal scrolling**: All 4 regions visible in the full canvas view
- [ ] **Mobile view**: Automatically switches to Region tabs (no full canvas on mobile)

---

### 6. If Seeds Are Wrong — Debugging Steps

1. **Check Cloud Function logs** — Do the `R1 mapped:` lines show correct seeds in parentheses?
   - If YES → problem is in the frontend. Check `TeamDataContext` providers.
   - If NO → problem is in the backend. Check `fetchAndMapESPNGameData` seed logic.

2. **Check ESPN API directly** in a browser:
   ```
   https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=200
   ```
   Confirm `competitors[].curatedRank.current` still contains the seed number.

3. **Check Firestore** — Look in `tournaments/mens-2026/importedTeams`. Each team doc should have a `seed` field (1–16). If seed is 0 or missing, the API field may have changed.

4. **Check region labels** — Look at `R1 mapped:` log lines. If you see Midwest teams in `West-` slots, the `parseRegionAndRound` function has the `west`/`midwest` order wrong again.

---

### 7. Update the Static Bracket Map (Optional Safety Net)

If you want an extra safety net, update `NCAA_2026_BRACKET` in `espnBracket.ts` to reflect the current year's bracket before the import. This is used as a tiebreaker fallback only (not primary source of truth), but having it correct doesn't hurt.

The map format is:
```typescript
const NCAA_2027_BRACKET: Record<string, { seed: number; region: BracketRegion }> = {
    'Duke Blue Devils':      { seed: 1, region: 'East' },
    'Siena Saints':          { seed: 16, region: 'East' },
    // ... all 68 teams
};
```

---

### 8. Year-over-Year ESPN API Changes to Watch For

Each year, confirm these ESPN API fields still exist:
| Field | Path | Used For |
|-------|------|----------|
| Tournament seed | `competitor.curatedRank.current` | Team seed (1–16) |
| Region | `competition.notes[0].headline` | Region assignment |
| Team name | `competitor.team.displayName` | Team ID |
| Win-loss | `competitor.records[0].summary` | Display beside team name |
| Game round | `competition.notes[0].headline` | Round number |

If any field moves or gets renamed, update `fetchAndMapESPNGameData` in `functions/src/espnBracket.ts`.

---

## Quick Reference — Key File Locations

```
d:\march-melee-pools\
├── functions\src\espnBracket.ts          # Backend — ESPN import + Firestore save
├── src\components\BracketBuilder\
│   ├── teamDataContext.ts                 # Shared seed context
│   ├── ESPNBracket.tsx                    # Full canvas bracket + context provider
│   ├── BracketBuilder.tsx                 # Tabs view + context provider
│   └── MatchNode.tsx                      # Matchup card (reads seed from context)
└── docs\annual-bracket-setup-runbook.md  # This file
```

---

*Created after the 2026 tournament setup. The three bugs fixed during 2026 setup:*
1. *`parseRegionAndRound` checked `'west'` before `'midwest'` → all Midwest games labeled as West*
2. *`extractSeedFromId` regex used old ID format — seeds were always undefined in the UI*
3. *`TeamDataContext.Provider` missing from the tabs/region view in `BracketBuilder.tsx`*
