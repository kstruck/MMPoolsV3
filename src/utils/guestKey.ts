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
 * Take this browser's guest squares into the signed-in account — at most once
 * per pool, account and browser session, and never two at a time.
 *
 * The "done" mark is written only AFTER the claim succeeds. It used to be
 * written before the call, and the call swallows its own failures, so one
 * timeout meant no further attempt until the browser was closed (qodo, PR #758).
 *
 * AND "REFUSED OVER THE LIMIT" IS NOT "DONE" (qodo, PR #759). The server moves
 * nothing when the squares would put the account past the pool's limit, and
 * says so (`overLimit`). That was filed as a finished claim, so a player who
 * then gave up a square, or whose organizer raised the limit, kept their guest
 * squares outside their account until they closed the browser. It is now
 * remembered WITH what the answer depended on (`retryKey` — the limit, and how
 * many squares the account and this browser hold): the same question is not
 * asked twice, a changed one is.
 *
 * AND A CHANGED QUESTION THAT ARRIVES WHILE ONE IS IN FLIGHT IS NOT DROPPED
 * (qodo, PR #761). The limit is raised while a claim is on its way; the page
 * asks again and is told "in flight"; the first claim, which read the pool
 * before the change, comes back "over the limit" — and writes nothing, so
 * nothing prompts the page to ask a third time. The newest question asked
 * during a flight is kept (`askedMeanwhile`), and if the flight ends in a
 * refusal that a different question might not get, it is asked then.
 */
const claimsInFlight = new Set<string>();
type Claim = () => Promise<{ success: boolean; overLimit?: boolean }>;
type ClaimStorage = Pick<Storage, 'getItem' | 'setItem'> | null;
const askedMeanwhile = new Map<string, { claim: Claim; storage: ClaimStorage; retryKey: string }>();
/** The same memory as the session flag, for a browser that blocks storage. */
const refusedOverLimit = new Map<string, string>();
const CLAIMED = '1';
const overLimitMark = (retryKey: string) => `over:${retryKey}`;

export async function claimGuestSquaresOnce(
  poolId: string,
  uid: string,
  claim: Claim,
  storage: ClaimStorage = safeSessionStorage(),
  /** What an over-the-limit answer depends on. A refusal is retried only when this changes. */
  retryKey = '',
): Promise<'claimed' | 'already-done' | 'in-flight' | 'failed' | 'over-limit'> {
  const flag = `mmp_guest_claim:${poolId}:${uid}`;
  let remembered: string | null | undefined;
  try {
    remembered = storage?.getItem(flag);
  } catch {
    // Storage blocked: fall through and rely on the in-memory guards alone.
  }
  remembered = remembered || refusedOverLimit.get(flag);
  if (remembered === CLAIMED || remembered === overLimitMark(retryKey)) return 'already-done';
  if (claimsInFlight.has(flag)) {
    // Only the newest question matters; an older one waiting is replaced.
    askedMeanwhile.set(flag, { claim, storage, retryKey });
    return 'in-flight';
  }
  claimsInFlight.add(flag);
  let refused = false;
  try {
    const result = await claim();
    if (!result.success) return 'failed';
    refused = result.overLimit === true;
    const mark = refused ? overLimitMark(retryKey) : CLAIMED;
    if (refused) refusedOverLimit.set(flag, mark);
    else refusedOverLimit.delete(flag);
    try {
      storage?.setItem(flag, mark);
    } catch {
      // Not remembered; the server call is idempotent, so a repeat is harmless.
    }
    return refused ? 'over-limit' : 'claimed';
  } catch {
    return 'failed';
  } finally {
    claimsInFlight.delete(flag);
    const next = askedMeanwhile.get(flag);
    askedMeanwhile.delete(flag);
    // Ask the question that arrived meanwhile — but only after a refusal over
    // the limit. A claim that moved the squares needs no follow-up, and one
    // that failed is retried by the page itself. If the waiting question is
    // the SAME one that was just refused, the call below finds the refusal
    // remembered and asks nothing: there is no second check for that here,
    // because there would be nothing for it to do.
    if (next && refused) {
      void claimGuestSquaresOnce(poolId, uid, next.claim, next.storage, next.retryKey);
    }
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

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
