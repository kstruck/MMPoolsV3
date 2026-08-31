// The Help page inventory — PLAN-HELP-SYSTEM.md §3 D1 / D3.
//
// A help "page" is what the panel summarises: a route, or a route plus a tab.
// `route` is the react-router pattern EXACTLY as written in `src/App.tsx`;
// `tests/help-registry-invariants.test.ts` reads App.tsx and fails on a route
// here that does not exist there, and on a route there that appears neither
// here nor in `ROUTE_ALLOWLIST`.
//
// T1 added the seven `/create/*` wizard routes, because the registry refuses a
// topic nothing places and a placement needs a page. T2 adds a page per wizard
// STEP and the two pool routes with their tabs. What is left in
// `ROUTE_ALLOWLIST` is T3 (site and account pages) and T14 (the admin tabs). A
// route added to App.tsx tomorrow is in neither list and fails.
//
// Route MATCHING lives in `route-match.ts` (T2); ORDER matters here only as a
// tie-break between two pages of equal specificity, so the list reads
// wizards-then-pools rather than being sorted.

import type { HelpPage } from './types';
import { WIZARD_PAGES } from './content/wizard-pages';
import { POOL_PAGES } from './content/pool-pages';
import { SITE_PAGES } from './content/site-pages';

export const PAGES: readonly HelpPage[] = [...WIZARD_PAGES, ...POOL_PAGES, ...SITE_PAGES];
