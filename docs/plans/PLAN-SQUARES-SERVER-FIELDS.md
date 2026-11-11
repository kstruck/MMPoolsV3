# PLAN — squares prize, lock and game-link fields become server-owned (K1, K4, K11)

> **STATUS: APPROVED TO BUILD — Kevin, 2026-11-11, "go with all of your
> recommendations"**, answering: *"K11/K4/K1 — defer for now, but approve me
> building it as a separate PR before the first real-money squares pool."*
> (Recorded in `PLAN-SQUARES-REOPEN.md` §2, commit `63f84584`.)
>
> **Plan-gated** under `mmp-change-control` §1: it changes **authorization**
> (`firestore.rules`) on a **money** surface. The design choices in §3 are made
> under the 2026-11-10 delegation and are each Kevin's to veto.
>
> **Stacked on PR-D (`claude/squares-reopen`, #761).** It needs the squares
> code from A–D. Merge after #761.

## 0. Blast radius — why this cannot reach a running NFL pool

`firestore.rules` governs every pool. Everything this plan adds to it is one
function, `squaresServerFieldsUnchanged()`, that **returns `true` for any pool
whose stored AND incoming `type` are not `SQUARES`** — the same both-sides
type check `nflSettingsWriteBlocked()` uses, and `type` is already
server-owned (`protectedFieldsUnchanged()`), so a pool cannot step into or out
of it. It sits inside the **manager** branch of the pool `update` rule, so a
SUPER_ADMIN's client writes are unchanged (the existing posture, asserted by a
test rather than endorsed).

The existing rules suite (14 files, NFL included) must pass unchanged. New
cases assert that an NFL pool, a Bracket pool and a Playoff pool can still
write every field this plan freezes for squares — `isLocked`, `scores`,
`payouts` and `league` are fields those types legitimately write from the
client today (`PlayoffDashboard.tsx` writes `isLocked`; bracket managers edit
`payouts`).

No NFL file, no shared dependency and no lockfile is changed.

## 1. What is wrong — verified on `claude/squares-reopen` at `52599954`

A squares commissioner's browser can write these directly to the pool
document (`AdminRoute.tsx` → `dbService.updatePool`), and the rules let it:

| Field | Who should write it | What a direct write can do |
|---|---|---|
| `quarterlyNumbers` (K1) | `lockPool` / the score sync | Set the upcoming quarter's numbers before the server draws them, on a "new numbers each quarter" pool. `axisNumbers` is already protected; this is not. |
| `isLocked` (K4) | `lockPool`, `unlockSquaresPool` (D13) | Reopen a locked grid with its numbers still showing — buy the square that wins — bypassing D13's "refused once the game has started". |
| `randomWinner` (K4) | `drawSquaresFinalPrize` (D15) | Name the winner of the unclaimed final prize. |
| `gameId`, `gameTime`, `league` (K11) | the game-link path | Link a pool to one game's scores under another game's teams and kickoff, or to a game already under way — the grid then locks at once on whatever numbers it has. |
| `homeTeam`, `awayTeam` (K11) | the game-link path, once linked | The score sync swaps the scores when the pool's team order disagrees with the feed (`shouldSwapHomeAway`, `scoreUpdates.ts`); swapping the names on a linked, locked pool swaps who wins. |
| `scores` (K4) | the score sync on a linked game | Rewrite a live feed score. |
| `payouts`, `charity`, `ruleVariations`, `costPerSquare`, `scoreChangePayoutAmount`, `numberSets`, `includeOvertime` (K4 — "live prize data", qodo on #761) | the commissioner, **before the grid locks** | Change what a square pays after players have bought on the old terms. |

## 2. What changes

### 2a. Rules — `squaresServerFieldsUnchanged()` (manager branch only)

On a squares pool, a manager may not change:

- **ever:** `quarterlyNumbers`, `isLocked`, `randomWinner`, `gameId`,
  `gameTime`, `league`;
- **while a game is linked** (stored `gameId` non-empty): `homeTeam`,
  `awayTeam`;
- **once the grid is locked** (stored `isLocked == true`): `payouts`,
  `charity`, `ruleVariations`, `costPerSquare`, `scoreChangePayoutAmount`,
  `numberSets`, `includeOvertime`, `homeTeam`, `awayTeam`;
- **`scores`, once locked, unless the pool is hand-scored** — stored
  `manualScoreOverride == true` OR no game linked. A hand-scored pool has no
  other source of scores.

A same-value write is not an `affectedKey`, so the admin page's existing
patch writes of OTHER fields keep working.

### 2b. Server — `linkSquaresGame` callable (K11)

`linkSquaresGame({ poolId, gameId, league })` and
`linkSquaresGame({ poolId, gameId: null })` (unlink):

- caller is the pool's owner or a confirmed SUPER_ADMIN
  (`assertPoolOwnerOrSuperAdmin`, as `unlockSquaresPool` and the other squares
  callables do), not banned;
- the pool is SQUARES and **not locked**;
- the game is **looked up in the score feed by the server**
  (`ESPN_SITE_API …/summary?event=`), and what is stored is what the feed says
  — teams, kickoff, logos, season type, week — through the existing shared
  `squaresGameLink`. The client's description of the game is not used;
- refused if the feed says the game is not `pre`, or its kickoff is at or
  before the **server** clock;
- refused, writing nothing, if the feed cannot be reached ("try again");
- written in a transaction that re-reads the pool, and audited.

Unlink clears `gameId`, `gameTime`, `league`, and turns off the auto-lock it
switched on; it is refused once locked.

### 2c. Server — `createPool`, squares branch only

Today it stores the `gameId`, `gameTime`, `league` and team names the wizard
sends, checking only that the kickoff is in the future by the wizard's own
number. It will look the game up the same way as 2b and store the feed's
values. A pool created **without** a game is unchanged. If the feed cannot be
reached, a linked create is refused with "Could not reach the schedule — try
again, or create the pool without a game and link it later."

### 2d. Client

- `linkSquaresGame` (`src/utils/linkSquaresGame.ts`) calls the callable
  instead of writing the pool; `started` now also comes back from the server.
  The pool NAME stays a client write (it is not protected), made after a
  successful link, exactly as today.
- The admin page's prize, rules and matchup steps show their fields
  **read-only once the grid is locked**, with one line saying why — instead of
  letting a commissioner edit and then failing on save. The matchup step's
  team-name inputs are read-only while a game is linked.
- **The score inputs become read-only exactly where the rule refuses them**:
  a locked pool with a game linked and Manual Score Override off. Today they
  are shown in every case (`AdminPanel.tsx`, the per-period score cards), so
  a commissioner on such a pool could type a score the rule will refuse. The
  card says why and points at Manual Score Override.

### 2e. Tests reach the feed through a fixture — in the emulator only

A test cannot depend on what the real feed has on the day it runs, and the
end-to-end walk-through drives `createPool` through the functions emulator.
So `lookupSquaresGame` reads `emulatorFixtures/squaresFeed_<id>` first —
**only** when `FUNCTIONS_EMULATOR === 'true'` or `FIRESTORE_EMULATOR_HOST` is
set, the same test `stripe.ts` uses to recognise the emulator; neither exists
in a deployed function. A unit test pins that the reader is never even called
outside the emulator. The collection has no client rule, so the default deny
applies.

The walk-through (`tests/e2e/squares-pool.spec.ts`) seeds that fixture, and
— because its pool is linked and locked when it types a score — now turns on
Manual Score Override first, which is what a commissioner has to do too.

## 3. Decisions taken under the delegation — Kevin's to veto

| # | Decision | Why |
|---|---|---|
| S1 | **Prize terms freeze at LOCK, not at the first sale.** | Lock is when the numbers are drawn and buying stops; before it, a commissioner fixing a typo in the split is ordinary setup. Freezing at first sale would also freeze it while the commissioner is still inviting people. |
| S2 | **A commissioner may still switch `manualScoreOverride` on after lock**, and then enter scores. | It is the only remedy when the feed fails mid-game. Without it a broken feed strands the pool. The commissioner is the trusted party in a squares pool; this is the one remaining direct path and it is visible on the admin page. |
| S3 | **SUPER_ADMIN client writes are unchanged.** | Same posture as every other protected field in this file; the Test Suite and the super-admin reset use it. |
| S4 | **A feed outage refuses a linked create rather than trusting the client.** | The point of K11 is that the client's description of the game is not trusted. "Create it unlinked and link it later" is always available. |

## 4. Evidence required before it is called done

- Rules: a new `squaresServerFields.rules.test.mjs` — each frozen field
  refused for a manager in its condition, allowed outside it (unlocked,
  unlinked, hand-scored), allowed for SUPER_ADMIN, and **the same writes
  allowed on NFL, Bracket and Playoff pools**. `MIN_FILES` in
  `run-rules-tests.mjs` raised by one. All 14 existing rules files unchanged
  and green.
- Callable: unit tests for the feed parsing and the started/not-started
  decision; emulator tests for owner/manager/stranger, locked pool, started
  game, feed down, link and unlink.
- `createPool`: emulator test that the stored teams and kickoff are the
  feed's, not the request's.
- Client: `linkSquaresGame` tests updated to the callable; read-only-after-lock
  rendering tested.
- Mutation-test every guard (the rules function per clause, the callable's
  checks) and report the survivors honestly.
- All seven gates (CLAUDE.md §2e); lint delta zero.
- qodo per §2b; codex **owed** (not available in this environment).

## 5. Deploy and rollback

Ships after #758–#762 and #761 are merged. **Deploy functions BEFORE rules**
(CLAUDE.md §3): the new callable must exist before the rule stops the old
client write, or a commissioner on the old page cannot link a game in the
gap. Then `www`, so the page calls the callable.

Rollback: revert the PR and redeploy rules. The rules change only refuses
writes; reverting it restores the old permissions with no data to repair.
The callable writes the same fields the client wrote, through the same
shared `squaresGameLink`.
