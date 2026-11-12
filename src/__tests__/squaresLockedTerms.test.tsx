// @vitest-environment jsdom
//
// WHY jsdom: what is under test is what the commissioner can still TOUCH on the
// squares manage page once the grid is locked — a property of the rendered
// controls, not of any function.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// The matchup step's schedule search reaches the app's Firebase setup; nothing
// here talks to it.
vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));

import { WizardStepRules } from '../components/admin/WizardStepRules';
import { WizardStepMatchup } from '../components/admin/WizardStepMatchup';
import type { GameState } from '../types';

/**
 * PLAN-SQUARES-SERVER-FIELDS §2d. firestore.rules refuses a squares
 * commissioner a change to the price, the number sets and the game once the
 * grid is locked. The page shows those controls read-only, with the reason,
 * rather than letting an edit fail on save — and leaves editable what the rules
 * still allow (the square limit, "show paid").
 */
afterEach(cleanup);

const isDisabled = (el: HTMLElement) => (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled;

const pool = (over: Partial<GameState> = {}) => ({
  id: 'p1', name: 'Thanksgiving', type: 'SQUARES', isLocked: false,
  costPerSquare: 10, maxSquaresPerPlayer: 0, numberSets: 1, showPaid: true,
  homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers', league: 'nfl',
  ...over,
}) as unknown as GameState;

const rules = (locked: boolean) =>
  render(<WizardStepRules gameState={pool({ isLocked: locked })} updateConfig={vi.fn()} locked={locked} />);
const matchup = (locked: boolean) =>
  render(<WizardStepMatchup gameState={pool({ isLocked: locked })} updateConfig={vi.fn()} onLinkGame={vi.fn(async () => true)} locked={locked} />);

describe('rules step', () => {
  it('unlocked: price and number sets are editable, and nothing says otherwise', () => {
    rules(false);
    const [price] = screen.getAllByRole('spinbutton');
    expect(isDisabled(price)).toBe(false);
    expect(isDisabled(screen.getAllByRole('combobox')[0])).toBe(false);
    expect(screen.queryByTestId('locked-terms-notice')).toBeNull();
  });

  it('locked: the price and the number sets are read-only, and the page says why', () => {
    rules(true);
    const [price, limit] = screen.getAllByRole('spinbutton');
    const [sets, showPaid] = screen.getAllByRole('combobox');
    expect(isDisabled(price)).toBe(true);
    expect(isDisabled(sets)).toBe(true);
    // Still the commissioner's: they decide nothing about what a square pays.
    expect(isDisabled(limit)).toBe(false);
    expect(isDisabled(showPaid)).toBe(false);
    expect(screen.getByTestId('locked-terms-notice').textContent).toMatch(/price per square and the number sets are fixed/i);
  });
});

describe('matchup step', () => {
  it('unlocked: the game can be found and changed', () => {
    matchup(false);
    expect(isDisabled(screen.getByRole('button', { name: /Find Game|Change Game/i }))).toBe(false);
    expect(screen.queryByTestId('locked-terms-notice')).toBeNull();
  });

  it('locked: the game cannot be changed, and the page says to reopen the grid first', () => {
    matchup(true);
    expect(isDisabled(screen.getByRole('button', { name: /Find Game|Change Game/i }))).toBe(true);
    expect(screen.getByTestId('locked-terms-notice').textContent).toMatch(/cannot be changed.*reopen the grid first/i);
  });
});
