import { describe, it, expect, vi } from 'vitest';

/**
 * PLAN-COST-CONTROLS 0.5.5 — the AI-volume probe on the Super-Admin health
 * snapshot.
 *
 * The property under test is that a BROKEN PROBE DOES NOT LOOK LIKE AN OUTAGE.
 * The Overview card derives its entire verdict from `checks.every(c => c.ok)`
 * (`src/components/SuperAdminBentoDashboard.tsx:164`), so a missing
 * collection-group index — the most likely failure here, and the
 * `enforceBillingStatus` failure mode this repo has already paid for once —
 * would otherwise print "Degradation detected" over a completely healthy
 * platform. This probe is telemetry, not an availability check.
 *
 * The first version got this wrong in the most embarrassing way available: it
 * carried a comment promising exactly this behaviour while delegating to a
 * helper that did the opposite (codex round 4).
 */

// adminHealth.ts calls admin.firestore() at module load, so the SDK is stubbed
// before import (same shape as checkoutOwnership.test.ts / entitlements.test.ts).
vi.mock('firebase-admin', () => {
  const firestore = () => ({});
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore };
});

const { checkAiVolume } = await import('../adminHealth');

/** A minimal db whose aggregation query resolves to `count`, or throws. */
const fakeDb = (outcome: { count: number } | { throws: string }) => ({
  collectionGroup: (name: string) => {
    expect(name).toBe('ai_requests');
    return {
      where: (field: string, op: string) => {
        // Pins the query the fieldOverrides entry in firestore.indexes.json was
        // declared for. If the query changes shape, the declared index no
        // longer serves it and production throws FAILED_PRECONDITION forever.
        expect(field).toBe('createdAt');
        expect(op).toBe('>=');
        return {
          count: () => ({
            get: async () => {
              if ('throws' in outcome) throw new Error(outcome.throws);
              return { data: () => ({ count: outcome.count }) };
            },
          }),
        };
      },
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe('checkAiVolume', () => {
  it('reports the 24h count on the happy path', async () => {
    const res = await checkAiVolume(fakeDb({ count: 42 }));
    expect(res.ok).toBe(true);
    expect(res.detail).toBe('42 AI requests last 24h');
  });

  it('stays ok:true when the query throws — a broken probe is not an outage', async () => {
    // The missing-index case, verbatim from what Firestore actually returns.
    const res = await checkAiVolume(fakeDb({ throws: '9 FAILED_PRECONDITION: The query requires an index' }));
    expect(res.ok, 'a failed telemetry probe flipped the whole health card to degraded').toBe(true);
  });

  it('says "unavailable" rather than inventing a plausible number', async () => {
    // "Data unavailable → the card shows 'unavailable', never a
    // plausible-looking substitute." Reporting 0 here would read as "no AI
    // spend", which is the wrong thing to believe exactly when the probe is
    // broken and spend is the thing being watched.
    const res = await checkAiVolume(fakeDb({ throws: 'boom' }));
    expect(res.detail).toMatch(/unavailable/i);
    expect(res.detail).not.toMatch(/^0 AI requests/);
  });

  it('surfaces the reason so an operator can act on it', async () => {
    const res = await checkAiVolume(fakeDb({ throws: '9 FAILED_PRECONDITION: The query requires an index' }));
    expect(res.detail).toContain('FAILED_PRECONDITION');
  });

  it('records a latency on both paths', async () => {
    expect(typeof (await checkAiVolume(fakeDb({ count: 1 }))).latencyMs).toBe('number');
    expect(typeof (await checkAiVolume(fakeDb({ throws: 'x' }))).latencyMs).toBe('number');
  });
});
