import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Route chrome invariants — every public page renders the site's Header/Footer.
 *
 * WHY THIS EXISTS. `/profile/:uid` — the PUBLIC player profile, the URL a member
 * shares — rendered `<PlayerProfile />` bare: no nav, no footer, on the one page
 * most likely to be seen by someone who is not logged in. Every sibling route in
 * App.tsx supplies chrome, either by wrapping the element (`/profile`,
 * `/odds/super-bowl-squares`, the whole `/create/*` family) or by handing the
 * page `user` + auth callbacks so it renders Header itself (`/pricing`,
 * `/about`, `/browse`). The public profile did neither, and nothing failed.
 *
 * Reported by Kevin from production, 2026-07-22.
 *
 * SOURCE-LEVEL, in the idiom of admin-surface-invariants.test.ts. This repo has
 * no jsdom and no @testing-library/react — verified, not assumed — so a render
 * test is not available here. That is a real limit and it is stated rather than
 * papered over: this proves the WIRING is present in App.tsx, not that the
 * header paints. A route that imports Header and renders it conditionally to
 * nothing would still pass.
 *
 * The narrow scope is deliberate too. A blanket "every Route has Header" check
 * would be wrong — redirects, `/payment-success`, and the dev-only preview
 * routes legitimately have no chrome, and pages that render their own Header
 * internally would need an allowlist that rots. So this pins the specific route
 * that broke plus the two nearest structural siblings, which is what a
 * regression here would actually look like.
 */

const root = resolve(__dirname, '..');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');

/** The JSX for one `<Route path="..." ...>` element, by bracket matching. */
function routeElement(path: string): string {
  const marker = `<Route path="${path}"`;
  const start = app.indexOf(marker);
  if (start === -1) return '';
  // Walk to the end of this Route element: either a self-closing `/>` at depth
  // 0 of nested `<`, or the matching `</Route>`. Every route in this file is
  // self-closing, so track angle-bracket depth and stop at the first `/>` that
  // closes the Route itself.
  let depth = 0;
  for (let i = start; i < app.length; i++) {
    if (app[i] === '<') depth++;
    else if (app[i] === '>') {
      // Skip the `>` of an arrow function. Route elements carry inline handlers
      // like `onUpdate={(u) => setUser(u)}`, and counting that `>` as a closing
      // bracket truncates the element early — which it did on the first run of
      // this file, silently dropping `<Footer />` from /profile and failing a
      // route that was in fact correct.
      if (app[i - 1] === '=') continue;
      depth--;
      if (depth === 0) return app.slice(start, i + 1);
    }
  }
  return app.slice(start);
}

describe('the scanner can find the routes it checks', () => {
  // Without this, a renamed route makes every assertion below vacuously pass.
  it.each(['/profile/:uid', '/profile', '/odds/super-bowl-squares'])(
    'route %s exists in App.tsx',
    (path) => {
      expect(routeElement(path), `no <Route path="${path}"> in App.tsx`).not.toBe('');
    },
  );
});

describe('public pages render site chrome', () => {
  it('the PUBLIC player profile wraps PlayerProfile in Header and Footer', () => {
    // The regression Kevin hit: this route shipped as `element={<PlayerProfile />}`.
    const el = routeElement('/profile/:uid');
    expect(el).toContain('<PlayerProfile />');
    expect(el, '/profile/:uid renders no <Header> — the shared public URL would have no nav').toContain('<Header');
    expect(el, '/profile/:uid renders no <Footer>').toContain('<Footer />');
  });

  it('passes the viewer through to Header, so a logged-out visitor is handled', () => {
    // Header takes `user: User | null`. Hardcoding a user or omitting the prop
    // would break exactly the case a shared profile link exists for.
    expect(routeElement('/profile/:uid')).toContain('user={user}');
  });

  it.each([
    ['/profile', 'the signed-in own-profile page'],
    ['/odds/super-bowl-squares', 'the public odds article'],
  ])('%s (%s) still has chrome', (path) => {
    const el = routeElement(path);
    expect(el).toContain('<Header');
    expect(el).toContain('<Footer />');
  });
});
