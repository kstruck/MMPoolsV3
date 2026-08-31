import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PUBLIC POOLS IS A TOP-LEVEL DESTINATION (Kevin, 2026-08-31).
 *
 * *"Move the Public Pools on the main menu out from under Explore and make it
 * its own main menu item."*
 *
 * The asymmetry this fixes: a signed-OUT visitor already got Public Pools as a
 * flat link, while the signed-IN nav buried it behind the Explore disclosure.
 * So the one destination that grows the platform — browsing open pools to join
 * — got HARDER to reach the moment somebody signed up.
 *
 * The header's own doc comment states three rules for this nav. The one at risk
 * here is "a disclosure must earn its click": a menu holding one item is pure
 * cost, and Explore "never has fewer than three". Removing Public Pools leaves
 * How it Works / Features / Pricing — exactly three — so the rule still holds.
 * That is asserted below rather than assumed, because the next promotion out of
 * Explore is the one that breaks it.
 */

const src = readFileSync(resolve(__dirname, '..', 'src/components/Header.tsx'), 'utf8');

/** The signed-in desktop branch: everything after the `) : (` that follows the signed-out nav. */
const signedInNav = (() => {
  const start = src.indexOf("{canManage ? (");
  const end = src.indexOf('{/* Right cluster: actions, not destinations. */}', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
})();

describe('Public Pools sits at the top level of the main menu', () => {
  it('renders as a flat NavLink for a signed-in user, not a menu item', () => {
    expect(signedInNav).toContain(
      `<NavLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')}>`,
    );
    // Bare label, matching how the signed-OUT nav renders the same link. The
    // header exists because it once wrapped onto a second row on a laptop, so a
    // new top-level item takes the narrower of two shapes that both work.
    expect(signedInNav).not.toContain('<Compass size={14} /> Public Pools');
    // The old shape: an item INSIDE the Explore disclosure.
    expect(signedInNav).not.toContain('to="/browse"\n                                        active=');
  });

  it('is no longer one of the Explore disclosure’s destinations', () => {
    // Explore's active-state predicate is the honest list of what it holds.
    expect(signedInNav).toContain(
      `<NavMenu label="Explore" active={isAnyActive('/how-it-works', '/features', '/pricing')}>`,
    );
    expect(signedInNav).not.toContain(`isAnyActive('/browse'`);
  });

  /**
   * 🛑 THE RULE THE HEADER DOC STATES, MEASURED.
   *
   * "A disclosure must earn its click… the Explore group never has fewer than
   * three." If a future change promotes another item out, this fails — which is
   * the point at which Explore should stop being a menu at all.
   */
  it('leaves Explore with three destinations, so it still earns its click', () => {
    const from = signedInNav.indexOf('<NavMenu label="Explore"');
    const to = signedInNav.indexOf('</NavMenu>', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const explore = signedInNav.slice(from, to);
    const items = explore.match(/<NavMenuItem/g) ?? [];
    expect(items).toHaveLength(3);
    for (const route of ['/how-it-works', '/features', '/pricing']) {
      expect(explore, route).toContain(`to="${route}"`);
    }
    expect(explore).not.toContain('/browse');
  });

  /**
   * GROUP, DO NOT RENAME — the header's first rule. `src/help/glossary.ts` and
   * the Help topics tell readers where controls live by name, so a relabel here
   * would silently falsify them.
   */
  it('keeps the exact label, so the Help copy that names it stays true', () => {
    expect(signedInNav).toContain('Public Pools');
    expect(signedInNav).not.toMatch(/Browse Pools|Open Pools|Find a Pool/);
  });

  /**
   * WIDTH — WHAT IS AND IS NOT ESTABLISHED HERE (codex r1).
   *
   * The header redesign exists because thirteen controls wrapped onto a second
   * row on a laptop, so adding one back at `lg` deserves scrutiny. codex raised
   * exactly that.
   *
   * ⚠️ THIS IS NOT A PIXEL MEASUREMENT. The dev server cannot render without
   * Firebase credentials, so the layout was not measured at 1024px. What IS
   * established: the signed-in nav renders FOUR top-level controls, the same
   * number the signed-OUT nav already ships at the same breakpoint in
   * production today. The new link is also rendered bare (no icon), matching
   * the signed-out treatment of the identical destination.
   *
   * A source COUNT would over-report signed-in as five: `My Pools` and
   * `My Entries` are two branches of one ternary and only ever one renders. So
   * this asserts the DESTINATION SET instead, which does not need that caveat.
   */
  it('renders exactly four top-level destinations for a signed-in user', () => {
    const topLevelRoutes = [...signedInNav.matchAll(/<NavLink\s+to="([^"]+)"/g)].map(m => m[1]);
    // The ternary pair collapses to one slot at runtime.
    const slots = new Set(topLevelRoutes.map(r => r.split('?')[0]));
    expect(slots).toEqual(new Set(['/participant', '/scoreboard', '/browse']));
    // ...plus the Explore disclosure = four controls.
    expect((signedInNav.match(/<NavMenu(?!Item)/g) ?? [])).toHaveLength(2); // My Pools + Explore
  });

  it('a signed-out visitor still reaches it directly, as they always did', () => {
    const signedOut = src.slice(0, src.indexOf('{canManage ? ('));
    expect(signedOut).toContain(`<NavLink to="/browse"`);
    expect(signedOut).toContain('Public Pools');
  });

  it('the mobile drawer still lists it as one tap, no accordion', () => {
    // The drawer was already flat; this pins that the promotion did not
    // accidentally nest it.
    expect(src).toContain(`<DrawerLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')} icon={<Compass size={16} />}>`);
  });

  it('the header’s own design note describes the nav it now renders', () => {
    // The comment is load-bearing documentation for the next person; it named
    // "browse" as an Explore destination and would have been a lie.
    const doc = src.slice(0, src.indexOf('interface HeaderProps'));
    expect(doc).toContain('Public Pools flat');
    expect(doc).not.toContain('(disclosure: browse / how it works / pricing)');
  });
});
