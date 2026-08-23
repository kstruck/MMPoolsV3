import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PLAN-COST-CONTROLS Phase 1.3 — ONE provider call must produce ONE usage event.
 *
 * The regression this pins was introduced by Phase 1 itself and caught in
 * self-review: `generateAIResponse` parses the model's JSON INSIDE the same try
 * block as the API call, and a malformed response throws
 * "Failed to parse AI JSON" — which lands in the outer catch, the same catch
 * that records provider failures. So a single billed call recorded BOTH a
 * `success` (with tokens and cost) and an `error`, inflating `calls` in the
 * daily rollup and making per-call cost averages read low.
 *
 * The cost ledger's question is "did the provider run and bill us". A parse
 * failure on our side does not change that answer, so the success event stands
 * alone and the error event is suppressed.
 */

const h = vi.hoisted(() => ({
  events: [] as any[],
  responseText: '',
  shouldThrowApi: false,
}));

vi.mock('../lib/usageEvents', () => ({
  recordUsageEvent: async (e: any) => { h.events.push(e); },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-key' }),
}));

vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER' },
  GoogleGenAI: class {
    models = {
      generateContent: async () => {
        if (h.shouldThrowApi) {
          const err: any = new Error('upstream exploded');
          err.status = 503;
          throw err;
        }
        return {
          text: h.responseText,
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
        };
      },
    };
  },
}));

// Model discovery uses global fetch; keep it failing so the fallback model is
// used deterministically and no network is touched.
vi.stubGlobal('fetch', async () => { throw new Error('no network in tests'); });

import { generateAIResponse } from '../gemini';

beforeEach(() => {
  h.events.length = 0;
  h.shouldThrowApi = false;
});

describe('generateAIResponse — usage accounting', () => {
  it('records exactly ONE success event for a well-formed response', async () => {
    h.responseText = JSON.stringify({ headline: 'ok', summaryBullets: [], explanationSteps: [], confidence: 1 });
    const out = await generateAIResponse('sys', { a: 1 }, { feature: 'ai.test', poolId: 'p1' });
    expect(out.headline).toBe('ok');
    expect(h.events).toHaveLength(1);
    expect(h.events[0].outcome).toBe('success');
    expect(h.events[0].inputTokens).toBe(1000);
    expect(h.events[0].outputTokens).toBe(200);
    expect(h.events[0].feature).toBe('ai.test');
    expect(h.events[0].poolId).toBe('p1');
  });

  it('records exactly ONE event when the response is malformed JSON', async () => {
    // Starts with '{' so the parse failure re-throws rather than falling back
    // to raw_response — this is the path that reaches the outer catch.
    h.responseText = '{ "headline": "truncated…';
    await expect(
      generateAIResponse('sys', { a: 1 }, { feature: 'ai.test', poolId: 'p1' })
    ).rejects.toThrow(/Failed to parse AI JSON/);

    // THE ASSERTION: one billed call, one event. Two would double-count.
    expect(h.events, 'a parse failure must not add a second event').toHaveLength(1);
    expect(h.events[0].outcome).toBe('success');
  });

  it('records ONE error event when the provider call itself fails', async () => {
    h.shouldThrowApi = true;
    await expect(
      generateAIResponse('sys', { a: 1 }, { feature: 'ai.test' })
    ).rejects.toThrow();
    expect(h.events).toHaveLength(1);
    expect(h.events[0].outcome).toBe('error');
    expect(h.events[0].errorCode).toBe('http_503');
    // No token counts on a failed call — they must not be invented.
    expect(h.events[0].inputTokens ?? null).toBeNull();
  });

  it('non-JSON text returns the raw fallback and still records one event', async () => {
    h.responseText = 'plain text answer';
    const out = await generateAIResponse('sys', { a: 1 }, { feature: 'ai.test' });
    expect(out.raw_response).toBe('plain text answer');
    expect(h.events).toHaveLength(1);
    expect(h.events[0].outcome).toBe('success');
  });
});
