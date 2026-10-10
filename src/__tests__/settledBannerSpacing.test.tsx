// @vitest-environment jsdom
/**
 * SettledBanner copy. Measured live 2026-10-09: the banner read "$275.No more
 * picks can be made." — JSX drops the whitespace at a line break, so the two
 * sentences ran together. Read through the DOM, where that is visible.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SettledBanner } from '../components/NFLPoolDashboard/SettledBanner';

afterEach(cleanup);

const record = (over: Record<string, unknown>) => ({
  kind: 'SPLIT', entryIds: ['a'], winnerNames: ['Brittany Wall'], settledAt: 1, settledBy: 'o',
  note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 275, pot: 275, rebuyDuesExcluded: 0, ...over,
});

describe('SettledBanner', () => {
  it('a sole winner: the two sentences are separated by a space', () => {
    const { container } = render(<SettledBanner settlement={record({}) as never} />);
    expect(container.textContent).toContain('Brittany Wall won the pool after week 4, $275. No more picks can be made.');
    expect(container.textContent).not.toContain('.No more');
  });

  it('a split: the same separation', () => {
    const { container } = render(
      <SettledBanner settlement={record({ winnerNames: ['Ann', 'Bo'], entryIds: ['a', 'b'], prizePerEntry: 50, pot: 100 }) as never} />,
    );
    expect(container.textContent).toContain('$50 each. No more picks can be made.');
    expect(container.textContent).not.toContain('.No more');
  });

  it('an unknown prize still reads cleanly', () => {
    const { container } = render(<SettledBanner settlement={record({ prizePerEntry: null }) as never} />);
    expect(container.textContent).toContain('won the pool after week 4. No more picks can be made.');
  });
});
