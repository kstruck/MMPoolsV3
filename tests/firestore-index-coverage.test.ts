import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * `enforceBillingStatus` runs two composite queries on `pools`, and
 * `firestore.indexes.json` carried NO index touching `billing.*` — verified with
 * `git log -S 'billing.trialEndsAt' -- firestore.indexes.json`, which returns no
 * commits. The index was never there. So the job has never completed a run: it
 * threw `9 FAILED_PRECONDITION: The query requires an index` on the first query
 * every night, expired trials were never moved to grace period, and expired
 * grace periods were never enforced.
 *
 * This is the SECOND time this class has shipped. Commit `1c887d8` — "add the
 * missing index the finalize sweep needs — it has never run (#223)" — is the
 * first. Both times a scheduled job was written, deployed, and silently threw
 * for its entire life, because a missing composite index is invisible until
 * something reads the job's own error.
 *
 * The guard is deliberately NOT a general static analyzer over every query in
 * `functions/src`. That was prototyped and produced false positives it could not
 * distinguish from real gaps — a same-field range pair (`startTime >= … <=`) is
 * served by the automatic single-field index and needs nothing, and
 * `AICommissioner.tsx` deliberately dropped an `orderBy` and sorts client-side
 * specifically to avoid needing an index. An analyzer that cries wolf on those
 * gets muted, and a muted guard is the state this file exists to prevent.
 *
 * Instead: pin the queries whose failure is a MONEY path, and pin them from both
 * ends. The source assertions are the guard-the-guard — without them, someone
 * editing the query fields would leave this file asserting the presence of two
 * indexes nothing uses any more, green forever.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

type IndexDef = { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order?: string }[] };

const indexes: IndexDef[] = JSON.parse(read('firestore.indexes.json')).indexes;

/**
 * True when an index exists on `collection`, at `scope`, whose leading fields
 * are exactly `fields`, in order.
 *
 * `scope` is not cosmetic and defaults to the strict answer. codex round 3 [P3]:
 * every query pinned below is built with `db.collection("pools")` /
 * `db.collection("nfl_games")`, which a COLLECTION_GROUP index does not serve.
 * Without this check, flipping one of these entries to COLLECTION_GROUP would
 * leave the guard green while the job went back to throwing FAILED_PRECONDITION
 * — the precise failure this file exists to catch.
 */
const hasIndex = (collection: string, fields: string[], scope = 'COLLECTION') =>
    indexes.some(
        (idx) =>
            idx.collectionGroup === collection &&
            idx.queryScope === scope &&
            idx.fields.length >= fields.length &&
            fields.every((f, i) => idx.fields[i]?.fieldPath === f),
    );

describe('enforceBillingStatus has the composite indexes its queries require', () => {
    const billing = read('functions/src/billing.ts');

    it('still runs the trial → grace_period query on those two fields', () => {
        // Guard-the-guard. If this query changes shape, the index assertion
        // below is pinning a stale pair and must be updated with it.
        expect(billing).toMatch(/\.where\(\s*"billing\.status",\s*"==",\s*"trial"\s*\)/);
        expect(billing).toMatch(/\.where\(\s*"billing\.trialEndsAt",\s*"<",\s*now\s*\)/);
    });

    it('still runs the grace_period → locked query on those two fields', () => {
        expect(billing).toMatch(/\.where\(\s*"billing\.status",\s*"==",\s*"grace_period"\s*\)/);
        expect(billing).toMatch(/\.where\(\s*"billing\.gracePeriodEndsAt",\s*"<",\s*now\s*\)/);
    });

    it('indexes the trial → grace_period query', () => {
        // An equality filter plus an inequality on a DIFFERENT field always
        // needs a composite index. This is the one that was missing.
        expect(hasIndex('pools', ['billing.status', 'billing.trialEndsAt'])).toBe(true);
    });

    it('indexes the grace_period → locked query', () => {
        expect(hasIndex('pools', ['billing.status', 'billing.gracePeriodEndsAt'])).toBe(true);
    });
});

describe('the other scheduled-job composite queries stay indexed', () => {
    // These four were already covered when the billing gap was found. They are
    // pinned so that deleting an index — the exact edit that caused this bug —
    // fails here rather than in production at 23:00 ET.
    it.each([
        ['autoLockPools', 'pools', ['type', 'status', 'lockAt']],
        ['nflFinalizeSweepJob', 'pools', ['type', 'scoredThroughWeek']],
        ['syncGameStatus', 'pools', ['scores.gameStatus', 'updatedAt']],
        ['runReminders (nfl_games lookahead)', 'nfl_games', ['season', 'startTime']],
    ])('%s → %s(%s)', (_job, collection, fields) => {
        expect(hasIndex(collection as string, fields as string[])).toBe(true);
    });
});

describe('a declared index has a deploy path that actually ships it', () => {
    // codex round 1 [P1]: `deploy:backend` was
    // `firebase deploy --only functions,firestore:rules` — it named two backend
    // surfaces and silently omitted the third. Declaring an index in this repo
    // and releasing through that script left the index absent in production and
    // the job still throwing FAILED_PRECONDITION, which is indistinguishable
    // from never having made the fix.
    //
    // This does NOT change the documented deploy posture. `mmp-change-control`
    // still prefers the explicit per-surface commands so functions-before-rules
    // ordering stays under the operator's control; index deploys are
    // independent of that ordering. This only stops the convenience script from
    // lying about its own scope.
    const pkg = JSON.parse(read('package.json'));

    it('deploy:backend covers firestore:indexes', () => {
        expect(pkg.scripts['deploy:backend']).toContain('firestore:indexes');
    });

    it('deploy:backend still covers the surfaces it always did', () => {
        // Guard against "fixing" the above by replacing the script wholesale.
        expect(pkg.scripts['deploy:backend']).toContain('functions');
        expect(pkg.scripts['deploy:backend']).toContain('firestore:rules');
    });
});

describe('hasIndex itself discriminates', () => {
    // Without this, a bug making hasIndex return true unconditionally would make
    // every assertion above vacuous and the suite would still be green.
    it('rejects a collection that has no such index', () => {
        expect(hasIndex('pools', ['billing.status', 'no.such.field'])).toBe(false);
        expect(hasIndex('no_such_collection', ['billing.status'])).toBe(false);
    });

    it('is order-sensitive — a composite index is not commutative', () => {
        // pools(type, scoredThroughWeek) exists; the reverse does not, and
        // Firestore would not serve a query needing it.
        expect(hasIndex('pools', ['scoredThroughWeek', 'type'])).toBe(false);
    });

    it('is scope-sensitive — a COLLECTION_GROUP index does not serve a collection query', () => {
        // The repo has a real COLLECTION_GROUP index on `entries`, so this
        // asserts against live config rather than a hypothetical: it is found at
        // its true scope and NOT found at COLLECTION.
        expect(hasIndex('entries', ['ownerUid', 'score'], 'COLLECTION_GROUP')).toBe(true);
        expect(hasIndex('entries', ['ownerUid', 'score'])).toBe(false);
    });
});
