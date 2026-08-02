import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getUserMessage } from '../src/utils/errorMessages';

// A domain prefix is a CROSS-BOUNDARY contract: `functions/` throws a message
// starting `PREFIX:` and the client maps that prefix to human copy. Nothing in
// the type system connects the two halves, so renaming either side degrades
// silently — the user just starts seeing the generic transport message again,
// which is the exact failure PLAN-PAYMENT-TRUTH §6b round 4 was about.
//
// These tests pin both halves. Deleting the client entry OR the server prefix
// fails them.
//
// ⚠️ #338 ADDS its `MEMBER_NOT_ON_ROSTER` cases to this file after it rebases
// (PLAN-SETPAIDSTATUS-MEMBERSHIP D3). That is deliberate: both branches
// creating this path would be an add/add conflict whose likely resolution keeps
// one prefix and silently drops the other — in the one file whose job is to
// prove both halves of a contract are wired.

const setPaidStatusSrc = readFileSync(
    resolve(__dirname, '../functions/src/setPaidStatus.ts'),
    'utf8',
);

describe('NOT_A_POOL_MEMBER domain prefix', () => {
    it('is thrown by the membership guard in setPaidStatus', () => {
        const guardThrows = setPaidStatusSrc.match(
            /throw new HttpsError\("permission-denied", "NOT_A_POOL_MEMBER:[^"]*"\)/g,
        );

        expect(guardThrows, 'no NOT_A_POOL_MEMBER throw found — did the wording change?')
            .not.toBeNull();
        expect(guardThrows!.length).toBe(1);
    });

    it('resolves to membership-specific copy on the client', () => {
        const msg = getUserMessage({
            code: 'functions/permission-denied',
            message: 'NOT_A_POOL_MEMBER: You are not a member of this pool.',
        });

        expect(msg).toMatch(/member of this pool/i);
        // The bug being prevented: falling through to the transport-code copy.
        expect(msg).not.toMatch(/you don't have permission to do that/i);
    });

    it('leaves the self-report ownership refusal on the GENERIC copy', () => {
        // "Members can only report their own payment." stays unprefixed: the
        // prefix mechanism costs a registry entry each, and this one only fires
        // for a caller hand-crafting a request for someone else's uid — there
        // is no UI that can produce it by accident.
        const msg = getUserMessage({
            code: 'functions/permission-denied',
            message: 'Members can only report their own payment.',
        });

        expect(msg).toMatch(/you don't have permission to do that/i);
    });
});
