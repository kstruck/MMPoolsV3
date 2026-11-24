// Sharing other members' "points left" before their games kick off — a
// commissioner setting (PLAN-PTS-LEFT-HIDDEN-TOTAL, Kevin 2026-11-23: "Make this
// an option for the pool manager to turn on or off").
//
// `settings.shareHiddenPointsLeft` (Pick'em only):
//   true / absent — `getPoolPicks` sends `hiddenLeft`: per entry, ONE total of
//                   the points on picks the caller cannot see yet whose games
//                   are not decided. Pts Left and Max then show a number for
//                   every member, not "?". The default, because members asked
//                   for it and Kevin approved it for every pool first.
//   false         — no total is sent; another member's Pts Left and Max read "?"
//                   until their remaining games kick off (the previous behaviour).
//
// It never carries pick content: not which team, not which game holds which
// weight. Pure: both roots import it. The server validates the stored value
// (functions/src/lib/poolUpdate.ts).
//
// It gates in TWO places, and both read this function:
//   - the server (`getPoolPicks`, functions/src/nflPickReveal.ts) decides whether
//     a total is SENT at all. That is the one that matters for privacy: with the
//     setting off, the number never leaves the server.
//   - the client (NFLResults.tsx, NFLPicksGrid.tsx) decides whether a total it
//     already holds is USED. A reveal fetched while the setting was on stays in
//     memory until the next poll; without the client gate the page would keep
//     showing those totals for up to five minutes after the commissioner turned
//     the setting off.
// This comment said the server "is the only place it gates anything" until the
// Claude pre-review of #801 pointed at the client gates added by the same change.

export function sharesHiddenPointsLeft(settings: { shareHiddenPointsLeft?: unknown } | null | undefined): boolean {
  const v = settings?.shareHiddenPointsLeft;
  return typeof v === 'boolean' ? v : true;
}
