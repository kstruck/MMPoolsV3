import { test, expect } from '@playwright/test';
import { registerFreshUser } from './helpers';
import { createSquaresPool, fillAndLock } from './squaresGrid';

/**
 * A PAID SQUARE IS GREEN — in a real browser, against the emulators.
 *
 * Kevin, 2026-11-19: "People are saying it is too hard to tell that they have
 * been marked as paid." A paid square was navy-700 and a reserved one
 * navy-800: two dark navies a shade apart. Paid squares are now the app's paid
 * green (#0F7B4A, the colour of the admin "Paid" badges).
 *
 * The test reads the colour the browser actually painted, so it holds whatever
 * class produces it.
 */

const PAID_GREEN = 'rgb(15, 123, 74)';

test.describe('Squares grid colours', () => {
  test('a paid square is green; a reserved (unpaid) one is not', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await registerFreshUser(page, `e2e-sq-paid-${Date.now()}@example.com`);
    const poolId = await createSquaresPool(page);
    // Even squares paid, odd ones only reserved.
    await fillAndLock(poolId, (id) => id % 2 === 0);
    await page.reload();
    await expect(page.getByTestId('square-99')).toHaveAttribute('aria-label', /taken by/, { timeout: 20_000 });

    const colours = await page.evaluate(() =>
      Array.from({ length: 100 }, (_, i) =>
        getComputedStyle(document.querySelector(`[data-testid="square-${i}"]`)!).backgroundColor));

    // Squares in the highlighted row or column (the current score) are drawn
    // differently, so count rather than demand every one: nearly all paid
    // squares are green, and no unpaid square is.
    const paidGreen = colours.filter((c, i) => i % 2 === 0 && c === PAID_GREEN).length;
    const unpaidGreen = colours.filter((c, i) => i % 2 === 1 && c === PAID_GREEN).length;
    expect(paidGreen).toBeGreaterThanOrEqual(40);
    expect(unpaidGreen).toBe(0);
    expect(colours[0]).toBe(PAID_GREEN);

    // And a reserved square's name is readable: light gold on navy. It was
    // text-gold-200, a shade the palette does not define, so it rendered in an
    // inherited dark colour on the dark square.
    const nameColour = (i: number) => page.getByTestId(`square-${i}`).locator('.line-clamp-2')
      .evaluate((el) => getComputedStyle(el).color);
    expect(await nameColour(1)).toBe('rgb(230, 206, 150)');   // gold-300, unpaid
    expect(await nameColour(0)).toBe('rgb(255, 255, 255)');   // white, paid

    // The legend says so too.
    const legend = page.getByText('Paid & Confirmed', { exact: true }).locator('xpath=preceding-sibling::div[1]');
    await expect(legend).toHaveCSS('background-color', PAID_GREEN);

    await page.locator('#printable-grid').screenshot({ path: test.info().outputPath('paid-green.png') });
    await context.close();
  });
});
