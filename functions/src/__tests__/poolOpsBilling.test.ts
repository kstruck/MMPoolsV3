/**
 * poolOpsBilling.test.ts — Buy-flow launch mode + paid-ceiling enforcement.
 *
 * Covers the pure helpers wired into the create/join callables by the buy-flow
 * overhaul (NOTES-WAVE2 A1/A2, PLAN Phase 2 #5 / #6b):
 *   - computeLaunchMode: 'free' below the threshold with no add-on; 'trial' when
 *     over the threshold or when any paid add-on is selected.
 *   - assertPaidCeilingForUpdate: updatePoolSettings rejects a player-cap raise or
 *     a paid add-on enable beyond the paid snapshot (no-op when billing.paid is
 *     absent).
 *   - assertPaidParticipantCeiling: join/enter is rejected at the paid ceiling
 *     boundary (no-op for free/trial pools).
 *
 * These helpers live in poolOps.ts (an owned file). poolOps transitively imports
 * billing.ts, which runs `const db = admin.firestore()` at module load — so
 * firebase-admin is stubbed here (mirrors the "mock all Firebase interactions"
 * note in billing.test.ts). Only module-load side effects need the stub; the
 * helpers under test are pure and touch no Firebase.
 *
 * Runner: vitest (matches existing project setup).
 */

import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so poolOps → billing.ts top-level `admin.firestore()` does
// not crash at import (no emulator / initializeApp in the mocked unit gate).
vi.mock('firebase-admin', () => {
  const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
  firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
  firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
  return { firestore, __esModule: true, default: { firestore } };
});

import {
  computeLaunchMode,
  payloadHasPaidAddon,
  estimatedPlayersFromPayload,
  assertPaidCeilingForUpdate,
  assertPaidParticipantCeiling,
} from '../poolOps';

const FREE_THRESHOLD = 10;

describe('computeLaunchMode (launch billing mode selection)', () => {
  it('free: player estimate at/below threshold and no paid add-on', () => {
    expect(computeLaunchMode({ settings: { maxEntriesTotal: 10 } }, FREE_THRESHOLD)).toBe('free');
    expect(computeLaunchMode({ maxPlayers: 5 }, FREE_THRESHOLD)).toBe('free');
    // boundary: exactly at threshold is still free (≤).
    expect(computeLaunchMode({ estimatedPlayers: FREE_THRESHOLD }, FREE_THRESHOLD)).toBe('free');
  });

  it('free: no player estimate present and no add-on (unchanged behavior)', () => {
    // NFL / squares create payloads carry no cap field — must stay free.
    expect(computeLaunchMode({ type: 'NFL_PICKEM', name: 'Weekly' }, FREE_THRESHOLD)).toBe('free');
    expect(computeLaunchMode({}, FREE_THRESHOLD)).toBe('free');
    expect(computeLaunchMode(undefined, FREE_THRESHOLD)).toBe('free');
  });

  it('trial: player estimate above threshold', () => {
    expect(computeLaunchMode({ settings: { maxEntriesTotal: 11 } }, FREE_THRESHOLD)).toBe('trial');
    expect(computeLaunchMode({ estimatedPlayers: 50 }, FREE_THRESHOLD)).toBe('trial');
  });

  it('trial: any paid add-on selected forces trial regardless of player count', () => {
    expect(computeLaunchMode({ maxPlayers: 3, addons: { aiCommissioner: true } }, FREE_THRESHOLD)).toBe('trial');
    expect(computeLaunchMode({ maxPlayers: 3, smsNotifications: true }, FREE_THRESHOLD)).toBe('trial');
    expect(computeLaunchMode({ whatIfSimulator: true }, FREE_THRESHOLD)).toBe('trial');
  });

  it('an INCLUDED add-on does NOT force trial (T4/D1, codex r2 [P1])', () => {
    // customBranding costs nothing, so it must not push a launch off the free
    // plan either. A stale wizard bundle still sending it would otherwise
    // create a small pool as a 14-day TRIAL — which eventually LOCKS — while
    // the quote on screen said free. Pricing and launch mode have to agree
    // about what is paid.
    expect(computeLaunchMode({ customBranding: true }, FREE_THRESHOLD)).toBe('free');
    expect(computeLaunchMode({ maxPlayers: 3, addons: { customBranding: true } }, FREE_THRESHOLD)).toBe('free');
    // ...and it does not mask a genuinely paid one selected alongside it.
    expect(computeLaunchMode({ maxPlayers: 3, addons: { customBranding: true, aiCommissioner: true } }, FREE_THRESHOLD)).toBe('trial');
  });

  it('a cap of -1 / 0 (unlimited/unset) is treated as no estimate → free without add-on', () => {
    expect(computeLaunchMode({ settings: { maxEntriesTotal: -1 } }, FREE_THRESHOLD)).toBe('free');
    expect(computeLaunchMode({ maxEntriesTotal: 0 }, FREE_THRESHOLD)).toBe('free');
  });
});

describe('payloadHasPaidAddon / estimatedPlayersFromPayload (helpers)', () => {
  it('detects add-ons in a nested addons object and as sibling flags', () => {
    expect(payloadHasPaidAddon({ addons: { aiCommissioner: true } })).toBe(true);
    expect(payloadHasPaidAddon({ smsNotifications: true })).toBe(true);
    expect(payloadHasPaidAddon({ addons: { aiCommissioner: false } })).toBe(false);
    expect(payloadHasPaidAddon({})).toBe(false);
    expect(payloadHasPaidAddon(null)).toBe(false);
  });

  it('reads the first positive player estimate across known cap fields', () => {
    expect(estimatedPlayersFromPayload({ estimatedPlayers: 20 })).toBe(20);
    expect(estimatedPlayersFromPayload({ settings: { maxEntriesTotal: 15 } })).toBe(15);
    expect(estimatedPlayersFromPayload({ maxEntriesTotal: -1 })).toBeUndefined();
    expect(estimatedPlayersFromPayload({})).toBeUndefined();
  });
});

describe('assertPaidCeilingForUpdate (updatePoolSettings paid ceiling)', () => {
  const paidBilling = { paid: { tier: 'standard_tier', maxPlayersAllowed: 25, addons: ['aiCommissioner'], at: 0 } };

  it('no-op when billing.paid is absent (free/trial pools)', () => {
    expect(() => assertPaidCeilingForUpdate({}, { settings: { maxEntriesTotal: 9999 } })).not.toThrow();
    expect(() => assertPaidCeilingForUpdate(undefined, { maxPlayers: 9999 })).not.toThrow();
  });

  it('allows a cap change at or below the paid ceiling', () => {
    // boundary: exactly the ceiling is allowed.
    expect(() => assertPaidCeilingForUpdate(paidBilling, { settings: { maxEntriesTotal: 25 } })).not.toThrow();
    expect(() => assertPaidCeilingForUpdate(paidBilling, { maxPlayers: 24 })).not.toThrow();
  });

  it('rejects raising the cap beyond the paid ceiling (boundary: ceiling + 1)', () => {
    expect(() => assertPaidCeilingForUpdate(paidBilling, { settings: { maxEntriesTotal: 26 } }))
      .toThrowError(/paid ceiling requires an upgrade/i);
    expect(() => assertPaidCeilingForUpdate(paidBilling, { maxPlayers: 26 }))
      .toThrowError(/paid ceiling requires an upgrade/i);
  });

  it('rejects setting the cap to unlimited (-1 / 0) on a paid pool', () => {
    expect(() => assertPaidCeilingForUpdate(paidBilling, { settings: { maxEntriesTotal: -1 } }))
      .toThrowError(/paid ceiling requires an upgrade/i);
  });

  it('allows re-enabling an add-on already in the paid snapshot', () => {
    expect(() => assertPaidCeilingForUpdate(paidBilling, { featuresUnlocked: { aiCommissioner: true } })).not.toThrow();
  });

  it('rejects enabling a paid add-on not in the paid snapshot', () => {
    expect(() => assertPaidCeilingForUpdate(paidBilling, { featuresUnlocked: { whatIfSimulator: true } }))
      .toThrowError(/paid add-on beyond the paid ceiling/i);
    // sibling-flag shape is also caught.
    expect(() => assertPaidCeilingForUpdate(paidBilling, { smsNotifications: true }))
      .toThrowError(/paid add-on beyond the paid ceiling/i);
  });

  it('ALLOWS enabling an INCLUDED add-on on a paid pool (T4/D1)', () => {
    // Branding is free, so turning it on is not an upgrade and must not be
    // refused as one. This is the same derived list computeLaunchMode uses.
    expect(() => assertPaidCeilingForUpdate(paidBilling, { customBranding: true })).not.toThrow();
    expect(() => assertPaidCeilingForUpdate(paidBilling, { featuresUnlocked: { customBranding: true } })).not.toThrow();
  });
});

describe('assertPaidParticipantCeiling (join/enter paid ceiling)', () => {
  const paidBilling = { paid: { tier: 'standard_tier', maxPlayersAllowed: 25, addons: [], at: 0 } };

  it('no-op for free/trial pools (billing.paid absent)', () => {
    expect(() => assertPaidParticipantCeiling({ status: 'free' } as any, 999)).not.toThrow();
    expect(() => assertPaidParticipantCeiling(undefined, 999)).not.toThrow();
    expect(() => assertPaidParticipantCeiling(null, 999)).not.toThrow();
  });

  it('allows a join below the paid ceiling', () => {
    expect(() => assertPaidParticipantCeiling(paidBilling, 24)).not.toThrow();
    expect(() => assertPaidParticipantCeiling(paidBilling, 0)).not.toThrow();
  });

  it('rejects a join at the paid ceiling boundary (count === ceiling)', () => {
    expect(() => assertPaidParticipantCeiling(paidBilling, 25))
      .toThrowError(/This pool is full/i);
  });

  it('rejects a join above the paid ceiling', () => {
    expect(() => assertPaidParticipantCeiling(paidBilling, 26))
      .toThrowError(/This pool is full/i);
  });
});
