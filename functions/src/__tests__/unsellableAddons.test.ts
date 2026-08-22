/**
 * unsellableAddons.test.ts — PLAN-COST-CONTROLS 0.5.4.
 *
 * Kevin's decision #3 (2026-08-22): "SMS is OFF until further notice." Two
 * places have to agree about that, and they are reached by different callers:
 *
 *   - `addonSelectionSchema` (both buy paths parse through it) so SMS cannot be
 *     quoted or charged going forward;
 *   - the Stripe webhook's in-flight clamp, for a session created BEFORE that
 *     shipped — the webhook trusts the persisted snapshot rather than
 *     re-parsing, which is the gap codex round 2 found.
 *
 * They share `UNSELLABLE_ADDON_KEYS` / `clampUnsellableAddons` precisely so they
 * cannot drift. These tests pin the shared half; the webhook's use of it is
 * asserted at source level below, because `finalizePoolPayment` is a Firestore
 * transaction that a unit test cannot reach without a full fake.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  UNSELLABLE_ADDON_KEYS,
  clampUnsellableAddons,
  unsellableClampOutcome,
  addonSelectionSchema,
} from '../shared/schemas/quote';

describe('clampUnsellableAddons', () => {
  it('forces SMS off and leaves every other add-on untouched', () => {
    expect(clampUnsellableAddons({
      aiCommissioner: true,
      smsNotifications: true,
      whatIfSimulator: true,
      customBranding: true,
    })).toEqual({
      aiCommissioner: true,
      smsNotifications: false,
      whatIfSimulator: true,
      customBranding: true,
    });
  });

  it('does not add keys that were absent', () => {
    // The webhook passes a persisted object that may predate a schema change;
    // inventing keys there would write fields nobody asked for.
    expect(clampUnsellableAddons({ aiCommissioner: true })).toEqual({ aiCommissioner: true });
  });

  it('does not mutate its input', () => {
    const input = { smsNotifications: true };
    clampUnsellableAddons(input);
    expect(input.smsNotifications).toBe(true);
  });

  it('names SMS, and ONLY SMS, as unsellable today', () => {
    // A tripwire, not a tautology: the other three add-ons are actively sold,
    // so a key landing here by accident silently stops revenue.
    expect([...UNSELLABLE_ADDON_KEYS]).toEqual(['smsNotifications']);
  });
});

describe('addonSelectionSchema — SMS cannot be bought', () => {
  it('forces smsNotifications false even when the client asks for it', () => {
    const parsed = addonSelectionSchema.parse({ aiCommissioner: true, smsNotifications: true });
    expect(parsed.smsNotifications).toBe(false);
    expect(parsed.aiCommissioner).toBe(true);
  });

  it('still defaults everything to false when addons are omitted', () => {
    expect(addonSelectionSchema.parse(undefined)).toEqual({
      aiCommissioner: false,
      smsNotifications: false,
      whatIfSimulator: false,
      customBranding: false,
    });
  });

  it('coerces rather than rejecting — a stale client gets a quote, not an error', () => {
    // Deliberate: the safe direction is never-charge/never-unlock. Throwing
    // would break a cached client instead of quietly quoting it the truth.
    expect(() => addonSelectionSchema.parse({ smsNotifications: true })).not.toThrow();
  });
});

describe('unsellableClampOutcome — the webhook in-flight decision', () => {
  // This is the whole decision `finalizePoolPayment` makes, extracted so it can
  // be asserted by BEHAVIOUR. It used to be inline, where the only available
  // test was "does this string appear in stripe.ts" — a guard that passes
  // whether or not the code still runs (codex round 3, finding 3).

  it('withholds the entitlement AND reports what was paid for', () => {
    const out = unsellableClampOutcome(
      { aiCommissioner: true, smsNotifications: true },
      ['aiCommissioner', 'smsNotifications'],
    );
    expect(out.unlocked.smsNotifications).toBe(false);
    expect(out.unlocked.aiCommissioner).toBe(true);
    expect(out.soldWhileOff).toEqual(['smsNotifications']);
  });

  it('flags a paid add-on even when the entitlement map does not carry it', () => {
    // The two halves of a session record can disagree; either one is evidence
    // the customer was charged, and a refund review needs both consulted.
    const out = unsellableClampOutcome({ smsNotifications: false }, ['smsNotifications']);
    expect(out.soldWhileOff).toEqual(['smsNotifications']);
  });

  it('flags an unlocked-but-unrecorded add-on too', () => {
    const out = unsellableClampOutcome({ smsNotifications: true }, []);
    expect(out.soldWhileOff).toEqual(['smsNotifications']);
  });

  it('is silent for an ordinary purchase — no alert, nothing clamped', () => {
    // The common case. If this ever reports soldWhileOff, every normal
    // checkout starts writing refund-review alerts.
    const out = unsellableClampOutcome(
      { aiCommissioner: true, smsNotifications: false, customBranding: true },
      ['aiCommissioner', 'customBranding'],
    );
    expect(out.soldWhileOff).toEqual([]);
    expect(out.unlocked).toEqual({
      aiCommissioner: true, smsNotifications: false, customBranding: true,
    });
  });

  it('tolerates a missing paid-addons array (legacy session records)', () => {
    expect(() => unsellableClampOutcome({ smsNotifications: true })).not.toThrow();
  });
});

describe('the webhook wires the decision in the right order (source-level)', () => {
  // ONE structural guard kept deliberately: the behaviour above cannot catch a
  // Firestore transaction-ordering bug, and that is exactly what round 3 found
  // here — an alert `txn.set` placed before the coupon `txn.get` threw the whole
  // transaction for any checkout using both a coupon and an unsellable add-on.
  const src = fs.readFileSync(path.join(__dirname, '..', 'stripe.ts'), 'utf8');

  // ⚠️ SCOPED TO THE FUNCTION, deliberately. The first version of this guard
  // searched the whole file and matched an EARLIER coupon read belonging to a
  // different function, so it compared the wrong pair and passed even with the
  // bug reintroduced. It was caught by reverting the fix and watching the test
  // stay green — a guard is not a guard until you have seen it fail.
  const fnStart = src.indexOf('async function finalizePoolPayment');
  const fnEnd = src.indexOf('async function releaseReservationBestEffort');
  const fn = src.slice(fnStart, fnEnd);

  it('locates the function body it is asserting about', () => {
    // If a rename makes these markers stale, the slice goes empty and every
    // assertion below becomes vacuously true. Fail loudly instead.
    expect(fnStart, 'finalizePoolPayment not found — update the marker').toBeGreaterThan(-1);
    expect(fnEnd, 'the end marker not found — update it').toBeGreaterThan(fnStart);
    expect(fn).toContain('UNSELLABLE_ADDON_SOLD_${sessionId}');
    expect(fn).toContain('txn.get(');
  });

  it('performs EVERY transaction read before the alert write', () => {
    const alertWrite = fn.indexOf('UNSELLABLE_ADDON_SOLD_${sessionId}');
    const lastRead = fn.lastIndexOf('txn.get(');
    expect(
      lastRead,
      'a txn.get runs after the alert txn.set — Firestore requires all reads before all writes, ' +
      'and this threw the whole transaction for any checkout using both a coupon and an unsellable add-on',
    ).toBeLessThan(alertWrite);
  });
});
