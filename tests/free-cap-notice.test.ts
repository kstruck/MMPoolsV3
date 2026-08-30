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

  it('names the ENFORCED cap, never a literal and never the pricing threshold', () => {
    // ⚠️ Two different numbers, both 10 today (codex r1). The quote's
    // `freePlayerThreshold` prices free-vs-trial and is admin-configurable; the
    // cap is what the join gate enforces. Quoting the pricing one here promised
    // a 25-player free pool the moment an admin raised the config.
    expect(src).toContain('return FREE_PLAN_PARTICIPANT_CAP;');
    expect(src).not.toContain('Number(quote.freePlayerThreshold)');
    expect(src).not.toMatch(/A free pool holds 10 players/);
    expect(src).toContain('A free pool holds {freeCapNotice} players');
    expect(src).toContain('Player {freeCapNotice + 1} cannot join');
  });

  /**
   * 🛑 THE PROMISE AND THE ENFORCEMENT ARE THE SAME CONSTANT.
   *
   * This is the assertion the first cut was missing. The four join gates and
   * the warning email hardcoded 10 and read no config, so a served pricing
   * number could drift away from them silently.
   */
  it('every join gate and the warning email read that same constant', () => {
    // POSITIVE assertions, one per site, naming the exact comparison. A
    // negative regex was tried first and did NOT fail when the literal was put
    // back — a guard that looked like a guard and was not, which is the whole
    // reason this file mutation-tests itself.
    const GATES: ReadonlyArray<readonly [string, string]> = [
      ['functions/src/nflPools.ts', 'participantIds.length >= FREE_PLAN_PARTICIPANT_CAP'],
      ['functions/src/bracketEntries.ts', 'currentEntriesCount >= FREE_PLAN_PARTICIPANT_CAP'],
      ['functions/src/playoffPools.ts', 'entries || {}).length >= FREE_PLAN_PARTICIPANT_CAP'],
      ['functions/src/propBets.ts', 'currentEntriesCount >= FREE_PLAN_PARTICIPANT_CAP'],
    ];
    for (const [file, comparison] of GATES) {
      expect(read(file), file).toContain(comparison);
    }
    const billing = read('functions/src/billing.ts');
    expect(billing).toContain('count >= FREE_PLAN_WARNING_AT');
    expect(billing).toContain('count >= FREE_PLAN_PARTICIPANT_CAP');
  });

  it('the two numbers are declared once, together, and documented as distinct', () => {
    const shared = read('shared/freePlanCap.ts');
    expect(shared).toContain('export const FREE_PLAN_PARTICIPANT_CAP = 10;');
    expect(shared).toContain('export const FREE_PLAN_WARNING_AT = 8;');
    // The distinction that codex r1 turned on, written down where it is read.
    expect(shared).toContain('THIS IS NOT `billing_config.freePlayerThreshold`');
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

  it('the email thresholds it promises are the ones the job actually uses', () => {
    // The first cut computed the earlier nudge as `cap - 2`, which is only
    // right at a cap of 10. It reads the constant now.
    expect(src).toContain('{FREE_PLAN_WARNING_AT} players and again at {freeCapNotice}');
    expect(src).not.toContain('Math.max(1, freeCapNotice - 2)');
  });
});
