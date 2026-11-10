// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { GUEST_KEY_PREFIX, isCurrentGuestKey } from '@shared/squaresClaim';
import { GUEST_KEY_STORAGE, getOrCreateGuestKey, readGuestKey } from './guestKey';

/**
 * The guest device key (PLAN-SQUARES-REOPEN A3).
 *
 * The property that matters: the key under the OLD storage name was published
 * on every pool it was used in, so this module must never read it, reuse it or
 * hand it to the server.
 */
const LEGACY_NAME = 'mmp_guest_key';
const LEGACY_KEY = '11111111-2222-4333-8444-555555555555';

beforeEach(() => localStorage.clear());

describe('getOrCreateGuestKey', () => {
  it('mints a key the server honours, and keeps it', () => {
    const key = getOrCreateGuestKey();
    expect(isCurrentGuestKey(key)).toBe(true);
    expect(key.startsWith(GUEST_KEY_PREFIX)).toBe(true);
    expect(localStorage.getItem(GUEST_KEY_STORAGE)).toBe(key);
    expect(getOrCreateGuestKey()).toBe(key);
  });

  it('never reuses the published legacy key', () => {
    localStorage.setItem(LEGACY_NAME, LEGACY_KEY);
    const key = getOrCreateGuestKey();
    expect(key).not.toContain(LEGACY_KEY);
    // The legacy entry is left alone — it is simply never read.
    expect(localStorage.getItem(LEGACY_NAME)).toBe(LEGACY_KEY);
  });

  it('replaces a value under the NEW name that the server would not honour', () => {
    localStorage.setItem(GUEST_KEY_STORAGE, LEGACY_KEY);
    const key = getOrCreateGuestKey();
    expect(isCurrentGuestKey(key)).toBe(true);
    expect(key).not.toBe(LEGACY_KEY);
  });
});

describe('readGuestKey', () => {
  it('returns null and mints nothing when this browser has no key', () => {
    expect(readGuestKey()).toBeNull();
    expect(localStorage.getItem(GUEST_KEY_STORAGE)).toBeNull();
  });
  it('does not treat the legacy key as this browser having one', () => {
    localStorage.setItem(LEGACY_NAME, LEGACY_KEY);
    expect(readGuestKey()).toBeNull();
  });
  it('returns the key once one has been minted', () => {
    const key = getOrCreateGuestKey();
    expect(readGuestKey()).toBe(key);
  });
});
