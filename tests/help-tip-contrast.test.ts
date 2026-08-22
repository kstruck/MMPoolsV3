import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE `?` HAS TO BE VISIBLE — WCAG 2.1 SC 1.4.11 (non-text contrast, 3:1).
 *
 * Kevin, 2026-08-22: *"I am not seeing a ? by the Weekly Tie-Breaker."* The
 * topic resolved, the icon rendered, the markup was correct — it was drawn in
 * `--faint`, which is 2.81:1 on the light page background. A help affordance
 * nobody can find is a help system that does not exist.
 *
 * THE FIX IS AN INVARIANT, NOT A COLOUR, because no colour works. `HelpTip`
 * renders on two incompatible palettes:
 *
 *   1. The theme-driven surfaces — the NFL manager form, the site pages, the
 *      modals — on `--card` / `--surface` / `--page`, which swap with `.dark`.
 *   2. The wizard, a FIXED dark palette (`bg-slate-900/60` over `bg-page`), so
 *      in light theme its panel blends to a mid grey and every theme token
 *      fails on it: `--text-muted` is 1.15:1 there.
 *
 * So the trigger carries NO colour and inherits its label row's. It is then
 * exactly as visible as the label it explains, everywhere, and stays that way
 * when a palette changes. This file guards both halves: the structural one
 * (nothing re-colours the trigger) and the numeric one (the inherited colours
 * clear 3:1 on the themed surfaces).
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT: the wizard's own labels are
 * `text-slate-400` on that blended panel, which is 1.96:1 in light theme —
 * a pre-existing defect of the wizard's fixed palette that predates the help
 * system and is not the tip's to fix. Naming it here beats asserting it, which
 * would only lock the bug in.
 *
 * KEVIN RULED ON IT, 2026-08-22: LEAVE IT. Offered leave-it / retheme the
 * wizard / a one-class partial darkening just the labels, he chose the first,
 * eleven days before the Hall of Fame game. So this is a settled decision
 * rather than an open ticket — do not "fix" it in passing.
 */

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

/* ---------- WCAG 2.1 contrast, from the spec ---------- */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Two decimals, so a failure message reads like the number you'd quote. */
const ratio = (a: string, b: string) => Math.round(contrast(a, b) * 100) / 100;

/* ---------- the palette, READ FROM THE STYLESHEET ---------- */

/**
 * Tokens are parsed out of `src/index.css` rather than copied here. A copy
 * would keep passing after somebody lightened `--text-muted`, which is the one
 * change this test exists to catch.
 */
function tokens(block: ':root' | '.dark'): Record<string, string> {
  const css = read('src/index.css');
  const start = css.indexOf(`${block} {`);
  expect(start, `${block} block should exist in src/index.css`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name] = value;
  }
  return out;
}

const LIGHT = tokens(':root');
const DARK = tokens('.dark');

describe('the help palette parses out of index.css', () => {
  it('finds every token this file reasons about, in both themes', () => {
    // If a rename made these undefined, every ratio below would be computed
    // against `undefined` and would throw — but a THEME that stopped defining
    // one would silently fall back to the other's, so assert presence first.
    for (const [name, theme] of [['light', LIGHT], ['dark', DARK]] as const) {
      for (const key of ['page', 'surface', 'card', 'text', 'text-muted', 'faint']) {
        expect(theme[key], `--${key} should be defined for the ${name} theme`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('the ratio maths agrees with the spec on its two fixed points', () => {
    // A contrast function that returned a constant would pass every assertion
    // below. Black on white is 21:1 and a colour on itself is 1:1, exactly.
    expect(ratio('#000000', '#FFFFFF')).toBe(21);
    expect(ratio('#5C6678', '#5C6678')).toBe(1);
  });
});

/* ---------- the structural half ---------- */

describe('the help tip takes its colour from its label row', () => {
  const helpTip = read('src/components/ui/HelpTip.tsx');
  // Just the trigger's class list — the bubble below it is a themed surface of
  // its own (`bg-[color:var(--card)]`) and sets colours legitimately.
  const trigger = /'inline-flex shrink-0 items-center[^']*'/.exec(helpTip)?.[0] ?? '';

  it('the trigger declares text-current and nothing else', () => {
    expect(trigger).toContain('text-current');
    // `text-faint` was the regression. Any `text-…` colour here re-introduces
    // it, in whatever new shade — the point is that the trigger must not pick.
    const colours = trigger.match(/(?:^|\s|:)text-(?!current\b)[\w[]/g) ?? [];
    expect(colours).toEqual([]);
  });

  it('keyboard focus is shown by a ring that inherits too', () => {
    // The colour swap this replaced went to `--text`: near-black, and the
    // wizard's panel is dark, so keyboard focus was invisible there.
    expect(trigger).toContain('focus-visible:ring-current');
    expect(trigger).not.toContain('focus-visible:text-');
  });

  it('the grep is live — it fails on the exact class list it replaced', () => {
    const before =
      "'inline-flex shrink-0 items-center text-faint transition-colors hover:text-[color:var(--text)] focus-visible:text-[color:var(--text)] print:hidden'";
    expect(/(?:^|\s|:)text-(?!current\b)[\w[]/.test(before)).toBe(true);
    expect(before).not.toContain('text-current');
  });

  it('FieldLabel colours the row, not the label', () => {
    const field = read('src/components/ui/Field.tsx');
    // The tone class and any caller `className` both land on `rowCls`, which
    // is the wrapper's class — the label keeps typography only.
    expect(field).toMatch(/const rowCls = cn\(\s*'mb-1\.5 flex items-center gap-1\.5',\s*tone === 'muted' \? 'text-muted' : 'text-\[color:var\(--text\)\]',\s*className\s*\)/);
    expect(field).toMatch(/const textCls = 'font-display font-bold uppercase text-\[12px\] tracking-\[0\.08em\]';/);
    expect(field).not.toMatch(/const textCls = cn\(/);
  });

  it("the wizard's rows colour themselves the same way", () => {
    const wizard = read('src/components/wizard/fields.tsx');
    // Fixed slate rather than a theme token, deliberately: this wizard is a
    // dark island on a themed page (see the header).
    expect(wizard).toContain('<div className="mb-1 flex items-center gap-1.5 text-slate-400">');
    expect(wizard).toContain('<div className="mb-2 flex items-center gap-1.5 text-slate-200">');
    expect(wizard).toMatch(/const labelCls = 'text-xs font-semibold uppercase tracking-wide';/);
  });
});

/* ---------- the numeric half ---------- */

describe('the inherited colours clear 3:1 on every themed surface', () => {
  // Every themed background a `FieldLabel` row can sit on. `--surface` is the
  // focused input fill (`CONTROL_BASE`'s `focus:bg-surface`) and the raised
  // strips; `--card` the cards and the tooltip bubble; `--page` the app.
  const SURFACES = ['page', 'surface', 'card'] as const;

  // What a row can inherit: `tone="muted"` (every NFL manager label) and the
  // default (`--text`, the site pages' `className` override).
  const INHERITED = ['text-muted', 'text'] as const;

  for (const [name, theme] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const fg of INHERITED) {
      for (const bg of SURFACES) {
        it(`${name}: --${fg} on --${bg}`, () => {
          expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }

  it('--faint would NOT have cleared it — the threshold is doing work', () => {
    // The measurement behind the whole change. `--faint` is what the trigger
    // used to be, and it is the reason Kevin could not find the `?`: it scrapes
    // past on a card and fails outright on the page behind it.
    expect(ratio(LIGHT['faint'], LIGHT['page'])).toBeLessThan(3);
    expect(ratio(LIGHT['faint'], LIGHT['card'])).toBeLessThan(3.5);
  });
});
