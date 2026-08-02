import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Square ownership must never become MEMBERSHIP evidence.
//
// `claimMySquares` sets `squares[].reservedByUid` on proof of a `guestDeviceKey`
// that is readable from the world-readable pool document (`firestore.rules`
// `allow get: if true`). That finding is known and accepted through the pilot
// (SECURITY-CLAIM-SQUARES.md), which is precisely why the REPAIR JOBS must not
// launder it: they were promoting that unverified signal into `participantIds`
// and into `joinedAt`-stamped Member Records — the two things `setPaidStatus`
// and reminder targeting treat as proof of membership.
//
// These are source-level invariants because the thing being guarded is an
// ABSENCE. A behavioural test cannot observe a scan that no longer happens, and
// both jobs live inside callables that read Firestore at module load.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('repair jobs do not promote square ownership to membership', () => {
    describe('fixParticipantIds (poolOps.ts)', () => {
        const src = read('functions/src/poolOps.ts');
        // Scope to the function body so an unrelated `reservedByUid` elsewhere in
        // this 700-line file cannot fail — or silently satisfy — this test.
        const start = src.indexOf('export const fixParticipantIds');
        const body = start >= 0 ? src.slice(start) : '';

        it('locates the function (guards against a rename silently passing)', () => {
            expect(start).toBeGreaterThan(-1);
        });

        it('never reads reservedByUid in CODE', () => {
            // The whole defect in one line: `participantIds.add(sq.reservedByUid)`.
            //
            // Comments are stripped first, deliberately: the block that removed
            // this NAMES the field while explaining why it is gone, and a naive
            // substring check fails on the explanation. Asserting on code only
            // keeps this test and the "records WHY" test below compatible —
            // without the strip, satisfying one would break the other.
            const codeOnly = body
                .split(/\r?\n/)
                .filter((l) => !l.trim().startsWith('//'))
                .join('\n');

            expect(codeOnly).not.toContain('reservedByUid');
        });

        it('still repairs the signals that ARE trustworthy', () => {
            // Narrowing must not have gutted the job. Playoff entries and bracket
            // entry ownerUids are server-written and stay in scope.
            expect(body).toContain('ownerUid');
            expect(body).toContain('participantIds');
        });

        it('records WHY squares are excluded, not just that they are', () => {
            // A bare deletion reads as an oversight and invites re-adding it.
            expect(body).toMatch(/SECURITY-CLAIM-SQUARES\.md/);
        });
    });

    describe('backfillMemberRecords', () => {
        const src = read('functions/src/migrations/backfillMemberRecords.ts');

        it('gates square units behind existing membership', () => {
            expect(src).toContain('applySquareUnits');
        });

        it('reports what it skipped instead of dropping it silently', () => {
            // A migration that quietly covers less than before reads as "covered
            // everything" in its dry-run report. This repo has been bitten by
            // exactly that four times.
            //
            // Pin BOTH halves. A bare toContain('squaresSkipped') passed even
            // with the report field deleted, because the local variable and the
            // accumulation still mention the name — mutation testing caught that.
            expect(src).toMatch(/squaresSkipped:\s*0,/);          // declared on the report
            expect(src).toContain('report.squaresSkipped +=');     // and actually accumulated
        });

        it('counts skips across BOTH gated sources, deduped', () => {
            // codex r2: returning only the units count under-reported. A
            // participants/{uid} index can outlive its square, so that candidate
            // is rejected while unitsByUid is empty — and the run would report
            // zero skips having silently stopped promoting a source it used to.
            expect(src).toMatch(/new Set\(\s*\[\.\.\.squaresDerivedNames\.keys\(\), \.\.\.unitsByUid\.keys\(\)\]/);
        });

        it('does not let a nameless squares doc wipe a real userName', () => {
            // The gate moved the participants read AFTER entries, making squares
            // the last writer. `add` spreads, so an undefined name would clobber
            // one entries had supplied.
            expect(src).toMatch(/if \(name\) add\(uid, \{ userName: name \}\)/);
        });

        it('records WHY the gate exists', () => {
            expect(src).toMatch(/SECURITY-CLAIM-SQUARES\.md/);
        });

        it('gates the squares-derived participants subcollection too', () => {
            // codex r1: syncParticipantIndices creates participants/{uid} from
            // reservedByUid, so reading that subcollection as a membership signal
            // laundered the claim one hop further. It must be enrichment-only,
            // like the units.
            const partRead = src.indexOf("collection('participants')");
            expect(partRead).toBeGreaterThan(-1);

            // The docs must land in the deferred map, NOT go straight to add().
            expect(src).toContain('squaresDerivedNames');
            const line = src.slice(partRead, partRead + 400);
            expect(line).not.toMatch(/for \(const d of partSnap\.docs\) add\(/);

            // ...and they must be APPLIED THROUGH THE GATE. Landing in the map is
            // not the property that matters; a plain loop over it afterwards
            // reintroduces the hole while leaving the map in place. Mutation
            // testing caught exactly that.
            expect(src).toMatch(/applySquareUnits\(\s*squaresDerivedNames/);
        });
    });
});

// codex r2 [P1]: claimByCode is the SUPPORTED, vetted cross-device flow, and it
// set reservedByUid without ever writing participantIds. The repair jobs used to
// recover those users from square ownership; now that they do not, the vetted
// path must record membership itself or a legitimate claimant silently loses
// their roster place, their dues and their reminders.
// codex r3 [P1]: claimByCode is NOT a vetted path. `createClaimCode` is
// auth:"public" and accepts a caller-supplied guestDeviceKey, which is readable
// from the world-readable pool document — so a stranger can mint a code for
// someone else's unclaimed guest square and redeem it. A previous revision of
// this change wrote participantIds here and would have restored the very
// escalation the repair-job narrowing removes.
describe('claimByCode does NOT confer membership', () => {
    const src = readFileSync(
        resolve(__dirname, '..', 'functions/src/participant.ts'), 'utf8',
    );
    const start = src.indexOf('export const claimByCode');
    const body = start >= 0 ? src.slice(start) : '';

    it('locates the callable', () => {
        expect(start).toBeGreaterThan(-1);
    });

    it('never writes participantIds', () => {
        expect(body).not.toMatch(/participantIds:\s*FieldValue\.arrayUnion/);
    });

    it('records WHY, so it is not "fixed" back in', () => {
        // A bare absence reads as an oversight. The next person to notice that
        // code-claim users lack membership must find the reason here.
        expect(body).toMatch(/createClaimCode/);
        expect(body).toMatch(/SECURITY-CLAIM-SQUARES\.md/);
    });
});

// codex r4 [P2]: the counter only prevents silent truncation if it REACHES the
// operator. OperationsPanel aggregates each paged callable response into its own
// object for the Run Log; a field missing there is a field the admin never sees.
describe('OperationsPanel surfaces squaresSkipped in the Run Log', () => {
    const src = readFileSync(
        resolve(__dirname, '..', 'src/components/admin/OperationsPanel.tsx'), 'utf8',
    );

    it('declares it on the aggregate', () => {
        expect(src).toMatch(/squaresSkipped:\s*0,/);
    });

    it('accumulates it across paged runs', () => {
        expect(src).toContain('agg.squaresSkipped += r.squaresSkipped');
    });
});
