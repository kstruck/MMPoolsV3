// Help copy for Squares and Props — PLAN-HELP-SYSTEM.md T13.
//
// Written against `docs/help-voice.md` (K8). Every behaviour claim below is
// read out of the code that implements it and the source is named in a comment
// beside it, because voice rule 5 — name the default, and name it EXACTLY — is
// the rule this effort keeps breaking, and every break so far was a sentence
// written from memory.
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT SAY.
//
//  1. (CLOSED 2026-11, PLAN-SQUARES-REOPEN A1.) This file used to refuse to
//     repeat the wizard label's "0 = no limit", because nothing implemented
//     it: the callable compared `mySquares >= pool.maxSquaresPerPlayer` with no
//     zero guard and three client readers each invented a different number.
//     There is ONE reader now — `effectiveSquareCap` in
//     `shared/squaresClaim.ts`, used by the callable and by every page — and 0
//     is no limit in all of them. The copy says what the label says, and
//     `tests/help-content-squares-props.test.ts` pins it to that function.
//
//  2. (CLOSED 2026-11, PLAN-SQUARES-REOPEN C1.) This file used to say nothing
//     about which team runs along the rows and which along the columns,
//     because the label and the code disagreed: the scorer indexes the ROW
//     from the away digit and the COLUMN from the home digit
//     (`winningSquare` in `shared/squaresPayouts.ts`), while the wizard
//     labelled home as rows. The labels in `StepSquaresGame.tsx` now say what
//     the scorer does — home across the top, away down the side — so the copy
//     says it once too.

import type { HelpPlacement, HelpTopic } from '../types';
import { RULES_STEP } from './wizard-pages';

const SQUARES = ['SQUARES'] as const;
const PROPS = ['PROPS'] as const;
/** The two one-game formats. Both carry `homeTeam` and `awayTeam`. */
const ONE_GAME = ['SQUARES', 'PROPS'] as const;

/** A setting members meet too — on the pool page, the grid, or their card. */
const EVERYONE = ['member', 'commissioner'] as const;
/** A control only the person creating or managing the pool ever sees. */
const HOST_ONLY = ['commissioner'] as const;

export const SQUARES_PROPS_TOPICS: readonly HelpTopic[] = [
  // ---- The matchup: ONE topic, two fields --------------------------------
  //
  // `homeTeam` and `awayTeam` are one explanation, so they are one topic
  // (voice rule 10) claiming both paths in `fields[]`. Both wizard inputs
  // carry an explicit `helpId` to it, the same way the five payment-handle
  // controls share one topic.
  //
  // THEY ARE EDITABLE TEXT — which is why this is a topic and not a PERMANENT
  // allowlist row beside `gameId`, `date`, `gameTime` and `week`. Both create
  // wizards render a free-text `TextField` (`StepSquaresGame.tsx`,
  // `CreatePropsPool.tsx`) defaulted to the empty string, and both payload
  // builders send `v.homeTeam || undefined`. The squares wizard's game picker
  // fills both in from the chosen game (`pick` in `StepSquaresGame.tsx`) and
  // leaves them editable; the props wizard has no picker, so there they are
  // typed.
  {
    id: 'matchup.teams',
    title: 'The matchup',
    short: 'The two team names this pool is about. Both can be left blank.',
    long: [
      // `pick` in `StepSquaresGame.tsx` sets both from the chosen game. The
      // props wizard has no game picker. The orientation is the scorer's:
      // `winningSquare` reads the COLUMN from the home digit and the ROW from
      // the away digit, and the two field labels say the same.
      'On a squares pool, picking a game from the schedule fills both names in for you, and you can still edit them. The home team runs across the top of the grid and the away team down the side. On a props pool you type them.',
      // `getTeamLogo` (constants.ts:838) fuzzy-matches the typed string against
      // the NFL and NCAA tables and returns null when nothing matches;
      // `Grid.tsx:148-150` and `PoolRoute.tsx:497` render
      // `homeTeamLogo || getTeamLogo(homeTeam)`, falling back to the text.
      'Type each name the way it is normally written. A name the site recognises is matched to that team’s badge; one it does not recognise is shown as the text you typed.',
      // Both are `.optional()` in the create input for both types, and the
      // props wizard's own placeholder is the word "Optional". Nothing in
      // pricing, payouts or scoring reads either field.
      'Both are optional. What a square or a card costs, how the pot is split and how anything is scored do not read them, so a pool with no team names still runs. The person who loses out is a member arriving from your link with nothing on the page telling them which game they are playing.',
      // The asymmetry, stated rather than hidden: `PoolRoute.tsx` renders both
      // names for a squares pool (`:730`, `:769`, `:782`, `:808`), and NOTHING
      // under `src/components/Props/**` or `PropsWizard/**` references either
      // field. Promising a props reader a matchup header would promise a
      // screen that does not exist.
      'A squares pool shows both names on the pool page and around the grid. A props pool stores them and shows them on no screen of its own, so its card and its leaderboard read the same either way.',
    ].join('\n\n'),
    fields: ['homeTeam', 'awayTeam'],
    poolTypes: ONE_GAME,
    audience: HOST_ONLY,
  },

  // ---- Squares: the game link ---------------------------------------------
  //
  // Not a schema path: it explains the picker, which stamps `gameId`,
  // `gameTime`, `league`, the two logos, `seasonType` and `week` from the game
  // chosen. Those are PERMANENT rows in `coverage-allowlist.ts` — the reader
  // picks a game, not an id — so this topic claims no field.
  {
    id: 'squares.game',
    title: 'The game',
    short: 'The real game this pool follows. Pick it from the schedule and the scores arrive and the grid locks at kickoff without you.',
    long: [
      // `CreateSquaresPool.tsx` defaults `gameId` to ''. `pick` sets the names
      // and `gameTime` from the chosen game.
      'No game is linked until you pick one. Choose the league and the day, find the games, and pick yours. That fills in both team names and the kickoff time.',
      // `squaresCreateDefaults` sets `reminders.lock` to the kickoff, which
      // `autoLockPools` acts on; the lock draws the numbers when the grid has
      // none; `syncGameStatus` records each period's winner for a pool with a
      // `gameId`.
      'A linked pool runs itself on game day. The grid locks at kickoff, the numbers are drawn when it locks, and each quarter’s winner is recorded as the score comes in.',
      'Leave it unlinked only when your game is not on the schedule. You then type the team names, lock the grid yourself before the game, and enter each quarter’s score by hand.',
      // `squaresGameHasStarted` in `functions/src/lib/squaresGame.ts`, checked
      // by the claim path for everyone but the pool owner.
      'Players cannot claim a square once a linked game has kicked off.',
    ].join('\n\n'),
    fields: [],
    poolTypes: SQUARES,
    audience: HOST_ONLY,
    related: ['matchup.teams', 'numberSets'],
  },

  // ---- Squares: the prize split -------------------------------------------
  //
  // ONE topic for the four percentage boxes (voice rule 10): they are one
  // explanation, and all four inputs carry `helpId="squaresPayouts"`.
  {
    id: 'squaresPayouts',
    title: 'Quarter payouts',
    // `SQUARES_DEFAULT_PAYOUTS` in `shared/squaresDefaults.ts` is 25/25/25/25,
    // and `CreateSquaresPool.tsx` starts the form on the same numbers.
    short: 'How the prize pot is split between the first quarter, halftime, the third quarter and the final score. It starts at 25% each.',
    long: [
      // The create contract refuses a split that does not total 100
      // (`squaresCreateInputSchema`), and the step validates it before Next.
      'It starts at 25% each. The four must add up to exactly 100%, and you cannot move past this step until they do.',
      // `periodBase`: net pot × percent. The example under the boxes calls the
      // same function.
      'Each prize is that share of the pot, after any charity share has come off. The example under the boxes works it out for a full grid at your price per square. A quarter set to 0 pays nothing.',
      'Change it when you want the final score to be worth more than the early quarters. The final prize goes on the score at the end of the game, overtime included.',
      // Voice rule 8.
      'Players see each prize on the pool page. Prizes move between you and your winners directly — this site never holds the pot and never pays anyone for you.',
    ].join('\n\n'),
    fields: ['squaresPayouts.q1', 'squaresPayouts.half', 'squaresPayouts.q3', 'squaresPayouts.final'],
    poolTypes: SQUARES,
    audience: EVERYONE,
    terms: ['squares-winner'],
    related: ['charity', 'ruleVariations.quarterlyRollover'],
  },
  {
    id: 'charity',
    title: 'Charity share',
    // `CreateSquaresPool.tsx` defaults `charity.enabled` to false, and
    // `squaresCharity` reads an absent value as off at 0%.
    short: 'Sets aside a share of the pot for a cause you name. It is off unless you turn it on.',
    long: [
      // `squaresPot`: `Math.floor(gross × pct / 100)`, taken off before `net`.
      'It is off to start with. Turn it on and set a percentage, and that share comes off the pot before any prize is worked out. The charity amount is rounded down to a whole dollar, so the prizes never come up short.',
      'Use it when the pool is a fundraiser. Name the cause so your players know where the money is going.',
      // `PoolRoute.tsx` renders the name, the percentage and the running amount.
      'Players see the charity’s name, the percentage and the amount raised so far on the pool page.',
      // Voice rule 8.
      'This site does not collect the donation or send it. You hold that money with the rest of the pot and pass it to the charity yourself.',
    ].join('\n\n'),
    fields: ['charity.enabled', 'charity.percentage', 'charity.name'],
    poolTypes: SQUARES,
    audience: EVERYONE,
    related: ['squaresPayouts'],
  },
  {
    id: 'ruleVariations.reverseWinners',
    title: 'Reverse winners',
    // Defaults to false in `CreateSquaresPool.tsx`; absent reads as off
    // (`squaresRules`).
    short: 'Shares each quarter’s prize with the square whose two digits are the other way round. It is off unless you turn it on.',
    long: [
      // `computePeriodPayouts`: two claims, half each; the second half takes
      // what the first left so they sum to the prize.
      'It is off to start with. Turn it on and each quarter has two winning squares: the one matching the score, and the one with the two digits swapped. They take half the prize each.',
      // `reverseSquare` returns null when the digits match.
      'When both digits are the same — a 7 and a 7 — there is no second square, and the one winner takes the whole prize.',
      'Turn it on when you want twice as many winners and are happy for each prize to be half the size.',
      // An unsold half follows the rollover rule like any unsold prize.
      'If one of the two squares was never bought, that half is treated like any other unsold prize: it rolls into the next quarter, or stays with you, depending on the setting below this one.',
    ].join('\n\n'),
    poolTypes: SQUARES,
    audience: EVERYONE,
    terms: ['squares-winner'],
    related: ['ruleVariations.quarterlyRollover'],
  },
  {
    id: 'ruleVariations.quarterlyRollover',
    title: 'Roll over unsold prizes',
    // `CreateSquaresPool.tsx` defaults this to TRUE — what a squares pool on
    // this site has always started with (`createNewPool` in constants.ts).
    short: 'What happens to a prize when nobody owns the winning square. It starts on, which moves the prize into the next quarter.',
    long: [
      // `computePeriodPayouts`: `carry` adds the unclaimed amount to the next
      // period's prize when `quarterlyRollover` is true.
      'It starts on. When the winning square for a quarter was never bought, that prize is added to the next quarter’s, so the money stays in play for your players.',
      // Off: the claim is recorded against `Unsold` with its amount.
      'Turn it off and an unsold prize is not paid to anyone. It stays with you, and the pool page shows that quarter’s square as unsold.',
      'It only matters on a grid that does not sell out. On a full grid every winning square has an owner.',
      'When it is on, you also choose what happens if the final square is the unsold one, since there is no later quarter to roll into.',
    ].join('\n\n'),
    poolTypes: SQUARES,
    audience: EVERYONE,
    terms: ['squares-winner'],
    related: ['ruleVariations.unclaimedFinalPrizeStrategy', 'ruleVariations.reverseWinners'],
  },
  {
    id: 'ruleVariations.unclaimedFinalPrizeStrategy',
    title: 'Unsold final square',
    // Default `last_winner` (`CreateSquaresPool.tsx`, `squaresRules`). The
    // select's two labels are quoted so the reader can find them.
    short: 'Who gets the final prize when nobody owns the final square. It starts on the last player who won.',
    long: [
      // `computePeriodPayouts`, the `final_rollover` claim: the most recent
      // claim a player won, this period's own first, then back.
      'It starts on “Give it to the last player who won”. The final prize, with anything rolled into it, goes to whoever won most recently before it.',
      // `drawSquaresFinalPrize`: once, among sold squares, commissioner-run.
      '“Random draw among the squares that were sold” leaves the prize waiting once the game ends. You run the draw from the pool’s manage page, every sold square has the same chance, and a draw that has been made stands.',
      'If no square won anything all game, there is no last winner to give it to, and the prize stays unsold.',
      'You only see this choice while unsold prizes are set to roll over.',
    ].join('\n\n'),
    poolTypes: SQUARES,
    audience: EVERYONE,
    terms: ['squares-winner'],
    related: ['ruleVariations.quarterlyRollover'],
  },

  // ---- Squares: the grid rules -------------------------------------------
  {
    id: 'maxSquaresPerPlayer',
    title: 'Max squares per player',
    // `effectiveSquareCap` (`shared/squaresClaim.ts`): 0, absent and negative
    // all mean no limit. `CreateSquaresPool.tsx` defaults the field to 0.
    short: 'The most squares one person may claim. It starts at 0, which means no limit.',
    long: [
      'It starts at 0, and 0 means no limit: one player could take every square on the grid. Set a number if you want the grid spread across more people.',
      'On a hundred-square grid, 10 holds one player to a tenth of it and 100 lets one player take the lot. Pick the number that keeps the grid worth playing for the people you invited.',
      // `countHeldSquares`: same account, same guest device, or same name
      // (trimmed, case-insensitive). `planClaim` exempts the pool owner.
      'The limit follows the person, not the spelling. Squares held by the same account, on the same browser, or under the same name all count toward it. The pool owner is not limited, so you can enter squares for people who asked you to.',
      // The callable checks the count at claim time only, so squares already
      // held are never taken back.
      'Players see the limit on the pool page, and the grid stops them selecting past it. Lowering it later takes nothing off anyone who already holds more than that — it only stops the next claim.',
    ].join('\n\n'),
    poolTypes: SQUARES,
    audience: EVERYONE,
    related: ['costPerSquare', 'numberSets'],
  },
  {
    id: 'numberSets',
    title: 'Number sets',
    // The select offers exactly two options, labelled "One set of numbers" and
    // "New numbers each quarter" (`CreateSquaresPool.tsx:30-33`), and the
    // wizard default is '1' (`:43`, and `Number(v.numberSets ?? 1)` at
    // `buildSquaresPayload.ts:30`). The default is named with the option's own
    // words so the reader can find it in the list.
    short: 'Whether the digits on the grid are drawn once for the whole game or again for each quarter. One set of numbers is the default.',
    long: [
      // `autoLock.ts` and `lockSquaresPool` draw `axisNumbers` when the grid locks, and
      // seeds `quarterlyNumbers.q1` from the same draw when numberSets is 4.
      'One set of numbers is the default. The digits are drawn when the grid locks and stand for all four payouts, so the digits on your square at the final whistle are the ones it had at kickoff.',
      // `scoreUpdates.ts:907-936` generates q2 when the first quarter goes
      // final, q3 at half, q4 at the third quarter, and `gameLogic.ts:241-245`
      // pays each period against its own set. Squares are never reassigned.
      'New numbers each quarter draws a fresh set as each quarter finishes. Nobody’s square changes hands — the digits along the edges do — so a square that was nowhere near the first quarter can take the second.',
      // `PoolRoute.tsx:613-615` prints the number of sets and the sentence, and
      // `Grid.tsx:429-433` renders the set belonging to the quarter on screen.
      'Pick it when you want everybody still watching after the first quarter. Members see which one your pool is running on the pool page, and the grid shows the set for the quarter being played.',
    ].join('\n\n'),
    poolTypes: SQUARES,
    audience: EVERYONE,
    related: ['maxSquaresPerPlayer'],
  },

  // ---- Props: the card cap -----------------------------------------------
  {
    id: 'props.maxCards',
    title: 'Max cards per player',
    // THERE IS NO UNLIMITED VALUE, and saying so is the point of this topic.
    // `shared/schemas/props.ts:19` is `z.number().int().min(1)`, the input is
    // `min={1}` (`CreatePropsPool.tsx:37`), and the default is 1 (`:90`, and
    // `Number(v.props?.maxCards ?? 1)` at `buildPropsPayload.ts:35`). Contrast
    // `settings.maxEntriesTotal`, where -1 does mean unlimited.
    short: 'The most cards one person may buy. One card each is the default, and one is also the lowest — there is no unlimited setting.',
    long: [
      'One card each is the default. Raise it and a player can fill in more than one card; each card is answered separately and scored on its own.',
      // Voice rule 8. The card price is `props.cost`, labelled "Cost per card
      // ($)" on the fee step (`CreatePropsPool.tsx:113`).
      'Every card costs the card price, so a player who takes three owes you three times it. That money moves between you and your players directly — this site never holds it and never moves it for you.',
      // `functions/src/propBets.ts:56-64` counts the player's existing cards
      // and refuses once the count reaches the number. Nothing deletes a card
      // when the number is lowered.
      'A player is turned away once they hold the number you set. Lowering it later does not take a card off anyone who already has one.',
    ].join('\n\n'),
    poolTypes: PROPS,
    audience: EVERYONE,
    terms: ['entry-fee'],
    related: ['props.cost'],
  },
];

/**
 * Where the Squares and Props copy sits.
 *
 * The step ids come from `RULES_STEP` rather than being written out, for the
 * reason `wizard-shared.ts` gives: the squares wizard calls its rules step
 * `grid` and the props wizard calls its `setup`, and a placement naming a step
 * page the wizard does not have would be silently unreachable.
 */
const SQUARES_STEP = `wizard.squares.${RULES_STEP['wizard.squares']}`;
/** The squares wizard's own payouts step — quarters, not finishing places. */
const SQUARES_PAYOUTS_STEP = 'wizard.squares.payouts';
const PROPS_STEP = `wizard.props.${RULES_STEP['wizard.props']}`;

export const SQUARES_PROPS_PLACEMENTS: readonly HelpPlacement[] = [
  // Create wizard — the squares "Matchup & grid" step.
  { topic: 'squares.game', page: SQUARES_STEP, section: 'matchup', order: 0 },
  { topic: 'matchup.teams', page: SQUARES_STEP, section: 'matchup', order: 1 },
  { topic: 'maxSquaresPerPlayer', page: SQUARES_STEP, section: 'grid', order: 2 },
  { topic: 'numberSets', page: SQUARES_STEP, section: 'grid', order: 3 },

  // Create wizard — the squares "Payouts" step.
  { topic: 'squaresPayouts', page: SQUARES_PAYOUTS_STEP, section: 'payouts', order: 0 },
  { topic: 'charity', page: SQUARES_PAYOUTS_STEP, section: 'payouts', order: 1 },
  { topic: 'ruleVariations.reverseWinners', page: SQUARES_PAYOUTS_STEP, section: 'rules', order: 2 },
  { topic: 'ruleVariations.quarterlyRollover', page: SQUARES_PAYOUTS_STEP, section: 'rules', order: 3 },
  { topic: 'ruleVariations.unclaimedFinalPrizeStrategy', page: SQUARES_PAYOUTS_STEP, section: 'rules', order: 4 },

  // Create wizard — the props "Props setup" step. The two question topics are
  // already placed here by T1, at orders 0 and 1.
  { topic: 'matchup.teams', page: PROPS_STEP, section: 'matchup', order: 0 },
  { topic: 'props.maxCards', page: PROPS_STEP, section: 'cards', order: 2 },

  // What a squares member reads to find out what they joined. `pool.squares`
  // has no tabs of its own, so the root page carries both grid rules.
  { topic: 'maxSquaresPerPlayer', page: 'pool.squares', section: 'grid', order: 0 },
  { topic: 'numberSets', page: 'pool.squares', section: 'grid', order: 1 },
  // ...and what the prizes are and who they go to.
  { topic: 'squaresPayouts', page: 'pool.squares', section: 'prizes', order: 2 },
  { topic: 'charity', page: 'pool.squares', section: 'prizes', order: 3 },
  { topic: 'ruleVariations.reverseWinners', page: 'pool.squares', section: 'prizes', order: 4 },
  { topic: 'ruleVariations.quarterlyRollover', page: 'pool.squares', section: 'prizes', order: 5 },
  { topic: 'ruleVariations.unclaimedFinalPrizeStrategy', page: 'pool.squares', section: 'prizes', order: 6 },

  // The squares commissioner panel. Settings edits the cap and the number
  // sets; Game status is where the matchup is chosen.
  { topic: 'maxSquaresPerPlayer', page: 'admin.squares.settings', section: 'grid', order: 0 },
  { topic: 'numberSets', page: 'admin.squares.settings', section: 'grid', order: 1 },
  { topic: 'matchup.teams', page: 'admin.squares.game', section: 'matchup', order: 0 },
  { topic: 'squares.game', page: 'admin.squares.game', section: 'matchup', order: 1 },
  // Payouts is where the split, the charity share and the unsold-prize rules
  // are edited after the pool exists.
  { topic: 'squaresPayouts', page: 'admin.squares.payouts', section: 'payouts', order: 0 },
  { topic: 'charity', page: 'admin.squares.payouts', section: 'payouts', order: 1 },
  { topic: 'ruleVariations.reverseWinners', page: 'admin.squares.payouts', section: 'rules', order: 2 },
  { topic: 'ruleVariations.quarterlyRollover', page: 'admin.squares.payouts', section: 'rules', order: 3 },
  { topic: 'ruleVariations.unclaimedFinalPrizeStrategy', page: 'admin.squares.payouts', section: 'rules', order: 4 },

  // The props member's own screen, and their commissioner's.
  { topic: 'props.maxCards', page: 'pool.props.cards', section: 'cards', order: 0 },
  { topic: 'props.maxCards', page: 'pool.props.admin', section: 'cards', order: 0 },
];
