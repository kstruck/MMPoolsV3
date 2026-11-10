import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * BOTH PICKERS LINK THE LEAGUE THE GAME WAS FOUND IN (qodo, PR #760).
 *
 * A game id means nothing without its league: the score feed is asked for
 * `(league, id)`. Both pickers used to store whatever their league dropdown
 * showed at the moment of the click, which need not be the league the list on
 * screen came from. The behaviour — every game carries its league, a changed
 * input clears the list, a stale answer is dropped — is tested on the service
 * and the hook. This holds the two call sites to USING it, which a test of
 * the hook cannot see, and `tests/e2e/squares-pool.spec.ts` drives the wizard
 * through a league switch in a real browser.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the game pickers link game.league', () => {
  it('the create wizard', () => {
    const step = read('src/components/wizard/create/StepSquaresGame.tsx');
    expect(step).toContain("set('league', g.league);");
    expect(step).not.toContain("set('league', league);");
  });

  it('the manage page', () => {
    const panel = read('src/components/AdminPanel.tsx');
    expect(panel).toContain('squaresGameLink(game, game.league,');
    const matchup = read('src/components/admin/WizardStepMatchup.tsx');
    expect(matchup).toContain('onLinkGame(game);');
    expect(matchup).not.toContain('onLinkGame(game, search.league)');
  });
});

/**
 * BOTH PICKERS ASK THE HOOK WHETHER A GAME HAS STARTED (qodo, PR #761).
 *
 * The hook answers from the server-corrected clock (tested on the rendered
 * hook). Each picker used to import `hasStarted` from the schedule service and
 * call it bare, which reads the device's clock. As above: this holds the call
 * sites to using the hook's, which a test of the hook cannot see.
 */
describe('the game pickers judge kickoff by the hook\'s clock', () => {
  const importsBare = /import\s*\{[^}]*\bhasStarted\b[^}]*\}\s*from\s*'[^']*services\/espnSchedule'/;

  it('the create wizard', () => {
    const step = read('src/components/wizard/create/StepSquaresGame.tsx');
    expect(step).not.toMatch(importsBare);
    expect(step).toMatch(/find: findGames, clear, hasStarted \} =\s*useScheduleSearch\(/);
    expect(step).toContain('const started = hasStarted(g);');
  });

  it('the manage page', () => {
    const matchup = read('src/components/admin/WizardStepMatchup.tsx');
    expect(matchup).not.toMatch(importsBare);
    expect(matchup).toContain('const started = search.hasStarted(game);');
  });
});

