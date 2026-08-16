import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Settings, DollarSign, CheckCircle, XCircle, Users, Activity,
  Play, Edit3, Save, Lock, Unlock, AlertTriangle, ShieldCheck, BellRing,
  ChevronDown, ChevronUp, Clock, UserCog, Ban, Trophy, Moon, Star, Zap
} from 'lucide-react';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { isPoolManager, poolCoManagers } from '../../utils/auth';
import { logger } from '../../utils/logger';
import type { Pool, NFLGame, User } from '../../types';
import { NFLManagerBentoDashboard } from './NFLManagerBentoDashboard';
import { RecordPayoutsCard } from './RecordPayoutsCard';
import { useToast } from '../ui/Toast';
import { now as serverNow } from '../../utils/serverClock';
import { gamesForPoolWeek, poolSeasonType } from '../../utils/nflPending';
import { nflWeekLabel, nflWeekChip } from '../../utils/nflWeekLabel';
import { buildPoolRoster, hasCompletePicks, memberOutstanding, duesRates } from '../../utils/poolRoster';
import { usesWeeklyHardLock, normalizeLockBufferMinutes } from '@shared/weeklyHardLock';
import { effectiveWeeklyTiebreaker } from '@shared/nflTiebreaker';
import { hybridSplitProblem } from '@shared/hybridSplit';
import { effectiveMaxTeamUses, effectiveTieCountsAs } from '@shared/survivorReuse';

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

const COMMISH_TABS: { id: CommishTab; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'Submission health, buy-in ledger, payouts' },
  { id: 'members', label: 'Members & Payments', hint: 'Roster, paid status, reminders' },
  { id: 'scoring', label: 'Scoring', hint: 'Score and recap the week' },
  { id: 'settings', label: 'Settings', hint: 'Pool rules, deadlines, exceptions' },
];

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
}

export const NFLManagerView: React.FC<NFLManagerViewProps> = ({
  pool,
  entries,
  members = [],
  games,
  week,
  user,
  pickCounts,
  onSelectTab = () => {}
}) => {
  const toast = useToast();
  // Which commissioner section is showing. The page was ~870 lines of JSX in one
  // scroll, which is why the same Save control had to be repeated five times —
  // the button was simply too far from whatever you had just edited. Splitting it
  // removes the reason those duplicates existed rather than deleting a control
  // people rely on. Local state on purpose: `activeTab` already rides in the URL
  // for the pool page (see AdminRoute's redirect to `?tab=manager`), and adding a
  // second URL-backed tab would give this surface two sources of truth.
  const [commishTab, setCommishTab] = useState<CommishTab>('overview');

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
  // Regular managers can only edit before Week 1 starts (Sep 10, 2026).
  // SuperAdmins can ALWAYS edit.
  const seasonStartMs = new Date('2026-09-10T00:00:00-06:00').getTime();
  const isPreSeason = serverNow() < seasonStartMs;
  const canEditSettings = isSuperAdmin || isPreSeason;

  // ---- Local settings state (initialized from pool) ----
  const [poolName, setPoolName] = useState(pool.name || '');
  const [entryFee, setEntryFee] = useState<number>(settings.entryFee ?? 0);
  const [paymentInstructions, setPaymentInstructions] = useState<string>(settings.paymentInstructions || '');
  const [isListedPublic, setIsListedPublic] = useState<boolean>(settings.isListedPublic ?? false);

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
  const [pointsPerPick, setPointsPerPick] = useState<number>(settings.pointsPerPick ?? 1);
  const [thursdayBonus, setThursdayBonus] = useState<number>(settings.primetimeBonus?.thursday ?? 0);
  const [sundayNightBonus, setSundayNightBonus] = useState<number>(settings.primetimeBonus?.sundayNight ?? 0);
  const [mondayBonus, setMondayBonus] = useState<number>(settings.primetimeBonus?.monday ?? 0);

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
  const [proxyTargetUid, setProxyTargetUid] = useState('');
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
  const targetUidOf = (entry: any): string => entry.ownerUid || entry.id;

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
    } catch (err: any) {
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
      // Build updated settings based on pool type
      let updatedSettings: Record<string, unknown> = {
        entryFee,
        paymentInstructions,
        isListedPublic,
      };

      if (type === 'NFL_PICKEM') {
        const primetimeBonus: Record<string, number> = {};
        if (thursdayBonus > 0) primetimeBonus.thursday = thursdayBonus;
        if (sundayNightBonus > 0) primetimeBonus.sundayNight = sundayNightBonus;
        if (mondayBonus > 0) primetimeBonus.monday = mondayBonus;

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
          weeklyTiebreaker,
          pointsPerPick,
          ...(Object.keys(primetimeBonus).length > 0 ? { primetimeBonus } : { primetimeBonus: null }),
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

  const handleProxyPick = async () => {
    if (!proxyTargetUid) {
      toast.error('Select a member to pick for.');
      return;
    }
    if (!proxyTeam) {
      toast.error('Select a team.');
      return;
    }
    if (!reasonIsValid(proxyReason)) {
      toast.error('Please provide a reason (3–200 characters).');
      return;
    }
    const targetEntry = entries.find(e => targetUidOf(e) === proxyTargetUid);
    const ok = await toast.confirm({
      title: 'Submit pick on their behalf?',
      message: `${nflWeekLabel(poolSeasonType(pool), Number(proxyWeek))}: ${proxyTeam} for ${targetEntry?.userName || 'this member'}. This is recorded in the pool audit log with your name and reason.`,
      confirmLabel: 'Submit Proxy Pick'
    });
    if (!ok) return;
    setIsProxying(true);
    try {
      await dbService.proxyPick(pool.id, proxyWeek, proxyTargetUid, { [proxyWeek]: proxyTeam }, proxyReason.trim());
      toast.success(`Proxy pick saved: ${proxyTeam} (${nflWeekLabel(poolSeasonType(pool), Number(proxyWeek))}) for ${targetEntry?.userName || 'member'}.`);
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

  // Teams playing in the proxy target week (for survivor/margin proxy picks)
  const proxyWeekTeams = useMemo(() => {
    const teams = new Set<string>();
    gamesForPoolWeek(games, castPool, proxyWeek).forEach(g => {
      if (g.homeTeam?.abbreviation) teams.add(g.homeTeam.abbreviation);
      if (g.awayTeam?.abbreviation) teams.add(g.awayTeam.abbreviation);
    });
    return [...teams].sort();
  }, [games, castPool, proxyWeek]);

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-6xl mx-auto space-y-8">

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
            title={t.hint}
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
      />

      {/* Record Payouts (ADR 0005 Phase 4) — renders only once the pool is finalized */}
      <RecordPayoutsCard pool={pool} entries={entries} />

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
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Pool Name</label>
                <input
                  type="text"
                  value={poolName}
                  onChange={e => setPoolName(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                />
              </div>
              <div>
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Entry Fee ($)</label>
                <input
                  type="number"
                  value={entryFee}
                  min={0}
                  onChange={e => setEntryFee(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Payment Instructions</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Host Name</label>
                  <input
                    type="text"
                    value={editManagerName}
                    onChange={e => setEditManagerName(e.target.value)}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all animate-none"
                    placeholder="Host Display Name"
                  />
                </div>
                <div>
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Contact Email</label>
                  <input
                    type="email"
                    value={editContactEmail}
                    onChange={e => setEditContactEmail(e.target.value)}
                    className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all animate-none"
                    placeholder="host@example.com"
                  />
                </div>
                <div>
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Contact Phone</label>
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
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Contact Link Options</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Lock Mode</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Lock Buffer</label>
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
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Payout Method</label>
                <select
                  value={payoutMode}
                  onChange={e => {
                    setPayoutMode(e.target.value);
                    // Leaving HYBRID forgets the split locally, matching the
                    // server's delete — otherwise re-selecting HYBRID later
                    // silently resurrects the old numbers on the next save.
                    // (codex r3.)
                    if (e.target.value !== 'HYBRID') { setSplitDeclared(false); setSplitWeekly(0); setSplitSeason(0); }
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
                  }}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Standings Only</option>
                  <option value="WEEKLY">Weekly Winner Only</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly Prizes)</option>
                </select>
              </div>

              {payoutMode === 'HYBRID' && (
                <div className="bg-page border border-line rounded-lg p-4 space-y-3">
                  <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Hybrid Entry-Fee Split</p>
                  <p className="text-[11px] font-body text-muted leading-normal">
                    Whole dollars per entry into each pot — the two must add up to the entry fee exactly. The payout percentages apply to both pots.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted mb-1">Weekly pots ($/entry)</label>
                      <input type="number" min={0} value={splitWeekly}
                        onChange={e => { setSplitDeclared(true); setSplitWeekly(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                    <div>
                      <label className="block font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted mb-1">Season pot ($/entry)</label>
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

              <div>
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Weekly Tie-Breaker</label>
                <select
                  value={weeklyTiebreaker}
                  onChange={e => setWeeklyTiebreaker(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="MNF_COMBINED">Monday night — combined score of ALL Monday games</option>
                  <option value="MNF_LAST_GAME">Monday night — combined score of the LAST Monday game</option>
                  <option value="NONE">None — tied weeks are shared</option>
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

              {/* Scoring Configuration */}
              <div className="bg-page border border-line rounded-lg p-5 space-y-5">
                <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-1.5">
                  <Trophy size={12} className="text-gold-600 dark:text-gold-400" /> Scoring Configuration
                </p>

                <div>
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1">Base Points Per Correct Pick</label>
                  <p className="font-body text-[11px] text-faint mb-2">Default is 1. Increase to reward all correct picks more.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={pointsPerPick}
                      min={1}
                      max={10}
                      onChange={e => setPointsPerPick(Math.max(1, parseInt(e.target.value) || 1))}
                      className="num w-24 font-body bg-page border border-line rounded-md px-4 py-2 text-[color:var(--text)] font-bold text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                    />
                    <span className="font-body text-muted text-xs font-bold">point(s) per correct pick</span>
                  </div>
                </div>

                <div>
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1">Primetime Game Bonus Points</label>
                  <p className="font-body text-[11px] text-faint mb-3">Flat bonus added on top of the base score for correct primetime picks. Set 0 to disable.</p>
                  <div className="space-y-2.5">
                    {[
                      { label: 'Thursday Night Game (TNF)', icon: Moon, value: thursdayBonus, setter: setThursdayBonus },
                      { label: 'Sunday Night Game (SNF)', icon: Star, value: sundayNightBonus, setter: setSundayNightBonus },
                      { label: 'Monday Night Game (MNF)', icon: Zap, value: mondayBonus, setter: setMondayBonus },
                    ].map(({ label, icon: RowIcon, value, setter }) => (
                      <div key={label} className="flex items-center justify-between bg-card border border-line rounded-md px-4 py-2.5">
                        <span className="font-body text-[color:var(--text)] text-xs font-bold inline-flex items-center gap-1.5">
                          <RowIcon size={12} className="text-gold-600 dark:text-gold-400" /> {label}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={value}
                            min={0}
                            max={10}
                            onChange={e => setter(Math.max(0, parseInt(e.target.value) || 0))}
                            className="num w-16 font-body bg-page border border-line rounded-md px-3 py-1.5 text-[color:var(--text)] text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                          />
                          <span className="num font-body text-faint text-[11px] w-20 text-right">{value > 0 ? `+${value} bonus pts` : 'disabled'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Survivor Rules ── */}
          {(type === 'NFL_SURVIVOR' || type === 'NFL_MARGIN') && (
            <div className="space-y-4">
              <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line pb-2">Pick Deadline</p>
              <div>
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Weekly Deadline</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Strikes Limit</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Max Rebuys</label>
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
                    <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Rebuy Cutoff Week</label>
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
                    <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Rebuy Fee ($)</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Tie Outcome</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Team-Use Limit</label>
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
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Payout Method</label>
                <select
                  value={marginPayoutMode}
                  onChange={e => {
                    setMarginPayoutMode(e.target.value);
                    if (e.target.value !== 'HYBRID') { setSplitDeclared(false); setSplitWeekly(0); setSplitSeason(0); }
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
                  }}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Totals Only</option>
                  <option value="WEEKLY">Weekly Highest Margin Wins</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly)</option>
                </select>
              </div>

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
                      <label className="block font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted mb-1">Weekly pots ($/entry)</label>
                      <input type="number" min={0} value={splitWeekly}
                        onChange={e => { setSplitDeclared(true); setSplitWeekly(Math.max(0, Math.floor(Number(e.target.value) || 0))); }}
                        className="w-full font-body bg-card border border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm num" />
                    </div>
                    <div>
                      <label className="block font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted mb-1">Season pot ($/entry)</label>
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
          <div className="bg-card border border-line shadow-card rounded-xl overflow-hidden">
            <div className="p-5 border-b border-line bg-surface space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
                  <Users size={14} className="text-navy-700 dark:text-gold-400" /> Member Roster & Payments
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
                    <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-right w-36">Payment</th>
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
                        {viewerIsOwner && !row.isOwner && (
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

                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleTogglePayment(row.uid, row.paidStatus)}
                          disabled={isSavingPayment === row.uid}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-150 hover:-translate-y-px cursor-pointer ${
                            row.paidStatus === 'PAID'
                              ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                              : 'bg-brandred-600/10 border border-brandred-600/25 text-brandred-600 hover:bg-brandred-600/[0.15]'
                          }`}
                        >
                          <DollarSign size={10} />
                          {isSavingPayment === row.uid ? 'Saving...' : row.paidStatus || 'UNPAID'}
                        </button>
                        {(() => {
                          // Rebuy dues are a SEPARATE settlement from base dues
                          // (P3, Q2 option B) — the member was told "$X due to
                          // the commissioner" at rebuy time, and this is where
                          // the commissioner records collecting it. Legacy
                          // members (rebuy pre-dates the 2026-07-08 rebuyOwed
                          // writer) derive the debt from the entry's rebuysUsed
                          // — the server stamps it properly on settle.
                          const owed = typeof row.rebuyOwed === 'number'
                            ? row.rebuyOwed
                            : (row.rebuysUsed ?? 0) * rebuyCost;
                          // The callable requires a Member Record (it throws
                          // "not on this pool's roster") — offering the button
                          // to a record-less row is an action that can never
                          // succeed (codex r4). The backfill creates the record.
                          if (!(owed > 0) || !row.hasMember) return null;
                          const settled = (row.rebuyPaid ?? 0) >= owed;
                          // The label shows what REMAINS to collect (codex r5):
                          // after settling $20 and a fresh $20 rebuy, owed 40 /
                          // paid 20 means $20 outstanding — and that is the
                          // delta the callable will record.
                          const outstanding = Math.max(0, owed - (row.rebuyPaid ?? 0));
                          return (
                            <button
                              onClick={() => handleSettleRebuys(row.uid, !settled)}
                              disabled={isSavingPayment === row.uid}
                              title={settled ? 'Rebuy dues settled — click to reverse' : 'Click when the rebuy money is collected'}
                              className={`mt-1.5 block ml-auto px-3 py-1 rounded-md font-display font-bold uppercase text-[9px] tracking-[0.08em] transition-all duration-150 hover:-translate-y-px cursor-pointer ${
                                settled
                                  ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                                  : 'bg-gold-500/15 border border-gold-500/30 text-gold-700 dark:text-gold-400 hover:bg-gold-500/25'
                              }`}
                            >
                              {settled ? `Rebuys $${owed} settled` : `Rebuys $${outstanding} owed`}
                            </button>
                          );
                        })()}
                      </td>

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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Extra Minutes (max 1440)</label>
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
                  <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Reason (emailed to members)</label>
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
              {type === 'NFL_PICKEM' ? (
                <p className="font-body text-[11px] text-muted leading-relaxed">
                  Pick'em proxy entry isn't available in the dashboard yet (a full week of game-by-game picks
                  is too error-prone to enter here). Survivor and Margin pools can proxy below; for pick'em,
                  contact support.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Member</label>
                      <select
                        value={proxyTargetUid}
                        onChange={e => setProxyTargetUid(e.target.value)}
                        className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all cursor-pointer"
                      >
                        <option value="">Select member...</option>
                        {entries.map(entry => (
                          <option key={entry.id} value={targetUidOf(entry)}>{entry.userName || entry.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Week</label>
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
                      <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Team</label>
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
                      <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Reason (audited)</label>
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
                      Teams already used by the member this season are rejected.
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

            {/* ── Cancel Pool ── */}
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
                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1.5">Reason (emailed to members)</label>
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
          </div>
        )}
      </div>
      )}
    </div>
  );
};
