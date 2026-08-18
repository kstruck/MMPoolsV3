// @vitest-environment jsdom
//
// `HelpTip`'s interaction contract — PLAN-HELP-SYSTEM.md §3 D2.
//
// A BACKFILL OWED BY T1. T1 shipped `HelpTip` with 22 tests and said on the PR
// that none of them fired an event: there was no DOM in this repo, so hover,
// blur and Escape were unverified and the PR said so rather than implying
// otherwise. T2 buys `jsdom` for its own panel tests, so the debt is paid here
// in the same PR that makes it payable.
//
// `helpTip.test.tsx` keeps the pure tests (placement maths, scope resolution) in
// the node environment — they are faster there and do not need a document.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { HelpTip } from '../components/ui/HelpTip';
import { HelpScopeProvider, HelpPanelContext, type HelpPanelHandle } from '../help/scope';
import { helpRegistry, staticCopy } from '../help/registry';

const TOPIC_ID = 'settings.weeklyTiebreaker';
const topic = () => helpRegistry.getTopic(TOPIC_ID)!;

beforeAll(() => {
  // `getBoundingClientRect` returns all zeroes in jsdom, which is fine — the
  // placement maths has its own unit tests in `helpTip.test.tsx`.
  Object.defineProperty(window, 'innerWidth', { writable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { writable: true, value: 900 });
});

afterEach(cleanup);

function renderTip(panel: HelpPanelHandle | null = null) {
  return render(
    <HelpPanelContext.Provider value={panel}>
      <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
        <HelpTip helpId={TOPIC_ID} />
      </HelpScopeProvider>
    </HelpPanelContext.Provider>,
  );
}

const trigger = () => screen.getByLabelText(`About ${topic().title}`);

describe('hover', () => {
  it('shows the short copy on mouse enter and hides it on leave', async () => {
    renderTip();
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger());
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain(staticCopy(topic().short));

    fireEvent.mouseLeave(trigger());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});

describe('keyboard', () => {
  it('shows on focus and hides on blur', async () => {
    renderTip();
    fireEvent.focus(trigger());
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    fireEvent.blur(trigger());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('Escape closes the bubble', async () => {
    renderTip();
    fireEvent.focus(trigger());
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});

describe('with no panel mounted (all of T1)', () => {
  it('a tap pins the bubble, and a second tap unpins it', async () => {
    renderTip(null);
    fireEvent.click(trigger());
    expect(await screen.findByRole('tooltip')).toBeTruthy();

    // A pinned bubble survives the mouse leaving — the whole point, because a
    // touch has no hover to fall back on.
    fireEvent.mouseLeave(trigger());
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('does not offer "More in Help" it cannot deliver', async () => {
    renderTip(null);
    fireEvent.focus(trigger());
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).not.toContain('More in Help');
  });
});

describe('with a panel mounted (T2 onwards)', () => {
  it('a click hands the topic to the panel and closes the bubble', async () => {
    const opened: { topicId: string }[] = [];
    renderTip({ openTo: (t) => opened.push(t), openPage: () => {} });

    fireEvent.focus(trigger());
    expect(await screen.findByRole('tooltip')).toBeTruthy();

    fireEvent.click(trigger());
    expect(opened).toEqual([{ topicId: TOPIC_ID }]);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('says the panel is there', async () => {
    renderTip({ openTo: () => {}, openPage: () => {} });
    fireEvent.focus(trigger());
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('More in Help');
  });
});

describe('a topic this reader may not see', () => {
  it('renders no affordance at all, rather than an empty one', () => {
    // `settings.weeklyTiebreaker` is a Pick'em topic. A SQUARES commissioner is
    // not its audience by pool type, and `resolveTopic` filters on every return
    // path because this component is the last gate.
    render(
      <HelpScopeProvider poolType="SQUARES" audience="commissioner">
        <HelpTip helpId={TOPIC_ID} />
      </HelpScopeProvider>,
    );
    expect(screen.queryByLabelText(`About ${topic().title}`)).toBeNull();
    // Discriminating half: the same id in the right scope DOES render.
    renderTip();
    expect(trigger()).toBeTruthy();
  });
});
