import { useEffect, useRef } from 'react';
import { effectiveSquareCap } from '@shared/squaresClaim';
import { mergeGuestSquares, readGuestKey } from '../utils/guestKey';

/**
 * A guest who has since signed in takes their guest squares into the account —
 * on this browser, where the device key lives. Without it a player who
 * reserved first and signed up second never saw those squares on their
 * dashboard and could not use "I've paid".
 *
 * This was an effect inside the grid, where nothing could test it, and four
 * rounds of review each found a way it gave up too early, asked too often or
 * remembered too much (qodo, PRs #758 – #762). The last of them is why it is
 * built the way it is now:
 *
 *   WHAT WAS WRONG. An answer was remembered for the browser session under
 *   "this pool, this account" — so a success that had moved nothing closed the
 *   door on squares reserved afterwards, a new browser key was answered with
 *   the old key's result, and three failures for one account were charged to
 *   the next one to sign in on the same grid.
 *
 *   THE RULE NOW. Nothing is remembered anywhere but here, for the life of
 *   the page, and only against the exact QUESTION it answered:
 *
 *   - it asks only when a square on the grid is held under THIS browser's
 *     key. Another guest's squares are not a reason to ask, and nothing is
 *     asked until this browser's hash has been computed;
 *   - the question is who is asking, which key, the pool's limit, how many
 *     squares the account holds and WHICH squares this browser holds. A
 *     question that has been answered is not asked again; a different one is;
 *   - when this browser holds nothing, there is no question, and the last
 *     answer is dropped — so the same squares, given up and reserved again,
 *     are a new question;
 *   - a chain that ends in failure is not an answer. It is asked again on the
 *     next change to the grid, and after three such failures FOR THAT POOL AND
 *     ACCOUNT it stops for the life of the page, so a broken backend is not
 *     called on every change. A result that lands after the player or the
 *     pool has changed is counted against the one that asked.
 */
export const GUEST_MERGE_FAILURES_BEFORE_GIVING_UP = 3;

export interface GuestMergeSquare {
  owner?: string | null;
  reservedByUid?: string | null;
  guestKeyHash?: string | null;
}

/** The squares still held under this browser's key, by position on the grid. None until its hash is known. */
export function guestSquaresOnThisBrowser(
  squares: ReadonlyArray<GuestMergeSquare>,
  guestKeyHash: string | null,
): number[] {
  if (!guestKeyHash) return [];
  const mine: number[] = [];
  squares.forEach((s, at) => {
    if (s.owner && !s.reservedByUid && s.guestKeyHash === guestKeyHash) mine.push(at);
  });
  return mine;
}

/**
 * The question a merge asks — everything its answer depends on: which key,
 * the pool's limit, how many squares the account holds, and which squares
 * this browser holds.
 */
export function guestMergeQuestion(
  squares: ReadonlyArray<GuestMergeSquare>,
  uid: string,
  guestKeyHash: string | null,
  cap: unknown,
): string {
  const onAccount = squares.filter((s) => s.owner && s.reservedByUid === uid).length;
  const limit = effectiveSquareCap(cap as number | null | undefined) ?? 'none';
  return `${guestKeyHash ?? '-'}|${limit}|${onAccount}|${guestSquaresOnThisBrowser(squares, guestKeyHash).join(',')}`;
}

/** What this page knows about one pool and account. */
interface MergeMemory {
  /** Chains that ended in failure. */
  failed: number;
  /** The question the grid poses now; null when this browser holds nothing. */
  latest: string | null;
  /** The last question that got an answer, kept only while the grid still poses it. */
  answered: string | null;
}

export function useGuestSquaresMerge(input: {
  uid: string | null | undefined;
  poolId: string | null | undefined;
  squares: ReadonlyArray<GuestMergeSquare>;
  /** The pool's `maxSquaresPerPlayer`, as stored. */
  cap: unknown;
  /** The hash of this browser's key on this pool, once it has been computed. */
  guestKeyHash: string | null;
  /**
   * The server call. Resolves `success: false` rather than throwing, and says
   * which squares it moved: a success that moved none is not a move.
   */
  claim: (guestKey: string) => Promise<{ success: boolean; overLimit?: boolean; claimed: ReadonlyArray<unknown> }>;
  /** This browser's key. A test passes its own. */
  readKey?: () => string | null;
}): void {
  const { uid, poolId, squares, cap, guestKeyHash } = input;
  // Per pool and account: a new player on the same grid starts with a clean slate.
  const memory = useRef(new Map<string, MergeMemory>());
  // The latest `claim` and `readKey`, without making their identity a reason
  // to ask again. Declared before the effect below so they are current in it.
  const claim = useRef(input.claim);
  const readKey = useRef(input.readKey ?? readGuestKey);
  const latestClaim = input.claim;
  const latestReadKey = input.readKey ?? readGuestKey;
  useEffect(() => {
    claim.current = latestClaim;
    readKey.current = latestReadKey;
  });

  useEffect(() => {
    if (!uid || !poolId) return;
    const who = `${poolId}:${uid}`;
    const known = memory.current.get(who) ?? { failed: 0, latest: null, answered: null };
    memory.current.set(who, known);

    if (guestSquaresOnThisBrowser(squares, guestKeyHash).length === 0) {
      // Nothing of this browser's to move: no question, and no answer to keep.
      known.latest = null;
      known.answered = null;
      return;
    }
    const question = guestMergeQuestion(squares, uid, guestKeyHash, cap);
    known.latest = question;
    if (known.failed >= GUEST_MERGE_FAILURES_BEFORE_GIVING_UP) return;
    if (known.answered === question) return;
    const key = readKey.current();
    if (!key) return;

    void mergeGuestSquares(poolId, uid, () => claim.current(key), question).then((ended) => {
      // `known` is the memory of the pool and account that ASKED, whoever is
      // on the grid by the time the answer lands.
      if (ended.outcome === 'failed') known.failed += 1;
      // The chain may have gone on to a later question; what it answered is
      // the one it says it answered, not the one this call started with. And
      // the grid often shows a move BEFORE the call that made it returns: an
      // answer to a question the grid no longer poses is not kept, or the
      // same squares reserved again later would be met with it.
      else if (ended.outcome !== 'in-flight') known.answered = known.latest === ended.question ? ended.question : null;
    });
  }, [uid, poolId, squares, guestKeyHash, cap]);
}
