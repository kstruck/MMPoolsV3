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
 *
 * 🛑 RENAMING AN ENTRY THAT EXISTS IS A DIFFERENT CALLABLE (the pencil below).
 *
 * The draft above names an entry that does NOT exist yet — the name rides the
 * first `submitNFLPicks`. Once the document exists that route is closed: on
 * Survivor and Margin a submit with no team for the week is refused outright,
 * so "resubmit with a new name" cannot work at all after a week locks, and on
 * pick'em it would drag the lock gates, the resubmit latch, fee liability and
 * the K11 paid-reset along with it. `renameNFLEntry` writes the name and
 * nothing else. Same server-holds-the-rule discipline: the check in
 * `handleRenameChange` is advisory, `ENTRY_NAME_TAKEN` is the answer.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { ENTRY_NAME_MAX, defaultEntryName } from '@shared/multiEntry';
import { sortOwnEntries, nextAddableEntryIndex, entryLabelOf, entryIndexOf, type OwnEntryLike } from '../../utils/entrySelection';
import { getUserMessage } from '../../utils/errorMessages';

/**
 * 🛑 THEME TOKENS, NEVER A FIXED HEX — this card shipped WHITE ON WHITE.
 *
 * Kevin, 2026-08-25, first live use: *"the My entries card is white on white
 * text."* Two independent instances of one mistake:
 *
 *   - the idle chip was `bg-cream` (`tailwind.config.js` — a FIXED `#F7F4EE`
 *     that does not follow the theme) with `text-[color:var(--text)]`, which in
 *     dark mode is `#EDF1F8`. Near-white on near-white.
 *   - the name input was `bg-white` with no colour of its own, so it inherited
 *     the same near-white `--text`.
 *
 * And the ACTIVE chip was `#142A4C` against a dark `--card` of `#152747` — all
 * but the same colour, so the selected state vanished too.
 *
 * These are the values T10's Standings segmented control already ships
 * (`NFLStandingsTab.tsx:129-130`), reused verbatim rather than re-invented.
 * `tests/nfl-surface-invariants.test.ts` now forbids a fixed light background
 * in this file, because the failure is invisible in whichever theme the author
 * happens to be using.
 */
const CHIP_ACTIVE = 'bg-navy-700 text-white dark:bg-gold-500 dark:text-navy-900';
const CHIP_IDLE = 'bg-page text-muted hover:text-[color:var(--text)]';

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
  /**
   * Rename an entry that already exists (`dbService.renameNFLEntry`). Resolves
   * on success; REJECTS with the server's HttpsError so the message below can
   * be the server's own (`ENTRY_NAME_TAKEN`), not a guess. Omit to hide the
   * pencil entirely — the strip still switches and still adds.
   */
  onRename?: (entryIndex: number, entryName: string) => Promise<void>;
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
  onRename,
}) => {
  const [nameError, setNameError] = useState<string | null>(null);
  /** The entry whose name is being edited in place, and the text so far. */
  const [rename, setRename] = useState<{ entryId: string; entryIndex: number; value: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  /**
   * Focus the rename field when it opens. `autoFocus` would say this in one
   * word, but `jsx-a11y/no-autofocus` forbids it (it moves focus on every
   * mount, including a page load the member did not ask for); focusing in an
   * effect keyed on the entry being renamed moves focus only on the click that
   * opened the form.
   */
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renamingId = rename?.entryId ?? null;
  useEffect(() => { if (renamingId) renameInputRef.current?.focus(); }, [renamingId]);
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

  const handleRenameChange = (value: string) => {
    const trimmed = value.trim();
    // 🛑 THE ENTRY BEING RENAMED IS EXCLUDED FROM ITS OWN CLASH CHECK, exactly
    // as `assertEntryNameFree` excludes `target.ref.id`. Without the exclusion,
    // re-opening the pencil and pressing save without typing would warn that
    // the entry clashes with itself.
    const clash = sorted.some(e => String(e.id) !== rename?.entryId
      && typeof e?.entryName === 'string' && e.entryName.trim().toLowerCase() === trimmed.toLowerCase());
    setRenameError(clash ? 'You already have an entry with that name.' : null);
    setRename(prev => (prev ? { ...prev, value: value.slice(0, ENTRY_NAME_MAX) } : prev));
  };

  const startRename = (entry: OwnEntryLike) => {
    setRenameError(null);
    setRename({
      entryId: String(entry.id),
      entryIndex: entryIndexOf(entry),
      // Seeded with the CURRENT name (blank for an unnamed entry #1, whose row
      // shows the player's own name), so the pencil opens on what is there.
      value: typeof entry.entryName === 'string' ? entry.entryName : '',
    });
  };

  const submitRename = async () => {
    if (!rename || !onRename) return;
    const name = rename.value.trim();
    // The server refuses a blank with ENTRY_NAME_EMPTY; saying so here saves a
    // round trip and, more importantly, stops a blank save from reading as
    // "cleared the name" — clearing a name is NOT something this callable does.
    if (!name) { setRenameError("An entry name can't be blank."); return; }
    setRenameSaving(true);
    try {
      await onRename(rename.entryIndex, name);
      setRename(null);
      setRenameError(null);
    } catch (err) {
      // The server's own words — ENTRY_NAME_TAKEN and friends are mapped in
      // src/utils/errorMessages.ts.
      setRenameError(getUserMessage(err, 'That name was not saved. Please try again.'));
    } finally {
      setRenameSaving(false);
    }
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
            onClick={() => { setRename(null); setRenameError(null); onSelectPrimarySlot(); }}
            aria-pressed={primarySlotActive}
            data-testid="implicit-entry-1"
            className={`px-3 py-1.5 rounded-md text-sm font-medium border border-line transition-colors ${
              primarySlotActive ? CHIP_ACTIVE : CHIP_IDLE
            }`}
          >
            Entry 1
          </button>
        )}
        {sorted.map((e) => {
          const active = !draft && e.id === activeEntryId;
          const label = entryLabelOf(e, `Entry ${entryIndexOf(e)}`);
          // 🛑 THE PENCIL IS A SIBLING OF THE CHIP, NOT A CHILD OF IT. A
          // <button> inside a <button> is invalid HTML and browsers recover
          // from it by breaking the inner one — so the two live side by side in
          // one bordered shell that carries the chip's colours, and the shell
          // is what looks like a single chip.
          const editing = rename?.entryId === String(e.id);
          const showPencil = active && !!onRename;
          return (
            <span
              key={e.id}
              className={`inline-flex items-center rounded-md border border-line overflow-hidden transition-colors ${
                active ? CHIP_ACTIVE : CHIP_IDLE
              }`}
            >
              <button
                type="button"
                onClick={() => { setRename(null); setRenameError(null); onSelect(String(e.id)); }}
                aria-pressed={active}
                className="px-3 py-1.5 text-sm font-medium"
              >
                {label}
              </button>
              {showPencil && (
                <button
                  type="button"
                  onClick={() => (editing ? setRename(null) : startRename(e))}
                  aria-expanded={editing}
                  aria-label={`Rename ${label}`}
                  title={`Rename ${label}`}
                  data-testid={`rename-entry-${entryIndexOf(e)}`}
                  className="pr-2.5 pl-1 py-1.5 opacity-80 hover:opacity-100"
                >
                  <Pencil size={13} />
                </button>
              )}
            </span>
          );
        })}

        {canAdd && (
          <button
            type="button"
            onClick={() => { setRename(null); setRenameError(null); onStartDraft(); }}
            disabled={isWeekLocked}
            title={isWeekLocked ? 'This week is locked — a new entry starts with its first pick.' : undefined}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-dashed border-line bg-page text-muted hover:text-[color:var(--text)] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> Add entry
          </button>
        )}
      </div>

      {rename && (
        <div className="mt-3 pt-3 border-t border-line" data-testid="rename-entry-form">
          {/* A <span>, not a <label> — the save and cancel BUTTONS share the row
              below, and `aria-label` on the input is what associates the two
              (same convention as the draft block). */}
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-muted mb-1.5">
            Rename this entry
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Rename this entry"
              value={rename.value}
              maxLength={ENTRY_NAME_MAX}
              ref={renameInputRef}
              disabled={renameSaving}
              placeholder={userName}
              onChange={(ev) => handleRenameChange(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); void submitRename(); }
                if (ev.key === 'Escape') { setRename(null); setRenameError(null); }
              }}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md border border-line bg-page text-[color:var(--text)] text-sm disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void submitRename()}
              disabled={renameSaving}
              aria-label="Save entry name"
              className="p-1.5 rounded-md border border-line text-muted hover:text-[color:var(--text)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setRename(null); setRenameError(null); }}
              disabled={renameSaving}
              aria-label="Cancel rename"
              className="p-1.5 rounded-md border border-line text-muted hover:text-[color:var(--text)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={14} />
            </button>
          </div>
          {renameError && <p className="mt-1.5 text-[12px] text-[#B4232A]">{renameError}</p>}
          <p className="mt-2 text-[12px] text-muted">
            Only the name changes. Your picks, score and dues for this entry stay exactly as they are.
          </p>
        </div>
      )}

      {draft && (
        <div className="mt-3 pt-3 border-t border-line">
          {/*
            EVERY ENTRY IS NAMEABLE, INCLUDING #1 (Kevin, 2026-08-25: "users
            must be able to name each entry, not just the ones after the 1st
            one"). The server never gated this — `nflPools.ts:562` applies a
            requested `entryName` with no index condition — the restriction was
            purely this component and the three pick sheets.

            Entry #1 differs in ONE way, and it is a default rather than a
            rule: it has no generated name (`defaultEntryName` returns
            undefined for index 1), so leaving the field blank keeps today's
            behaviour exactly — the row shows the player's own name.
          */}
          {/* A <span>, not a <label>: the cancel BUTTON sits in the same row, and
              nesting it inside a label would make clicking it focus the input
              instead. `aria-label` on the input carries the association, which
              is also what `getByLabelText` resolves in the tests. */}
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-muted mb-1.5">
            Name this entry{draft.entryIndex === 1 ? ' (optional)' : ''}
          </span>
          <div className="flex items-center gap-2">
            <input
              id="new-entry-name"
              type="text"
              aria-label="Name this entry"
              value={draft.entryName}
              maxLength={ENTRY_NAME_MAX}
              placeholder={defaultEntryName(userName, draft.entryIndex) ?? userName}
              onChange={(ev) => handleName(ev.target.value)}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-md border border-line bg-page text-[color:var(--text)] text-sm"
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
          <p className="mt-2 text-[12px] text-muted">
            Entry {draft.entryIndex} is created when you save its first pick. Until then it does not exist,
            costs nothing, and nobody else can see it.
            {draft.entryIndex === 1 && ' Leave the name blank to use your player name.'}
          </p>
        </div>
      )}

    </div>
  );
};
