// Help copy for the unified create wizard — PLAN-HELP-SYSTEM.md T1.
//
// Written against `docs/help-voice.md` (K8): second person, plain, the default
// named exactly, and money copy that says where the money is (rule 8).
//
// Every string here used to be a `hint=` prop at a call site. Moving them is
// the point of T1: a hint is a second place to write help copy, and the panel
// (T2) and the rules pages (T8) could never read it.
//
// NOT EVERY WIZARD FIELD IS HERE. The per-pool-type rules (survivor strikes,
// bracket scoring, squares grid, margin payout mode) are T9–T13, and each of
// those fields sits in `WIZARD_FIELD_ALLOWLIST` with its ticket until then.

import { MAX_ENTRIES_PER_USER_CAP } from '@shared/multiEntry';
import type { HelpPlacement, HelpTopic } from '../types';

const NFL_SEASON_WIZARDS = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const;

/**
 * Who a topic is written for.
 *
 * `['commissioner']` is a control only a host meets — nobody else ever sees a
 * branding field. `['member', 'commissioner']` is a setting members also meet,
 * on the join screen or the rules page, and T8 renders the same words there.
 * A commissioner sees both (`AUDIENCE_SEES` in the registry), so the wizard
 * shows every topic below either way.
 */
const HOST_ONLY = ['commissioner'] as const;
const EVERYONE = ['member', 'commissioner'] as const;

export const WIZARD_TOPICS: readonly HelpTopic[] = [
  // ---- Basics ------------------------------------------------------------
  {
    id: 'name',
    title: 'Pool name',
    short: 'The name members see on the join screen, in their pool list, and on every email this pool sends.',
    long: [
      'Pick something the people you are inviting will recognise — the office, the group, the year.',
      'You can rename the pool later from your manager settings. The link you shared does not change with it.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
    terms: ['pool'],
  },
  {
    id: 'managerName',
    title: 'Your name as host',
    short: 'The host name members see on the pool page and on the join screen. Leave it blank to use your account name.',
    long: [
      'Members use this to know who is running the pool and who to pay.',
      'It is separate from your account name, so you can run a pool as "Dave from Accounts" without renaming your profile.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
    terms: ['commissioner'],
  },
  {
    id: 'contactEmail',
    title: 'Contact email',
    short: 'Shown to members who need to reach you. It appears on the join screen and on your pool page.',
    long: [
      'This is how a member asks you a question about the pool — a wrong pick, a payment, a rule.',
      'It is shown to anyone who can see the pool, so use an address you are happy to hand out.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
  },
  {
    id: 'isPublic',
    title: 'List this pool publicly',
    short: 'Lists your pool on the public Browse page so anyone can find it. Off by default for private pools you share by link.',
    long: [
      'On, your pool appears in Browse and strangers can find and join it.',
      'Off, the only way in is the link you send. Anyone with the link can still join — this setting controls listing, not access.',
      'You can change it later without affecting anyone who has already joined.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
  },

  // ---- Entry fee and payment --------------------------------------------
  {
    id: 'settings.entryFee',
    title: 'Entry fee',
    short: 'What each player pays you to enter. Leave it at 0 for a free pool. You collect it directly — no money moves through this app.',
    long: [
      'Every player sees the entry fee before they join, and their entry stays marked unpaid until you mark it paid.',
      'Set it to 0 and the pool is free: no payment details are asked for, and there is no prize pot to split.',
      'The money moves between you and your players through whatever payment app you both already use. This app records the amount and who has paid, and nothing else — no balance is ever held here.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
    terms: ['entry-fee', 'paid-status'],
    related: ['paymentHandles', 'settings.payouts.places.*.percentage'],
  },
  {
    id: 'costPerSquare',
    title: 'Cost per square',
    short: 'What one square costs. A player pays this for every square they take. You collect it directly — no money moves through this app.',
    long: [
      'A player who takes four squares owes you four times this amount.',
      'Leave it at 0 for a free grid. Otherwise the grid shows what each player owes, and you mark them paid as the money arrives.',
      'The money moves between you and your players directly. This app records the amount and who has paid, and nothing else.',
    ].join('\n\n'),
    poolTypes: ['SQUARES'],
    audience: EVERYONE,
    terms: ['entry-fee', 'paid-status'],
  },
  {
    id: 'props.cost',
    title: 'Cost per card',
    short: 'What one card costs. A player pays this for every card they enter. You collect it directly — no money moves through this app.',
    long: [
      'A player who enters two cards owes you twice this amount.',
      'Leave it at 0 for a free pool. Otherwise each card shows what is owed, and you mark it paid as the money arrives.',
      'The money moves between you and your players directly. This app records the amount and who has paid, and nothing else.',
    ].join('\n\n'),
    poolTypes: ['PROPS'],
    audience: EVERYONE,
    terms: ['entry-fee', 'paid-status'],
  },
  {
    id: 'paymentHandles',
    title: 'How players pay you',
    short: 'Where players send your entry fee. Fill in only the apps you actually use — members see these and copy them on the join screen.',
    long: [
      'Members see every handle you fill in, next to the amount they owe, with a copy button.',
      'Leave the ones you do not use blank. An empty handle is not shown at all, so a member is never sent to an app you never check.',
      'The payment happens in that app, between you and the player. Nothing about it reaches this app except the note you make when you mark them paid.',
    ].join('\n\n'),
    // One topic, five controls: the explanation is the same for all of them,
    // and voice rule 10 says a sentence explaining a setting exists once.
    fields: [
      'paymentHandles.venmo',
      'paymentHandles.zelle',
      'paymentHandles.cashapp',
      'paymentHandles.paypal',
      'paymentHandles.googlePay',
    ],
    poolTypes: 'all',
    audience: EVERYONE,
    terms: ['payment-handle'],
    related: ['paymentInstructions'],
  },
  {
    id: 'paymentInstructions',
    title: 'Payment instructions',
    short: 'Free text shown beside your payment handles. Say when you want to be paid and what a player should put in the note.',
    long: [
      'Members read this on the join screen, right where they are deciding how to pay you.',
      'The most useful thing to put here is what you need in the payment note — a name you will recognise on a bank statement.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
    terms: ['payment-handle'],
  },

  // ---- Payouts -----------------------------------------------------------
  {
    id: 'settings.payouts.places.*.rank',
    title: 'Prize place',
    short: 'Which finishing position this prize is for. 1 is the winner. A place can appear only once in the list.',
    long: [
      'Add one row per paid position: 1 for the winner, 2 for the runner-up, and so on.',
      'Two rows with the same place are refused, because the pool would then have two conflicting answers for who is owed what.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
    related: ['settings.payouts.places.*.percentage'],
  },
  {
    id: 'settings.payouts.places.*.percentage',
    title: 'Prize share',
    short: 'What share of the pot this place takes. The shares must add up to 100% or less. The pot is the money you collect from players.',
    long: [
      'The pot is the entry fees you have collected. Nothing is held here, so these shares are a record of what you owe each winner, not a transfer.',
      'Shares totalling less than 100% are allowed — hosts do that when part of the pot goes to a charity or to a prize you award yourself.',
      'Members see the split before they join, so they know what first place is worth.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
    terms: ['season-prize'],
    related: ['settings.payouts.places.*.rank', 'settings.entryFee'],
  },

  // ---- Branding ----------------------------------------------------------
  {
    id: 'branding.logoUrl',
    title: 'Logo URL',
    short: 'A link to your logo image. It shows at the top of your pool page. Leave it blank and members see the pool name instead.',
    long: [
      'Paste the address of an image that is already on the web — the link has to end at the picture itself, not at a page showing it.',
      'Nothing is uploaded here, so if that address stops working the logo stops showing.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
  },
  {
    id: 'branding.primaryColor',
    title: 'Primary colour',
    short: 'The main colour of your pool page — headings, buttons and highlights. Use a hex value such as #4f46e5.',
    long: [
      'This is the colour members notice first. A dark, saturated colour reads best behind white text.',
      'You can change it whenever you like; members see the new colour the next time they open the pool.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
  },
  {
    id: 'branding.secondaryColor',
    title: 'Accent colour',
    short: 'The second colour, used behind smaller details on your pool page. Use a hex value such as #0ea5e9.',
    long: [
      'It is used sparingly — badges, small highlights, the odd border.',
      'Pick something that sits beside your primary colour rather than competing with it.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
  },

  // ---- Reminders ---------------------------------------------------------
  {
    id: 'reminders.auto24h',
    title: 'Remind 24 hours before lock',
    short: 'Emails every member a day before picks lock, so anyone who has not entered still has time.',
    long: [
      'The reminder goes only to members who have not submitted yet, so nobody is nagged about something they have done.',
      'It is sent once. If you would rather chase people yourself, leave it off.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
  },
  {
    id: 'reminders.auto1h',
    title: 'Remind 1 hour before lock',
    short: 'A last call an hour before picks lock, to members who have still not entered.',
    long: [
      'This is the one that catches people. An hour is enough to open the pick sheet on a phone and finish.',
      'You can turn both reminders on; a member who enters after the first one does not get the second.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
  },
  {
    id: 'reminders.autoLock',
    title: 'Auto-lock at kickoff',
    short: 'Locks the pool by itself at kickoff instead of waiting for you to do it. On is the safer choice.',
    long: [
      'With it off, picks stay editable until you lock the pool yourself — which means a late pick can be made after the game has started.',
      'With it on, the pool locks at kickoff whether you are watching or not.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
  },
  {
    id: 'reminders.announceWinner',
    title: 'Announce the winner',
    short: 'Emails everyone the final standings once the pool is finished, without you having to write it.',
    long: [
      'It names the winner and the finishing order. It does not say anything about who has been paid.',
      'Leave it off if you would rather tell the group yourself.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
  },

  // ---- Launch (billing, not entry fees) ----------------------------------
  {
    id: 'estimatedPlayers',
    title: 'Expected number of players',
    short: 'How many players you expect. An estimate is fine. Small pools launch on the free plan; larger ones start a free trial.',
    long: [
      'This decides what you pay to run the pool. It is not a cap — nobody is turned away if more players join than you guessed.',
      'The price is worked out for you and shown below before you launch. Nothing is charged without you agreeing to it.',
      'This is separate from the entry fee, which your players pay you and which never passes through this app.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
    terms: ['billing'],
  },
  {
    id: 'launch.coupon',
    title: 'Coupon code',
    short: 'A code that lowers what you pay to run this pool. It is applied to the quote below and again at checkout.',
    long: [
      'Type the code and the quote below updates. An unknown or expired code changes nothing and says so.',
      'A coupon affects what you pay to run the pool. It has no effect on the entry fee your players pay you.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
    terms: ['coupon', 'billing'],
  },
  {
    id: 'launch.addons',
    title: 'Premium add-ons',
    short: 'Optional extras you pay for. Ticking any of them starts a free trial rather than launching on the free plan.',
    long: [
      'Each add-on switches on one extra feature for this pool. The price for the ones you tick is shown in the quote below.',
      'Nothing is charged when you launch — a paid add-on starts a trial, and you are told how long it runs.',
      'You pay for add-ons; your players never do. They are not part of the entry fee.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: HOST_ONLY,
    terms: ['billing'],
    related: ['estimatedPlayers'],
  },

  // ---- Season (read-only display, one variant per family) ----------------
  {
    id: 'wizard.season',
    title: 'Season',
    short: 'Pools are created for the current NFL season. Pick preseason, regular season or postseason below.',
    long: [
      'You cannot move a pool to a different season. A pool for next year is a new pool, created next year.',
      'Which part of that season it covers is the season type below, and that you do choose.',
    ].join('\n\n'),
    // Explains a read-only display, not a setting anybody can write, so it
    // claims no schema path — `season` stays a permanent allowlist row.
    fields: [],
    poolTypes: NFL_SEASON_WIZARDS,
    audience: EVERYONE,
    related: ['seasonType'],
  },
  {
    id: 'NFL_PLAYOFFS:wizard.season',
    title: 'Season',
    short: 'Playoff pools belong to the current NFL season, whose postseason is played the following January.',
    long: [
      'The season is named for the year the regular season starts, so the 2026 season is the one whose playoffs run in January 2027.',
      'You cannot move a pool to a different season.',
    ].join('\n\n'),
    fields: [],
    poolTypes: ['NFL_PLAYOFFS'],
    audience: EVERYONE,
  },
  {
    id: 'seasonType',
    title: 'Season type',
    short: 'Which part of the NFL season your pool covers. Regular season is the default; preseason and postseason are the other two.',
    long: [
      'Regular season is the eighteen-week slate most pools run on.',
      'Preseason pools finish before the season starts and are a good way to try the format out. Postseason covers the playoff rounds only.',
      'Members only ever see the weeks belonging to the part you choose.',
    ].join('\n\n'),
    poolTypes: NFL_SEASON_WIZARDS,
    audience: EVERYONE,
  },

  // ---- Pick'em rules that carried a hint ---------------------------------
  {
    id: 'settings.pickMode',
    title: 'Scoring mode',
    short: "Straight up is the default and needs no betting lines. ATS grades every pick against the game's spread, with a push scoring zero.",
    long: [
      'Straight up asks one question per game: who wins. Nothing else is needed and every week can be scored.',
      'Against the spread grades each pick against the betting line instead. A pool set to ATS accepts no picks for a week until every game that week has a finalised spread — preseason slates mostly carry no line at all.',
      'Members see which mode they are playing on their pick sheet, next to each game.',
    ].join('\n\n'),
    poolTypes: ['NFL_PICKEM'],
    audience: EVERYONE,
  },
  {
    id: 'settings.weeklyTiebreaker',
    title: 'Weekly tie-breaker',
    short: 'Decides who wins a week when two players score the same. It cannot be changed once anyone has submitted picks, so choose it now.',
    long: [
      'Players predict the combined score of the tiebreaker game on their pick sheet. On a week with no Monday game, the final game of the week is used.',
      'Whoever is closest takes the week. The rule you pick here decides what "closest" means and what happens if two players are equally close.',
      'Set it before you launch. Once any player has submitted picks, it is fixed for the life of the pool.',
    ].join('\n\n'),
    poolTypes: ['NFL_PICKEM'],
    audience: EVERYONE,
    terms: ['weekly-prize'],
  },
  {
    id: 'settings.maxEntriesPerUser',
    title: 'Max entries per player',
    short: `2 to ${MAX_ENTRIES_PER_USER_CAP}. Each entry pays the entry fee and competes on its own. You can raise this later, but never lower it.`,
    long: [
      'One player can hold several entries, each with its own picks and its own place in the standings.',
      'Every entry owes the entry fee, so a player with three entries owes you three times the amount.',
      'You can raise the limit while the pool is open. Lowering it is refused, because an entry someone has already made and paid for cannot be taken away from them.',
    ].join('\n\n'),
    poolTypes: 'all',
    audience: EVERYONE,
    terms: ['entry'],
    related: ['settings.entryFee'],
  },

  // ---- Playoff -----------------------------------------------------------
  {
    id: 'lockDate',
    title: 'Lock date and time',
    short: 'When picks stop being editable. It defaults to Wild Card kickoff. After it passes nobody can change a pick, including you.',
    long: [
      'Up to this moment, members can change their picks as often as they like.',
      'After it, the pick sheet is read-only for everyone. There is no way to reopen it for one player.',
      'Members see the deadline on their pick sheet and get a reminder before it if you turned reminders on.',
    ].join('\n\n'),
    poolTypes: ['NFL_PLAYOFFS'],
    audience: EVERYONE,
  },

  // ---- Props -------------------------------------------------------------
  {
    id: 'props.questions.*.text',
    title: 'Question',
    short: 'The question players answer on their card. Ask one thing with an answer that is clear once the game is over.',
    long: [
      'Every player answers every question, and each correct answer is worth the same.',
      'Write it so the answer cannot be argued about afterwards. "Who scores first" settles itself; "who plays best" does not.',
    ].join('\n\n'),
    poolTypes: ['PROPS'],
    audience: EVERYONE,
  },
  {
    id: 'props.questions.*.options',
    title: 'Answer options',
    short: 'The answers players choose between — two to four of them, separated by commas. Example: Heads, Tails.',
    long: [
      'Players pick exactly one of these. There is no free-text answer.',
      'Keep the wording short: the options are shown as buttons on a phone.',
    ].join('\n\n'),
    // The control edits the whole list; the settable leaf is each string in it.
    fields: ['props.questions.*.options.*'],
    poolTypes: ['PROPS'],
    audience: EVERYONE,
  },
];

/**
 * Where each topic appears in the panel.
 *
 * Placements name the BASE topic id — `resolveTopic` picks the pool-type
 * variant at render time, which is why `wizard.season` is written once and
 * shows the playoff wording on the playoff page.
 */
function place(page: string, section: string, topics: readonly string[]): HelpPlacement[] {
  return topics.map((topic, i) => ({ topic, page, section, order: i }));
}

const BASICS = ['name', 'managerName', 'contactEmail', 'isPublic'] as const;
const PAYMENT = ['paymentHandles', 'paymentInstructions'] as const;
const PAYOUTS = ['settings.payouts.places.*.rank', 'settings.payouts.places.*.percentage'] as const;
const BRANDING = ['branding.logoUrl', 'branding.primaryColor', 'branding.secondaryColor'] as const;
const LAUNCH = ['estimatedPlayers', 'launch.addons', 'launch.coupon'] as const;
const REMINDERS = ['reminders.auto24h', 'reminders.auto1h', 'reminders.autoLock', 'reminders.announceWinner'] as const;

/** The step list of one wizard, as help placements. */
function wizardPlacements(page: string, opts: {
  rules?: readonly string[];
  fee: string;
  payouts: boolean;
  reminders?: boolean;
}): HelpPlacement[] {
  return [
    ...place(page, 'basics', BASICS),
    ...(opts.rules ? place(page, 'rules', opts.rules) : []),
    ...place(page, 'fee', [opts.fee, ...PAYMENT]),
    ...(opts.payouts ? place(page, 'payouts', PAYOUTS) : []),
    ...place(page, 'branding', BRANDING),
    ...(opts.reminders ? place(page, 'reminders', REMINDERS) : []),
    ...place(page, 'launch', LAUNCH),
  ];
}

export const WIZARD_PLACEMENTS: readonly HelpPlacement[] = [
  ...wizardPlacements('wizard.pickem', {
    rules: ['wizard.season', 'seasonType', 'settings.pickMode', 'settings.weeklyTiebreaker', 'settings.maxEntriesPerUser'],
    fee: 'settings.entryFee',
    payouts: true,
  }),
  ...wizardPlacements('wizard.survivor', {
    rules: ['wizard.season', 'seasonType', 'settings.maxEntriesPerUser'],
    fee: 'settings.entryFee',
    payouts: true,
  }),
  ...wizardPlacements('wizard.margin', {
    rules: ['wizard.season', 'seasonType', 'settings.maxEntriesPerUser'],
    fee: 'settings.entryFee',
    payouts: true,
  }),
  ...wizardPlacements('wizard.playoff', {
    rules: ['wizard.season', 'lockDate'],
    fee: 'settings.entryFee',
    payouts: true,
    reminders: true,
  }),
  ...wizardPlacements('wizard.bracket', { fee: 'settings.entryFee', payouts: true }),
  ...wizardPlacements('wizard.squares', { fee: 'costPerSquare', payouts: false }),
  ...wizardPlacements('wizard.props', {
    rules: ['props.questions.*.text', 'props.questions.*.options'],
    fee: 'props.cost',
    payouts: false,
  }),
];
