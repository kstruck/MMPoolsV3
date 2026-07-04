import type { Page } from '@playwright/test';

// Full-stack E2E helpers driving the REAL app (registration form, wizard UI,
// createPool/createNFLPool/createBracketPool callables) against local Firebase
// emulators — no mocks, no auth bypass. Each test should call registerFreshUser
// with a unique email so re-runs against a reused (not-restarted) emulator
// don't collide with "email already in use".

export async function registerFreshUser(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Sign In \/ Register/i }).click();
  // Ensure Register mode (the modal may default to either mode).
  const nameField = page.locator('input[type="text"]').first();
  if (!(await nameField.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  }
  await page.locator('input[type="text"]').first().fill(`E2E ${email}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('testpass123');
  await page.getByRole('button', { name: /Create Account/i }).click();
  // Registration redirects to /participant on success.
  await page.waitForURL(/\/participant/, { timeout: 15_000 });
}

/** Clicks Next repeatedly from wherever the wizard currently is until Review, then accepts TOS. */
export async function advanceToReview(page: Page): Promise<void> {
  const tosLabel = page.locator('label', { hasText: /Terms of Service/i });
  for (let i = 0; i < 8; i++) {
    if (await tosLabel.isVisible().catch(() => false)) break;
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
  }
  await tosLabel.locator('input[type="checkbox"]').check();
}

/** Fills #name (must be on the Basics step), then advances to Review and accepts TOS. */
export async function fillBasicsAndAdvanceToReview(page: Page, poolName: string): Promise<void> {
  await page.locator('#name').fill(poolName);
  await advanceToReview(page);
}

/** Clicks the final submit button and waits for navigation to /pool/:id. */
export async function submitAndExpectPoolCreated(page: Page, submitLabelPattern: RegExp): Promise<string> {
  await page.getByRole('button', { name: submitLabelPattern }).click();
  await page.waitForURL(/\/pool\/[a-zA-Z0-9]+/, { timeout: 15_000 });
  const match = page.url().match(/\/pool\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Did not navigate to a pool URL; landed on ${page.url()}`);
  return match[1];
}
