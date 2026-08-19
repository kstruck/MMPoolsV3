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
  {
    // ---- RELEASED BY #482 ------------------------------------------------
    //
    // This topic and `settings.lockBufferMinutes` in `nfl-shared.ts` were
    // written during T9, survived six codex rounds, and were WITHDRAWN on
    // round 7 when codex showed the claim they rest on was false in the
    // shipped client: `NFLPoolDashboard` computed one week lock from the
    // week's EARLIEST kickoff for every NFL type and `PickemPickEntry`
    // treated it as "every game is locked", so a PER_GAME pool closed its
    // whole sheet on Thursday night. `93f44bb2` (#482) fixed exactly that and
    // put the rule in `shared/nflLockMode.ts`, so the copy is true now.
    //
    // Every sentence below is read off that file:
    //   `nflLockMode()`     — confidence forces WEEKLY; Survivor/Margin always
    //   `weekLockAtFor()`   — PER_GAME references the LAST kickoff, WEEKLY the first
    //   `gameLockAt()`      — kickoff minus the buffer
    id: 'settings.lockMode',
    title: 'Lock mode',
    short: 'Choose whether each game closes on its own deadline, or the whole week closes on the first game\u2019s.',
    long: [
      'Per game is the default. Each pick stays open until its own game\u2019s deadline, so you can still change a Sunday pick after the Thursday night game has started.',
      'Weekly closes every pick in the week on the first game\u2019s deadline. Choose it when you want everyone playing the same slate with the same information.',
      'Confidence points force weekly whatever this says, because a confidence sheet spends each weight across the week\u2019s games exactly once. The control is greyed out while confidence points are on, and the pool plays weekly.',
      'A deadline falls a set number of minutes before the kickoff it counts from \u2014 five by default, and the lock buffer is where that number is set. Members see the deadline on their pick sheet either way.',
    ].join('\n\n'),
    poolTypes: PICKEM,
    audience: EVERYONE,
    related: ['settings.lockBufferMinutes', 'settings.confidenceMode'],
  },

  {
    id: 'settings.confidenceMode',
    title: 'Confidence points',
    short: 'Players rank the week’s games instead of picking flat, and a correct pick earns the rank they gave it. Off by default.',
    long: [
      // NOT "who wins" (codex R10). An ATS pool asks who COVERS the spread
      // (`settings.pickMode`, and `poolUsesSpreads` gates submission on it), so
      // outcome language is wrong for half the supported pools. What is true of
      // both is that the reader picks one side per game.
      'Off is the default. Every correct pick is worth the same, and a player picks one side in each game.',
      // `validateConfidenceValues` (functions/src/nflScoringEngine.ts:187-224):
      // N games, weights uniquely in [17-N .. 16], every game assigned. So the
      // TOP weight is always 16 and the bottom moves with the week's size —
      // "1 to 16" would be wrong on any week shorter than sixteen games.
      'On, a player gives every game in the week a different rank, the highest being 16 for the game they are surest of. A correct pick earns its rank; a wrong one earns nothing. On a short week the ranks start higher, and the sheet shows the range.',
      'Every game has to be ranked before a sheet can be submitted, and no rank can be used twice.',
      // NOT "at the first kickoff" (codex R9-1). `NFLPoolDashboard.tsx:526-531`
      // locks the week at `earliestKickoff - lockBufferMinutes`, default five,
      // so naming kickoff hands the reader a five-minute window the sheet has
      // already closed.
      'Turning it on also locks the whole week at one deadline, shortly before the week’s first game, whatever lock mode says.',
    ].join('\n\n'),
    poolTypes: PICKEM,
    audience: EVERYONE,
    related: ['pickem.picksheet'],
  },
  // ---- The pick sheet ----------------------------------------------------
  {
    id: 'pickem.picksheet',
    title: 'Making your picks',
    short: 'Pick a side in each game, then submit. Nothing counts until you submit.',
    long: [
      // `PickemPickEntry.tsx:105-120` — an unsubmitted sheet is kept in the
      // browser via `draftStore` and restored with a toast on the next visit.
      'What you tap is kept on this device as you go, so leaving the page does not lose it. It is not in the pool until you submit.',
      // Which side to pick is the SCORING MODE's question, not this topic's
      // (codex R10): straight up asks who wins, against the spread asks who
      // covers. One concept, one topic — so it is linked, not restated.
      'Whether you are picking the winner or the team that covers the spread depends on how your pool scores. The sheet says which, next to each game.',
      // DELIBERATELY SAYS NOTHING ABOUT *WHEN* A PICK CLOSES (codex R8-1).
      // Three behaviours are in play and no one sentence covers them: the
      // server closes a per-game pool game by game and refuses only a CHANGED
      // pick (`nflPools.ts:618-624`); a weekly or confidence pool refuses every
      // submission once the week locks (`:601-604`); and the shipped client
      // closes the WHOLE sheet at the first kickoff whatever the mode (the
      // defect recorded at the top of this file). 'While the sheet is still
      // open' is true under all three, and the sheet is what tells the reader
      // which games those are. Earlier drafts named kickoff, then the deadline,
      // and both were false for some pool.
      'You can submit again as often as you like while the sheet is still open. The last one that lands is the one that counts.',
      // THE EXTENSION CLAUSE IS GONE (codex R11), and only half its reasoning
      // was right. The SERVER does honour an override: `submitNFLPicks` builds
      // `lockSettings` from `effectiveLockSettings(pool.settings, type)`
      // (`nflPools.ts:481`), which passes `weekLockOverrides` straight through
      // for Pick'em, and `effectiveGameLockAt` takes `max(base, override)`. But
      // the CLIENT never reads it — `NFLPoolDashboard.tsx:515-534` computes the
      // sheet's lock from the earliest kickoff and the buffer alone — so the
      // member's sheet stays closed and the extension only reaches them through
      // a commissioner proxy pick. Promising it would be promising a door the
      // reader cannot open. Same root cause as the withdrawn lock topics.
      // CLAIMS THE LEAST, ON PURPOSE. Three rounds argued over this sentence:
      // "nobody can reopen it" is false (a commissioner can extend an
      // unpublished week), "ask your commissioner" is false too (codex R15 —
      // `NFLManagerView.tsx:841` sends `proxyPick` a picks map keyed by the WEEK
      // NUMBER, and the Pick'em branch at `poolExceptions.ts:340-344` looks each
      // key up as a GAME id, so the call fails with "Game 3 not found"), and on
      // Survivor and Margin an extension is refused outright (HARD_WEEKLY_LOCK).
      // What is true of every pool, every type and every proxy state is what the
      // reader is standing in front of: this sheet will not take it.
      'The sheet shows which games are still open. Once a pick has closed you cannot change it from this sheet.',
    ].join('\n\n'),
    fields: [],
    poolTypes: PICKEM,
    audience: EVERYONE,
    terms: ['entry'],
    related: ['settings.pickMode', 'pickem.quickPicks', 'pickem.tiebreakerPrediction'],
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
      // NO SETTING DECIDES AN EXACT TIE (qodo #9). `computeWeeklyWinners`
      // (functions/src/nflScoringEngine.ts:597-611) returns EVERY remaining
      // equally-close leader, and the recap renders "(shared)". The weekly
      // tie-break rule chooses which GAME is asked about, nothing more.
      'Add the final scores together and enter that one number. Closest takes the week. Two players equally close share it.',
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
  { topic: 'settings.confidenceMode', page: 'wizard.pickem.rules', section: 'rules', order: 12 },
  { topic: 'settings.lockMode', page: 'wizard.pickem.rules', section: 'rules', order: 15 },

  // What a member reads to find out what they joined.
  { topic: 'settings.confidenceMode', page: 'pool.nfl.rules', section: 'picks', order: 12 },
  { topic: 'settings.pickMode', page: 'pool.nfl.rules', section: 'picks', order: 13 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.rules', section: 'picks', order: 14 },
  { topic: 'settings.lockMode', page: 'pool.nfl.rules', section: 'picks', order: 15 },

  // The pick sheet itself.
  { topic: 'pickem.picksheet', page: 'pool.nfl.picks', section: 'picks', order: 0 },
  { topic: 'settings.pickMode', page: 'pool.nfl.picks', section: 'picks', order: 4 },
  { topic: 'pickem.quickPicks', page: 'pool.nfl.picks', section: 'picks', order: 1 },
  { topic: 'pickem.tiebreakerPrediction', page: 'pool.nfl.picks', section: 'picks', order: 2 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.picks', section: 'picks', order: 3 },
  { topic: 'settings.lockMode', page: 'pool.nfl.picks', section: 'picks', order: 5 },

  // The all-picks grid: the question it raises is when a pick appears.

  // Standings and results: what a number on the row is worth.
  { topic: 'settings.confidenceMode', page: 'pool.nfl.standings', section: 'scoring', order: 0 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.standings', section: 'scoring', order: 1 },
  { topic: 'settings.confidenceMode', page: 'pool.nfl.results', section: 'scoring', order: 0 },
  { topic: 'pickem.tiebreakerPrediction', page: 'pool.nfl.results', section: 'scoring', order: 1 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.recaps', section: 'scoring', order: 0 },

  // The dashboard's own question is "when do I have to pick by".

  // Commissioner settings tab.
  { topic: 'settings.confidenceMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 12 },
  { topic: 'settings.pickMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 13 },
  { topic: 'settings.weeklyTiebreaker', page: 'pool.nfl.manager.settings', section: 'picks', order: 14 },
  { topic: 'settings.lockMode', page: 'pool.nfl.manager.settings', section: 'picks', order: 15 },
];
