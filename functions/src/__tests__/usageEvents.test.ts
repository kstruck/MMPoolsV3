import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PLAN-COST-CONTROLS Phase 1.3/1.4 — paid-provider usage attribution.
 *
 * The properties pinned here:
 *
 * 1. IT NEVER THROWS INTO ITS CALLER. This module observes paid calls; if a
 *    telemetry write can fail an AI generation or an SMS send, the observer has
 *    become a new failure mode for the thing it observes.
 * 2. NO CONTENT EVER REACHES FIRESTORE — no prompts, responses or phone
 *    numbers. The collection is retained 90 days and is SUPER_ADMIN readable.
 * 3. UNPRICED CALLS ARE COUNTED SEPARATELY, so a rollup of unknown-model calls
 *    cannot be mistaken for a cheap month (cost sums NULL as nothing).
 */

const h = vi.hoisted(() => ({
  added: [] as any[],
  setCalls: [] as { id: string; data: any }[],
  addShouldThrow: false,
}));

vi.mock('firebase-admin', () => {
  const Timestamp = { fromMillis: (ms: number) => ({ __ts: ms }) };
  const firestore: any = () => ({
    collection: (name: string) => ({
      add: async (doc: any) => {
        if (h.addShouldThrow) throw new Error('Firestore unavailable');
        h.added.push({ collection: name, doc });
        return { id: 'evt1' };
      },
      doc: (id: string) => ({
        set: async (data: any) => { h.setCalls.push({ id, data }); },
      }),
    }),
  });
  firestore.Timestamp = Timestamp;
  return { firestore, default: { firestore } };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __server: true }),
    increment: (n: number) => ({ __inc: n }),
  },
}));

import {
  recordUsageEvent,
  dayKeyUTC,
  dailyAggregateId,
  USAGE_EVENTS_COLLECTION,
  RAW_EVENT_TTL_DAYS,
} from '../lib/usageEvents';

beforeEach(() => {
  h.added.length = 0;
  h.setCalls.length = 0;
  h.addShouldThrow = false;
});

describe('usageEvents — never throws into the caller', () => {
  it('resolves even when the Firestore write fails', async () => {
    h.addShouldThrow = true;
    // The assertion is simply that this does not reject.
    await expect(
      recordUsageEvent({ provider: 'gemini', feature: 'ai.dispute', outcome: 'success' })
    ).resolves.toBeUndefined();
  });
});

describe('usageEvents — what gets written', () => {
  it('records a priced Gemini call with its measured tokens and cost', async () => {
    await recordUsageEvent({
      provider: 'gemini', feature: 'ai.dispute', outcome: 'success',
      poolId: 'p1', userId: 'u1', model: 'gemini-2.0-flash',
      inputTokens: 1_000_000, outputTokens: 1_000_000, latencyMs: 1234,
    });
    expect(h.added).toHaveLength(1);
    const { collection, doc } = h.added[0];
    expect(collection).toBe(USAGE_EVENTS_COLLECTION);
    expect(doc.estimatedCostUSD).toBeCloseTo(0.5, 6);
    expect(doc.priced).toBe(true);
    expect(doc.poolId).toBe('p1');
    expect(doc.latencyMs).toBe(1234);
    expect(doc.priceCatalogVersion).toBeTruthy();
  });

  it('records an unknown model as unpriced with a NULL cost, never 0', async () => {
    await recordUsageEvent({
      provider: 'gemini', feature: 'ai.dispute', outcome: 'success',
      model: 'gemini-9.9-unreleased', inputTokens: 100, outputTokens: 100,
    });
    expect(h.added[0].doc.estimatedCostUSD).toBeNull();
    expect(h.added[0].doc.priced).toBe(false);
    // ...and the aggregate counts it, so the rollup cannot look "cheap".
    expect(h.setCalls[0].data.unpricedCalls).toEqual({ __inc: 1 });
    expect(h.setCalls[0].data.estimatedCostUSD).toEqual({ __inc: 0 });
  });

  it('stamps a TTL expiry the configured number of days out', async () => {
    const before = Date.now();
    await recordUsageEvent({ provider: 'gemini', feature: 'ai.recap', outcome: 'success' });
    const expiresAt = h.added[0].doc.expiresAt.__ts;
    const expectedMin = before + RAW_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000 - 5000;
    expect(expiresAt).toBeGreaterThan(expectedMin);
  });

  it('increments the matching outcome counter only', async () => {
    await recordUsageEvent({ provider: 'courier', feature: 'sms.member', outcome: 'skipped' });
    const agg = h.setCalls[0].data;
    expect(agg.skipped).toEqual({ __inc: 1 });
    expect(agg.successes).toEqual({ __inc: 0 });
    expect(agg.errors).toEqual({ __inc: 0 });
  });
});

describe('usageEvents — keys', () => {
  it('day key is UTC so aggregates do not shift under DST', () => {
    // 03:30Z on Mar 9 is Mar 8 in ET; a local-time key would bucket it to the
    // 8th and make a daily rollup jump or double-count at the DST boundary.
    expect(dayKeyUTC(new Date('2026-03-09T03:30:00Z'))).toBe('2026-03-09');
  });

  it('sanitises slashes out of the feature label so the id stays one document', () => {
    // Firestore treats '/' as a path separator: an unsanitised label would
    // write to a nested collection instead of the intended aggregate doc.
    const id = dailyAggregateId('2026-08-23', 'gemini', 'ai/dispute weird', 'p1');
    expect(id).not.toContain('/');
    expect(id).toBe('2026-08-23__gemini__ai_dispute_weird__p1');
  });

  it('uses a placeholder for pool-less events so the id stays well-formed', () => {
    expect(dailyAggregateId('2026-08-23', 'courier', 'sms.security', null))
      .toBe('2026-08-23__courier__sms.security____none__');
  });
});

describe('usageEvents — telemetry carries no content (plan 1.4)', () => {
  it('the module never references a prompt, response or phone field', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'usageEvents.ts'), 'utf8'
    );
    // Strip comments first: the header deliberately NAMES these words to say
    // they must never be written, and matching those would make this guard
    // pass/fail on prose rather than on the code.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['phoneNumber', 'e164', 'prompt', 'question', 'responseText', 'facts']) {
      expect(code, `usageEvents must not handle ${banned}`).not.toContain(banned);
    }
  });
});
