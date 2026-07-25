import { describe, it, expect } from 'vitest';
import { buildPoolSettingsUpdate, flattenSettingsPatch, SERVER_OWNED_SETTINGS_KEYS } from '../lib/poolUpdate';
import { normalizePhase, isGroupEditable, classifyUpdateKey } from '../shared/editability';

describe('normalizePhase', () => {
  it('locked wins over status', () => {
    expect(normalizePhase({ isLocked: true, status: 'OPEN' })).toBe('locked');
  });
  it('maps status vocab', () => {
    expect(normalizePhase({ status: 'DRAFT' })).toBe('draft');
    expect(normalizePhase({ status: 'archived' })).toBe('archived');
    expect(normalizePhase({ status: 'active' })).toBe('open');
    expect(normalizePhase({})).toBe('open');
  });
});

describe('editability matrix', () => {
  it('open allows structural edits; locked freezes them', () => {
    expect(isGroupEditable('open', 'payouts')).toBe(true);
    expect(isGroupEditable('open', 'settings')).toBe(true);
    expect(isGroupEditable('locked', 'payouts')).toBe(false);
    expect(isGroupEditable('locked', 'settings')).toBe(false);
  });
  it('locked still allows cosmetic + contact + lifecycle', () => {
    for (const g of ['basics', 'contact', 'branding', 'reminders', 'lifecycle'] as const) {
      expect(isGroupEditable('locked', g)).toBe(true);
    }
  });
  it('classifies keys', () => {
    expect(classifyUpdateKey('name')).toBe('basics');
    expect(classifyUpdateKey('venmo')).toBe('paymentHandles');
    expect(classifyUpdateKey('isLocked')).toBe('lifecycle');
    expect(classifyUpdateKey('bogus')).toBeUndefined();
  });
});

describe('buildPoolSettingsUpdate', () => {
  it('accepts allowed edits on an open pool', () => {
    const plan = buildPoolSettingsUpdate({ status: 'OPEN' }, { name: 'New Name', settings: { entryFee: 5 } });
    expect(plan.set).toEqual({ name: 'New Name', settings: { entryFee: 5 } });
    expect(plan.clearLegacy).toEqual([]);
  });
  it('rejects a structural edit on a locked pool', () => {
    expect(() => buildPoolSettingsUpdate({ isLocked: true }, { payouts: { places: [], bonuses: [] } })).toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => buildPoolSettingsUpdate({ status: 'OPEN' }, { billing: { status: 'active' } })).toThrow();
  });
  it('dual-writes legacy handles and clears the absent ones', () => {
    const plan = buildPoolSettingsUpdate({ status: 'OPEN' }, { paymentHandles: { venmo: '@me', googlePay: 'g' } });
    expect(plan.set.paymentHandles).toEqual({ venmo: '@me', googlePay: 'g' });
    expect(plan.set.venmo).toBe('@me');
    expect(plan.clearLegacy.sort()).toEqual(['cashapp', 'paypal', 'zelle']);
  });
});

describe('flattenSettingsPatch — merge-preserving settings writes (PR-B′)', () => {
  it('expands a whole-settings replacement into per-key dotted writes', () => {
    // THE BUG THIS EXISTS FOR: NFLManagerView sends a COMPLETE settings object,
    // and a Firestore `update({ settings: {...} })` REPLACES the map. A routine
    // save after a commissioner extended a deadline would silently delete
    // `weekLockOverrides` — reverting the accepted deadline — and reset
    // `lockRevision`, breaking the scoring concurrency protocol.
    expect(flattenSettingsPatch({ name: 'N', settings: { entryFee: 5, pickMode: 'ATS' } }, 'NFL_PICKEM'))
      .toEqual({ name: 'N', 'settings.entryFee': 5, 'settings.pickMode': 'ATS' });
  });

  it('leaves a payload with no settings key untouched', () => {
    expect(flattenSettingsPatch({ name: 'N' }, 'NFL_PICKEM')).toEqual({ name: 'N' });
  });

  it('REJECTS the server-owned nested keys', () => {
    for (const key of SERVER_OWNED_SETTINGS_KEYS) {
      expect(() => flattenSettingsPatch({ settings: { [key]: { 1: 123 } } }, 'NFL_PICKEM'))
        .toThrow(/managed by the server/);
    }
  });

  it('rejects a settings key that would escape its own field path', () => {
    // `settings.a.b` written as a dotted path lands somewhere else entirely.
    expect(() => flattenSettingsPatch({ settings: { 'a.b': 1 } }, 'NFL_PICKEM'))
      .toThrow(/not a valid settings key/);
    expect(() => flattenSettingsPatch({ settings: { '`x`': 1 } }, 'NFL_PICKEM'))
      .toThrow(/not a valid settings key/);
  });

  it('rejects a non-object settings value', () => {
    expect(() => flattenSettingsPatch({ settings: null }, 'NFL_PICKEM')).toThrow(/must be an object/);
    expect(() => flattenSettingsPatch({ settings: [1] }, 'NFL_PICKEM')).toThrow(/must be an object/);
  });

  it('forces WEEKLY lock and snaps the buffer to a preset for Survivor/Margin', () => {
    // codex r29: protecting the field is not enough once direct writes are
    // blocked — a manager can still call the callable with an arbitrary buffer
    // and move the "hard" deadline.
    for (const type of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
      const out = flattenSettingsPatch({ settings: { lockMode: 'PER_GAME', lockBufferMinutes: 0 } }, type);
      expect(out['settings.lockMode']).toBe('WEEKLY');
      expect(out['settings.lockBufferMinutes']).toBe(5);
    }
    expect(flattenSettingsPatch({ settings: { lockBufferMinutes: 60 } }, 'NFL_SURVIVOR')['settings.lockBufferMinutes'])
      .toBe(60);
  });

  it('leaves Pick’em lock settings alone — it keeps per-game locks and extensions', () => {
    const out = flattenSettingsPatch({ settings: { lockMode: 'PER_GAME', lockBufferMinutes: 15 } }, 'NFL_PICKEM');
    expect(out['settings.lockMode']).toBe('PER_GAME');
    expect(out['settings.lockBufferMinutes']).toBe(15);
  });
});
