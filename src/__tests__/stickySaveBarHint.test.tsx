// @vitest-environment jsdom
//
// (Opt-in, same convention as entrySwitcher.test.tsx — the repo default is node.)
/**
 * STICKY SAVE BAR — the draft-reassurance line, and the bar's opacity.
 *
 * 🔨 KEVIN 2026-08-27: "add another line telling the player that picks are
 * captured and saved to return later", and "make the modal itself a bit less
 * transparent so it sticks out more".
 *
 * The risk in the first half is not that the line fails to render — it is that
 * it renders on a sheet where it is FALSE. Only the Pick'em sheet drafts to
 * `localStorage` (`utils/draftStore`); Survivor and Margin do not, and a locked
 * week stops the draft effect writing at all. So the bar takes the sentence as an
 * OPTIONAL prop and never invents one, and the caller-side conditions are pinned
 * in pickemDraftHint below.
 *
 * `@testing-library/jest-dom` is not installed in this repo (see
 * overlayRoot.test.tsx), so classes and attributes are read directly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StickySaveBar } from '../components/NFLPoolDashboard/pickSheet/StickySaveBar';
import { pickemDraftHint, PICKEM_DRAFT_HINT } from '../components/NFLPoolDashboard/pickSheet/draftHint';
import { saveDraft, loadDraft, clearDraft, flushDrafts, isDraftStorageAvailable, __resetDraftStorageProbe } from '../utils/draftStore';

const base = {
  dirty: true,
  submitting: false,
  summary: '3 of 16 picked',
  onSave: () => {},
};

// The REAL string the sheet ships, not a copy — a copy would keep passing after
// someone edited the shipped one.
const HINT = PICKEM_DRAFT_HINT;

/** The bar's own panel — the element carrying the background, not the sticky wrapper. */
const panel = (): HTMLElement =>
  document.querySelector('.rounded-xl.shadow-card-hover') as HTMLElement;

afterEach(cleanup);

describe('StickySaveBar hint line', () => {
  it('renders the hint under the summary when one is given', () => {
    render(<StickySaveBar {...base} hint={HINT} />);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.getByText('3 of 16 picked')).toBeTruthy();
  });

  it('renders NOTHING when no hint is given — Survivor and Margin keep no draft', () => {
    // 🛑 THE DEFECT THIS PINS. A default string on the bar would put "kept in
    // this browser" on the Survivor and Margin sheets, which do not call
    // `saveDraft` at all — the member would be told their pick was held and it
    // would be gone. The prop is optional and has no default for that reason.
    render(<StickySaveBar {...base} />);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByText(/kept in this browser/i)).toBeNull();
  });

  it('does not truncate the hint — a cut-off reassurance reassures nobody', () => {
    render(<StickySaveBar {...base} hint={HINT} />);
    const el = screen.getByText(HINT);
    expect(el.className).not.toContain('truncate');
  });

  it('still shows the hint alongside a blockedReason', () => {
    // "Pick all 16 open games to submit" is exactly the moment the member most
    // needs to know the half-finished sheet is not lost, so the two coexist.
    render(<StickySaveBar {...base} dirty={false} blockedReason="Pick all 16 open games to submit" hint={HINT} />);
    expect(screen.getByText('Pick all 16 open games to submit')).toBeTruthy();
    expect(screen.getByText(HINT)).toBeTruthy();
  });
});

describe('StickySaveBar opacity', () => {
  it('is an opaque panel, not a translucent one', () => {
    render(<StickySaveBar {...base} hint={HINT} />);
    const cls = panel().className;
    // 🛑 THE DEFECT THIS PINS. `bg-card/95` let the matchup cards scrolling
    // underneath show through, which is what Kevin reported. Any `bg-card/NN`
    // reintroduces it, and the difference is invisible in a screenshot review
    // unless something happens to be under the bar at the time.
    expect(cls).toContain('bg-card');
    expect(cls).not.toMatch(/bg-card\/\d/);
    expect(cls).not.toContain('backdrop-blur');
  });

  it('keeps a ring so it still reads as a layer above the sheet', () => {
    render(<StickySaveBar {...base} />);
    expect(panel().className).toContain('ring-1');
  });
});

describe('pickemDraftHint — the caller-side conditions', () => {
  // The SHIPPED helper (`pickSheet/draftHint`), the one `PickemPickEntry` calls.
  // It was extracted from the sheet's JSX precisely so these two conditions are
  // executable rather than only asserted in a comment.
  it('is present on an open week when storage works', () => {
    expect(pickemDraftHint(false, true)).toBe(HINT);
  });

  it('is absent when the browser will not keep the draft', () => {
    // 🛑 THE DEFECT THIS PINS (codex r1 P2). `saveDraft` catches its own write
    // failure, so private mode and blocked site data produce no error and no
    // draft — and the member most likely to be reassured by this sentence is
    // exactly the one whose picks are not being kept.
    expect(pickemDraftHint(false, false)).toBeUndefined();
  });

  it('says the draft is browser-local, never that it is saved to the pool', () => {
    // 🛑 THE DEFECT THIS PINS. "Your picks are saved, come back any time" is what
    // was asked for and it is FALSE: `draftStore` writes localStorage, so the
    // sheet does not follow the member to another device and never reaches the
    // pool until they submit. A future reword must keep both qualifiers.
    expect(PICKEM_DRAFT_HINT).toMatch(/browser/i);
    expect(PICKEM_DRAFT_HINT).toMatch(/only reach the pool when you submit/i);
  });

  it('is absent once the week locks — the draft effect has stopped writing', () => {
    // 🛑 THE DEFECT THIS PINS. `saveDraft` is guarded by `if (!dirtyRef.current
    // || isWeekLocked) return;` in PickemPickEntry, so after lock nothing is
    // being kept and the sentence would be a false promise.
    expect(pickemDraftHint(true, true)).toBeUndefined();
  });
});

describe('draftStore — the persistence the hint promises', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDraftStorageProbe();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetDraftStorageProbe();
  });

  it('reports storage unavailable when a WRITE throws, not merely when the object is missing', () => {
    // 🛑 THE DEFECT THIS PINS. Safari private mode exposes a `localStorage`
    // object that exists and throws on `setItem`, so a presence check passes
    // there and the probe must be a real write.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(isDraftStorageAvailable()).toBe(false);
    setItem.mockRestore();
    __resetDraftStorageProbe();
    expect(isDraftStorageAvailable()).toBe(true);
  });

  it('leaves no probe key behind', () => {
    expect(isDraftStorageAvailable()).toBe(true);
    expect(localStorage.getItem('draft:__probe__')).toBeNull();
  });

  it('flushes a debounced draft on the way out — the 500ms window loses nothing', () => {
    vi.useFakeTimers();
    try {
      saveDraft('k', { picks: { g1: 'NE' } });
      // Not yet written: this is the window a member closing the tab fell into.
      expect(loadDraft('k')).toBeNull();
      flushDrafts();
      expect(loadDraft<{ picks: Record<string, string> }>('k')).toEqual({ picks: { g1: 'NE' } });
      // 🛑 And the cancelled timer must not fire a second write afterwards.
      vi.advanceTimersByTime(1000);
      expect(loadDraft<{ picks: Record<string, string> }>('k')).toEqual({ picks: { g1: 'NE' } });
    } finally {
      vi.useRealTimers();
      clearDraft('k');
    }
  });

  it('flushes when the page is hidden — the app-switch case on phones', () => {
    vi.useFakeTimers();
    try {
      saveDraft('k2', { picks: { g2: 'SEA' } });
      expect(loadDraft('k2')).toBeNull();
      // `pagehide` covers tab close and the iOS back-swipe; `visibilitychange`
      // covers switching apps, which is how most members leave a pick sheet.
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(loadDraft<{ picks: Record<string, string> }>('k2')).toEqual({ picks: { g2: 'SEA' } });
    } finally {
      vi.useRealTimers();
      clearDraft('k2');
    }
  });

  it('clearDraft drops a pending write, so a submitted sheet is not re-drafted by a flush', () => {
    vi.useFakeTimers();
    try {
      saveDraft('k3', { picks: { g3: 'KC' } });
      clearDraft('k3');
      flushDrafts();
      // 🛑 THE DEFECT THIS PINS. `handleSubmit` calls `clearDraft` after a
      // successful save; if the pending value survived, the next flush would
      // resurrect the draft and the sheet would offer to "restore" picks the
      // member had already submitted.
      expect(loadDraft('k3')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
