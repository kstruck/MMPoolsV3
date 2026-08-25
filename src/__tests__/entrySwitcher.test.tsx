// @vitest-environment jsdom
//
// (Opt-in, same convention as helpPanel.test.tsx — the repo default is node.)
/**
 * PLAN-MULTI-ENTRY T5 — the "My Entries" switcher.
 *
 * Two halves are tested here and they fail differently, which is why both are
 * present: the PURE index/label helpers (the ones a wrong answer silently
 * corrupts — picking an index a member already holds means editing a sheet they
 * did not choose), and the RENDERED strip (the ones a wrong answer makes
 * invisible — a single-entry pool must look exactly as it did before T5).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EntrySwitcher } from '../components/NFLPoolDashboard/EntrySwitcher';
import { sortOwnEntries, nextAddableEntryIndex, entryLabelOf } from '../utils/entrySelection';

const e = (id: string, entryIndex: number, entryName?: string) =>
  ({ id, ownerUid: 'kevin', entryIndex, ...(entryName ? { entryName } : {}) });

const baseProps = {
  ownEntries: [] as ReturnType<typeof e>[],
  maxEntries: 3,
  userName: 'Kevin',
  activeEntryId: null as string | null,
  onSelect: () => {},
  draft: null,
  onStartDraft: () => {},
  onDraftNameChange: () => {},
  onCancelDraft: () => {},
};

describe('nextAddableEntryIndex', () => {
  it('is the lowest index not already held, NOT count + 1', () => {
    // 🛑 THE DEFECT THIS PINS. Indexes are not guaranteed contiguous — the
    // manager's proxy path can create an entry at any index the cap allows — so
    // `count + 1` here would be 3, an index the member already holds. The
    // server resolves an existing index by RETURNING that entry rather than
    // creating one, so the member would silently be editing entry #3's sheet
    // while the UI told them they were making a new one.
    expect(nextAddableEntryIndex([e('kevin', 1), e('e3:kevin', 3)], 3)).toBe(2);
  });

  it('is 2, never 1, even when the member holds nothing at all', () => {
    // Entry #1 is the sheet they already have — created by their first
    // ordinary submit — and it carries no `entryName` by contract. Offering it
    // as an addable slot would invite a name the first save discards.
    // (codex r1 P2 on the T5 PR.)
    expect(nextAddableEntryIndex([], 3)).toBe(2);
    expect(nextAddableEntryIndex([], 1)).toBeNull();
  });

  it('is null once every index up to the cap is held', () => {
    expect(nextAddableEntryIndex([e('kevin', 1), e('e2:kevin', 2)], 2)).toBeNull();
  });

  it('treats an entry with no entryIndex as #1 (the legacy shape)', () => {
    expect(nextAddableEntryIndex([{ id: 'kevin' }], 2)).toBe(2);
  });
});

describe('sortOwnEntries / entryLabelOf', () => {
  it('orders by entryIndex regardless of the order Firestore returned', () => {
    expect(sortOwnEntries([e('e3:kevin', 3), e('kevin', 1), e('e2:kevin', 2)]).map(x => x.id))
      .toEqual(['kevin', 'e2:kevin', 'e3:kevin']);
  });

  it('prefers entryName over the fallback (§0b.4)', () => {
    expect(entryLabelOf(e('e2:kevin', 2, 'Kevin B'), 'Entry 2')).toBe('Kevin B');
    expect(entryLabelOf(e('e2:kevin', 2), 'Entry 2')).toBe('Entry 2');
    // An empty string is not a name, and neither is a missing entry.
    expect(entryLabelOf({ entryName: '' }, 'Entry 2')).toBe('Entry 2');
    expect(entryLabelOf(null, 'Entry 2')).toBe('Entry 2');
  });
});

describe('<EntrySwitcher>', () => {
  it('renders NOTHING when the pool allows one entry each', () => {
    // Every pool in production, until MULTI_ENTRY_WIZARD_ENABLED flips. A
    // one-tab strip would be new furniture on a screen nobody asked to change.
    const { container } = render(<EntrySwitcher {...baseProps} maxEntries={1} ownEntries={[e('kevin', 1)]} />);
    expect(container.innerHTML).toBe('');
    cleanup();
  });

  it('lists every entry the member holds, in index order, and marks the active one', () => {
    render(<EntrySwitcher {...baseProps} ownEntries={[e('e2:kevin', 2, 'Kevin B'), e('kevin', 1)]} activeEntryId="e2:kevin" />);
    const tabs = screen.getAllByRole('button').filter(b => b.textContent !== '');
    expect(tabs[0].textContent).toContain('Entry 1');
    expect(tabs[1].textContent).toContain('Kevin B');
    expect(tabs[1].getAttribute('aria-pressed')).toBe('true');
    expect(tabs[0].getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('2 of 3')).toBeTruthy();
    cleanup();
  });

  it('selecting a tab reports THAT entry id', () => {
    const onSelect = vi.fn();
    render(<EntrySwitcher {...baseProps} ownEntries={[e('kevin', 1), e('e2:kevin', 2, 'Kevin B')]} activeEntryId="kevin" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Kevin B'));
    expect(onSelect).toHaveBeenCalledWith('e2:kevin');
    cleanup();
  });

  it('shows an implicit "Entry 1" chip for a member who holds nothing yet', () => {
    // Their sheet IS entry #1; it is created by their first save. A strip with
    // only "Add entry" would read as "create something before you can pick".
    render(<EntrySwitcher {...baseProps} ownEntries={[]} />);
    expect(screen.getByTestId('implicit-entry-1').textContent).toBe('Entry 1');
    // ...and "Add entry" is WITHHELD until entry #1 actually exists (codex r2
    // P2): `nextAddableEntryIndex` never returns 1, so a member who added from
    // nothing would create entry #2 and could never create their primary.
    expect(screen.queryByText('Add entry')).toBeNull();
    expect(screen.getByText(/Save your first pick to start Entry 1/i)).toBeTruthy();
    cleanup();
  });

  it('offers "Add entry" as soon as entry #1 exists', () => {
    render(<EntrySwitcher {...baseProps} ownEntries={[e('kevin', 1)]} activeEntryId="kevin" />);
    expect(screen.getByText('Add entry')).toBeTruthy();
    cleanup();
  });

  it('hides "Add entry" once the cap is reached', () => {
    render(<EntrySwitcher {...baseProps} maxEntries={2} ownEntries={[e('kevin', 1), e('e2:kevin', 2)]} activeEntryId="kevin" />);
    expect(screen.queryByText('Add entry')).toBeNull();
    cleanup();
  });

  it('the draft states plainly that the entry does not exist yet', () => {
    // A member who names an entry and walks away must not believe they hold
    // one — nothing is created until a pick is saved (D1: there is no create
    // callable, `submitNFLPicks` derives the id from `entryIndex`).
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1)]}
      draft={{ entryIndex: 2, entryName: 'Kevin B' }}
    />);
    expect(screen.getByText(/created when you save its first pick/i)).toBeTruthy();
    // While drafting, no existing tab is active — the sheet below is empty.
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-pressed')).not.toBe('true');
    }
    cleanup();
  });

  it('warns locally about a duplicate name but still reports the keystroke', () => {
    // Advisory only: uniqueness is enforced in the submit transaction, which is
    // the only place that can be right about it. The local check must not block
    // the input, or a member could not correct a name the server would accept.
    const onDraftNameChange = vi.fn();
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1), e('e2:kevin', 2, 'Kevin B')]}
      draft={{ entryIndex: 3, entryName: '' }}
      onDraftNameChange={onDraftNameChange}
    />);
    fireEvent.change(screen.getByLabelText('Name this entry'), { target: { value: 'kevin b' } });
    expect(onDraftNameChange).toHaveBeenCalledWith('kevin b');
    expect(screen.getByText('You already have an entry with that name.')).toBeTruthy();
    cleanup();
  });

  it('truncates a name to the server\'s limit rather than sending one it will refuse', () => {
    const onDraftNameChange = vi.fn();
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1)]}
      draft={{ entryIndex: 2, entryName: '' }}
      onDraftNameChange={onDraftNameChange}
    />);
    fireEvent.change(screen.getByLabelText('Name this entry'), { target: { value: 'x'.repeat(60) } });
    expect(onDraftNameChange.mock.calls[0][0]).toHaveLength(30);   // ENTRY_NAME_MAX
    cleanup();
  });
});
