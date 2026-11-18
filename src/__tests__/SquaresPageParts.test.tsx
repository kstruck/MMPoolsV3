// @vitest-environment jsdom
//
// Squares pool page, BOARD FIRST (Kevin, 2026-11-16, option B).
//
// WHY jsdom. Two of these pieces are about what a player SEES and taps — the
// score strip hides the quarter table until asked, and the info tabs show one
// panel at a time. The pure rules (quarter points, the AI Commissioner gate)
// are tested as plain functions alongside.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Scores } from '../types';
import { SquaresScoreStrip, SquaresInfoTabs } from '../components/squares/SquaresPageParts';
import { quarterPoints, gameStatusLabel, shortTeamName, aiCommissionerView } from '../components/squares/squaresPageRules';

afterEach(cleanup);

const pre: Scores = { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', period: 0 };

describe('quarterPoints — moved unchanged from the inline scoreboard', () => {
    it('reads all dashes before kickoff', () => {
        expect(quarterPoints(pre, 'home')).toEqual(['-', '-', '-', '-']);
        expect(quarterPoints(null, 'away')).toEqual(['-', '-', '-', '-']);
    });

    it('during Q2, shows Q1 and the live Q2 points (live minus the Q1 snapshot)', () => {
        const s: Scores = { ...pre, gameStatus: 'in', period: 2, q1: { home: 7, away: 3 }, current: { home: 10, away: 10 } };
        expect(quarterPoints(s, 'home')).toEqual([7, 3, '-', '-']);
        expect(quarterPoints(s, 'away')).toEqual([3, 7, '-', '-']);
    });

    it('after the game, every quarter is a difference of two snapshots', () => {
        const s: Scores = {
            ...pre, gameStatus: 'post', period: 4,
            q1: { home: 7, away: 0 }, half: { home: 14, away: 10 }, q3: { home: 17, away: 13 }, final: { home: 24, away: 20 },
            current: { home: 24, away: 20 },
        };
        expect(quarterPoints(s, 'home')).toEqual([7, 7, 3, 7]);
        expect(quarterPoints(s, 'away')).toEqual([0, 10, 3, 7]);
    });

    it('Q1 has no live fallback — the table never showed a running Q1 total', () => {
        const s: Scores = { ...pre, gameStatus: 'in', period: 1, current: { home: 3, away: 0 } };
        expect(quarterPoints(s, 'home')).toEqual(['-', '-', '-', '-']);
    });
});

describe('labels', () => {
    it('maps game status to the strip word', () => {
        expect(gameStatusLabel('pre')).toBe('PENDING');
        expect(gameStatusLabel(undefined)).toBe('PENDING');
        expect(gameStatusLabel('in')).toBe('LIVE');
        expect(gameStatusLabel('post')).toBe('FINAL');
    });

    it('shortens a team to its last word for a phone', () => {
        expect(shortTeamName('Kansas City Chiefs')).toBe('Chiefs');
        expect(shortTeamName('Bills')).toBe('Bills');
        expect(shortTeamName('  ')).toBe('  ');
    });
});

describe('aiCommissionerView — the AI Commissioner shows only on a pool that paid for it', () => {
    it('shows it to everybody when the add-on is unlocked', () => {
        const billing = { status: 'active', featuresUnlocked: { aiCommissioner: true } };
        expect(aiCommissionerView(billing, false)).toBe('show');
        expect(aiCommissionerView(billing, true)).toBe('show');
    });

    it('a player of a pool without it sees nothing', () => {
        expect(aiCommissionerView({ status: 'active', featuresUnlocked: { aiCommissioner: false } }, false)).toBe('none');
        expect(aiCommissionerView(undefined, false)).toBe('none');
        expect(aiCommissionerView(null, false)).toBe('none');
    });

    it('the manager of an active pool without it sees the upgrade button', () => {
        expect(aiCommissionerView({ status: 'active', featuresUnlocked: {} }, true)).toBe('upsell');
    });

    it('no upgrade button where the server would refuse the checkout (pool not active)', () => {
        expect(aiCommissionerView({ status: 'pending', featuresUnlocked: {} }, true)).toBe('none');
        expect(aiCommissionerView(undefined, true)).toBe('none');
    });

    it('only a real `true` unlocks it — a truthy string from a bad write does not', () => {
        const billing = { status: 'active', featuresUnlocked: { aiCommissioner: 'yes' as unknown as boolean } };
        expect(aiCommissionerView(billing, false)).toBe('none');
    });
});

describe('SquaresScoreStrip — the scoreboard as one line', () => {
    const live: Scores = { ...pre, gameStatus: 'in', period: 2, q1: { home: 7, away: 3 }, current: { home: 10, away: 13 } };

    it('shows both totals and hides the quarter table until tapped', () => {
        render(<SquaresScoreStrip awayTeam="Kansas City Chiefs" homeTeam="Buffalo Bills" scores={live} />);
        const strip = screen.getByTestId('squares-score-strip');
        expect(strip.textContent).toContain('13');
        expect(strip.textContent).toContain('10');
        expect(screen.queryByRole('table')).toBeNull();

        const toggle = screen.getByRole('button', { expanded: false });
        fireEvent.click(toggle);
        expect(screen.getByRole('table')).toBeTruthy();
        expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    });

    it('keys the quarter rows by side, so two empty team names do not collide (qodo, PR #783)', () => {
        const errors: unknown[] = [];
        const orig = console.error;
        console.error = (...a: unknown[]) => { errors.push(a); };
        try {
            render(<SquaresScoreStrip awayTeam="" homeTeam="" scores={live} />);
            fireEvent.click(screen.getByRole('button', { expanded: false }));
            expect(screen.getAllByRole('row').length).toBe(3); // header + away + home
        } finally {
            console.error = orig;
        }
        expect(errors.filter(e => String(e).includes('same key'))).toEqual([]);
    });

    it('reads PENDING before kickoff and 0 for both sides', () => {
        render(<SquaresScoreStrip awayTeam="Kansas City Chiefs" homeTeam="Buffalo Bills" scores={pre} />);
        const strip = screen.getByTestId('squares-score-strip');
        expect(strip.textContent).toContain('PENDING');
        expect(strip.textContent?.match(/0/g)?.length).toBeGreaterThanOrEqual(2);
    });
});

describe('SquaresInfoTabs — Payouts / Rules / Payment, one at a time', () => {
    const tabs = [
        { id: 'payouts', label: 'Payouts', content: <p>pay-panel</p> },
        { id: 'rules', label: 'Rules', content: <p>rules-panel</p> },
        { id: 'payment', label: 'Payment', content: <p>payment-panel</p> },
    ];

    it('opens on the first tab and switches on tap', () => {
        render(<SquaresInfoTabs tabs={tabs} />);
        expect(screen.getByText('pay-panel')).toBeTruthy();
        expect(screen.queryByText('rules-panel')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
        expect(screen.getByText('rules-panel')).toBeTruthy();
        expect(screen.queryByText('pay-panel')).toBeNull();
        expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true');
    });

    it('renders nothing for an empty tab list', () => {
        const { container } = render(<SquaresInfoTabs tabs={[]} />);
        expect(container.innerHTML).toBe('');
    });
});
