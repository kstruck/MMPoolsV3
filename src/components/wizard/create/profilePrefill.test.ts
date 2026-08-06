import { describe, it, expect } from 'vitest';
import { prefillFromUser, profileUpdatesFrom, HANDLE_KEYS } from './profilePrefill';
import type { User } from '../../../types';

const asUser = (u: Partial<User>): User => ({ id: 'u1', email: '', name: '', role: 'MEMBER', provider: 'password', ...u } as User);

describe('prefillFromUser', () => {
  it('seeds name, email and every stored handle', () => {
    const out = prefillFromUser(asUser({
      name: 'Kevin', email: 'kstruck@gmail.com',
      paymentHandles: { venmo: '@kev', zelle: 'k@z.com', cashapp: '$kev', paypal: 'paypal.me/kev', googlePay: 'g@pay.com' },
    }));
    expect(out.managerName).toBe('Kevin');
    expect(out.contactEmail).toBe('kstruck@gmail.com');
    expect(out.paymentHandles).toEqual({
      venmo: '@kev', zelle: 'k@z.com', cashapp: '$kev', paypal: 'paypal.me/kev', googlePay: 'g@pay.com',
    });
  });

  it('returns EMPTY STRINGS, never undefined, for anything missing', () => {
    // react-hook-form warns when a field goes uncontrolled -> controlled, which
    // is what `undefined` here would cause the first time the user types.
    const out = prefillFromUser(asUser({}));
    expect(out.managerName).toBe('');
    expect(out.contactEmail).toBe('');
    for (const k of HANDLE_KEYS) expect(out.paymentHandles[k]).toBe('');
  });

  it('survives a null user without throwing', () => {
    const out = prefillFromUser(null);
    expect(out.managerName).toBe('');
    expect(Object.keys(out.paymentHandles).sort()).toEqual([...HANDLE_KEYS].sort());
  });

  it('trims stored values', () => {
    const out = prefillFromUser(asUser({ name: '  Kevin  ', paymentHandles: { venmo: ' @kev ' } }));
    expect(out.managerName).toBe('Kevin');
    expect(out.paymentHandles.venmo).toBe('@kev');
  });
});

describe('profileUpdatesFrom — learns blanks only', () => {
  it('saves a handle the profile did not have', () => {
    const u = asUser({ name: 'Kevin', paymentHandles: { venmo: '@kev' } });
    const out = profileUpdatesFrom(u, { paymentHandles: { venmo: '@kev', cashapp: '$new' } });
    expect(out?.paymentHandles).toEqual({ venmo: '@kev', cashapp: '$new' });
  });

  it('NEVER overwrites a handle the profile already holds', () => {
    // A commissioner using a different Venmo for one pool must not have their
    // default silently rewritten — every later pool would inherit the one-off.
    const u = asUser({ name: 'Kevin', paymentHandles: { venmo: '@default' } });
    const out = profileUpdatesFrom(u, { paymentHandles: { venmo: '@one-off' } });
    expect(out).toBeNull();
  });

  it('keeps the existing value while learning a new one in the same write', () => {
    const u = asUser({ name: 'Kevin', paymentHandles: { venmo: '@default' } });
    const out = profileUpdatesFrom(u, { paymentHandles: { venmo: '@one-off', zelle: 'k@z.com' } });
    expect(out?.paymentHandles).toEqual({ venmo: '@default', zelle: 'k@z.com' });
  });

  it('returns NULL when there is nothing new — the caller skips the write', () => {
    const u = asUser({ name: 'Kevin', paymentHandles: { venmo: '@kev' } });
    expect(profileUpdatesFrom(u, { paymentHandles: { venmo: '@kev' } })).toBeNull();
    expect(profileUpdatesFrom(u, {})).toBeNull();
  });

  it('fills a missing profile name from managerName', () => {
    const out = profileUpdatesFrom(asUser({ name: '' }), { managerName: 'Kevin' });
    expect(out?.name).toBe('Kevin');
  });

  it('does not rename a user who already has a name', () => {
    const out = profileUpdatesFrom(asUser({ name: 'Kevin' }), { managerName: 'Commissioner Kev' });
    expect(out).toBeNull();
  });

  it('NEVER writes email back', () => {
    // users/{uid}.email mirrors the Firebase Auth identity; the wizard's
    // contactEmail is a per-pool field and is allowed to differ. Writing one
    // into the other would desync the account from the address it signs in with.
    const out = profileUpdatesFrom(asUser({ name: '', email: 'auth@x.com' }), {
      managerName: 'Kevin', contactEmail: 'pool-contact@x.com',
    });
    expect(out).not.toBeNull();
    expect('email' in (out as object)).toBe(false);
  });

  it('never writes a rules-forbidden field', () => {
    // firestore.rules:496-499 rejects a self-write touching role/credits, and a
    // rejected write would lose the handles too. Nothing here should ever
    // produce those keys, so the shape is pinned rather than assumed.
    const out = profileUpdatesFrom(asUser({ name: '' }), {
      managerName: 'Kevin',
      paymentHandles: { venmo: '@kev' },
      role: 'SUPER_ADMIN',
      poolCredits: 999,
    });
    expect(Object.keys(out ?? {}).sort()).toEqual(['name', 'paymentHandles']);
  });

  it('ignores blank and whitespace-only typed values', () => {
    const out = profileUpdatesFrom(asUser({ name: '' }), {
      managerName: '   ',
      paymentHandles: { venmo: '  ', zelle: '' },
    });
    expect(out).toBeNull();
  });

  it('survives a null user', () => {
    expect(profileUpdatesFrom(null, { managerName: 'Kevin' })).toBeNull();
  });
});
