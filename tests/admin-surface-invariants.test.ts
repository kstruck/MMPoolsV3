import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Admin-surface invariants (clobber guard).
 *
 * The T3/T6/T7 super-admin overhaul was silently reverted twice by merges from
 * branches cut before it landed (#116 ui-revamp, #117 wizard) — invisible to CI
 * because nothing asserted the admin surface's shape. These string/structure
 * checks fail loudly if any restored capability disappears again. They are
 * deliberately coarse: they verify wiring exists, not behavior (behavior is
 * covered by roles-parity, adminAudit, and the callable tests).
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('T3 — no fake dashboard cards', () => {
  const bento = read('src/components/SuperAdminBentoDashboard.tsx');
  it.each([
    'Security Audit',
    'Database Migration Tools',
    'Automation Test Suite',
    'A+ (CLEAN)',
    '42 passed',
  ])('placeholder string %j is gone', (s) => {
    expect(bento).not.toContain(s);
  });
});

describe('T7 — Operations tab is wired', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  it('imports OperationsPanel', () => {
    expect(admin).toMatch(/import\s*\{\s*OperationsPanel\s*\}\s*from\s*'\.\/admin\/OperationsPanel'/);
  });
  it('renders the Operations tab', () => {
    expect(admin).toContain("activeTab === 'operations'");
    expect(admin).toContain('<OperationsPanel />');
  });
  it('registers an Operations nav item', () => {
    expect(admin).toMatch(/id:\s*'operations'/);
  });
});

describe('T6 — role-management UI is present', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  it('imports the canonical role model', () => {
    expect(admin).toMatch(/from\s*'\.\.\/utils\/roles'/);
  });
  it('renders a role selector backed by setUserRole', () => {
    expect(admin).toContain('CANONICAL_ROLES.map');
    expect(admin).toContain('dbService.setUserRole');
  });
});

describe('functions export surface', () => {
  const index = read('functions/src/index.ts');
  it.each([
    'setUserRole',
    'logAdminAction',
    'getAdminHealthSnapshot',
    'adminSaveBillingConfig',
    'adminManageCoupon',
    'adminUpdatePoolBilling',
    'adminAdjustUserCredits',
  ])('exports %s', (name) => {
    expect(index).toContain(name);
  });
});

describe('step 2 — money-adjacent admin writes go through audited callables', () => {
  const panel = read('src/components/admin/SuperAdminBillingPanel.tsx');
  it('no direct client coupon writes', () => {
    expect(panel).not.toMatch(/addDoc\(\s*collection\(db,\s*'coupons'/);
    expect(panel).not.toMatch(/deleteDoc\(\s*doc\(db,\s*'coupons'/);
  });
  it('no direct client billing/referral config writes', () => {
    expect(panel).not.toMatch(/setDoc\([^)]*'billing_config'/);
    expect(panel).not.toMatch(/setDoc\([^)]*'referral_config'/);
  });
  it('uses the audited billing callables', () => {
    expect(panel).toContain('dbService.adminSaveBillingConfig');
    expect(panel).toContain('dbService.adminManageCoupon');
    expect(panel).toContain('dbService.adminUpdatePoolBilling');
    expect(panel).toContain('dbService.adminAdjustUserCredits');
  });
});

describe('8-tab consolidation — the canonical Super-Admin Dashboard tabs', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  // The NavGroup type union is the single source of the top-level tab set.
  const m = admin.match(/type NavGroup =\s*([^;]+);/);
  const tops = (m?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];

  it('has exactly the eight CONTEXT.md tabs, no more, no fewer', () => {
    expect([...tops].sort()).toEqual(
      ['Members', 'Monetization', 'Operations', 'Overview', 'Pools', 'System', 'Test Suite', 'Themes'].sort()
    );
  });

  it('routes every legacy render block under a tab (no orphaned activeTab section)', () => {
    // Every render block id must appear in navStructure so it stays reachable.
    const renderIds = new Set(
      [...admin.matchAll(/activeTab === '(\w+)'/g)].map((x) => x[1])
    );
    const navIds = new Set(
      [...admin.matchAll(/\{\s*id:\s*'(\w+)',\s*label:/g)].map((x) => x[1])
    );
    const orphans = [...renderIds].filter((id) => !navIds.has(id));
    expect(orphans).toEqual([]);
  });
});
