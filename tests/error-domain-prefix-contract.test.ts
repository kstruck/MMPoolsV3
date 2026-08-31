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

/**
 * `renameNFLEntry` — PLAN-MULTI-ENTRY K5 follow-up.
 *
 * Same cross-boundary contract as above, and the same failure if either half
 * moves: the server throws `ENTRY_NOT_FOUND:` and the client maps that prefix.
 * This one matters because the generic `not-found` copy reads as "that pool or
 * entry couldn't be found" — about a pool the member is looking at — for what
 * is really "you don't have an entry #2 yet", a state a stale entry list can
 * put a member in.
 */
describe('renameNFLEntry domain prefixes', () => {
    const renameSrc = readFileSync(
        resolve(__dirname, '../functions/src/nflEntryRename.ts'),
        'utf8',
    );

    // Non-global: `.test()` on a /g regex advances `lastIndex`, so a second
    // call would answer about the wrong position.
    const NOT_FOUND_THROW = /HttpsError\(\s*'not-found',\s*`ENTRY_NOT_FOUND:/;

    it('ENTRY_NOT_FOUND is thrown by the never-create guard', () => {
        expect(NOT_FOUND_THROW.test(renameSrc)).toBe(true);
    });

    it('🛑 that regex MATCHES THE SHAPE IT WAS WRITTEN TO CATCH, and only it', () => {
        // GUARD THE GUARD. An inert regex is indistinguishable from a passing
        // one — #596 shipped a guard whose `\b` had become a literal U+0008
        // backspace, and only a reviewer reading bytes found it. So it is
        // asserted against a sample it must catch and one it must not.
        expect(NOT_FOUND_THROW.test(
            "throw new HttpsError('not-found',\n  `ENTRY_NOT_FOUND: no entry #2.`);")).toBe(true);
        // The code moving to a DIFFERENT transport code is exactly the drift
        // this pins: the client maps the prefix under `functions/not-found`.
        expect(NOT_FOUND_THROW.test(
            "throw new HttpsError('failed-precondition', `ENTRY_NOT_FOUND: no entry #2.`);")).toBe(false);
        // ...and the prefix disappearing is the other half.
        expect(NOT_FOUND_THROW.test(
            "throw new HttpsError('not-found', `You do not have an entry #2.`);")).toBe(false);
    });

    it('ENTRY_NOT_FOUND resolves to entry-specific copy, not the generic not-found', () => {
        const msg = getUserMessage({
            code: 'functions/not-found',
            message: "ENTRY_NOT_FOUND: you do not have an entry #2 in this pool yet.",
        });
        expect(msg).toMatch(/first saved pick/i);
        expect(msg).not.toMatch(/that pool or entry couldn't be found/i);
    });

    it('leaves a genuinely missing POOL on the generic copy', () => {
        // The rename callable throws a BARE not-found for the pool itself, so
        // the prefix above has to be the thing that distinguishes them.
        expect(renameSrc).toContain(`throw new HttpsError('not-found', 'Pool not found.')`);
        expect(getUserMessage({ code: 'functions/not-found', message: 'Pool not found.' }))
            .toMatch(/that pool or entry couldn't be found/i);
    });

    it('reuses the entry-name prefixes rather than inventing new ones', () => {
        // `assertEntryNameFree` is shared with the submit path, so its
        // ENTRY_NAME_TAKEN / ENTRY_NAME_EMPTY copy already exists. A rename that
        // threw its own wording would need a second registry entry and would
        // drift from the one the pick sheet shows for the same rule.
        expect(renameSrc).toContain('assertEntryNameFree');
        expect(getUserMessage({
            code: 'functions/already-exists',
            message: 'ENTRY_NAME_TAKEN: you already have an entry named "Kevin B".',
        })).toMatch(/already have an entry with that name/i);
    });
});
