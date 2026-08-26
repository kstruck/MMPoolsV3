import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Settings, DollarSign, CheckCircle, XCircle, Users, Activity,
  Play, Edit3, Save, Lock, Unlock, AlertTriangle, ShieldCheck, BellRing,
  ChevronDown, ChevronUp, Clock, UserCog, Ban
} from 'lucide-react';
import { NFLBrandingSettings } from './NFLBrandingSettings';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { isPoolManager, poolCoManagers } from '../../utils/auth';
import { logger } from '../../utils/logger';
import type { Pool, NFLGame, User } from '../../types';
import { NFLManagerBentoDashboard } from './NFLManagerBentoDashboard';
import { PaymentLedgerNFL } from './PaymentLedgerNFL';
import { useToast } from '../ui/Toast';
import { FieldLabel } from '../ui/Field';
import { helpRegistry } from '../../help/registry';
import { now as serverNow } from '../../utils/serverClock';
import { gamesForPoolWeek, poolSeasonType } from '../../utils/nflPending';
import { publicListingToggleValue, publicListingUpdate } from '../../utils/publicListing';
import { buildProxyTeamGameIndex, proxyPickPayload, proxyTeamOptions } from '../../utils/proxyPickPayload';
import { nflWeekLabel, nflWeekChip } from '../../utils/nflWeekLabel';
import { buildPoolRoster, hasCompletePicks, memberOutstanding, duesRates } from '../../utils/poolRoster';
import { usesWeeklyHardLock, normalizeLockBufferMinutes } from '@shared/weeklyHardLock';
import { effectiveWeeklyTiebreaker, tiebreakerAsksForPrediction } from '@shared/nflTiebreaker';
import { WEEKLY_TIEBREAKER_OPTIONS } from '@shared/nflTiebreakerOptions';
import { hybridSplitProblem } from '@shared/hybridSplit';
import { DUPLICATE_RANK_MESSAGE, uniqueRanks } from '@shared/schemas/common';
import { effectiveMaxTeamUses, effectiveTieCountsAs } from '@shared/survivorReuse';
import { effectiveMaxEntriesPerUser, MAX_ENTRIES_PER_USER_CAP, MULTI_ENTRY_WIZARD_ENABLED } from '@shared/multiEntry';
import { HelpRoutePublisher } from '../../help/publish';
import { useUrlTab } from '../help/useUrlTab';
import { NFL_KICKOFF_MS } from '../../config/season';

type PlaceRow = { rank: number; percentage: number };

/**
 * PLAN-PAYMENT-LEDGER T2 / D1 — the HYBRID exit notice. Leaving HYBRID deletes
 * `settings.weeklyPayouts` in the same write, and on HYBRID → WEEKLY the pool's
 * SEASON places (`settings.payouts`, untouched by the move) silently become the
 * list that prices every week. That is a money change nobody asked for, so the
 * commissioner is told before they save, not after a week is scored on it.
 * Shown only while the STORED mode is HYBRID and the selected one is not.
 */
const HybridExitNotice: React.FC<{ storedMode?: string; selectedMode: string; hasWeeklyList: boolean }> = ({ storedMode, selectedMode, hasWeeklyList }) => {
  if (storedMode !== 'HYBRID' || selectedMode === 'HYBRID') return null;
  return (
    <p role="status" className="text-[11px] font-body font-bold text-brandred-600 leading-normal">
      {/* Only claim a deletion when there is something to delete — a HYBRID pool
          that never declared a weekly list would otherwise be told it is losing
          one. The sentence that follows is true either way. */}
      {hasWeeklyList ? "Leaving Hybrid deletes this pool's weekly prize places. " : ''}
      {selectedMode === 'WEEKLY'
        ? 'Your SEASON places become the list that prices every week — review your prize places before you save.'
        : 'Only the season places remain — review your prize places before you save.'}
    </p>
  );
};

/**
 * The HYBRID weekly place list (PLAN-PAYMENT-LEDGER T2 / D1) — the manager-side
 * twin of the wizard's second Payouts editor. Rendered only while the selected
 * payout mode is HYBRID, exactly like the entry-fee split above it.
 *
 * The live checks run the SAME `uniqueRanks` predicate and the SAME
 * `DUPLICATE_RANK_MESSAGE` the create schema and `updatePoolSettings` enforce.
 * A friendlier local phrasing would eventually disagree with the refusal, and
 * money copy that disagrees with money enforcement is how commissioners stop
 * trusting either (the rule HybridSplitFields was written under).
 *
 * Editing this list never re-prices a week that has already been scored: the
 * scorer freezes the prize into the recap and the ledger reads the frozen
 * snapshot, never live settings.
 */
const WeeklyPlacesEditor: React.FC<{ places: PlaceRow[]; onChange: (next: PlaceRow[]) => void }> = ({ places, onChange }) => {
  const total = places.reduce((sum, p) => sum + (Number(p.percentage) || 0), 0);
  const over = total > 100;
  const duplicate = !uniqueRanks(places);
  const patch = (i: number, next: Partial<PlaceRow>) => onChange(places.map((p, j) => (j === i ? { ...p, ...next } : p)));
  // One past the highest rank present, NOT `length + 1`: remove rank 1 from
  // [1, 2] and `length + 1` hands out a second rank 2, so the editor's own
  // controls build a list the server refuses (codex r3).
  const nextRank = places.reduce((max, p) => Math.max(max, Number(p.rank) || 0), 0) + 1;

  return (
    <div className="bg-page border border-line rounded-lg p-4 space-y-3">
      <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Weekly Prize Places</p>
      <p className="text-[11px] font-body text-muted leading-normal">
        Percentages of EACH week's pot. Leave this list empty to use the season places for both
        pots — what a hybrid pool does today. Weeks already scored keep the prizes they were
        published with; changes apply to weeks not yet scored.
      </p>
      {places.map((p, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="w-24">
            <FieldLabel tone="muted" helpId="settings.payouts.places.*.rank">Rank</FieldLabel>
            <input type="number" min={1} value={p.rank}
              onChange={e => patch(i, { rank: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
          </div>
          <div className="flex-1">
            <FieldLabel tone="muted" helpId="settings.payouts.places.*.percentage">% of the weekly pot</FieldLabel>
            {/* NOT floored (qodo #2): `payoutPlaceSchema` is
                `z.number().min(0).max(100)` and `splitPrizes` has a test for a
                33.3 / 33.3 / 33.4 split, so rounding here would silently
                re-allocate a pot the schema and the scorer both accept. `rank`
                stays integral — that one IS `z.number().int()`. `step="any"`
                because a bare number input defaults to step=1 and would mark a
                decimal invalid. */}
            <input type="number" min={0} max={100} step="any" value={p.percentage}
              onChange={e => patch(i, { percentage: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
          </div>
          <button type="button" onClick={() => onChange(places.filter((_, j) => j !== i))}
            className="mb-1 px-3 py-2 font-display text-sm font-bold uppercase tracking-[0.05em] text-brandred-600 hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button type="button"
        onClick={() => onChange([...places, { rank: nextRank, percentage: 0 }])}
        className="font-display text-sm font-bold uppercase tracking-[0.05em] border border-line rounded-md px-4 py-1.5 text-[color:var(--text)] hover:bg-card">
        + Add place
      </button>
      {places.length > 0 && (
        over
          ? <p role="alert" className="text-[11px] font-body font-bold text-brandred-600">✗ Weekly payout percentages exceed 100% (total {total}%).</p>
          : <p role="status" className="text-[11px] font-body font-bold text-[#0F7B4A]">✓ Weekly total: {total}% of each week's pot.</p>
      )}
      {duplicate && (
        <p role="alert" className="text-[11px] font-body font-bold text-brandred-600">
          ✗ {DUPLICATE_RANK_MESSAGE.split(': ').slice(1).join(': ')}
        </p>
      )}
    </div>
  );
};

/**
 * The save control, repeated at the end of every settings section (E6, #281).
 *
 * Kevin, smoke-testing #279: the settings form is four sections long, the only
 * save button was at the very bottom, and the success banner is at the very top —
 * so on a laptop you can save successfully and see nothing happen. Every pilot
 * commissioner meets this screen in the one week the pilot has to go well.
 *
 * MODULE SCOPE, not nested inside NFLManagerView (codex r1). Declared inside, it
 * is a NEW component type on every parent state render, so React unmounts and
 * remounts the button on every keystroke in the form — which loses keyboard focus
 * right after a save, the exact moment this feature exists to make legible. It
 * also trips `react-hooks/static-components`.
 *
 * ONE handler, and now ONE instance. There used to be five, repeated per section
 * because the commissioner page was a single ~870-line scroll and the save button
 * was otherwise nowhere near whatever you had just edited. HANDOFF item 3 records
 * that they were harmless and deliberate but read as a bug. The tabbed split
 * removes the reason they existed, so the four in-section copies are gone and the
 * one at the foot of Settings remains.
 *
 * Every section still submits the SAME payload through `handleSaveSettings`. Do
 * not "improve" that by having each section send only its own fields — the
 * callable merges per key, so a partial payload looks identical and quietly
 * changes what a save means.
 */
const SaveSettingsControl: React.FC<{ onSave: () => void; isSaving: boolean; justSaved: boolean }> = ({
  onSave, isSaving, justSaved,
}) => (
  <div className="pt-2 border-t border-line flex justify-end">
    <button
      onClick={onSave}
      disabled={isSaving}
      className={`${justSaved
        ? 'bg-[#0F7B4A] hover:bg-[#0d6b40]'
        : 'bg-[#0B5C37] hover:bg-[#0F7B4A]'} disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-3 px-8 rounded-lg flex items-center gap-2 shadow-card transition-all duration-150 hover:-translate-y-px cursor-pointer text-sm`}
    >
      {justSaved ? <CheckCircle size={15} /> : <Save size={15} />}
      {isSaving ? 'Saving...' : justSaved ? 'Saved!' : 'Save Pool Settings'}
    </button>
  </div>
);

/**
 * The commissioner surface's four sections.
 *
 * Deliberately NOT the eight-tab SuperAdmin set — that one is pinned by
 * `tests/admin-surface-invariants.test.ts` against CONTEXT.md and has nothing to
 * do with this page.
 */
type CommishTab = 'overview' | 'members' | 'settings' | 'scoring';

const COMMISH_TAB_IDS: readonly CommishTab[] = ['overview', 'members', 'scoring', 'settings'];

/**
 * The four sections, with their hover text READ FROM THE HELP REGISTRY (T4).
 *
 * Each of these tabs already has a `HelpPage` whose `summary` says what the
 * tab is for, so the four `hint` strings that used to live here were a second
 * copy of that sentence — and the one that nobody would have thought to update
 * when the tab changed. Voice rule 10: a sentence explaining something exists
 * in exactly one place.
 *
 * `title` is left ABSENT rather than falling back to a literal when a page is
 * missing. A fallback string would be the second copy again, quietly.
 * `buildRegistry` refuses a placement pointing at a page that does not exist,
 * so a missing page is a build-time failure, not a runtime one.
 */
const COMMISH_TABS: { id: CommishTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members & Payments' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'settings', label: 'Settings' },
];

const commishTabHint = (tab: CommishTab): string | undefined =>
  helpRegistry.getPage(`pool.nfl.manager.${tab}`)?.summary;

interface NFLManagerViewProps {
  pool: Pool;
  entries: any[];
  members?: any[];
  games: NFLGame[];
  week: number;
  user: User | null;
  /**
   * uid → games picked this week, from `getPoolPicks`
   * (PLAN-COMMISSIONER-BLIND-PICKS D1). Pick COMPLETENESS is a commissioner-only
   * reading and no longer derivable here: raw entry reads by owner/manager were
   * removed from firestore.rules, so `entries` rows carry pick content only for
   * the viewer's own row and for games the server revealed.
   */
  pickCounts?: Record<string, number>;
  onSelectTab?: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
  /**
   * Which commissioner section to open on MOUNT — the member Payments tab's
   * "Open Payment Ledger" deep-links to `members` (Kevin, 2026-08-16: it used
   * to land on Overview). Read once; `commishTab` stays local after that.
   */
  initialSection?: string | null;
}

export const NFLManagerView: React.FC<NFLManagerViewProps> = ({
  pool,
  entries,
  members = [],
  games,
  week,
  user,
  pickCounts,
  onSelectTab = () => {},
  initialSection = null,
}) => {
  const toast = useToast();
  // Which commissioner section is showing. The page was ~870 lines of JSX in one
  // scroll, which is why the same Save control had to be repeated five times —
  // the button was simply too far from whatever you had just edited. Splitting it
  // removes the reason those duplicates existed rather than deleting a control
  // people rely on.
  //
  // T2 / K13 MOVED THIS INTO THE URL. It was local state on the reasoning that a
  // second URL-backed tab would give the surface two sources of truth — but the
  // deep link into it already existed (`?tab=manager&section=members`, from the
  // member Payments tab's "Open Payment Ledger"), so the URL was ALREADY one of
  // the two and the state was the copy. Reading it here makes the URL the only
  // one, and Back now works across these sections. `section`, not `sub`: that
  // parameter name is already live in links people have sent.
  const [commishTab, setCommishTab] = useUrlTab(
    'section',
    COMMISH_TAB_IDS,
    COMMISH_TAB_IDS.includes(initialSection as CommishTab) ? (initialSection as CommishTab) : 'overview',
  );

  const [isScoring, setIsScoring] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState<string | null>(null);
  const [savingCoCommissioner, setSavingCoCommissioner] = useState<string | null>(null);
  const [remindingUid, setRemindingUid] = useState<string | null>(null);
  const [bulkReminding, setBulkReminding] = useState<'PICKS' | 'PAYMENT' | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // E6 (#281): drives the green "Saved!" state on every save button. A timestamp
  // rather than a boolean so a second save re-triggers the flash even while the
  // first one is still showing.
  const [justSavedAt, setJustSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (justSavedAt === null) return;
    const t = setTimeout(() => setJustSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [justSavedAt]);


  const type = pool.type;
  const castPool = pool as any;
  const settings = castPool.settings || {};
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // --- Season lock logic ---
  // Regular managers can only edit before the season starts; SuperAdmins ALWAYS.
  //
  // ⚠️ This was keyed to its own hardcoded `2026-09-10T00:00:00-06:00`, one of
  // five copies of the season start that disagreed with each other (see
  // src/config/season.ts). It now reads the same instant as the countdown and
  // both milestone strips.
  //
  // The move is Sep 10 00:00 MDT -> Sep 9 18:20 MDT: about thirty hours
  // STRICTER, which is the safe direction for a gate. It is also client-side
  // only — `updatePoolSettings` has no season-start cutoff of its own
  // (measured: no `seasonStart` / `isPreSeason` in functions/src/poolOps.ts) —
  // so this is an affordance, not the authorization boundary.
  const isPreSeason = serverNow() < NFL_KICKOFF_MS;
  const canEditSettings = isSuperAdmin || isPreSeason;

  // ---- Local settings state (initialized from pool) ----
  const [poolName, setPoolName] = useState(pool.name || '');
  const [entryFee, setEntryFee] = useState<number>(settings.entryFee ?? 0);
  // PLAN-MULTI-ENTRY D8/K6 — the manager-side raise control. Raise-only, and
  // only while the pool accepts entries; the server refuses a lower value
  // (MAX_ENTRIES_RAISE_ONLY) so the input's floor is the current effective max.
  const currentMaxEntries = effectiveMaxEntriesPerUser(settings);
  const [maxEntriesPerUser, setMaxEntriesPerUser] = useState<number>(currentMaxEntries);
  const [paymentInstructions, setPaymentInstructions] = useState<string>(settings.paymentInstructions || '');
  // Shows the host's recorded preference, falling back to the field Browse
  // actually reads for a pool that never got the mirror — see
  // `publicListingToggleValue`. Reading `settings.isListedPublic` alone made the
  // toggle claim OFF on such a pool, and the save below would then have
  // de-listed it without anybody asking.
  const [isListedPublic, setIsListedPublic] = useState<boolean>(publicListingToggleValue(castPool));

  const [editManagerName, setEditManagerName] = useState(pool.managerName || '');
  const [editContactEmail, setEditContactEmail] = useState(pool.contactEmail || '');
  const [editContactPhone, setEditContactPhone] = useState(castPool.contactPhone || '');
  const [editContactMethod, setEditContactMethod] = useState<'email' | 'phone' | 'both' | 'none'>(castPool.contactMethod || 'email');

  // Pick'em-specific
  const [confidenceMode, setConfidenceMode] = useState<boolean>(settings.confidenceMode ?? false);
  const [lockMode, setLockMode] = useState<'PER_GAME' | 'WEEKLY'>(settings.lockMode ?? 'PER_GAME');
  // Survivor/Margin use a hard weekly deadline whose only knob is this buffer, and
  // the server snaps it to {60,30,5} — so show a legacy value (e.g. 10) as the
  // preset the server would actually apply rather than a value the picker cannot
  // represent.
  const [lockBufferMinutes, setLockBufferMinutes] = useState<number>(
    usesWeeklyHardLock(pool.type)
      ? normalizeLockBufferMinutes(settings.lockBufferMinutes)
      : (settings.lockBufferMinutes ?? 5)
  );
  const [payoutMode, setPayoutMode] = useState<string>(settings.payoutMode ?? 'SEASON');
  // Resolved, never raw: an unset pool must show the rule it is actually
  // playing (MNF_COMBINED), not an empty select that would save as a change.
  const [weeklyTiebreaker, setWeeklyTiebreaker] = useState<string>(effectiveWeeklyTiebreaker(settings));
  // HYBRID split (PLAN-HYBRID-SPLIT). Local state mirrors the stored split;
  // absent = pre-existing pool that never declared one.
  const [splitWeekly, setSplitWeekly] = useState<number>(settings.hybridSplit?.weeklyPerEntry ?? 0);
  const [splitSeason, setSplitSeason] = useState<number>(settings.hybridSplit?.seasonPerEntry ?? 0);
  const [splitDeclared, setSplitDeclared] = useState<boolean>(!!settings.hybridSplit);
  // The latest split THIS component knows to be stored — updated on every
  // successful save, because the realtime `settings` prop can lag a save that
  // just deleted the split, and re-hydrating from a stale prop would resurrect
  // numbers the commissioner deliberately removed. (codex r7.)
  const lastKnownSplitRef = useRef<{ weeklyPerEntry: number; seasonPerEntry: number } | null>(settings.hybridSplit ?? null);
  // HYBRID weekly place list (PLAN-PAYMENT-LEDGER T2 / D1). Same three-part
  // shape as the split — value, "touched", and a last-known ref — because the
  // server deletes `weeklyPayouts` when a pool leaves HYBRID, so leaving must
  // forget it locally too or re-selecting HYBRID silently resurrects the old
  // list on the next save, and re-hydrating from the realtime `settings` prop
  // would read a copy that lags the delete. (The codex r3/r6 pair on the split.)
  const [weeklyPlaces, setWeeklyPlaces] = useState<PlaceRow[]>(settings.weeklyPayouts?.places ?? []);
  // "Touched", NOT "the pool has one" (codex r2). A stored `{ places: [] }` is a
  // VALID, deliberate configuration — this pool pays no weekly prizes — and
  // seeding this from the stored value made every unrelated settings save
  // rewrite it to the fallback. Only an edit in THIS session sends the key.
  const [weeklyPlacesTouched, setWeeklyPlacesTouched] = useState<boolean>(false);
  // Non-empty only, for the same reason: re-hydrating an empty stored list on a
  // return to HYBRID would mark it touched and clear a deliberate empty list.
  const lastKnownWeeklyPlacesRef = useRef<PlaceRow[] | null>(
    settings.weeklyPayouts?.places?.length ? settings.weeklyPayouts.places : null,
  );
  // The pool's STORED mode, for the HYBRID → WEEKLY notice (D1): leaving HYBRID
  // deletes the weekly list and promotes the season list to be the weekly one.
  const storedPayoutMode: string | undefined = settings.payoutMode;
  /**
   * What this save should say about `weeklyPayouts`, on a HYBRID save only.
   *
   * The editor's own promise is "leave the list empty and the season places
   * price both pots" — so an emptied editor must not store `{ places: [] }`,
   * which `weeklyPlacesFor` reads as "this pool pays NO weekly prizes" and
   * would leave the whole weekly pot unassigned. (codex r1.)
   *
   * Emptying a list the pool ALREADY HAS is the same instruction, so it has to
   * reach the server: omitting the key would leave the stored list pricing
   * every week while the screen shows an empty editor. `null` is the clear —
   * `weeklyPlacesFor` reads a stored null exactly like an absent field, and the
   * callable's own gate treats null as "not a list to validate".
   *
   * An UNTOUCHED editor sends nothing at all, so a stored `{ places: [] }` — a
   * deliberate "no weekly prizes" — survives every unrelated settings save
   * (codex r2), and a save CLEARS the flag (qodo #3) so later unrelated saves
   * cannot re-send a list another session has since replaced.
   */
  const weeklyPayoutsPatch = (): Record<string, unknown> => {
    if (!weeklyPlacesTouched) return {};
    if (weeklyPlaces.length > 0) return { weeklyPayouts: { places: weeklyPlaces } };
    // "Is there a stored list?" is answered by what THIS component last saved
    // first, and only then by the realtime prop, which lags a save it has not
    // received yet: add places, save, remove them all, save again — a prop-only
    // check would send nothing and leave the just-saved list pricing every week
    // behind an empty editor. (codex r5, the same lag lastKnownSplitRef exists for.)
    return (lastKnownWeeklyPlacesRef.current || settings.weeklyPayouts) ? { weeklyPayouts: null } : {};
  };
  // `settings.pointsPerPick` and `settings.primetimeBonus` USED TO BE EDITED
  // HERE, and neither has ever been read by anything that scores:
  // `scorePickemEntry` awards exactly 1 point per correct pick on a
  // non-confidence pool. Kevin's ruling, 2026-08-22 — delete the controls
  // rather than honour the fields, because honouring them would retroactively
  // rewrite already-scored weeks in any pool holding a non-1 value, mid-season,
  // on a live scorer with money attached. See PLAN-DELETE-INERT-PICKEM-SCORING.md.
  //
  // The stored values are left exactly where they are. Deleting a control is
  // not a data migration.

  // Survivor-specific
  const [maxStrikes, setMaxStrikes] = useState<number>(settings.maxStrikes ?? 0);
  const [maxRebuys, setMaxRebuys] = useState<number>(settings.maxRebuys ?? 0);
  const [rebuyDeadlineWeek, setRebuyDeadlineWeek] = useState<number>(settings.rebuyDeadlineWeek ?? 8);
  const [rebuyCost, setRebuyCost] = useState<number>(settings.rebuyCost ?? entryFee);
  const [pickLosersMode, setPickLosersMode] = useState<boolean>(settings.pickLosersMode ?? false);
  // Effective values, not raw: an untouched legacy pool must render — and then
  // save — today's rules rather than a blank control. The server refuses a
  // CHANGE to either field once a week is scored, and compares effective values,
  // so re-saving these is a no-op on such a pool rather than a rejection.
  const [tieCountsAs, setTieCountsAs] = useState<'WIN' | 'LOSS'>(effectiveTieCountsAs(settings));
  const [maxTeamUses, setMaxTeamUses] = useState<number>(effectiveMaxTeamUses(settings));

  // Margin-specific
  const [marginPayoutMode, setMarginPayoutMode] = useState<string>(settings.payoutMode ?? 'SEASON');

  // ---- Exceptions (commissioner tools) state ----
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState<number>(60);
  const [extendReason, setExtendReason] = useState('');
  const [isExtending, setIsExtending] = useState(false);
  // The proxy target is an ENTRY (id), not a person: under multi-entry one
  // member may hold several, and the callable addresses one by {uid, entryIndex}.
  const [proxyTargetEntryId, setProxyTargetEntryId] = useState('');
  const [proxyTeam, setProxyTeam] = useState('');
  const [proxyWeek, setProxyWeek] = useState<number>(week);
  const [proxyReason, setProxyReason] = useState('');
  const [isProxying, setIsProxying] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCanceling, setIsCanceling] = useState(false);

  // Force weekly lock when confidence mode is on
  useEffect(() => {
    if (confidenceMode) setLockMode('WEEKLY');
  }, [confidenceMode]);

  // --- Weekly Games ---
  const weeklyGames = useMemo(() => gamesForPoolWeek(games, castPool, week), [games, castPool, week]);
  const finalGamesCount = useMemo(
    () => weeklyGames.filter(g => g.status === 'FINAL' || g.status === 'CANCELLED').length,
    [weeklyGames]
  );
  const totalGamesCount = weeklyGames.length;
  const isWeekFullyFinal = totalGamesCount > 0 && finalGamesCount === totalGamesCount;

  // --- Roster status ---
  // Entry doc id == owner uid for NFL pools, but prefer ownerUid when present.

  // Roster = everyone who JOINED (participantIds) enriched with Member Records (name +
  // authoritative paidStatus) and entries (picks/status/score). Members without an entry —
  // including the commissioner — appear here, so they show on the list and payment ledger the
  // moment they join, before any pick is made (ADR 0003). Falls back gracefully to entries
  // when Member Records are absent (pre-backfill).
  const roster = useMemo(() => {
    // The merge itself lives in utils/poolRoster so the Bento Buy-In Ledger reads
    // the same roster this panel does; only the pick state, the display-name
    // fallback and the owner-first sort are this surface's own.
    const rows = buildPoolRoster({ pool, members, entries }).map(r => {
      // Completeness comes from the server's per-member COUNT when it has
      // arrived (PLAN-COMMISSIONER-BLIND-PICKS D1) — `r.entry.picks` no longer
      // holds another member's sheet, so counting it would report the whole
      // pool unpicked and light up every reminder before kickoff. The entry
      // reading stays as the pre-arrival fallback and for SUPER_ADMIN surfaces.
      // Completeness is `hasCompletePicks` and nothing else. This used to be an
      // inline copy of the same rule, and the two drifted: the copy marked every
      // entry holder pending on a week with NO games, while the shared version
      // (which the Bento readiness card uses) called that complete — so the same
      // page offered "Remind all unpicked" for games that did not exist.
      // codex r1 on the commissioner-blind-picks PR.
      const picked = hasCompletePicks(r, {
        poolType: type,
        week,
        weeklyGameIds: weeklyGames.map(g => g.id),
        pickCounts,
      });
      const userName = r.userName || (r.uid === user?.id ? (user?.name || 'You') : 'Member');
      return { ...r, userName, picked };
    });
    return rows.sort((a, b) => (a.isOwner ? -1 : b.isOwner ? 1 : a.userName.localeCompare(b.userName)));
  }, [members, entries, pool, weeklyGames, week, type, user, pickCounts]);

  const unpickedCount = useMemo(() => roster.filter(r => !r.picked).length, [roster]);
  // Outstanding BALANCE, not paidStatus. A Survivor member can have paid their
  // base entry fee and still owe rebuys; selecting on paidStatus !== 'PAID'
  // could never reach them, which made the backend's rebuy-due handling
  // unreachable from this screen. memberOutstanding is the same rule the pot
  // maths uses, including the legacy un-stamped rebuy fallback, so the button
  // and the callable agree on who owes.
  const rates = useMemo(() => duesRates(pool), [pool]);

  // Hosting is not playing (ADR 0005), and a pre-backfill pool can list its
  // commissioner in participantIds with no member record and no entry — a row
  // memberOutstanding scores at a full entry fee. The callable exempts them, so
  // without the same rule here the button offers a send the backend refuses.
  // All three owner fields, because poolOps and the backfill disagree on which
  // takes precedence.
  const hostUids = useMemo(() => new Set(
    [(pool as any)?.createdByUid, (pool as any)?.ownerId, (pool as any)?.managerUid].filter(Boolean),
  ), [pool]);
  // Mirrors the callable's rules EXACTLY. Where these two disagree the UI either
  // offers a send the backend refuses, or hides one it would have made:
  //
  //  - the host exemption applies ONLY to an UNSTAMPED host (`feeOwed`
  //    undefined) with no entry. A host who played carries a stamped feeOwed and
  //    genuinely owes it; exempting them unconditionally hid a real debt.
  //  - a legacy rebuy with `rebuysUsed > 0` whose computed balance is 0 is
  //    UNKNOWN, not settled — `rebuyCost` may have since been set to 0. The
  //    callable keeps them eligible, so this must too, or the backend's
  //    price-drift safeguard is unreachable from this screen.
  const owesMoney = useCallback(
    (r: { uid: string; hasEntry: boolean; feeOwed?: number; rebuyOwed?: number; rebuysUsed?: number }) => {
      const unstampedHost = hostUids.has(r.uid) && !r.hasEntry && r.feeOwed === undefined;
      if (unstampedHost) return false;
      if (memberOutstanding(r as any, rates) > 0) return true;
      return r.rebuyOwed === undefined && (r.rebuysUsed ?? 0) > 0;
    },
    [hostUids, rates],
  );
  const unpaidCount = useMemo(() => roster.filter(owesMoney).length, [roster, owesMoney]);

  // --- Handlers ---
  const handleRemindOne = async (uid: string, kind: 'PICKS' | 'PAYMENT') => {
    setRemindingUid(uid);
    try {
      const { sent, skipped, skippedNoEmail, skippedNoBalance } = await dbService.sendManualReminder(pool.id, [uid], kind);
      // "skipped (recently reminded)" asserted a cause the client was never
      // told; a no-email skip reported as a success is the same class of lie
      // this file's payment surfaces were cleaned of in #322.
      if (sent > 0) toast.success('Reminder sent.');
      else if (skippedNoEmail && skippedNoEmail > 0) toast.error('No reminder sent — there is no email address on that account.');
      else if (skippedNoBalance && skippedNoBalance > 0) toast.info('No reminder sent — that member owes nothing.');
      else if (skipped > 0) toast.info('No reminder sent — they were reminded recently, or have no email on file.');
      else toast.error("No reminder sent — that member was not found on this pool's roster.");
    } catch (err) {
      logger.error('Failed to send manual reminder:', err);
      toast.error(getUserMessage(err));
    } finally {
      setRemindingUid(null);
    }
  };

  const handleRemindBulk = async (kind: 'PICKS' | 'PAYMENT') => {
    const targets = (kind === 'PICKS'
      ? roster.filter(r => !r.picked)
      : roster.filter(owesMoney)
    ).map(r => r.uid);
    if (targets.length === 0) {
      toast.info(kind === 'PICKS' ? 'Everyone has picked this week.' : 'Everyone has paid.');
      return;
    }
    setBulkReminding(kind);
    try {
      const { sent, skipped, skippedNoEmail } = await dbService.sendManualReminder(pool.id, targets, kind);
      const noEmail = skippedNoEmail && skippedNoEmail > 0 ? `, ${skippedNoEmail} with no email on file` : '';
      if (sent > 0) toast.success(`Sent ${sent} reminder(s), ${skipped} skipped${noEmail}.`);
      else toast.info(`No reminders sent — ${skipped} skipped${noEmail}.`);
    } catch (err) {
      logger.error('Failed to send bulk reminders:', err);
      toast.error(getUserMessage(err));
    } finally {
      setBulkReminding(null);
    }
  };

  const handleScoreWeek = async () => {
    const ok = await toast.confirm({
      title: `Score ${nflWeekLabel(poolSeasonType(pool), week)}?`,
      message: 'This will lock results and generate a recap.',
      confirmLabel: 'Score Week',
      danger: true
    });
    if (!ok) return;
    setIsScoring(true);
    setFeedback(null);
    try {
      const res = await dbService.scoreNFLWeek(pool.id, week);
      setFeedback({ type: 'success', message: res.message || `${nflWeekLabel(poolSeasonType(pool), week)} scored and locked!` });
    } catch (err: any) {
      logger.error(`Failed to score week ${week}:`, err);
      setFeedback({ type: 'error', message: err.message || 'Scoring failed. Ensure all games are final.' });
    } finally {
      setIsScoring(false);
    }
  };

  // PLAN-CO-COMMISSIONERS D6/C10: owner-only, ONE uid per call, THIS ROW ONLY.
  // Never a full array: that would reinstate the stale-tab race the revision
  // fence closes. `add` presents the coManagersRevision this tab SAW (absent =
  // 0); if another tab moved it the server refuses and the snapshot re-renders
  // the row from truth. `remove` presents nothing and always wins.
  const coManagers = poolCoManagers(pool);
  // STRICT isPoolManager: owner / managerUid / SUPER_ADMIN — exactly the set the
  // callable admits (C10; SA per codex r3) — and NEVER a co-commissioner, since
  // the strict helper does not read coManagers (D3/D4).
  const viewerIsOwner = isPoolManager(user, pool);
  const handleToggleCoCommissioner = async (uid: string) => {
    setSavingCoCommissioner(uid);
    setFeedback(null);
    const isCo = coManagers.includes(uid);
    try {
      await dbService.setPoolCoCommissioner(isCo
        ? { poolId: pool.id, uid, op: 'remove' }
        : { poolId: pool.id, uid, op: 'add', revision: (pool as { coManagersRevision?: number }).coManagersRevision ?? 0 });
    } catch (err: unknown) {
      logger.error(`Failed to ${isCo ? 'remove' : 'add'} co-commissioner ${uid}:`, err);
      setFeedback({ type: 'error', message: getUserMessage(err, 'Failed to update co-commissioners.') });
    } finally {
      setSavingCoCommissioner(null);
    }
  };

  // setPaidStatus is the ONLY payment writer here (PLAN-PAYMENT-TRUTH P1 / D13).
  // It writes the Member Record as truth, appends the ledger row and mirrors the
  // display fields onto the entry in one transaction, and it works for members
  // with or without an entry (incl. the commissioner).
  //
  // This used to fall back to the legacy `updateEntryPayment` callable (reached
  // through its dbService wrapper — deliberately not named here, because
  // tests/nfl-settings-lockdown.test.ts pins that identifier's absence from this
  // whole file, comments included)
  // when setPaidStatus threw, because on a pool with no Member Records it threw
  // for EVERY member ("Member is not on this pool's roster" — PLAN-PAYMENT-TRUTH
  // §2 item 3). That precondition is gone: the D25 backfill ran in prod on
  // 2026-07-27 (72 member records created, 127 pools stamped, follow-up dry run
  // 0-to-create / 152-already-present), so every pool has them. The fallback is
  // now pure downside — an error on the authoritative path would silently write
  // the display-legacy entry doc instead and recreate exactly the split-brain
  // D13 existed to close. An error must surface as an error.
  const handleTogglePayment = async (uid: string, currentStatus: string) => {
    setIsSavingPayment(uid);
    setFeedback(null);
    const nextPaid = currentStatus !== 'PAID';
    try {
      await dbService.setPaidStatus(pool.id, uid, nextPaid);
    } catch (err: any) {
      logger.error(`Failed to set paid status for ${uid}:`, err);
      // getUserMessage, not err.message: setPaidStatus now throws a
      // MEMBER_NOT_ON_ROSTER: domain prefix, and raw err.message would render
      // that machine token to the commissioner. The Bento payment card already
      // routes this way.
      setFeedback({ type: 'error', message: getUserMessage(err, 'Failed to update payment status.') });
    } finally {
      setIsSavingPayment(null);
    }
  };

  // Fee payment DETAILS (method / date / note) — the old Advanced Payment Ledger
  // modal's saveDetailedPayment, now reached from the Payment Ledger's fee cell.
  // Details ride only with PAID (the schema refuses them otherwise), so this
  // also marks the member paid. Same authoritative callable, no fallback.
  const handleSavePaidDetails = async (uid: string, details: { paymentMethod: string; paidAt: number; paymentNote: string | null }): Promise<boolean> => {
    setIsSavingPayment(uid);
    setFeedback(null);
    try {
      await dbService.setPaidStatus(pool.id, uid, true, details);
      return true; // the ledger closes its editor only on success (codex r7)
    } catch (err: any) {
      logger.error(`Failed to save payment details for ${uid}:`, err);
      setFeedback({ type: 'error', message: getUserMessage(err, 'Failed to save the payment details.') });
      return false;
    } finally {
      setIsSavingPayment(null);
    }
  };

  // Rebuy settlement (PLAN-PAYMENT-TRUTH P3): a member's rebuy dues are owed
  // and settled INDEPENDENTLY of base dues — the same button state machine as
  // the paid toggle, against the settleRebuys mode of the same callable.
  const handleSettleRebuys = async (uid: string, settle: boolean) => {
    setIsSavingPayment(uid);
    setFeedback(null);
    try {
      await dbService.settleRebuys(pool.id, uid, settle);
    } catch (err: any) {
      logger.error(`Failed to settle rebuys for ${uid}:`, err);
      setFeedback({ type: 'error', message: getUserMessage(err, 'Rebuy settlement failed.') });
    } finally {
      setIsSavingPayment(null);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsFeedback(null);
    try {
      // Both halves of the listing change come from ONE call, because writing
      // one and forgetting the other is exactly the defect this closes: this
      // save used to send `settings.isListedPublic` alone while Browse reads the
      // top-level `isPublic`, so the toggle moved nothing.
      const listing = publicListingUpdate(isListedPublic);

      // Build updated settings based on pool type
      let updatedSettings: Record<string, unknown> = {
        entryFee,
        paymentInstructions,
        ...listing.settings,
        // Sent on every save; the server strips a value equal to the pool's
        // effective max (absent ⇒ 1) as a no-op, so this costs nothing until
        // it is actually raised (PLAN-MULTI-ENTRY D8).
        maxEntriesPerUser,
      };

      if (type === 'NFL_PICKEM') {
        updatedSettings = {
          ...updatedSettings,
          confidenceMode,
          lockMode,
          lockBufferMinutes,
          payoutMode,
          // Sent only while HYBRID and declared. Leaving HYBRID omits it and
          // the callable deletes the stored copy in the same write — sending
          // it on a non-hybrid save would be refused (HYBRID_SPLIT_WRONG_MODE).
          ...(payoutMode === 'HYBRID' && splitDeclared
            ? { hybridSplit: { weeklyPerEntry: splitWeekly, seasonPerEntry: splitSeason } } : {}),
          // Same rule as the split (PLAN-PAYMENT-LEDGER T2 / D1): sent only while
          // HYBRID. Leaving HYBRID omits it and the callable deletes the stored
          // copy in the same write; sending it on a non-hybrid save would be
          // refused (WEEKLY_PAYOUTS_WRONG_MODE). See weeklyPayoutsPatch for what
          // an emptied editor sends.
          ...(payoutMode === 'HYBRID' ? weeklyPayoutsPatch() : {}),
          weeklyTiebreaker,
          // NOT sent: `pointsPerPick` / `primetimeBonus`. The save used to
          // rewrite both on every click, including clearing `primetimeBonus`
          // to null — so an unrelated settings save could silently change a
          // stored value nobody was editing. With the controls gone, a stored
          // value is simply left alone (`flattenSettingsPatch` writes per key,
          // so an omitted key is untouched rather than deleted).
        };
      } else if (type === 'NFL_SURVIVOR') {
        updatedSettings = {
          ...updatedSettings,
          maxStrikes,
          maxRebuys,
          rebuyDeadlineWeek,
          rebuyCost,
          pickLosersMode,
          tieCountsAs,
          maxTeamUses,
          // Survivor/Margin run a HARD weekly deadline before the first kickoff;
          // the buffer is the only knob. The server derives the weekly lock from
          // the pool type and re-snaps this to an allowed preset, so omitting or
          // tampering with it cannot move the deadline to/past kickoff.
          lockBufferMinutes,
        };
      } else if (type === 'NFL_MARGIN') {
        updatedSettings = {
          ...updatedSettings,
          payoutMode: marginPayoutMode,
          lockBufferMinutes,
          ...(marginPayoutMode === 'HYBRID' && splitDeclared
            ? { hybridSplit: { weeklyPerEntry: splitWeekly, seasonPerEntry: splitSeason } } : {}),
          ...(marginPayoutMode === 'HYBRID' ? weeklyPayoutsPatch() : {}),
        };
      }

      // Routed through the server callable, not dbService.updatePool: firestore.rules
      // now DENIES a client-direct write to `settings` on NFL pools. A wholesale
      // settings replacement is exactly how an override could be injected after a
      // result was published, and `affectedKeys()` cannot see inside one — so the
      // server merges per key and refuses the scorer-owned fields
      // (PLAN-REALTIME-SCORING §3a). It also means this save no longer wipes
      // `weekLockOverrides` / `lockRevision` by omitting them.
      await dbService.updatePoolSettings(pool.id, {
        name: poolName,
        managerName: editManagerName,
        contactEmail: editContactEmail,
        contactPhone: editContactPhone,
        contactMethod: editContactMethod,
        // TOP-LEVEL, next to the settings blob rather than inside it. This is
        // the field `isPubliclyListed` reads and the one `firestore.rules` uses
        // to allow the Browse LIST query; `classifyUpdateKey` puts it in the
        // `lifecycle` group, which is editable in every phase.
        ...listing.top,
        settings: updatedSettings
      });
      setSettingsFeedback({ type: 'success', message: 'Pool settings saved successfully!' });
      // E6 (#281). The banner alone was not enough: it renders at the TOP of a
      // long multi-section form, and the only save button was at the BOTTOM, so a
      // commissioner on a laptop could save successfully and see nothing happen.
      // The toast floats over the viewport wherever they are.
      // Mirror what the save just made true server-side (see lastKnownSplitRef).
      const activeMode = type === 'NFL_MARGIN' ? marginPayoutMode : payoutMode;
      lastKnownSplitRef.current = activeMode === 'HYBRID' && splitDeclared
        ? { weeklyPerEntry: splitWeekly, seasonPerEntry: splitSeason }
        : null;
      // The last list this component knows to be STORED — an emptied editor
      // cleared it, so there is nothing to re-hydrate on a later return to HYBRID.
      lastKnownWeeklyPlacesRef.current = activeMode === 'HYBRID' && weeklyPlaces.length > 0 ? weeklyPlaces : null;
      // …and the editor is no longer dirty (qodo #3). The flag means "edited
      // since the last save"; leaving it latched made every LATER unrelated save
      // re-send this list, which would overwrite a newer weekly list saved from
      // another session between the two saves. What was just written is now the
      // stored truth, so the next save has nothing of its own to say.
      setWeeklyPlacesTouched(false);
      toast.success('Pool settings saved!');
      // Drives the per-section buttons' green "Saved!" state. Cleared on a timer
      // rather than left latched, so the NEXT save is visibly a new event —
      // a button that says "Saved!" forever confirms nothing.
      setJustSavedAt(Date.now());
    } catch (err: any) {
      logger.error('Failed to save pool settings:', err);
      setSettingsFeedback({ type: 'error', message: err.message || 'Failed to save settings.' });
      toast.error(err.message || 'Failed to save settings.');
      setJustSavedAt(null);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // --- Exception handlers ---
  const reasonIsValid = (r: string) => r.trim().length >= 3 && r.trim().length <= 200;

  const handleExtendDeadline = async () => {
    if (!reasonIsValid(extendReason)) {
      toast.error('Please provide a reason (3–200 characters).');
      return;
    }
    if (!extendMinutes || extendMinutes < 1 || extendMinutes > 1440) {
      toast.error('Extension must be between 1 and 1440 minutes (24 hours).');
      return;
    }
    const ok = await toast.confirm({
      title: `Extend ${nflWeekLabel(poolSeasonType(pool), week)} deadline?`,
      message: `The pick deadline moves ${extendMinutes} minute(s) past the normal lock and every member is emailed the new time. Reason: "${extendReason.trim()}"`,
      confirmLabel: 'Extend Deadline'
    });
    if (!ok) return;
    setIsExtending(true);
    try {
      const res = await dbService.extendWeekDeadline(pool.id, week, extendMinutes, extendReason.trim());
      toast.success(`Deadline extended to ${new Date(res.newLockTime).toLocaleString()} — emailed ${res.emailed} member(s).`);
      setExtendReason('');
    } catch (err) {
      logger.error('Failed to extend week deadline:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsExtending(false);
    }
  };

  // One row per ENTRY (PLAN-MULTI-ENTRY §0b.4): `entryName ?? userName`, with
  // the index appended so two entries of one member are distinguishable.
  const entryLabel = (e: { id: string; userName?: string; entryName?: string; entryIndex?: number }): string => {
    const base = e.entryName || e.userName || e.id;
    const idx = e.entryIndex ?? 1;
    return idx > 1 && !e.entryName ? `${base} (Entry ${idx})` : base;
  };

  const handleProxyPick = async () => {
    const targetEntry = entries.find(e => e.id === proxyTargetEntryId);
    if (!targetEntry) {
      toast.error('Select a member to pick for.');
      return;
    }
    // The proxy TARGET is a person (their uid) plus which of their entries;
    // entry #1's id is the uid, extras carry an explicit entryIndex.
    const targetUid: string = targetEntry.ownerUid ?? targetEntry.id;
    const targetEntryIndex: number = targetEntry.entryIndex ?? 1;
    if (!proxyTeam) {
      toast.error('Select a team.');
      return;
    }
    if (!reasonIsValid(proxyReason)) {
      toast.error('Please provide a reason (3–200 characters).');
      return;
    }
    // THE PAYLOAD SHAPE IS PER POOL TYPE, and getting it wrong is why this
    // feature has never worked on Pick'em. Built before the confirm dialog so a
    // slate we cannot key a pick against is refused BEFORE the commissioner is
    // asked to approve something that would only fail afterwards.
    const payload = proxyPickPayload(type, proxyWeek, proxyTeam, proxyTeamGames);
    if ('error' in payload) {
      toast.error(payload.error);
      return;
    }

    const targetLabel = entryLabel(targetEntry);
    const ok = await toast.confirm({
      title: 'Submit pick on their behalf?',
      message: `${nflWeekLabel(poolSeasonType(pool), Number(proxyWeek))}: ${proxyTeam} for ${targetLabel}. This is recorded in the pool audit log with your name and reason.`,
      confirmLabel: 'Submit Proxy Pick'
    });
    if (!ok) return;
    setIsProxying(true);
    try {
      await dbService.proxyPick(pool.id, proxyWeek, targetUid, payload.picks, proxyReason.trim(), targetEntryIndex);
      toast.success(`Proxy pick saved: ${proxyTeam} (${nflWeekLabel(poolSeasonType(pool), Number(proxyWeek))}) for ${targetLabel}.`);
      setProxyTeam('');
      setProxyReason('');
    } catch (err) {
      logger.error('Failed to submit proxy pick:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsProxying(false);
    }
  };

  const handleCancelPool = async () => {
    if (!reasonIsValid(cancelReason)) {
      toast.error('Please provide a reason (3–200 characters).');
      return;
    }
    const first = await toast.confirm({
      title: 'Cancel this pool?',
      message: `"${pool.name}" will be marked CANCELED and every member will be emailed the reason plus who to contact about dues already paid.`,
      confirmLabel: 'Continue',
      danger: true
    });
    if (!first) return;
    const second = await toast.confirm({
      title: 'Are you absolutely sure?',
      message: 'This cannot be undone from the dashboard. The pool will stop being playable for all members.',
      confirmLabel: 'Yes, Cancel Pool',
      danger: true
    });
    if (!second) return;
    setIsCanceling(true);
    try {
      const res = await dbService.cancelPool(pool.id, cancelReason.trim());
      toast.success(`Pool canceled. Emailed ${res.emailed} member(s).`);
      setCancelReason('');
    } catch (err) {
      logger.error('Failed to cancel pool:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsCanceling(false);
    }
  };

  // Which game each team plays in the proxy target week.
  //
  // It used to be a bare Set of abbreviations, because the payload was keyed by
  // WEEK for all three types — which is why the Pick'em proxy pick never
  // worked: the callable reads a Pick'em payload's keys as GAME IDS. The game
  // was already known right here, at the point the dropdown is built; it was
  // simply thrown away one line later. See `utils/proxyPickPayload.ts`.
  //
  // ONE memo returning both halves, not a memo reading a memo: the index and
  // the option list are derived from the same slate in the same step, and the
  // React Compiler cannot preserve a manual memo whose dependency is another
  // manual memo over an `any`-typed pool.
  const { proxyTeamGames, proxyWeekTeams } = useMemo(() => {
    const index = buildProxyTeamGameIndex(gamesForPoolWeek(games, castPool, proxyWeek));
    return { proxyTeamGames: index, proxyWeekTeams: proxyTeamOptions(index) };
  }, [games, castPool, proxyWeek]);

  /**
   * Why the proxy form is not offered, or `null` when it is.
   *
   * Pick'em USED to be refused outright, on the reasoning that a whole week of
   * game-by-game picks is too error-prone to type here. That reasoning applies
   * to a whole week; it never applied to the single pick this form takes, and
   * the refusal hid a payload bug rather than a design decision — the code
   * behind it sent a week-keyed map the callable reads as game ids.
   *
   * A CONFIDENCE pool is still refused, and that one IS a real limitation.
   * `proxyPick` writes `picks` and never `confidence`, and a confidence pool
   * scores a correct pick at `confidence[gameId] ?? 0` — so a proxied pick
   * would be recorded, look right in the grid, and be worth nothing. Entering
   * a confidence value needs a control this form does not have, and a pick
   * silently worth zero is worse than no pick at all.
   */
  // `settings.confidenceMode`, NOT the local editable state: the gate has to
  // reflect what the SERVER will do with the pick, not an unsaved edit sitting
  // in the settings form on another tab.
  const proxyBlockedReason: string | null =
    type === 'NFL_PICKEM' && settings.confidenceMode
      ? 'This pool uses confidence points, and a proxy pick cannot carry one — it would be recorded as worth zero. Ask the member to submit, or extend the deadline so they can.'
      : null;

  /**
   * A proxy pick records a TEAM and nothing else, so on a Pick'em pool that
   * asks for a weekly tie-breaker prediction it leaves that blank — and a
   * member with no prediction loses a tied week to anyone who made one. Said
   * plainly next to the control rather than discovered in the standings.
   *
   * Read from the STORED setting for the same reason as the gate above.
   */
  const proxyOmitsTiebreaker =
    type === 'NFL_PICKEM' && tiebreakerAsksForPrediction(effectiveWeeklyTiebreaker(settings));

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* T2: the commissioner section, for the Help panel. `subTab` only — the
          parent dashboard owns `tab`, and two publishers writing one field
          would be ambiguous. */}
      <HelpRoutePublisher subTab={commishTab} />

      {/* Feedback Alert — OUTSIDE the tab groups on purpose: a save started on
          Settings must still report its result if the tab changed underneath it. */}
      {feedback && (
        <div className={`p-4 rounded-lg font-body text-xs font-bold flex gap-2 items-center ${
          feedback.type === 'success'
            ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
            : 'bg-brandred-600/10 border border-brandred-600/25 text-brandred-600'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {feedback.message}
        </div>
      )}

      {/* Section nav.
          Plain navigation buttons, NOT role="tablist"/role="tab" (codex r1). That
          ARIA pattern is a PROMISE of behaviour the browser does not supply: once
          a control is exposed as a WAI-ARIA tab, a keyboard user expects
          Arrow/Home/End to move between tabs under a roving tabindex, and expects
          each panel to be an associated `role="tabpanel"`. None of that comes
          free, and half of it is worse than none — a screen reader announces a
          tablist and then the arrow keys do nothing.
          As ordinary buttons in a <nav>, Tab and Enter already work correctly and
          `aria-current` announces which section you are in. If the roving-focus
          pattern is ever wanted, implement it whole rather than re-adding the
          roles. */}
      <nav className="bg-card border border-line shadow-card rounded-xl p-2 flex flex-wrap gap-1.5" aria-label="Commissioner sections">
        {COMMISH_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            aria-current={commishTab === t.id ? 'page' : undefined}
            title={commishTabHint(t.id)}
            onClick={() => setCommishTab(t.id)}
            className={`min-h-[44px] px-4 rounded-lg font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-all duration-150 cursor-pointer ${
              commishTab === t.id
                ? 'bg-navy-800 text-white shadow-card'
                : 'text-muted hover:text-[color:var(--text)] hover:bg-page'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {commishTab === 'overview' && (<>
      {/* Premium Bento Overview Dashboard */}
      <NFLManagerBentoDashboard
        pool={pool}
        entries={entries}
        members={members}
        games={games}
        week={week}
        user={user}
        pickCounts={pickCounts}
        onSelectTab={onSelectTab}
        onOpenLedger={() => setCommishTab('members')}
      />

      {/* Record Payouts card (ADR 0005 Phase 4) folded into the Payment Ledger on
          Members & Payments (PLAN-PAYMENT-LEDGER T7 / ADR 0008): season prizes are
          published rows there, bonuses/adjustments its "Other awards" block. */}

      {/* Control Room Header */}
      <div className="bg-card border border-line shadow-card rounded-xl p-6 relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryAccent }}
        />
        <div className="flex gap-4 items-center">
          <div className="p-3 bg-navy-800 text-white rounded-lg">
            <Settings size={22} />
          </div>
          <div>
            <h3 className="font-display font-bold uppercase text-lg text-[color:var(--text)]">Commissioner Control Room</h3>
            <p className="font-body text-muted text-xs mt-1">
              Pool host with write capabilities: score weeks, update payment statuses, and configure pool rules.
            </p>
          </div>
        </div>
      </div>

      </>)}

      {commishTab === 'settings' && (<>
      {/* ═══════════════════════════════════════════
           SECTION: POOL SETTINGS EDITOR
      ═══════════════════════════════════════════ */}
      <div className="bg-card border border-line shadow-card rounded-xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-line flex justify-between items-center bg-surface">
          <div className="flex items-center gap-2">
            <Edit3 size={14} className="text-navy-700 dark:text-gold-400" />
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Pool Rules & Settings Editor</h4>
          </div>

          {/* Access badge */}
          {isSuperAdmin ? (
            <div className="flex items-center gap-1.5 bg-navy-800 rounded-full px-3 py-1">
              <ShieldCheck size={11} className="text-white" />
              <span className="font-display font-bold uppercase text-[10px] text-white tracking-[0.08em]">Super Admin — Full Access</span>
            </div>
          ) : isPreSeason ? (
            <div className="flex items-center gap-1.5 bg-[#E4F5EC] border border-[#BEE7D0] rounded-full px-3 py-1">
              <Unlock size={11} className="text-[#0F7B4A]" />
              <span className="font-display font-bold uppercase text-[10px] text-[#0F7B4A] tracking-[0.08em]">Pre-Season — Editable</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-gold-400/10 border border-gold-500/40 rounded-full px-3 py-1">
              <Lock size={11} className="text-gold-600 dark:text-gold-400" />
              <span className="font-display font-bold uppercase text-[10px] text-gold-600 dark:text-gold-400 tracking-[0.08em]">Season Active — Locked</span>
            </div>
          )}
        </div>

        {/* Locked notice for regular managers in-season */}
        {!canEditSettings && (
          <div className="mx-6 mt-5 bg-gold-400/10 border border-gold-500/40 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-gold-600 dark:text-gold-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-display font-bold uppercase text-gold-600 dark:text-gold-400 text-xs tracking-[0.05em]">Settings Locked During Active Season</p>
              <p className="font-body text-muted text-[11px] mt-0.5 leading-relaxed">
                Pool rules cannot be modified once the season has started. Contact your platform Super Admin to make changes if needed.
              </p>
            </div>
          </div>
        )}

        <div className={`p-6 space-y-6 ${!canEditSettings ? 'opacity-40 pointer-events-none select-none' : ''}`}>

          {/* Settings Feedback */}
          {settingsFeedback && (
            <div className={`p-3.5 rounded-lg font-body text-xs font-bold flex gap-2 items-center ${
              settingsFeedback.type === 'success'
                ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                : 'bg-brandred-600/10 border border-brandred-600/25 text-brandred-600'
            }`}>
              {settingsFeedback.type === 'success' ? <CheckCircle size={15} /> : <XCircle size={15} />}
              {settingsFeedback.message}
            </div>
          )}

          {/* ── General Settings ── */}
          <div className="space-y-4">
            <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">General</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel tone="muted" helpId="name">Pool Name</FieldLabel>
                <input
                  type="text"
                  value={poolName}
                  onChange={e => setPoolName(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                />
              </div>
              <div>
                <FieldLabel tone="muted" helpId="settings.entryFee">Entry Fee ($)</FieldLabel>
                <input
                  type="number"
                  value={entryFee}
                  min={0}
                  onChange={e => setEntryFee(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                />
              </div>
              {(MULTI_ENTRY_WIZARD_ENABLED || currentMaxEntries > 1) && (
              <div>
                <FieldLabel tone="muted" helpId="settings.maxEntriesPerUser">Entries per Player</FieldLabel>
                <input
                  type="number"
                  value={maxEntriesPerUser}
                  min={currentMaxEntries}
                  max={MAX_ENTRIES_PER_USER_CAP}
                  onChange={e => setMaxEntriesPerUser(Math.min(MAX_ENTRIES_PER_USER_CAP, Math.max(currentMaxEntries, parseInt(e.target.value) || currentMaxEntries)))}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                />
                <p className="font-body text-[10px] text-faint mt-1">
                  {currentMaxEntries > 1 ? `Currently ${currentMaxEntries}. ` : ''}Each entry pays the entry fee and competes on its own. Can be raised while the pool is open, never lowered.
                </p>
              </div>
              )}
            </div>

            <div>
              <FieldLabel tone="muted" helpId="paymentInstructions">Payment Instructions</FieldLabel>
              <textarea
                value={paymentInstructions}
                onChange={e => setPaymentInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Venmo @your-handle — include your name in the note."
                className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all resize-none"
              />
            </div>

            <div className="flex items-center justify-between bg-page border border-line rounded-md px-4 py-3">
              <div>
                <p className="font-display font-bold uppercase text-xs tracking-[0.05em] text-[color:var(--text)]">List Pool Publicly</p>
                <p className="font-body text-[10px] text-faint">Allow others to find this pool via the public browser</p>
              </div>
              <input
                type="checkbox"
                checked={isListedPublic}
                onChange={e => setIsListedPublic(e.target.checked)}
                className="w-5 h-5 rounded border-line text-navy-700 focus:ring-navy-600 dark:focus:ring-gold-500 cursor-pointer"
              />
            </div>

            {/* Host Profile & Contact Links */}
            <div className="space-y-4 pt-4 border-t border-line">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Host Profile & Contact Links</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <FieldLabel tone="muted" helpId="managerName">Host Name</FieldLabel>
                  <input
                    type="text"
                    value={editManagerName}
                    onChange={e => setEditManagerName(e.target.value)}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all animate-none"
                    placeholder="Host Display Name"
                  />
                </div>
                <div>
                  <FieldLabel tone="muted" helpId="contactEmail">Contact Email</FieldLabel>
                  <input
                    type="email"
                    value={editContactEmail}
                    onChange={e => setEditContactEmail(e.target.value)}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all animate-none"
                    placeholder="host@example.com"
                  />
                </div>
                <div>
                  <FieldLabel tone="muted" helpId="contactPhone">Contact Phone</FieldLabel>
                  <input
                    type="text"
                    value={editContactPhone}
                    onChange={e => setEditContactPhone(e.target.value)}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all animate-none"
                    placeholder="+1 (555) 0199"
                  />
                </div>
              </div>

              <div>
                <FieldLabel tone="muted" helpId="contactMethod">Contact Link Options</FieldLabel>
                <select
                  value={editContactMethod}
                  onChange={e => setEditContactMethod(e.target.value as any)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all cursor-pointer"
                >
                  <option value="email">Email Link Only</option>
                  <option value="phone">Phone Link Only</option>
                  <option value="both">Both Email & Phone Links</option>
                  <option value="none">Do Not Display Contact Links</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Pick'em Rules ── */}
          {type === 'NFL_PICKEM' && (
            <div className="space-y-4">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">Pick'em Rules</p>

              {/* Confidence Mode */}
              <div className="flex items-center justify-between bg-page border border-line rounded-md px-4 py-3">
                <div>
                  <p className="font-display font-bold uppercase text-xs tracking-[0.05em] text-[color:var(--text)]">Confidence Mode</p>
                  <p className="font-body text-[10px] text-faint">Players rank games 1–N; highest rank earns most points</p>
                </div>
                <input
                  type="checkbox"
                  checked={confidenceMode}
                  onChange={e => setConfidenceMode(e.target.checked)}
                  className="w-5 h-5 rounded border-line text-navy-700 focus:ring-navy-600 dark:focus:ring-gold-500 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel tone="muted" helpId="settings.lockMode">Lock Mode</FieldLabel>
                  <select
                    value={lockMode}
                    disabled={confidenceMode}
                    onChange={e => setLockMode(e.target.value as 'PER_GAME' | 'WEEKLY')}
                    className={`w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all ${confidenceMode ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <option value="PER_GAME">Per-Game (each game locks at kickoff)</option>
                    <option value="WEEKLY">Weekly (all locks at first kickoff)</option>
                  </select>
                  {confidenceMode && <p className="font-body text-[10px] text-gold-600 dark:text-gold-400 font-bold mt-1">* Forced Weekly in Confidence Mode</p>}
                </div>

                <div>
                  <FieldLabel tone="muted" helpId="settings.lockBufferMinutes">Lock Buffer</FieldLabel>
                  <select
                    value={lockBufferMinutes}
                    onChange={e => setLockBufferMinutes(parseInt(e.target.value))}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  >
                    <option value={0}>0 min (exactly at kickoff)</option>
                    <option value={5}>5 min grace (recommended)</option>
                    <option value={10}>10 min grace</option>
                  </select>
                </div>
              </div>

              <div>
                <FieldLabel tone="muted">Payout Method</FieldLabel>
                <select
                  value={payoutMode}
                  onChange={e => {
                    setPayoutMode(e.target.value);
                    // Leaving HYBRID forgets the split locally, matching the
                    // server's delete — otherwise re-selecting HYBRID later
                    // silently resurrects the old numbers on the next save.
                    // (codex r3.)
                    if (e.target.value !== 'HYBRID') { setSplitDeclared(false); setSplitWeekly(0); setSplitSeason(0); }
                    // The weekly place list follows the split exactly — the server
                    // deletes it on the way out of HYBRID (PLAN-PAYMENT-LEDGER T2 / D1).
                    if (e.target.value !== 'HYBRID') { setWeeklyPlacesTouched(false); setWeeklyPlaces([]); }
                    // Returning to HYBRID re-hydrates from the STORED split, so
                    // the editor shows what the pool actually has rather than an
                    // undeclared 0/0 sitting on top of live stored numbers — the
                    // toggle-away-and-back sequence otherwise saves HYBRID with
                    // no split while the old one persists server-side. (codex r6.)
                    if (e.target.value === 'HYBRID' && lastKnownSplitRef.current) {
                      setSplitWeekly(lastKnownSplitRef.current.weeklyPerEntry ?? 0);
                      setSplitSeason(lastKnownSplitRef.current.seasonPerEntry ?? 0);
                      setSplitDeclared(true);
                    }
                    if (e.target.value === 'HYBRID' && lastKnownWeeklyPlacesRef.current) {
                      // Re-hydrating is NOT editing (codex r8). Marking it
                      // touched made a bare toggle away-and-back eligible to
                      // re-send this list, so a weekly list another session
                      // saved after this page loaded would be overwritten by a
                      // later unrelated save here. The stored list survives an
                      // omitted key, and only a HYBRID-EXIT save deletes it —
                      // which nulls the ref, so this branch never runs against
                      // a list the server no longer has.
                      setWeeklyPlaces(lastKnownWeeklyPlacesRef.current);
                    }
                  }}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Standings Only</option>
                  <option value="WEEKLY">Weekly Winner Only</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly Prizes)</option>
                </select>
              </div>

              <HybridExitNotice storedMode={storedPayoutMode} selectedMode={payoutMode} hasWeeklyList={!!settings.weeklyPayouts?.places?.length} />

              {payoutMode === 'HYBRID' && (
                <div className="bg-page border border-line rounded-lg p-4 space-y-3">
                  <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Hybrid Entry-Fee Split</p>
                  <p className="text-[11px] font-body text-muted leading-normal">
                    Whole dollars per entry into each pot — the two must add up to the entry fee exactly. Each pot gets its own prize places below.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel tone="muted">Weekly pots ($/entry)</FieldLabel>
                      <input type="number" min={0} value={splitWeekly}
                        onChange={e => { setSplitDeclared(true); setSplitWeekly(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                    <div>
                      <FieldLabel tone="muted">Season pot ($/entry)</FieldLabel>
                      <input type="number" min={0} value={splitSeason}
                        onChange={e => { setSplitDeclared(true); setSplitSeason(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                  </div>
                  {/* The same check the server enforces — a friendlier local
                      phrasing would eventually disagree with the refusal. */}
                  {splitDeclared && (() => {
                    const problem = hybridSplitProblem({ payoutMode: 'HYBRID', entryFee: Number(entryFee), hybridSplit: { weeklyPerEntry: splitWeekly, seasonPerEntry: splitSeason } });
                    return problem
                      ? <p role="alert" className="text-[11px] font-body font-bold text-brandred-600">✗ {problem.split(': ').slice(1).join(': ')}</p>
                      : <p role="status" className="text-[11px] font-body font-bold text-[#0F7B4A]">✓ ${splitWeekly} weekly + ${splitSeason} season = ${Number(entryFee)} entry fee</p>;
                  })()}
                </div>
              )}

              {payoutMode === 'HYBRID' && (
                <WeeklyPlacesEditor
                  places={weeklyPlaces}
                  onChange={next => { setWeeklyPlacesTouched(true); setWeeklyPlaces(next); }}
                />
              )}

              <div>
                <FieldLabel tone="muted" helpId="settings.weeklyTiebreaker">Weekly Tie-Breaker</FieldLabel>
                <select
                  value={weeklyTiebreaker}
                  onChange={e => setWeeklyTiebreaker(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  {/* MNF_COMBINED is LEGACY (PLAN-WEEKLY-PRIZES §0/D1): not
                      offered, still honoured. A pool already on it must still
                      SEE its own value here — otherwise the select would show
                      the first option and an untouched save would be a change. */}
                  {weeklyTiebreaker === 'MNF_COMBINED' && (
                    <option value="MNF_COMBINED">Monday night — combined score of ALL Monday games (legacy — this pool's current rule)</option>
                  )}
                  {WEEKLY_TIEBREAKER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {/* The server refuses the change once anyone has submitted, and
                    it refuses it in a transaction that also reads the entries —
                    so this is the honest warning, not the enforcement. Saying
                    nothing here would let a commissioner discover the rule from
                    an error toast. */}
                <p className="mt-1.5 text-[11px] font-body text-muted leading-normal">
                  Breaks a tie when two players score the same in a week. <strong>Locked once anybody submits picks</strong> — after that the number players already entered was an answer to the old question.
                </p>
              </div>

            </div>
          )}

          {/* ── Survivor Rules ── */}
          {(type === 'NFL_SURVIVOR' || type === 'NFL_MARGIN') && (
            <div className="space-y-4">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">Pick Deadline</p>
              <div>
                <FieldLabel tone="muted" helpId="settings.lockBufferMinutes">Weekly Deadline</FieldLabel>
                <select
                  value={lockBufferMinutes}
                  onChange={e => setLockBufferMinutes(parseInt(e.target.value))}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value={60}>1 hour before the first kickoff</option>
                  <option value={30}>30 minutes before the first kickoff</option>
                  <option value={5}>5 minutes before the first kickoff</option>
                </select>
                <p className="font-body text-[10px] text-faint mt-1">
                  All picks for the week lock at this deadline — before any game starts — and cannot be changed afterward.
                </p>
              </div>
            </div>
          )}

          {type === 'NFL_SURVIVOR' && (
            <div className="space-y-4">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">Survivor Rules</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel tone="muted">Strikes Limit</FieldLabel>
                  <select
                    value={maxStrikes}
                    onChange={e => setMaxStrikes(parseInt(e.target.value))}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  >
                    <option value={0}>0 — Sudden Death</option>
                    <option value={1}>1 — Double Elimination</option>
                    <option value={2}>2 — Triple Elimination</option>
                  </select>
                </div>
                <div>
                  <FieldLabel tone="muted">Max Rebuys</FieldLabel>
                  <select
                    value={maxRebuys}
                    onChange={e => setMaxRebuys(parseInt(e.target.value))}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  >
                    <option value={0}>None</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              </div>

              {maxRebuys > 0 && (
                <div className="grid grid-cols-2 gap-4 bg-page p-4 border border-line rounded-lg">
                  <div>
                    <FieldLabel tone="muted">Rebuy Cutoff Week</FieldLabel>
                    <input
                      type="number"
                      value={rebuyDeadlineWeek}
                      min={1}
                      max={18}
                      onChange={e => setRebuyDeadlineWeek(Math.max(1, Math.min(18, parseInt(e.target.value) || 1)))}
                      className="w-full font-body bg-page border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                    />
                  </div>
                  <div>
                    <FieldLabel tone="muted">Rebuy Fee ($)</FieldLabel>
                    <input
                      type="number"
                      value={rebuyCost}
                      min={0}
                      onChange={e => setRebuyCost(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full font-body bg-page border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel tone="muted">Tie Outcome</FieldLabel>
                  <select
                    value={tieCountsAs}
                    onChange={e => setTieCountsAs(e.target.value === 'WIN' ? 'WIN' : 'LOSS')}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  >
                    <option value="LOSS">Tie counts as a loss (strike)</option>
                    <option value="WIN">Tie counts as a win for the picked team</option>
                  </select>
                  <p className="font-body text-[10px] text-faint mt-1">Cannot be changed once a week has been scored.</p>
                </div>
                <div>
                  <FieldLabel tone="muted">Team-Use Limit</FieldLabel>
                  <input
                    type="number"
                    value={maxTeamUses}
                    min={0}
                    max={23}
                    onChange={e => setMaxTeamUses(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                    className="w-full font-body bg-page border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  />
                  <p className="font-body text-[10px] text-faint mt-1">How many weeks a team may be picked. 0 = unlimited.</p>
                </div>
              </div>

              <div className="flex items-center justify-between bg-page border border-line rounded-md px-4 py-3">
                <div>
                  <p className="font-display font-bold uppercase text-xs tracking-[0.05em] text-[color:var(--text)]">Pick-Loser Mode</p>
                  <p className="font-body text-[10px] text-faint">Players pick a team to LOSE instead of win</p>
                </div>
                <input
                  type="checkbox"
                  checked={pickLosersMode}
                  onChange={e => setPickLosersMode(e.target.checked)}
                  className="w-5 h-5 rounded border-line text-navy-700 focus:ring-navy-600 dark:focus:ring-gold-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* ── Margin Rules ── */}
          {type === 'NFL_MARGIN' && (
            <div className="space-y-4">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">Margin Rules</p>
              <div>
                <FieldLabel tone="muted">Payout Method</FieldLabel>
                <select
                  value={marginPayoutMode}
                  onChange={e => {
                    setMarginPayoutMode(e.target.value);
                    if (e.target.value !== 'HYBRID') { setSplitDeclared(false); setSplitWeekly(0); setSplitSeason(0); }
                    if (e.target.value !== 'HYBRID') { setWeeklyPlacesTouched(false); setWeeklyPlaces([]); }
                    // Returning to HYBRID re-hydrates from the STORED split, so
                    // the editor shows what the pool actually has rather than an
                    // undeclared 0/0 sitting on top of live stored numbers — the
                    // toggle-away-and-back sequence otherwise saves HYBRID with
                    // no split while the old one persists server-side. (codex r6.)
                    if (e.target.value === 'HYBRID' && lastKnownSplitRef.current) {
                      setSplitWeekly(lastKnownSplitRef.current.weeklyPerEntry ?? 0);
                      setSplitSeason(lastKnownSplitRef.current.seasonPerEntry ?? 0);
                      setSplitDeclared(true);
                    }
                    if (e.target.value === 'HYBRID' && lastKnownWeeklyPlacesRef.current) {
                      // Re-hydrating is NOT editing (codex r8). Marking it
                      // touched made a bare toggle away-and-back eligible to
                      // re-send this list, so a weekly list another session
                      // saved after this page loaded would be overwritten by a
                      // later unrelated save here. The stored list survives an
                      // omitted key, and only a HYBRID-EXIT save deletes it —
                      // which nulls the ref, so this branch never runs against
                      // a list the server no longer has.
                      setWeeklyPlaces(lastKnownWeeklyPlacesRef.current);
                    }
                  }}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Totals Only</option>
                  <option value="WEEKLY">Weekly Highest Margin Wins</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly)</option>
                </select>
              </div>

              <HybridExitNotice storedMode={storedPayoutMode} selectedMode={marginPayoutMode} hasWeeklyList={!!settings.weeklyPayouts?.places?.length} />

              {/* Same split editor as Pick'em — the wizard can declare a Margin
                  split, so the editor must be able to view and adjust it, or an
                  entryFee change strands the pool against server validation
                  with no UI to fix it. (codex P2 on the split PR.) */}
              {marginPayoutMode === 'HYBRID' && (
                <div className="bg-page border border-line rounded-lg p-4 space-y-3">
                  <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Hybrid Entry-Fee Split</p>
                  <p className="text-[11px] font-body text-muted leading-normal">
                    Whole dollars per entry into each pot — the two must add up to the entry fee exactly.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel tone="muted">Weekly pots ($/entry)</FieldLabel>
                      <input type="number" min={0} value={splitWeekly}
                        onChange={e => { setSplitDeclared(true); setSplitWeekly(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                    <div>
                      <FieldLabel tone="muted">Season pot ($/entry)</FieldLabel>
                      <input type="number" min={0} value={splitSeason}
                        onChange={e => { setSplitDeclared(true); setSplitSeason(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                  </div>
                  {splitDeclared && (() => {
                    const problem = hybridSplitProblem({ payoutMode: 'HYBRID', entryFee: Number(entryFee), hybridSplit: { weeklyPerEntry: splitWeekly, seasonPerEntry: splitSeason } });
                    return problem
                      ? <p role="alert" className="text-[11px] font-body font-bold text-brandred-600">✗ {problem.split(': ').slice(1).join(': ')}</p>
                      : <p role="status" className="text-[11px] font-body font-bold text-[#0F7B4A]">✓ ${splitWeekly} weekly + ${splitSeason} season = ${Number(entryFee)} entry fee</p>;
                  })()}
                </div>
              )}

              {marginPayoutMode === 'HYBRID' && (
                <WeeklyPlacesEditor
                  places={weeklyPlaces}
                  onChange={next => { setWeeklyPlacesTouched(true); setWeeklyPlaces(next); }}
                />
              )}
            </div>
          )}

          {/* ── Save Button ──
              The ONLY one now. It used to be repeated in each section as well,
              because this was one section of a single very long scroll; Settings
              is its own tab, so the foot of the tab is never far away. */}
          <SaveSettingsControl onSave={handleSaveSettings} isSaving={isSavingSettings} justSaved={justSavedAt !== null} />
        </div>
      </div>
      </>)}

      {/* ═══════════════════════════════════════════
           SECTION: WEEKLY SCORING
           Was the left third of a 3-column grid shared with the roster. Each
           owns a tab now, so the grid is gone and both are full width.
      ═══════════════════════════════════════════ */}
      {commishTab === 'scoring' && (
        <div className="space-y-6">
          <div className="bg-card border border-line shadow-card rounded-xl p-6 space-y-5">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
              <Activity size={14} className="text-navy-700 dark:text-gold-400" /> {nflWeekLabel(poolSeasonType(pool), week)} Scoring Feed
            </h4>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                <span className="font-body text-muted font-semibold">Total Matchups:</span>
                <span className="num font-display font-bold text-[color:var(--text)]">{totalGamesCount}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                <span className="font-body text-muted font-semibold">Completed Games:</span>
                <span className={`num font-display font-bold ${isWeekFullyFinal ? 'text-[#0F7B4A]' : 'text-gold-600 dark:text-gold-400'}`}>
                  {finalGamesCount} / {totalGamesCount}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleScoreWeek}
                disabled={isScoring || totalGamesCount === 0}
                className="w-full bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-3.5 px-4 rounded-lg flex items-center justify-center gap-2 shadow-red-cta transition-all duration-150 hover:-translate-y-px cursor-pointer"
              >
                <Play size={14} className={isScoring ? 'animate-spin' : ''} />
                {isScoring ? 'Calculating...' : `Score & Recap ${nflWeekLabel(poolSeasonType(pool), week)}`}
              </button>

              {!isWeekFullyFinal && (
                <p className="font-body text-[10px] text-muted mt-2.5 leading-relaxed text-center">
                  <AlertTriangle size={10} className="inline-block align-[-1px] text-gold-600 dark:text-gold-400" /> <strong>Warning:</strong> Some games are still active. SuperAdmins may override.
                </p>
              )}
            </div>
          </div>
        </div>

      )}

      {/* ═══════════════════════════════════════════
           SECTION: MEMBERS & PAYMENTS
      ═══════════════════════════════════════════ */}
      {commishTab === 'members' && (
        <div className="space-y-6">
          {/* The payment LEDGER (PLAN-PAYMENT-LEDGER T5): fee status per member +
              every published weekly prize with its "paid" checkbox. Lives on
              the Members & Payments sub-tab — where a commissioner looks for
              money (Kevin, 2026-08-16). */}
          <PaymentLedgerNFL pool={pool} members={members} entries={entries} onTogglePaid={handleTogglePayment} onSettleRebuys={handleSettleRebuys} onSavePaidDetails={handleSavePaidDetails} savingFeeUid={isSavingPayment} />
          <div className="bg-card border border-line shadow-card rounded-xl overflow-hidden">
            <div className="p-5 border-b border-line bg-surface space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
                  <Users size={14} className="text-navy-700 dark:text-gold-400" /> Member Roster
                </h4>
                <span className="num font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted bg-page px-2 py-0.5 border border-line rounded-full">
                  {roster.length} members
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleRemindBulk('PICKS')}
                  disabled={bulkReminding !== null || unpickedCount === 0}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] bg-gold-400/10 border border-gold-500/40 text-gold-600 dark:text-gold-400 hover:bg-gold-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:-translate-y-px cursor-pointer"
                >
                  <BellRing size={12} />
                  {bulkReminding === 'PICKS' ? 'Sending...' : `Remind all unpicked (${unpickedCount})`}
                </button>
                <button
                  onClick={() => handleRemindBulk('PAYMENT')}
                  disabled={bulkReminding !== null || unpaidCount === 0}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] bg-gold-400/10 border border-gold-500/40 text-gold-600 dark:text-gold-400 hover:bg-gold-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:-translate-y-px cursor-pointer"
                >
                  <DollarSign size={12} />
                  {bulkReminding === 'PAYMENT' ? 'Sending...' : `Remind all unpaid (${unpaidCount})`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line bg-page text-muted">
                    <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em]">Name</th>
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Status</th>
                        <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Strikes</th>
                        <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Rebuys</th>
                      </>
                    )}
                    {type === 'NFL_MARGIN' && (
                      <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-right">Margin Score</th>
                    )}
                    <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">{nflWeekChip(poolSeasonType(pool), week)} Picks</th>
                    <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-right w-32">Remind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {roster.map((row) => (
                    <tr key={row.uid} className="hover:bg-page transition-colors">
                      <td className="py-3.5 px-5 font-body font-bold text-[color:var(--text)]">
                        <span>{row.userName}</span>
                        {row.isOwner && <span className="ml-2 align-middle px-1.5 py-0.5 rounded-full text-[8px] font-display font-bold uppercase tracking-[0.08em] bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/30">Commissioner</span>}
                        {!row.isOwner && coManagers.includes(row.uid) && <span className="ml-2 align-middle px-1.5 py-0.5 rounded-full text-[8px] font-display font-bold uppercase tracking-[0.08em] bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/30">Co-Commissioner</span>}
                        {/* Offer the toggle only where the callable can succeed: not the
                            owner, not a distinct managerUid (already a commissioner), and only
                            a row with a Member Record (K6). Removal is always offered for a
                            uid already in the array so a stale one can be cleared. */}
                        {viewerIsOwner && !row.isOwner && row.uid !== pool.managerUid && (row.hasMember || coManagers.includes(row.uid)) && (
                          <button
                            onClick={() => handleToggleCoCommissioner(row.uid)}
                            disabled={savingCoCommissioner === row.uid}
                            title={coManagers.includes(row.uid) ? 'Remove as co-commissioner' : 'Name as co-commissioner (up to 3)'}
                            className="ml-2 align-middle inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-display font-bold uppercase text-[9px] tracking-[0.08em] border border-line text-muted hover:border-gold-500/40 hover:text-gold-700 dark:hover:text-gold-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 cursor-pointer"
                          >
                            <UserCog size={10} />
                            {savingCoCommissioner === row.uid ? 'Saving...' : coManagers.includes(row.uid) ? 'Remove co-comm' : 'Make co-comm'}
                          </button>
                        )}
                        {!row.hasEntry && <span className="ml-2 align-middle px-1.5 py-0.5 rounded-full text-[8px] font-display font-bold uppercase tracking-[0.08em] bg-surface text-faint border border-line">No entry yet</span>}
                      </td>

                      {type === 'NFL_SURVIVOR' && (
                        <>
                          <td className="py-3.5 px-5 text-center">
                            {row.hasEntry ? (
                              <span className={`px-2 py-0.5 rounded-full font-display font-bold text-[9px] tracking-[0.08em] uppercase ${
                                row.status === 'ALIVE'
                                  ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                                  : 'bg-brandred-600/10 border border-brandred-600/25 text-brandred-600'
                              }`}>
                                {row.status ?? 'ALIVE'}
                              </span>
                            ) : <span className="text-faint">—</span>}
                          </td>
                          <td className="num py-3.5 px-5 text-center font-body font-bold text-muted">{row.hasEntry ? (row.strikesUsed ?? 0) : '—'}</td>
                          <td className="num py-3.5 px-5 text-center font-body font-bold text-muted">{row.hasEntry ? (row.rebuysUsed ?? 0) : '—'}</td>
                        </>
                      )}

                      {type === 'NFL_MARGIN' && (
                        <td className="num py-3.5 px-5 text-right font-display font-bold text-[color:var(--text)]">
                          {row.hasEntry ? `${row.seasonTotal ?? 0} pts` : '—'}
                        </td>
                      )}

                      <td className="py-3.5 px-5 text-center">
                        {row.picked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-display font-bold text-[9px] tracking-[0.08em] uppercase bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]">
                            <CheckCircle size={10} /> Picked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-display font-bold text-[9px] tracking-[0.08em] uppercase bg-brandred-600/10 border border-brandred-600/25 text-brandred-600">
                            <XCircle size={10} /> {row.hasEntry ? 'Missing' : 'No picks'}
                          </span>
                        )}
                      </td>

                      {/* Money (fee paid, rebuys) moved to the Payment Ledger above — this
                          card is picks status / remind / co-comm only (Kevin, 2026-08-16). */}
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleRemindOne(row.uid, !row.picked ? 'PICKS' : 'PAYMENT')}
                          disabled={
                            remindingUid !== null ||
                            bulkReminding !== null ||
                            (row.picked && !owesMoney(row))
                          }
                          title={!row.picked ? 'Email a picks reminder' : owesMoney(row) ? 'Email a payment reminder' : 'Picked and settled — nothing to remind'}
                          className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 hover:-translate-y-px cursor-pointer"
                        >
                          <BellRing size={10} />
                          {remindingUid === row.uid ? 'Sending...' : 'Remind'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
           SECTION: POOL BRANDING (T8)
           Its own card and its own save, OUTSIDE `canEditSettings`. That gate
           locks pool RULES once the season starts, and rightly so — but
           branding is not a rule, and the server agrees: `shared/editability.ts`
           lists `branding` in open, locked AND archived. Folding it into the
           gated form would lock a commissioner out of fixing their own logo in
           week 3 for no reason the server asks for.
      ═══════════════════════════════════════════ */}
      {commishTab === 'settings' && <NFLBrandingSettings pool={pool} />}

      {commishTab === 'settings' && (
      /* ═══════════════════════════════════════════
           SECTION: COMMISSIONER EXCEPTIONS
           Sanctioned tools for the messy real-world cases (member in
           hospital, mis-set deadline, dead pool) — every action is
           audited and members are notified.
      ═══════════════════════════════════════════ */
      <div className="bg-card border border-gold-500/40 shadow-card rounded-xl overflow-hidden">
        <button
          onClick={() => setExceptionsOpen(o => !o)}
          className="w-full p-5 flex justify-between items-center bg-surface hover:bg-page transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-gold-600 dark:text-gold-400" />
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Exceptions — Commissioner Tools</h4>
          </div>
          {exceptionsOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
        </button>

        {exceptionsOpen && (
          <div className="p-6 space-y-6 border-t border-line">
            <p className="font-body text-[11px] text-muted leading-relaxed">
              For the rare cases a season throws at you. Every action here is written to the pool audit log
              with your name and reason, and members are emailed — no silent changes.
            </p>

            {/* ── Extend Week Deadline — not available on hard-lock pools ── */}
            {usesWeeklyHardLock(type) ? (
              <div className="bg-page border border-line rounded-lg p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-navy-700 dark:text-gold-400" />
                  <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Week Deadline</p>
                </div>
                <p className="font-body text-[11px] text-faint leading-relaxed">
                  This pool uses a <strong>fixed weekly deadline</strong> before the first kickoff, so a week
                  can't be reopened once it locks — that's what keeps scores honest while games are being
                  played. <strong>Pick Deadline</strong> in Settings controls how early picks close for weeks
                  that haven't locked yet.
                </p>
              </div>
            ) : (
            <div className="bg-page border border-line rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-navy-700 dark:text-gold-400" />
                <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Extend {nflWeekLabel(poolSeasonType(pool), week)} Deadline</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <FieldLabel tone="muted" helpId="nfl.manager.extendDeadline">Extra Minutes (max 1440)</FieldLabel>
                  <input
                    type="number"
                    value={extendMinutes}
                    min={1}
                    max={1440}
                    onChange={e => setExtendMinutes(Math.max(1, Math.min(1440, parseInt(e.target.value) || 1)))}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel tone="muted">Reason (emailed to members)</FieldLabel>
                  <input
                    type="text"
                    value={extendReason}
                    onChange={e => setExtendReason(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Deadline was mis-set — several members were locked out"
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="font-body text-[10px] text-gold-600 dark:text-gold-400 leading-relaxed max-w-md">
                  Note: the extension takes effect immediately for commissioner proxy picks; member
                  self-submitted picks honoring the extension is rolling out separately.
                </p>
                <button
                  onClick={handleExtendDeadline}
                  disabled={isExtending}
                  className="min-h-[44px] bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] px-6 rounded-lg flex items-center gap-2 transition-all duration-150 hover:-translate-y-px cursor-pointer text-xs"
                >
                  <Clock size={13} />
                  {isExtending ? 'Extending...' : 'Extend Deadline'}
                </button>
              </div>
            </div>
            )}

            {/* ── Proxy Pick ── */}
            <div className="bg-page border border-line rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2">
                <UserCog size={14} className="text-navy-700 dark:text-gold-400" />
                <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Enter a Pick for a Member</p>
              </div>
              {proxyBlockedReason ? (
                <p className="font-body text-[11px] text-muted leading-relaxed">
                  {proxyBlockedReason}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <FieldLabel tone="muted" helpId="nfl.manager.proxyPick">{currentMaxEntries > 1 ? 'Entry' : 'Member'}</FieldLabel>
                      <select
                        value={proxyTargetEntryId}
                        onChange={e => setProxyTargetEntryId(e.target.value)}
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all cursor-pointer"
                      >
                        <option value="">{currentMaxEntries > 1 ? 'Select entry...' : 'Select member...'}</option>
                        {entries.map(entry => (
                          <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel tone="muted">Week</FieldLabel>
                      <input
                        type="number"
                        value={proxyWeek}
                        min={1}
                        max={23}
                        onChange={e => setProxyWeek(Math.max(1, Math.min(23, parseInt(e.target.value) || 1)))}
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                      />
                    </div>
                    <div>
                      <FieldLabel tone="muted">Team</FieldLabel>
                      <select
                        value={proxyTeam}
                        onChange={e => setProxyTeam(e.target.value)}
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all cursor-pointer"
                      >
                        <option value="">Select team...</option>
                        {proxyWeekTeams.map(team => (
                          <option key={team} value={team}>{team}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel tone="muted">Reason (audited)</FieldLabel>
                      <input
                        type="text"
                        value={proxyReason}
                        onChange={e => setProxyReason(e.target.value)}
                        maxLength={200}
                        placeholder="e.g. Member in hospital, texted me their pick"
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <p className="font-body text-[10px] text-muted leading-relaxed max-w-md">
                      Proxy picks respect the real deadline — if the week is locked, extend the deadline first.
                      {type === 'NFL_PICKEM'
                        ? ' This records ONE game: the team you choose, in the game it is playing that week. Repeat it for any other game the member needs.'
                        : ' Teams already used by the member this season are rejected.'}
                      {proxyOmitsTiebreaker
                        ? ' It does not record a tie-breaker prediction, so a tied week goes to anyone who made one.'
                        : ''}
                    </p>
                    <button
                      onClick={handleProxyPick}
                      disabled={isProxying}
                      className="min-h-[44px] bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] px-6 rounded-lg flex items-center gap-2 transition-all duration-150 hover:-translate-y-px cursor-pointer text-xs"
                    >
                      <UserCog size={13} />
                      {isProxying ? 'Submitting...' : 'Submit Proxy Pick'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── Cancel Pool ── owner/managerUid/SA ONLY (PLAN-CO-COMMISSIONERS C8/D4):
                `cancelPool` refuses a co-commissioner server-side, so do not walk them
                through two destructive confirmations into a permission error. */}
            {viewerIsOwner && (
            <div className="bg-brandred-600/5 border border-brandred-600/25 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Ban size={14} className="text-brandred-600" />
                <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-brandred-600">Cancel Pool</p>
              </div>
              <p className="font-body text-[11px] text-muted leading-relaxed">
                Marks the pool as canceled and emails every member the reason plus who to contact about dues
                already paid. This cannot be undone from the dashboard.
              </p>
              <div>
                <FieldLabel tone="muted" helpId="nfl.manager.cancelPool">Reason (emailed to members)</FieldLabel>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Not enough members joined to run the season"
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-brandred-500 transition-all"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleCancelPool}
                  disabled={isCanceling}
                  className="min-h-[44px] bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] px-6 rounded-lg flex items-center gap-2 shadow-red-cta transition-all duration-150 hover:-translate-y-px cursor-pointer text-xs"
                >
                  <Ban size={13} />
                  {isCanceling ? 'Canceling...' : 'Cancel Pool...'}
                </button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
};
