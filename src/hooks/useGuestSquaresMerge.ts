import { useEffect, useRef } from 'react';
import { effectiveSquareCap } from '@shared/squaresClaim';
import { claimGuestSquaresOnce, readGuestKey } from '../utils/guestKey';

/**
 * A guest who has since signed in takes their guest squares into the account —
 * on this browser, where the device key lives. Without it a player who
 * reserved first and signed up second never saw those squares on their
 * dashboard and could not use "I've paid".
 *
 * This was an effect inside the grid, where nothing could test it; three
 * rounds of review each found a way it gave up too early or asked too often
 * (qodo, PRs #758 – #761). It is a hook so the whole behaviour can be driven:
 *
 *   - it asks when there is something to ask about: a signed-in player, a
 *     browser key, and at least one guest square on the grid;
 *   - it asks again when the grid, the pool's limit or this browser's hash
 *     changes — `claimGuestSquaresOnce` decides whether the question is new;
 *   - it STOPS after three chains that ended in failure, for the life of the
 *     page, so a broken backend is not called on every change to the grid.
 */
export const GUEST_MERGE_FAILURES_BEFORE_GIVING_UP = 3;

export interface GuestMergeSquare {
  owner?: string | null;
  reservedByUid?: string | null;
  guestKeyHash?: string | null;
}

/** What an over-the-limit refusal depends on: the limit, the account's count, this browser's count. */
export function guestMergeRetryKey(
  squares: ReadonlyArray<GuestMergeSquare>,
  uid: string,
  guestKeyHash: string | null,
  cap: unknown,
): string {
  const onAccount = squares.filter((s) => s.owner && s.reservedByUid === uid).length;
  const onThisBrowser = guestKeyHash
    ? squares.filter((s) => s.owner && !s.reservedByUid && s.guestKeyHash === guestKeyHash).length
    : 0;
  return `${effectiveSquareCap(cap as number | null | undefined) ?? 'none'}:${onAccount}:${onThisBrowser}`;
}

export function useGuestSquaresMerge(input: {
  uid: string | null | undefined;
  poolId: string | null | undefined;
  squares: ReadonlyArray<GuestMergeSquare>;
  /** The pool's `maxSquaresPerPlayer`, as stored. */
  cap: unknown;
  /** The hash of this browser's key on this pool, once it has been computed. */
  guestKeyHash: string | null;
  /** The server call. Resolves `success: false` rather than throwing. */
  claim: (guestKey: string) => Promise<{ success: boolean; overLimit?: boolean }>;
  /** This browser's key. A test passes its own. */
  readKey?: () => string | null;
}): void {
  const { uid, poolId, squares, cap, guestKeyHash } = input;
  const failedChains = useRef(0);
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

  const hasUnclaimedGuestSquare = squares.some((s) => s.owner && s.guestKeyHash && !s.reservedByUid);

  useEffect(() => {
    if (!uid || !poolId || !hasUnclaimedGuestSquare) return;
    if (failedChains.current >= GUEST_MERGE_FAILURES_BEFORE_GIVING_UP) return;
    const key = readKey.current();
    if (!key) return;
    const retryKey = guestMergeRetryKey(squares, uid, guestKeyHash, cap);
    void claimGuestSquaresOnce(poolId, uid, () => claim.current(key), undefined, retryKey)
      .then((outcome) => { if (outcome === 'failed') failedChains.current += 1; });
  }, [uid, poolId, hasUnclaimedGuestSquare, squares, guestKeyHash, cap]);
}
