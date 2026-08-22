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

describe('the Stripe webhook actually applies the clamp (source-level)', () => {
  // finalizePoolPayment is a transaction over Firestore; driving it needs a
  // full fake. What must not regress is structural: that the webhook consults
  // the SHARED unsellable list rather than re-deciding locally, and that it
  // records the money discrepancy instead of silently withholding a paid flag.
  const src = fs.readFileSync(path.join(__dirname, '..', 'stripe.ts'), 'utf8');

  it('imports the shared list rather than hardcoding a key', () => {
    expect(src).toMatch(/clampUnsellableAddons/);
    expect(src).toMatch(/UNSELLABLE_ADDON_KEYS/);
  });

  it('writes a monetization alert when a paid-for unsellable add-on arrives', () => {
    // Without this the customer is charged and not granted, with no record for
    // Kevin to refund from — a silent money discrepancy.
    expect(src).toMatch(/UNSELLABLE_ADDON_SOLD/);
  });

  it('does NOT strip the paid-addons record', () => {
    // The purchase record stays truthful (see the comment at the clamp): if SMS
    // returns, a customer who already paid must not pay twice.
    expect(src).not.toMatch(/addons:\s*\(?snapshot\?\.addons.*filter/);
  });
});
