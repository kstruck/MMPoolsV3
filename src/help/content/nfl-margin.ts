// Help copy for the NFL payout choice and the hybrid split — PLAN-HELP-SYSTEM.md T11.
//
// WHY THE FILE IS NAMED FOR MARGIN AND THE TOPICS ARE NOT SCOPED TO IT.
// T11 is "NFL Margin + the hybrid split", and Margin turns out to carry NO
// setting of its own: `marginCreateInputSchema` is the shared NFL settings plus
// `payoutMode`, `hybridSplit` and `weeklyPayouts` — the same three Pick'em has
// (`shared/schemas/nfl.ts:94-106` against `:50-73`). Survivor has none of them.
// So the copy here is scoped to `['NFL_PICKEM', 'NFL_MARGIN']`: wider would
// show a Survivor reader a payout choice their pool cannot make, and narrower
// would leave the same three controls unexplained on the other type.
//
// Written against `docs/help-voice.md` (K8). ALL OF IT IS MONEY COPY, so voice
// rule 8 governs: entry fees and prizes move between people peer to peer and
// the platform never holds them, and every topic below says so.
//
// Every behaviour claim is read out of the code that implements it, named in a
// comment beside the claim. The readings that matter:
//
//   `shared/prizePot.ts` potBreakdown()      — what each mode does to the pot
//   `shared/prizePot.ts` perWeekPrizePot()   — allocation ÷ weeksInSeason
//   `shared/prizePot.ts` weeklyPlacesFor()   — which place list prices a week
//   `shared/hybridSplit.ts` hybridSplitProblem() — the sum rule and its refusal
//   `shared/seasonPrizes.ts` computeSeasonPrizeSnapshot() — WEEKLY publishes none
//   `shared/weeklyPrizes.ts` computeWeeklyPrizeSnapshot() — SEASON publishes none
//   `functions/src/lib/hybridSplitGate.ts` hybridSplitNeedsClearing()
//   `functions/src/lib/weeklyPayoutsGate.ts` weeklyPayoutsNeedsClearing()
//
// THE DEFAULT, NAMED EXACTLY (voice rule 5). `payoutMode` is `.optional()` in
// both create schemas — there is no schema-level default — so the default is
// what the surfaces write and read:
//   `CreateNFLPickemPool.tsx:126`  `payoutMode: 'SEASON'` in defaultValues
//   `CreateNFLMarginPool.tsx:60`   `payoutMode: 'SEASON'` in defaultValues
//   `NFLManagerView.tsx:385, :473` `settings.payoutMode ?? 'SEASON'`
// The three surfaces label that value differently ("Season-long" in the
// wizard, "Season-End Standings Only" on the Pick'em manager branch,
// "Season-End Totals Only" on the Margin one), so the copy names the default
// by what it DOES rather than by a label that is wrong on two screens out of
// three — which is also voice rule 2.
//
// WHY THE SUM RULE IS STATED ONCE, IN `settings.payoutMode` (voice rule 10).
// "the two must add up to the entry fee exactly" is ONE rule. It is printed on
// screen directly above both split inputs, in all three places they render
// (`HybridSplitFields.tsx:41-43`, `NFLManagerView.tsx:1507-1509` and `:1746-1748`),
// so repeating it in both split tooltips would be the same sentence three more
// times. Each split topic explains its own half; the rule they share lives in
// the topic for the choice that turns them on.
//
// THE CHARITY DEDUCTION IS STATED ONCE, IN THE SAME PLACE, FOR THE SAME REASON
// (codex r1 [P2] on this file). `potBreakdown` takes the charity cut off the
// GROSS and then scales the weekly allocation by `charityFactor`
// (`prizePot.ts:61-72`), so neither typed amount is what its pot holds on a
// pool that gives a share away — a 10% pool splitting $25 as $18/$7 fills the
// pots from $16.20/$6.30 per entry. The two pots divide what charity leaves,
// which is the only claim that holds: the season pot takes the remainder, so
// rounding can push it ABOVE the amount typed (codex r3). That is one fact
// about the split as a
// whole, not two, so the two field topics were written to describe the
// DIVISION they set rather than to promise an amount, and the deduction is
// named once in `settings.payoutMode`.
//
// WHY THE SPLIT TOPIC IDS ARE THE FIELD PATHS. `NumberField` defaults its
// `helpId` to the field `name` (`wizard/fields.tsx:100-107`), so a topic whose
// id IS the path gets a `?` on the wizard control with no call-site change. An
// explicit `helpId` was NOT an option here: `HybridSplitFields` is reached from
// `StepFeeAndPayment`, which all SEVEN create wizards render, and
// `help-ui-coverage.test.ts` requires an explicit `helpId` to resolve for every
// pool type that renders its file. These two settings exist on two types, so
// the id-as-path route is the one that keeps the scope honest.

import type { HelpPlacement, HelpTopic } from '../types';
import { EVERYONE } from './nfl-shared';

/**
 * The two NFL season formats that carry `payoutMode`, `hybridSplit` and
 * `weeklyPayouts`. Survivor does not (`shared/schemas/nfl.ts:76-92`).
 */
export const PAYOUT_MODE_TYPES = ['NFL_PICKEM', 'NFL_MARGIN'] as const;

/**
 * The peer-to-peer statement voice rule 8 requires of every money topic.
 *
 * Written once and shared rather than retyped, because rule 10 applies to the
 * codebase and not only to the rendered page: a second wording of this
 * sentence is exactly what the rule refuses. (`costPerSquare` and `props.cost`
 * in `wizard-shared.ts` carry the same sentence for the same reason.)
 */
const MONEY_MOVES_DIRECTLY =
  'The money moves between you and your players directly. Nothing is held here — this is a record of what you owe, and you settle it.';

export const NFL_MARGIN_TOPICS: readonly HelpTopic[] = [
  {
    id: 'settings.payoutMode',
    title: 'Payout method',
    short:
      'Whether prizes go to the weekly winners, to the final season standings, or to both. Paying only on the final standings is the default.',
    long: [
      // SEASON. `potBreakdown` puts the whole net pot in `seasonPot` and leaves
      // `weeklySeasonAllocation` undefined (`prizePot.ts:73-75`);
      // `weeklyPlacesFor` returns `[]` for SEASON (`:106`), and
      // `computeWeeklyPrizeSnapshot` returns undefined for any mode that is not
      // WEEKLY or HYBRID (`weeklyPrizes.ts:98-99`). The week still publishes —
      // with no prize against it (D7).
      // NOT "the whole pot goes to the finishing places you set" (codex r2 [P2]):
      // `payoutsSchema` accepts a place list totalling UNDER 100%, and bonuses
      // take their share of the same 100% (`shared/schemas/common.ts:78-93`), so
      // that wording promised a distribution the schema does not require. What
      // SEASON actually decides is which pot the money sits in — `seasonPot = net`,
      // `weeklySeasonAllocation` undefined — and how the places then divide it is
      // `settings.payouts.places.*.percentage`'s sentence to own (voice rule 10;
      // it already says shares may total less than 100%). Self-review caught the
      // first attempt at this sentence doing the same thing in weaker grammar —
      // "the whole pot waits for the final standings AND the finishing places
      // you set" reattaches the quantity to the places. Naming the places as the
      // list that DECIDES the division is the phrasing that survives a pool
      // paying 60/25 and keeping the rest.
      'Paying only on the final standings is the default. Nothing is set aside for the weeks: the whole pot sits on the final standings, and your season places decide how it divides. A week you score names its winner without carrying a prize.',
      // WEEKLY. `potBreakdown`: `weeklySeasonAllocation = net` (`:76-77`), no
      // `seasonPot`. `computeSeasonPrizeSnapshot` returns undefined outright
      // for WEEKLY (`seasonPrizes.ts:70`).
      'Weekly puts the whole pot into the weeks instead. Each week you score pays its own places, and the final standings carry no prize of their own.',
      // HYBRID. The sum rule is `hybridSplitProblem` (`shared/hybridSplit.ts:64-70`):
      // whole dollars, entry fee a whole number above zero, weekly + season ===
      // entryFee. It runs in the create schema's superRefine AND in the update
      // callable, so a save that breaks it is refused on both paths.
      // `weeklyPlacesFor` falls back to the season places when a HYBRID pool
      // declares no weekly list (`prizePot.ts:107-108`) — "no list", NOT "an
      // empty one". An empty ARRAY is truthy, so a stored `{ places: [] }` is
      // returned as itself and the weekly pot has no places at all. That state
      // is deliberate and reachable: `normalizePayoutListsPatch` exists to turn
      // `weeklyPayouts: {}` into `{ places: [] }` precisely so it does NOT fall
      // through (`weeklyPayoutsGate.ts:110-116`), and `NFLManagerView.tsx:406-410`
      // preserves it across unrelated saves. So the copy states the condition
      // `weeklyPlacesFor` actually tests — no separate list — rather than telling
      // a commissioner to "leave it empty", which is true of the two authoring
      // surfaces and false of that stored pool. (codex r3 [P2]; the same finding
      // was rejected at r2 on a premise about the authoring surfaces that was
      // right and beside the point.)
      'Hybrid pays both. It asks you to divide the entry fee into two whole-dollar amounts — one for the weekly pots, one for the season pot — and the two have to add up to the fee exactly, or the save is refused. Each pot can have its own list of prize places. With no separate weekly list, your season places price both pots.',
      // Charity comes off BEFORE either pot exists: `potBreakdown` takes the cut
      // from the gross and then scales the weekly allocation by `charityFactor`
      // (`prizePot.ts:61-72`), so on a 10% pool an $18/$7 split fills the pots
      // from $16.20/$6.30 per entry, not $18/$7.
      //
      // NOT "both pots hold less than the two amounts you typed" (codex r3 [P2]).
      // The season pot is the REMAINDER — `net − floor(weekly × charityFactor)` —
      // so it absorbs both roundings and can come out ABOVE what was typed: one
      // $25 entry, a $25/$0 split and 10% charity gives net $23, weekly $22 and
      // a season pot of $1 against a typed $0. What IS invariant is that the two
      // pots divide `net` exactly, so that is what the sentence claims.
      //
      // Stated HERE and nowhere else
      // (voice rule 10): it is one fact about the split as a whole, and this is
      // the topic that owns the rules the two halves share. The member-facing
      // weekly tooltip already says the same thing in the same order
      // (`WeeklyWinnersList.tsx:79`, "after any charity donation").
      'If your pool gives a share to charity, that comes off the fees before either pot is worked out, so the two pots divide what is left rather than the whole of what you collect.',
      // The absent-split case, which is every hybrid pool created before the
      // split existed. `potBreakdown` returns `net` but NEITHER pot.
      //
      // NOT "shown the places without dollar figures" (self-review, the class
      // codex r5 found twice). `dollarFor` falls back to `netPot` whenever
      // `splitPots` is undefined (`PayoutsPanel.tsx:363-370`), so on any pool
      // whose entry count is known a place DOES carry a figure — priced off the
      // combined pot, because neither half can be worked out. Saying members see
      // no figure at all would leave a commissioner unable to recognise the
      // number their members are actually looking at.
      'A Hybrid pool that has never set a split still runs. Neither pot can be worked out until you set one, so a dollar figure shown against a place is priced off the whole pot rather than either half.',
      // Leaving HYBRID. `hybridSplitNeedsClearing` deletes the stored split and
      // `weeklyPayoutsNeedsClearing` the stored weekly list, both on the save
      // that moves the mode (`functions/src/lib/hybridSplitGate.ts:101-110`,
      // `weeklyPayoutsGate.ts:62-70`) — without which the merge leaves a split
      // on a non-hybrid pool and the mode becomes impossible to change at all.
      // A scored week keeps its frozen `weeklyPrize` snapshot; the ledger reads
      // that, never live settings.
      'Moving away from Hybrid clears the split and any separate weekly list when you save, and your season places become the only list. A week that has already been scored keeps the prize it was published with, so a change reaches only the weeks not yet scored.',
      MONEY_MOVES_DIRECTLY,
    ].join('\n\n'),
    poolTypes: PAYOUT_MODE_TYPES,
    audience: EVERYONE,
    terms: ['entry-fee', 'weekly-prize', 'season-prize'],
    related: [
      'settings.hybridSplit.weeklyPerEntry',
      'settings.hybridSplit.seasonPerEntry',
      'settings.payouts.places.*.percentage',
    ],
  },

  {
    id: 'settings.hybridSplit.weeklyPerEntry',
    title: 'Weekly share of the entry fee',
    short: 'Which part of every entry fee the weekly prize pots draw on, in whole dollars. Only a Hybrid pool has this.',
    long: [
      // `potBreakdown` (`prizePot.ts:69-72`): the season-long weekly allocation
      // is `floor(weeklyPerEntry × entries × charityFactor)` — so this box sets
      // the DIVISION of the fee, and the dollars typed here are not what the pot
      // holds once a pool gives a share away. The copy says what the box decides
      // rather than promising an amount; the deduction itself is stated once, in
      // `settings.payoutMode`.
      //
      // It also does not say "the more you put here the bigger the weekly pots":
      // `floor(w × entries × charityFactor)` is only WEAKLY monotone, so on a
      // charity pool a one-dollar move can leave the pot where it was (one entry, 10%:
      // $10 and $11 both floor to $9). The trade-off between the two halves is
      // exact and is `settings.hybridSplit.seasonPerEntry`'s sentence anyway
      // (voice rule 10), so this one says what the box IS instead.
      'Every entry fee divides between the two pots, and this is the weekly side of that division. It is the money behind the weekly prizes for the whole season, not for one week.',
      // `perWeekPrizePot` (`prizePot.ts:87-91`) is that allocation divided by
      // `weeksInSeason` — the pool's OWN week count, frozen, never a hardcoded
      // 18. A preseason pool really does have four.
      //
      // NOT "a short pool pays MORE per week" (codex r5 [P2]). `perWeekPrizePot`
      // FLOORS, so a small allocation gives the same whole-dollar prize either
      // way: a $1 weekly allocation is $0 a week over four weeks and $0 a week
      // over eighteen. The divisor is the claim worth making, and it is exact.
      'One week is worth the whole season’s weekly money divided by the number of weeks your pool covers. That is your pool’s own count — a four-week preseason pool divides by four, never by a full season.',
      // `computeWeeklyPrizeSnapshot` runs only on the FIRST publication of a
      // week and the recap keeps the snapshot; the ledger prices from it.
      'What a weekly winner is owed is worked out when that week is scored and then held still, so changing this afterwards does not re-price a week that has already been settled.',
      MONEY_MOVES_DIRECTLY,
    ].join('\n\n'),
    // ⚠️ THE `fields[]` IS LOAD-BEARING, even though it repeats the id.
    //
    // `help-ui-coverage.test.ts` asks whether a bound control is explained for
    // EVERY pool type whose wizard renders the file it sits in — the strict
    // reading, and the right one for a shared step. `HybridSplitFields` is
    // reached from `StepFeeAndPayment`, so all seven wizards "render" it, and a
    // topic scoped to two types can never satisfy that question by resolution.
    //
    // A `fields[]` claim is the guard's own documented escape for exactly this
    // shape (the five payment-handle controls use it), and it is honest here:
    // the control returns null unless `settings.payoutMode === 'HYBRID'`
    // (`HybridSplitFields.tsx:25`), and only Pick'em and Margin have a payout
    // mode to set. So the field is helped everywhere it can actually appear.
    fields: ['settings.hybridSplit.weeklyPerEntry'],
    poolTypes: PAYOUT_MODE_TYPES,
    audience: EVERYONE,
    terms: ['entry-fee', 'weekly-prize'],
    related: ['settings.payoutMode', 'settings.hybridSplit.seasonPerEntry'],
  },

  {
    id: 'settings.hybridSplit.seasonPerEntry',
    title: 'Season share of the entry fee',
    short:
      'Which part of every entry fee the one season pot draws on, paid on the final standings. Only a Hybrid pool has this.',
    long: [
      // `potBreakdown` (`prizePot.ts:72`): `seasonPot = net − weeklySeasonAllocation`,
      // and `net` is already charity-deducted — so, like its twin, this box sets
      // a share and not an amount. `computeSeasonPrizeSnapshot` prices it against
      // `settings.payouts.places`.
      'This is the season side of how each entry fee divides. It stands behind the single prize paid once the season is over, split across your season prize places.',
      // The sum rule itself is stated in the payout-method topic and printed
      // above both inputs on every screen that renders them; what is worth
      // saying HERE is the consequence for this box (voice rules 2 and 10).
      'It is the rest of the fee. Raise the weekly amount and this one has to come down, because the two together have to equal the entry fee.',
      // NOT "members see both halves before they join" (codex r5 [P2]). The
      // pre-join screen renders the prize panel COMPACT (`JoinPool.tsx:223`),
      // and the block that prints the two per-entry amounts is behind
      // `!compact` (`PayoutsPanel.tsx:416`) — so a joiner is never shown the
      // split. The consequence is what the sentence was for, and it survives
      // without the false premise about where they saw it.
      'Changing either half after the pool has filled changes the split the people who already paid joined under.',
      MONEY_MOVES_DIRECTLY,
    ].join('\n\n'),
    // Same reason as its twin above: the control lives in a file every wizard
    // reaches, and the claim is what tells the coverage guard so.
    fields: ['settings.hybridSplit.seasonPerEntry'],
    poolTypes: PAYOUT_MODE_TYPES,
    audience: EVERYONE,
    terms: ['entry-fee', 'season-prize'],
    related: ['settings.payoutMode', 'settings.hybridSplit.weeklyPerEntry'],
  },
];

/**
 * Where the payout copy sits.
 *
 * The payout method is chosen on the create wizard's rules step and edited on
 * the commissioner's settings tab; the split fields render under the entry fee
 * on the FEE step (`StepFeeAndPayment.tsx:23`), not the payouts one. Members
 * meet all three on the rules page, which is the screen they read to find out
 * what they joined — one explanation, several placements (voice rule 10).
 *
 * The placements name pages shared by all three NFL season formats;
 * `resolveTopic` filters on pool type, so a Survivor reader sees none of them.
 */
export const NFL_MARGIN_PLACEMENTS: readonly HelpPlacement[] = [
  // Create wizards — the payout choice is on the rules step of both.
  { topic: 'settings.payoutMode', page: 'wizard.pickem.rules', section: 'rules', order: 16 },
  { topic: 'settings.payoutMode', page: 'wizard.margin.rules', section: 'rules', order: 16 },

  // ...and the split inputs are on the fee step, under the fee they sum to.
  { topic: 'settings.hybridSplit.weeklyPerEntry', page: 'wizard.pickem.fee', section: 'fee', order: 10 },
  { topic: 'settings.hybridSplit.seasonPerEntry', page: 'wizard.pickem.fee', section: 'fee', order: 11 },
  { topic: 'settings.hybridSplit.weeklyPerEntry', page: 'wizard.margin.fee', section: 'fee', order: 10 },
  { topic: 'settings.hybridSplit.seasonPerEntry', page: 'wizard.margin.fee', section: 'fee', order: 11 },

  // What a member reads to find out what they joined.
  { topic: 'settings.payoutMode', page: 'pool.nfl.rules', section: 'money', order: 3 },
  { topic: 'settings.hybridSplit.weeklyPerEntry', page: 'pool.nfl.rules', section: 'money', order: 4 },
  { topic: 'settings.hybridSplit.seasonPerEntry', page: 'pool.nfl.rules', section: 'money', order: 5 },

  // The payments tab prices every prize row off this choice.
  { topic: 'settings.payoutMode', page: 'pool.nfl.payments', section: 'payments', order: 2 },

  // The commissioner's settings tab, where all three controls render.
  { topic: 'settings.payoutMode', page: 'pool.nfl.manager.settings', section: 'money', order: 20 },
  { topic: 'settings.hybridSplit.weeklyPerEntry', page: 'pool.nfl.manager.settings', section: 'money', order: 21 },
  { topic: 'settings.hybridSplit.seasonPerEntry', page: 'pool.nfl.manager.settings', section: 'money', order: 22 },
];
