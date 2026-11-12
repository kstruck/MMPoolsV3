// @vitest-environment jsdom
//
// WHY jsdom: the property under test is WHEN an effect fires across re-renders,
// which only a rendered hook can show.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useAccountPrefill, type AccountIdentity } from './useAccountPrefill';

afterEach(cleanup);

const olivia = (): AccountIdentity => ({ id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' });

function mount(initial: AccountIdentity | null) {
  const fill = vi.fn();
  const hook = renderHook(({ user }: { user: AccountIdentity | null }) => useAccountPrefill(user, fill), {
    initialProps: { user: initial },
  });
  return { fill, rerender: (user: AccountIdentity | null) => hook.rerender({ user }) };
}

describe('useAccountPrefill — a form is filled from the account when the ACCOUNT changes', () => {
  it('fills once when someone is signed in', () => {
    const { fill } = mount(olivia());
    expect(fill).toHaveBeenCalledTimes(1);
    expect(fill).toHaveBeenCalledWith({ name: 'Olivia Owner', email: 'olivia@example.com' });
  });

  it('THE DEFECT: a fresh copy of the same account does not fill again — a name typed for someone else survives', () => {
    // The app hands down a new user object whenever anything on the user's
    // document changes. Same person, same name, same email: nothing to refill.
    const { fill, rerender } = mount(olivia());
    for (let i = 0; i < 5; i++) rerender(olivia());
    rerender({ ...olivia(), ...({ role: 'COMMISSIONER', lastSeen: 123 } as object) });
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('does nothing while signed out', () => {
    const { fill, rerender } = mount(null);
    rerender(null);
    expect(fill).not.toHaveBeenCalled();
  });

  it('fills when someone signs in after the page loaded', () => {
    const { fill, rerender } = mount(null);
    rerender(olivia());
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('fills again for a DIFFERENT account', () => {
    const { fill, rerender } = mount(olivia());
    rerender({ id: 'u2', name: 'Ray Other', email: 'ray@example.com' });
    expect(fill).toHaveBeenCalledTimes(2);
    expect(fill).toHaveBeenLastCalledWith({ name: 'Ray Other', email: 'ray@example.com' });
  });

  it('fills again for a different account even when it carries the same name and email', () => {
    const { fill, rerender } = mount(olivia());
    rerender({ ...olivia(), id: 'u2' });
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('fills again when the account\'s own name or email changes — the profile loading in, or being edited', () => {
    const { fill, rerender } = mount({ id: 'u1' });
    expect(fill).toHaveBeenLastCalledWith({ name: '', email: '' });
    rerender({ id: 'u1', name: 'Olivia Owner' });
    expect(fill).toHaveBeenLastCalledWith({ name: 'Olivia Owner', email: '' });
    rerender({ id: 'u1', name: 'Olivia Owner', email: 'olivia@example.com' });
    expect(fill).toHaveBeenLastCalledWith({ name: 'Olivia Owner', email: 'olivia@example.com' });
    expect(fill).toHaveBeenCalledTimes(3);
  });

  it('signing out and back in as the same person fills again', () => {
    const { fill, rerender } = mount(olivia());
    rerender(null);
    rerender(olivia());
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('always calls the LATEST fill, without a new fill being a reason to run', () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ user, fill }: { user: AccountIdentity; fill: typeof first }) => useAccountPrefill(user, fill), {
      initialProps: { user: olivia(), fill: first },
    });
    hook.rerender({ user: olivia(), fill: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    hook.rerender({ user: { ...olivia(), name: 'Olivia O.' }, fill: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
