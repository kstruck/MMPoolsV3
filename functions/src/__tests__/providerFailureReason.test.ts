import { describe, it, expect } from 'vitest';
import { providerFailureReason, AIProviderError } from '../lib/aiProviderError';

/**
 * The AI Commissioner had never once worked in production (2026-08-24). The
 * Gemini API key carried an HTTP-referrer restriction; Cloud Functions send no
 * `Referer`, so every call came back 403 `API_KEY_HTTP_REFERRER_BLOCKED`.
 *
 * Diagnosing it took a production log pull, because every layer above the
 * provider reported the same sentence for a config mistake, a transient
 * network failure and an empty model response. This extracts the reason so the
 * request document — and therefore the commissioner's own screen — can name it.
 */

/** The real body, as the Google SDK threw it. */
const REFERRER_BLOCKED = JSON.stringify({
  error: {
    code: 403,
    message: 'Requests from referer <empty> are blocked.',
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_HTTP_REFERRER_BLOCKED',
        domain: 'googleapis.com',
      },
      { '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'en-US' },
    ],
  },
});

describe('providerFailureReason', () => {
  it('extracts the ErrorInfo reason — the one that cost a night', () => {
    expect(providerFailureReason(new Error(REFERRER_BLOCKED))).toBe('API_KEY_HTTP_REFERRER_BLOCKED');
  });

  it('reads it even when the SDK prefixes the JSON with text', () => {
    // The thrown message is not always pure JSON.
    expect(providerFailureReason(new Error(`ApiError: ${REFERRER_BLOCKED}`)))
      .toBe('API_KEY_HTTP_REFERRER_BLOCKED');
  });

  it('falls back to the status when no ErrorInfo detail is present', () => {
    const body = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
    expect(providerFailureReason(new Error(body))).toBe('RESOURCE_EXHAUSTED');
  });

  it('falls back to the HTTP code when there is no status either', () => {
    expect(providerFailureReason(new Error(JSON.stringify({ error: { code: 500 } })))).toBe('HTTP_500');
  });

  it('uses the error object’s own status when the message is not JSON', () => {
    expect(providerFailureReason(Object.assign(new Error('socket hang up'), { status: 503 })))
      .toBe('HTTP_503');
  });

  it('NEVER throws — it runs inside a catch block', () => {
    for (const bad of [undefined, null, 0, '', 'plain text', {}, [], new Error('nope')]) {
      expect(() => providerFailureReason(bad)).not.toThrow();
      expect(typeof providerFailureReason(bad)).toBe('string');
    }
  });

  it('says UNKNOWN rather than inventing a reason', () => {
    expect(providerFailureReason(new Error('socket hang up'))).toBe('UNKNOWN');
    expect(providerFailureReason(undefined)).toBe('UNKNOWN');
  });
});

describe('AIProviderError', () => {
  it('keeps the reason machine-readable and the message human', () => {
    const e = new AIProviderError('API_KEY_HTTP_REFERRER_BLOCKED', 'Requests from referer <empty> are blocked.');
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe('API_KEY_HTTP_REFERRER_BLOCKED');
    expect(e.message).toContain('blocked');
    expect(e.name).toBe('AIProviderError');
  });
});
