import { test, expect } from '@playwright/test';
import { registerFreshUser, fillBasicsAndAdvanceToReview, advanceToReview, submitAndExpectPoolCreated } from './helpers';

// Full-stack create-pool E2E: real registration (real onUserCreated trigger),
// real WizardShell UI, real createPool/createNFLPool/createBracketPool
// callables, against local Firebase emulators. One test per pool type.
// Each uses a unique email so re-runs against a `reuseExistingServer` emulator
// don't collide on "email already in use".
const RUN_ID = `${Date.now()}`;

test.describe('unified create-pool wizard — all 7 pool types', () => {
  test('SQUARES', async ({ page }) => {
    await registerFreshUser(page, `e2e-squares-${RUN_ID}@example.com`);
    await page.goto('/create/squares');
    await fillBasicsAndAdvanceToReview(page, 'E2E Squares');
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });

  test('BRACKET', async ({ page }) => {
    await registerFreshUser(page, `e2e-bracket-${RUN_ID}@example.com`);
    await page.goto('/create/bracket');
    await fillBasicsAndAdvanceToReview(page, 'E2E Bracket');
    await submitAndExpectPoolCreated(page, /Create draft/i);
  });

  test('NFL_PLAYOFFS', async ({ page }) => {
    await registerFreshUser(page, `e2e-playoff-${RUN_ID}@example.com`);
    await page.goto('/create/playoff');
    await fillBasicsAndAdvanceToReview(page, 'E2E Playoff');
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });

  test('NFL_PICKEM', async ({ page }) => {
    await registerFreshUser(page, `e2e-pickem-${RUN_ID}@example.com`);
    await page.goto('/create/pickem');
    await fillBasicsAndAdvanceToReview(page, 'E2E Pickem');
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });

  test('NFL_SURVIVOR', async ({ page }) => {
    await registerFreshUser(page, `e2e-survivor-${RUN_ID}@example.com`);
    await page.goto('/create/survivor');
    await fillBasicsAndAdvanceToReview(page, 'E2E Survivor');
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });

  test('NFL_MARGIN', async ({ page }) => {
    await registerFreshUser(page, `e2e-margin-${RUN_ID}@example.com`);
    await page.goto('/create/margin');
    await fillBasicsAndAdvanceToReview(page, 'E2E Margin');
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });

  test('PROPS', async ({ page }) => {
    await registerFreshUser(page, `e2e-props-${RUN_ID}@example.com`);
    await page.goto('/create/props');
    await page.locator('#name').fill('E2E Props');
    const setupNext = page.getByRole('button', { name: 'Next', exact: true });
    await setupNext.click(); // Basics -> Props setup
    // Props setup requires at least one real question before it validates —
    // add one and fill it in (the empty-array default deliberately does not
    // pre-seed an invalid placeholder question).
    await page.getByRole('button', { name: '+ Add question' }).click();
    await page.locator('#q-0-text').fill('Who wins the coin toss?');
    await page.locator('#q-0-opts').fill('Heads, Tails');
    await advanceToReview(page);
    await submitAndExpectPoolCreated(page, /Launch pool/i);
  });
});
