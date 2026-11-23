# PLAN-PTS-LEFT-HIDDEN-TOTAL — sweeps

## PH1 — every reader of the reveal payload

`git grep -n "getPoolPicks\|PoolPicksReveal" -- src functions/src ':!**/__tests__/**'`

- `src/services/dbService.ts`: the hand-written mirror, now with optional `hiddenLeft`.
- `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx`: fetches per week and hands `weekReveal` to the grid and Standings → Week Results. Unchanged; it passes the object through.
- `NFLPicksGrid.tsx` and `NFLResults.tsx`: read `hiddenLeft[row.id]`, entry-keyed, as the multi-entry rule requires (`tests/nfl-surface-invariants.test.ts`).
- `EntryWeekPicks.tsx` (the row-click strip): renders cells only, so the total does not apply.

## PH2 — every place a "Max" for a week is shown

- **Current Picks grid:** `tallyGridRow().max`, already per player; it now gets `hiddenLeft` too.
- **Week Results:** was `weeklyMaxPoints`; now `tallyGridRow().max`. `weeklyMaxPoints` and `unwinnableGameIds` are no longer rendered anywhere. They are kept with their tests, and their header says so.

## PH3 — what the new field can tell a member

- It is one sum per entry over hidden open picks; there is no per-game or per-team data.
- With one hidden open game, the sum is that game's weight.
- For a complete sheet, the sum was already derivable from the revealed weights. For an incomplete sheet it is new information, and Kevin approved sharing it.
- The commissioner can turn it off per pool.
