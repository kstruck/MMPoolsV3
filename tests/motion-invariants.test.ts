import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Motion invariants — mechanical guards from the 2026-09-03 animation review
 * of src/components (review-animations skill, Emil Kowalski's bar).
 *
 * WHY THIS EXISTS. The review found `animate-in` / `fade-in` /
 * `slide-in-from-*` / `zoom-in-*` in use with ZERO definitions: the
 * `tailwindcss-animate` plugin was never installed, so every modal, popover,
 * and landing-hero entrance in the app was a silent no-op. Nobody noticed for
 * months because a class that does nothing looks exactly like a class that
 * works, in the editor. Alongside it: `transition-all` everywhere (animates
 * layout off-GPU), ungated hover transforms (touch fires false :hover on tap),
 * progress bars animating `width`, and no `prefers-reduced-motion` path
 * anywhere. Prose cannot gate any of that; this file does.
 *
 * Measured on origin/main ee86b8f5 (2026-09-03), before this file's PR:
 *   grep -rhoE "animate-in" src/components | wc -l              -> 171
 *   grep -rn "animate-in" src/index.css tailwind.config.js       -> (no output)
 *   grep -n "tailwindcss-animate" package.json                   -> (no output)
 *   grep -rhoE "\btransition-all\b" src/components | wc -l       -> 368
 *   grep -rhoE "hover:scale-|hover:-translate-y" src/components | wc -l -> 128
 *   grep -rn "prefers-reduced-motion" src | grep -v App.css      -> (no output)
 * Re-run any of these against that SHA to reproduce; the assertions below are
 * the executable form of the same claims against the current tree.
 *
 * Each block names the rule, the reason, and the fix, so a failure is a
 * pointer and not a puzzle.
 */

const ROOT = path.resolve(__dirname, '..');
const COMPONENTS = path.join(ROOT, 'src', 'components');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(COMPONENTS).map((abs) => ({
  rel: path.relative(ROOT, abs).replace(/\\/g, '/'),
  text: fs.readFileSync(abs, 'utf8'),
}));

/** `file:line: <match>` for every hit of `re` — the failure message IS the todo list. */
function offenders(re: RegExp): string[] {
  const hits: string[] = [];
  for (const { rel, text } of files) {
    text.split('\n').forEach((line, i) => {
      const m = line.match(re);
      if (m) hits.push(`${rel}:${i + 1}: ${m[0].trim()}`);
    });
  }
  return hits;
}

describe('motion invariants', () => {
  // animate-in / fade-in / zoom-in-* / slide-in-from-* are NOT core Tailwind;
  // they come from tailwindcss-animate. Three separately-failable links.
  it('tailwindcss-animate is a declared dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.devDependencies?.['tailwindcss-animate'] ?? pkg.dependencies?.['tailwindcss-animate']).toBeTruthy();
  });

  it('tailwind.config.js imports tailwindcss-animate', () => {
    const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(config).toMatch(/from ['"]tailwindcss-animate['"]/);
  });

  it('tailwind.config.js registers tailwindcss-animate in `plugins`', () => {
    const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(config).toMatch(/plugins:\s*\[[\s\S]*?tailwindcssAnimate/);
  });

  it('no animation class that nothing defines (a no-op class looks identical to a working one)', () => {
    const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    // Every `animate-<name>` must be core Tailwind, tailwindcss-animate, or in
    // tailwind.config.js `animation`. Core: spin, ping, pulse, bounce, none.
    const configured = new Set<string>();
    const block = config.match(/animation:\s*\{([\s\S]*?)\n\s*\},/);
    if (block) {
      for (const m of block[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)) configured.add(m[1]);
    }
    const allowed = new Set(['spin', 'ping', 'pulse', 'bounce', 'none', 'in', 'out', ...configured]);
    const unknown = new Set<string>();
    for (const { rel, text } of files) {
      for (const m of text.matchAll(/\banimate-([\w-]+)/g)) {
        if (!allowed.has(m[1])) unknown.add(`${rel}: animate-${m[1]}`);
      }
    }
    expect([...unknown]).toEqual([]);
    // Tailwind's duration scale is 0/75/100/150/200/300/500/700/1000 plus any
    // key added under `transitionDuration` in tailwind.config.js. Anything else
    // silently does nothing. Arbitrary `duration-[..]` is banned outright: with
    // tailwindcss-animate installed it is ambiguous between transition-duration
    // and animation-duration, Tailwind warns and emits NOTHING (codex round 1
    // caught the help drawer running at 150ms while EXIT_MS waited 250ms).
    const configuredDurations: string[] = [];
    const durBlock = config.match(/transitionDuration:\s*\{([\s\S]*?)\}/);
    if (durBlock) for (const m of durBlock[1].matchAll(/^\s*'?(\d+)'?\s*:/gm)) configuredDurations.push(m[1]);
    const durs = ['0', '75', '100', '150', '200', '300', '500', '700', '1000', ...configuredDurations];
    expect(offenders(new RegExp(`\\bduration-(?!(?:${durs.join('|')})\\b)\\d+`))).toEqual([]);
    expect(offenders(/\bduration-\[/)).toEqual([]);
  });

  it('no `transition-all` — it animates width/height/padding off the GPU; use `transition-ui`', () => {
    const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(config).toMatch(/transitionProperty:\s*\{[\s\S]*?\bui:/);
    expect(offenders(/\btransition-all\b/)).toEqual([]);
  });

  it('hover motion is gated behind `fine:` (real hover + no reduced-motion) — touch fires false :hover on tap', () => {
    const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(config).toMatch(/addVariant\('fine'/);
    // Resets like `disabled:hover:translate-y-0` / `hover:scale-100` stay ungated on purpose.
    expect(offenders(/(^|[\s"'`])hover:(-translate-y-(?:px|1|0\.5)|scale-105|scale-\[1\.0[15]\])/)).toEqual([]);
    expect(offenders(/(^|[\s"'`])group-hover:(scale-|translate-x-1|rotate-45)/)).toEqual([]);
  });

  it('nothing enters from scale(0) — `zoom-in` bare is scale(0); use zoom-in-90/95', () => {
    expect(offenders(/\banimate-in\b[^"'`]*\bzoom-in(?![-\d])/)).toEqual([]);
  });

  it('UI entrances stay ≤300ms; only marketing heroes (Landing*/PricingPage) may run 500ms; nothing runs 700/1000', () => {
    expect(offenders(/\banimate-in\b[^"'`]*\bduration-(700|1000)\b/)).toEqual([]);
    const slow = offenders(/\banimate-in\b[^"'`]*\bduration-500\b/).filter((h) => !/Landing|PricingPage/.test(h));
    expect(slow).toEqual([]);
  });

  it('progress bars animate scaleX, not width (width triggers layout + paint every frame)', () => {
    // A `transition-*` element whose inline style sets `width:`. Matched across
    // lines — className and style usually sit on separate lines, and the
    // single-line version of this check missed twelve bars (codex round 1).
    // `transition-[width]` is the one sanctioned exception, for stacked
    // side-by-side segments where per-segment scaleX would gap or overlap.
    const hits: string[] = [];
    for (const { rel, text } of files) {
      for (const m of text.matchAll(/transition-(?:ui|transform|all)[^>]*?style=\{\{\s*width:/g)) {
        hits.push(`${rel}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(hits).toEqual([]);
    expect(offenders(/animate=\{\{\s*width:/)).toEqual([]);
  });

  it('Framer Motion uses full `transform` strings, not x/y/scale shorthands (shorthands drop frames under load)', () => {
    const hits: string[] = [];
    for (const { rel, text } of files) {
      if (!text.includes('framer-motion')) continue;
      for (const m of text.matchAll(/\b(initial|animate|exit)=\{\{([^}]*)\}\}/g)) {
        if (/\b(x|y|scale|rotate)\s*:/.test(m[2])) hits.push(`${rel}: ${m[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('every Framer transform string goes through useMotionTransform (MotionConfig reducedMotion does NOT strip raw transform strings)', () => {
    // codex round 2: `<MotionConfig reducedMotion="user">` disables x/y/scale
    // props under prefers-reduced-motion but leaves a raw `transform` string
    // animating. So each such value must be `tx(...)` or a `reduce ?` branch,
    // and the file must call the hook.
    const hits: string[] = [];
    for (const { rel, text } of files) {
      if (!text.includes('framer-motion') || rel.endsWith('/ui/motion.ts')) continue;
      const transformSites = [...text.matchAll(/\btransform:\s*(?!tx\(|reduce \?)[`'"[]/g)];
      for (const m of transformSites) hits.push(`${rel}:${text.slice(0, m.index).split('\n').length}: unwrapped transform`);
      if (/\btransform:\s*(?:tx\(|reduce \?)/.test(text) && !/useMotionTransform\(\)/.test(text)) {
        hits.push(`${rel}: uses tx()/reduce without calling useMotionTransform()`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no `ease-in` on UI entrances (delays the moment the user is watching)', () => {
    expect(offenders(/\banimate-in\b[^"'`]*\bease-in\b(?!-out)/)).toEqual([]);
    expect(offenders(/ease:\s*['"]easeIn['"]/)).toEqual([]);
  });

  it('reduced motion is honored: CSS media block in index.css, MotionConfig at the React root', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // Loops that are attention-getters (not loading states) must stop.
    for (const cls of ['animate-bounce', 'animate-ping', 'animate-live-pulse', 'animate-ticker']) {
      expect(css, `${cls} not silenced under reduced motion`).toContain(cls);
    }
    const main = fs.readFileSync(path.join(ROOT, 'src', 'main.tsx'), 'utf8');
    expect(main).toMatch(/<MotionConfig reducedMotion="user">/);
  });

  it('nothing bounces forever — winner badges and "good luck" use the finite `animate-bounce-3`', () => {
    expect(offenders(/\banimate-bounce(?![-\w])/)).toEqual([]);
  });
});
