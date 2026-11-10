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
 */
const claimsInFlight = new Set<string>();

export async function claimGuestSquaresOnce(
  poolId: string,
  uid: string,
  claim: () => Promise<{ success: boolean }>,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
): Promise<'claimed' | 'already-done' | 'in-flight' | 'failed'> {
  const flag = `mmp_guest_claim:${poolId}:${uid}`;
  try {
    if (storage?.getItem(flag)) return 'already-done';
  } catch {
    // Storage blocked: fall through and rely on the in-flight guard alone.
  }
  if (claimsInFlight.has(flag)) return 'in-flight';
  claimsInFlight.add(flag);
  try {
    const result = await claim();
    if (!result.success) return 'failed';
    try {
      storage?.setItem(flag, '1');
    } catch {
      // Not remembered; the server call is idempotent, so a repeat is harmless.
    }
    return 'claimed';
  } catch {
    return 'failed';
  } finally {
    claimsInFlight.delete(flag);
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
