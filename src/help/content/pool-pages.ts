// The pool-surface Help pages — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// `/pool/:id` and `/admin/:id` are ONE route each in `App.tsx`; every pool of
// every type shares them, and the tab is what makes two screens different. So
// page identity here is `route + poolTypes + tab`, and Spectrum's
// longest-path-prefix fallback could not have worked (PLAN §3 D3).
//
// WHAT THESE PAGES CARRY AND WHAT THEY DO NOT. A summary per screen — what it
// is for, and what the reader can do on it. The per-option copy is the content
// tickets' job (T9–T13), so most of these pages have no topics under "On this
// page" yet; the panel renders the summary, the glossary and "All pages",
// which is already more than the reader has today. A page with no topics is
// valid content, not a gap the registry should refuse.
//
// `href` REBUILDS THE CURRENT PATH rather than naming one. A pool's URL holds
// its id or slug and this file cannot know it — but these pages are only
// visible to a reader whose scope already puts them in a pool of this type, so
// `ctx.pathname` is that pool. A page for a DIFFERENT type returns null: the
// "Show all pool types" expander lists them, and a link built from the pool
// the reader is actually in would take them to a tab that pool has no idea
// about.

import { matchPath } from 'react-router';
import type { Audience, HelpPage, HelpRouteContext } from '../types';
import type { PoolType } from '@shared/poolTypes';

const NFL_TYPES: readonly PoolType[] = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
const MEMBER: readonly Audience[] = ['member', 'commissioner'];
const HOST: readonly Audience[] = ['commissioner'];

interface TabPageSpec {
  tab: string;
  subTab?: string;
  title: string;
  summary: string;
  audience?: readonly Audience[];
}

function poolPages(args: {
  idPrefix: string;
  route: string;
  /** See `HelpPage.altRoutes` — the same screen under a second App.tsx route. */
  altRoutes?: readonly string[];
  poolTypes: readonly PoolType[];
  rootTitle: string;
  rootSummary: string;
  /**
   * The query parameter this surface spells its sub-tab with. The NFL
   * dashboard has deep-linked `?tab=manager&section=members` since the payment
   * ledger shipped, so it keeps `section`; everything else uses `sub`.
   */
  subParam?: string;
  tabs: readonly TabPageSpec[];
}): HelpPage[] {
  const { idPrefix, route, altRoutes, poolTypes, rootTitle, rootSummary, tabs, subParam = 'sub' } = args;
  /**
   * REPLACE the tab, do not rebuild the query (codex R11). A pool URL can carry
   * state Help knows nothing about — `?week=3` on the NFL results tab,
   * `?action=create` on the bracket dashboard — and the dashboards' own tab
   * setters preserve it. A help link that dropped it would quietly reset the
   * reader's week, which is worse than not linking at all.
   */
  const ownRoutes = [route, ...(altRoutes ?? [])];
  const withTab = (ctx: HelpRouteContext, tab?: string, subTab?: string) => {
    // ONLY from a path this page actually lives on (codex R12). These links are
    // built from `ctx.pathname` because a pool's id is in the URL and this file
    // cannot know it — so from anywhere else the result is a URL for the wrong
    // screen. A commissioner in `/create/pickem` sees these pages listed, because
    // the wizard publishes the pool type; `?tab=picks` on the wizard route is not
    // a pool. Unlinked is the honest answer, and `canOpenPage` renders it as text.
    if (!ownRoutes.some((r) => matchPath(r, ctx.pathname))) return null;
    const params = new URLSearchParams(ctx.search ?? '');
    if (tab === undefined) params.delete('tab');
    else params.set('tab', tab);
    // A page with no sub-tab CLEARS it, matching `NFLPoolDashboard`'s own setter:
    // leaving `section=members` on a jump to the Standings tab would deep-link a
    // commissioner section the reader did not ask for.
    if (subTab === undefined) params.delete(subParam);
    else params.set(subParam, subTab);
    const query = params.toString();
    return query ? `${ctx.pathname}?${query}` : ctx.pathname;
  };
  const linkable = (tab: string, subTab?: string) => (ctx: HelpRouteContext) => {
    if (!ctx.poolType || !poolTypes.includes(ctx.poolType)) return null;
    return withTab(ctx, tab, subTab);
  };
  const root: HelpPage = {
    id: idPrefix,
    route,
    altRoutes,
    href: (ctx) => (ctx.poolType && poolTypes.includes(ctx.poolType) ? withTab(ctx) : null),
    title: rootTitle,
    summary: rootSummary,
    poolTypes,
    audience: MEMBER,
  };
  return [
    root,
    ...tabs.map<HelpPage>((spec) => ({
      id: `${idPrefix}.${spec.tab}${spec.subTab ? `.${spec.subTab}` : ''}`,
      route,
      altRoutes,
      tab: spec.tab,
      subTab: spec.subTab,
      href: linkable(spec.tab, spec.subTab),
      title: spec.title,
      summary: spec.summary,
      poolTypes,
      audience: spec.audience ?? MEMBER,
    })),
  ];
}

const NFL_PAGES = poolPages({
  idPrefix: 'pool.nfl',
  route: '/pool/:id',
  // `/admin/:id` renders this same dashboard for this type (AdminRoute).
  altRoutes: ['/admin/:id'],
  poolTypes: NFL_TYPES,
  subParam: 'section',
  rootTitle: 'NFL pool',
  rootSummary:
    'Your pool home. The tabs across the top take you to your picks, the standings, the rules, and what you owe. What you see depends on whether picks are open and whether the week has been scored.',
  tabs: [
    {
      tab: 'dashboard',
      title: 'NFL pool — Pool home',
      summary:
        'A snapshot of the pool: where you stand, what the pot is worth, when picks lock next, and anything the commissioner has announced.',
    },
    {
      tab: 'picks',
      title: 'NFL pool — My picks',
      summary:
      // NARROWED IN T9. The first version promised per-game editing and
      // "once a game starts", and neither survives contact with the code: the
      // lock is kickoff MINUS the buffer, and the shipped client closes the
      // whole sheet at the week's first kickoff whatever `lockMode` says
      // (`NFLPoolDashboard.tsx:515-534`, `PickemPickEntry.tsx:138-141`). This
      // says what is true of every pool and lets the sheet be the authority.
        'Make and change your picks for the week, then submit them. The sheet shows which games are still open and when the next deadline falls. A pick that has closed cannot be changed by anyone.',
    },
    {
      tab: 'grid',
      title: 'NFL pool — All picks',
      // PER GAME, not per week. `functions/src/lib/pickReveal.ts` reveals a pick
      // at its own game's lock instant — the same instant the picker's own edit
      // window closes — and the commissioner is on that same boundary. Copy that
      // said "when the week locks" would describe a rule the code refused to
      // implement on purpose.
      summary:
        'Everyone’s picks for a week, side by side. A pick appears once its own game locks, so nobody can copy anyone before the deadline.',
    },
    {
      tab: 'standings',
      title: 'NFL pool — Standings',
      summary:
        'Who is winning the season. Ranked by total points, with the tie-break rule applied. Updates as each game finishes.',
    },
    {
      tab: 'results',
      title: 'NFL pool — Results',
      summary:
        'What happened in a week: each game, who picked what, and the points it earned. Pick a week to look back at it.',
    },
    {
      tab: 'recaps',
      title: 'NFL pool — Recaps',
      summary:
        'The written round-up of a scored week, including the weekly winner and any prize that was awarded.',
    },
    {
      tab: 'rules',
      title: 'NFL pool — Rules & payment',
      summary:
        'The rules this pool runs on and how to pay. The entry fee, the prize split and the pay-to handles are all shown here. Money goes to your commissioner directly, never through this site.',
    },
    {
      tab: 'payments',
      title: 'NFL pool — Payments',
      // READ-ONLY for a member, and the first draft of this line said otherwise.
      // `PaymentsPanel.tsx:91` renders its only control — "Open Payment Ledger" —
      // behind `isManager`, so a member has nothing to mark. Voice rule 5: name
      // what the screen does, and check the screen.
      summary:
        'What you owe, what you have paid, and any prize owed to you. Your commissioner records payments as they arrive, so this is a read-only view of what they have marked.',
    },
    {
      tab: 'manager',
      title: 'NFL pool — Commissioner',
      summary:
        'Your commissioner tools: members and payments, scoring and corrections, and the pool settings. Only you and any co-commissioner can open this.',
      audience: HOST,
    },
    {
      tab: 'manager',
      subTab: 'overview',
      title: 'NFL commissioner — Overview',
      summary: 'The state of the pool at a glance, with the actions that need you most listed first.',
      audience: HOST,
    },
    {
      tab: 'manager',
      subTab: 'members',
      title: 'NFL commissioner — Members & payments',
      summary:
        'Everyone in the pool, what each owes, and the payment ledger. Record a payment, record a payout, or remove an entry that never paid.',
      audience: HOST,
    },
    {
      tab: 'manager',
      subTab: 'scoring',
      title: 'NFL commissioner — Scoring',
      summary:
      // NARROWED IN T9. The tab's only control is "Score & Recap <week>"
      // (`NFLManagerView.tsx:1596-1640`) and `scoreNFLWeek` refuses it while any
      // game is unfinished unless the caller is a SUPER_ADMIN — so there is no
      // per-result correction here, and a commissioner cannot score early. The
      // first draft implied both.
        'Scores come in automatically as games finish. This is where you check a week and run it again after a result changes.',
      audience: HOST,
    },
    {
      tab: 'manager',
      subTab: 'settings',
      title: 'NFL commissioner — Settings',
      summary:
        'Change the pool rules after it has started. Some settings are locked once a week has been scored, so that nobody’s finished week is rewritten under them.',
      audience: HOST,
    },
  ],
});

const PLAYOFF_PAGES = poolPages({
  idPrefix: 'pool.playoff',
  route: '/pool/:id',
  // `/admin/:id` renders this same dashboard for this type (AdminRoute).
  altRoutes: ['/admin/:id'],
  poolTypes: ['NFL_PLAYOFFS'],
  rootTitle: 'Playoff pool',
  rootSummary:
    'Your playoff pool. Every pick is made once, before the playoffs start, and they all lock together on the date the commissioner set.',
  tabs: [
    {
      tab: 'picks',
      title: 'Playoff pool — My picks',
      summary:
        'Rank the teams you think will go furthest. You can change your ranking until the lock date, after which it is fixed for the whole playoffs.',
    },
    {
      tab: 'leaderboard',
      title: 'Playoff pool — Leaderboard',
      summary: 'Who is ahead, with the points each round has awarded so far.',
    },
    {
      tab: 'rules',
      title: 'Playoff pool — Rules & payment info',
      summary:
        'How this pool scores each round, when picks lock, the entry fee and how to pay. Money goes to your commissioner directly, never through this site.',
    },
    {
      tab: 'ai',
      title: 'Playoff pool — AI insights',
      summary: 'Written notes about the pool generated from its own results. Available when the commissioner has turned it on.',
    },
    {
      tab: 'commissioner',
      title: 'Playoff pool — Commissioner',
      summary: 'Your commissioner tools: the pool settings, the round results, and the members list.',
      audience: HOST,
    },
  ],
});

const BRACKET_PAGES = poolPages({
  idPrefix: 'pool.bracket',
  route: '/pool/:id',
  // `/admin/:id` renders this same dashboard for this type (AdminRoute).
  altRoutes: ['/admin/:id'],
  poolTypes: ['BRACKET'],
  rootTitle: 'Bracket pool',
  rootSummary:
    'Your bracket pool. Fill in a bracket before the tournament starts, then watch it score itself round by round.',
  tabs: [
    {
      tab: 'dashboard',
      title: 'Bracket pool — Pool home',
      summary: 'Where you stand, what the pot is worth, and how much of the tournament is still to play.',
    },
    {
      tab: 'standings',
      title: 'Bracket pool — Standings',
      summary:
        'Every entry ranked by points, with the most it could still finish on. An entry whose best case is below the leader is out of it.',
    },
    {
      tab: 'entries',
      title: 'Bracket pool — Entries',
      summary: 'The list of entries in the pool, who owns each one, and whether it has been paid for.',
    },
    {
      tab: 'brackets',
      title: 'Bracket pool — Brackets',
      summary: 'Open any entry and read its picks round by round. Brackets stay hidden until the tournament locks.',
    },
    {
      tab: 'reports',
      title: 'Bracket pool — Reports',
      summary: 'Charts and exports for the pool: how picks were spread, which teams carried the pool, and a printable standings sheet.',
    },
    {
      tab: 'rules',
      title: 'Bracket pool — Rules & payment',
      summary:
        'How rounds are scored, what breaks a tie, the entry fee and how to pay. Money goes to your commissioner directly, never through this site.',
    },
    {
      tab: 'manager',
      title: 'Bracket pool — Commissioner',
      summary: 'Your commissioner tools: the scoring system, the entry cap, the members list, and corrections.',
      audience: HOST,
    },
    {
      tab: 'ledger',
      title: 'Bracket pool — Payment ledger',
      summary:
        'One sheet for the money: what each entry owes, what has been paid, and what has been paid out. You record it; the site does not move any money.',
      audience: HOST,
    },
  ],
});

const PROPS_PAGES = poolPages({
  idPrefix: 'pool.props',
  route: '/pool/:id',
  // `/admin/:id` renders this same dashboard for this type (AdminRoute).
  altRoutes: ['/admin/:id'],
  poolTypes: ['PROPS'],
  rootTitle: 'Props pool',
  rootSummary:
    'Your props pool. Everyone answers the same card of questions before the game, and the card is graded afterwards.',
  tabs: [
    {
      tab: 'cards',
      title: 'Props pool — Cards',
      summary: 'Fill in your card, or read it back after the game. You can change an answer until the card locks.',
    },
    {
      tab: 'leaderboard',
      title: 'Props pool — Leaderboard',
      summary: 'Who has the most right so far, once questions start being graded.',
    },
    {
      tab: 'stats',
      title: 'Props pool — Stats',
      summary: 'How the pool answered each question, so you can see which ones split the room.',
    },
    {
      tab: 'admin',
      title: 'Props pool — Manage',
      summary: 'Your commissioner tools: edit the questions, the card price, and the pool settings.',
      audience: HOST,
    },
    {
      tab: 'grading',
      title: 'Props pool — Grading',
      summary:
        'Mark the correct answer for each question. Scores and the leaderboard follow from what you set here, so a correction here fixes them everywhere.',
      audience: HOST,
    },
    {
      tab: 'ai',
      title: 'Props pool — AI insights',
      summary: 'Written notes about the pool generated from its own answers. Available when the commissioner has turned it on.',
    },
  ],
});

const SQUARES_POOL_PAGES = poolPages({
  idPrefix: 'pool.squares',
  route: '/pool/:id',
  poolTypes: ['SQUARES'],
  rootTitle: 'Squares pool',
  rootSummary:
    'Your squares grid. Claim squares before kickoff; the row and column numbers are drawn once the grid is full or the commissioner locks it. Prizes follow the score at the end of each quarter.',
  tabs: [],
});

/**
 * `/admin/:id`. Squares is the only type with its own manager panel here —
 * every other type sends a commissioner to the dashboard's manager tab
 * (`AdminRoute.tsx`), which is why these pages are Squares-only.
 */
const SQUARES_ADMIN_PAGES = poolPages({
  idPrefix: 'admin.squares',
  route: '/admin/:id',
  poolTypes: ['SQUARES'],
  rootTitle: 'Squares — manage pool',
  rootSummary:
    'Your commissioner panel for a squares pool. The tabs cover the pool settings, the players and their payments, the game and its scores, the prize split, and the messages that go out.',
  tabs: [
    { tab: 'settings', title: 'Squares manage — Settings', summary: 'The pool name, the price per square, the entry cap, and how the numbers are drawn.', audience: HOST },
    { tab: 'reminders', title: 'Squares manage — Reminders', summary: 'Which automatic emails go out to your players, and when.', audience: HOST },
    { tab: 'players', title: 'Squares manage — Players', summary: 'Who has claimed which squares, what each owes, and what they have paid.', audience: HOST },
    { tab: 'scoring', title: 'Squares manage — Scoring', summary: 'The quarter scores the prizes are worked out from, and how to correct one.', audience: HOST },
    { tab: 'game', title: 'Squares manage — Game status', summary: 'Which game the grid covers and where it is up to. Locking the grid draws the numbers.', audience: HOST },
    { tab: 'payouts', title: 'Squares manage — Payouts', summary: 'How the pot is split across the quarters, and what each winning square is owed. You pay winners directly.', audience: HOST },
    { tab: 'communications', title: 'Squares manage — Communications', summary: 'Announcements and emails to everyone in the pool.', audience: HOST },
    { tab: 'stats', title: 'Squares manage — Statistics', summary: 'How the grid filled up and how the pool is performing.', audience: HOST },
    { tab: 'props', title: 'Squares manage — Side hustle', summary: 'Optional prop questions bolted onto a squares pool, for players who want more than the grid.', audience: HOST },
    { tab: 'grading', title: 'Squares manage — Grading', summary: 'Mark the correct answer for each side-hustle question.', audience: HOST },
  ],
});

export const POOL_PAGES: readonly HelpPage[] = [
  ...NFL_PAGES,
  ...PLAYOFF_PAGES,
  ...BRACKET_PAGES,
  ...PROPS_PAGES,
  ...SQUARES_POOL_PAGES,
  ...SQUARES_ADMIN_PAGES,
];
