import { describe, it, expect } from 'vitest';
import { capMetadata } from '../lib/adminAudit';

describe('capMetadata (admin_audit redaction + size cap)', () => {
  it('drops secret-like keys', () => {
    const out = capMetadata({ password: 'hunter2', token: 'abc', secret: 'x', name: 'ok' });
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.secret).toBe('[redacted]');
    expect(out.name).toBe('ok');
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(500);
    const out = capMetadata({ note: long });
    expect((out.note as string).length).toBeLessThanOrEqual(201);
    expect((out.note as string).endsWith('…')).toBe(true);
  });

  it('does not store nested blobs verbatim', () => {
    const out = capMetadata({ arr: [1, 2, 3], obj: { a: 1 } });
    expect(out.arr).toBe('[array]');
    expect(out.obj).toBe('[object]');
  });

  it('caps total size to ~1KB by dropping overflow keys', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) input[`k${i}`] = 'x'.repeat(150);
    const out = capMetadata(input, 1024);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(1024);
    expect(Object.keys(out).length).toBeLessThan(100);
  });

  it('handles undefined input', () => {
    expect(capMetadata(undefined)).toEqual({});
  });
});
