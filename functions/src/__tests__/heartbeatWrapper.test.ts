import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * withHeartbeat's WRITE path, exercised against the real wrapper.
 *
 * Kept apart from heartbeat.test.ts because it needs a module-level
 * firebase-admin mock, and that file walks the source tree with `fs` for its
 * coverage invariants — mocking admin there would apply to a file whose whole
 * point is reading real source off disk.
 *
 * The case that matters: a run that DID NOT THROW but reported itself degraded.
 * syncScoresWindow resolves cleanly through a total ESPN outage (the fetcher
 * catches and returns an empty slate) and through a failed snapshot write
 * (captureFeedSnapshot returns "skipped"), so a wrapper that only watched for
 * throws would stamp ok:true through the exact A5 failure this module exists to
 * expose. Found by codex review on PR #245.
 */

const stamped: Array<Record<string, any>> = [];

/** Each write, as `{ payload, options }` — the options are the point of two tests below. */
const stampedOptions: Array<any> = [];

const fakeDb = {
    doc: () => ({
        set: async (payload: Record<string, any>, options?: any) => {
            stamped.push(payload);
            stampedOptions.push(options);
        },
    }),
};

vi.mock('firebase-admin', () => {
    // Declared INSIDE the factory: vi.mock is hoisted above every top-level
    // binding in this file, so a class declared outside is not yet initialised.
    class FakeFieldPath {
        constructor(public readonly segment: string) {}
    }
    const firestore: any = () => fakeDb;
    firestore.FieldPath = FakeFieldPath;
    return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});

// Import AFTER the mock is set up.
import { withHeartbeat, HEARTBEAT_DOC } from '../lib/heartbeat';

/** The beat recorded for `job` by the last wrapped call. */
const beat = (job: string) => stamped.at(-1)?.[job];

describe('withHeartbeat stamps what the handler actually reported', () => {
    beforeEach(() => { stamped.length = 0; stampedOptions.length = 0; });

    it('records ok when the handler returns nothing (the common case)', async () => {
        await withHeartbeat('jobA', async () => { /* no verdict */ })();
        expect(beat('jobA')).toMatchObject({ ok: true });
        expect(typeof beat('jobA').at).toBe('number');
    });

    it('REPLACES the job field rather than merging into it', async () => {
        // The bug this pins: set(..., {merge:true}) merges nested maps leaf by
        // leaf, so anything omitted survives from the previous run — yesterday's
        // `error` stays on a job that has since recovered, and a `detail` from a
        // disabled run keeps sitting beside the next run's live counters. Naming
        // the job field in mergeFields replaces it wholesale instead, in one
        // write, without touching any other job's entry.
        await withHeartbeat('jobH', async () => { /* healthy */ })();
        const opts = stampedOptions.at(-1);
        expect(opts?.merge, 'a plain merge would let stale keys survive').toBeUndefined();
        expect(opts?.mergeFields?.[0]?.constructor?.name).toBe('FakeFieldPath');
        expect(opts?.mergeFields?.[0].segment).toBe('jobH');
    });

    it('omits error and detail entirely when the run has none', async () => {
        await withHeartbeat('jobI', async () => { /* healthy */ })();
        expect(Object.keys(beat('jobI'))).toEqual(['at', 'ok']);
    });

    it('scopes the replacement to THIS job, never the whole heartbeats doc', async () => {
        // A doc-wide replace would wipe every other job's heartbeat — turning a
        // liveness signal into a liveness eraser.
        await withHeartbeat('jobJ', async () => ({ detail: { a: 1 } }))();
        expect(stampedOptions.at(-1)?.mergeFields).toHaveLength(1);
        expect(Object.keys(stamped.at(-1)!)).toEqual(['jobJ']);
    });

    it('records ok:false for a DEGRADED run that did not throw', async () => {
        await withHeartbeat('jobB', async () => ({
            ok: false, error: '2 slate fetch(es) failed', detail: { slateFetchFailures: 2 },
        }))();
        expect(beat('jobB')).toMatchObject({
            ok: false, error: '2 slate fetch(es) failed', detail: { slateFetchFailures: 2 },
        });
    });

    it('does NOT rethrow on a degraded verdict — a degraded run is not a crash', async () => {
        // A throw here would make Cloud Functions retry the whole job over an
        // ESPN blip, which is worse than recording the degradation and moving on.
        await expect(withHeartbeat('jobC', async () => ({ ok: false, error: 'x' }))()).resolves.toBeUndefined();
    });

    it('records detail on a healthy run too, so a quiet run is still diagnosable', async () => {
        await withHeartbeat('jobD', async () => ({ detail: { slates: 2, gamesWritten: 16 } }))();
        expect(beat('jobD')).toMatchObject({ ok: true, detail: { slates: 2, gamesWritten: 16 } });
    });

    it('still records ok:false AND rethrows when the handler throws', async () => {
        await expect(withHeartbeat('jobE', async () => { throw new Error('boom'); })())
            .rejects.toThrow('boom');
        expect(beat('jobE')).toMatchObject({ ok: false, error: 'boom' });
    });

    it('truncates a runaway error message from either path', async () => {
        await withHeartbeat('jobF', async () => ({ ok: false, error: 'x'.repeat(900) }))();
        expect(beat('jobF').error).toHaveLength(500);
    });

    it('writes to the single heartbeats doc, keyed by job name', async () => {
        await withHeartbeat('jobG', async () => undefined)();
        expect(HEARTBEAT_DOC).toBe('system/heartbeats');
        expect(Object.keys(stamped.at(-1)!)).toEqual(['jobG']);
    });
});
