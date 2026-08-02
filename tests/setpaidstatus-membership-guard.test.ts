import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// PLAN-SETPAIDSTATUS-MEMBERSHIP §4 "Ordering" and the round-5 removal.
//
// The behavioural coverage lives in the emulator suite (does the callable
// refuse a stranger, admit a real member, leave no document behind). These are
// SOURCE invariants because what they guard cannot be observed from outside:
//
//  - the evidence must be read INSIDE the transaction. Reusing the `poolSnap`
//    the callable already holds is a correct-looking refactor that silently
//    reopens the hole — a `voidMemberRecord` landing after that snapshot goes
//    unobserved and the record is resurrected from a stale `participantIds`.
//    No black-box test can see which snapshot was consulted.
//  - the ABSENCE of a third evidence branch. A test cannot observe a check that
//    is not there; only the source can say so.

const src = readFileSync(
    resolve(__dirname, '..', 'functions/src/setPaidStatus.ts'),
    'utf8',
);

// Scope to the claim branch. The authoritative and settleRebuys branches below
// legitimately transact and read the pool, so a whole-file assertion would pass
// on their code while the guard was gone.
const start = src.indexOf('if (claim !== undefined) {');
const end = src.indexOf("mode: 'claim' as const");
const claimBranch = start >= 0 && end > start ? src.slice(start, end) : '';

// Comments name the very things these tests assert are absent (the plan's
// reasoning is written into the code), so an absence check must read code only.
const claimCode = claimBranch
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

describe('setPaidStatus claim branch — membership guard wiring', () => {
    it('locates the claim branch (a rename must not silently pass every test below)', () => {
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(claimCode).toContain('memberReportedPaid');
    });

    it('consults the membership predicate', () => {
        expect(claimCode).toContain('isProvableMember(');
    });

    it('runs the check and the write in ONE transaction', () => {
        expect(claimCode).toMatch(/db\.runTransaction\(/);
        // The write must be the transactional one. `mRef.set(` outside a tx is
        // the pre-guard code, and leaving it would commit the claim regardless
        // of what the transaction decided.
        expect(claimCode).toMatch(/tx\.set\(mRef,/);
        expect(claimCode).not.toMatch(/await mRef\.set\(/);
    });

    it('re-reads the pool INSIDE the transaction rather than reusing poolSnap', () => {
        expect(claimCode).toMatch(/tx\.get\(poolRef\)/);
        expect(claimCode).toMatch(/tx\.get\(mRef\)/);
        // POSITIVE pin on the argument, not just a blacklist of the stale name.
        // Mutation testing: swapping in the outer `pool` survived a
        // `not.toMatch(/isProvableMember\(\s*pool\s*,/)` as soon as anything sat
        // between the identifier and the comma. Naming the required source
        // cannot be dodged that way.
        expect(claimCode).toMatch(/isProvableMember\(\s*freshPoolSnap\.data\(\)/);
        // `poolSnap` is the stale outer read. (`\b` does not match inside
        // `freshPoolSnap` — the capital P breaks the word.)
        expect(claimCode).not.toMatch(/\bpoolSnap\b/);
    });

    it('re-checks that the POOL still exists, transactionally', () => {
        // Subcollections outlive their parent document, so a canonical member
        // record can satisfy evidence 1 under a deleted pool.
        //
        // Named snapshot, not `/!\w+\.exists/`: the loose form is satisfied by
        // any existence check in the branch — a future `!memberSnap.exists`
        // would keep it green with the pool check gone.
        //
        // This is the ONLY coverage of the transactional half. The emulator's
        // deleted-pool test hits the callable's opening `poolSnap.exists`
        // instead — verified by mutation: deleting this line left that test
        // green.
        expect(claimCode).toMatch(/if \(!freshPoolSnap\.exists\)/);
    });

    it('uses the SHARED canonical discriminator, not a local copy', () => {
        // #344 shuts the door on NEW forgeries; #338's resolveReminderTargets
        // filter stops OLD ones being emailed (§4a). They only work as a pair,
        // so the two must agree on what "canonical" means — a second inlined
        // `joinedAt !== undefined` in either file is how that drifts.
        const lib = readFileSync(
            resolve(__dirname, '..', 'functions/src/lib/memberRecord.ts'), 'utf8',
        );
        const targets = readFileSync(
            resolve(__dirname, '..', 'functions/src/lib/reminderTargets.ts'), 'utf8',
        );

        expect(lib).toContain('isCanonicalMemberRecord(');
        expect(targets).toContain('isCanonicalMemberRecord(');
        // Both must import it from shared/, not define their own.
        expect(lib).not.toMatch(/export function isCanonicalMemberRecord/);
        expect(targets).not.toMatch(/export function isCanonicalMemberRecord/);
    });

    it('has NO third evidence branch — square ownership stays out', () => {
        // Round 5. `claimMySquares` stamps `reservedByUid` on proof of a
        // guestDeviceKey readable from the world-readable pool document, so the
        // signal is attacker-settable. Whoever "fixes" the guest-claim Squares
        // exclusion by adding it back fails here.
        expect(claimCode).not.toContain('reservedByUid');
        expect(claimCode).not.toContain('squares');
    });
});
