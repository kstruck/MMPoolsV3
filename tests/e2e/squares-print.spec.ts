import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerFreshUser } from './helpers';
import { createSquaresPool, fillAndLock } from './squaresGrid';

/**
 * "PRINT GRID" PRINTS THE GRID, ON ONE PAGE — through Chromium's own print
 * engine, against the auth, functions and Firestore emulators.
 *
 * Kevin, 2026-11-19: Print Grid produced a 7-page PDF. Page 1 held the top
 * eight rows, page 2 the last three, and pages 3–7 were blank. The print CSS
 * hid the rest of the pool page with `visibility: hidden`, which keeps every
 * hidden element's height on paper, and it sized the grid to the full page
 * WIDTH, so eleven square rows ran taller than a landscape page.
 *
 * A jsdom test cannot see either: it does no layout and no pagination. This
 * test asks the browser for the PDF and counts its pages.
 */

const RUN_ID = `${Date.now()}`;

/** Page objects in a Chromium PDF (`/Type /Page`, not the `/Pages` tree). No PDF tooling needed on the runner. */
function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

test.describe('Print Grid', () => {
  test('prints the full grid and nothing else, on exactly one page', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await registerFreshUser(page, `e2e-sq-print-${RUN_ID}@example.com`);
    const poolId = await createSquaresPool(page);
    await fillAndLock(poolId);
    await page.reload();
    await expect(page.getByRole('button', { name: /Print Grid/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#printable-grid')).toContainText('A Much Longer Player Name');

    // preferCSSPageSize: use the app's own @page rule (landscape), as the
    // browser's print dialog does.
    const dir = mkdtempSync(path.join(tmpdir(), 'squares-print-'));
    const file = path.join(dir, 'grid.pdf');
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    writeFileSync(file, pdf);
    test.info().attachments.push({ name: 'grid.pdf', path: file, contentType: 'application/pdf' });
    expect(pdfPageCount(pdf)).toBe(1);

    // And the one page is the grid: in print media every row and every column
    // of it is inside the page, and nothing outside it is shown.
    await page.emulateMedia({ media: 'print' });
    const layout = await page.evaluate(() => {
      // Shown = laid out, not hidden by visibility or opacity, and with a box.
      // A size check alone would pass a grid hidden with visibility:hidden,
      // which keeps its box and prints a blank page (qodo, PR #791).
      const shown = (el: Element) =>
        el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
        el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      const grid = document.getElementById('printable-grid')!;
      const r = grid.getBoundingClientRect();
      const squares = [...grid.querySelectorAll('[data-testid^="square-"]')];
      const visibleOutside = [...document.body.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => !grid.contains(el) && !el.contains(grid))
        .filter(shown)
        .map((el) => el.tagName + (el.id ? `#${el.id}` : ''));
      return {
        width: r.width, height: r.height,
        gridShown: shown(grid),
        squares: squares.length,
        squaresShown: squares.filter(shown).length,
        // The squares print their owners' names: the page has the grid's content, not only its box.
        namesShown: squares.filter((sq) => shown(sq) && /\S/.test((sq as HTMLElement).innerText)).length,
        visibleOutside,
      };
    });
    // A landscape US Letter page less the 0.25in margins is 10.5in x 8in, at 96px/in.
    expect(layout.height).toBeLessThanOrEqual(8 * 96);
    expect(layout.width).toBeLessThanOrEqual(10.5 * 96);
    expect(layout.height).toBeGreaterThan(6 * 96);       // fits by being sized, not by vanishing
    expect(layout.gridShown).toBe(true);
    expect(layout.squares).toBe(100);
    expect(layout.squaresShown).toBe(100);
    expect(layout.namesShown).toBe(100);
    expect(layout.visibleOutside).toEqual([]);
    await context.close();
  });
});
