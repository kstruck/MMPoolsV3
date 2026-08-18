// Super-admin help content — PLAN-HELP-SYSTEM.md §6 K4, ticket T14.
//
// THIS FILE IS LOADED WITH `import()` AND ONLY FOR A SUPER ADMIN. The gate is
// `isSuperAdmin(user)` — the SAME predicate `App.tsx` uses to decide whether
// the `/super-admin` route renders at all, read through `src/help/admin.ts`,
// so the two can never disagree about who operational guidance is for.
//
// Nothing here is a secret: the rules and the callables are the authority on
// what an admin may do, and help copy changes none of it. It is split out
// because there is no reason to ship seventeen tabs of operational guidance to
// every member's phone.
//
// T2 SHIPS THE MECHANISM, T14 SHIPS THE COPY. The three lists are empty on
// purpose. `/super-admin` and `/tournament-sim` stay in `ROUTE_ALLOWLIST` with
// their T14 rows until that ticket writes the summaries; adding a page here
// without removing its allowlist row fails
// `tests/help-registry-invariants.test.ts`.

import type { HelpPage, HelpPlacement, HelpTopic } from '../types';

export const ADMIN_TOPICS: readonly HelpTopic[] = [];
export const ADMIN_PLACEMENTS: readonly HelpPlacement[] = [];
export const ADMIN_PAGES: readonly HelpPage[] = [];
