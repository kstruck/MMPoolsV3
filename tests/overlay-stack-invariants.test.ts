// Every full-screen overlay shell registers with the overlay stack —
// PLAN-HELP-SYSTEM.md §3 D3 / §7 ticket T16.
//
// WHAT THIS GUARDS. `overlayStack.ts` arbitrates the `?` shortcut and Escape.
// It is authoritative for overlays that register, and falls back to a DOM
// heuristic — `.fixed.inset-0` among others — for the ones that do not. T16
// migrated the shells so the heuristic is a safety net rather than the
// mechanism. Nothing in the type system stops the NEXT overlay from being
// written as a bare `<div className="fixed inset-0 …">`, and nothing fails when
// one is: `?` would simply start firing underneath it one day, silently. This
// file is what fails.
//
// It reads source as text, so it is named `*-invariants.test.ts` per
// `.claude/skills/mmp-validation-and-qa/SKILL.md`.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(__dirname, '..', 'src', 'components');

/**
 * Files whose `fixed inset-0` element is deliberately NOT an overlay root, each
 * with the reason it is not. An entry here is a decision, not a backlog item.
 */
const EXEMPT: Record<string, string> = {
  'BracketPoolDashboard/ExportControls.tsx':
    'An invisible click-away catcher behind a dropdown menu, not an overlay: it ' +
    'covers the page only to close the menu on the next click, traps nothing, ' +
    'and shows nothing. Marking it an overlay root would claim the screen for a ' +
    'menu. It still matches the `.fixed.inset-0` fallback clause, so the `?` key ' +
    'behaves exactly as it did before T16.',
};

/** An opening JSX tag: `<Name … >`, with `{…}` expressions and quotes skipped. */
export interface JsxTag {
  name: string;
  /** The whole opening tag, `<` through `>`. */
  text: string;
  /** 1-based line of the `<`. */
  line: number;
}

/**
 * Every opening JSX tag in `source`.
 *
 * The forward scan tracks quote state and `{}` depth, because an attribute like
 * `onClick={(e) => …}` contains a `>` that does not end the tag, and a
 * `className={cond ? "…" : ""}` contains quotes that do not either. Naive
 * "read to the next `>`" splits those tags in half and loses their attributes —
 * which is the failure mode that would make this whole file pass vacuously.
 */
export function jsxOpeningTags(source: string): JsxTag[] {
  const tags: JsxTag[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<') continue;
    // A `<` straight after an identifier is a comparison (`i<len`), not a tag.
    // Without this the scan can swallow half a file as one bogus tag. Closing
    // tags are exempt: `…Champion Pick</div>` is a real tag with a letter in
    // front of it, and dropping those breaks every nesting count downstream.
    if (i > 0 && source[i + 1] !== '/' && /[\w$)\]]/.test(source[i - 1])) continue;
    const nameMatch = /^<([A-Za-z][\w.]*)/.exec(source.slice(i, i + 64));
    if (!nameMatch) continue;

    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = i + 1; j < source.length; j++) {
      const ch = source[j];
      if (quote) {
        if (ch === quote && source[j - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth--; continue; }
      if (ch === '<' && depth === 0) break; // not a tag after all — bail out
      if (ch === '>' && depth === 0) { end = j; break; }
    }
    if (end === -1) continue;

    tags.push({
      name: nameMatch[1],
      text: source.slice(i, end + 1),
      line: source.slice(0, i).split('\n').length,
    });
    i = end;
  }
  return tags;
}

/** `.tsx` files under `src/components`, relative to it. */
function componentFiles(dir = COMPONENTS_DIR, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...componentFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

interface Shell {
  file: string;
  line: number;
  tag: string;
  text: string;
}

function overlayShells(): Shell[] {
  const shells: Shell[] = [];
  for (const file of componentFiles()) {
    const source = fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8');
    if (!source.includes('fixed inset-0')) continue;
    for (const tag of jsxOpeningTags(source)) {
      if (!tag.text.includes('fixed inset-0')) continue;
      shells.push({ file, line: tag.line, tag: tag.name, text: tag.text });
    }
  }
  return shells;
}

describe('overlay shells register with the overlay stack', () => {
  const shells = overlayShells();

  // Without this, deleting the scan's guts leaves every assertion below
  // trivially true and the file reports green over nothing.
  it('finds the full-screen shells that exist today', () => {
    expect(shells.length).toBeGreaterThanOrEqual(30);
  });

  it('every `fixed inset-0` shell is an OverlayRoot, marked, or exempt', () => {
    const offenders = shells
      .filter(s => s.tag !== 'OverlayRoot')
      .filter(s => !s.text.includes('data-overlay-root'))
      // The Help panel's own backdrop. It must NOT look like a foreign overlay
      // or the panel would refuse to toggle itself.
      .filter(s => !s.text.includes('data-help-overlay'))
      .filter(s => !(s.file in EXEMPT))
      .map(s => `${s.file}:${s.line} <${s.tag}>`);

    expect(offenders).toEqual([]);
  });

  it('every exemption names a file that still has a shell', () => {
    const withShells = new Set(shells.map(s => s.file));
    for (const file of Object.keys(EXEMPT)) {
      expect(withShells.has(file), `${file} is exempt but has no shell`).toBe(true);
      expect(EXEMPT[file].length).toBeGreaterThan(40);
    }
  });

  it('Escape cannot dismiss a confirm dialog whose request is in flight', () => {
    // Escape is new behaviour for these shells, and on a confirm dialog it is
    // a second way out that the Cancel button already gates. Without the guard
    // Escape hides an irreversible delete that is still running, so it reads as
    // cancelled when it is not (codex, round 2, on PaymentLedger). The flag
    // named here is the one the dialog's own submit button is disabled by.
    const guarded: Array<[string, string, string]> = [
      ['BracketPoolDashboard/PaymentLedger.tsx', 'ledger-delete-confirm', 'updatingId'],
      ['UserProfile.tsx', 'profile-update-email', 'emailUpdateLoading'],
      ['Grid.tsx', 'squares-confirm-reservation', 'isSubmitting'],
      ['PlayoffPool/RankingForm.tsx', 'playoff-confirm-submission', 'isSubmitting'],
      ['Props/PropCardForm.tsx', 'props-confirm-submission', 'isSubmitting'],
    ];
    for (const [file, id, flag] of guarded) {
      const shell = shells.find(s => s.file === file && s.text.includes(`id="${id}"`));
      expect(shell, `${file} has no shell ${id}`).toBeDefined();
      const onEscape = /onEscape=\{([^]*?)\}\s+className/.exec(shell!.text);
      expect(onEscape, `${id} has no onEscape`).not.toBeNull();
      expect(onEscape![1], `${id} does not gate Escape on ${flag}`).toContain(flag);
    }
  });

  it('no two overlays share an id', () => {
    // The stack is keyed by id: `isForeignOverlayOpen` compares the top entry
    // to the caller's id, so two overlays answering to one id make the Help
    // panel think a foreign overlay is its own — or the reverse. Copy-pasting
    // a shell and forgetting the id is exactly how that happens.
    const ids: string[] = [];
    for (const file of componentFiles()) {
      const source = fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8');
      for (const m of source.matchAll(/<OverlayRoot\s+id="([^"]+)"/g)) ids.push(m[1]);
    }
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('the six shells T2 migrated by hand still carry the marker', () => {
    const t2 = [
      'modals/AuthModal.tsx',
      'modals/ShareModal.tsx',
      'modals/PlayoffSettingsModal.tsx',
      'NFLPoolDashboard/pickSheet/QuickPicksDialog.tsx',
      'admin/ConfirmActionModal.tsx',
      'ui/Toast.tsx',
    ];
    for (const file of t2) {
      const marked = shells.filter(s => s.file === file && s.text.includes('data-overlay-root'));
      expect(marked.length, `${file} has no marked shell`).toBeGreaterThan(0);
    }
  });
});

describe('the tag scanner discriminates', () => {
  it('reads a plain marked shell', () => {
    const tags = jsxOpeningTags('<div data-overlay-root="" className="fixed inset-0 z-50">');
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('div');
    expect(tags[0].text).toContain('data-overlay-root');
  });

  it('FAILS an unmarked shell — the case the suite exists to catch', () => {
    const tags = jsxOpeningTags('<div className="fixed inset-0 bg-black/80">');
    expect(tags).toHaveLength(1);
    expect(tags[0].text.includes('data-overlay-root')).toBe(false);
  });

  it('keeps the marker and the classes in ONE tag across an arrow handler', () => {
    // The `=>` and the `>` inside the handler are the trap: a scanner that
    // stops at the first `>` reports a tag WITHOUT `className`, so an unmarked
    // shell never gets checked and the suite passes over a real defect.
    const source =
      '<div\n  data-overlay-root=""\n  onClick={(e) => { if (e.target === e.currentTarget) close(); }}\n' +
      '  className="fixed inset-0 z-50"\n>\n  <p>hi</p>\n</div>';
    const shell = jsxOpeningTags(source).filter(t => t.text.includes('fixed inset-0'));
    expect(shell).toHaveLength(1);
    expect(shell[0].text).toContain('data-overlay-root');
  });

  it('reads a conditional className expression as one tag', () => {
    const source = '<div className={open ? "fixed inset-0 z-50 bg-black/70" : ""} data-overlay-root="">x</div>';
    const shell = jsxOpeningTags(source).filter(t => t.text.includes('fixed inset-0'));
    expect(shell).toHaveLength(1);
    expect(shell[0].text).toContain('data-overlay-root');
  });

  it('does not read a `fixed inset-0` mention in prose as a tag', () => {
    const source = '// the ~35 `fixed inset-0` shells in src/components\nconst x = 1;';
    expect(jsxOpeningTags(source).filter(t => t.text.includes('fixed inset-0'))).toEqual([]);
  });
});
