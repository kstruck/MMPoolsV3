import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T6b — the §2 FRICTION items (G7, G9, G11, G12, G14).
 *
 * G7 and G14's rules are unit-tested in
 * `src/components/wizard/create/launchReadiness.test.ts`; the rest are copy and
 * wiring, where a source invariant is the honest guard.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const launch = read('src/components/wizard/create/LaunchStep.tsx');
const card = read('src/components/billing/BillingInvoiceCard.tsx');
const nflPools = read('functions/src/nflPools.ts');
const poolOps = read('functions/src/poolOps.ts');

describe('G7 — the player estimate must be answered', () => {
    it('no launch action is available until it is', () => {
        // All four: free, trial, activate, redeem.
        expect(launch.match(/!estimateSet/g)?.length).toBe(5); // 4 buttons + the prompt
        expect(launch).toContain('const estimateSet = estimateIsSet(estimatedPlayers);');
    });

    it('the field no longer accepts 0 as an answer', () => {
        expect(launch).not.toMatch(/name="estimatedPlayers"[\s\S]{0,80}?min=\{0\}/);
        expect(launch).toMatch(/name="estimatedPlayers"[\s\S]{0,80}?min=\{1\}/);
    });

    it('the copy says what the number is FOR', () => {
        expect(launch).toContain('This is the number we price');
        expect(launch).toContain('estimate high rather than low');
    });

    it('and does NOT hardcode the free-plan figure a fourth time', () => {
        // It is configurable and already hardcoded in three places (plan §2 G8);
        // a fourth copy is a fourth thing to get wrong.
        expect(launch).not.toMatch(/free[^.]{0,30}10 (players|participants)/i);
    });
});

describe('G14 — a fee with nowhere to send it', () => {
    it('warns above the launch buttons', () => {
        expect(launch).toContain('const feeWarning = feeWithoutPaymentPathWarning({');
        expect(launch).toContain('{feeWarning && (');
    });

    it('WARNS, never blocks — cash in person is a real answer', () => {
        // The buttons must not be gated on it.
        expect(launch).not.toContain('|| feeWarning');
        expect(launch).not.toContain('!feeWarning &&');
    });
});

describe('G9 — the 11th invitee gets member-appropriate copy', () => {
    it('the join limit no longer explains our billing tiers to a member', () => {
        // They have no billing relationship with us; nothing in the old message
        // told them what to do, and it read as though they had erred.
        expect(nflPools).not.toContain('This pool is on the Free Plan and has reached the limit');
        expect(nflPools).not.toMatch(/upgrade to premium to allow more participants/i);
        expect(nflPools).toContain('This pool is full, so your spot could not be reserved.');
    });

    it('the paid-ceiling message too — same audience, same problem', () => {
        expect(poolOps).not.toContain('paid participant ceiling. Upgrade to add more.');
        expect(poolOps).toContain('This pool is full, so your spot could not be reserved.');
    });

    it('it names whose move it is', () => {
        expect(nflPools).toContain('Ask the commissioner');
        expect(poolOps).toContain('Ask the commissioner');
    });
});

describe('G11 — "FREE IN TRIAL" is wizard-only', () => {
    it('the add-on picker label is guarded like the line items already were', () => {
        // On the UPGRADE page the trial is over, so it sat beside "+$19" and
        // contradicted the total the commissioner was about to pay.
        expect(card).toMatch(/\{isWizard && \(\s*\r?\n\s*<span className="text-\[8px\] text-\[#0F7B4A\][^>]*>FREE IN TRIAL<\/span>/);
    });

    it('every remaining occurrence is inside an isWizard guard', () => {
        for (const line of card.split(String.fromCharCode(10))) {
            if (!line.includes('FREE IN TRIAL')) continue;
            expect(line.includes('isWizard') || line.trim().startsWith('<span'), line.trim()).toBe(true);
        }
    });
});

describe('G12 — markdown does not render itself', () => {
    it('the free-pool-limit warning has no literal asterisks left', () => {
        const warning = card.slice(card.indexOf('Active Free Pool Limit Reached'));
        expect(warning.slice(0, 1200)).not.toContain('**');
        expect(warning).toContain('<strong className="font-bold">exactly one active free pool</strong>');
    });
});
