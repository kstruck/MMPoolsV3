// Help copy for NFL Pick'em — PLAN-HELP-SYSTEM.md T9.
//
// Every topic here is scoped to `NFL_PICKEM` alone, because the `pool.nfl.*`
// Help pages are shared with Survivor and Margin and `resolveTopic` filters on
// the reader's pool type. A topic scoped wider would show a Survivor reader a
// rule their pool does not run.
//
// Written against `docs/help-voice.md` (K8). The behaviour claims are read out
// of the code that implements them, and the source is named in a comment
// wherever the reading was not obvious — voice rule 5 is the rule this effort
// keeps breaking, and every break so far was a sentence written from memory.

import type { HelpPlacement, HelpTopic } from '../types';
import { EVERYONE } from './nfl-shared';

const PICKEM = ['NFL_PICKEM'] as const;

export const NFL_PICKEM_TOPICS: readonly HelpTopic[] = [
  // ---- Rules the wizard and the manager settings form both set ------------
  {
    id: 'settings.lockMode',
    title: 'Lock mode',
    short: 'Choose whether each pick locks at its own kickoff or the whole week locks at the first kickoff. Per game is the default.',
    long: [
      'Per game is the default. Each pick stays editable until that game kicks off, so a Sunday-night pick can be changed all Sunday afternoon.',
      'Weekly locks every pick in the week at the first kickoff. Choose it when you want everyone playing the same slate on the same information.',
      // NOT unconditional (codex R1-2). `effectiveGameLockAt` takes
      // `max(base, override)`, so a week extension moves EVERY game in that
      // week later — including games that had already locked. The first draft
      // said a locked pick can never change, which is false for the supported
      // extension flow this file's lock-buffer topic describes.
      'Members see the deadline on their pick sheet either way. Once a pick locks nobody can change it, including you — unless you extend that whole week’s deadline, which reopens every game in it.',
      // `functions/src/nflPools.ts:568` — the submission path derives weekly
      // locking as `settings.confidenceMode || settings.lockMode === 'WEEKLY'`,
      // and the manager form disables the control while confidence is on
      // (`NFLManagerView.tsx:1190-1197`).
      'Confidence points lock the whole week whatever you choose here, so turning them on overrides this.',
    ].join('\n\n'),
    poolTypes: PICKEM,
    audience: EVERYONE,
    terms: ['pick-reveal'],
    related: ['settings.confidenceMode', 'settings.lockBufferMinutes'],
  },
  {
    id: 'settings.confidenceMode',
    title: 'Confidence points',
    short: 'Players rank the week’s games instead of picking flat, and a correct pick earns the rank they gave it. Off by default.',
    long: [
      'Off is the default. Every correct pick is worth the same, and a player only says who wins.',
      // `validateConfidenceValues` (functions/src/nflScoringEngine.ts:187-224):
      // N games, weights uniquely in [17-N .. 16], every game assigned. So the
      // TOP weight is always 16 and the bottom moves with the week's size —
      // "1 to 16" would be wrong on any week shorter than sixteen games.
      'On, a player gives every game in the week a different rank, the highest being 16 for the game they are surest of. A correct pick earns its rank; a wrong one earns nothing. On a short week the ranks start higher, and the sheet shows the range.',
      'Every game has to be ranked before a sheet can be submitted, and no rank can be used twice.',
      'Turning it on also locks the whole week at the first kickoff, whatever lock mode says.',
    ].join('\n\n'),
    poolTypes: PICKEM,
    audience: EVERYONE,
    related: ['settings.lockMode', 'pickem.picksheet'],
  },
  {
    id: 'settings.lockBufferMinutes',
    title: 'Lock buffer',
    short: 'How many minutes before kickoff a pick stops being editable. Five minutes is the default.',
    long: [
      // `functions/src/lib/effectiveLock.ts:13` — `(lockBufferMinutes ?? 5)`,
      // and `effectiveGameLockAt` computes `kickoff - buffer`. The manager form
      // offers 0, 5 and 10 (`NFLManagerView.tsx:1199-1206`); the server accepts
      // 0 to 1440 for Pick'em and refuses a negative value outright
      // (`functions/src/lib/poolUpdate.ts:180-192`).
      'A pick locks this many minutes before its game starts, so nobody is still editing while the ball is in the air.',
      'Five minutes is the default. Zero locks exactly at kickoff. Widening it brings the deadline forward for everyone.',
      'On a weekly-lock pool the same number applies once, to the first kickoff of the week.',
      // `extendWeekDeadline` (functions/src/poolExceptions.ts:122-190) writes a
      // per-week override, and `effectiveGameLockAt` takes `max(base, override)`
      // — later only. It is refused once that week's results have been shown
      // (WEEK_ALREADY_PUBLISHED). Pick'em keeps extensions; Survivor and Margin
      // are refused outright (HARD_WEEKLY_LOCK), which is why this topic is
      // Pick'em-scoped.
      'Your commissioner can extend one week’s deadline on its own. An extension only ever moves a deadline later, and it is refused once that week’s results have been shown.',
    ].join('\n\n'),
    poolTypes: PICKEM,
    audience: EVERYONE,
    related: ['settings.lockMode'],
  },

  // ---- The pick sheet ----------------------------------------------------
  {
    id: 'pickem.picksheet',
    title: 'Making your picks',
    short: 'Tap a team in every game, then submit. Nothing counts until you submit, and you can submit again until a pick locks.',
    long: [
      // `PickemPickEntry.tsx:105-120` — an unsubmitted sheet is kept in the
      // browser via `draftStore` and restored with a toast on the next visit.
      'What you tap is kept on this device as you go, so leaving the page does not lose it. It is not in the pool until you submit.',
      // `functions/src/nflPools.ts:618-624` — a resubmission is refused only for
      // a game that is locked AND whose pick changed.
      'You can submit as many times as you like. The last submission before a game locks is the one that counts.',
      'A game whose deadline has passed is shown read-only, and there is no way to reopen it for one player.',
    ].join('\n\n'),
    fields: [],
    poolTypes: PICKEM,
    audience: EVERYONE,
    terms: ['entry'],
    related: ['settings.lockMode', 'pickem.quickPicks', 'pickem.tiebreakerPrediction'],
  },
  {
    id: 'pickem.quickPicks',
    title: 'Quick picks',
    short: 'Fills games you have not picked yet, by one rule: favourites, underdogs, all home teams, or all away teams.',
    long: [
      // `PickemPickEntry.tsx:287-298` — `planQuickPicks` is passed
      // `g => !isGameLocked(g)` and skips games already picked.
      'It leaves alone anything you have already picked and anything already locked, so it cannot undo a choice you made.',
      // `planQuickPicks` (quickPicks.ts:85-96) skips a game whose
      // `favouredSide` is null — no spread, or an even line — and counts it in
      // `skipCount`, which the dialog surfaces. Preseason slates carry a line
      // on almost nothing, so this is the common case, not the edge (codex R1-3).
      'Favourites and underdogs need a betting line. A game with no line, or an even one, is left blank for you to fill in by hand, and the dialog says how many that is. All home and all away fill every game they can.',
      'Nothing is sent when it fills the sheet. Read it over, change what you want, and submit as usual.',
    ].join('\n\n'),
    fields: [],
    poolTypes: PICKEM,
    audience: EVERYONE,
    related: ['pickem.picksheet'],
  },
  {
    id: 'pickem.tiebreakerPrediction',
    title: 'Tie-breaker prediction',
    short: 'Your guess at the combined score of the tie-break game, when your pool asks for one. It decides a week two players finish level.',
    long: [
      // `shared/nflTiebreaker.ts:184-198` — the target is the Monday game(s),
      // and the sheet says so; with no Monday game it is the final game of the
      // week. `functions/src/nflPools.ts:585-601` freezes the week's target on
      // the first submission, so it cannot move under people who already played.
      // `tiebreakerAsksForPrediction` (shared/nflTiebreaker.ts:63) is false for
      // NONE, and the sheet renders no field at all then. `tiebreakTargetSentence`
      // (:184-198) also handles MULTIPLE target games, which legacy
      // MNF_COMBINED pools have. The first draft assumed one game, always
      // asked for (codex R1-1).
      'Your commissioner chooses the tie-break rule, and one of the choices is none at all. When it is none, the sheet asks for no prediction and a level week stays level.',
      'When it does ask, the sheet names what it is asking about — the Monday game, or the last game of the week when there is no Monday game. Some older pools ask about every Monday game together.',
      'Add the final scores together and enter that one number. Closest takes the week; your commissioner chose what happens when two players are equally close.',
      'The game being asked about is fixed for everyone as soon as the first player submits, so a schedule change later in the week cannot move it.',
    ].join('\n\n'),
    fields: [],
    poolTypes: PICKEM,
    audience: EVERYONE,
    terms: ['weekly-prize'],
    related: ['settings.weeklyTiebreaker'],
  },
];

/**
 * Where the Pick'em copy sits.
 *
 * The three settings are placed THREE times — the create wizard's rules step,
 * the pool's rules page, and the commissioner's settings tab — because they are
 * one explanation read by two audiences on three screens (voice rule 10). The
 * placements name the base id; `resolveTopic` does the pool-type filtering, so
 * a Survivor reader on `pool.nfl.rules` sees none of them.
 */
export const NFL_PICKEM_PLACEMENTS: readonly HelpPlacement[] = [
  // Create wizard — the rules step.
  { topic: 'settings.lockMode', page: 'wizard.pickem.rules', section: 'rules', order: 10 },
  // NOT settings.lockBufferMinutes (codex R3). The wizard's rules step has no
  // control for it — `CreateNFLPickemPool.tsx` only seeds the default of 5 —
  // and a wizard STEP page lists the options on that step. Its help lives on
  // the read-only surfaces where the deadline matters and on the manager
  // settings tab, which is the one screen that can change it.
  { topic: 'settings.confidenceMode', page: 'wizard.pickem.rules', section: 'rules', order: 12 },

  // What a member reads to find out what they joined.
  { topic: 'settings.lockMode', page: 'pool.nfl.rules', section: 'picks', order: 10 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.rules', section: 'picks', order: 11 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.rules', section: 'picks', order: 12 },
  { topic: 'settings.pickMode', page: 'pool.nfl.rules', section: 'picks', order: 13 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.rules', section: 'picks', order: 14 },

  // The pick sheet itself.
  { topic: 'pickem.picksheet', page: 'pool.nfl.picks', section: 'picks', order: 0 },
  { topic: 'pickem.quickPicks', page: 'pool.nfl.picks', section: 'picks', order: 1 },
  { topic: 'pickem.tiebreakerPrediction', page: 'pool.nfl.picks', section: 'picks', order: 2 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.picks', section: 'picks', order: 3 },
  { topic: 'settings.lockMode', page: 'pool.nfl.picks', section: 'deadlines', order: 0 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.picks', section: 'deadlines', order: 1 },

  // The all-picks grid: the question it raises is when a pick appears.
  { topic: 'settings.lockMode', page: 'pool.nfl.grid', section: 'deadlines', order: 0 },

  // Standings and results: what a number on the row is worth.
  { topic: 'settings.confidenceMode', page: 'pool.nfl.standings', section: 'scoring', order: 0 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.standings', section: 'scoring', order: 1 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.results', section: 'scoring', order: 0 },
  { topic: 'pickem.tiebreakerPrediction', page: 'pool.nfl.results', section: 'scoring', order: 1 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.recaps', section: 'scoring', order: 0 },

  // The dashboard's own question is "when do I have to pick by".
  { topic: 'settings.lockMode', page: 'pool.nfl.dashboard', section: 'deadlines', order: 0 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.dashboard', section: 'deadlines', order: 1 },

  // Commissioner settings tab.
  { topic: 'settings.lockMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 10 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.manager.settings', section: 'picks', order: 11 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 12 },
  { topic: 'settings.pickMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 13 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.manager.settings', section: 'picks', order: 14 },
];
