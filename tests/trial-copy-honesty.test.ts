import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T7 — the trial surfaces must say what the trial
 * IS, not only what it costs.
 *
 * Three facts a commissioner needs before committing a pool of real people to
 * a trial, and all three were missing from both places it is described:
 * what is switched on, what happens when it ends, and whether anything is
 * going to charge them.
 *
 * The third one matters most: there is no card on file, so nothing can charge
 * automatically — and a countdown banner that does not say so reads like a
 * countdown to a debit.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const launch = read('src/components/wizard/create/LaunchStep.tsx');
const gate = read('src/components/billing/BillingGate.tsx');

describe('the wizard trial line', () => {
    it('says what the trial includes (D2: the selected add-ons are ON)', () => {
        // #527 made that true; this is the surface that tells anyone.
        expect(launch).toContain('with everything you selected above switched on');
    });

    it('says nothing charges automatically', () => {
        expect(launch).toContain('nothing is charged automatically');
    });

    it('says what happens at the end — grace, then lock', () => {
        expect(launch).toContain('short grace period to pay');
        expect(launch).toContain('the pool locks');
    });

    it('and that a lock is not a loss', () => {
        // The members did nothing wrong and lose nothing; saying so is what
        // stops "locks" reading as "deleted".
        expect(launch).toContain('members keep their picks and standings');
    });

    it('no longer stops at the price', () => {
        expect(launch).not.toContain('free trial. No card required to start.');
    });
});

describe('the trial banner on the pool page', () => {
    it('carries the same two facts, not a bare upgrade nag', () => {
        expect(gate).toContain('Nothing is charged automatically.');
        expect(gate).toContain('short grace period to pay');
        expect(gate).not.toContain('Upgrade to keep full access after your trial period.');
    });

    it('is addressed by ROLE — a member cannot pay (codex [P2])', () => {
        // The banner renders for everyone but the pay CTA is commissioner-only,
        // so second-person "you pay" told a member to do something they cannot.
        // Same split the grace and locked banners already use.
        expect(gate).toContain('the commissioner has a short grace period to pay');
        expect(gate).toContain('Your picks and standings are safe.');
        expect(gate).toContain("{isCommissioner");
    });
});
