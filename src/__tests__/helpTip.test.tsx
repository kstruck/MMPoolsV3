/**
 * helpTip.test.tsx — the tooltip's rendered contract and its placement maths.
 *
 * Runner: vitest + `renderToStaticMarkup`, matching `billingGate.test.tsx`.
 * This repo has no jsdom and no @testing-library, so nothing here fires a
 * pointer event. What that costs, stated rather than hidden: hover-in,
 * hover-out, blur and Escape are NOT exercised. They land with T2, which
 * brings the panel, the `?` shortcut and the Escape arbitration — the tests
 * for those need a DOM whatever this file does, so the dev dependency is
 * bought once, there, by the ticket that needs it.
 *
 * What IS covered is the part a regression breaks silently: which element the
 * trigger is, what it announces, that it is a SIBLING of the label rather than
 * inside it, that an unknown id renders nothing at all, and the position maths.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpTip, tooltipStyle, TOOLTIP_WIDTH, type TipRect } from '../components/ui/HelpTip';
import { HelpScopeProvider } from '../help/scope';
import { helpRegistry } from '../help/registry';
import { Field } from '../components/wizard/fields';
import type { PoolType } from '@shared/poolTypes';

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

const inScope = (poolType: PoolType | undefined, node: React.ReactNode) => (
  <HelpScopeProvider poolType={poolType} audience="commissioner">{node}</HelpScopeProvider>
);

// ─────────────────────────────────────────────────────────────────────────────
// 1. The trigger's contract
// ─────────────────────────────────────────────────────────────────────────────

describe('HelpTip — the trigger', () => {
  it('renders a button that names the topic it explains', () => {
    const html = render(inScope('NFL_PICKEM', <HelpTip helpId="settings.entryFee" />));
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="About Entry fee"');
    expect(html).toContain('data-help-id="settings.entryFee"');
  });

  /**
   * The bubble is not in the document until it opens, so naming it would point
   * a screen reader at nothing.
   */
  it('describes nothing while the bubble is closed', () => {
    const html = render(inScope('NFL_PICKEM', <HelpTip helpId="settings.entryFee" />));
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('role="tooltip"');
  });

  /**
   * The reason there is no `text` prop: an unknown id must be a visible gap in
   * the coverage test, never a `?` that opens on nothing. Content lands ticket
   * by ticket, so this is the state most wizard fields are in today.
   */
  it('renders nothing at all for an id no topic answers', () => {
    expect(render(inScope('NFL_PICKEM', <HelpTip helpId="settings.notWrittenYet" />))).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Scope — the whole reason the id is enough
// ─────────────────────────────────────────────────────────────────────────────

describe('HelpTip — resolution is scoped, not per call site', () => {
  it('shows the pool type its reader is in, for a topic that has a variant', () => {
    const playoff = render(inScope('NFL_PLAYOFFS', <HelpTip helpId="wizard.season" />));
    const pickem = render(inScope('NFL_PICKEM', <HelpTip helpId="wizard.season" />));
    expect(playoff).toContain('data-help-id="NFL_PLAYOFFS:wizard.season"');
    expect(pickem).toContain('data-help-id="wizard.season"');
  });

  it('renders nothing for a topic scoped to another pool type', () => {
    // `costPerSquare` is SQUARES-only. A bracket commissioner must not see it.
    expect(render(inScope('SQUARES', <HelpTip helpId="costPerSquare" />))).toContain('data-help-id');
    expect(render(inScope('BRACKET', <HelpTip helpId="costPerSquare" />))).toBe('');
  });

  it('renders nothing with no scope provider for a type-scoped topic', () => {
    // The default scope is a member outside any pool — deliberately the
    // narrowest view, so a forgotten publisher shows less, never more.
    expect(render(<HelpTip helpId="costPerSquare" />)).toBe('');
  });

  it('hides host-only copy from a member', () => {
    const asHost = render(
      <HelpScopeProvider audience="commissioner"><HelpTip helpId="branding.logoUrl" /></HelpScopeProvider>,
    );
    const asMember = render(
      <HelpScopeProvider audience="member"><HelpTip helpId="branding.logoUrl" /></HelpScopeProvider>,
    );
    expect(asHost).toContain('data-help-id="branding.logoUrl"');
    expect(asMember).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The label row — the a11y trap this component exists to avoid
// ─────────────────────────────────────────────────────────────────────────────

describe('Field — the help trigger is a sibling of the label', () => {
  const html = render(
    inScope('NFL_PICKEM', (
      <Field label="Entry fee" htmlFor="settings.entryFee" helpId="settings.entryFee">
        <input id="settings.entryFee" />
      </Field>
    )),
  );

  it('renders a label bound to the control', () => {
    expect(html).toContain('<label for="settings.entryFee"');
  });

  /**
   * The trigger is a `<button>`. A labelable control inside a `<label>` is
   * activated by clicking the label text, so nesting it would make "click the
   * field name" open a tooltip instead of focusing the field.
   */
  it('closes the label before the button opens', () => {
    const labelEnd = html.indexOf('</label>');
    const buttonStart = html.indexOf('<button');
    expect(labelEnd).toBeGreaterThan(-1);
    expect(buttonStart).toBeGreaterThan(labelEnd);
  });

  it('renders a span, not a stray label, when there is no control to point at', () => {
    const noControl = render(
      inScope('NFL_PICKEM', <Field label="Entry fee" helpId="settings.entryFee"><i /></Field>),
    );
    expect(noControl).not.toContain('<label');
    expect(noControl).toContain('<span');
  });

  it('renders no trigger for a field with no helpId', () => {
    const bare = render(inScope('NFL_PICKEM', <Field label="Plain" htmlFor="x"><input id="x" /></Field>));
    expect(bare).not.toContain('<button');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Placement maths
// ─────────────────────────────────────────────────────────────────────────────

describe('tooltipStyle', () => {
  const viewport = { width: 1000, height: 800 };
  const rect = (over: Partial<TipRect> = {}): TipRect => ({ top: 400, bottom: 414, left: 500, width: 14, ...over });

  it('centres the bubble on the trigger', () => {
    const style = tooltipStyle(rect(), 'top', viewport);
    expect(style.left).toBe(500 + 7 - TOOLTIP_WIDTH / 2);
  });

  /**
   * Anchored by `bottom` when it opens upward, so the bubble's height — which
   * is not known until after it renders — never enters the calculation.
   */
  it('anchors upward placement by its bottom edge', () => {
    const style = tooltipStyle(rect(), 'top', viewport);
    expect(style.bottom).toBe(800 - 400 + 8);
    expect(style.top).toBeUndefined();
  });

  it('anchors downward placement by its top edge', () => {
    const style = tooltipStyle(rect(), 'bottom', viewport);
    expect(style.top).toBe(414 + 8);
    expect(style.bottom).toBeUndefined();
  });

  it('flips down when there is no room above', () => {
    const style = tooltipStyle(rect({ top: 10, bottom: 24 }), 'top', viewport);
    expect(style.top).toBe(24 + 8);
  });

  it('flips up when there is no room below', () => {
    const style = tooltipStyle(rect({ top: 780, bottom: 794 }), 'bottom', viewport);
    expect(style.bottom).toBe(800 - 780 + 8);
  });

  /**
   * With no room either way the caller's side is honoured rather than flipped
   * to a side that is equally bad — otherwise a short viewport makes the bubble
   * hop sides on every scroll.
   */
  it('does not flip when neither side fits', () => {
    const short = { width: 1000, height: 200 };
    expect(tooltipStyle(rect({ top: 90, bottom: 104 }), 'top', short).bottom).toBe(200 - 90 + 8);
    expect(tooltipStyle(rect({ top: 90, bottom: 104 }), 'bottom', short).top).toBe(104 + 8);
  });

  it('keeps the bubble inside the viewport at either edge', () => {
    expect(tooltipStyle(rect({ left: 0 }), 'top', viewport).left).toBe(8);
    expect(tooltipStyle(rect({ left: 995 }), 'top', viewport).left).toBe(1000 - TOOLTIP_WIDTH - 8);
  });

  /**
   * BOTH EDGES. The first version asserted only that `left` was 8 — which it
   * was, while the bubble kept its full 260px width and ran 68px past the right
   * edge of a 200px viewport. A one-edge assertion on a two-edge problem passes
   * on the bug. (qodo #14 on PR #475.)
   */
  it('shrinks the bubble rather than letting it overflow a narrow viewport', () => {
    const narrow = { width: 200, height: 800 };
    const style = tooltipStyle(rect({ left: 100 }), 'top', narrow);
    expect(style.left).toBe(8);
    expect(style.width).toBe(200 - 16);
    expect(Number(style.left) + Number(style.width)).toBeLessThanOrEqual(narrow.width - 8);
  });

  it('keeps the full width when the viewport has room', () => {
    expect(tooltipStyle(rect(), 'top', viewport).width).toBe(TOOLTIP_WIDTH);
  });

  it('never returns a negative width', () => {
    expect(Number(tooltipStyle(rect(), 'top', { width: 10, height: 800 }).width)).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The copy the tooltip would show
// ─────────────────────────────────────────────────────────────────────────────

describe('the copy behind the trigger', () => {
  it('is the topic short, within the tooltip budget', () => {
    const topic = helpRegistry.resolveTopic({ poolType: 'SQUARES', audience: 'commissioner' }, 'costPerSquare');
    expect(topic).toBeDefined();
    expect(typeof topic!.short === 'string' ? topic!.short : topic!.short.fallback).toContain('one square costs');
  });
});
