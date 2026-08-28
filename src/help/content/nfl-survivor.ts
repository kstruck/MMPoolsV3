// Help copy for NFL Survivor — PLAN-HELP-SYSTEM.md T10.
//
// Every topic here is scoped to `NFL_SURVIVOR` alone. `pool.nfl.*` is ONE set
// of Help pages shared with Pick'em and Margin (`content/pool-pages.ts`), so a
// topic scoped any wider would show a Pick'em reader a strike rule their pool
// does not run — the same trap `nfl-pickem.ts` documents from the other side.
//
// ---------------------------------------------------------------------------
// THE ONE-DEFINITION RULE, AND HOW THIS FILE ANSWERS IT (voice rule 10)
// ---------------------------------------------------------------------------
//
// Three of these settings ALREADY have shipped member-facing copy:
// `survivorModeRulesCopy`, `tieOutcomeRuleCopy` and `teamReuseRuleCopy` in
// `src/utils/survivorRules.ts`, read today by `SurvivorPickEntry` (the pick
// sheet header) and `NFLPoolRules` (the rules page). Voice rule 10 says the
// sentence explaining a setting exists in exactly ONE place, and the comment
// above `HelpCopy` in `../types.ts` names the intended resolution: *"the helper
// stays where it is and BECOMES the topic's `template`"*.
//
// So this file does not restate a single one of those sentences. It CALLS
// them:
//
//   settings.pickLosersMode  → survivorRuleCopy(settings).mode
//   settings.tieCountsAs     → survivorRuleCopy(settings).tie
//   settings.maxTeamUses     → survivorRuleCopy(settings).reuse
//
// and it calls them for the STATIC FALLBACK too, at the wizard's own default
// values, so neither branch of any of the three carries a hand-written copy of
// a rule sentence. `tests/help-content-nfl-survivor.test.ts` asserts that
// byte-for-byte against the live helpers, in every branch — which is the
// one-definition guarantee made mechanical rather than promised.
//
// What the topics DO add around those sentences is the rest of voice rule 4:
// when you would change the setting, and what changes for your members. That is
// copy the helpers never had, and it is written once, here.
//
// ---------------------------------------------------------------------------
// WHERE THE DEFAULTS COME FROM (voice rule 5)
// ---------------------------------------------------------------------------
//
// `shared/schemas/nfl.ts` declares NO defaults for these eight fields —
// `maxStrikes` and `maxRebuys` are required, the other six are `.optional()`.
// So the default a reader meets is the create wizard's, and for the three
// settings that have a read-site fallback it is that constant. Both are named
// per topic below, with the file and line the reading came from. Nothing here
// is written from memory; voice rule 5 is the rule this effort keeps breaking.

import type { HelpCopyContext, HelpPlacement, HelpTopic } from '../types';
import { EVERYONE } from './nfl-shared';
import {
  survivorModeRulesCopy,
  survivorRuleCopy,
  teamReuseRuleCopy,
  tieOutcomeRuleCopy,
} from '../../utils/survivorRules';
import { DEFAULT_MAX_TEAM_USES, DEFAULT_TIE_COUNTS_AS } from '@shared/survivorReuse';

const SURVIVOR = ['NFL_SURVIVOR'] as const;

/**
 * The live helper, run against the pool in scope.
 *
 * `HelpCopyContext.settings` is `Record<string, unknown>` because a topic may
 * be handed any pool's settings blob; `survivorRuleCopy` already treats every
 * field as untrusted (`effectiveTieCountsAs` / `effectiveMaxTeamUses` fall back
 * to the default for anything unrecognised), so the assertion narrows the type
 * without weakening the read.
 */
type SurvivorSettings = Parameters<typeof survivorRuleCopy>[0];
const ruleCopy = (ctx: HelpCopyContext) => survivorRuleCopy(ctx.settings as unknown as SurvivorSettings);

/**
 * The same three sentences at the values the create wizard starts from
 * (`CreateNFLSurvivorPool.tsx:72-76`), for the surfaces that have no pool:
 * the wizard itself, and the search index off a pool page.
 *
 * Computed from the helpers rather than typed out, so a change to the shipped
 * wording moves the fallback with it and there is still exactly one definition.
 */
const DEFAULT_MODE_SENTENCE = survivorModeRulesCopy(false, DEFAULT_TIE_COUNTS_AS);
const DEFAULT_TIE_SENTENCE = tieOutcomeRuleCopy(false, DEFAULT_TIE_COUNTS_AS);
const DEFAULT_REUSE_SENTENCE = teamReuseRuleCopy(DEFAULT_MAX_TEAM_USES);

const para = (...parts: string[]) => parts.join('\n\n');

/**
 * The strikes default (`CreateNFLSurvivorPool.tsx:72`). `shared/schemas/nfl.ts`
 * makes the field required and declares no default, so the wizard's value is
 * the one a reader with no pool in scope meets.
 */
const DEFAULT_MAX_STRIKES = 1;

/**
 * The pool's strike limit, or the default for anything unrecognised.
 *
 * `HelpCopyContext.settings` is whatever a pool doc happens to hold, so this
 * treats the field as untrusted the way `effectiveTieCountsAs` and
 * `effectiveMaxTeamUses` do for theirs. A negative or fractional value is not a
 * limit the scorer could act on either.
 */
const effectiveMaxStrikes = (settings: Record<string, unknown> | undefined): number => {
  const raw = settings?.maxStrikes;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_MAX_STRIKES;
};

/**
 * WHICH WRONG PICK ENDS A SEASON, FOR THE POOL IN SCOPE (codex r4).
 *
 * This sentence used to be static and said "the second one ends their season"
 * — true at the default and FALSE on both of the other two limits the manager
 * select offers. The topic renders on the rules page and the manager settings
 * tab, and `PoolRoute` puts the pool's own settings in scope there, so the
 * panel can say what THIS pool does instead of a sentence widened to cover
 * every value. That is the same resolution the three helper-backed topics use.
 *
 * The arithmetic is `updateSurvivorStatus`'s: it eliminates at
 * `strikesUsed >= maxStrikes + 1`, so the limit is how many wrong picks a
 * player SURVIVES and the one after that is the end. The wizard's number field
 * has a floor of 0 and no ceiling, so a limit past the named ordinals falls
 * back to counting rather than inventing a word for it.
 */
const ORDINALS = ['second', 'third', 'fourth', 'fifth', 'sixth'] as const;

const strikeThresholdCopy = (maxStrikes: number): string => {
  if (maxStrikes === 0) {
    return 'This pool is sudden death: a player’s first wrong pick ends their season.';
  }
  const ordinal = ORDINALS[maxStrikes - 1];
  const ending = ordinal
    ? `the ${ordinal} one ends their season`
    : `wrong pick number ${maxStrikes + 1} ends their season`;
  return maxStrikes === 1
    ? `A player’s first wrong pick costs them a strike and they carry on; ${ending}.`
    : `A player carries on through ${maxStrikes} wrong picks, a strike each; ${ending}.`;
};

/**
 * The whole strikes explainer at one limit. ONE builder feeds both branches of
 * the topic's `HelpCopy`, so the sentence a pool reader gets and the sentence
 * the wizard falls back to cannot drift apart — only the number differs.
 */
const strikesLong = (maxStrikes: number): string =>
  para(
    `One is the default. ${strikeThresholdCopy(maxStrikes)}`,
    'Set it to none for sudden death, where the first wrong pick is the end. Raise it for a pool you want people to stay in — every extra strike is another week somebody who guessed wrong is still playing.',
    // `evaluateSurvivorWeek` (:264-267): no pick ⇒ `strikeLogged: true`,
    // unless `isVoidWeek(gamesInWeek)` — a slate where every game was
    // cancelled had no legal pick to make, so it strikes nobody.
    'Not picking counts as a wrong pick. If a player has submitted nothing by the deadline, a strike is recorded for them when the week is scored — unless every game that week was called off, which strikes nobody.',
    // TWO REVIVAL PATHS, NOT ONE (codex r1 on this ticket). The first draft
    // said buy-backs were the only way back and the engine disagrees:
    // `SURVIVOR_PARITY_SETTINGS_KEYS` (functions/src/lib/survivorSettingsGate.ts:24)
    // is `['tieCountsAs', 'maxTeamUses']` — `maxStrikes` is NOT gated once a
    // week has been scored, and the gate's own doc comment names a partial
    // `{maxStrikes: 2}` save on a scored pool as something it must NOT refuse.
    // `computeSurvivorWeekUpdate` (nflScoringEngine.ts:670) then recomputes
    // status from `pool.settings.maxStrikes` as it stands at scoring time
    // rather than from any stored verdict, and its ELIMINATED skip is
    // `eliminatedWeek < week` — so re-scoring the elimination week itself is
    // NOT skipped and `updateSurvivorStatus` can return ALIVE.
    //
    // Reachable by the commissioner, not only by an admin: `scoreNFLWeek`
    // (nflPools.ts:2115) gates on `assertPoolOwnerOrSuperAdmin`, the same
    // helper `updatePoolSettings` uses (poolOps.ts:505), and it carries no
    // already-scored refusal. The manager's Score Week button posts the
    // dashboard's `selectedWeek`, which is a URL parameter free to name any
    // week 1–18 (NFLPoolDashboard.tsx:190).
    'A player who runs out of strikes is marked out. Buy-backs are how that player gets themselves back in.',
    // "the commissioner's" rather than "yours": this topic is placed on
    // `pool.nfl.rules` as well as the manager tab, and a member reading "it is
    // yours" would take it for something they can do. The neighbouring
    // sentences are imperative configuration advice a member reads as
    // addressed past them; a possessive is not.
    'Raising this limit is the other way back, and that one is the commissioner’s. A week is graded against the limit the pool has at the time it is scored, so raising it and scoring that player’s elimination week again returns them to the pool with their strikes still on the record.',
  );

export const NFL_SURVIVOR_TOPICS: readonly HelpTopic[] = [
  // ---- Strikes ----------------------------------------------------------
  {
    // `updateSurvivorStatus` (functions/src/nflScoringEngine.ts:353-357)
    // eliminates at `strikesUsed >= maxStrikes + 1`, so the number is how many
    // strikes a player SURVIVES, not how many they are allowed in total before
    // anything happens. The manager select spells the same arithmetic out
    // ("1 — Double Elimination", NFLManagerView.tsx:1608).
    //
    // Default 1: `CreateNFLSurvivorPool.tsx:72`. There is no schema default —
    // `shared/schemas/nfl.ts:80` makes the field required — so the wizard's
    // value is the one a reader meets.
    id: 'settings.maxStrikes',
    title: 'Strikes allowed',
    short: 'How many wrong picks a player lives through before they are out. One is the default.',
    long: {
      template: (ctx) => strikesLong(effectiveMaxStrikes(ctx.settings)),
      fallback: strikesLong(DEFAULT_MAX_STRIKES),
    },
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.maxRebuys', 'settings.tieCountsAs', 'settings.autoSurviveExemptionEnabled'],
  },

  // ---- Buy-backs --------------------------------------------------------
  {
    // Default 0: `CreateNFLSurvivorPool.tsx:72`. Required in the create schema
    // (`shared/schemas/nfl.ts:81`), so again the wizard's value is the default
    // a reader meets.
    //
    // What a buy-back DOES, read off `executeSurvivorRebuyInternal`
    // (functions/src/nflPools.ts:1108-1122): status ALIVE, `strikesUsed` 0,
    // `strikeWeeks` emptied, `lastRebuyWeek` set to the week bought back in,
    // `rebuysUsed` + 1. `usedTeams` is deliberately NOT touched, and
    // `scoreNFLWeek` skips any week `<= lastRebuyWeek` for that entry.
    id: 'settings.maxRebuys',
    title: 'Buy-backs',
    short: 'How many times a player who is out can buy back in. None is the default.',
    long: para(
      // Scoped to what THIS setting does, for the same reason as the strikes
      // topic above: "being out is the end of a player's season" is an absolute
      // the engine does not hold to, because raising `maxStrikes` and
      // re-scoring the elimination week revives an eliminated player whatever
      // this number is.
      'None is the default, so no player can buy their way back in.',
      'Allow one or more and an eliminated player can buy themselves back in, up to that many times. Buying back in clears their strikes and takes the weeks up to and including that one out of their record, so nothing already behind them can put them out again.',
      'The teams they have already picked stay used. A buy-back returns a player to the pool, not to the start of the season.',
      'Two settings go with it: the last week a buy-back is allowed, and what one costs.',
    ),
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.rebuyDeadlineWeek', 'settings.rebuyCost', 'settings.maxStrikes'],
  },

  {
    // `executeSurvivorRebuyInternal` (functions/src/nflPools.ts:1074-1076)
    // refuses only `week > settings.rebuyDeadlineWeek`, so the deadline week
    // ITSELF still accepts a buy-back. The client agrees
    // (`SurvivorPickEntry.tsx:196` — `if (week > rebuyDeadlineWeek) return false`).
    //
    // The rules page USED to render this as "before <week label>", one week
    // narrower than the code. Fixed: both member surfaces now build the
    // sentence from `survivorRebuyRuleCopy` / `survivorRebuyJoinCopy`
    // (`src/utils/survivorRules.ts`), which say "through <week label>" and
    // agree with this copy's "during that week, and not after it".
    //
    // Default 4: `CreateNFLSurvivorPool.tsx:72`.
    id: 'settings.rebuyDeadlineWeek',
    title: 'Last week to buy back in',
    short: 'The last week an eliminated player can buy back in. Week 4 is the default.',
    long: para(
      'Week 4 is the default. A player can still buy back in during that week, and is refused from the week after it.',
      'Choose a week that leaves a returning player a season worth playing. Set it late and somebody can rejoin with little left to win; set it early and a player knocked out in week one has almost no window.',
      // ZERO IS ACCEPTED AND TURNS BUY-BACKS OFF (codex r5). The create wizard's
      // field is `min={0}` (`CreateNFLSurvivorPool.tsx:38`) and the schema is
      // `z.number().int().optional()` with no floor (`shared/schemas/nfl.ts:82`),
      // so a pool can be created with 0 — and `executeSurvivorRebuyInternal`
      // refuses `week > rebuyDeadlineWeek`, which every real week satisfies
      // against 0. A pool set that way allows a number of buy-backs nobody can
      // ever take. The manager form clamps to 1 (`min={1}` and a `Math.max(1,…)`
      // on change), so this is a create-time value, and it survives until
      // somebody edits that field.
      'Zero is not a week, and setting it there switches buy-backs off however many you allow — every request lands after the deadline. Use week 1 for the narrowest window that still works.',
      'It changes nothing in a pool that allows no buy-backs.',
    ),
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.maxRebuys', 'settings.rebuyCost'],
  },

  {
    // MONEY COPY — voice rule 8.
    //
    // Default 0: `CreateNFLSurvivorPool.tsx:72`. The READ site is
    // `settings.rebuyCost ?? settings.entryFee ?? 0`
    // (functions/src/nflPools.ts:1079, and again at :1148 for the ledger
    // event), which is why the last paragraph names the entry-fee fallback: it
    // is what an older pool with nothing stored charges.
    //
    // Where it lands: `rebuyOwed` on the member's roster record (:1130-1140)
    // and a `REBUY_DUE` ledger event (:1149-1156). Nothing moves money.
    id: 'settings.rebuyCost',
    title: 'What a buy-back costs',
    short: 'What a player pays you to buy back in. Nothing is the default, and the money goes to you directly.',
    long: para(
      'Nothing is the default, which makes a buy-back free.',
      'Set an amount and it is added to what that player owes you the moment they buy back in. It shows up on their Payments tab and on your ledger next to their entry fee, and you mark it paid the same way.',
      'The money moves between you and that player through whatever payment app you both use. No entry money and no buy-back money is ever held here or moved for you.',
      'An older pool with no amount stored at all charges the entry fee for a buy-back instead.',
    ),
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    terms: ['entry-fee', 'paid-status'],
    related: ['settings.maxRebuys', 'settings.entryFee'],
  },

  // ---- The three helper-backed rules ------------------------------------
  //
  // `short` and `long` are BOTH templates, and every rule sentence in either
  // branch comes out of `utils/survivorRules.ts`. See the file header.
  {
    // Default 'LOSS': `CreateNFLSurvivorPool.tsx:76`, and the read-site
    // `DEFAULT_TIE_COUNTS_AS` in `shared/survivorReuse.ts:40` — a pool with
    // nothing stored plays the same rule.
    //
    // The once-scored refusal is `survivorParitySettingsRefusal`
    // (functions/src/lib/survivorSettingsGate.ts:116-127), and the manager form
    // says the same thing under the control (NFLManagerView.tsx:1664).
    id: 'settings.tieCountsAs',
    title: 'Tie outcome',
    short: {
      template: (ctx) => ruleCopy(ctx).tie,
      fallback:
        'Whether a tied game counts as a win for the team a player picked, or as a strike. A strike is the default.',
    },
    long: {
      template: (ctx) =>
        para(
          ruleCopy(ctx).tie,
          'A strike is the default, and it is the rule this pool played before the choice existed.',
          'It cannot be changed once a week has been scored and the results are out. Changing it then would rewrite that week the next time the pool is scored, and a finished week is not rewritten under anybody.',
          'Ties are rare — a whole season can pass without one — so this is a choice to make at the start rather than in the week it finally matters.',
        ),
      fallback: para(
        `${DEFAULT_TIE_SENTENCE} That is the default. The other choice makes a tie count as a win for the team the player picked, which survives in an ordinary pool and is a strike in a reverse one.`,
        'It cannot be changed once a week has been scored and the results are out. Changing it then would rewrite that week the next time the pool is scored, and a finished week is not rewritten under anybody.',
        'Ties are rare — a whole season can pass without one — so this is a choice to make at the start rather than in the week it finally matters.',
      ),
    },
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.pickLosersMode', 'settings.maxStrikes'],
  },

  {
    // Default 1: `CreateNFLSurvivorPool.tsx:76`, and `DEFAULT_MAX_TEAM_USES` in
    // `shared/survivorReuse.ts:43`. `UNLIMITED_TEAM_USES` is 0 (:46) and
    // `MAX_TEAM_USES` is 23 (:57) — the highest the create form accepts
    // (`CreateNFLSurvivorPool.tsx:50`), above which a limit is
    // indistinguishable from none.
    //
    // The two refusals are both in `survivorParitySettingsRefusal`:
    // SETTINGS_LOCKED_AFTER_SCORING once a week has been published, and
    // TEAM_USE_LIMIT_TOO_LOW when an entry already sits above the new limit
    // (functions/src/lib/survivorSettingsGate.ts:129-149).
    //
    // The used marker on the pick sheet is `usedBadgeLabel`
    // (`SurvivorPickEntry.tsx:159-165`): "Used" at a limit of one, and a count
    // otherwise.
    id: 'settings.maxTeamUses',
    title: 'Team-use limit',
    short: {
      template: (ctx) => ruleCopy(ctx).reuse,
      fallback:
        'How many weeks a player may pick the same team. One is the default, and zero means no limit at all.',
    },
    long: {
      template: (ctx) =>
        para(
          ruleCopy(ctx).reuse,
          'One is the default and is the rule most survivor pools run on. Zero removes the limit; the highest you can set is 23.',
          'Raising it makes a long season easier to last. Lowering it is refused while any player is already over the new number, and neither direction is allowed once a week has been scored — the limit decides who was out of options in a week, so moving it would change weeks that are already finished.',
          'On the pick sheet a team a player has used is marked, with a count against the limit whenever the limit is more than one.',
        ),
      fallback: para(
        `${DEFAULT_REUSE_SENTENCE} That is the default, and it is the rule most survivor pools run on. Raise the limit to let a team come round again, or set zero for no limit at all; the highest you can set is 23.`,
        'Raising it makes a long season easier to last. Lowering it is refused while any player is already over the new number, and neither direction is allowed once a week has been scored — the limit decides who was out of options in a week, so moving it would change weeks that are already finished.',
        'On the pick sheet a team a player has used is marked, with a count against the limit whenever the limit is more than one.',
      ),
    },
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.autoSurviveExemptionEnabled', 'settings.maxStrikes'],
  },

  {
    // Default false: `CreateNFLSurvivorPool.tsx:73`.
    //
    // ⚠️ IT *IS* EDITABLE LATER, and an earlier draft of this topic said it was
    // not. `NFLManagerView.tsx:1679-1690` renders a "Pick-Loser Mode" toggle
    // and `:895` sends `pickLosersMode` with every survivor settings save. It
    // carries no once-scored gate either — `SURVIVOR_PARITY_SETTINGS_KEYS`
    // (functions/src/lib/survivorSettingsGate.ts:24) protects only
    // `tieCountsAs` and `maxTeamUses` — while `computeSurvivorWeekUpdate`
    // regrades with the pool's CURRENT settings, so a week scored again after
    // the change is graded the new way round. The copy says exactly that and
    // stops (voice rule 9: state a limit flatly, do not warn).
    //
    // The reason the draft got it wrong is worth recording: the toggle's label
    // is a `<p>`, not a `<FieldLabel>` and not a raw `<label>`, so neither
    // coverage guard can see it and it appears in no allowlist.
    //
    // The mode sentence is the pick sheet's own header — `SurvivorPickEntry.tsx:169`
    // renders exactly this string — which is why the copy can promise the
    // reader will see it there.
    id: 'settings.pickLosersMode',
    title: 'Pick to win or to lose',
    short: {
      template: (ctx) => ruleCopy(ctx).mode,
      fallback:
        'Whether players pick a team to win each week, or a team to lose. Picking to win is the default.',
    },
    long: {
      template: (ctx) =>
        para(
          ruleCopy(ctx).mode,
          'Picking to win is the default. Turning it round is what makes a reverse pool, and it changes nothing else: strikes, buy-backs and the team-use limit all work the same way either way.',
          'The line above is the first thing on every player’s pick sheet, so nobody has to remember which way round their pool runs.',
          'You can still turn it round from the settings tab later. A week that is scored again after you do is graded the new way round, so this is a choice to make at the start.',
        ),
      fallback: para(
        `${DEFAULT_MODE_SENTENCE} That is the default. A reverse pool asks the opposite of its players every week.`,
        'Turning it round changes nothing else: strikes, buy-backs and the team-use limit all work the same way either way.',
        'Whichever you choose, the rule is the first thing on every player’s pick sheet, so nobody has to remember which way round their pool runs.',
        'You can still turn it round from the settings tab later. A week that is scored again after you do is graded the new way round, so this is a choice to make at the start.',
      ),
    },
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.tieCountsAs', 'settings.maxTeamUses'],
  },

  // ---- The exemption ----------------------------------------------------
  {
    // Default true, in TWO places that agree: `CreateNFLSurvivorPool.tsx:73`
    // writes `true`, and the read site is `?? true`
    // (functions/src/nflScoringEngine.ts:704), so a pool with nothing stored
    // has the exemption ON.
    //
    // ⚠️ `NFLPoolRules.tsx:250` renders an ABSENT value as "Disabled", which
    // contradicts that `?? true`. The code wins (see the PR body); this copy
    // says on by default.
    //
    // `checkAutoSurviveExemption` (functions/src/nflScoringEngine.ts:376-407):
    //   - returns false immediately when the setting is off
    //   - eligibility is counted with `countTeamUsesBefore`, i.e. weeks
    //     STRICTLY BEFORE the one being scored, so a pick already submitted for
    //     a LATER week does not count against the player
    //   - at `maxTeamUses: 0` every playing team stays eligible, so an
    //     unlimited pool can never grant one
    //   - it is checked BEFORE the week is graded
    //     (`computeSurvivorWeekUpdate`, :705-721), so the week costs no strike
    //
    // NO CONTROL ON THE SETTINGS TAB, same as `pickLosersMode` above.
    id: 'settings.autoSurviveExemptionEnabled',
    title: 'Auto-survive with no teams left',
    short: 'Carries a player through a week in which every team playing is already used up. On by default.',
    long: para(
      'On by default. It only ever matters in a pool that limits how often a team may be picked: late in a season a player can reach a week where every team playing has already been used as many times as the limit allows, and there is no pick left for them to legally make.',
      'When that happens the week is passed over for that player — no pick needed, no strike given. A pool with no team-use limit never reaches that state, so the setting does nothing there.',
      'It is judged on the weeks before the one being scored, so a pick a player has already put in for a later week does not count against them.',
      'Turn it off if you would rather a player in that position took the strike. There is no control for it on the settings tab, so it is chosen when the pool is created.',
    ),
    poolTypes: SURVIVOR,
    audience: EVERYONE,
    related: ['settings.maxTeamUses', 'settings.maxStrikes'],
  },
];

/**
 * Where the Survivor copy sits.
 *
 * Four screens, one explanation each (voice rule 10): the create wizard's rules
 * step, the pool's rules page, the pick sheet, and the commissioner's settings
 * tab. The last three are `pool.nfl.*` pages shared with Pick'em and Margin —
 * `resolveTopic` filters on the reader's pool type, which is what keeps a
 * Pick'em reader from being shown any of this.
 *
 * The section is `survivor` on the pool surfaces because that is what the
 * reader is looking at: both the rules page and the manager form group these
 * under a "Survivor Rules" heading of their own.
 */
export const NFL_SURVIVOR_PLACEMENTS: readonly HelpPlacement[] = [
  // Create wizard — the rules step renders all eight controls
  // (`CreateNFLSurvivorPool.tsx:36-53`).
  { topic: 'settings.pickLosersMode', page: 'wizard.survivor.rules', section: 'rules', order: 0 },
  { topic: 'settings.maxStrikes', page: 'wizard.survivor.rules', section: 'rules', order: 1 },
  { topic: 'settings.tieCountsAs', page: 'wizard.survivor.rules', section: 'rules', order: 2 },
  { topic: 'settings.maxTeamUses', page: 'wizard.survivor.rules', section: 'rules', order: 3 },
  { topic: 'settings.autoSurviveExemptionEnabled', page: 'wizard.survivor.rules', section: 'rules', order: 4 },
  { topic: 'settings.maxRebuys', page: 'wizard.survivor.rules', section: 'rules', order: 5 },
  { topic: 'settings.rebuyDeadlineWeek', page: 'wizard.survivor.rules', section: 'rules', order: 6 },
  { topic: 'settings.rebuyCost', page: 'wizard.survivor.rules', section: 'rules', order: 7 },

  // The rules page — the one screen a member reads to find out what they
  // joined. `NFLPoolRules.tsx:225-280` shows every one of these.
  { topic: 'settings.pickLosersMode', page: 'pool.nfl.rules', section: 'survivor', order: 0 },
  { topic: 'settings.maxStrikes', page: 'pool.nfl.rules', section: 'survivor', order: 1 },
  { topic: 'settings.tieCountsAs', page: 'pool.nfl.rules', section: 'survivor', order: 2 },
  { topic: 'settings.maxTeamUses', page: 'pool.nfl.rules', section: 'survivor', order: 3 },
  { topic: 'settings.autoSurviveExemptionEnabled', page: 'pool.nfl.rules', section: 'survivor', order: 4 },
  { topic: 'settings.maxRebuys', page: 'pool.nfl.rules', section: 'survivor', order: 5 },
  { topic: 'settings.rebuyDeadlineWeek', page: 'pool.nfl.rules', section: 'survivor', order: 6 },
  { topic: 'settings.rebuyCost', page: 'pool.nfl.rules', section: 'survivor', order: 7 },

  // The pick sheet. Only the three rules the sheet itself acts on: the mode
  // line at the top, the tie rule that decides the same pick, and the used
  // markers on the team buttons.
  { topic: 'settings.pickLosersMode', page: 'pool.nfl.picks', section: 'survivor', order: 0 },
  { topic: 'settings.tieCountsAs', page: 'pool.nfl.picks', section: 'survivor', order: 1 },
  { topic: 'settings.maxTeamUses', page: 'pool.nfl.picks', section: 'survivor', order: 2 },

  // Commissioner settings tab — the SEVEN survivor settings the manager form can
  // change, in the order they render (`NFLManagerView.tsx:1601-1691`).
  //
  // Six are `FieldLabel`s wired to their topic by `helpId`, so they carry an
  // inline tip as well as a panel row. The seventh, `pickLosersMode`, is the
  // Pick-Loser Mode checkbox at :1680 — its label is a `<p>` and it has no
  // `helpId`, which is why it was missing from this list entirely (codex r2).
  // The placement is what puts it in the page's Help panel; the inline tip
  // beside the toggle needs the label itself changed and is T4's, not T10's.
  //
  // The set is not hand-kept: `tests/help-content-nfl-survivor.test.ts` reads
  // the survivor branch of the manager save and requires a placement here for
  // every key in it that T10 explains.
  { topic: 'settings.maxStrikes', page: 'pool.nfl.manager.settings', section: 'survivor', order: 0 },
  { topic: 'settings.maxRebuys', page: 'pool.nfl.manager.settings', section: 'survivor', order: 1 },
  { topic: 'settings.rebuyDeadlineWeek', page: 'pool.nfl.manager.settings', section: 'survivor', order: 2 },
  { topic: 'settings.rebuyCost', page: 'pool.nfl.manager.settings', section: 'survivor', order: 3 },
  { topic: 'settings.tieCountsAs', page: 'pool.nfl.manager.settings', section: 'survivor', order: 4 },
  { topic: 'settings.maxTeamUses', page: 'pool.nfl.manager.settings', section: 'survivor', order: 5 },
  { topic: 'settings.pickLosersMode', page: 'pool.nfl.manager.settings', section: 'survivor', order: 6 },
];
