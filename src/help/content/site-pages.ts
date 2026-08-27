// The site and account Help pages — PLAN-HELP-SYSTEM.md §3 D3 (T3).
//
// The twenty-one routes that are not a pool, not a create wizard and not an
// admin surface: the marketing landings, the legal pages, the two profiles,
// the scoreboard, My Entries, the pool picker and the invite screen. T3 takes
// their rows out of `ROUTE_ALLOWLIST`.
//
// WHAT THESE PAGES CARRY. A summary per screen — what it is for and what you
// can do there — and no topics. There is no option to explain on a marketing
// page or a privacy policy, and the settings the product pages describe are
// explained by the topics on the surface that actually edits them (voice rule
// 10: a sentence explaining what a setting means exists in exactly one place).
// A page with no topics is valid content; the panel renders the summary, the
// glossary and "All pages".
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO MECHANICAL RULES THESE PAGES ALL OBEY, AND WHY.
//
// 1. `poolTypes: 'all'`, always. `scopeIncludesPoolType` gives a reader with no
//    pool in scope ONLY the type-agnostic entries (`visibility.ts`), and no
//    site route publishes a pool type — `HelpScopeProvider` lives on the pool
//    and wizard surfaces. A site page named for a pool type would be a search
//    result that can never be opened from the page it describes.
//
// 2. `audience: ['member']`, always — INCLUDING the commissioner-facing ones.
//    On these routes nothing publishes an audience, so `useHelpPanelState`
//    falls back to `defaultAudience`, which is `member` for everyone who is not
//    a super-admin (`HelpPanel.tsx:56`). `AUDIENCE_SEES.member` is `['member']`,
//    so a page scoped `['commissioner']` here would be invisible to the very
//    commissioner reading it. The pool picker, the pricing page and the
//    Commissioner Hub tab are therefore member-scoped pages whose COPY says who
//    the screen is for, rather than pages scoped to a reader the panel cannot
//    identify. This is the wider-scope-than-placement defect in its other
//    direction, and `tests/help-content-site.test.ts` pins it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHICH PAGES ARE LINKABLE, AND WHY THE REST ARE NOT.
//
// `href` is how "All pages" and a search result NAVIGATE (see `HelpPage.href`).
// FIVE reasons a page here returns `null` instead of a path, each measured:
//
//   THE ROUTE TURNS A SIGNED-OUT READER AWAY — `/profile`, `/participant` and
//   `/create-pool`. All three are wrapped in `App.tsx` as
//   `user ? <Screen/> : <Navigate to="/" replace/>` (`App.tsx:396-404`,
//   `:416-422`, `:485-498`; the pool picker also needs
//   `canAccessPoolCreation`, `utils/auth.ts:89-91`), so a static path here is a
//   button that lands a logged-out visitor on Home instead of the screen the
//   panel just described (codex R1 P2 ×2).
//
//   🛑 AND `HelpRouteContext` CANNOT SAY WHETHER THE READER IS SIGNED IN. There
//   is no auth axis on it: `useHelpPanel.ts:127-148` builds the context from
//   `pathname`, `search` and the publishers, and `HelpProvider` is handed
//   `isAdmin` and nothing else (`HelpPanel.tsx:47`). `audience` is a different
//   question — it says WHICH READER, not whether there is one, and every site
//   route resolves it to `member` for signed-out and signed-in alike (rule 2
//   above). So this file cannot ask, and does not pretend to: it declines the
//   cross-route link rather than guessing. The gap is real and is reported
//   rather than papered over — closing it means an `isSignedIn` on
//   `HelpRouteContext`, threaded `App.tsx → HelpProvider → useHelpPanelState`,
//   which is T2 machinery and not this content ticket's to add.
//
//   The `/participant` TAB pages keep their links, but only FROM
//   `/participant` (`tabHref` below). Standing on that route is proof the
//   reader is signed in — the redirect above is what makes it proof — and a
//   `?tab=` switch is only useful from the surface that has the tabs anyway.
//   Anywhere else they are listed and not linked, exactly like the ones below.
//
//   NO ID TO BUILD A URL FROM — `/profile/:uid` and `/join/:poolId`. This file
//   cannot know a player id or a pool id, and `HelpRouteContext.routeParams` is
//   never populated by the live panel (`useHelpPanel.ts` builds the context
//   from `pathname`, `search` and the publishers, and sets no route params). A
//   link built from anything else would be a URL for someone else's screen.
//   `canOpenPage` then falls through to `onCurrentRoute`, so the page opens in
//   place when the reader is already on it — the same answer `pool-pages.ts`
//   reaches for the same reason (codex R12).
//
//   NO HEADER, SO NO BUTTON — `/payment-success`. It renders no `Header`, so it
//   renders no `HelpHeaderButton`, so the `?` shortcut is the only way in
//   (`HelpHeaderButton.tsx` names this file as the case). Linking a reader to a
//   confirmation screen from anywhere else would land them on a stale receipt,
//   so the page is listed, opens in place, and is honest about it in its copy.
//
//   THE TAB IS ONLY IN MEMORY — the three `/scoreboard` tabs. `Scoreboard.tsx`
//   holds its tab in `useState` and never reads `?tab=`, so `/scoreboard?tab=
//   college` would render the NFL tab and the link would lie.
//
// Everything else is a static path. The `/participant` tab links work at all
// only because that surface DOES read `?tab=` on mount and adopts a valid
// value (`ParticipantDashboard.tsx:71-75`), so `/participant?tab=live` really
// does land on Live Pools rather than on Empire Overview.

import type { Audience, HelpPage, HelpRouteContext, PoolTypeScope } from '../types';

/** See rule 2 in the header comment. Not a shortcut — a decision. */
const SITE_AUDIENCE: readonly Audience[] = ['member'];
/** See rule 1 in the header comment. */
const SITE_POOL_TYPES: PoolTypeScope = 'all';

interface SiteSpec {
  id: string;
  route: string;
  title: string;
  summary: string;
  /**
   * Omitted means "link to `route`"; `null` means deliberately unlinkable;
   * `{ fromOwnRouteOnly }` means the link is offered ONLY to a reader already
   * standing on `route` — see the signed-out reason in the header comment.
   */
  href?: string | null | { fromOwnRouteOnly: string };
}

/**
 * The `href` this spec resolves to, in the three shapes `SiteSpec.href` allows.
 *
 * The third shape compares `ctx.pathname` to `spec.route` EXACTLY rather than
 * matching the pattern. It is only ever used for `/participant`, a literal path
 * with no parameters — the two routes that do have parameters (`/profile/:uid`,
 * `/join/:poolId`) are unlinkable for the different reason above and never take
 * this branch. `tests/help-content-site.test.ts` fails if a spec with a
 * parameterised route ever asks for it, which is the guard against this
 * shortcut being copied somewhere it does not hold.
 */
function hrefFor(spec: SiteSpec): (ctx: HelpRouteContext) => string | null {
  if (spec.href === undefined) return () => spec.route;
  if (spec.href === null) return () => null;
  if (typeof spec.href === 'string') {
    const target = spec.href;
    return () => target;
  }
  const target = spec.href.fromOwnRouteOnly;
  return (ctx) => (ctx.pathname === spec.route ? target : null);
}

function page(spec: SiteSpec): HelpPage {
  return {
    id: spec.id,
    route: spec.route,
    href: hrefFor(spec),
    title: spec.title,
    summary: spec.summary,
    poolTypes: SITE_POOL_TYPES,
    audience: SITE_AUDIENCE,
  };
}

/** A page for one in-memory or query-string tab of a site surface. */
function tabPage(spec: SiteSpec & { tab: string }): HelpPage {
  return { ...page(spec), tab: spec.tab };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketing and the public site.

const MARKETING_PAGES: readonly HelpPage[] = [
  page({
    id: 'site.home',
    route: '/',
    title: 'Home',
    summary:
      'The front page. It says what a pool here is, shows the running totals for prizes awarded and money raised for charity, answers the questions people ask before starting one, and gives you two ways on: start a pool, or browse the public ones.',
  }),
  page({
    id: 'site.squares',
    route: '/gameday-squares',
    title: 'Gameday Squares',
    summary:
      'A description of squares pools: a ten-by-ten grid on one game, with the winner read off the score. It is a page about the format rather than a place to set anything up — the buttons on it take you to the pool picker.',
  }),
  page({
    id: 'site.march-madness',
    route: '/march-madness',
    title: 'March Madness brackets',
    summary:
      'A description of bracket pools for the college basketball tournament — what they are and how they score. Brackets are out of season, so the pool picker lists them as closed and you cannot start one from here at the moment.',
  }),
  page({
    id: 'site.nfl-playoffs',
    route: '/nfl-playoffs',
    title: 'NFL playoff pools',
    summary:
      'A description of playoff and Super Bowl pools — what they are and how they score. The Playoff Challenge is listed as upcoming on the pool picker rather than open, so you cannot start one from here at the moment.',
  }),
  page({
    id: 'site.features',
    route: '/features',
    title: 'Features',
    summary:
      'A tour of what the site does: the live grid, the scoreboard, the standings simulators, the AI commissioner and the record of every change. It describes the product; each setting it mentions is changed inside the pool that uses it.',
  }),
  page({
    id: 'site.about',
    route: '/about',
    title: 'About March Melee Pools',
    summary:
      'What this site is for and what it is built out of. It sets out the aim — pools run by their own commissioners — and describes the parts behind that: live scoring, the standings simulators, the AI commissioner and the audit trail.',
  }),
  page({
    id: 'site.charity',
    route: '/charity',
    title: 'Charity and fundraising',
    summary:
      'A short page about running a pool as a fundraiser. It says you can direct a share of the pot to a cause you choose and that players are shown the percentage. Nothing is set here; the charity share belongs to the pool payout setup.',
  }),
  page({
    id: 'site.how-it-works',
    route: '/how-it-works',
    title: 'How it works',
    summary:
      'The guide to each pool format. Choose a format, then one of four views: How it Works, Strategy Guide, FAQs & Rules, and Contact Support. Rules questions are answered under FAQs & Rules on that page rather than repeated here.',
  }),
  page({
    id: 'site.odds.super-bowl-squares',
    route: '/odds/super-bowl-squares',
    title: 'Super Bowl squares odds',
    summary:
      'An article on which squares numbers come up most. It works through how football scoring shapes the last digit, names the strongest and weakest numbers and the best pairs to hold, and adds notes per quarter. Reading it changes no pool.',
  }),
  page({
    id: 'site.browse',
    route: '/browse',
    title: 'Browse public pools',
    summary:
      'The pools whose hosts listed them publicly, so you can find one to join. It opens on the pools still taking players. Filter by format, league, entry-fee band and status, or narrow to pools raising money for a charity, and search by name.',
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Money and the legal pages.

const MONEY_AND_LEGAL_PAGES: readonly HelpPage[] = [
  page({
    id: 'site.pricing',
    route: '/pricing',
    title: 'Pricing',
    summary:
      'What it costs YOU to host a pool. This is separate from entry fees, which move between you and your players and are never held here. Every pool starts on a 14-day trial, small pools host free, and the page shows the current player limit.',
  }),
  page({
    id: 'site.payment-success',
    route: '/payment-success',
    // Shortcut-only: no `Header`, so no Help button, and nothing should link
    // a reader to somebody else's receipt. See the header comment.
    href: null,
    title: 'Payment confirmed',
    summary:
      'Where you land after paying to host. It confirms the payment and gives you one way onward — to the pool you paid for, or to your dashboard when you bought pool credits. This screen has no header, so Help opens here only with the ? key.',
  }),
  page({
    id: 'site.privacy',
    route: '/privacy',
    title: 'Privacy Policy',
    summary:
      'The privacy policy: what the site collects, what it is used for, who it is shared with, how long it is kept and what you can ask for. It includes the section saying your details are never sold, and the one covering Google sign-in.',
  }),
  page({
    id: 'site.terms',
    route: '/terms',
    title: 'Terms of Service',
    summary:
      'The terms you accept when you create a pool or join one: what you may do with the site, what you are responsible for, the position on gambling, and the text-message rules, including how to stop texts.',
  }),
  page({
    id: 'site.contact',
    route: '/contact',
    title: 'Contact',
    summary:
      'The form for writing to the people who run the site. Give your name and email, choose a subject and write your message; a copy goes back to the address you enter. The page also lists the other ways to reach them.',
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Starting and joining a pool.

const POOL_ENTRY_PAGES: readonly HelpPage[] = [
  page({
    id: 'site.create-pool',
    route: '/create-pool',
    // Signed-in only, and this file cannot tell; see the header comment.
    href: null,
    title: 'Choose your game',
    summary:
      'The pool picker, and the first screen of hosting one. Four formats start now — Weekly Pick’em, Survivor Pool, Margin Pool and Gameday Squares — with Side Hustle props below them. Brackets and the Playoff Challenge are shown out of season.',
  }),
  page({
    id: 'site.join',
    route: '/join/:poolId',
    // No pool id to build a URL from; see the header comment.
    href: null,
    title: 'Join a pool',
    summary:
      'The invite screen. Before you accept you can read the entry fee, how many have joined, the format and the prize split. Accepting takes no payment: the entry fee goes straight to whoever runs the pool, and they record that you paid.',
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Your account.

/**
 * The tabs of My Entries, keyed by the id the surface publishes.
 *
 * `ParticipantDashboard` holds its tab in `useState` AND adopts a valid `?tab=`
 * on mount, so these are the one set of in-memory tabs on the site that a link
 * really can reach. `tests/help-content-site.test.ts` parses the tab ids out of
 * that component and fails when one has no page here — a tab added tomorrow is
 * a screen with no summary until somebody writes one.
 */
const ENTRIES_TABS: readonly (SiteSpec & { tab: string })[] = [
  {
    tab: 'insights',
    id: 'account.entries.insights',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=insights' },
    title: 'My Entries — Empire Overview',
    summary:
      'The tab the page opens on. A banner for picks about to lock, your winnings plotted by month, and how your pools split across the formats you play. It is a read-only view — the pools themselves are on the other tabs.',
  },
  {
    tab: 'entries',
    id: 'account.entries.entries',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=entries' },
    title: 'My Entries — pools you play in',
    summary:
      'The pools you are a member of, whoever runs them. NFL pools you have not picked in yet carry a picks-due badge and sort to the top, so the pools waiting on you are the ones you see first.',
  },
  {
    tab: 'commissioner',
    id: 'account.entries.commissioner',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=commissioner' },
    title: 'My Entries — Commissioner Hub',
    summary:
      'Every pool you own or co-run, gathered in one place to manage rather than to play in. The tab appears only once you own or co-run at least one pool; with none, the strip has no Commissioner Hub on it.',
  },
  {
    tab: 'live',
    id: 'account.entries.live',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=live' },
    title: 'My Entries — Live Pools',
    summary:
      'Your pools that have locked and are being played, but have not finished. A pool moves here the moment picks close and leaves it when the last game is final.',
  },
  {
    tab: 'open',
    id: 'account.entries.open',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=open' },
    title: 'My Entries — Open',
    summary:
      'Your pools that have not locked yet. These are the ones you can still change something in — picks, an invite, a setting if you run it.',
  },
  {
    tab: 'completed',
    id: 'account.entries.completed',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=completed' },
    title: 'My Entries — Completed',
    summary: 'Your pools whose games are over. They stay here so you can go back and read the final standings.',
  },
  {
    tab: 'all',
    id: 'account.entries.all',
    route: '/participant',
    href: { fromOwnRouteOnly: '/participant?tab=all' },
    title: 'My Entries — All Pools',
    summary: 'Everything of yours in one list, whatever state it is in and whether you play in it or run it.',
  },
];

/**
 * The tabs of the scoreboard.
 *
 * Unlinkable: `Scoreboard.tsx` keeps its tab in `useState` and reads no query
 * parameter, so a link naming one would land the reader on the NFL tab instead.
 */
const SCOREBOARD_TABS: readonly (SiteSpec & { tab: string })[] = [
  {
    tab: 'nfl',
    id: 'site.scoreboard.nfl',
    route: '/scoreboard',
    href: null,
    title: 'Scoreboard — NFL',
    summary:
      'The tab the page opens on. Every NFL game from the past week and the week ahead, split into live, completed and upcoming.',
  },
  {
    tab: 'college',
    id: 'site.scoreboard.college',
    route: '/scoreboard',
    href: null,
    title: 'Scoreboard — College Football',
    summary:
      'College football over the same window as the NFL tab and in the same three groups: live, completed and upcoming.',
  },
  {
    tab: 'basketball',
    id: 'site.scoreboard.basketball',
    route: '/scoreboard',
    href: null,
    title: 'Scoreboard — NCAA Basketball',
    summary:
      'Men’s college basketball from the tournament group. Every game in progress is shown; completed and upcoming games appear when a top-25 team is playing, so this tab is shorter than the other two.',
  },
];

const ACCOUNT_PAGES: readonly HelpPage[] = [
  page({
    id: 'account.profile',
    route: '/profile',
    // Signed-in only, and this file cannot tell; see the header comment. There
    // is no same-route link worth keeping either — the tab pages below have one
    // because a `?tab=` switch does something; a link from `/profile` to
    // `/profile` does not.
    href: null,
    title: 'Your profile',
    summary:
      'Your own account, and the only place you edit it. Three sections save together: Basic Information, Payment Info — the handles that fill themselves in when you create a pool — and Social Links. Your season history sits above them.',
  }),
  page({
    id: 'account.player-profile',
    // A DIFFERENT SCREEN from `/profile`, not a second route onto it, so this
    // is a page of its own rather than an `altRoutes` entry on `account.profile`:
    // `App.tsx:396` renders `UserProfile` and `App.tsx:435` renders
    // `PlayerProfile`, and nothing is editable on this one.
    route: '/profile/:uid',
    // No player id to build a URL from; see the header comment.
    href: null,
    title: 'A player’s public profile',
    summary:
      'Another player’s record, as anyone with the link sees it: accuracy, points, pools entered, and how they compare with the site average. Four tabs — Stats, Weekly Records, Pick History and Achievements.',
  }),
  page({
    id: 'account.entries',
    route: '/participant',
    // Signed-in only, and this file cannot tell; see the header comment. Same
    // as `/profile`: the tab pages keep a from-own-route link because switching
    // tab is a real destination, and this one has none to offer.
    href: null,
    title: 'My Entries',
    summary:
      'Every pool you play in or run, with your lifetime pools, entries, wins and net winnings across the top. The tabs sort them, and the page opens on Empire Overview. Searching filters whichever tab you are on.',
  }),
  ...ENTRIES_TABS.map(tabPage),
  page({
    id: 'site.scoreboard',
    route: '/scoreboard',
    title: 'Scoreboard',
    summary:
      'Scores from around the leagues, not from your pools. Three tabs — NFL, College Football and NCAA Basketball — each split into live, completed and upcoming. It opens on NFL and refreshes every 30 seconds until you switch that off.',
  }),
  ...SCOREBOARD_TABS.map(tabPage),
];

/**
 * ORDER IS THE TIE-BREAK between two pages of equal specificity
 * (`resolveHelpPage`), so a route's tab-less page must come BEFORE its tab
 * pages only in readability terms — the tab pages score higher and win on
 * their own tab regardless. The grouping below is for the reader of this file.
 */
export const SITE_PAGES: readonly HelpPage[] = [
  ...MARKETING_PAGES,
  ...MONEY_AND_LEGAL_PAGES,
  ...POOL_ENTRY_PAGES,
  ...ACCOUNT_PAGES,
];
