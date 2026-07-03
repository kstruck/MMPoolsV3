import { describe, it, expect } from 'vitest';
import { buildPoolSettingsUpdate } from '../lib/poolUpdate';
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
