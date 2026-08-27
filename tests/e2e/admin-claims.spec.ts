import { test, expect, type Page } from '@playwright/test';
import { registerFreshUser, promoteToSuperAdmin } from './helpers';

// Proves fix A: an admin promoted by Firestore-role only (no custom claim) can
// read the claim-gated admin_audit collection once the SuperAdmin page mounts.
// Before the fix this showed "Missing or insufficient permissions"; the page now
// calls syncMyClaims + refreshes the token (useEnsureAdminClaims) before the
// audit subscription runs.
const RUN_ID = `${Date.now()}`;

async function reachSuperAdmin(page: Page, email: string): Promise<void> {
  const heading = page.getByRole('heading', { name: /Super Admin Dashboard/i });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await promoteToSuperAdmin(email); // Firestore role only — deliberately no claim
    await page.goto('/');
    await page.reload();
    // Confirm the client reflects SUPER_ADMIN before hitting the gated route.
    // The 2026-08-27 grouped-nav redesign dropped the old "(ROLE)" suffix that
    // printed beside every name — "(MEMBER)" told nobody anything and was part
    // of the clutter that redesign answered. The ELEVATED roles kept a signal:
    // the account trigger carries a gold SUPER_ADMIN / MODERATOR chip, which is
    // the same fact this wait needs, minus the parentheses.
    const promoted = await page
      .getByText('SUPER_ADMIN', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!promoted) continue;
    await page.goto('/super-admin');
    // The App gate redirects to "/" if it evaluates while auth is still
    // resolving (user null). Wait past the "Syncing admin session…" gate; if it
    // bounced, retry the whole navigation.
    const reached = await heading
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (reached) return;
  }
  throw new Error(`reachSuperAdmin: never reached the dashboard; landed on ${page.url()}`);
}

test('admin_audit is readable after claim sync (no permission error)', async ({ page }) => {
  const email = `e2e-claims-${RUN_ID}@example.com`;
  await registerFreshUser(page, email);
  await reachSuperAdmin(page, email);

  // SuperAdmin nav is two-level since the 2026-07 redesign: clicking the
  // "System" GROUP button auto-selects the system tab and mounts the
  // AdminAuditViewer directly (no second click).
  await page.getByRole('button', { name: 'System', exact: true }).click();

  // The audit log read must NOT be denied. It's fine (and expected) that it's
  // empty — "No admin actions recorded yet" proves the read succeeded.
  await expect(page.getByText(/No admin actions recorded yet/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Missing or insufficient permissions/i)).toHaveCount(0);
});
