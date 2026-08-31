import { describe, it, expect } from 'vitest';
import { pickHighlightClass, pickBadgeClass, pickHighlightLabel } from './pickHighlight';

/**
 * The whole point of this helper is that SAVED and SELECTED are visually
 * distinguishable. A change that makes the two return the same string would
 * silently restore the defect it exists to fix, so the tests assert the
 * DIFFERENCE, not the literal class names — pinning the hex codes would just
 * make a palette tweak fail for no reason.
 */
describe('pickHighlightClass', () => {
  const saved = pickHighlightClass(true, true);
  const selected = pickHighlightClass(true, false);
  const neutral = pickHighlightClass(false, false);

  it('gives the saved pick a different treatment from an unsaved selection', () => {
    expect(saved).not.toBe(selected);
  });

  it('rings both saved and selected, and neither for an untouched team', () => {
    expect(saved).toContain('ring-2');
    expect(selected).toContain('ring-2');
    expect(neutral).not.toContain('ring-2');
  });

  it('uses the repo green for saved and the navy/gold pair for unsaved', () => {
    expect(saved).toContain('#0F7B4A');
    expect(selected).toContain('navy-600');
    expect(selected).toContain('gold-500');
    // The reverse direction matters most: a saved pick that still renders gold
    // is the exact bug this replaces.
    expect(saved).not.toContain('gold-500');
  });

  it('styles both light and dark for every state that has a colour', () => {
    expect(saved).toContain('dark:');
    expect(selected).toContain('dark:');
  });

  it('ignores `saved` when nothing is selected — one highlight at a time', () => {
    // A member who changes their mind sees the NEW team gold and the old saved
    // team plain; two highlighted teams on one matchup would be unreadable.
    expect(pickHighlightClass(false, true)).toBe(neutral);
  });
});

describe('pickBadgeClass', () => {
  it('tracks the ring: green badge on a saved pick, navy/gold otherwise', () => {
    expect(pickBadgeClass(true)).toContain('#0F7B4A');
    expect(pickBadgeClass(false)).toContain('navy-800');
    expect(pickBadgeClass(true)).not.toBe(pickBadgeClass(false));
  });
});

describe('pickHighlightLabel', () => {
  it('names the state in text, because colour alone fails WCAG 1.4.1', () => {
    expect(pickHighlightLabel(true, true)).toBe('Saved pick');
    expect(pickHighlightLabel(true, false)).toBe('Selected — not saved yet');
  });

  it('is empty for an untouched team so nothing spurious lands in the label', () => {
    expect(pickHighlightLabel(false, false)).toBe('');
    expect(pickHighlightLabel(false, true)).toBe('');
  });
});
