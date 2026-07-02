/**
 * Pure-logic self-check for the H1 backfill (no Firestore / emulator needed).
 * Run: node functions/scripts/backfillSquarePrivate.test.mjs
 */
import assert from 'node:assert';
import { planPoolMigration, cleanPII, hasPII } from './backfillSquarePrivate.mjs';

// 1. PII is moved off the square and captured as a private doc.
{
    const squares = [
        { id: 0, owner: 'Alice', isPaid: true, playerDetails: { email: 'a@x.com', phone: '555' } },
        { id: 1, owner: 'Bob', isPaid: false, playerDetails: { email: 'b@x.com' } },
        { id: 2, owner: null }, // empty square untouched
    ];
    const { strippedSquares, privateDocs } = planPoolMigration(squares);

    assert.strictEqual(privateDocs.length, 2, 'two private docs');
    assert.deepStrictEqual(privateDocs[0], { squareId: 0, email: 'a@x.com', phone: '555' });
    assert.deepStrictEqual(privateDocs[1], { squareId: 1, email: 'b@x.com' });

    // No square retains playerDetails; display fields preserved.
    assert.ok(strippedSquares.every((s) => !('playerDetails' in s)), 'playerDetails stripped');
    assert.strictEqual(strippedSquares[0].owner, 'Alice');
    assert.strictEqual(strippedSquares[0].isPaid, true);
    assert.strictEqual(strippedSquares[2].owner, null);
}

// 2. Idempotent: re-running on the stripped output produces no writes.
{
    const squares = [{ id: 0, owner: 'Alice', playerDetails: { email: 'a@x.com' } }];
    const once = planPoolMigration(squares);
    const twice = planPoolMigration(once.strippedSquares);
    assert.strictEqual(twice.privateDocs.length, 0, 'second run is a no-op');
    assert.deepStrictEqual(twice.strippedSquares, once.strippedSquares);
}

// 3. Empty/blank PII is not migrated (avoids junk private docs).
{
    const squares = [
        { id: 0, owner: 'X', playerDetails: {} },
        { id: 1, owner: 'Y', playerDetails: { email: '', phone: null } },
        { id: 2, owner: 'Z' }, // no playerDetails at all
    ];
    const { privateDocs, strippedSquares } = planPoolMigration(squares);
    assert.strictEqual(privateDocs.length, 0, 'no private docs for blank PII');
    // Squares with empty playerDetails object still get it stripped.
    assert.ok(!('playerDetails' in strippedSquares[0]) || !hasPII(strippedSquares[0].playerDetails));
}

// 4. cleanPII drops undefined/null/empty but keeps real values.
assert.deepStrictEqual(cleanPII({ email: 'e', phone: '', notes: undefined, x: null }), { email: 'e' });

console.log('OK — all backfill logic checks passed.');
