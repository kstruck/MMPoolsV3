import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 2026-08-23 pool-home polish (Kevin + tester feedback):
 *  - Standings & Results moves to the right of Pool Home — "arguably the most
 *    important tab".
 *  - The header week dropdown dies; the week checklist chips are the one
 *    selector for the same URL param.
 *  - The pool-card identity (type chip + option labels) and an at-a-glance
 *    row (players / week leader / season leader) join the pool header card.
 *  - The card type chip stops inking itself with the theme text token, which
 *    rendered white-on-cream in dark mode.
 *
 * Source greps, house style: they catch reintroductions a behavior test
 * updated to match would miss.
 */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const dash = () => read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
const cards = () => read('src/components/ParticipantDashboard.tsx');

describe('the tab strip leads with the tabs people hunt for', () => {
  it('Standings & Results sits directly right of Pool Home', () => {
    const src = dash();
    const home = src.indexOf("{ tab: 'dashboard', label: 'Pool Home' }");
    const standings = src.indexOf("{ tab: 'standings', label: 'Standings & Results' }");
    const picks = src.indexOf("{ tab: 'picks', label: 'My Entry' }");
    expect(home).toBeGreaterThan(-1);
    expect(standings).toBeGreaterThan(home);
    expect(standings).toBeLessThan(picks);
  });
});

describe('one week selector, not two', () => {
  it('the header week dropdown is gone', () => {
    // The checklist chips drive ?week= now. A <select> reappearing in this
    // file is the duplicate control coming back.
    expect(dash()).not.toContain('<select');
  });
});

describe('the at-a-glance strip', () => {
  it('exists on the header card', () => {
    expect(dash()).toContain('data-testid="pool-home-glance"');
  });

  it('shows the same identity chips the My Entries card shows', () => {
    const src = dash();
    expect(src).toContain('data-testid="pool-home-type"');
    expect(src).toContain('poolTypeLabel(castPool)');
    expect(src).toContain('poolOptionLabels(castPool)');
  });

  it('week leader prefers the recap winner line — the scored truth', () => {
    expect(dash()).toContain('recap?.weeklyWinners');
  });

  it('an unscored pool crowns nobody', () => {
    // Everyone "ties" at zero before scoring; the strip must dash, not pick
    // an arbitrary first name.
    expect(dash()).toContain('anyScored ? label(seasonLeaders) : null');
  });

  it('the participant count reads the world-readable roster signal', () => {
    // `members` needs a read non-members are denied; participantIds is the
    // server-owned field every visitor can see.
    expect(dash()).toContain('castPool.participantIds.length');
  });
});

describe('the type chip is readable in both themes', () => {
  it('never inks a fixed-light chip with the theme text token', () => {
    // bg-cream is a fixed light colour; var(--text) flips near-white in dark
    // mode — the white-on-white chip Kevin screenshotted on 2026-08-23.
    expect(cards()).not.toContain('bg-cream text-[color:var(--text)]');
    expect(dash()).not.toContain('bg-cream text-[color:var(--text)]');
  });
});
