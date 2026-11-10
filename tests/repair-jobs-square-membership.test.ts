import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { addReportPage } from '../src/utils/resumableReport';

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

// HISTORY, because this block has now said three different things.
//
// codex r2 [P1]: claimByCode set reservedByUid without writing participantIds,
//   so a legitimate claimant lost their roster place. A revision added the write.
// codex r3 [P1]: that was wrong. `createClaimCode` is auth:"public" and took a
//   caller-supplied guestDeviceKey that was readable off the world-readable pool
//   document, so a stranger could mint a code for somebody else's square and
//   redeem it into MEMBERSHIP. The write was removed and this block pinned its
//   absence.
// 2026-11 (PLAN-SQUARES-REOPEN A3): the cause is closed. The pool document
//   carries only a HASH of the key, and every claim path hashes the key the
//   caller presents and compares hashes — so presenting the key is now proof of
//   being the device that reserved, which is exactly what r2 wanted to honour.
//   Membership follows a claim again.
//
// What is pinned here is therefore the thing that makes that safe: NO claim path
// may compare, read or store a RAW key. If one does, r3's escalation is back,
// and this time with a participantIds write behind it.
//
// The attack itself is exercised against the real callables in
// functions/src/__tests__/emulator/squaresClaim.emulator.test.ts ("ATTACK: …").
describe('claim paths prove ownership by hash, and only then confer membership', () => {
    const src = readFileSync(
        resolve(__dirname, '..', 'functions/src/participant.ts'), 'utf8',
    );
    // Code only: the comments in this file NAME the raw fields while explaining
    // why they are gone, and a substring check would fail on the explanation.
    const codeOnly = (text: string) => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
    const slice = (from: string, to: string) => {
        const a = src.indexOf(from);
        const b = src.indexOf(to, a + 1);
        return a >= 0 && b > a ? src.slice(a, b) : '';
    };
    const mint = slice('export const createClaimCode', 'function claimGuestSquares');
    const matcher = slice('function claimGuestSquares', 'export const claimMySquares');
    const mine = slice('export const claimMySquares', 'export const claimByCode');
    const byCode = slice('export const claimByCode', 'export const syncParticipantIndices');

    it('locates all four pieces (a rename must not pass silently)', () => {
        for (const [name, body] of Object.entries({ mint, matcher, mine, byCode })) {
            expect(body.length, name).toBeGreaterThan(0);
        }
    });

    it('the square matcher compares HASHES and never a raw key', () => {
        const code = codeOnly(matcher);
        expect(code).toMatch(/s\.guestKeyHash !== guestKeyHash/);
        expect(code).not.toMatch(/guestDeviceKey\s*===/);
        expect(code).not.toMatch(/guestClaimId\s*===/);
    });

    it('a released square is never matched (the owner check comes first)', () => {
        expect(codeOnly(matcher)).toMatch(/!s\.owner/);
    });

    it('both claim callables go through that matcher, with a server-computed hash', () => {
        expect(codeOnly(mine)).toMatch(/guestKeyHashOrNull\(poolId, guestDeviceKey\)/);
        expect(codeOnly(mine)).toContain('claimGuestSquares(');
        expect(codeOnly(byCode)).toContain('claimGuestSquares(');
        // The code's target is the hash stored on the claim — never the legacy
        // raw `guestClaimId`.
        expect(codeOnly(byCode)).toMatch(/claim\.guestKeyHash/);
        expect(codeOnly(byCode)).not.toMatch(/claim\.guestClaimId/);
    });

    it('a claim code is minted from a key the server honours, and stores only its hash', () => {
        const code = codeOnly(mint);
        expect(code).toMatch(/guestKeyHashOrNull\(poolId, guestDeviceKey\)/);
        expect(code).not.toMatch(/guestClaimId\s*:/);
        expect(code).not.toMatch(/guestDeviceKey\s*:/);
    });

    it('membership is written only inside the "something was claimed" branch', () => {
        for (const body of [mine, byCode]) {
            const code = codeOnly(body);
            const guard = code.indexOf('outcome.claimed.length > 0');
            const write = code.indexOf('participantIds: FieldValue.arrayUnion(uid)');
            expect(guard).toBeGreaterThan(-1);
            expect(write).toBeGreaterThan(guard);
        }
    });

    it('records WHY, so the raw-key comparison is not "simplified" back in', () => {
        expect(src).toMatch(/SECURITY-CLAIM-SQUARES\.md/);
        expect(mint).toMatch(/hash/i);
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
        // WARNING: THIS USED TO ASSERT THE LITERAL LINE
        // `agg.squaresSkipped += r.squaresSkipped`, which pinned the
        // IMPLEMENTATION rather than the behaviour — and the implementation it
        // pinned was the very pattern that lost three other counters before an
        // operator noticed (2026-08-27, the reconcile dry run; see
        // `tests/ops-panel-report-coverage.test.ts`). A test that requires a
        // hand-kept list is a test that resists the fix for the class.
        //
        // What matters is that the counter REACHES the aggregate. It does,
        // because the loop now sums every numeric key the page returns.
        expect(src).toContain('addReportPage(agg, r);');
        expect(src).not.toMatch(/agg\.squaresSkipped\s*\+=/);
    });

    it('and the summing genuinely carries it — not just the call site', () => {
        // Behaviour, not source text: the helper the loop delegates to must
        // actually accumulate this counter across pages.
        const agg = { failures: [] as unknown[], squaresSkipped: 0 };
        addReportPage(agg, { squaresSkipped: 2 });
        addReportPage(agg, { squaresSkipped: 3 });
        expect(agg.squaresSkipped).toBe(5);
    });
});
