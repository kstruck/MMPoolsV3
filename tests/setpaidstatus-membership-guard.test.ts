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

    it('all three doors share ONE definition of each predicate', () => {
        // #344 shuts the door on NEW forgeries; #338's resolveReminderTargets
        // filter stops OLD ones being emailed (§4a); the client roster builder
        // stops them being COUNTED and RENDERED (§4b). They only work as a set,
        // so a second inlined `joinedAt !== undefined`, or a hand-rolled copy of
        // the two-evidence rule, is how one of them ends up open.
        const lib = readFileSync(
            resolve(__dirname, '..', 'functions/src/lib/memberRecord.ts'), 'utf8',
        );
        const targets = readFileSync(
            resolve(__dirname, '..', 'functions/src/lib/reminderTargets.ts'), 'utf8',
        );
        const roster = readFileSync(
            resolve(__dirname, '..', 'src/utils/poolRoster.ts'), 'utf8',
        );
        const shared = readFileSync(
            resolve(__dirname, '..', 'shared/memberRecord.ts'), 'utf8',
        );

        // shared/ is the ONE home for both predicates.
        expect(shared).toMatch(/export function isCanonicalMemberRecord/);
        expect(shared).toMatch(/export function isProvableMember/);
        // The reminder filter uses the canonical half directly — `participantIds`
        // is manager-writable and #338 refuses it as an email-target source.
        expect(targets).toContain('isCanonicalMemberRecord(');
        // The ROSTER uses the two-evidence predicate, not the canonical half
        // alone: codex r1 showed that dropping a real participant's un-stamped
        // record hides the commissioner's own PAID mark.
        expect(roster).toContain('isProvableMember(');

        // Nobody redefines either one. `isProvableMember` MOVED to shared/ so the
        // client roster could reach it (src/ cannot import firebase-admin), so
        // functions-side must RE-EXPORT it, never redeclare it.
        for (const src of [lib, targets, roster]) {
            expect(src).not.toMatch(/export function isCanonicalMemberRecord/);
            expect(src).not.toMatch(/export function isProvableMember/);
        }
        expect(lib).toMatch(/export \{[^}]*isProvableMember[^}]*\} from ["']\.\.\/shared\/memberRecord["']/);
        // And the client must not re-derive the second evidence branch inline.
        expect(roster).not.toMatch(/participantIds[^\n]*\.includes\(/);
    });

    it('the client roster builder applies the filter to EVERY member reader', () => {
        // `buildPoolRoster` (the rendered roster), `rosterUids` (memberCount) and
        // `rosterPotStats` (the dues totals) each walk the members collection.
        // Filtering only the first would leave a forged record out of the list
        // while still counting it — the head count and the roster disagreeing is
        // the exact defect this module's `rosterUids` comment already describes.
        //
        // Asserted as "no reader iterates raw members" rather than by counting
        // `provableMembers(` call sites, which a future reader could satisfy by
        // calling it and discarding the result.
        const roster = readFileSync(
            resolve(__dirname, '..', 'src/utils/poolRoster.ts'), 'utf8',
        );
        const code = roster
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
            .join('\n');

        // Anchor: the helper must exist under this name, or every assertion
        // below is checking the absence of something that was merely renamed.
        expect(code).toMatch(/const provableMembers = /);
        // The three readers, by the shape each used before this change.
        expect(code).not.toMatch(/for \(const m of members \|\| \[\]\)/);
        expect(code).not.toMatch(/const memberList = members \|\| \[\]/);
        expect(code).toMatch(
            /for \(const m of provableMembers\(pool, members\)\)[\s\S]*for \(const m of provableMembers\(pool, members\)\)/,
        );
        expect(code).toMatch(/const memberList = provableMembers\(pool, members\)/);
    });

    it('the client member loader delivers whole documents, so joinedAt reaches the filter', () => {
        // ⚠️ The weakest link in the client half, and it is not hypothetical.
        //
        // `RosterInputs.members` is `any[]`, so nothing in the type system stops
        // a caller PROJECTING member documents to a narrower shape. That would
        // strip `joinedAt`, make every genuine member look forged, and empty the
        // roster outright — precisely the regression codex found on #338, where
        // `sendManualReminder` projected snapshots to `{ id, userName }` one
        // commit AFTER the filter landed, while all 79 unit tests stayed green
        // because they called the pure function directly.
        //
        // #338 could close that with a required parameter type. `any[]` swallows
        // any type written here, so the LOADER is pinned instead.
        const db = readFileSync(
            resolve(__dirname, '..', 'src/services/dbService.ts'), 'utf8',
        );
        const start = db.indexOf('subscribeToPoolMembers:');
        // Anchor first: a rename must fail here, not silently pass an assertion
        // scoped to an empty slice.
        expect(start).toBeGreaterThan(-1);
        const body = db.slice(start, db.indexOf('},', start));
        // Comments stripped — one mentioning `...d.data()` must not satisfy an
        // assertion about what the code does.
        const bodyCode = body
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
            .join('\n');
        expect(bodyCode).toContain('...d.data()');
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
