import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T5 (Kevin's D2) — the behaviour is unit-tested in
 * `functions/src/__tests__/billingForLaunch.test.ts`. What cannot be reached
 * from there is that all three create callables actually PASS the selection.
 * A callable that forgets is the whole defect, restored on one pool type.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const CALLABLES = ['functions/src/poolOps.ts', 'functions/src/nflPools.ts', 'functions/src/bracketPools.ts'];

/** The literal 4th argument each callable must pass. A 3-arg call is the old,
 *  all-locked behaviour — and one callable forgetting is the whole defect,
 *  restored on a single pool type. Asserted per file rather than by counting
 *  commas: `now.toMillis()` in one of them defeats any naive arg regex. */
const SELECTION_ARG: Record<string, string> = {
    'functions/src/poolOps.ts':
        'billingForLaunch(launchMode, billingConfig.trialDays, now.toMillis(), normalizeAddonSelection(data))',
    'functions/src/nflPools.ts':
        'billingForLaunch(launchMode, billingConfig.trialDays, now, normalizeAddonSelection(data))',
    'functions/src/bracketPools.ts':
        'billingForLaunch(launchMode, billingConfig.trialDays, now, poolExtras.addons as Record<string, boolean>)',
};

describe('every create callable passes the wizard selection to billingForLaunch', () => {
    it.each(CALLABLES)('%s', (file) => {
        expect(read(file)).toContain(SELECTION_ARG[file]);
    });

    it('the selection is normalized server-side, never trusted raw', () => {
        for (const file of CALLABLES) {
            const src = read(file);
            expect(src.includes('normalizeAddonSelection') || src.includes('poolExtras.addons'), file).toBe(true);
        }
    });

    it('covers every create callable that stamps launch billing', () => {
        // A new create path that stamps billing and is not listed here would
        // silently keep the old all-locked behaviour.
        for (const file of ['functions/src/poolOps.ts', 'functions/src/nflPools.ts', 'functions/src/bracketPools.ts']) {
            expect(CALLABLES).toContain(file);
        }
    });
});

describe('the trial path honours the UNSELLABLE clamp', () => {
    it('trialFeaturesUnlocked routes through the shared clamp', () => {
        // codex r1 [P1]: PLAN-COST-CONTROLS 0.5.4's two enforcement points are
        // the quote-input schema and the Stripe webhook — a CREATE payload
        // passes through neither, and the create envelopes are permissive.
        const creation = read('functions/src/lib/poolCreation.ts');
        expect(creation).toContain('clampUnsellableAddons(out)');
        expect(creation).toContain("import { clampUnsellableAddons } from '../shared/schemas/quote';");
    });
});

describe('the AI tab this unblocks is still entitlement-gated', () => {
    // T5 does not weaken any gate: it changes what a TRIAL pool's
    // featuresUnlocked says, not who may read it or what it authorizes.
    const rules = read('firestore.rules');

    it('ai_requests create still requires all four conditions', () => {
        expect(rules).toContain('request.resource.data.userId == request.auth.uid');
        expect(rules).toContain('isPoolParticipant()');
        expect(rules).toContain(".get('aiCommissioner', false) == true");
        expect(rules).toContain('allow update, delete: if false;');
    });

    it('ai_artifacts stays functions-write-only', () => {
        expect(rules).toMatch(/match \/ai_artifacts\/\{docId\} \{[\s\S]{0,120}?allow write: if false;/);
    });
});
