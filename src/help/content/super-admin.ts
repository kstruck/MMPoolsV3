// Super-admin help content — PLAN-HELP-SYSTEM.md §6 K4, ticket T14.
//
// THIS FILE IS LOADED WITH `import()` AND ONLY FOR A SUPER ADMIN. The gate is
// `isSuperAdmin(user)` — the SAME predicate `App.tsx` uses to decide whether
// the `/super-admin` route renders at all, read through `src/help/admin.ts`,
// so the two can never disagree about who operational guidance is for.
//
// Nothing here is a secret: the rules and the admin actions are the authority
// on what an admin may do, and help copy changes none of it. It is split out
// because there is no reason to ship sixteen tabs of operational guidance to
// every member's phone.
//
// T2 SHIPPED THE MECHANISM, T14 SHIPS THE COPY.
//
// WHAT T14 WROTE, AND WHAT IT DELIBERATELY DID NOT. K4 scope ii is
// PAGE-LEVEL SUMMARIES ONLY: one `HelpPage` per admin tab saying what that tab
// is for. `ADMIN_TOPICS` and `ADMIN_PLACEMENTS` stay empty on purpose — a
// per-control topic for every admin button is a different ticket, and every
// one of these tabs can be summarised without one.
//
// WHY THE PAGES LIVE HERE RATHER THAN IN `src/help/pages.ts`. Putting them in
// the static `PAGES` list would defeat the split this file exists for: the
// summaries would ship in every reader's bundle. So the route-coverage guard
// in `tests/help-registry-invariants.test.ts` reads `PAGES` PLUS this list —
// the question it asks is whether the shipped content covers a route, and the
// admin chunk is shipped content. Adding a page here without removing its
// `ROUTE_ALLOWLIST` row therefore fails that test, which is what the earlier
// version of this comment claimed and, before T14, was not true of.
//
// SIXTEEN TABS, NOT SEVENTEEN. Counted in `SuperAdmin.tsx` `navStructure`
// (eight groups) and cross-checked against the `activeTab` union type beside
// it. The "seventeen" in the old `ROUTE_ALLOWLIST` row and in this file's
// earlier header was wrong. `tests/help-content-super-admin.test.ts` parses
// the tab ids out of the component rather than restating them, so a tab added
// tomorrow fails until it has a summary.
//
// K13: THE SUB-TABS ARE NOT LINKABLE. `SuperAdmin.tsx` keeps `activeTab` in
// memory and publishes it with `HelpRoutePublisher` rather than putting it in
// the URL, so there is no address that opens a given tab. Each tab page
// therefore declares `href: () => null` — listed, and opened in place when the
// reader is already on that tab. The route itself is linkable.

import type { Audience, HelpPage, HelpPlacement, HelpTopic } from '../types';

/** Every page here is admin-only. `/super-admin` renders for nobody else. */
const ADMIN: readonly Audience[] = ['admin'];

/** One row per `navStructure` sub-tab id, in the order the dashboard shows them. */
interface AdminTabSpec {
  /** The `activeTab` id, exactly as `SuperAdmin.tsx` publishes it. */
  tab: string;
  title: string;
  summary: string;
}

const SUPER_ADMIN_TABS: readonly AdminTabSpec[] = [
  {
    tab: 'overview',
    title: 'Overview: Dashboard',
    summary:
      'Three cards. The Platform Ledger totals prize volume, platform revenue and charity funds across every pool. The API Status Center shows the last health check — open alerts, failed webhooks, stale jobs. The Production Watchdog counts real activity over the last day.',
  },
  {
    tab: 'stats',
    title: 'Overview: Stats',
    summary:
      'Platform growth worked out from the pools and accounts already loaded here: the last 30 days, activity by hour of day, your peak hour and busiest month, twelve months of trends, and a split by pool type. Nothing on this tab changes anything.',
  },
  {
    tab: 'pools',
    title: 'Pools: All Pools',
    summary:
      'Every pool on the platform, searchable by name, id or owner and filterable by status, price and charity. A row opens the pool details, turns its premium features on or off, locks it, or closes it. Locking and closing change what members can do.',
  },
  {
    tab: 'tournament',
    title: 'Pools: Tournament',
    summary:
      'NCAA tournament data, one tournament and season at a time: imported teams, scheduled and final games, the last sync from ESPN, and the time entries lock. You can set that lock time and re-initialize a tournament skeleton. Re-initializing replaces the data that is there.',
  },
  {
    tab: 'playoffs',
    title: 'Pools: Playoffs',
    summary:
      'The global NFL playoff field every playoff pool reads: which teams are in, their seeds, and which are eliminated. Reset Default Teams fills the form with a fixed 2024-25 field, and nothing is stored until you press Save Global Config.',
  },
  {
    tab: 'props',
    title: 'Pools: Global Props',
    summary:
      'The platform-wide prop categories and seed questions kept for prop pools. Add or remove a category, and edit each seed question and its options. This is the shared list, not any one pool’s prop sheet.',
  },
  {
    tab: 'nfl',
    title: 'Pools: NFL Schedule',
    summary:
      'Two tools. The bulk importer pulls a season, or one week, of NFL games from ESPN. The spread manager below it holds the working line for each game and freezes a week. A week freezes once; after that a line changes only through the audited override.',
  },
  {
    tab: 'users',
    title: 'Members: Users',
    summary:
      'Every registered account, with filters for role and sign-in method and a search by email or name. From a row you can change someone’s role, email them, send a password reset, edit them, or delete them. Deleting an account cannot be undone.',
  },
  {
    tab: 'referrals',
    title: 'Members: Referrals',
    summary:
      'Who referred whom: the top referrers, the referral chain, and the totals worked out from the accounts on the Users tab. Nothing here is edited — it is a read of what has already happened.',
  },
  {
    tab: 'loyalty',
    title: 'Members: Loyalty Tiers',
    summary:
      'Define the loyalty tiers and the pool counts that earn them; saving stores them for the platform. The promo campaign creator beside them is a mock — pressing Execute shows a confirmation and sends nothing to anyone.',
  },
  {
    tab: 'operations',
    title: 'Operations',
    summary:
      'The one-off data actions: recalculations, roster and profile backfills, payment repairs, and the NFL spread freeze. Each card states what it would do before it runs, the ones that can lose or double-count data ask you to type a confirmation, and every run is audited.',
  },
  {
    tab: 'testing',
    title: 'Test Suite',
    summary:
      'Where simulation lives. Run the pre-defined test scenarios, open the Pool Simulation dashboard to drive a pool through a full lifecycle, or open the Tournament Simulator. Each run works on test pools and entries it creates for itself.',
  },
  {
    tab: 'billing',
    title: 'Monetization',
    summary:
      'What hosting a pool costs a commissioner: the free player limit, the grace period, price tiers per format, which features are included or cost an add-on, coupons, and per-pool overrides. Entry fees and prizes are not here — those move between players directly.',
  },
  {
    tab: 'themes',
    title: 'Themes',
    summary:
      'Create and edit the pool themes commissioners choose from: name, description, category, colours, grid styling, and a live preview. Only themes marked active are offered to a pool manager. Deleting a theme removes it from that list.',
  },
  {
    tab: 'system',
    title: 'System: System Status',
    summary:
      'The admin audit log — who ran what, and whether it succeeded — three counts of active, live and finished pools, and the system log with filters for status, tag, time window and free text. This tab reports; it changes nothing.',
  },
  {
    tab: 'settings',
    title: 'System: Settings',
    summary:
      'The platform switches: whether bracket pools can be created, maintenance mode, the live-score ticker speed (60 seconds by default), the daily auto-close sweep and whether it is still in dry-run, and which pool types can be created. Maintenance mode stops every member write.',
  },
];

const SUPER_ADMIN_ROOT: HelpPage = {
  id: 'super-admin',
  route: '/super-admin',
  title: 'Super Admin Dashboard',
  summary:
    'The platform control plane, in eight groups: Overview, Pools, Members, Operations, Test Suite, Monetization, Themes and System. Nobody below super admin reaches this screen. Pick a tab and the panel describes that tab.',
  // The ROUTE is linkable even though its tabs are not — this is the address
  // that opens the dashboard, and it lands on Overview.
  href: () => '/super-admin',
  poolTypes: 'all',
  audience: ADMIN,
};

const TOURNAMENT_SIM: HelpPage = {
  id: 'tournament-sim',
  route: '/tournament-sim',
  title: 'Tournament Simulator',
  summary:
    'A whole NCAA bracket pool run end to end on 2025 data. It creates a test pool, generates about fifty opponent entries plus known control entries, lets you fill your own bracket, then advances the tournament a round at a time so you can check scoring and standings.',
  href: () => '/tournament-sim',
  poolTypes: 'all',
  audience: ADMIN,
};

/**
 * The admin help pages: `/super-admin` and one page per tab, plus
 * `/tournament-sim`.
 *
 * The root page is listed FIRST and carries no `tab`, so it stays a candidate
 * whatever tab the reader is on and is the fallback when a tab has no page of
 * its own — `pageSpecificity` scores a tab page above it, so it never wins
 * against one. That is what keeps the panel useful if a tab is added before
 * its summary is.
 */
export const ADMIN_PAGES: readonly HelpPage[] = [
  SUPER_ADMIN_ROOT,
  ...SUPER_ADMIN_TABS.map(
    (spec): HelpPage => ({
      id: `super-admin.${spec.tab}`,
      route: '/super-admin',
      tab: spec.tab,
      title: spec.title,
      summary: spec.summary,
      // K13: no URL opens a given tab, so this page is listed and never linked.
      href: () => null,
      poolTypes: 'all',
      audience: ADMIN,
    }),
  ),
  TOURNAMENT_SIM,
];

/**
 * Per-control admin copy — out of scope for T14 (K4 scope ii is page-level
 * summaries only). Kept as exported empty lists because `src/help/admin.ts`
 * spreads all three, and a ticket that adds admin topics adds them here.
 */
export const ADMIN_TOPICS: readonly HelpTopic[] = [];
export const ADMIN_PLACEMENTS: readonly HelpPlacement[] = [];
