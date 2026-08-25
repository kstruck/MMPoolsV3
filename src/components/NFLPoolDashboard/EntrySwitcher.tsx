/**
 * "My Entry" — the member's own entry selector (PLAN-MULTI-ENTRY T5 / D7).
 *
 * A member may hold up to `settings.maxEntriesPerUser` entries in one NFL pool.
 * Each is an independent contestant: its own picks, its own score, its own
 * Survivor life, strikes and used teams. This strip is how a member says WHICH
 * of theirs the pick sheet below is for.
 *
 * 🛑 AN ENTRY IS CREATED BY ITS FIRST SUBMIT, NOT BY THIS COMPONENT.
 *
 * There is no "create entry" callable and deliberately so (D1): `submitNFLPicks`
 * takes an `entryIndex` and derives the document id from it, so the client never
 * has to create anything before it can pick. "+ Add entry" therefore opens a
 * DRAFT — an index and a name that exist only in React state — and the entry
 * becomes real the moment the member saves a pick against it. The copy says so,
 * because a member who names an entry and walks away must not later believe they
 * hold one.
 *
 * 🛑 THE NAME IS CHECKED BY THE SERVER, NOT HERE. Uniqueness per owner is
 * enforced inside the submit transaction (`assertEntryNameFree`), which is the
 * only place that can be right about it. The local check below exists to catch
 * the obvious case before a round trip; it is not the rule, and the server's
 * `ENTRY_NAME_TAKEN` refusal renders through the pick sheet's normal error path
 * (`getUserMessage`) when the two disagree.
 */
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ENTRY_NAME_MAX, defaultEntryName } from '@shared/multiEntry';
import { sortOwnEntries, nextAddableEntryIndex, entryLabelOf, entryIndexOf, type OwnEntryLike } from '../../utils/entrySelection';

export interface EntryDraft {
  entryIndex: number;
  entryName: string;
}

interface EntrySwitcherProps {
  /** Every entry document this viewer owns in the pool, any order. */
  ownEntries: readonly OwnEntryLike[];
  /** `settings.maxEntriesPerUser`, already defaulted (absent ⇒ 1). */
  maxEntries: number;
  /** The viewer's display name — the base for a new entry's default name. */
  userName: string;
  /** The entry id currently selected, or `null` while a draft/slot is selected. */
  activeEntryId: string | null;
  /** The INDEX the pick sheet is currently submitting under (a draft's, or the active entry's). */
  activeEntryIndex: number;
  onSelect: (entryId: string) => void;
  /** Select the entry-#1 SLOT — the sheet that exists before any document does. */
  onSelectPrimarySlot: () => void;
  /** The draft entry, when the member has started adding one. */
  draft: EntryDraft | null;
  onStartDraft: () => void;
  onDraftNameChange: (name: string) => void;
  onCancelDraft: () => void;
  /** Picks are closed for the week — a new entry cannot be started into it. */
  isWeekLocked?: boolean;
}

export const EntrySwitcher: React.FC<EntrySwitcherProps> = ({
  ownEntries,
  maxEntries,
  userName,
  activeEntryId,
  activeEntryIndex,
  onSelect,
  onSelectPrimarySlot,
  draft,
  onStartDraft,
  onDraftNameChange,
  onCancelDraft,
  isWeekLocked,
}) => {
  const [nameError, setNameError] = useState<string | null>(null);
  const sorted = sortOwnEntries(ownEntries);

  // Nothing to switch between and nothing to add: render nothing rather than a
  // one-tab strip, so a single-entry pool looks exactly as it did before T5.
  if (maxEntries <= 1) return null;

  // 🛑 ENTRY #1 MUST EXIST BEFORE AN EXTRA CAN BE STARTED (codex r2 P2 on the
  // T5 PR). `nextAddableEntryIndex` never returns 1, so a member with NO
  // entries who used "Add entry" would create entry #2 and could then never
  // create entry #1 through this UI — holding fewer entries than the pool
  // advertises, permanently. Their first save creates entry #1 from the sheet
  // below; the button appears the moment it exists.
  /**
   * 🛑 ENTRY #1 IS ALWAYS A SLOT, EVEN WHEN NO DOCUMENT EXISTS FOR IT.
   *
   * `nextAddableEntryIndex` never returns 1 (a member does not "add" their
   * primary — it is the sheet they already have), so entry #1 has to be
   * reachable some other way or it is not reachable at all. Two members hit
   * that: one who has never submitted, and — the case codex r3 found — one whom
   * a commissioner proxy-created ONLY an entry #2 for, an explicitly supported
   * non-contiguous shape. Gating "Add entry" on `sorted.length > 0` left the
   * second one able to create #3 and #4 but never their own #1.
   *
   * So the slot is rendered whenever no owned entry carries index 1, and
   * selecting it points the sheet at index 1 with no document behind it — the
   * same state a brand-new member is in by default.
   */
  const hasPrimary = sorted.some(e => entryIndexOf(e) === 1);
  const primarySlotActive = !hasPrimary && activeEntryIndex === 1;
  // ...and an EXTRA is only offered once entry #1 actually exists. Now that the
  // primary is always reachable through the slot above, this gate strands
  // nobody — it just stops the normal UI from manufacturing a member who owns
  // an entry #2 and no entry #1. (codex r4 on the T5 PR.)
  const canAdd = !draft && hasPrimary && sorted.length < maxEntries
    && nextAddableEntryIndex(sorted, maxEntries) !== null;

  const handleName = (value: string) => {
    const trimmed = value.trim();
    const clash = sorted.some(e =>
      typeof e?.entryName === 'string' && e.entryName.trim().toLowerCase() === trimmed.toLowerCase());
    // Advisory only — the server holds the rule (see the header).
    setNameError(clash ? 'You already have an entry with that name.' : null);
    onDraftNameChange(value.slice(0, ENTRY_NAME_MAX));
  };

  return (
    <div className="bg-card border border-line rounded-xl p-4 shadow-card" data-testid="entry-switcher">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">
          My Entries
        </h3>
        <span className="text-[11px] text-muted num">
          {sorted.length} of {maxEntries}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          A member who has never submitted holds NO entry document, but the
          sheet below is already entry #1 — it is created by their first save.
          Without this chip the strip would show only "Add entry" and read as
          though they had to create something before they could pick.
        */}
        {!hasPrimary && (
          <button
            type="button"
            onClick={onSelectPrimarySlot}
            aria-pressed={primarySlotActive}
            data-testid="implicit-entry-1"
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              primarySlotActive
                ? 'bg-[#142A4C] text-white border-[#142A4C]'
                : 'bg-cream text-[color:var(--text)] border-line hover:border-[#142A4C]'
            }`}
          >
            Entry 1
          </button>
        )}
        {sorted.map((e) => {
          const active = !draft && e.id === activeEntryId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(String(e.id))}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                active
                  ? 'bg-[#142A4C] text-white border-[#142A4C]'
                  : 'bg-cream text-[color:var(--text)] border-line hover:border-[#142A4C]'
              }`}
            >
              {entryLabelOf(e, `Entry ${entryIndexOf(e)}`)}
            </button>
          );
        })}

        {canAdd && (
          <button
            type="button"
            onClick={onStartDraft}
            disabled={isWeekLocked}
            title={isWeekLocked ? 'This week is locked — a new entry starts with its first pick.' : undefined}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-dashed border-line text-muted hover:border-[#142A4C] hover:text-[color:var(--text)] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> Add entry
          </button>
        )}
      </div>

      {draft && draft.entryIndex === 1 && (
        <div className="mt-3 pt-3 border-t border-line">
          {/*
            Entry #1 takes NO name — `defaultEntryName` returns undefined for
            index 1 and the pick sheets only send `entryName` for an extra
            entry, so a field here would collect something the first save
            discards. (codex r1/r3 on the T5 PR.)
          */}
          <p className="text-[12px] text-muted">
            Entry 1 is created when you save its first pick, and it shows your player name.
          </p>
        </div>
      )}

      {draft && draft.entryIndex > 1 && (
        <div className="mt-3 pt-3 border-t border-line">
          <span id="new-entry-name-label" className="block text-[11px] font-medium uppercase tracking-[0.06em] text-muted mb-1.5">
            Name this entry
          </span>
          <div className="flex items-center gap-2">
            <input
              id="new-entry-name"
              type="text"
              aria-label="Name this entry"
              value={draft.entryName}
              maxLength={ENTRY_NAME_MAX}
              placeholder={defaultEntryName(userName, draft.entryIndex) ?? ''}
              onChange={(ev) => handleName(ev.target.value)}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md border border-line bg-white text-sm"
            />
            <button
              type="button"
              onClick={() => { setNameError(null); onCancelDraft(); }}
              className="p-1.5 rounded-md border border-line text-muted hover:text-[color:var(--text)]"
              aria-label="Cancel new entry"
            >
              <X size={14} />
            </button>
          </div>
          {nameError && <p className="mt-1.5 text-[12px] text-[#B4232A]">{nameError}</p>}
          {/* The honest statement of what has and has not happened. */}
          <p className="mt-2 text-[12px] text-muted">
            Entry {draft.entryIndex} is created when you save its first pick. Until then it does not exist,
            costs nothing, and nobody else can see it.
          </p>
        </div>
      )}
    </div>
  );
};
