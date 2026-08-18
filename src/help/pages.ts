// The Help page inventory — PLAN-HELP-SYSTEM.md §3 D1 / D3.
//
// A help "page" is what the panel summarises: a route, or a route plus a tab.
// `route` is the react-router pattern EXACTLY as written in `src/App.tsx`;
// `tests/help-registry-invariants.test.ts` reads App.tsx and fails on a route
// here that does not exist there, and on a route there that appears neither
// here nor in `ROUTE_ALLOWLIST`.
//
// T1 adds the seven `/create/*` wizard routes, because the registry refuses a
// topic nothing places and a placement needs a page. Every other route is
// still in `ROUTE_ALLOWLIST` with the ticket that will move it here — T2 for
// the pool surfaces, T3 for the site and account pages, T14 for the admin
// tabs. A route added to App.tsx tomorrow is in neither list and fails.
//
// Route MATCHING (which page the reader is on) is T2's job and deliberately
// not built here.

import type { HelpPage } from './types';
import { WIZARD_PAGES } from './content/wizard-pages';

export const PAGES: readonly HelpPage[] = [...WIZARD_PAGES];
