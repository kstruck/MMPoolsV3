import type { Page } from '@playwright/test';
import { patchDoc } from './helpers';

/**
 * A squares pool for the browser tests that look at the grid itself (print
 * layout, square colours): made through the wizard, then filled and locked
 * directly on the emulator, since claiming 100 squares by hand adds nothing.
 */

const s = (v: string) => ({ stringValue: v });
const n = (v: number) => ({ integerValue: String(v) });
const arr = (values: unknown[]) => ({ arrayValue: { values } });

/** Make a squares pool through the wizard: the same path a commissioner takes. */
export async function createSquaresPool(page: Page): Promise<string> {
  await page.goto('/create/squares');
  await page.locator('#name').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#name').fill('Print Test Squares');
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();
  await next();                                         // basics -> game
  await page.locator('#homeTeam').fill('Detroit Lions');
  await page.locator('#awayTeam').fill('Green Bay Packers');
  await next();                                         // game -> fee
  await page.locator('#costPerSquare').fill('10');
  await next();                                         // fee -> payouts
  for (const [period, share] of [['q1', '10'], ['half', '20'], ['q3', '10'], ['final', '60']] as const) {
    await page.locator(`[id="squaresPayouts.${period}"]`).fill(share);
  }
  await next();                                         // payouts -> branding
  await next();                                         // branding -> launch
  await page.getByRole('spinbutton', { name: /Expected number of players/i }).fill('10');
  await page.locator('label', { hasText: /Terms of Service/i }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Launch free pool', exact: true }).click();
  await page.waitForURL(/\/pool\/[a-zA-Z0-9]+/, { timeout: 30_000 });
  return page.url().match(/\/pool\/([a-zA-Z0-9]+)/)![1];
}

/**
 * The grid as it looks on game day: every square sold, numbers drawn, locked.
 * `paid` marks which squares the commissioner has recorded as paid (none by default).
 */
export async function fillAndLock(poolId: string, paid: (id: number) => boolean = () => false): Promise<void> {
  const names = ['Kevin Struck', 'Ron Johnson', 'A Much Longer Player Name'];
  const squares = Array.from({ length: 100 }, (_, id) => ({
    mapValue: { fields: { id: n(id), owner: s(names[id % names.length]), isPaid: { booleanValue: paid(id) } } },
  }));
  const digits = (order: number[]) => arr(order.map(n));
  await patchDoc(`pools/${poolId}`, {
    squares: arr(squares),
    isLocked: { booleanValue: true },
    axisNumbers: { mapValue: { fields: {
      home: digits([3, 1, 2, 0, 8, 5, 4, 9, 7, 6]),
      away: digits([4, 2, 8, 7, 3, 5, 6, 1, 0, 9]),
    } } },
  }, ['squares', 'isLocked', 'axisNumbers']);
}
