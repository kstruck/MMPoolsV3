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
        // `pool` / `poolSnap` are the stale outer reads. The guard must not
        // consult either.
        expect(claimCode).not.toMatch(/\bpoolSnap\b/);
        expect(claimCode).not.toMatch(/isProvableMember\(\s*pool\s*,/);
    });

    it('re-checks that the pool still EXISTS', () => {
        // Subcollections outlive their parent document, so a canonical member
        // record can satisfy evidence 1 under a deleted pool.
        expect(claimCode).toMatch(/if \(!\w+\.exists\)/);
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
