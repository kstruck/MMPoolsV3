// The Help page inventory — PLAN-HELP-SYSTEM.md §3 D1 / D3.
//
// A help "page" is what the panel summarises: a route, or a route plus a tab.
// `route` is the react-router pattern EXACTLY as written in `src/App.tsx`;
// `tests/help-registry-invariants.test.ts` reads App.tsx and fails on a route
// here that does not exist there, and on a route there that appears neither
// here nor in `ROUTE_ALLOWLIST`.
//
// EMPTY IN T0, BY DESIGN. Every route currently sits in `ROUTE_ALLOWLIST` with
// the ticket that will move it here — T2 for the pool surfaces and wizards, T3
// for the site and account pages, T14 for the admin tabs. The guard is not a
// no-op meanwhile: a route added to App.tsx tomorrow is in neither list and
// fails.
//
// Route MATCHING (which page the reader is on) is T2's job and deliberately
// not built here — with no pages to match, it would be untested code.

import type { HelpPage } from './types';

export const PAGES: readonly HelpPage[] = [];
