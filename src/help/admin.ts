// The admin help chunk — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// A second registry, built from the same static content PLUS the lazily
// imported admin content, and used by the panel only once the chunk resolves.
// Building a whole registry rather than patching the live one is deliberate:
// `buildRegistry` is where every content rule is enforced, so admin content
// gets the same validation as everything else instead of a second, weaker path
// into the same maps. The input is a few hundred frozen objects — cheap enough
// that the alternative is not worth its risk.

import { buildRegistry, helpRegistry, type Registry } from './registry';
import { PAGES } from './pages';
import { GLOSSARY } from './glossary';
import { PLACEMENTS, TOPICS } from './content';

let cached: Promise<Registry> | null = null;

/**
 * Load the admin content and return a registry that includes it.
 *
 * Memoised: the panel opens and closes many times per session and the chunk is
 * fetched once. Failure is NOT cached — a chunk that failed to load on a flaky
 * connection should be retried the next time the panel opens, and a caller
 * that gets a rejection falls back to `helpRegistry`, which is complete for
 * everyone except an admin reading admin-only copy.
 */
export function loadAdminRegistry(): Promise<Registry> {
  if (!cached) {
    cached = import('./content/super-admin')
      .then((mod) =>
        buildRegistry({
          topics: [...TOPICS, ...mod.ADMIN_TOPICS],
          placements: [...PLACEMENTS, ...mod.ADMIN_PLACEMENTS],
          pages: [...PAGES, ...mod.ADMIN_PAGES],
          glossary: GLOSSARY,
        }),
      )
      .catch((error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** The registry every non-admin reader gets, and the fallback when a load fails. */
export const baseRegistry: Registry = helpRegistry;

/** Test-only: forget the memoised chunk so a spec can observe a fresh load. */
export function __resetAdminRegistry(): void {
  cached = null;
}
