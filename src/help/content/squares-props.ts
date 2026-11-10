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
//  2. It says nothing about which team runs along the rows and which along the
//     columns. The wizard label already says it (voice rule 2), and the two
//     sources disagree about the orientation anyway — `gameLogic.ts:249-250`
//     indexes the ROW from `axis.away` and the COLUMN from `axis.home`, while
//     `CreateSquaresPool.tsx:25` labels home as rows. A help sentence about
//     it would be a guess.

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
  // THEY ARE TYPED, NOT DERIVED — which is why this is a topic and not a
  // PERMANENT allowlist row beside `gameId`, `date`, `gameTime` and `week`.
  // Both create wizards render a free-text `TextField`
  // (`CreateSquaresPool.tsx:25-26`, `CreatePropsPool.tsx:34-35`) defaulted to
  // the empty string, and both payload builders send `v.homeTeam || undefined`
  // (`buildSquaresPayload.ts:27`, `buildPropsPayload.ts:38`). The LEGACY admin
  // game picker does derive them from a chosen game
  // (`AdminPanel.tsx:366-367`, `WizardStepGame.tsx:118-119`), which is that
  // surface's own ticket; in the wizard this topic is placed on, the reader
  // types them.
  {
    id: 'matchup.teams',
    title: 'The matchup',
    short: 'The two team names this pool is about. You type them in, nothing is looked up for you, and both can be left blank.',
    long: [
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
      // `autoLock.ts:149-161` draws `axisNumbers` when the grid locks, and
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
const PROPS_STEP = `wizard.props.${RULES_STEP['wizard.props']}`;

export const SQUARES_PROPS_PLACEMENTS: readonly HelpPlacement[] = [
  // Create wizard — the squares "Matchup & grid" step.
  { topic: 'matchup.teams', page: SQUARES_STEP, section: 'matchup', order: 0 },
  { topic: 'maxSquaresPerPlayer', page: SQUARES_STEP, section: 'grid', order: 1 },
  { topic: 'numberSets', page: SQUARES_STEP, section: 'grid', order: 2 },

  // Create wizard — the props "Props setup" step. The two question topics are
  // already placed here by T1, at orders 0 and 1.
  { topic: 'matchup.teams', page: PROPS_STEP, section: 'matchup', order: 0 },
  { topic: 'props.maxCards', page: PROPS_STEP, section: 'cards', order: 2 },

  // What a squares member reads to find out what they joined. `pool.squares`
  // has no tabs of its own, so the root page carries both grid rules.
  { topic: 'maxSquaresPerPlayer', page: 'pool.squares', section: 'grid', order: 0 },
  { topic: 'numberSets', page: 'pool.squares', section: 'grid', order: 1 },

  // The squares commissioner panel. Settings edits the cap and the number
  // sets; Game status is where the matchup is chosen.
  { topic: 'maxSquaresPerPlayer', page: 'admin.squares.settings', section: 'grid', order: 0 },
  { topic: 'numberSets', page: 'admin.squares.settings', section: 'grid', order: 1 },
  { topic: 'matchup.teams', page: 'admin.squares.game', section: 'matchup', order: 0 },

  // The props member's own screen, and their commissioner's.
  { topic: 'props.maxCards', page: 'pool.props.cards', section: 'cards', order: 0 },
  { topic: 'props.maxCards', page: 'pool.props.admin', section: 'cards', order: 0 },
];
