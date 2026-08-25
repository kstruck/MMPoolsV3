import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Members tab extraction guard (SuperAdmin.tsx split, phase 1).
 *
 * The Members tab's markup moved from `SuperAdmin.tsx` into
 * `src/components/admin/MembersTab.tsx` with ZERO behaviour change: only JSX
 * crossed the boundary, every piece of state and every handler stayed behind and
 * is passed in as a prop.
 *
 * That shape has one specific failure mode, and it is silent: a prop that the
 * panel expects but the call site never passes arrives as `undefined`. A missing
 * `handleDeleteUser` does not crash the render — the Delete button simply stops
 * working, which is exactly the class of loss the admin-surface clobber guards
 * were written for after PRs #116/#117 reverted the admin overhaul unnoticed.
 * `tsc` catches the omission today; this pins it so a later `?:` on the interface
 * cannot quietly re-open it.
 *
 * These are source-text checks for the same reason the T3/T6/T7 guards in
 * admin-surface-invariants.test.ts are: the thing being protected is wiring, and
 * a literal is what fails when wiring disappears.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const admin = read('src/components/SuperAdmin.tsx');
const members = read('src/components/admin/MembersTab.tsx');

const PANELS = [
  'MembersUsersPanel',
  'MembersReferralsComputedPanel',
  'MembersLoyaltyPanel',
  'MembersReferralsStoredPanel',
  'MembersEditUserModal',
  'MembersViewUserModal',
] as const;

/** Props declared on `interface <name>Props { ... }` in MembersTab.tsx. */
function declaredProps(component: string): string[] {
  const m = members.match(new RegExp(`export interface ${component}Props \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no props interface for ${component}`);
  return [...m[1].matchAll(/^\s{4}(\w+)(\??):/gm)].map((x) => x[1]);
}

/** Attributes passed at the `<Component ... />` call site in SuperAdmin.tsx. */
function passedProps(component: string): string[] {
  const m = admin.match(new RegExp(`<${component}\\b([\\s\\S]*?)/>`));
  if (!m) throw new Error(`${component} is never rendered by SuperAdmin.tsx`);
  return [...m[1].matchAll(/^\s+(\w+)=\{/gm)].map((x) => x[1]);
}

describe('every extracted panel is exported, imported and rendered', () => {
  it.each(PANELS)('%s is exported from MembersTab.tsx', (name) => {
    expect(members).toContain(`export const ${name}: React.FC<${name}Props>`);
  });

  it('SuperAdmin.tsx imports all six from ./admin/MembersTab', () => {
    const imp = admin.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/admin\/MembersTab'/);
    expect(imp).not.toBeNull();
    const imported = (imp?.[1] ?? '').split(',').map((s) => s.trim());
    expect([...PANELS].sort()).toEqual(imported.sort());
  });

  it.each(PANELS)('%s is actually mounted, not merely imported', (name) => {
    expect(admin).toContain(`<${name}`);
  });
});

describe('no prop is silently dropped at the call site', () => {
  it.each(PANELS)('%s receives every prop it declares', (name) => {
    const declared = declaredProps(name);
    expect(declared.length).toBeGreaterThan(0);
    const passed = passedProps(name);
    expect(declared.filter((p) => !passed.includes(p))).toEqual([]);
  });

  it.each(PANELS)('%s is passed nothing it does not declare', (name) => {
    const declared = declaredProps(name);
    expect(passedProps(name).filter((p) => !declared.includes(p))).toEqual([]);
  });

  it('no prop is optional — an optional handler is an undefined handler', () => {
    // `handleDeleteUser?: (u: User) => void` would type-check with the prop
    // missing, which is precisely the silent loss this file exists to stop.
    for (const name of PANELS) {
      const body = members.match(new RegExp(`export interface ${name}Props \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(body).not.toMatch(/^\s{4}\w+\?:/m);
    }
  });
});

describe('the sub-tab gating is unchanged', () => {
  // The 8-tab contract test in admin-surface-invariants.test.ts reads the
  // `activeTab === '<id>'` render blocks out of SuperAdmin.tsx, so the CONDITIONS
  // had to stay there — only the markup inside them moved.
  it.each(['users', 'referrals', 'loyalty'])("still branches on activeTab === '%s'", (id) => {
    expect(admin).toContain(`activeTab === '${id}'`);
  });

  it('the two member modals still gate on their own state', () => {
    expect(admin).toMatch(/editingUser && \(\s*<MembersEditUserModal/);
    expect(admin).toMatch(/viewingUser && \(\s*<MembersViewUserModal/);
  });

  it('the Referrals sub-tab still renders BOTH referral panels', () => {
    // PRE-EXISTING and deliberately preserved: SuperAdmin.tsx had two separate
    // `activeTab === 'referrals'` blocks — one counting referrals locally, one
    // reading the stored `referralCount` — so the sub-tab has always shown two
    // Referral Dashboards stacked. Pinned here so the follow-up that removes one
    // is a deliberate edit to this test rather than an accident of a refactor.
    expect(admin).toContain('<MembersReferralsComputedPanel');
    expect(admin).toContain('<MembersReferralsStoredPanel');
    expect((admin.match(/activeTab === 'referrals'/g) ?? []).length).toBe(2);
  });
});

describe('every Members capability survived the move', () => {
  // One string per capability that used to live inline in SuperAdmin.tsx. If a
  // panel is dropped or gutted, the string goes with it.
  it.each([
    'Export Emails',          // Users header — CSV export (unaudited; known gap)
    'Backfill Roles',         // Users header — backfillUserRoles callable
    'Force Sync',             // Users header — syncAllUsers
    'Recalculate Stats',      // Users header — recalculateGlobalStats
    'CANONICAL_ROLES.map',    // the role selector itself
    'setRoleChange',          // which routes through the typed-confirm modal
    'Reset Password',         // member popup action
    'Referral Dashboard',     // Referrals sub-tab
    'Tiers Control Center',   // Loyalty sub-tab tier editor
    'MOCK PROMO SENDER MODAL',// the loyalty promo theater, preserved as-is
  ])('MembersTab.tsx still contains %j', (needle) => {
    expect(members).toContain(needle);
  });

  it('the audited admin path came across with the buttons that use it', () => {
    expect(members).toContain('dbService.logAdminAction');
  });

  it('the handlers and state did NOT move — SuperAdmin.tsx still owns them', () => {
    // Phase 1 is a JSX-only extraction. These are the assertions that fail if a
    // later pass quietly starts lifting state, which would change render timing.
    expect(admin).toContain('dbService.setUserRole');
    expect(admin).toContain('dbService.searchUsersByEmail');
    expect(admin).toContain('DELETE_USER_ACCOUNT');
    expect(members).not.toContain('useState');
  });
});
