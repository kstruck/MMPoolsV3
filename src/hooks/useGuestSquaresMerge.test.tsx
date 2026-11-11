// @vitest-environment jsdom
//
// WHY jsdom: what is under test is WHEN an effect asks the server across
// re-renders — on what change it asks again, and when it stops — which only a
// rendered hook can show.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  GUEST_MERGE_FAILURES_BEFORE_GIVING_UP,
  guestMergeRetryKey,
  useGuestSquaresMerge,
  type GuestMergeSquare,
} from './useGuestSquaresMerge';

afterEach(cleanup);
// The helper remembers answers per pool and account for the session; each
// test gets a pool id of its own, and the session store is emptied.
beforeEach(() => { sessionStorage.clear(); });

const HASH = 'hash-of-this-browser';
const KEY = 'this-browsers-key';
type Answer = { success: boolean; overLimit?: boolean };

/** `onAccount` squares on the account, `asGuest` still under this browser's key, the rest empty. */
function grid(onAccount: number, asGuest: number): GuestMergeSquare[] {
  const squares: GuestMergeSquare[] = [];
  for (let i = 0; i < onAccount; i++) squares.push({ owner: 'Gina', reservedByUid: 'gina' });
  for (let i = 0; i < asGuest; i++) squares.push({ owner: 'Gigi', reservedByUid: null, guestKeyHash: HASH });
  while (squares.length < 10) squares.push({ owner: null });
  return squares;
}

let nextPool = 0;
function mount(initial: { squares: GuestMergeSquare[]; cap?: unknown; uid?: string | null; guestKeyHash?: string | null; key?: string | null }, answer: () => Promise<Answer>) {
  const poolId = `pool-${++nextPool}`;
  const claim = vi.fn<(key: string) => Promise<Answer>>(() => answer());
  const hook = renderHook(
    (p: { squares: GuestMergeSquare[]; cap?: unknown; uid?: string | null; guestKeyHash?: string | null; key?: string | null }) =>
      useGuestSquaresMerge({
        uid: p.uid === undefined ? 'gina' : p.uid,
        poolId,
        squares: p.squares,
        cap: p.cap === undefined ? 3 : p.cap,
        guestKeyHash: p.guestKeyHash === undefined ? HASH : p.guestKeyHash,
        // A new function every render, as the grid passes one.
        claim: (key) => claim(key),
        readKey: () => (p.key === undefined ? KEY : p.key),
      }),
    { initialProps: initial },
  );
  return { claim, hook };
}
/** Let the claim's promise and the chain after it settle. */
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

const moves = () => Promise.resolve<Answer>({ success: true, overLimit: false });
const refuses = () => Promise.resolve<Answer>({ success: true, overLimit: true });
const fails = () => Promise.resolve<Answer>({ success: false });

describe('useGuestSquaresMerge — when it asks', () => {
  it('asks once, with this browser\'s key, when a signed-in player has guest squares here', async () => {
    const { claim } = mount({ squares: grid(1, 2) }, moves);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(KEY);
  });

  it('asks nothing for a visitor who is not signed in', async () => {
    const { claim } = mount({ squares: grid(0, 2), uid: null }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
  });

  it('asks nothing when the grid has no guest squares at all', async () => {
    const { claim } = mount({ squares: grid(3, 0) }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
  });

  it('asks nothing from a browser that never reserved as a guest', async () => {
    const { claim } = mount({ squares: grid(0, 2), key: null }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
  });

  it('a re-render with nothing changed does not ask again', async () => {
    const squares = grid(1, 2);
    const { claim, hook } = mount({ squares }, refuses);
    await settle();
    hook.rerender({ squares });
    hook.rerender({ squares });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('useGuestSquaresMerge — refused over the limit', () => {
  it('is not asked again while nothing it depends on has changed — even when the grid changes for others', async () => {
    const { claim, hook } = mount({ squares: grid(3, 2) }, refuses);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    // Somebody else takes a square: a new array, the same counts for this player.
    const others = grid(3, 2);
    others[9] = { owner: 'Someone Else', reservedByUid: 'other' };
    hook.rerender({ squares: others });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('is asked again when the organizer raises the limit', async () => {
    const squares = grid(3, 2);
    const { claim, hook } = mount({ squares, cap: 3 }, refuses);
    await settle();
    hook.rerender({ squares, cap: 10 });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('is asked again when the player gives up a square', async () => {
    const { claim, hook } = mount({ squares: grid(3, 2) }, refuses);
    await settle();
    hook.rerender({ squares: grid(1, 2) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('is asked again when the limit is removed', async () => {
    const squares = grid(3, 2);
    const { claim, hook } = mount({ squares, cap: 3 }, refuses);
    await settle();
    hook.rerender({ squares, cap: 0 });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });
});

describe('useGuestSquaresMerge — failures', () => {
  it('a failed attempt is retried the next time the grid changes', async () => {
    let answer = fails;
    const { claim, hook } = mount({ squares: grid(1, 2) }, () => answer());
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    answer = moves;
    hook.rerender({ squares: grid(1, 2) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('THE BOUND: after three failures it stops asking for the life of the page', async () => {
    expect(GUEST_MERGE_FAILURES_BEFORE_GIVING_UP).toBe(3);
    const { claim, hook } = mount({ squares: grid(1, 2) }, fails);
    await settle();
    for (let i = 0; i < 6; i++) {
      hook.rerender({ squares: grid(1, 2) });
      await settle();
    }
    expect(claim).toHaveBeenCalledTimes(3);
  });

  it('a refusal over the limit is not a failure — it does not use up the three', async () => {
    const { claim, hook } = mount({ squares: grid(3, 2), cap: 3 }, refuses);
    await settle();
    // Five changes of the limit, five more refusals; it is still willing to ask.
    for (const cap of [4, 5, 6, 7, 8]) {
      hook.rerender({ squares: grid(9, 2), cap });
      await settle();
    }
    expect(claim).toHaveBeenCalledTimes(6);
  });

  it('once the squares have moved it is done, whatever changes after', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, moves);
    await settle();
    hook.rerender({ squares: grid(3, 1), cap: 10 });
    hook.rerender({ squares: grid(3, 2), cap: 0 });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('guestMergeRetryKey — what an over-the-limit answer depends on', () => {
  it('is the limit, the account\'s count and this browser\'s count', () => {
    expect(guestMergeRetryKey(grid(3, 2), 'gina', HASH, 3)).toBe('3:3:2');
    expect(guestMergeRetryKey(grid(1, 4), 'gina', HASH, 10)).toBe('10:1:4');
  });

  it('no limit — 0, absent or not a number — reads the same way every time', () => {
    for (const cap of [0, null, undefined, 'x', -1]) expect(guestMergeRetryKey(grid(3, 2), 'gina', HASH, cap)).toBe('none:3:2');
  });

  it('does not change when OTHER players\' squares do', () => {
    const before = grid(3, 2);
    const after = grid(3, 2);
    after[8] = { owner: 'Bob', reservedByUid: 'bob' };
    after[9] = { owner: 'Bea', reservedByUid: null, guestKeyHash: 'somebody-elses-browser' };
    expect(guestMergeRetryKey(after, 'gina', HASH, 3)).toBe(guestMergeRetryKey(before, 'gina', HASH, 3));
  });

  it('counts nothing for this browser until its hash is known', () => {
    expect(guestMergeRetryKey(grid(3, 2), 'gina', null, 3)).toBe('3:3:0');
  });

  it('a released square (no owner) is nobody\'s', () => {
    const squares = grid(0, 0);
    squares[0] = { owner: null, reservedByUid: 'gina' };
    squares[1] = { owner: null, guestKeyHash: HASH };
    expect(guestMergeRetryKey(squares, 'gina', HASH, 3)).toBe('3:0:0');
  });
});
