/**
 * One-time migration (audit finding H1): move player PII off the public pool doc.
 *
 * For every pool, copies each square's `playerDetails` into the restricted
 * subcollection /pools/{poolId}/squarePrivate/{squareId} and strips
 * `playerDetails` from the pool doc's `squares[]` array.
 *
 * Idempotent + set-based (no increments): a second run finds no `playerDetails`
 * left on the squares and does nothing. Safe to re-run.
 *
 * Usage:
 *   Dry run (default, no writes):
 *     node functions/scripts/backfillSquarePrivate.mjs
 *   Apply:
 *     node functions/scripts/backfillSquarePrivate.mjs --commit
 *
 *   Against the emulator:
 *     FIRESTORE_EMULATOR_HOST=localhost:8080 node functions/scripts/backfillSquarePrivate.mjs --commit
 *   Against prod (needs scripts/service-account.json):
 *     node functions/scripts/backfillSquarePrivate.mjs --commit
 *
 * ponytail: one batch per pool. A pool has <=100 squares (+1 doc update) which
 * is under Firestore's 500-op batch limit, so no chunking needed.
 */
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo';
const COMMIT = process.argv.includes('--commit');
const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
export const SQUARE_PRIVATE = 'squarePrivate';

export function cleanPII(pd) {
    const out = {};
    for (const [k, v] of Object.entries(pd || {})) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
}
export function hasPII(pd) {
    return Object.keys(cleanPII(pd)).length > 0;
}

/**
 * Pure migration planner (no Firestore) — returns the stripped squares array and
 * the private docs to write. Exported so the logic can be unit-tested without an
 * emulator. Idempotent: squares already without playerDetails yield no private docs.
 */
export function planPoolMigration(squares) {
    const privateDocs = [];
    const strippedSquares = (squares || []).map((s) => {
        if (!hasPII(s.playerDetails)) return s;
        privateDocs.push({ squareId: s.id, ...cleanPII(s.playerDetails) });
        const { playerDetails, ...rest } = s; // eslint-disable-line no-unused-vars
        return rest;
    });
    return { strippedSquares, privateDocs };
}

async function run(db) {
    console.log(`\n=== Backfill squarePrivate (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ===\n`);
    const pools = await db.collection('pools').get();

    let poolsChanged = 0;
    let privateWritten = 0;
    let squaresStripped = 0;

    for (const doc of pools.docs) {
        const data = doc.data();
        if (!Array.isArray(data.squares)) continue;

        const { strippedSquares, privateDocs } = planPoolMigration(data.squares);
        if (privateDocs.length === 0) continue;

        poolsChanged++;
        squaresStripped += privateDocs.length;

        const batch = db.batch();
        for (const p of privateDocs) {
            const ref = doc.ref.collection(SQUARE_PRIVATE).doc(String(p.squareId));
            batch.set(ref, { ...p, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
            privateWritten++;
        }
        batch.update(doc.ref, { squares: strippedSquares });

        if (COMMIT) await batch.commit();
        console.log(`${COMMIT ? 'MIGRATED' : 'WOULD MIGRATE'} pool ${doc.id}: ${privateDocs.length} squares`);
    }

    console.log(`\n--- Summary (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ---`);
    console.log(`pools changed:      ${poolsChanged}`);
    console.log(`private docs:       ${privateWritten}`);
    console.log(`squares stripped:   ${squaresStripped}`);
    console.log(COMMIT ? '\nDone.' : '\nNo writes made. Re-run with --commit to apply.');
}

// Only touch Firestore when run directly (not when imported by a test).
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_MAIN) {
    if (USE_EMULATOR) {
        admin.initializeApp({ projectId: PROJECT_ID });
        console.log(`Connected to EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST} (project ${PROJECT_ID})`);
    } else {
        const saPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'service-account.json');
        if (!existsSync(saPath)) {
            console.error(`Missing service account for prod run: ${saPath}`);
            console.error('Set FIRESTORE_EMULATOR_HOST for an emulator run instead.');
            process.exit(1);
        }
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
        console.log('Connected to PRODUCTION Firestore.');
    }
    run(admin.firestore()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
