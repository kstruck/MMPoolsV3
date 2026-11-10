import { test, expect, type Browser, type Page } from '@playwright/test';
import { registerFreshUser, readDoc, patchDoc, eventually } from './helpers';

/**
 * A SQUARES POOL, FROM THE WIZARD TO A PAID PRIZE — in a real browser, against
 * the auth, functions and Firestore emulators (PLAN-SQUARES-REOPEN PR-D).
 *
 * WHY THIS EXISTS. Before squares reopened, the app was driven by hand through
 * exactly this path (review log, round W1). It worked end to end and it found
 * nine defects that two rounds of review and every unit and emulator test had
 * missed — one of them serious: a square the organizer entered for somebody
 * else still carried the organizer's account. The emulator tests for that fix
 * were green because each one passed a sign-in token with a name in it, which
 * is a sign-in the app does not produce. Only a real registration found it.
 *
 * So the walk-through is kept, as a test, and every step asserts what was
 * WRITTEN — not only what the page showed.
 *
 * The schedule feed is the one thing answered by a fixture: the wizard asks
 * ESPN for a day's games from the browser, and a test cannot depend on what is
 * being played that day.
 *
 * Ten players, because at ten or fewer a pool is free and no pricing tier is
 * read. Above that the emulator has no tiers to price from (plan K10).
 */

const RUN_ID = `${Date.now()}`;
const GAME_ID = '401772510';

// A game three days out, at half past noon: comfortably "not started".
const kickoff = new Date(Date.now() + 3 * 24 * 3600 * 1000);
kickoff.setHours(12, 30, 0, 0);
const pad = (n: number) => String(n).padStart(2, '0');
const kickoffDate = `${kickoff.getFullYear()}-${pad(kickoff.getMonth() + 1)}-${pad(kickoff.getDate())}`;

const team = (name: string, abbr: string) => ({
  displayName: name,
  name: name.split(' ').pop(),
  abbreviation: abbr,
  logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`,
});

/** ESPN's scoreboard for that day, cut down to what the wizard reads. One game to come, one under way. */
const scoreboard = {
  events: [
    {
      id: GAME_ID, date: kickoff.toISOString(), season: { year: 2026, type: 2 }, week: { number: 12 },
      status: { type: { state: 'pre' } },
      competitions: [{ date: kickoff.toISOString(), competitors: [
        { homeAway: 'home', team: team('Detroit Lions', 'DET') },
        { homeAway: 'away', team: team('Green Bay Packers', 'GB') },
      ] }],
    },
    {
      id: '401772511', date: new Date(Date.now() - 3600 * 1000).toISOString(), season: { year: 2026, type: 2 }, week: { number: 12 },
      status: { type: { state: 'in' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: team('Dallas Cowboys', 'DAL') },
        { homeAway: 'away', team: team('Kansas City Chiefs', 'KC') },
      ] }],
    },
  ],
};

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A browser of its own (so a guest is really a different device), with the schedule feed answered locally. */
async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/site.api.espn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard) }));
  await context.route('**/a.espncdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG }));
  return context.newPage();
}

type Square = { id: number; owner: string | null; reservedByUid?: string | null; guestKeyHash?: string | null; guestDeviceKey?: string | null };
type Pool = Record<string, unknown> & { squares: Square[] };

const readPool = async (poolId: string): Promise<Pool> => (await readDoc(`pools/${poolId}`)) as Pool;
const squareOf = (pool: Pool, id: number): Square => pool.squares[id];

/** Select squares on the grid and take them through the claim dialog. */
async function claimSquares(page: Page, ids: number[]): Promise<void> {
  for (const id of ids) await page.getByTestId(`square-${id}`).click();
  await page.getByRole('button', { name: /^Reserve/ }).first().click();
  await page.locator('input[type="checkbox"]').last().check({ force: true });
  await page.getByRole('button', { name: /Reserve \d+ Squares?/ }).click();
}

const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click();

test.describe('a squares pool, from the wizard to a paid prize', () => {
  test('create with a linked game → claim three ways → lock → score → record → pay', async ({ browser }) => {
    test.setTimeout(240_000);
    const email = `e2e-sq-owner-${RUN_ID}@example.com`;
    const ownerName = `E2E ${email}`;   // what registerFreshUser types as the account name
    const page = await newVisitor(browser);

    // ---- A plain member — not a super admin — reaches the wizard. -----------
    await registerFreshUser(page, email);
    await page.goto('/create/squares');
    await page.locator('#name').waitFor({ state: 'visible', timeout: 20_000 });
    expect(page.url()).toMatch(/\/create\/squares$/);
    await page.locator('#name').fill('Thanksgiving Squares');
    await next(page);

    // ---- Game: a game that has kicked off cannot be picked; one to come can.
    await page.locator('#squares-game-date').fill(kickoffDate);
    await page.getByRole('button', { name: /Find games/i }).click();
    await page.getByTestId('squares-game-list').waitFor();
    await expect(page.getByRole('button', { name: /Kansas City Chiefs at Dallas Cowboys/ })).toBeDisabled();
    await page.getByRole('button', { name: /Green Bay Packers at Detroit Lions/ }).click();
    await expect(page.getByTestId('squares-linked-game')).toBeVisible();
    await expect(page.locator('#homeTeam')).toHaveValue(/Lions/);
    await expect(page.locator('#awayTeam')).toHaveValue(/Packers/);
    await next(page);

    // ---- Fee.
    await page.locator('#costPerSquare').fill('10');
    await next(page);

    // ---- Payouts: a split that does not total 100 does not let the wizard on.
    const final = page.locator('[id="squaresPayouts.final"]');
    await final.fill('30');
    await next(page);
    await expect(final).toBeVisible();
    for (const [period, share] of [['q1', '10'], ['half', '20'], ['q3', '10'], ['final', '60']] as const) {
      await page.locator(`[id="squaresPayouts.${period}"]`).fill(share);
    }
    await next(page);   // payouts -> branding
    await next(page);   // branding -> launch

    // ---- Launch. The price is per SQUARE, and says so.
    await page.getByRole('spinbutton', { name: /Expected number of players/i }).fill('10');
    await expect(page.getByText('/square').first()).toBeVisible();
    await page.locator('label', { hasText: /Terms of Service/i }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Launch free pool', exact: true }).click();
    await page.waitForURL(/\/pool\/[a-zA-Z0-9]+/, { timeout: 30_000 });
    const poolId = page.url().match(/\/pool\/([a-zA-Z0-9]+)/)![1];

    // ---- What was written: a complete pool, linked to its game, that locks itself.
    let pool = await readPool(poolId);
    expect(pool.type).toBe('SQUARES');
    expect(pool.gameId).toBe(GAME_ID);
    expect(pool.isLocked).toBe(false);
    expect(pool.axisNumbers ?? null).toBeNull();          // numbers are not drawn before the lock
    expect(pool.costPerSquare).toBe(10);
    expect(pool.payouts).toEqual({ q1: 10, half: 20, q3: 10, final: 60 });
    expect(pool.squares).toHaveLength(100);
    expect((pool.reminders as { lock?: { enabled?: boolean; lockAt?: unknown } }).lock?.enabled).toBe(true);
    expect((pool.reminders as { lock?: { lockAt?: unknown } }).lock?.lockAt).toBeTruthy();
    const ownerUid = pool.ownerId as string;
    expect(ownerUid).toBeTruthy();

    // ---- The pool page opens, and says when the grid locks.
    await expect(page.getByTestId('grid-locks-at')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('square-0')).toHaveAttribute('aria-label', /.+/);

    // ---- 1. The organizer takes a square of their own: it carries their account.
    await claimSquares(page, [0]);
    pool = await eventually(() => readPool(poolId), (p) => !!squareOf(p, 0).owner, 'square 0 to be claimed');
    expect(squareOf(pool, 0).reservedByUid).toBe(ownerUid);

    // ---- 2. The organizer enters squares FOR SOMEONE ELSE. The page says so, and
    //         the squares carry that name and NO account. (Round W1, finding 1:
    //         with a real sign-in these used to carry the organizer's account.)
    const nameBox = page.locator('input[placeholder="e.g. John Smith"]').first();
    if (!(await nameBox.isVisible().catch(() => false))) {
      await page.getByText(/Signed in as/i).first().click();
    }
    await nameBox.fill('Uncle Ray');
    await expect(page.getByTestId('entering-for-someone')).toContainText('for Uncle Ray');
    await page.getByRole('button', { name: /Update Details|Start Picking|Save/i }).first().click().catch(() => undefined);
    await claimSquares(page, [5, 73]);
    pool = await eventually(() => readPool(poolId), (p) => !!squareOf(p, 5).owner && !!squareOf(p, 73).owner, 'squares 5 and 73 to be claimed');
    for (const id of [5, 73]) {
      expect(squareOf(pool, id).owner).toBe('Uncle Ray');
      expect(squareOf(pool, id).reservedByUid ?? null).toBeNull();
    }
    // ...and the organizer's own square is still theirs.
    expect(squareOf(pool, 0).reservedByUid).toBe(ownerUid);
    expect(squareOf(pool, 0).owner).not.toBe('Uncle Ray');

    // ---- 3. A guest, on another device, with no account.
    const guest = await newVisitor(browser);
    await guest.goto(`/pool/${poolId}`);
    await guest.locator('input[placeholder="e.g. John Smith"]').first().fill('Gina Guest');
    await guest.getByRole('button', { name: /Start Picking|Update Details|Continue/i }).first().click().catch(() => undefined);
    await claimSquares(guest, [37]);
    pool = await eventually(() => readPool(poolId), (p) => !!squareOf(p, 37).owner, 'square 37 to be claimed');
    expect(squareOf(pool, 37).owner).toBe('Gina Guest');
    expect(squareOf(pool, 37).reservedByUid ?? null).toBeNull();
    // The guest's proof of ownership is stored as a hash. The key itself is on
    // nobody's square — the pool document is world-readable.
    expect(squareOf(pool, 37).guestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pool.squares.some((s) => s.guestDeviceKey)).toBe(false);
    // A guest has no account, so "I've sent payment" is not theirs to press.
    await expect(guest.getByRole('button', { name: /I've Sent Payment/ })).toHaveCount(0);

    // ---- Lock. One button, named for what it does, and it asks first.
    await page.goto(`/admin/${poolId}?tab=game`);
    await expect(page.getByRole('button', { name: 'Generate Numbers' })).toHaveCount(0);
    await page.getByRole('button', { name: /Lock Grid & Draw Numbers/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Lock the grid now?');
    await expect(dialog).toContainText('96 squares are still open');
    // Nothing is locked until the question is answered.
    expect((await readPool(poolId)).isLocked).toBe(false);
    await dialog.getByRole('button', { name: 'Lock grid' }).click();
    pool = await eventually(() => readPool(poolId), (p) => p.isLocked === true && !!p.axisNumbers, 'the grid to lock and draw its numbers');
    const axis = pool.axisNumbers as { home: number[]; away: number[] };
    for (const side of [axis.home, axis.away]) {
      expect([...side].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    // ---- A locked grid takes no more claims.
    await guest.reload();
    await expect(guest.getByTestId('square-50')).toHaveAttribute('aria-disabled', 'true', { timeout: 20_000 });

    // ---- Score the first quarter by hand so that square 37 wins it.
    //      Square 37 is row 3, column 7: the away digit at index 3, the home digit at index 7.
    const q1 = { home: axis.home[7], away: axis.away[3] };
    await page.goto(`/admin/${poolId}?tab=scoring`);
    await page.getByRole('checkbox', { name: /Enable 1st Quarter scoring/i }).click({ force: true });
    const scores = page.locator('input[type="number"]');
    await scores.nth(0).fill(String(q1.home));
    await scores.nth(1).fill(String(q1.away));

    // Typing a score records nothing. The page says what recording WOULD do...
    await expect(page.getByTestId('winner-records-drift')).toContainText('Gina Guest', { timeout: 20_000 });
    expect(await readDoc(`pools/${poolId}/winners/q1`)).toBeNull();
    // ...and the commissioner records it.
    await page.getByRole('button', { name: /Record winners|Update winner records/ }).click();
    await expect(page.getByTestId('winner-records-match')).toBeVisible({ timeout: 20_000 });
    const won = await eventually(() => readDoc(`pools/${poolId}/winners/q1`), (w) => w !== null, 'the first-quarter winner to be recorded');
    expect(won!.owner).toBe('Gina Guest');
    expect(won!.squareId).toBe(37);
    // 4 squares sold at $10, 10% to the first quarter: $4.
    expect(won!.amount).toBe(4);
    expect(won!.isPaid ?? false).toBe(false);

    // ---- The guest's page names the winner — a player, never "Rollover".
    await guest.reload();
    await expect(guest.getByText(/Gina Guest/).first()).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByText(/In the money: ROLLOVER/i)).toHaveCount(0);

    // ---- Mark it paid.
    await page.goto(`/admin/${poolId}?tab=payouts`);
    await page.getByRole('button', { name: 'Mark Paid' }).first().click();
    const paid = await eventually(() => readDoc(`pools/${poolId}/winners/q1`), (w) => w?.isPaid === true, 'the prize to be marked paid');
    expect(paid!.owner).toBe('Gina Guest');
    expect(paid!.paidAmount).toBe(4);

    // The account name was never typed onto somebody else's square.
    pool = await readPool(poolId);
    expect(pool.squares.filter((s) => s.owner === ownerName || s.reservedByUid === ownerUid).map((s) => s.id)).toEqual([0]);
  });

  // The callable's own refusal under this flag is proved at the callable
  // (`poolCreation.emulator.test.ts`). This is the half a commissioner meets.
  test('the off switch that needs no deploy: with the runtime flag off, the wizard says so on arrival', async ({ browser }) => {
    const email = `e2e-sq-closed-${RUN_ID}@example.com`;
    const page = await newVisitor(browser);
    await registerFreshUser(page, email);

    const off = { mapValue: { fields: { SQUARES: { booleanValue: false } } } };
    const on = { mapValue: { fields: { SQUARES: { booleanValue: true } } } };
    await patchDoc('system/config', { poolTypeFlags: off }, ['poolTypeFlags']);
    try {
      await page.goto('/create/squares');
      await expect(page.getByText('This pool type is temporarily unavailable')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#name')).toHaveCount(0);
    } finally {
      // Other specs create squares pools against this same emulator.
      await patchDoc('system/config', { poolTypeFlags: on }, ['poolTypeFlags']);
    }
    await page.reload();
    await expect(page.locator('#name')).toBeVisible({ timeout: 20_000 });
  });
});
