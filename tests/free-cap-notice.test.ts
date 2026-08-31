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
    expect(src).toContain('A free pool holds {freeCapNotice} {capUnit}');
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

  /**
   * EVERY SURFACE THAT NAMES THE CAP READS IT (codex r3).
   *
   * Centralising only the ENFORCEMENT left the commissioner's banner and the
   * warning emails on literal 8/10 — so raising the constant would have made
   * the gate and the guidance disagree, which is the exact failure this file
   * was opened to fix, one layer out.
   */
  it('the commissioner banner and the warning emails read the constants too', () => {
    const gate = read('src/components/billing/BillingGate.tsx');
    expect(gate).toContain('count >= FREE_PLAN_PARTICIPANT_CAP');
    expect(gate).toContain('count >= FREE_PLAN_WARNING_AT');
    expect(gate).toContain('${count}/${FREE_PLAN_PARTICIPANT_CAP}');
    // No literal ceiling left in the copy it renders.
    expect(gate).not.toMatch(/more than 10 participants/);
    expect(gate).not.toMatch(/\(10\/10 reached\)/);
    expect(gate).not.toMatch(/10-player limit/);

    const billing = read('functions/src/billing.ts');
    expect(billing).toContain('<strong>${FREE_PLAN_PARTICIPANT_CAP} participants</strong>');
    // codex r6: the alert CARD inside the same email kept its own literals, so
    // the first sentence and the box under it would have disagreed.
    expect(billing).toContain('Approaching Limit: ${count}/${FREE_PLAN_PARTICIPANT_CAP} Players');
    expect(billing).toContain('Once your pool reaches ${FREE_PLAN_PARTICIPANT_CAP} players');
    expect(billing).not.toMatch(/\$\{count\}\/10 Players/);
    expect(billing).not.toMatch(/reaches 10 players/);
    expect(billing).not.toContain('<strong>10 participants</strong>');
  });

  it('the two numbers are declared once, together, and documented as distinct', () => {
    const shared = read('shared/freePlanCap.ts');
    expect(shared).toContain('export const FREE_PLAN_PARTICIPANT_CAP = 10;');
    expect(shared).toContain('export const FREE_PLAN_WARNING_AT = 8;');
    // The distinction that codex r1 turned on, written down where it is read.
    expect(shared).toContain('THIS IS NOT `billing_config.freePlayerThreshold`');
  });

  /**
   * IT QUOTES THE MESSAGE, IT DOES NOT RETYPE IT (codex r2).
   *
   * The first cut hand-copied the NFL refusal. Bracket, playoff and props threw
   * DIFFERENT words — the pre-G9 copy that explains our billing tiers to
   * somebody with no billing relationship with us — so the wizard was telling
   * three of the five pool types it creates that their members would see text
   * they would never receive. All four gates now throw the same constant.
   */
  /**
   * THE CAP DOES NOT COUNT THE SAME THING EVERYWHERE (codex r7).
   *
   * `nflPools` counts distinct participants; bracket, playoff and props count
   * ENTRIES — and props lets one person hold several cards. "10 players" would
   * promise a bigger pool than the gate allows on those three.
   */
  it('names the unit the gate actually counts, per pool type', () => {
    expect(src).toContain("const capUnit = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(String(poolType).toUpperCase())");
    expect(src).toContain("? 'players'");
    expect(src).toContain("    : 'entries';");

    // The claim behind the split, measured at both kinds of gate.
    expect(read('functions/src/nflPools.ts')).toContain('participantIds.length >= FREE_PLAN_PARTICIPANT_CAP');
    expect(read('functions/src/bracketEntries.ts')).toContain('currentEntriesCount >= FREE_PLAN_PARTICIPANT_CAP');
    expect(read('functions/src/propBets.ts')).toContain('currentEntriesCount >= FREE_PLAN_PARTICIPANT_CAP');
  });

  it('quotes the ONE refusal every gate throws, from the constant', () => {
    expect(src).toContain('{FREE_PLAN_FULL_MESSAGE}');
    for (const f of [
      'functions/src/nflPools.ts',
      'functions/src/bracketEntries.ts',
      'functions/src/playoffPools.ts',
      'functions/src/propBets.ts',
    ]) {
      const server = read(f);
      expect(server, f).toContain('FREE_PLAN_FULL_MESSAGE');
      // The pre-G9 wording must not survive anywhere.
      expect(server, f).not.toContain('must upgrade to premium');
    }
  });

  /**
   * A TRIAL POOL IS NOT SUBJECT TO THE FREE CAP (codex r2).
   *
   * `freeTierEligible` means "total is $0", which a 100%-off coupon makes true
   * with a paid add-on selected — while `computeLaunchMode` forces a TRIAL for
   * any paid add-on. Showing the cap there would invent a limit the pool does
   * not have.
   */
  it('is suppressed when a paid add-on is selected, coupon or not', () => {
    expect(src).toContain('if (quote.addonLines.length > 0) return null;');
  });

  /**
   * THE REMEDY HAS TO WORK (codex r4) — the same rule G9 applied to the member
   * refusal, applied to the commissioner's instructions.
   *
   * The first cut sent them to "Commissioner → Settings", which carries no
   * upgrade flow. The control that does is the participants banner in
   * `BillingGate`, and it links to `/pricing?poolId=…`.
   */
  it('points at the control that actually upgrades, not a dead end', () => {
    expect(src).toContain('We email you when your pool reaches');
    expect(src).toContain('participants banner');
    expect(src).not.toContain('Commissioner &rarr; Settings');
    // ...and that banner really is the thing that routes to pricing.
    const gate = read('src/components/billing/BillingGate.tsx');
    expect(gate).toContain("const pricingHref = poolId ? `/pricing?poolId=${encodeURIComponent(poolId)}` : '/pricing';");
    expect(gate).toContain('href={pricingHref}');
  });

  /**
   * NOT SHOWN ON A GUESS. A wrong ceiling is worse than none — a commissioner
   * would plan their invite list around it — so the notice is suppressed while
   * the quote is loading, stale, or absent, and on a pool that is not launching
   * free in the first place.
   */
  /**
   * SQUARES IS THE ONE TYPE THAT DOES NOT ENFORCE THIS (codex r5).
   *
   * `reserveSquare` checks billing ACCESS but never the free-plan participant
   * count — SQUARES-BACKLOG.md S3 — so the promise would be false there.
   * Creation for the type is closed today, so the notice cannot render anyway;
   * this keeps reopening it from quietly reintroducing the lie.
   */
  it('is suppressed for SQUARES, whose join path does not enforce the cap', () => {
    expect(src).toContain("if (String(poolType).toUpperCase() === 'SQUARES') return null;");
    // The claim behind the suppression, measured: no cap in the squares path.
    const squares = read('functions/src/squares.ts');
    expect(squares).not.toContain('FREE_PLAN_PARTICIPANT_CAP');
    expect(squares).not.toMatch(/participantIds\.length >= /);
  });

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
