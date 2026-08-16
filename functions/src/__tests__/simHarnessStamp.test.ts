import { describe, it, expect, vi } from 'vitest';

// Stub firebase-admin so poolOps → billing.ts top-level `admin.firestore()`
// does not crash at import (same pattern as poolOpsBilling.test.ts).
vi.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: () => ({ doc: () => ({}) }) });
    firestore.FieldValue = { increment: () => ({}), arrayUnion: () => ({}), delete: () => ({}) };
    firestore.Timestamp = { now: () => ({ toMillis: () => 0 }) };
    return { firestore, __esModule: true, default: { firestore } };
});

import { simRunIdForCreate, stripPrivilegedPoolFields, assertSeasonNotForgedSim } from '../poolOps';
import { simSeason } from '../simHarness';

// PLAN-TEST-SUITE 8f: simRunId is the sim harness trust anchor. It must be
// (a) stripped from every client payload, and (b) re-stamped only for
// SUPER_ADMIN callers with a well-formed run id.
describe('simRunId trust anchor', () => {
    it('is stripped from client create payloads', () => {
        const clean = stripPrivilegedPoolFields({ name: 'x', simRunId: 'sneaky-run' });
        expect(clean).not.toHaveProperty('simRunId');
    });

    // Same class, found by codex r1 on PR A: the stats discriminator's explicit
    // arm. The create envelopes are PERMISSIVE and spread the surviving payload
    // into an Admin SDK write that firestore.rules never sees, so a creator who
    // could smuggle this field through would keep their own pool's money out of
    // every published figure.
    it('isTestPool is stripped from client create payloads', () => {
        const clean = stripPrivilegedPoolFields({ name: 'x', isTestPool: true });
        expect(clean).not.toHaveProperty('isTestPool');
        expect(clean.name).toBe('x');
    });

    it('strips the scorer-owned pool-week maps a creator must not seed (qodo #10 on #452)', () => {
        const clean = stripPrivilegedPoolFields({ name: 'x', frozenTiebreakTargets: { 1: ['g'] }, weeksInSeason: 3, hardLockByWeek: { 1: 5 } }) as Record<string, unknown>;
        expect(clean).toEqual({ name: 'x' });
    });

    it('stamps only for SUPER_ADMIN', () => {
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, 'SUPER_ADMIN')).toBe('run-12345');
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, 'COMMISSIONER')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'run-12345' }, undefined)).toBeUndefined();
    });

    it('rejects malformed run ids even for SUPER_ADMIN', () => {
        expect(simRunIdForCreate({ simRunId: 'X' }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 'has spaces' }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({ simRunId: 42 }, 'SUPER_ADMIN')).toBeUndefined();
        expect(simRunIdForCreate({}, 'SUPER_ADMIN')).toBeUndefined();
    });

    it('simSeason produces a value no real ESPN import can generate', () => {
        expect(simSeason('run-12345')).toBe('sim-run-12345');
        // Real seasons are 4-digit year strings — the sim- prefix can never collide.
        expect(simSeason('run-12345')).not.toMatch(/^\d{4}$/);
    });
});

// codex r2 on PR A: a `sim-` SEASON is arm 1 of the stats test-pool discriminator
// AND what nflAutoScore / nflLockWatch / the finalize sweep already skip on. A
// creator who could mint one would keep their own paid pool out of every published
// money figure and out of automated scoring. The update-side half of the same hole
// is firestore.rules seasonNotForgedSim().
describe('assertSeasonNotForgedSim', () => {
    it('allows the harness: a sim- season WITH a stamped run id', () => {
        expect(() => assertSeasonNotForgedSim('sim-run-12345', 'run-12345')).not.toThrow();
    });

    it('rejects a sim- season with no stamped run id', () => {
        expect(() => assertSeasonNotForgedSim('sim-anything', undefined)).toThrow(/reserved for the simulation harness/);
    });

    it('fails CLOSED for a SUPER_ADMIN whose run id was malformed and so never stamped', () => {
        // simRunIdForCreate returns undefined for a bad id even on SUPER_ADMIN, so
        // gating on the STAMPED value rather than the raw claim is what makes this
        // path safe.
        const stamped = simRunIdForCreate({ simRunId: 'X' }, 'SUPER_ADMIN');
        expect(stamped).toBeUndefined();
        expect(() => assertSeasonNotForgedSim('sim-x', stamped)).toThrow();
    });

    it('leaves every real season alone', () => {
        for (const s of ['2026', 2026, '', undefined, null, 'simulate-me', 'SIM-2026']) {
            expect(() => assertSeasonNotForgedSim(s, undefined)).not.toThrow();
        }
    });
});
