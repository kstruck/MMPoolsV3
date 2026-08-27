// Help copy for BRACKET and NFL_PLAYOFFS — PLAN-HELP-SYSTEM.md T12.
//
// Two pool types share this file because they share nothing but a shape: both
// are ONE set of picks made before a tournament and scored round by round.
// Every topic below is scoped to exactly one of them, because none of the
// settings is carried by both.
//
// Written against `docs/help-voice.md` (K8). Every default named here was read
// out of the code that applies it, and the source is in a comment beside the
// claim. Voice rule 5 is the rule this effort keeps breaking, and every break
// so far was a sentence written from memory.
//
// THREE DRIFTS WERE FOUND WHILE READING, AND THE COPY IS WRITTEN AROUND THEM
// RATHER THAN OVER THEM. They are reported on the PR; each is noted at the
// topic it touches:
//   1. `UPSET` is offered by the create wizard and implemented by nothing.
//   2. `settings.tieBreakers.closestAbsolute` is written and never read.
//   3. The playoff round multipliers have three different absent-value
//      fallbacks in three files.

import type { HelpPlacement, HelpTopic, Audience } from '../types';
// ONE DEFINITION (voice rule 10). The label for a scoring system is written in
// `bracketScoring.ts` — beside `getPointsForRound`, which is what turns the
// same setting into numbers — and BOTH the member-facing rules panel and this
// topic read it from there. It was moved out of `BracketRulesPanel.tsx` for
// exactly that reason: a second copy of "Classic (points double each round)"
// living in help content is the drift this registry exists to prevent.
import { SCORING_SYSTEM_LABELS } from '../../components/BracketPoolDashboard/bracketScoring';

const BRACKET = ['BRACKET'] as const;
const PLAYOFF = ['NFL_PLAYOFFS'] as const;

/** A setting members meet too — on the rules page. */
const EVERYONE: readonly Audience[] = ['member', 'commissioner'];
/** Commissioner-only: the create wizard and the manager tab. */
const HOST_ONLY: readonly Audience[] = ['commissioner'];

/**
 * The label this pool's scoring system is shown under, or `undefined` when the
 * stored value has none.
 *
 * `UPSET` is the value with none. `bracketScoringSystemSchema` accepts it and
 * `CreateBracketPool.tsx:45` offers it as "Upset bonus", but neither scoring
 * engine implements it: the server falls through to the CLASSIC multipliers
 * (`functions/src/bracketScoring.ts:70-77`) and the client scores every round
 * at zero (`bracketScoring.ts` `getPointsForRound`). So there is no honest
 * sentence to write about what it does, and the copy below says nothing about
 * it rather than inventing one — it renders the same words a reader outside a
 * pool gets.
 */
function systemLabel(settings: Record<string, unknown> | undefined): string | undefined {
  const system = settings?.scoringSystem;
  if (typeof system !== 'string') return undefined;
  const label: string | undefined = SCORING_SYSTEM_LABELS[system];
  return label;
}

// The mechanic, stated once and used by both branches of the scoring topic.
const SCORING_MECHANIC =
  'A correct pick earns that round’s points. A wrong one earns nothing, and once a team you picked has lost, your later picks of that team can no longer score.';
const SCORING_WHERE =
  'The rules page lists what a correct pick is worth in every round of this pool, so nobody has to work it out.';

export const BRACKET_TOPICS: readonly HelpTopic[] = [
  // ---- Bracket: the tournament step -------------------------------------
  {
    // `CreateBracketPool.tsx:31` (the control) and `:57` (the pre-filled
    // year). There is NO manager control for it: the bracket manager's Rules
    // section edits the scoring system, the two entry limits, the fee, the
    // tie-break and the upset bonus, and nothing else
    // (`BracketPoolDashboard.tsx:1483-1560`). So "no way to change it later"
    // is a statement about the shipped screens, not a guess.
    id: 'seasonYear',
    title: 'Tournament year',
    short: 'Which year’s tournament the pool follows. It is set here and there is no control to change it afterwards.',
    long: [
      'This and the tournament you choose next decide which bracket everyone fills in and which results the pool is scored against.',
      'The box starts on 2026.',
      'There is no control anywhere to change it once the pool exists, so check it before you create the pool.',
    ].join('\n\n'),
    poolTypes: BRACKET,
    audience: HOST_ONLY,
    related: ['tournamentType'],
  },
  {
    // `CreateBracketPool.tsx:33-36` (the control, "Men's" / "Women's") and
    // `:57` (the default). The server applies the same default for a payload
    // that omits it — `gender || 'mens'` at `functions/src/bracketPools.ts:100`.
    //
    // THE CONFERENCE CAVEAT IS NOT DECORATION. `bracketPools.ts:73-80` builds
    // the tournament id as `bigeast-<year>` or `big12-<year>` when a conference
    // is chosen and only reaches `${gender}-${year}` on the NCAA branch. A
    // commissioner who picks Big 12 and Women's gets the same bracket as one
    // who picks Big 12 and Men's, and the screen does not say so.
    id: 'gender',
    title: 'Men’s or women’s bracket',
    short: 'Which of the two NCAA tournaments the pool plays. Men’s is what a new pool starts on.',
    long: [
      'The NCAA runs a men’s and a women’s tournament, and this is the one your pool fills in. Men’s is what the box starts on.',
      'It only has an effect on an NCAA pool. A Big East or Big 12 pool has one bracket for the conference, and this choice changes nothing for it.',
      'There is no control to change it once the pool exists.',
    ].join('\n\n'),
    poolTypes: BRACKET,
    audience: HOST_ONLY,
    related: ['tournamentType'],
  },
  {
    // `CreateBracketPool.tsx:37-41` (the three options) and `:57` (the
    // default). Mirrored server-side at `functions/src/bracketPools.ts:73-80`,
    // where anything other than `bigeast` or `big12` resolves to the NCAA
    // bracket for the chosen year.
    id: 'tournamentType',
    title: 'Which tournament',
    short: 'The NCAA tournament, the Big East, or the Big 12. NCAA is what a new pool starts on.',
    long: [
      'This is the bracket everyone in the pool fills in. NCAA is what the box starts on.',
      'NCAA is also the only one that uses your men’s-or-women’s choice. Each conference tournament has a single bracket.',
      'There is no control to change it once the pool exists.',
    ].join('\n\n'),
    poolTypes: BRACKET,
    audience: HOST_ONLY,
    related: ['seasonYear', 'gender'],
  },
  {
    // TEMPLATED, and the template is the point. `SCORING_SYSTEM_LABELS` is the
    // one place a scoring system's name is written; naming the systems again
    // here would be a second copy of it (voice rule 10), and the labels and the
    // help would then drift the first time either was edited.
    //
    // THE FALLBACK DELIBERATELY ENUMERATES NOTHING. The two screens that offer
    // this setting do not offer the same list: the create wizard has Classic,
    // Upset bonus and Custom (`CreateBracketPool.tsx:43-47`) while the manager
    // has Classic, ESPN, Fibonacci and Custom
    // (`BracketPoolDashboard.tsx:1497-1502`). A list written here would be
    // wrong beside one of them whatever it said. So the fallback names the
    // default exactly (voice rule 5) and describes the mechanic, and the
    // in-pool branch names the pool's own system from the shared labels.
    //
    // CLASSIC IS THE DEFAULT: `functions/src/bracketPools.ts:112` applies
    // `settings?.scoringSystem ?? "CLASSIC"`, and `CreateBracketPool.tsx:67`
    // pre-fills the same value. It doubles: `[10, 20, 40, 80, 160, 320]`.
    id: 'settings.scoringSystem',
    title: 'Scoring system',
    short: {
      template: (ctx) => {
        const label = systemLabel(ctx.settings);
        if (!label) {
          return 'How much a correct pick is worth in each round. Classic is what a new pool starts on, and it doubles every round.';
        }
        return `Your pool scores on ${label}. The rules page lists what a correct pick is worth in each round.`;
      },
      fallback:
        'How much a correct pick is worth in each round. Classic is what a new pool starts on, and it doubles every round.',
    },
    long: {
      template: (ctx) => {
        const label = systemLabel(ctx.settings);
        if (!label) {
          return [
            'Classic is what a new pool starts on. It doubles the points every round, so a correct pick in the final is worth many times one in the first round.',
            'Custom lets you set your own number for each round instead.',
            SCORING_MECHANIC,
            SCORING_WHERE,
          ].join('\n\n');
        }
        return [
          `Your pool scores on ${label}.`,
          SCORING_MECHANIC,
          SCORING_WHERE,
        ].join('\n\n');
      },
      fallback: [
        'Classic is what a new pool starts on. It doubles the points every round, so a correct pick in the final is worth many times one in the first round.',
        'Custom lets you set your own number for each round instead.',
        SCORING_MECHANIC,
        SCORING_WHERE,
      ].join('\n\n'),
    },
    poolTypes: BRACKET,
    audience: EVERYONE,
    related: ['settings.customScoring', 'bracket.tieBreak'],
  },
  {
    // ONE topic for TWO paths, and the reason is the code rather than tidiness.
    //
    // `settings.tieBreakers.closestUnder` is the whole rule.
    // `settings.tieBreakers.closestAbsolute` is WRITTEN by both surfaces
    // (`CreateBracketPool.tsx:48`, `BracketPoolDashboard.tsx:379`) and READ by
    // nothing — every reader in the repo branches on `closestUnder` alone:
    // `functions/src/bracketScoring.ts:255` and `:279` (the scored ranking),
    // `StandingsTable.tsx:63`, `ExportControls.tsx:36` and
    // `BracketRulesPanel.tsx:46` (the displayed ones). The wizard presents them
    // as two independent tick boxes; the manager presents the same pair as one
    // either/or dropdown, which is what the code actually implements.
    //
    // So the copy states the one rule and says plainly that closest-either-way
    // is not a switch of its own. Copy describing two independent options would
    // have been a sentence about a control that does nothing.
    //
    // BOTH create-wizard checkboxes carry `helpId="bracket.tieBreak"`, because
    // neither path is this topic's id and `HelpTip` resolves by field name.
    id: 'bracket.tieBreak',
    title: 'Breaking a tie',
    short: 'Level entries are settled on the championship-score prediction. Closest without going over is off unless you turn it on.',
    long: [
      'Every entry predicts the combined final score of the championship game when it is submitted. That prediction is what settles a tie.',
      'It is the third question asked, not the first. Entries are separated by points, then by the most either could still finish on, and only then by the prediction.',
      'Closest without going over is off unless you turn it on. While it is off, the prediction nearest the real total wins, over or under.',
      'Turn it on and a prediction above the real total loses to any prediction at or below it. Between two that are both at or below, the nearer one wins — and if every entry went over, the nearest overall wins after all.',
      'Closest either way is not a second switch to turn on. It is what applies whenever closest without going over is off.',
    ].join('\n\n'),
    fields: ['settings.tieBreakers.closestAbsolute', 'settings.tieBreakers.closestUnder'],
    poolTypes: BRACKET,
    audience: EVERYONE,
    related: ['settings.scoringSystem'],
  },

  // ---- Bracket: the manager tab -----------------------------------------
  {
    // `BracketPoolDashboard.tsx:112` (`editMaxTotal`), `:1527` (the control,
    // `min={-1}` and the note "-1 = unlimited"), `:374` (the write).
    //
    // -1 IS NOT A CONVENTION SOMEBODY WROTE DOWN, IT IS THE ENFORCEMENT.
    // `functions/src/bracketEntries.ts:75-83` gates on `maxTotal > 0`, so a
    // negative value is no cap at all, and `functions/src/bracketPools.ts:108`
    // applies `-1` to a pool that does not name one.
    //
    // COUNTED IN ENTRIES, NOT PEOPLE: the same block compares
    // `poolData.entryCount` against it, and the per-user limit above it is a
    // separate count.
    id: 'settings.maxEntriesTotal',
    title: 'Entry limit for the pool',
    short: 'How many entries the pool will take in all. -1 means no limit, and that is what a new pool starts on.',
    long: [
      'Leave it at -1 and the pool takes as many entries as it is given. Set any number above zero and that is a hard stop: once the pool holds that many, the next person to try is told the pool is full.',
      'It counts entries, not people. One player holding three entries has used three of them, which is why the per-player limit beside it is a separate number.',
      'You can change it while the pool is open. Lowering it below the entries already made takes none of them away — it stops new ones.',
    ].join('\n\n'),
    poolTypes: BRACKET,
    audience: HOST_ONLY,
    terms: ['entry'],
    related: ['settings.maxEntriesPerUser'],
  },
  {
    // `BracketPoolDashboard.tsx:115` (the six boxes are seeded from
    // `pool.settings.customScoring || [1, 2, 4, 8, 16, 32]`), `:1509-1521` (the
    // six inputs, labelled R64 R32 S16 E8 F4 CH), `:1505` (shown only while the
    // system is CUSTOM), `:377` (saved as null under any other system — the
    // same rule the server applies at `functions/src/bracketPools.ts:114`).
    //
    // "APPLIES ONLY WHILE THE SYSTEM IS CUSTOM" is both engines:
    // `functions/src/bracketScoring.ts:75` and `:150` read `customScoring` only
    // when the system is CUSTOM and the list is non-empty, and fall back to the
    // CLASSIC values otherwise.
    id: 'settings.customScoring',
    title: 'Custom round points',
    short: 'Your own points for each round. They apply only while the scoring system is Custom.',
    long: [
      // SIX BOXES, NOT SIX ROUNDS. The editor always renders six and always
      // labels them for a 64-team bracket (`BracketPoolDashboard.tsx:1512`),
      // while a conference tournament has fewer rounds and uses only the first
      // few (`getPointsForRound` indexes by round). So the copy says "in round
      // order" and does not promise the last box is the final.
      'Six boxes, in round order. A correct pick in a round is worth the number you put in that round’s box.',
      'They apply only while the scoring system is set to Custom. Change the system to anything else and the numbers are dropped — the pool scores on that system instead, and the boxes go away.',
      'The boxes start on 1, 2, 4, 8, 16 and 32 until you set your own.',
      'Members read the result rather than the setting: the rules page shows the points for each round of this pool.',
    ].join('\n\n'),
    poolTypes: BRACKET,
    audience: HOST_ONLY,
    related: ['settings.scoringSystem'],
  },

  // ---- Playoff: the details step ----------------------------------------
  {
    // ONE topic, FOUR paths. Four near-identical sentences would be four copies
    // of one explanation (voice rule 10), and the thing a reader needs is the
    // relationship between the four numbers rather than four definitions of
    // "multiplier". All four `NumberField`s carry
    // `helpId="playoff.roundMultipliers"`.
    //
    // THE RULE: `functions/src/playoffPools.ts:115-121` adds
    // `entry.rankings[teamId] * MULTIPLIERS[round]` for every winning team in
    // each round. The ranking is the number a player gave that team — the pick
    // screen ranks all the playoff teams (`PlayoffDashboard.tsx:453`).
    //
    // THE DEFAULTS: `CreatePlayoffPool.tsx:59` —
    // `{ WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 }`. The
    // create input REQUIRES the object (`shared/schemas/playoff.ts:25` is not
    // optional), so a pool made through the wizard always carries four real
    // numbers and no absent-value fallback is ever reached.
    //
    // NOTHING IS CLAIMED ABOUT SETTING A ROUND TO ZERO, though the control
    // allows it (`min={0}`). The server would score it as zero and the pool
    // screen's own per-round total would not: `PlayoffDashboard.tsx:72` reads
    // the multiplier as `... || 1`, so a stored 0 becomes 1 there. Reported as
    // drift rather than described as behaviour.
    id: 'playoff.roundMultipliers',
    title: 'What each round is worth',
    short: 'Multiplies the rank a player gave a team when that team wins in that round. New pools start on 1, 2, 3 and 4.',
    long: [
      'Every player ranks the playoff teams before the pool locks. When a team wins a game, the player who ranked it earns that rank, multiplied by the number set for the round the game was in.',
      'A new pool starts on 1 for the Wild Card round, 2 for the Divisional round, 3 for the Conference Championships and 4 for the Super Bowl. A team that keeps winning is therefore worth more each time it does.',
      'Raising the later rounds rewards picking the eventual winner. Levelling them out rewards getting the early rounds right.',
      'Members read the four numbers on the rules tab, so a pool that changes them is not changing them quietly.',
    ].join('\n\n'),
    fields: [
      'settings.scoring.roundMultipliers.WILD_CARD',
      'settings.scoring.roundMultipliers.DIVISIONAL',
      'settings.scoring.roundMultipliers.CONF_CHAMP',
      'settings.scoring.roundMultipliers.SUPER_BOWL',
    ],
    poolTypes: PLAYOFF,
    audience: EVERYONE,
    related: ['lockDate'],
  },
];

/**
 * Where the bracket and playoff copy sits.
 *
 * The create-wizard step pages are named by `RULES_STEP` in
 * `content/wizard-pages.ts` — `tournament` for bracket, `details` for playoff —
 * and the pool pages come from `content/pool-pages.ts`. Nothing here adds a
 * page: every id below already exists.
 *
 * A setting explained on the wizard is the SAME topic on the pool's rules page,
 * never a second copy written for members (voice rule 10).
 */
export const BRACKET_PLACEMENTS: readonly HelpPlacement[] = [
  // The bracket create wizard's Tournament step.
  { topic: 'seasonYear', page: 'wizard.bracket.tournament', section: 'rules', order: 0 },
  { topic: 'tournamentType', page: 'wizard.bracket.tournament', section: 'rules', order: 1 },
  { topic: 'gender', page: 'wizard.bracket.tournament', section: 'rules', order: 2 },
  { topic: 'settings.scoringSystem', page: 'wizard.bracket.tournament', section: 'rules', order: 3 },
  { topic: 'bracket.tieBreak', page: 'wizard.bracket.tournament', section: 'rules', order: 4 },

  // What a member reads to find out what they joined.
  { topic: 'settings.scoringSystem', page: 'pool.bracket.rules', section: 'scoring', order: 0 },
  { topic: 'bracket.tieBreak', page: 'pool.bracket.rules', section: 'scoring', order: 1 },

  // The bracket manager tab's Rules section, in the order the controls appear.
  { topic: 'settings.scoringSystem', page: 'pool.bracket.manager', section: 'rules', order: 0 },
  { topic: 'settings.customScoring', page: 'pool.bracket.manager', section: 'rules', order: 1 },
  { topic: 'settings.maxEntriesTotal', page: 'pool.bracket.manager', section: 'rules', order: 2 },
  { topic: 'bracket.tieBreak', page: 'pool.bracket.manager', section: 'rules', order: 3 },

  // The playoff create wizard's Playoff details step, and the rules tab that
  // shows the same four numbers to members.
  // Order 2: `wizard-shared.ts` already places `wizard.season` at 0 and
  // `lockDate` at 1 in this same section, in the order the step renders them.
  { topic: 'playoff.roundMultipliers', page: 'wizard.playoff.details', section: 'rules', order: 2 },
  { topic: 'playoff.roundMultipliers', page: 'pool.playoff.rules', section: 'scoring', order: 0 },
];
