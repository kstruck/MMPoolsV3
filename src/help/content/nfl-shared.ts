// Help copy shared by the three NFL SEASON pool types — PLAN-HELP-SYSTEM.md T9.
//
// `pool.nfl.*` is ONE set of Help pages covering Pick'em, Survivor and Margin
// (`content/pool-pages.ts`), so a topic placed there is read by all three. This
// file holds only the copy that is true for all three; anything whose meaning
// changes with the format lives in that format's own file
// (`nfl-pickem.ts` here, `nfl-survivor.ts` in T10, `nfl-margin.ts` in T11) and
// is scoped to its type, which is what stops a Survivor reader from being shown
// a Pick'em rule.
//
// Written against `docs/help-voice.md` (K8). Every claim below was read out of
// the source it describes, clause by clause — voice rule 5 is the one that has
// broken four times in this effort, and three of the four were copy that named
// a behaviour nobody had checked.

import type { HelpPlacement, HelpTopic } from '../types';

/** The three season-long NFL formats. `pool.nfl.*` pages cover exactly these. */
export const NFL_SEASON_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const;

/** A setting members meet too — on the rules page or the join screen. */
export const EVERYONE = ['member', 'commissioner'] as const;
/** Commissioner-only surfaces: the manager tabs. */
export const HOST_ONLY = ['commissioner'] as const;

export const NFL_SHARED_TOPICS: readonly HelpTopic[] = [
  {
    // ---- RELEASED BY #482, same as `settings.lockMode` -------------------
    //
    // Lives here rather than in `nfl-pickem.ts` because ALL THREE season
    // formats have this control: Pick'em labels it "Lock Buffer" and offers
    // 0 / 5 / 10, Survivor and Margin label it "Weekly Deadline" and offer
    // 60 / 30 / 5 (`NFLManagerView.tsx:1199` and `:1383`). One control, one
    // topic (voice rule 10), so the copy has to be true of every one of those
    // six values.
    //
    // Read off `shared/weeklyHardLock.ts` and `shared/nflLockMode.ts`:
    //   `DEFAULT_LOCK_BUFFER_MINUTES` = 5 — the default, on all three
    //   `gameLockAt()`                  — kickoff minus the buffer
    //   `weekLockAtFor()`               — which kickoff that is
    // WHERE A MEMBER ACTUALLY READS A DEADLINE: the pool-home countdown
    // (`NFLPoolDashboard.tsx:895-905`), which prints `nextLockAt` and counts
    // down to it. The PICK SHEET shows kickoff times and a locked marker, not
    // the buffer-adjusted instant — an earlier draft sent members there to
    // read a deadline that is not on it (codex round 3).
    //
    //   `weekLockOverrideFor()` + `gameLockAt()` — `Math.max(base, override)`,
    //     so a commissioner's extension moves a Pick'em deadline LATER and can
    //     put it past kickoff. Hard-lock types get `undefined` there and cannot
    //     be extended at all (codex round 2).
    //
    // NO GUARANTEE ABOUT MOVING A DEADLINE BACK OUT. `resolveHardWeekLock()`
    // is `Math.min(frozen, computed)`, which reads like "a week's deadline may
    // only ever move earlier" — and an earlier draft of this topic said
    // exactly that. It is not reliably true: the KNOWN RESIDUAL in
    // `functions/src/lib/effectiveLock.ts` records that `updatePoolSettings`
    // bumps `lockRevision` but never calls `ensureHardLockFreezeForPoolDoc`, so
    // a week nothing has frozen yet has no floor to be held to. The hole is
    // narrow, and this copy simply does not go there — the tip below is
    // advice, and it is true whatever the freeze did (codex round 1).
    id: 'settings.lockBufferMinutes',
    title: 'When picks close',
    short: 'How long before kickoff picks close. Five minutes is the default; a Pick’em pool can set none.',
    long: [
      'A pick closes this many minutes before the kickoff it depends on. A Pick’em pool can also set none, which closes the pick at kickoff itself.',
      'Which kickoff that is depends on the pool. A Pick\u2019em pool that locks per game counts from each game\u2019s own kickoff; a Pick\u2019em pool that locks weekly counts from the first kickoff of the week. Survivor and Margin always count from the first kickoff of the week, and their shortest setting is five minutes \u2014 those formats never leave a pick open once a game is running.',
      'On a Pick’em pool your commissioner can extend a week, which moves that week’s deadline later — later than this setting says, and past kickoff if they choose. Survivor and Margin weeks cannot be extended.',
      'Your pool home counts down to the next deadline and names the date and time it falls on. The pick sheet marks a game whose pick has closed, and that pick cannot be changed.',
    ].join('\n\n'),
    tips: [
      'Change it between weeks rather than during one. Your members read the deadline off the pool home, so moving it while a week is running changes what some of them have already been told.',
    ],
    poolTypes: NFL_SEASON_TYPES,
    audience: EVERYONE,
    related: ['settings.lockMode'],
  },
  {
    id: 'nfl.payments.yours',
    title: 'What you owe and what you paid',
    // READ-ONLY for a member. `PaymentsPanel.tsx:91` renders its only control —
    // "Open Payment Ledger" — behind `isManager`. A member has no control here
    // at all, so copy inviting one to "mark yourself paid" would describe a
    // button that does not exist for them.
    short: 'What your entries owe, and what your commissioner has recorded as paid. You cannot change it from here.',
    long: [
      'Your commissioner records payments as the money arrives, so this page shows what they have marked, not what you have sent.',
      'The money moves between you and your commissioner through whatever payment app you both use. No entry money is ever held here.',
      'If something looks wrong, tell your commissioner — they are the only person who can change it.',
    ].join('\n\n'),
    // Explains a screen, not a setting anybody writes, so it claims no path.
    fields: [],
    poolTypes: NFL_SEASON_TYPES,
    audience: EVERYONE,
    terms: ['paid-status', 'entry-fee'],
    related: ['settings.entryFee'],
  },
  {
    id: 'nfl.manager.ledger',
    title: 'Recording a payment',
    short: 'One sheet for the money: what each member owes, what you have marked paid, and every prize you have published.',
    long: [
      'You mark a member paid once their money reaches you. Nothing on this screen moves money — it records what already happened between the two of you.',
      'Prizes work the same way. Any prize you have published — a week’s or the season’s — appears here with its own paid box, so what you still owe your players is one list rather than a memory.',
      'A member sees their own row on their Payments tab and cannot change it.',
    ].join('\n\n'),
    fields: [],
    poolTypes: NFL_SEASON_TYPES,
    audience: HOST_ONLY,
    terms: ['paid-status', 'payout-record', 'weekly-prize'],
    related: ['nfl.payments.yours'],
  },
  {
    id: 'nfl.manager.scoreWeek',
    title: 'Scoring a week',
    // The tab offers exactly one action — "Score & Recap <week>" — plus the
    // matchup / completed counts above it (`NFLManagerView.tsx:1596-1640`).
    // There is no per-result correction control here; re-running the week is
    // how a corrected feed is taken up.
    //
    // ⚠️ THE BUTTON IS REFUSED WHILE ANY GAME IS UNFINISHED. `scoreNFLWeek`
    // throws ACTIVE_GAMES unless the caller is a SUPER_ADMIN
    // (`functions/src/nflPools.ts:2010-2013`) — the note under the button says
    // "SuperAdmins may override", and a commissioner is not one. An earlier
    // draft of this topic said a commissioner could score early; they cannot.
    short: 'Scores arrive on their own as games finish. This is where you check a week and run it again if a result changed.',
    long: [
      'The counts at the top say how many of the week’s games have finished. Every game has to be final or cancelled before the week can be scored.',
      'Press the button before then and it is refused, with a message naming how many games are still running. Waiting is the only way through it.',
      'Running it again on a week already scored reads the results as they stand now and writes the standings from them. That is how a corrected result is taken up.',
    ].join('\n\n'),
    fields: [],
    poolTypes: NFL_SEASON_TYPES,
    audience: HOST_ONLY,
    terms: ['weekly-prize'],
  },
  {
    id: 'nfl.manager.settingsLock',
    title: 'Changing settings later',
    // `shared/editability.ts` MATRIX: the `locked` phase keeps only basics,
    // contact, paymentHandles, branding, reminders and lifecycle. `settings`,
    // `payouts` and `entryFee` are refused there.
    short: 'Most rules can be changed while the pool is open. Locking the pool freezes the fee, the prize split and the rules.',
    long: [
      'While the pool is open you can change the entry fee, the prize split and the pool rules, and every member sees the new version on the rules page.',
      'Once the pool is locked, only the name, your contact details, the pay-to handles, the branding and the reminders can still be changed. The fee, the split and the rules are fixed from then on, so nobody’s finished week is rewritten under them.',
    ].join('\n\n'),
    fields: [],
    poolTypes: NFL_SEASON_TYPES,
    audience: HOST_ONLY,
    terms: ['pool-lifecycle-state'],
  },
];

/**
 * Where the shared copy sits, plus the T1 wizard topics that belong on a pool's
 * rules page.
 *
 * The rules page is the one screen a member reads to find out what they joined,
 * and voice rule 10 says the sentence explaining a setting exists once — so the
 * entry fee is the SAME topic here as on the wizard's fee step, not a second
 * copy written for members.
 */
export const NFL_SHARED_PLACEMENTS: readonly HelpPlacement[] = [
  { topic: 'nfl.payments.yours', page: 'pool.nfl.payments', section: 'payments', order: 0 },
  { topic: 'settings.entryFee', page: 'pool.nfl.payments', section: 'payments', order: 1 },

  { topic: 'settings.entryFee', page: 'pool.nfl.rules', section: 'money', order: 0 },
  { topic: 'paymentHandles', page: 'pool.nfl.rules', section: 'money', order: 1 },
  { topic: 'paymentInstructions', page: 'pool.nfl.rules', section: 'money', order: 2 },

  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.rules', section: 'general', order: 0 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.picks', section: 'general', order: 0 },

  { topic: 'nfl.manager.ledger', page: 'pool.nfl.manager.members', section: 'money', order: 0 },
  { topic: 'settings.entryFee', page: 'pool.nfl.manager.members', section: 'money', order: 1 },

  { topic: 'nfl.manager.scoreWeek', page: 'pool.nfl.manager.scoring', section: 'scoring', order: 0 },

  { topic: 'nfl.manager.settingsLock', page: 'pool.nfl.manager.settings', section: 'settings', order: 0 },
  { topic: 'settings.lockBufferMinutes', page: 'pool.nfl.manager.settings', section: 'settings', order: 3 },
  { topic: 'settings.entryFee', page: 'pool.nfl.manager.settings', section: 'settings', order: 1 },
  { topic: 'settings.maxEntriesPerUser', page: 'pool.nfl.manager.settings', section: 'settings', order: 2 },

  { topic: 'nfl.manager.settingsLock', page: 'pool.nfl.manager.overview', section: 'general', order: 0 },
];
