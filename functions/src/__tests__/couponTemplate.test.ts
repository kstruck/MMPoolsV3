/**
 * couponTemplate.test.ts — Unit tests for the Coupon Template schema + the
 * pure `couponFieldsFromTemplate` minting helper (PLAN-BUYFLOW-OVERHAUL Phase 6
 * #23). Verifies: template validation (accept valid, reject malformed), and
 * that minting from a template produces a valid COUPON field set (discount
 * shape carried, constraints preserved, no undefined leaks, code/counters
 * intentionally absent — the callable stamps those). Runner: vitest, pure (no
 * firebase-admin) like couponReservation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  couponTemplateInputSchema,
  couponTemplateDocSchema,
  couponFieldsFromTemplate,
  type CouponTemplateBody,
} from '../shared/schemas/couponTemplate';

describe('couponTemplateInputSchema validation', () => {
  it('accepts a minimal valid percentage template', () => {
    const r = couponTemplateInputSchema.safeParse({
      name: 'Black Friday',
      discountType: 'percentage',
      discountValue: 25,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isActive).toBe(true); // defaulted
      expect(r.data.name).toBe('Black Friday');
    }
  });

  it('accepts a full flat template with all constraints', () => {
    const r = couponTemplateInputSchema.safeParse({
      name: 'Preseason $10',
      notes: 'give to returning commissioners',
      discountType: 'flat',
      discountValue: 10,
      isActive: false,
      maxUses: 100,
      perUserLimit: 1,
      expiresAt: 1_800_000_000_000,
      allowedPoolTypes: ['SQUARES', 'BRACKET'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a missing name', () => {
    const r = couponTemplateInputSchema.safeParse({ discountType: 'flat', discountValue: 5 });
    expect(r.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const r = couponTemplateInputSchema.safeParse({ name: '   ', discountType: 'flat', discountValue: 5 });
    expect(r.success).toBe(false);
  });

  it('rejects a non-positive discountValue', () => {
    const r = couponTemplateInputSchema.safeParse({ name: 'X', discountType: 'percentage', discountValue: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown discountType', () => {
    const r = couponTemplateInputSchema.safeParse({ name: 'X', discountType: 'bogus', discountValue: 5 });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown pool type in allowedPoolTypes', () => {
    const r = couponTemplateInputSchema.safeParse({
      name: 'X',
      discountType: 'flat',
      discountValue: 5,
      allowedPoolTypes: ['NOT_A_POOL'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a fractional maxUses (must be int)', () => {
    const r = couponTemplateInputSchema.safeParse({
      name: 'X',
      discountType: 'flat',
      discountValue: 5,
      maxUses: 3.5,
    });
    expect(r.success).toBe(false);
  });
});

describe('couponTemplateDocSchema', () => {
  it('accepts a stored template doc with createdAt', () => {
    const r = couponTemplateDocSchema.safeParse({
      name: 'Stored',
      discountType: 'percentage',
      discountValue: 15,
      isActive: true,
      createdAt: 1_700_000_000_000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a doc missing createdAt', () => {
    const r = couponTemplateDocSchema.safeParse({
      name: 'Stored',
      discountType: 'percentage',
      discountValue: 15,
      isActive: true,
    });
    expect(r.success).toBe(false);
  });
});

describe('couponFieldsFromTemplate (mint helper)', () => {
  it('carries the discount shape and isActive', () => {
    const body: CouponTemplateBody = {
      discountType: 'percentage',
      discountValue: 30,
      isActive: true,
    };
    const fields = couponFieldsFromTemplate(body);
    expect(fields.discountType).toBe('percentage');
    expect(fields.discountValue).toBe(30);
    expect(fields.isActive).toBe(true);
  });

  it('preserves optional constraints when present', () => {
    const body: CouponTemplateBody = {
      discountType: 'flat',
      discountValue: 10,
      isActive: false,
      maxUses: 50,
      perUserLimit: 2,
      expiresAt: 1_800_000_000_000,
      allowedPoolTypes: ['SQUARES'],
    };
    const fields = couponFieldsFromTemplate(body);
    expect(fields.maxUses).toBe(50);
    expect(fields.perUserLimit).toBe(2);
    expect(fields.expiresAt).toBe(1_800_000_000_000);
    expect(fields.allowedPoolTypes).toEqual(['SQUARES']);
  });

  it('omits absent constraints entirely (no undefined leaks into Firestore)', () => {
    const body: CouponTemplateBody = {
      discountType: 'percentage',
      discountValue: 20,
      isActive: true,
    };
    const fields = couponFieldsFromTemplate(body);
    expect('maxUses' in fields).toBe(false);
    expect('perUserLimit' in fields).toBe(false);
    expect('expiresAt' in fields).toBe(false);
    expect('allowedPoolTypes' in fields).toBe(false);
    // No key should hold undefined.
    for (const v of Object.values(fields)) expect(v).not.toBeUndefined();
  });

  it('omits an empty allowedPoolTypes array (empty === all formats)', () => {
    const body: CouponTemplateBody = {
      discountType: 'flat',
      discountValue: 5,
      isActive: true,
      allowedPoolTypes: [],
    };
    const fields = couponFieldsFromTemplate(body);
    expect('allowedPoolTypes' in fields).toBe(false);
  });

  it('does NOT carry code, usesCount, usageLog, or createdAt (those are minted fresh)', () => {
    const body: CouponTemplateBody = {
      discountType: 'flat',
      discountValue: 5,
      isActive: true,
      maxUses: 10,
    };
    const fields = couponFieldsFromTemplate(body);
    expect('code' in fields).toBe(false);
    expect('usesCount' in fields).toBe(false);
    expect('usageLog' in fields).toBe(false);
    expect('createdAt' in fields).toBe(false);
    expect('name' in fields).toBe(false);
    expect('notes' in fields).toBe(false);
  });

  it('produces a shape that, once code+counters are added, satisfies the live Coupon field expectations', () => {
    // Simulate what mintCouponFromTemplate writes.
    const body: CouponTemplateBody = {
      discountType: 'percentage',
      discountValue: 25,
      isActive: true,
      maxUses: 100,
    };
    const minted: Record<string, unknown> = {
      ...couponFieldsFromTemplate(body),
      code: 'BLACKFRIDAY',
      usesCount: 0,
      usageLog: [] as unknown[],
    };
    expect(minted.code).toBe('BLACKFRIDAY');
    expect(minted.usesCount).toBe(0);
    expect(minted.usageLog).toEqual([]);
    expect(minted.discountType).toBe('percentage');
    expect(minted.discountValue).toBe(25);
    expect(minted.maxUses).toBe(100);
    expect(minted.isActive).toBe(true);
  });
});
