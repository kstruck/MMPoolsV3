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
