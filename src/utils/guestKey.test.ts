// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUEST_KEY_PREFIX, isCurrentGuestKey, planClaim } from '@shared/squaresClaim';
import { GUEST_KEY_STORAGE, claimCodeFailureText, claimIdentityFor, getOrCreateGuestKey, hashGuestKey, mergeGuestSquares, readGuestKey } from './guestKey';

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

describe('mergeGuestSquares — one at a time, and told how it ended', () => {
  type Result = { success: boolean; overLimit?: boolean; claimed?: number[] };
  /** A claim the test answers when it chooses. */
  const pending = () => {
    let answer!: (r: Result) => void;
    const promise = new Promise<Result>((res) => { answer = res; });
    return { claim: vi.fn(() => promise), answer };
  };
  const moves = () => vi.fn(() => Promise.resolve<Result>({ success: true, overLimit: false, claimed: [3, 4] }));
  const refuses = () => vi.fn(() => Promise.resolve<Result>({ success: true, overLimit: true, claimed: [] }));
  const movesNothing = () => vi.fn(() => Promise.resolve<Result>({ success: true, overLimit: false, claimed: [] }));
  const fails = () => vi.fn(() => Promise.resolve<Result>({ success: false }));

  describe('what one call reports', () => {
    it('squares moved', async () => {
      expect(await mergeGuestSquares('r-1', 'u', moves(), 'q')).toEqual({ outcome: 'claimed', question: 'q' });
    });

    it('refused over the limit — which is an answer, not a failure', async () => {
      expect(await mergeGuestSquares('r-2', 'u', refuses(), 'q')).toEqual({ outcome: 'over-limit', question: 'q' });
    });

    it('THE BUG: a success that moved NOTHING is not a move', async () => {
      expect(await mergeGuestSquares('r-3', 'u', movesNothing(), 'q')).toEqual({ outcome: 'nothing-moved', question: 'q' });
    });

    it('a success that does not say what it moved is not taken as a move', async () => {
      const silent = () => Promise.resolve<Result>({ success: true });
      expect((await mergeGuestSquares('r-4', 'u', silent, 'q')).outcome).toBe('nothing-moved');
    });

    it('a call the server refused outright is a failure', async () => {
      expect(await mergeGuestSquares('r-5', 'u', fails(), 'q')).toEqual({ outcome: 'failed', question: 'q' });
    });

    it('a call that throws is a failure, not an escape', async () => {
      await expect(mergeGuestSquares('r-6', 'u', () => Promise.reject(new Error('offline')), 'q'))
        .resolves.toEqual({ outcome: 'failed', question: 'q' });
    });
  });

  describe('it remembers nothing', () => {
    it('THE BUG: an answered question is asked again if the caller asks it — whether to ask is the caller\'s to decide', async () => {
      const claim = movesNothing();
      await mergeGuestSquares('m-1', 'u', claim, 'q');
      await mergeGuestSquares('m-1', 'u', claim, 'q');
      expect(claim).toHaveBeenCalledTimes(2);
      const moving = moves();
      await mergeGuestSquares('m-1', 'u', moving, 'q');
      await mergeGuestSquares('m-1', 'u', moving, 'q');
      expect(moving).toHaveBeenCalledTimes(2);
    });

    it('leaves nothing in the browser session', async () => {
      sessionStorage.clear();
      await mergeGuestSquares('m-2', 'u', moves(), 'q');
      await mergeGuestSquares('m-2', 'u', refuses(), 'q2');
      await mergeGuestSquares('m-2', 'u', movesNothing(), 'q3');
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe('never two at once', () => {
    it('a second call while the first is in flight is told so, and does not reach the server', async () => {
      const first = pending();
      const chain = mergeGuestSquares('f-1', 'u', first.claim, 'q');
      const second = moves();
      expect(await mergeGuestSquares('f-1', 'u', second, 'q')).toEqual({ outcome: 'in-flight', question: 'q' });
      expect(second).not.toHaveBeenCalled();
      first.answer({ success: true, claimed: [1] });
      expect((await chain).outcome).toBe('claimed');
      expect(first.claim).toHaveBeenCalledTimes(1);
    });

    it('a claim that throws frees the slot', async () => {
      expect((await mergeGuestSquares('f-2', 'u', () => Promise.reject(new Error('timeout')), 'q')).outcome).toBe('failed');
      expect((await mergeGuestSquares('f-2', 'u', moves(), 'q')).outcome).toBe('claimed');
    });

    it('another pool, or another account, is another flight', async () => {
      const first = pending();
      const chain = mergeGuestSquares('f-3', 'u', first.claim, 'q');
      expect((await mergeGuestSquares('f-3b', 'u', moves(), 'q')).outcome).toBe('claimed');
      expect((await mergeGuestSquares('f-3', 'u2', moves(), 'q')).outcome).toBe('claimed');
      first.answer({ success: true, claimed: [1] });
      await chain;
    });
  });

  describe('one call is one chain: the claim and the questions that arrive meanwhile', () => {
    it('the limit is raised while a claim is in flight: the old refusal is followed by the new question', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-1', 'u', first.claim, 'limit-3');

      // The organizer raises the limit; the page asks again and is told to wait.
      const second = moves();
      expect((await mergeGuestSquares('ch-1', 'u', second, 'limit-10')).outcome).toBe('in-flight');
      expect(second).not.toHaveBeenCalled();

      // The first claim read the pool before the change, so it is refused…
      first.answer({ success: true, overLimit: true, claimed: [] });
      // …and the chain goes on to ask the new question, and reports THAT
      // answer, against the question it belongs to.
      expect(await chain).toEqual({ outcome: 'claimed', question: 'limit-10' });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('a claim that FAILS does not throw away the question that arrived meanwhile', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-2', 'u', first.claim, 'limit-3');
      const second = moves();
      await mergeGuestSquares('ch-2', 'u', second, 'limit-10');
      first.answer({ success: false });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'limit-10' });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('a follow-up that fails is REPORTED — the caller sees how the chain ended', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-3', 'u', first.claim, 'limit-3');
      const second = fails();
      await mergeGuestSquares('ch-3', 'u', second, 'limit-10');
      first.answer({ success: true, overLimit: true, claimed: [] });
      expect(await chain).toEqual({ outcome: 'failed', question: 'limit-10' });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('a claim that moved NOTHING is followed by the question that arrived meanwhile', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-3b', 'u', first.claim, 'holds-none');
      const second = moves();
      await mergeGuestSquares('ch-3b', 'u', second, 'holds-two');
      first.answer({ success: true, overLimit: false, claimed: [] });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'holds-two' });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('the SAME question asked mid-flight is not asked again once it has been answered', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-4', 'u', first.claim, 'limit-3');
      const again = refuses();
      expect((await mergeGuestSquares('ch-4', 'u', again, 'limit-3')).outcome).toBe('in-flight');
      first.answer({ success: true, overLimit: true, claimed: [] });
      expect(await chain).toEqual({ outcome: 'over-limit', question: 'limit-3' });
      expect(again).not.toHaveBeenCalled();
    });

    it('…but after a FAILURE the same question is asked again: nothing has answered it', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-4b', 'u', first.claim, 'q');
      const again = moves();
      await mergeGuestSquares('ch-4b', 'u', again, 'q');
      first.answer({ success: false });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'q' });
      expect(again).toHaveBeenCalledTimes(1);
    });

    it('a claim that MOVED the squares ends the chain: the waiting question was asked of a grid that is gone', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-5', 'u', first.claim, 'before');
      const later = moves();
      await mergeGuestSquares('ch-5', 'u', later, 'after');
      first.answer({ success: true, overLimit: false, claimed: [1, 2] });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'before' });
      expect(later).not.toHaveBeenCalled();
    });

    it('only the NEWEST question asked mid-flight is followed up', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-6', 'u', first.claim, 'limit-3');
      const stale = refuses();
      const newest = moves();
      await mergeGuestSquares('ch-6', 'u', stale, 'limit-4');
      await mergeGuestSquares('ch-6', 'u', newest, 'limit-10');
      first.answer({ success: true, overLimit: true, claimed: [] });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'limit-10' });
      expect(stale).not.toHaveBeenCalled();
      expect(newest).toHaveBeenCalledTimes(1);
    });

    it('a call made while a FOLLOW-UP is in flight waits too — the chain is one flight', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-7', 'u', first.claim, 'limit-3');
      const followUp = pending();
      await mergeGuestSquares('ch-7', 'u', followUp.claim, 'limit-4');
      first.answer({ success: true, overLimit: true, claimed: [] });
      await new Promise((r) => setTimeout(r, 0));
      expect(followUp.claim).toHaveBeenCalledTimes(1);
      // The follow-up is on its way; a third question arrives.
      const third = moves();
      expect((await mergeGuestSquares('ch-7', 'u', third, 'limit-10')).outcome).toBe('in-flight');
      followUp.answer({ success: true, overLimit: true, claimed: [] });
      expect(await chain).toEqual({ outcome: 'claimed', question: 'limit-10' });
      expect(third).toHaveBeenCalledTimes(1);
    });

    it('a chain asks at most three times, however many questions keep arriving', async () => {
      const asked: string[] = [];
      // Every answer is a failure, and every ask queues a new, different question.
      const failing = (label: string): (() => Promise<Result>) => async () => {
        asked.push(label);
        void mergeGuestSquares('ch-8', 'u', failing(`${label}+`), `key-${label}+`);
        return { success: false };
      };
      expect((await mergeGuestSquares('ch-8', 'u', failing('a'), 'key-a')).outcome).toBe('failed');
      expect(asked).toEqual(['a', 'a+', 'a++']);

      // The third ask left a fourth question waiting. It ended with the chain:
      // a new chain that is refused does not find it and ask it.
      expect((await mergeGuestSquares('ch-8', 'u', refuses(), 'key-z')).outcome).toBe('over-limit');
      expect(asked).toEqual(['a', 'a+', 'a++']);
    });

    it('a question still waiting when a chain ends does not leak into the next chain', async () => {
      const first = pending();
      const chain = mergeGuestSquares('ch-9', 'u', first.claim, 'before');
      const waiting = moves();
      await mergeGuestSquares('ch-9', 'u', waiting, 'other');
      first.answer({ success: true, overLimit: false, claimed: [1] });   // moved: the waiting question is moot
      await chain;
      expect(waiting).not.toHaveBeenCalled();
      // The next chain for the same pool and account is refused. A refusal
      // goes looking for a question that arrived meanwhile — and finds none.
      expect((await mergeGuestSquares('ch-9', 'u', refuses(), 'new')).outcome).toBe('over-limit');
      expect(waiting).not.toHaveBeenCalled();
    });
  });
});
