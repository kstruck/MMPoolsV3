import { GUEST_KEY_PREFIX, isCurrentGuestKey } from '@shared/squaresClaim';

/**
 * The guest's device key (PLAN-SQUARES-REOPEN A3).
 *
 * A guest reserves squares with no account; this random key, held only in this
 * browser, is how they later prove those squares are theirs. The server stores
 * a HASH of it and never the key.
 *
 * 🛑 A NEW STORAGE NAME, ON PURPOSE. The key under the old name
 * (`mmp_guest_key`) was written onto every square of the world-readable pool
 * document, so it has been published on every pool it was ever used in. It is
 * left where it is and never read again; the server ignores any key without the
 * current prefix.
 */
export const GUEST_KEY_STORAGE = 'mmp_guest_key_v2';

/** This browser's key, or `null` if it has not reserved as a guest yet. Never mints one. */
export function readGuestKey(): string | null {
  try {
    const key = localStorage.getItem(GUEST_KEY_STORAGE);
    return isCurrentGuestKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** This browser's key, minting it on first use. */
export function getOrCreateGuestKey(): string {
  const existing = readGuestKey();
  if (existing) return existing;
  const key = `${GUEST_KEY_PREFIX}${crypto.randomUUID()}`;
  try {
    localStorage.setItem(GUEST_KEY_STORAGE, key);
  } catch {
    // Storage blocked (private mode): the key lasts for this page only. The
    // squares are still reserved under the name; they just cannot be claimed
    // into an account from this browser later.
  }
  return key;
}

/**
 * The hash the SERVER stores for this browser's key on a given pool:
 * `sha256(poolId + ":" + key)`, hex. Must stay byte-for-byte equal to
 * `hashGuestKey` in `functions/src/lib/guestKey.ts` — pinned by a test that
 * runs both over the same input.
 *
 * WHY THE BROWSER COMPUTES IT. A guest's squares are identified on the pool
 * document by this hash and nothing else. Without it the page cannot tell which
 * squares are this guest's, so its preview of the limit undercounted them and
 * let through a selection the server then refused (qodo, PR #758).
 *
 * Resolves `null` where Web Crypto is unavailable (an insecure origin): the
 * page then previews by name only and the server still decides.
 */
export async function hashGuestKey(poolId: string, key: string | null | undefined): Promise<string | null> {
  if (!poolId || !isCurrentGuestKey(key)) return null;
  try {
    const bytes = new TextEncoder().encode(`${poolId}:${key}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * WHO THE SERVER WILL COUNT THIS CLAIM AGAINST: the account if there is one,
 * AND this browser's guest hash — both, not one or the other.
 *
 * `reserveSquaresForCaller` hashes the key the page sends whether or not the
 * player is signed in, and counts squares held under either. The pool page's
 * preview dropped the hash for a signed-in player, so somebody whose guest
 * squares had NOT moved to their account (the merge is refused when it would
 * pass the per-player limit) was shown a selection as fine and then refused by
 * the server (qodo, PR #761). The grid already counted both; this is the one
 * place that builds the identity, so the two cannot differ again.
 */
export async function claimIdentityFor(
  uid: string | null | undefined,
  poolId: string,
  guestKey: string | null | undefined,
): Promise<{ uid: string | null; guestKeyHash: string | null }> {
  return { uid: uid || null, guestKeyHash: await hashGuestKey(poolId, guestKey) };
}

/**
 * Take this browser's guest squares into the signed-in account — one call at
 * a time for a pool and account, and told how it ended.
 *
 * THIS REMEMBERS NOTHING. It used to keep "done" in the browser session under
 * the pool and the account, and every round of review found another way that
 * memory outlived what it meant (qodo, PRs #758 – #762): recorded before the
 * call, so one timeout ended it; recorded for a refusal; recorded for a
 * success that had moved nothing, so squares reserved afterwards stayed
 * outside the account; kept across a change of browser key. Whether a
 * question has been answered is decided by the caller, which can see the grid
 * (`useGuestSquaresMerge`). What is left here is what only this can do:
 *
 *  1. NEVER TWO AT ONCE. While a claim for a pool and account is in flight,
 *     another call returns `in-flight`.
 *  2. A QUESTION ASKED MEANWHILE IS NOT DROPPED. The newest one is kept and
 *     asked when the flight lands — after a refusal, a success that moved
 *     nothing, or a failure. Not after a claim that MOVED the squares: that
 *     question was asked of a grid that no longer exists. And not if it is
 *     the very question that has just been answered.
 *  3. THE CALLER IS TOLD HOW THE WHOLE CHAIN ENDED, and which question that
 *     answer belongs to — the follow-up used to be fired and forgotten, so a
 *     follow-up that failed was seen by nobody.
 *
 * So one call is one CHAIN: the claim, then at most two follow-ups.
 */
type ClaimResult = {
  success: boolean;
  overLimit?: boolean;
  /** The squares the server moved. Empty, or absent, means it moved none. */
  claimed?: ReadonlyArray<unknown>;
};
type Claim = () => Promise<ClaimResult>;
/** A real answer from the server, as opposed to no answer at all. */
type Answer = 'claimed' | 'nothing-moved' | 'over-limit';
export type GuestMergeOutcome = Answer | 'in-flight' | 'failed';
export interface GuestMergeEnd {
  outcome: GuestMergeOutcome;
  /** The question the outcome belongs to: the last one this chain asked. */
  question: string;
}

const mergesInFlight = new Set<string>();
const askedMeanwhile = new Map<string, { claim: Claim; question: string }>();
/** A chain is the claim plus at most this many follow-ups, however many questions arrive. */
const MAX_ASKS_PER_CHAIN = 3;

async function askOnce(claim: Claim): Promise<Answer | 'failed'> {
  let result: ClaimResult;
  try {
    result = await claim();
  } catch {
    return 'failed';
  }
  if (!result.success) return 'failed';
  if (result.overLimit === true) return 'over-limit';
  return Array.isArray(result.claimed) && result.claimed.length > 0 ? 'claimed' : 'nothing-moved';
}

export async function mergeGuestSquares(
  poolId: string,
  uid: string,
  claim: Claim,
  /** What the answer depends on. Used only to tell one question from another. */
  question = '',
): Promise<GuestMergeEnd> {
  const flight = `${poolId}:${uid}`;
  if (mergesInFlight.has(flight)) {
    // Only the newest question matters; an older one waiting is replaced.
    askedMeanwhile.set(flight, { claim, question });
    return { outcome: 'in-flight', question };
  }
  mergesInFlight.add(flight);
  try {
    let asked = question;
    let outcome = await askOnce(claim);
    for (let asks = 1; asks < MAX_ASKS_PER_CHAIN && outcome !== 'claimed'; asks++) {
      const next = askedMeanwhile.get(flight);
      askedMeanwhile.delete(flight);
      // Nothing arrived meanwhile, or what arrived is the question that has
      // just been ANSWERED. (After a failure the same question is worth
      // asking again: nothing has answered it.)
      if (!next || (outcome !== 'failed' && next.question === asked)) break;
      asked = next.question;
      outcome = await askOnce(next.claim);
    }
    return { outcome, question: asked };
  } finally {
    mergesInFlight.delete(flight);
    // A question still waiting belongs to this chain and ends with it.
    askedMeanwhile.delete(flight);
  }
}

/**
 * What to tell a player whose transfer code was refused.
 *
 * The server refuses in words for the cases a player can act on — the code
 * has been used, it has expired, the squares would pass the pool's limit, too
 * many tries — and the page replaced every one of them with "Invalid code or
 * failed to merge." Since a code is spent the first time it works, that hid
 * the one thing the player needed to know: get a new code (qodo, PR #760).
 */
export function claimCodeFailureText(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code.replace(/^functions\//, '') : '';
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  if ((code === 'failed-precondition' || code === 'resource-exhausted') && message) return message;
  if (code === 'not-found') return 'That code was not recognised. Check it against the other device and try again.';
  return 'The squares could not be moved. Try again in a moment.';
}
