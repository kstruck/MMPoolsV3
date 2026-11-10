// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUEST_KEY_PREFIX, isCurrentGuestKey, planClaim } from '@shared/squaresClaim';
import { GUEST_KEY_STORAGE, claimCodeFailureText, claimGuestSquaresOnce, claimIdentityFor, getOrCreateGuestKey, hashGuestKey, readGuestKey } from './guestKey';

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

describe('hashGuestKey — the browser computes the hash the server stores', () => {
  const POOL = 'pool-1';
  const KEY = `${GUEST_KEY_PREFIX}00000000-0000-4000-8000-000000000000`;
  // The SAME vector is pinned against the server's hashGuestKey in
  // functions/src/__tests__/guestKeyHash.test.ts. If one side changes, one test fails.
  const VECTOR = '5920afc84010a532bfeda347b4d6da138a7dc14f746bdb13f0939802072a6445';

  it('is sha256(poolId:key) in hex — byte for byte what the server writes on the square', async () => {
    expect(await hashGuestKey(POOL, KEY)).toBe(VECTOR);
  });

  it('is different on a different pool — one device cannot be followed across pools', async () => {
    expect(await hashGuestKey('pool-2', KEY)).not.toBe(VECTOR);
  });

  it('gives no hash for a key the server would not honour', async () => {
    expect(await hashGuestKey(POOL, LEGACY_KEY)).toBeNull();
    expect(await hashGuestKey(POOL, '')).toBeNull();
    expect(await hashGuestKey(POOL, null)).toBeNull();
    expect(await hashGuestKey('', KEY)).toBeNull();
  });
});

describe('claimGuestSquaresOnce — once means once it has WORKED', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
  };
  const ok = () => Promise.resolve({ success: true });
  const fail = () => Promise.resolve({ success: false });

  it('a successful claim is remembered and not repeated', async () => {
    const s = store();
    const claim = vi.fn(ok);
    expect(await claimGuestSquaresOnce('p', 'u', claim, s)).toBe('claimed');
    expect(await claimGuestSquaresOnce('p', 'u', claim, s)).toBe('already-done');
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('a FAILED claim is not remembered — the next attempt runs', async () => {
    const s = store();
    expect(await claimGuestSquaresOnce('p', 'u', fail, s)).toBe('failed');
    expect(s.data.size).toBe(0);
    const retry = vi.fn(ok);
    expect(await claimGuestSquaresOnce('p', 'u', retry, s)).toBe('claimed');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a claim that throws counts as failed, and frees the slot', async () => {
    const s = store();
    expect(await claimGuestSquaresOnce('p', 'u', () => Promise.reject(new Error('timeout')), s)).toBe('failed');
    expect(await claimGuestSquaresOnce('p', 'u', ok, s)).toBe('claimed');
  });

  it('never runs two at once for the same pool and account', async () => {
    const s = store();
    let finish!: (v: { success: boolean }) => void;
    const slow = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { finish = resolve; }));
    const first = claimGuestSquaresOnce('p', 'u', slow, s);
    expect(await claimGuestSquaresOnce('p', 'u', slow, s)).toBe('in-flight');
    finish({ success: true });
    expect(await first).toBe('claimed');
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('is kept per pool and per account', async () => {
    const s = store();
    await claimGuestSquaresOnce('p', 'u', ok, s);
    expect(await claimGuestSquaresOnce('p2', 'u', ok, s)).toBe('claimed');
    expect(await claimGuestSquaresOnce('p', 'u2', ok, s)).toBe('claimed');
  });

  it('still works with storage blocked — it just is not remembered', async () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(await claimGuestSquaresOnce('p', 'u', ok, blocked)).toBe('claimed');
  });
});

describe('claimIdentityFor — the page previews with the identity the server counts', () => {
  const POOL = 'pool-1';
  const KEY = `${GUEST_KEY_PREFIX}00000000-0000-4000-8000-000000000000`;

  it('a guest is this browser\'s hash and no account', async () => {
    expect(await claimIdentityFor(null, POOL, KEY)).toEqual({ uid: null, guestKeyHash: await hashGuestKey(POOL, KEY) });
    expect(await claimIdentityFor(undefined, POOL, KEY)).toEqual({ uid: null, guestKeyHash: await hashGuestKey(POOL, KEY) });
  });

  it('a SIGNED-IN player is the account AND this browser\'s hash — the server counts both', async () => {
    const identity = await claimIdentityFor('gina-uid', POOL, KEY);
    expect(identity.uid).toBe('gina-uid');
    expect(identity.guestKeyHash).toBe(await hashGuestKey(POOL, KEY));
    expect(identity.guestKeyHash).not.toBeNull();
  });

  it('a signed-in player on a browser that never reserved as a guest is the account alone', async () => {
    expect(await claimIdentityFor('gina-uid', POOL, null)).toEqual({ uid: 'gina-uid', guestKeyHash: null });
  });

  // The case the preview got wrong: guest squares that did not move to the
  // account (the merge would have passed the limit) and carry another name.
  it('so squares still held as a guest count toward the limit once signed in', async () => {
    const hash = await hashGuestKey(POOL, KEY);
    const squares = Array.from({ length: 10 }, (_, id) => ({ id, owner: null as string | null, reservedByUid: null as string | null, guestKeyHash: null as string | null }));
    squares[0] = { id: 0, owner: 'Gina', reservedByUid: 'gina-uid', guestKeyHash: null };
    squares[1] = { id: 1, owner: 'Gigi', reservedByUid: null, guestKeyHash: hash };
    squares[2] = { id: 2, owner: 'Gigi', reservedByUid: null, guestKeyHash: hash };
    const ask = (identity: { uid: string | null; guestKeyHash: string | null }) => planClaim({
      squares, squareIds: [5], identity, displayName: 'Gina', maxSquaresPerPlayer: 3, exemptFromCap: false, now: 1,
    });

    const plan = ask(await claimIdentityFor('gina-uid', POOL, KEY));
    expect(plan.ok).toBe(false);
    expect(plan.ok ? null : plan.refusal).toMatchObject({ code: 'LIMIT', cap: 3, held: 3 });

    // What the page used to preview with: the account alone. It said yes.
    expect(ask({ uid: 'gina-uid', guestKeyHash: null }).ok).toBe(true);
  });
});

describe('claimGuestSquaresOnce — refused over the limit is not "done"', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
  };
  const over = () => Promise.resolve({ success: true, overLimit: true });
  const moved = () => Promise.resolve({ success: true, overLimit: false });

  it('reports it, and does not ask the same question again', async () => {
    const s = store();
    const claim = vi.fn(over);
    expect(await claimGuestSquaresOnce('ol-1', 'u', claim, s, '3:3:2')).toBe('over-limit');
    expect(await claimGuestSquaresOnce('ol-1', 'u', claim, s, '3:3:2')).toBe('already-done');
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('asks again once the player has given up a square', async () => {
    const s = store();
    expect(await claimGuestSquaresOnce('ol-2', 'u', over, s, '3:3:2')).toBe('over-limit');
    const retry = vi.fn(moved);
    expect(await claimGuestSquaresOnce('ol-2', 'u', retry, s, '3:1:2')).toBe('claimed');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('asks again once the organizer has raised the limit', async () => {
    const s = store();
    expect(await claimGuestSquaresOnce('ol-3', 'u', over, s, '3:3:2')).toBe('over-limit');
    expect(await claimGuestSquaresOnce('ol-3', 'u', moved, s, '10:3:2')).toBe('claimed');
  });

  it('and once it HAS moved them, it is done whatever changes after', async () => {
    const s = store();
    await claimGuestSquaresOnce('ol-4', 'u', over, s, '3:3:2');
    await claimGuestSquaresOnce('ol-4', 'u', moved, s, '10:3:2');
    const again = vi.fn(moved);
    expect(await claimGuestSquaresOnce('ol-4', 'u', again, s, '10:5:0')).toBe('already-done');
    expect(again).not.toHaveBeenCalled();
  });

  it('still over the limit after the change is remembered against the NEW state', async () => {
    const s = store();
    await claimGuestSquaresOnce('ol-5', 'u', over, s, '3:3:2');
    expect(await claimGuestSquaresOnce('ol-5', 'u', over, s, '3:2:2')).toBe('over-limit');
    const claim = vi.fn(over);
    expect(await claimGuestSquaresOnce('ol-5', 'u', claim, s, '3:2:2')).toBe('already-done');
    expect(claim).not.toHaveBeenCalled();
  });

  it('a browser that blocks storage remembers the refusal for the page all the same', async () => {
    const claim = vi.fn(over);
    expect(await claimGuestSquaresOnce('ol-6', 'u', claim, null, '3:3:2')).toBe('over-limit');
    expect(await claimGuestSquaresOnce('ol-6', 'u', claim, null, '3:3:2')).toBe('already-done');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(await claimGuestSquaresOnce('ol-6', 'u', moved, null, '3:1:2')).toBe('claimed');
  });

  it('a refusal is not a failure — it does not count toward giving up', async () => {
    expect(await claimGuestSquaresOnce('ol-7', 'u', over, store(), 'k')).not.toBe('failed');
  });
});

describe('claimCodeFailureText — the player is told what the server said', () => {
  const refused = (code: string, message: string) => Object.assign(new Error(message), { code });

  it('a code that has been used: the server\'s own words, which say to get a new one', () => {
    const text = claimCodeFailureText(refused('functions/failed-precondition',
      'This claim code has already been used. Generate a new one on the device that reserved the squares.'));
    expect(text).toMatch(/already been used/);
    expect(text).toMatch(/Generate a new one/);
  });

  it('expired, over the limit and too many tries are passed on too', () => {
    expect(claimCodeFailureText(refused('functions/failed-precondition', 'This claim code has expired.'))).toBe('This claim code has expired.');
    expect(claimCodeFailureText(refused('failed-precondition', 'This pool allows 3 squares per player.'))).toBe('This pool allows 3 squares per player.');
    expect(claimCodeFailureText(refused('functions/resource-exhausted', 'Too many attempts. Try again later.'))).toBe('Too many attempts. Try again later.');
  });

  it('a code nobody issued gets a plain sentence, not the server\'s "Invalid claim code"', () => {
    expect(claimCodeFailureText(refused('functions/not-found', 'Invalid claim code'))).toMatch(/not recognised/);
  });

  it('anything else — an internal error, a dropped connection — is not shown raw', () => {
    for (const e of [refused('functions/internal', 'INTERNAL'), refused('functions/unavailable', 'deadline'), new Error('boom'), null, undefined, 'x', {}]) {
      expect(claimCodeFailureText(e)).toBe('The squares could not be moved. Try again in a moment.');
    }
  });

  it('a refusal with no words falls back rather than showing nothing', () => {
    expect(claimCodeFailureText(refused('functions/failed-precondition', '   '))).toBe('The squares could not be moved. Try again in a moment.');
  });
});

