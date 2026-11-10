import { test, expect, type Page } from '@playwright/test';
import {
  registerFreshUser,
  promoteToSuperAdmin,
  fillBasicsAndAdvanceToReview,
  advanceToReview,
  submitAndExpectPoolCreated,
  readDoc,
} from './helpers';

// Full-stack create-pool E2E: real registration (real onUserCreated trigger),
// real WizardShell UI, real createPool/createNFLPool/createBracketPool
// callables, against local Firebase emulators. One test per pool type.
// Each uses a unique email so re-runs against a `reuseExistingServer` emulator
// don't collide on "email already in use".
//
// canAccessPoolCreation = POOLS_OPEN || isSuperAdmin(user), and POOLS_OPEN is
// currently false (pre-season gate) — so every test promotes its fresh user to
// SUPER_ADMIN (isolated to the demo-mmp emulator project) to reach the create
// routes at all.
const RUN_ID = `${Date.now()}`;

/**
 * Navigates to a /create/:type route after ensuring the client reflects the
 * SUPER_ADMIN role, retrying if the route bounces back to "/" (the
 * canAccessPoolCreation gate reading a still-PARTICIPANT client user).
 *
 * The promotion is an out-of-band Firestore REST write (see promoteToSuperAdmin)
 * — the app only learns about it through its user-doc read on auth init. A
 * page.reload() re-runs onAuthStateChanged -> syncUserToFirestore's getDoc,
 * which (with the in-memory cache the app uses in emulator mode — see
 * src/firebase.ts) hits the emulator directly and returns the fresh role.
 * The live onSnapshot listener does NOT deliver an out-of-band write against
 * the Firestore emulator, so the reload is the deterministic mechanism here,
 * not a race workaround.
 */
async function gotoCreateRoute(page: Page, email: string, path: string): Promise<void> {
  // The role is already promoted server-side (registerAsAdmin). A reload makes
  // the client re-read it: onAuthStateChanged -> syncUserToFirestore's getDoc,
  // which with the in-memory cache used in emulator mode (see src/firebase.ts)
  // hits the emulator directly and returns SUPER_ADMIN. Wait for the header to
  // reflect it before navigating, so the route guard doesn't evaluate while the
  // async auth chain is still resolving (which would bounce us to "/").
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto('/');
    await page.reload();
    const promoted = await page
      .getByText('(SUPER_ADMIN)')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (promoted) break;
    await promoteToSuperAdmin(email); // re-assert in case a stray write reset it
  }
  await page.goto(path); // goto waits for 'load'; do NOT wait for networkidle —
  // Firestore's onSnapshot holds a persistent channel so the page is never idle.
  // Route-guard redirects are synchronous on first render, so a short settle is
  // enough to know whether we stuck on the route or bounced to "/".
  await page.waitForTimeout(500);
  if (!page.url().endsWith(path)) {
    throw new Error(`gotoCreateRoute: bounced off ${path}; landed on ${page.url()}`);
  }
}

async function registerAsAdmin(page: Page, email: string): Promise<void> {
  await registerFreshUser(page, email);
  await promoteToSuperAdmin(email);
}

test.describe('unified create-pool wizard — all 7 pool types', () => {
  /**
   * SQUARES IS OPEN AGAIN (PLAN-SQUARES-REOPEN PR-D). From 2026-08-28 until
   * that plan landed, this test asserted that `/create/squares` bounced. It is
   * the walk-through again, on the path with NO linked game — the commissioner
   * types the teams and will lock the grid themselves. The linked-game path,
   * and everything after creation, is `squares-pool.spec.ts`.
   */
  test('SQUARES — no linked game, teams typed in', async ({ page }) => {
    const email = `e2e-squares-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/squares');
    await page.locator('#name').fill('E2E Squares');
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // Basics -> Matchup & grid
    await page.locator('#homeTeam').fill('Lions');
    await page.locator('#awayTeam').fill('Packers');
    await advanceToReview(page);
    const poolId = await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);

    // A pool with no linked game has no game to follow and does not lock itself.
    const pool = await readDoc(`pools/${poolId}`);
    expect(pool).not.toBeNull();
    expect(pool!.homeTeam).toBe('Lions');
    expect(pool!.awayTeam).toBe('Packers');
    expect(pool!.gameId ?? null).toBeNull();
    expect((pool!.reminders as { lock?: { enabled?: boolean } } | undefined)?.lock?.enabled ?? false).toBe(false);
  });

  test('BRACKET', async ({ page }) => {
    const email = `e2e-bracket-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/bracket');
    await fillBasicsAndAdvanceToReview(page, 'E2E Bracket');
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });

  test('NFL_PLAYOFFS', async ({ page }) => {
    const email = `e2e-playoff-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/playoff');
    await fillBasicsAndAdvanceToReview(page, 'E2E Playoff');
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });

  test('NFL_PICKEM', async ({ page }) => {
    const email = `e2e-pickem-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/pickem');
    await fillBasicsAndAdvanceToReview(page, 'E2E Pickem');
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });

  test('NFL_SURVIVOR', async ({ page }) => {
    const email = `e2e-survivor-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/survivor');
    await fillBasicsAndAdvanceToReview(page, 'E2E Survivor');
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });

  test('NFL_MARGIN', async ({ page }) => {
    const email = `e2e-margin-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/margin');
    await fillBasicsAndAdvanceToReview(page, 'E2E Margin');
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });

  test('PROPS', async ({ page }) => {
    const email = `e2e-props-${RUN_ID}@example.com`;
    await registerAsAdmin(page, email);
    await gotoCreateRoute(page, email, '/create/props');
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
    await submitAndExpectPoolCreated(page, /Launch free pool|Start \d+-day trial/i);
  });
});
