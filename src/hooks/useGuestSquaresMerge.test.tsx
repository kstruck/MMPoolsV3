// @vitest-environment jsdom
//
// WHY jsdom: what is under test is WHEN an effect asks the server across
// re-renders — on what change it asks again, and when it stops — which only a
// rendered hook can show.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  GUEST_MERGE_FAILURES_BEFORE_GIVING_UP,
  guestMergeQuestion,
  guestSquaresOnThisBrowser,
  useGuestSquaresMerge,
  type GuestMergeSquare,
} from './useGuestSquaresMerge';

afterEach(cleanup);

const HASH = 'hash-of-this-browser';
const KEY = 'this-browsers-key';
type Answer = { success: boolean; overLimit?: boolean; claimed: number[] };

/**
 * `onAccount` squares on gina's account, then `asGuest` still under this
 * browser's key, then `others` held by a guest on some other browser, the
 * rest empty.
 */
function grid(onAccount: number, asGuest: number, others = 0, hash = HASH): GuestMergeSquare[] {
  const squares: GuestMergeSquare[] = [];
  for (let i = 0; i < onAccount; i++) squares.push({ owner: 'Gina', reservedByUid: 'gina' });
  for (let i = 0; i < asGuest; i++) squares.push({ owner: 'Gigi', reservedByUid: null, guestKeyHash: hash });
  for (let i = 0; i < others; i++) squares.push({ owner: 'Otto', reservedByUid: null, guestKeyHash: 'another-browser' });
  while (squares.length < 12) squares.push({ owner: null });
  return squares;
}

interface Props {
  squares: GuestMergeSquare[];
  cap?: unknown;
  uid?: string | null;
  poolId?: string;
  guestKeyHash?: string | null;
  key?: string | null;
}

let nextPool = 0;
function mount(initial: Props, answer: () => Promise<Answer>) {
  const ownPool = `pool-${++nextPool}`;
  const claim = vi.fn<(key: string) => Promise<Answer>>(() => answer());
  const hook = renderHook(
    (p: Props) =>
      useGuestSquaresMerge({
        uid: p.uid === undefined ? 'gina' : p.uid,
        poolId: p.poolId ?? ownPool,
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
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

const moves = () => Promise.resolve<Answer>({ success: true, overLimit: false, claimed: [1, 2] });
const movesNothing = () => Promise.resolve<Answer>({ success: true, overLimit: false, claimed: [] });
const refuses = () => Promise.resolve<Answer>({ success: true, overLimit: true, claimed: [] });
const fails = () => Promise.resolve<Answer>({ success: false, claimed: [] });
/** A claim the test answers when it chooses. */
function pending() {
  let answer!: (a: Answer) => void;
  const promise = new Promise<Answer>((res) => { answer = res; });
  return { promise: () => promise, answer };
}

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

describe('useGuestSquaresMerge — only THIS browser\'s squares are a reason to ask', () => {
  it('THE BUG: another guest\'s squares on the grid are not a reason to ask', async () => {
    const { claim } = mount({ squares: grid(1, 0, 3) }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
  });

  it('asks nothing until this browser\'s hash is known — then asks', async () => {
    const squares = grid(1, 2);
    const { claim, hook } = mount({ squares, guestKeyHash: null }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
    hook.rerender({ squares, guestKeyHash: HASH });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('THE BUG, end to end: a visit with nothing to move does not stop a later reservation being merged', async () => {
    // Signed in; the only guest squares on the grid are somebody else's.
    const { claim, hook } = mount({ squares: grid(1, 0, 2) }, moves);
    await settle();
    expect(claim).not.toHaveBeenCalled();
    // The player signs out and reserves two squares as a guest…
    hook.rerender({ squares: grid(1, 2, 2), uid: null });
    await settle();
    expect(claim).not.toHaveBeenCalled();
    // …and signs back in, in the same tab.
    hook.rerender({ squares: grid(1, 2, 2) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('useGuestSquaresMerge — an answer is kept only against the question it answered', () => {
  it('once the squares have moved, the same grid arriving again does not ask again', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, moves);
    await settle();
    // A snapshot from before the move lands, with somebody else's change in it.
    hook.rerender({ squares: grid(1, 2, 1) });
    await settle();
    // Then the grid with the move in it: nothing of this browser's is left.
    hook.rerender({ squares: grid(3, 0, 1) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('THE BUG: squares reserved as a guest AFTER a merge are merged too', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, moves);
    await settle();
    hook.rerender({ squares: grid(3, 0) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    hook.rerender({ squares: grid(3, 1), cap: 10 });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('…even when they are the very same squares, with the very same counts, as before', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, moves);
    await settle();
    // Merged; the account then gives both back; the browser reserves them again.
    hook.rerender({ squares: grid(3, 0) });
    hook.rerender({ squares: grid(1, 0) });
    await settle();
    hook.rerender({ squares: grid(1, 2) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('…and when the grid showed the move BEFORE the call that made it returned', async () => {
    const slow = pending();
    const { claim, hook } = mount({ squares: grid(1, 2) }, slow.promise);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    // The listener is quicker than the callable: the moved grid is here first.
    hook.rerender({ squares: grid(3, 0) });
    await settle();
    slow.answer({ success: true, overLimit: false, claimed: [1, 2] });
    await settle();
    // Later the account gives them back and the browser reserves them again —
    // and the listener, which delivers the latest state and not every step,
    // shows that as ONE change. There is no empty grid in between to clear
    // the old answer: it must not have been kept in the first place.
    hook.rerender({ squares: grid(1, 2) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('a success that moved nothing is not asked again for the same grid', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, movesNothing);
    await settle();
    hook.rerender({ squares: grid(1, 2, 1) });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('…and is asked again when this browser holds DIFFERENT squares, even if as many', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, movesNothing);
    await settle();
    // Still one on the account and two under this browser — but not the same two.
    const moved: GuestMergeSquare[] = grid(1, 0);
    moved[5] = { owner: 'Gigi', reservedByUid: null, guestKeyHash: HASH };
    moved[6] = { owner: 'Gigi', reservedByUid: null, guestKeyHash: HASH };
    hook.rerender({ squares: moved });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('THE BUG: a new browser key is a new question, whatever the old key was told', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, movesNothing);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    // The same counts and the same positions, held under a key minted since.
    hook.rerender({ squares: grid(1, 2, 0, 'hash-of-a-new-key'), guestKeyHash: 'hash-of-a-new-key', key: 'a-new-key' });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenLastCalledWith('a-new-key');
  });
});

describe('useGuestSquaresMerge — refused over the limit', () => {
  it('is not asked again while nothing it depends on has changed — even when the grid changes for others', async () => {
    const { claim, hook } = mount({ squares: grid(3, 2) }, refuses);
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    // Somebody else takes a square: a new array, the same question for this player.
    hook.rerender({ squares: grid(3, 2, 1) });
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
    const fewer = grid(3, 2);
    fewer[0] = { owner: null };
    hook.rerender({ squares: fewer });
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

  it('the limit is raised WHILE the first claim is in flight: the new question is asked when it lands, once', async () => {
    const answers: Array<() => Promise<Answer>> = [];
    const first = pending();
    answers.push(first.promise, moves);
    const squares = grid(3, 2);
    const { claim, hook } = mount({ squares, cap: 3 }, () => answers.shift()!());
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    hook.rerender({ squares, cap: 10 });
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);          // told to wait
    first.answer({ success: true, overLimit: true, claimed: [] });
    await settle();
    expect(claim).toHaveBeenCalledTimes(2);          // the new question, asked by the chain
    // What the chain answered is the NEW question: the same grid again asks nothing.
    hook.rerender({ squares: grid(3, 2, 1), cap: 10 });
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

  it('…and NOT by a re-render that changed nothing — the three attempts are not spent on redraws', async () => {
    const squares = grid(1, 2);
    const { claim, hook } = mount({ squares }, fails);
    await settle();
    for (let i = 0; i < 5; i++) {
      hook.rerender({ squares });
      await settle();
    }
    expect(claim).toHaveBeenCalledTimes(1);
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

  it('a success that moved nothing is not a failure either', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2), cap: 3 }, movesNothing);
    await settle();
    for (const cap of [4, 5, 6, 7, 8]) {
      hook.rerender({ squares: grid(1, 2), cap });
      await settle();
    }
    expect(claim).toHaveBeenCalledTimes(6);
  });
});

describe('useGuestSquaresMerge — failures are counted for the pool and account that asked', () => {
  /** A grid where omar holds one square on his account and this browser two as a guest. */
  const omars = () => {
    const squares = grid(0, 2);
    squares[8] = { owner: 'Omar', reservedByUid: 'omar' };
    return squares;
  };

  it('THE BUG: three failures for one account do not use up another account\'s attempts on the same grid', async () => {
    let answer = fails;
    const { claim, hook } = mount({ squares: grid(1, 2) }, () => answer());
    await settle();
    for (let i = 0; i < 4; i++) { hook.rerender({ squares: grid(1, 2) }); await settle(); }
    expect(claim).toHaveBeenCalledTimes(3);
    // Gina signs out; Omar signs in on the same grid, on the same browser.
    answer = moves;
    hook.rerender({ squares: omars(), uid: 'omar' });
    await settle();
    expect(claim).toHaveBeenCalledTimes(4);
  });

  it('THE BUG: nor another pool\'s, when the grid stays mounted across pools', async () => {
    let answer = fails;
    const { claim, hook } = mount({ squares: grid(1, 2), poolId: 'pool-that-fails' }, () => answer());
    await settle();
    for (let i = 0; i < 4; i++) { hook.rerender({ squares: grid(1, 2), poolId: 'pool-that-fails' }); await settle(); }
    expect(claim).toHaveBeenCalledTimes(3);
    answer = moves;
    hook.rerender({ squares: grid(1, 2), poolId: 'another-pool' });
    await settle();
    expect(claim).toHaveBeenCalledTimes(4);
  });

  it('the one that failed three times stays stopped when the player comes back to it', async () => {
    const { claim, hook } = mount({ squares: grid(1, 2) }, fails);
    await settle();
    for (let i = 0; i < 4; i++) { hook.rerender({ squares: grid(1, 2) }); await settle(); }
    hook.rerender({ squares: omars(), uid: 'omar' });   // omar: one failure of his own
    await settle();
    expect(claim).toHaveBeenCalledTimes(4);
    hook.rerender({ squares: grid(1, 2) });             // gina again
    await settle();
    expect(claim).toHaveBeenCalledTimes(4);
  });

  it('THE BUG: a failure that lands after the player has changed is charged to the one who asked', async () => {
    const ginas = pending();
    const answers: Array<() => Promise<Answer>> = [ginas.promise];
    const { claim, hook } = mount({ squares: grid(1, 2) }, () => (answers.shift() ?? fails)());
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);            // gina's, still in flight
    // Omar signs in before it lands, and his own three attempts all fail.
    hook.rerender({ squares: omars(), uid: 'omar' });
    await settle();
    ginas.answer({ success: false, claimed: [] });     // gina's failure lands now
    await settle();
    for (let i = 0; i < 5; i++) { hook.rerender({ squares: omars(), uid: 'omar' }); await settle(); }
    // 1 for gina + omar's full three. Had gina's late failure been charged to
    // omar he would have had two.
    expect(claim).toHaveBeenCalledTimes(4);
  });
});

describe('guestMergeQuestion — everything a merge\'s answer depends on', () => {
  it('names the key, the limit, the account\'s count and WHICH squares this browser holds', () => {
    expect(guestMergeQuestion(grid(3, 2), 'gina', HASH, 3)).toBe(`${HASH}|3|3|3,4`);
    expect(guestMergeQuestion(grid(1, 4), 'gina', HASH, 10)).toBe(`${HASH}|10|1|1,2,3,4`);
  });

  it('no limit — 0, absent or not a number — reads the same way every time', () => {
    for (const cap of [0, null, undefined, 'x', -1]) expect(guestMergeQuestion(grid(3, 2), 'gina', HASH, cap)).toBe(`${HASH}|none|3|3,4`);
  });

  it('does not change when OTHER players\' squares do', () => {
    const before = grid(3, 2);
    const after = grid(3, 2);
    after[8] = { owner: 'Bob', reservedByUid: 'bob' };
    after[9] = { owner: 'Bea', reservedByUid: null, guestKeyHash: 'somebody-elses-browser' };
    expect(guestMergeQuestion(after, 'gina', HASH, 3)).toBe(guestMergeQuestion(before, 'gina', HASH, 3));
  });

  it('changes with the key, with the limit, with the account\'s count and with which squares are held', () => {
    const base = guestMergeQuestion(grid(3, 2), 'gina', HASH, 3);
    expect(guestMergeQuestion(grid(3, 2, 0, 'other-key'), 'gina', 'other-key', 3)).not.toBe(base);
    expect(guestMergeQuestion(grid(3, 2), 'gina', HASH, 4)).not.toBe(base);
    expect(guestMergeQuestion(grid(2, 2), 'gina', HASH, 3)).not.toBe(base);
    const shifted = grid(3, 0);
    shifted[6] = { owner: 'Gigi', reservedByUid: null, guestKeyHash: HASH };
    shifted[7] = { owner: 'Gigi', reservedByUid: null, guestKeyHash: HASH };
    expect(guestMergeQuestion(shifted, 'gina', HASH, 3)).not.toBe(base);
  });
});

describe('guestSquaresOnThisBrowser', () => {
  it('is the positions of the squares still held under this browser\'s key', () => {
    expect(guestSquaresOnThisBrowser(grid(3, 2, 2), HASH)).toEqual([3, 4]);
  });

  it('is nothing until this browser\'s hash is known', () => {
    expect(guestSquaresOnThisBrowser(grid(3, 2), null)).toEqual([]);
  });

  it('a square already on an account is not this browser\'s to move, whatever hash it still carries', () => {
    const squares = grid(0, 0);
    squares[0] = { owner: 'Gina', reservedByUid: 'gina', guestKeyHash: HASH };
    expect(guestSquaresOnThisBrowser(squares, HASH)).toEqual([]);
  });

  it('a released square (no owner) is nobody\'s', () => {
    const squares = grid(0, 0);
    squares[0] = { owner: null, guestKeyHash: HASH };
    expect(guestSquaresOnThisBrowser(squares, HASH)).toEqual([]);
  });
});
