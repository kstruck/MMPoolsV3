// @vitest-environment jsdom
//
// `Switch` — the toggle, and the accessible name five copies of it did not have.
//
// 🛑 WHY THE NAME IS THE POINT.
//
// Every hand-rolled copy of this toggle wrapped a `<label>` around nothing but
// the visually-hidden `<input type="checkbox">` and the decorative track. The
// words a sighted person reads — "Manual Score Override", "Public Visibility",
// "Enable Charity Donation" — sat in a SIBLING heading, outside the label. A
// `<label>` with no text names nothing, so all five announced as a bare
// "checkbox, unchecked" and the setting being toggled was unknowable without
// sight.
//
// TypeScript makes `label` required, which stops the NEXT one being added
// without a name. These tests prove the name actually reaches the control, and
// `tests/a11y-invariants.test.ts` proves no file re-rolls its own copy — three
// different failure modes, three different guards.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Switch } from '../components/ui/Switch';

afterEach(cleanup);

describe('Switch — the accessible name', () => {
  it('names the CHECKBOX, so a screen reader reads the setting and not "checkbox"', () => {
    render(<Switch checked={false} onChange={() => {}} label="Manual score override" />);
    // `getByRole` with a name is the assertion that would have failed on all
    // five originals: the control existed, the name did not.
    const box = screen.getByRole('checkbox', { name: 'Manual score override' });
    expect(box).toBeTruthy();
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it('the decorative track is hidden from the accessibility tree', () => {
    // Without `aria-hidden` the empty styling div is announced as a stray group
    // next to the control it decorates.
    const { container } = render(<Switch checked onChange={() => {}} label="Public visibility" />);
    const track = container.querySelector('[aria-hidden="true"]');
    expect(track).toBeTruthy();
    // And it is the track, not something else that happens to be hidden.
    expect(track!.className).toContain('w-11 h-6 bg-line');
  });

  it('reports the NEW checked value, not the event', () => {
    // The call sites pass `(isPublic) => updateConfig({ isPublic })`. Handing
    // them the raw event instead would store an object in a boolean field, and
    // the pool would read as public forever.
    const seen: unknown[] = [];
    render(<Switch checked={false} onChange={(v) => seen.push(v)} label="Public visibility" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Public visibility' }));
    expect(seen).toEqual([true]);
  });

  it('honours `checked` as the source of truth', () => {
    render(<Switch checked onChange={() => {}} label="Enable the side hustle" />);
    expect((screen.getByRole('checkbox', { name: 'Enable the side hustle' }) as HTMLInputElement).checked).toBe(true);
  });

  it('disabled reaches the control, and says so to the pointer', () => {
    const { container } = render(
      <Switch checked={false} onChange={() => {}} label="Public visibility" disabled />,
    );
    const box = screen.getByRole('checkbox', { name: 'Public visibility' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(container.querySelector('label')!.className).toContain('cursor-not-allowed');

    // ⚠️ THIS DELIBERATELY DOES NOT ASSERT "and the handler does not fire".
    // It was written that way first and it PASSED-as-failed: `fireEvent.click`
    // dispatches the event straight at the node, so it skips the activation
    // behaviour a real browser uses to swallow clicks on a disabled control,
    // and the handler ran. The browser blocks it; jsdom's `fireEvent` cannot
    // show that either way, and `@testing-library/user-event` — which models
    // pointer events properly — is not a dependency here.
    //
    // An assertion the harness cannot actually decide is worse than no
    // assertion: it would have read as proof of a guarantee nothing checked.
    // What IS checked is that `disabled` reaches the input, which is the whole
    // mechanism the browser then acts on.
  });

  it('describedById points the longer explanation at the control', () => {
    render(
      <>
        <span id="vis-help">Your pool is listed in the Browse Pools directory.</span>
        <Switch checked onChange={() => {}} label="Public visibility" describedById="vis-help" />
      </>,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Public visibility' }).getAttribute('aria-describedby'),
    ).toBe('vis-help');
  });
});

describe('Switch — the two track colours are exclusive', () => {
  // ONE class, chosen by a prop, for the reason `FieldLabel.tone` gives: `cn`
  // is a plain join with no tailwind-merge, so emitting both checked-colours
  // leaves the winner to whatever order Tailwind generated them in.
  it('navy is the default and does not also emit gold', () => {
    const { container } = render(<Switch checked onChange={() => {}} label="x" />);
    const cls = container.querySelector('[aria-hidden="true"]')!.className;
    expect(cls).toContain('peer-checked:bg-navy-800');
    expect(cls).not.toContain('peer-checked:bg-gold-500');
  });

  it('gold replaces navy rather than joining it', () => {
    const { container } = render(<Switch checked onChange={() => {}} label="x" tone="gold" />);
    const cls = container.querySelector('[aria-hidden="true"]')!.className;
    expect(cls).toContain('peer-checked:bg-gold-500');
    expect(cls).not.toContain('peer-checked:bg-navy-800');
  });
});
