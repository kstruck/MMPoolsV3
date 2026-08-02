import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { STALE_REASON_LABEL, formatJobAge } from '../src/utils/opsHealthFormat';

/**
 * `getOpsHealthSummary` has read `system/heartbeats` and returned `staleJobs`
 * since the observability work shipped. The SuperAdmin card just never rendered
 * it: the client's local `OpsHealthSummary` interface omitted the field, so it
 * arrived over the wire and was dropped on the floor.
 *
 * That is the failure mode this file guards — not "is there a reader" (there
 * always was) but "does the reader's answer reach a human". A verdict nobody
 * sees is the same as no verdict, which is precisely what the heartbeats exist
 * to prevent: `nflFinalizeSweepJob` threw every day for ten days unnoticed.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('staleJobs reaches the operator', () => {
    const server = read('functions/src/opsHealth.ts');
    const client = read('src/components/SuperAdminBentoDashboard.tsx');

    it('the callable still returns it', () => {
        // If this half goes, the client renders an empty list forever and looks
        // healthy. Pin the field on the interface AND the value on the return —
        // a declared-but-never-populated field is the same silence.
        expect(server).toMatch(/staleJobs\?:\s*StaleJob\[\]/);
        expect(server).toMatch(/staleJobs:\s*findStaleJobs\(/);
    });

    it('OMITS it when the heartbeat read failed, rather than guessing', () => {
        // codex: on a read failure the fallback used to be `{}`, and
        // findStaleJobs duly reported the ENTIRE fleet as `never-ran` — the log
        // line said "liveness unknown" while the payload said "everything is
        // dead". Harmless while nothing rendered it; a false all-hands incident
        // the moment something did.
        expect(server).toContain('heartbeats = null;');
        expect(server).toMatch(/heartbeats === null[\s\S]{0,40}\{\}/);
    });

    it('the client declares it on the response type', () => {
        // The actual bug: the field was absent here, so TypeScript happily
        // discarded it. Nothing else in the codebase would have noticed.
        expect(client).toMatch(/staleJobs\?:\s*StaleJob\[\]/);
    });

    it('the client RENDERS each stale job, not just a count', () => {
        // A count alone tells an operator something is wrong and not what. The
        // job name is the actionable part.
        expect(client).toContain('staleJobs.map(');
        expect(client).toContain('j.jobName');
    });

    it('does not truncate the stale-job list', () => {
        // The alert/webhook lists are deliberately `.slice(0, 3)` samples. The
        // job fleet is ~20 and a silently truncated list would report "these are
        // the dead jobs" while hiding some — the same class of lie as a repair
        // job reporting a skip as a success.
        const staleRender = client.slice(client.indexOf('staleJobs.map('));
        expect(staleRender.slice(0, 40)).not.toContain('slice(');
    });

    it('distinguishes "no stale jobs" from "this deploy cannot tell me"', () => {
        // An empty array is a positive signal; `undefined` means the deployed
        // functions predate the field. Rendering 0 for both would fake an
        // all-clear — the exact thing this card exists to stop.
        expect(client).toMatch(/opsHealth\.staleJobs === undefined \? '—'/);
    });
});

describe('formatJobAge', () => {
    it('renders "never" for a job that has never completed a run', () => {
        // The most serious of the three verdicts. `findStaleJobs` reports it as
        // ageMinutes: null, and "0m ago" would read as the most RECENT run.
        expect(formatJobAge(null)).toBe('never');
    });

    it('uses minutes under an hour', () => {
        expect(formatJobAge(0)).toBe('0m');
        expect(formatJobAge(45)).toBe('45m');
        expect(formatJobAge(59.4)).toBe('59m');
    });

    it('uses hours from one hour to one day', () => {
        expect(formatJobAge(60)).toBe('1h');
        expect(formatJobAge(1439)).toBe('24h');
    });

    it('uses days from one day up', () => {
        expect(formatJobAge(1440)).toBe('1d');
        expect(formatJobAge(20160)).toBe('14d');
    });
});

describe('STALE_REASON_LABEL', () => {
    it('covers every reason findStaleJobs can emit', () => {
        // The union is duplicated across the wire (there is no shared module for
        // the ops-health shapes), so a new reason added server-side would render
        // as a raw enum value. Pinned against the server's own literal list.
        const heartbeat = read('functions/src/lib/heartbeat.ts');
        const reasons = heartbeat.match(/reason:\s*("never-ran"[^;]*);/);

        expect(reasons, 'StaleJob.reason union not found — did it move?').not.toBeNull();
        for (const key of Object.keys(STALE_REASON_LABEL)) {
            expect(reasons![1]).toContain(`"${key}"`);
        }
        // ...and no reason the server can emit is missing a label.
        const serverReasons = reasons![1].match(/"[^"]+"/g)!.map((r) => r.replace(/"/g, ''));
        expect(Object.keys(STALE_REASON_LABEL).sort()).toEqual(serverReasons.sort());
    });
});
