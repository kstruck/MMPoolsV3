import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE FREE PLAN'S CEILING, NAMED WHERE THE COMMISSIONER DECIDES (Kevin, 2026-08-30).
 *
 * *"Make sure this is clear on the wizard to the user so they fully understand
 * and explain how they will know when the 11th player tries to join and what
 * they will see, and how they can fix it."*
 *
 * The launch step described the limit without naming it, on purpose: the figure
 * is configurable and already hardcoded at the four sites that ENFORCE it, and
 * a fifth copy in wizard copy would be a fifth thing to get wrong.
 *
 * So it is SERVED, not copied — `PoolQuote.freePlayerThreshold`, the same
 * precedent `trialDays` set. That the ENGINE reports it, and that it moves with
 * the config, is asserted in `functions/src/__tests__/quoteEngine.test.ts`
 * where the pricing fixtures already live. This file covers the other half:
 * that the wizard actually renders it, and renders it honestly.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('the wizard tells the commissioner what happens at the wall', () => {
  const src = read('src/components/wizard/create/LaunchStep.tsx');

  it('names the number from the quote, never a literal', () => {
    expect(src).toContain('const cap = Number(quote.freePlayerThreshold);');
    // A hardcoded ceiling in the copy is the thing this design exists to avoid.
    expect(src).not.toMatch(/A free pool holds 10 players/);
    expect(src).toContain('A free pool holds {freeCapNotice} players');
    expect(src).toContain('Player {freeCapNotice + 1} cannot join');
  });

  it('quotes the refusal the 11th player will actually see, verbatim', () => {
    // The exact string `nflPools.ts` throws. If that copy is reworded, this
    // fails and the wizard's promise has to be reworded with it.
    const server = read('functions/src/nflPools.ts');
    const line = 'This pool is full, so your spot could not be reserved. Ask the commissioner to make room — they can upgrade the pool to raise its limit.';
    expect(server).toContain(line);
    expect(src).toContain('This pool is full, so your spot could not be reserved.');
    expect(src).toContain('they can upgrade the pool to raise its limit.');
  });

  it('says how the commissioner finds out, and how to fix it', () => {
    expect(src).toContain('We email you when your pool reaches');
    expect(src).toContain('Commissioner &rarr; Settings');
  });

  /**
   * NOT SHOWN ON A GUESS. A wrong ceiling is worse than none — a commissioner
   * would plan their invite list around it — so the notice is suppressed while
   * the quote is loading, stale, or absent, and on a pool that is not launching
   * free in the first place.
   */
  it('is suppressed unless the quote is loaded, current, and free-eligible', () => {
    expect(src).toContain('if (resolvedKey !== quoteInputsKey || quoteLoading || !quote) return null;');
    expect(src).toContain('if (!quote.freeTierEligible) return null;');
    expect(src).toContain('{freeCapNotice !== null && (');
  });

  it('the alert threshold it promises is derived, not a second hardcoded number', () => {
    // "We email you at N-2 and again at N" — billing.ts alerts at 8 and 10 on a
    // ceiling of 10, so the earlier nudge is two below the cap.
    expect(src).toContain('Math.max(1, freeCapNotice - 2)');
    expect(read('functions/src/billing.ts')).toMatch(/hit 8 or 10 entries on the Free Plan/);
  });
});
