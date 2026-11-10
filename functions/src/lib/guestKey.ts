/**
 * Guest device keys (PLAN-SQUARES-REOPEN A3, closing SECURITY-CLAIM-SQUARES.md).
 *
 * A guest reserves squares with no account. Their browser holds a random key;
 * presenting it later is how they prove a square is theirs. That key used to be
 * written onto the square itself — on the world-readable pool document — so
 * anyone with the share link could read it and present it.
 *
 * Only a HASH is stored now. Reading the hash off the pool document is useless:
 * a claim needs the key the hash was made from, which never leaves the guest's
 * own browser.
 */
import { createHash } from "crypto";
import { isCurrentGuestKey } from "../shared/squaresClaim";

/**
 * `sha256(poolId + ":" + key)`, hex.
 *
 * SALTED BY POOL so one device cannot be recognised across two pools by
 * comparing hashes.
 *
 * NO PEPPER, deliberately. The security write-up asked for one on the grounds
 * that a bare hash is reversible by guessing the key. That is true of a
 * guessable key; this one is `crypto.randomUUID()` — 122 random bits — and
 * `isCurrentGuestKey` refuses anything shorter. A pepper would add a functions
 * secret that every deploy depends on, to defend against a search of 2^122.
 */
export function hashGuestKey(poolId: string, key: string): string {
    return createHash("sha256").update(`${poolId}:${key}`).digest("hex");
}

/** The hash for a key the server honours, or `null` for none / an old key. */
export function guestKeyHashOrNull(poolId: string, key: unknown): string | null {
    return isCurrentGuestKey(key) ? hashGuestKey(poolId, key) : null;
}
