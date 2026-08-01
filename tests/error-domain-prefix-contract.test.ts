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

describe('MEMBER_NOT_ON_ROSTER domain prefix', () => {
    it('is thrown by EVERY roster-missing path in setPaidStatus', () => {
        // Two throw sites: the member-self-report transaction and the
        // commissioner transaction. Both are reachable from the UI, so a prefix
        // on only one produces a message that changes depending on who clicked.
        const rosterThrows = setPaidStatusSrc.match(
            /throw new HttpsError\("not-found", "[^"]*roster[^"]*"\)/g,
        );

        expect(rosterThrows, 'no roster not-found throw found — did the wording change?')
            .not.toBeNull();
        expect(rosterThrows!.length).toBe(2);
        for (const t of rosterThrows!) {
            expect(t).toContain('MEMBER_NOT_ON_ROSTER:');
        }
    });

    it('resolves to roster-specific copy on the client', () => {
        const msg = getUserMessage({
            code: 'functions/not-found',
            message: 'MEMBER_NOT_ON_ROSTER: Member is not on this pool\'s roster.',
        });

        expect(msg).toMatch(/roster/i);
        // The bug being prevented: falling through to the transport-code copy.
        expect(msg).not.toMatch(/that pool or entry couldn't be found/i);
    });

    it('still uses the generic not-found copy for a genuinely missing pool', () => {
        // setPaidStatus throws a BARE not-found for "Pool not found." — that one
        // must keep the generic message, otherwise the prefix bought nothing.
        const msg = getUserMessage({
            code: 'functions/not-found',
            message: 'Pool not found.',
        });

        expect(msg).toMatch(/that pool or entry couldn't be found/i);
    });

    it('keeps the pool-not-found throw UNprefixed', () => {
        expect(setPaidStatusSrc).toContain('throw new HttpsError("not-found", "Pool not found.")');
    });
});
