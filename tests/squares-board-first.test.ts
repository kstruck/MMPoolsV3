/**
 * The squares pool page puts the BOARD FIRST (Kevin, 2026-11-16, option B).
 *
 * What these pin, read from the source because the page is one large route
 * component with Firebase subscriptions that a unit test cannot mount cheaply:
 *
 * 1. The order: score strip -> fact chips -> board -> Payouts/Rules/Payment
 *    tabs. The old order put Pool Details, Payout Structure and a full
 *    scoreboard table above the board.
 * 2. The AI Commissioner renders only behind `aiCommissionerView`: a pool that
 *    did not pay shows players nothing.
 * 3. The player-details form starts CLOSED, so it does not push the board down;
 *    a guest is still asked for a name by the modal Reserve opens.
 * 4. The grid's lock time stays on the first screen (`grid-locks-at`), which
 *    the e2e suite checks right after the page opens.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const route = read('src/components/routes/PoolRoute.tsx');
const grid = read('src/components/Grid.tsx');

// The squares branch only — everything after the SQUARES LOGIC marker.
const squares = route.slice(route.indexOf('// --- SQUARES LOGIC ---'));

describe('squares page order — board first', () => {
    it('the squares branch exists where this test expects it', () => {
        expect(route.indexOf('// --- SQUARES LOGIC ---')).toBeGreaterThan(0);
    });

    it('score strip and fact chips come BEFORE the board; info tabs come AFTER it', () => {
        const strip = squares.indexOf('<SquaresScoreStrip');
        const chips = squares.indexOf('<SquaresFactChips');
        const board = squares.indexOf('<Grid');
        const tabs = squares.indexOf('<SquaresInfoTabs');
        expect(strip).toBeGreaterThan(0);
        expect(chips).toBeGreaterThan(strip);
        expect(board).toBeGreaterThan(chips);
        expect(tabs).toBeGreaterThan(board);
    });

    it('the old above-the-board blocks are gone', () => {
        expect(squares).not.toContain('Pool Details</h3>');
        expect(squares).not.toContain('Game Scoreboard');
        expect(squares).not.toContain('showPoolInfo');
    });

    it('the grid lock time is on the first screen, not inside a tab', () => {
        const locks = squares.indexOf('testId="grid-locks-at"');
        expect(locks).toBeGreaterThan(0);
        expect(locks).toBeLessThan(squares.indexOf('<Grid'));
    });

    it('the payout numbers the other suites read are still rendered', () => {
        for (const id of ['total-pot', 'net-prize-pool', 'charity-amount']) {
            expect(squares).toContain(`data-testid="${id}"`);
        }
    });
});

describe('AI Commissioner — only on a pool that paid for it', () => {
    it('every AICommissioner render sits behind aiView === "show"', () => {
        const renders = [...squares.matchAll(/<AICommissioner\b/g)];
        expect(renders.length).toBe(1);
        const at = renders[0].index ?? 0;
        expect(squares.slice(Math.max(0, at - 80), at)).toContain("aiView === 'show'");
    });

    it('the view comes from aiCommissionerView with the strict manager check', () => {
        expect(squares).toMatch(/aiCommissionerView\([\s\S]{0,160}?\.billing, isManager\)/);
        expect(squares).toContain("aiView === 'upsell'");
        expect(squares).toContain('addon="aiCommissioner"');
    });
});

describe('player details start closed', () => {
    it('the identity form is closed on first render', () => {
        expect(grid).toMatch(/const \[isIdentityOpen, setIsIdentityOpen\] = useState\(false\)/);
    });

    it('a signed-in account collapses it too', () => {
        const prefill = grid.slice(grid.indexOf('useAccountPrefill(currentUser'));
        expect(prefill.slice(0, 600)).toContain('setIsIdentityOpen(false)');
    });

    it('a guest with no name is still sent to the details modal by Reserve', () => {
        expect(grid).toMatch(/if \(!isIdentitySet\) \{[\s\S]{0,120}?setShowGuestModal\(true\)/);
    });
});
