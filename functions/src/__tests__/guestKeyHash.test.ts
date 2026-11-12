import { describe, it, expect } from 'vitest';
import { hashGuestKey, guestKeyHashOrNull } from '../lib/guestKey';
import { GUEST_KEY_PREFIX } from '../shared/squaresClaim';
import { CLAIM_CODE_LENGTH, normalizeClaimCode } from '../participant';

/**
 * The server's guest-key hash, pinned to a fixed vector.
 *
 * The browser computes the same hash (`src/utils/guestKey.ts`) to recognise a
 * guest's own squares. `src/utils/guestKey.test.ts` pins the browser side to
 * THIS SAME vector — so if either side changes its formula, one of the two
 * tests fails and a guest's squares cannot silently stop being theirs.
 */
const POOL = 'pool-1';
const KEY = `${GUEST_KEY_PREFIX}00000000-0000-4000-8000-000000000000`;
const VECTOR = '5920afc84010a532bfeda347b4d6da138a7dc14f746bdb13f0939802072a6445';

describe('hashGuestKey', () => {
    it('is sha256(poolId:key) in hex', () => {
        expect(hashGuestKey(POOL, KEY)).toBe(VECTOR);
        expect(guestKeyHashOrNull(POOL, KEY)).toBe(VECTOR);
    });

    it('gives no hash for a key without the current prefix', () => {
        expect(guestKeyHashOrNull(POOL, '11111111-2222-4333-8444-555555555555')).toBeNull();
        expect(guestKeyHashOrNull(POOL, null)).toBeNull();
    });
});

describe('claim codes', () => {
    it('are 8 characters — 32^8 is about 1.1e12 codes', () => {
        expect(CLAIM_CODE_LENGTH).toBe(8);
        expect(Math.pow(32, CLAIM_CODE_LENGTH)).toBeGreaterThan(1e12);
    });

    it('are compared without the case, spaces and dashes a person adds when retyping one', () => {
        expect(normalizeClaimCode('abcd-efgh')).toBe('ABCDEFGH');
        expect(normalizeClaimCode(' ABCD EFGH ')).toBe('ABCDEFGH');
        expect(normalizeClaimCode('ABCDEFGH')).toBe('ABCDEFGH');
    });
});
