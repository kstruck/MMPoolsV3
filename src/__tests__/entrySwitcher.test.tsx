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
import { sortOwnEntries, nextAddableEntryIndex, entryLabelOf, rowDisplayName } from '../utils/entrySelection';

const e = (id: string, entryIndex: number, entryName?: string) =>
  ({ id, ownerUid: 'kevin', entryIndex, ...(entryName ? { entryName } : {}) });

const baseProps = {
  ownEntries: [] as ReturnType<typeof e>[],
  maxEntries: 3,
  userName: 'Kevin',
  activeEntryId: null as string | null,
  activeEntryIndex: 1,
  onSelect: () => {},
  onSelectPrimarySlot: () => {},
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

  it('shows a selectable "Entry 1" SLOT for a member who holds nothing yet', () => {
    // Their sheet IS entry #1; it is created by their first save. A strip with
    // only "Add entry" would read as "create something before you can pick".
    render(<EntrySwitcher {...baseProps} ownEntries={[]} activeEntryIndex={1} />);
    const slot = screen.getByTestId('implicit-entry-1');
    expect(slot.textContent).toBe('Entry 1');
    expect(slot.getAttribute('aria-pressed')).toBe('true');
    // ...and an EXTRA is not offered until entry #1 exists, so the normal UI
    // cannot manufacture an owner of entry #2 with no entry #1 (codex r4).
    expect(screen.queryByText('Add entry')).toBeNull();
    cleanup();
  });

  it('🛑 keeps entry #1 REACHABLE for a member who was proxy-created only an entry #2', () => {
    // codex r3 P2. `nextAddableEntryIndex` never returns 1, so without this slot
    // that owner could create #3 and #4 but never their own primary — and the
    // non-contiguous shape is explicitly supported by the server.
    const onSelectPrimarySlot = vi.fn();
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('e2:kevin', 2, 'Kevin B')]}
      activeEntryId="e2:kevin"
      activeEntryIndex={2}
      onSelectPrimarySlot={onSelectPrimarySlot}
    />);
    const slot = screen.getByTestId('implicit-entry-1');
    expect(slot.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(slot);
    expect(onSelectPrimarySlot).toHaveBeenCalled();
    // Adding a THIRD is withheld until #1 exists, for the same reason.
    expect(screen.queryByText('Add entry')).toBeNull();
    cleanup();
  });

  it('drops the "Entry 1" slot once a real entry #1 exists', () => {
    render(<EntrySwitcher {...baseProps} ownEntries={[e('kevin', 1)]} activeEntryId="kevin" />);
    expect(screen.queryByTestId('implicit-entry-1')).toBeNull();
    expect(screen.getByText('Add entry')).toBeTruthy();
    cleanup();
  });

  it('🛑 the entry-#1 draft DOES collect a name, and says it is optional', () => {
    // Kevin, 2026-08-25, first live use: "users must be able to name each
    // entry, not just the ones after the 1st one." An earlier version of this
    // test asserted the OPPOSITE — that entry #1 collected no name — on the
    // reasoning that `defaultEntryName` returns undefined for index 1. That
    // confused a DEFAULT with a RULE: the server applies a requested name with
    // no index condition (`nflPools.ts:562`), so the restriction was ours.
    render(<EntrySwitcher {...baseProps} ownEntries={[]} draft={{ entryIndex: 1, entryName: '' }} />);
    const input = screen.getByLabelText('Name this entry') as HTMLInputElement;
    expect(input).toBeTruthy();
    // Blank is a real choice and must stay the easy one: the placeholder is the
    // player's own name, which is what an empty field yields.
    expect(input.placeholder).toBe('Kevin');
    expect(screen.getByText(/Leave the name blank to use your player name/i)).toBeTruthy();
    cleanup();
  });

  it('an EXTRA entry still gets its generated default as the placeholder', () => {
    render(<EntrySwitcher {...baseProps} ownEntries={[e('kevin', 1)]} draft={{ entryIndex: 2, entryName: '' }} />);
    const input = screen.getByLabelText('Name this entry') as HTMLInputElement;
    expect(input.placeholder).toBe('Kevin #2');
    // ...and the optional marker is NOT shown, because an extra entry always
    // ends up with a name whether or not the member types one.
    expect(screen.queryByText(/\(optional\)/i)).toBeNull();
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

/**
 * RENAME (PLAN-MULTI-ENTRY K5 follow-up) — the pencil on the ACTIVE chip.
 *
 * The failure this guards is not cosmetic. Until `renameNFLEntry` existed the
 * only way a name reached the server was on a pick submission, and on Survivor
 * and Margin that path REFUSES a payload with no team for the week — so a
 * member who mistyped a name was stuck with it the moment the week locked. The
 * tests below pin the three things that make the pencil worth having: it is
 * offered only where a rename can actually happen, it does not clash an entry
 * with itself, and a server refusal is shown NEXT TO THE FIELD rather than
 * swallowed while the row still reads as saved.
 */
describe('EntrySwitcher — renaming an entry that exists', () => {
  const withRename = (extra: Record<string, unknown> = {}) => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1), e('e2:kevin', 2, 'Kevin B')]}
      activeEntryId="e2:kevin"
      activeEntryIndex={2}
      onRename={onRename}
      {...extra}
    />);
    return onRename;
  };

  it('offers the pencil on the ACTIVE chip only', () => {
    withRename();
    expect(screen.getByTestId('rename-entry-2')).toBeTruthy();
    // Entry #1 is not the active chip — renaming it means selecting it first,
    // which is also the only way the sheet below could be about it.
    expect(screen.queryByTestId('rename-entry-1')).toBeNull();
    cleanup();
  });

  it('offers no pencil at all when no rename handler is wired', () => {
    // The strip must keep working (switch, add) on any surface that has not
    // wired the callable — a missing handler is not a broken pencil.
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1), e('e2:kevin', 2, 'Kevin B')]}
      activeEntryId="e2:kevin"
      activeEntryIndex={2}
    />);
    expect(screen.queryByTestId('rename-entry-2')).toBeNull();
    expect(screen.getByText('Kevin B')).toBeTruthy();
    cleanup();
  });

  it('opens seeded with the CURRENT name and sends the index, never an id', () => {
    const onRename = withRename();
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    const input = screen.getByLabelText('Rename this entry') as HTMLInputElement;
    expect(input.value).toBe('Kevin B');
    fireEvent.change(input, { target: { value: 'Kevin Deux' } });
    fireEvent.click(screen.getByLabelText('Save entry name'));
    // 🛑 THE INDEX, NOT THE DOCUMENT ID. The server derives the entry id from
    // the caller's uid, so a client-supplied id would be forgeable.
    expect(onRename).toHaveBeenCalledWith(2, 'Kevin Deux');
    cleanup();
  });

  it('trims before sending, and refuses a blank without a round trip', () => {
    const onRename = withRename();
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    const input = screen.getByLabelText('Rename this entry');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('Save entry name'));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText(/can't be blank/i)).toBeTruthy();
    // Clearing a name is NOT what this does — the server refuses an empty one
    // with ENTRY_NAME_EMPTY either way, so saying so here is the same answer.
    fireEvent.change(input, { target: { value: '  Kevin Deux  ' } });
    fireEvent.click(screen.getByLabelText('Save entry name'));
    expect(onRename).toHaveBeenCalledWith(2, 'Kevin Deux');
    cleanup();
  });

  it('🛑 does NOT clash the entry being renamed with ITSELF', () => {
    // `assertEntryNameFree` excludes `target.ref.id`; the advisory check has to
    // exclude the same entry or re-opening the pencil and saving unchanged
    // would warn about a duplicate that does not exist.
    const onRename = withRename();
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    fireEvent.change(screen.getByLabelText('Rename this entry'), { target: { value: 'Kevin B' } });
    expect(screen.queryByText('You already have an entry with that name.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Save entry name'));
    expect(onRename).toHaveBeenCalledWith(2, 'Kevin B');
    cleanup();
  });

  it('warns about a name ANOTHER of the member\'s entries already holds', () => {
    withRename({ ownEntries: [e('kevin', 1, 'Kevin A'), e('e2:kevin', 2, 'Kevin B')] });
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    fireEvent.change(screen.getByLabelText('Rename this entry'), { target: { value: 'kevin a' } });
    expect(screen.getByText('You already have an entry with that name.')).toBeTruthy();
    cleanup();
  });

  it('shows the SERVER\'s refusal beside the field and keeps the form open', async () => {
    // The advisory check is not the rule. When the two disagree the member has
    // to see the server's answer, and the field has to stay editable — a toast
    // that vanishes over a closed form reads as "saved".
    const onRename = vi.fn().mockRejectedValue(
      Object.assign(new Error('ENTRY_NAME_TAKEN: you already have an entry named "Kevin B".'),
        { code: 'functions/already-exists' }));
    render(<EntrySwitcher
      {...baseProps}
      ownEntries={[e('kevin', 1), e('e2:kevin', 2, 'Kevin B')]}
      activeEntryId="e2:kevin"
      activeEntryIndex={2}
      onRename={onRename}
    />);
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    fireEvent.change(screen.getByLabelText('Rename this entry'), { target: { value: 'Something' } });
    fireEvent.click(screen.getByLabelText('Save entry name'));
    expect(await screen.findByText(/already have an entry with that name/i)).toBeTruthy();
    expect(screen.getByLabelText('Rename this entry')).toBeTruthy();
    cleanup();
  });

  it('truncates to the server\'s limit, same as the draft field', () => {
    withRename();
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    const input = screen.getByLabelText('Rename this entry') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(60) } });
    expect(input.value).toHaveLength(30);   // ENTRY_NAME_MAX
    cleanup();
  });

  it('closes the rename form when the member switches entries or starts a draft', () => {
    // Otherwise the form would sit under a chip strip that is now about a
    // different entry, still pointed at the old index.
    withRename();
    fireEvent.click(screen.getByTestId('rename-entry-2'));
    expect(screen.getByTestId('rename-entry-form')).toBeTruthy();
    fireEvent.click(screen.getByText('Entry 1'));   // entry #1's chip (unnamed → the index label)
    expect(screen.queryByTestId('rename-entry-form')).toBeNull();
    cleanup();
  });
});

/**
 * PLAN-MULTI-ENTRY T6a — what a ROW is called.
 *
 * The failure this prevents is not a crash: it is two identical "Kevin Struck"
 * lines, both wearing the "Me" badge, on the standings and both grids — a
 * member who cannot tell which score or which sheet belongs to which entry.
 */
describe('rowDisplayName (§0b.4)', () => {
  it('prefers the entry name and falls back to the player name', () => {
    expect(rowDisplayName({ entryName: 'Kevin B', userName: 'Kevin Struck' })).toBe('Kevin B');
    expect(rowDisplayName({ userName: 'Kevin Struck' })).toBe('Kevin Struck');
  });

  it('treats a blank or whitespace entry name as absent, not as a name', () => {
    expect(rowDisplayName({ entryName: '', userName: 'Kevin Struck' })).toBe('Kevin Struck');
    expect(rowDisplayName({ entryName: '   ', userName: 'Kevin Struck' })).toBe('Kevin Struck');
  });

  it('never throws on a row that carries neither', () => {
    expect(rowDisplayName(null)).toBe('');
    expect(rowDisplayName({})).toBe('');
  });
});
