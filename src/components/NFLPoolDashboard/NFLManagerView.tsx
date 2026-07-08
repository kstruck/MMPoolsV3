import React, { useState, useMemo, useEffect } from 'react';
import {
  Settings, DollarSign, CheckCircle, XCircle, Users, Activity,
  Play, Edit3, Save, Lock, Unlock, AlertTriangle, ShieldCheck, BellRing,
  ChevronDown, ChevronUp, Clock, UserCog, Ban, Trophy, Moon, Star, Zap
} from 'lucide-react';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { logger } from '../../utils/logger';
import type { Pool, NFLGame, User } from '../../types';
import { NFLManagerBentoDashboard } from './NFLManagerBentoDashboard';
import { useToast } from '../ui/Toast';
import { now as serverNow } from '../../utils/serverClock';

interface NFLManagerViewProps {
  pool: Pool;
  entries: any[];
  members?: any[];
  games: NFLGame[];
  week: number;
  user: User | null;
  onSelectTab?: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
}

export const NFLManagerView: React.FC<NFLManagerViewProps> = ({
  pool,
  entries,
  members = [],
  games,
  week,
  user,
  onSelectTab = () => {}
}) => {
  const toast = useToast();
  const [isScoring, setIsScoring] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState<string | null>(null);
  const [remindingUid, setRemindingUid] = useState<string | null>(null);
  const [bulkReminding, setBulkReminding] = useState<'PICKS' | 'PAYMENT' | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
  const [lockBufferMinutes, setLockBufferMinutes] = useState<number>(settings.lockBufferMinutes ?? 5);
  const [payoutMode, setPayoutMode] = useState<string>(settings.payoutMode ?? 'SEASON');
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
  const weeklyGames = useMemo(() => games.filter(g => g.week === week), [games, week]);
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
    const byUid = new Map<string, any>();
    const put = (uid: string, patch: any) => {
      if (!uid || uid === 'guest') return;
      byUid.set(uid, { ...(byUid.get(uid) || { uid }), ...patch, uid });
    };
    for (const uid of ((pool as any).participantIds || [])) put(uid, {});
    for (const m of members) put(m.uid, { userName: m.userName, memberPaid: m.paidStatus, hasMember: true, rebuyOwed: m.rebuyOwed });
    for (const e of entries) {
      const uid = e.ownerUid || e.id;
      put(uid, { entry: e, hasEntry: true, entryPaid: e.paidStatus, userName: byUid.get(uid)?.userName || e.userName, status: e.status, strikesUsed: e.strikesUsed, rebuysUsed: e.rebuysUsed, seasonTotal: e.seasonTotal });
    }
    const ownerId = (pool as any).ownerId;
    const rows = [...byUid.values()].map(r => {
      const picks = r.entry?.picks || {};
      const picked = !!r.hasEntry && (type === 'NFL_PICKEM'
        ? (weeklyGames.length > 0 && weeklyGames.every(g => !!picks[g.id]))
        : !!picks[week]);
      const userName = r.userName || (r.uid === user?.id ? (user?.name || 'You') : 'Member');
      const paidStatus = r.hasMember ? (r.memberPaid || 'UNPAID') : (r.entryPaid || 'UNPAID');
      return { ...r, userName, paidStatus, picked, isOwner: r.uid === ownerId };
    });
    return rows.sort((a, b) => (a.isOwner ? -1 : b.isOwner ? 1 : a.userName.localeCompare(b.userName)));
  }, [members, entries, pool, weeklyGames, week, type, user]);

  const unpickedCount = useMemo(() => roster.filter(r => !r.picked).length, [roster]);
  const unpaidCount = useMemo(() => roster.filter(r => r.paidStatus !== 'PAID').length, [roster]);

  // --- Handlers ---
  const handleRemindOne = async (uid: string, kind: 'PICKS' | 'PAYMENT') => {
    setRemindingUid(uid);
    try {
      const { sent, skipped } = await dbService.sendManualReminder(pool.id, [uid], kind);
      toast.success(`Sent ${sent} reminder(s), ${skipped} skipped (recently reminded)`);
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
      : roster.filter(r => r.paidStatus !== 'PAID')
    ).map(r => r.uid);
    if (targets.length === 0) {
      toast.info(kind === 'PICKS' ? 'Everyone has picked this week.' : 'Everyone has paid.');
      return;
    }
    setBulkReminding(kind);
    try {
      const { sent, skipped } = await dbService.sendManualReminder(pool.id, targets, kind);
      toast.success(`Sent ${sent} reminder(s), ${skipped} skipped (recently reminded)`);
    } catch (err) {
      logger.error('Failed to send bulk reminders:', err);
      toast.error(getUserMessage(err));
    } finally {
      setBulkReminding(null);
    }
  };

  const handleScoreWeek = async () => {
    const ok = await toast.confirm({
      title: `Score Week ${week}?`,
      message: 'This will lock results and generate a recap.',
      confirmLabel: 'Score Week',
      danger: true
    });
    if (!ok) return;
    setIsScoring(true);
    setFeedback(null);
    try {
      const res = await dbService.scoreNFLWeek(pool.id, week);
      setFeedback({ type: 'success', message: res.message || `Week ${week} scored and locked!` });
    } catch (err: any) {
      logger.error(`Failed to score week ${week}:`, err);
      setFeedback({ type: 'error', message: err.message || 'Scoring failed. Ensure all games are final.' });
    } finally {
      setIsScoring(false);
    }
  };

  const handleTogglePayment = async (uid: string, currentStatus: string, hasEntry: boolean) => {
    setIsSavingPayment(uid);
    setFeedback(null);
    const nextPaid = currentStatus !== 'PAID';
    try {
      // Authoritative path: writes the Member Record + ledger, works for members with or
      // without an entry (incl. the commissioner). Requires the setPaidStatus function deployed.
      await dbService.setPaidStatus(pool.id, uid, nextPaid);
    } catch (err: any) {
      // Pre-deploy fallback: members who already have an entry can still be marked via the
      // existing direct entry write. Member-only rows need the function deployed.
      if (hasEntry) {
        try {
          await dbService.updateBracketEntryPayment(pool.id, uid, nextPaid ? 'PAID' : 'UNPAID');
        } catch (err2: any) {
          logger.error(`Failed to update payment for ${uid}:`, err2);
          setFeedback({ type: 'error', message: 'Permission denied or update failed.' });
        }
      } else {
        logger.error(`Failed to set paid status for ${uid}:`, err);
        setFeedback({ type: 'error', message: 'Mark-paid for members without an entry needs the payments update deployed. Deploy functions to enable.' });
      }
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
        };
      } else if (type === 'NFL_MARGIN') {
        updatedSettings = { ...updatedSettings, payoutMode: marginPayoutMode };
      }

      await dbService.updatePool(pool.id, {
        name: poolName,
        managerName: editManagerName,
        contactEmail: editContactEmail,
        contactPhone: editContactPhone,
        contactMethod: editContactMethod,
        settings: updatedSettings
      });
      setSettingsFeedback({ type: 'success', message: 'Pool settings saved successfully!' });
    } catch (err: any) {
      logger.error('Failed to save pool settings:', err);
      setSettingsFeedback({ type: 'error', message: err.message || 'Failed to save settings.' });
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
      title: `Extend Week ${week} deadline?`,
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
      message: `Week ${proxyWeek}: ${proxyTeam} for ${targetEntry?.userName || 'this member'}. This is recorded in the pool audit log with your name and reason.`,
      confirmLabel: 'Submit Proxy Pick'
    });
    if (!ok) return;
    setIsProxying(true);
    try {
      await dbService.proxyPick(pool.id, proxyWeek, proxyTargetUid, { [proxyWeek]: proxyTeam }, proxyReason.trim());
      toast.success(`Proxy pick saved: ${proxyTeam} (Week ${proxyWeek}) for ${targetEntry?.userName || 'member'}.`);
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
    games.filter(g => g.week === proxyWeek).forEach(g => {
      if (g.homeTeam?.abbreviation) teams.add(g.homeTeam.abbreviation);
      if (g.awayTeam?.abbreviation) teams.add(g.awayTeam.abbreviation);
    });
    return [...teams].sort();
  }, [games, proxyWeek]);

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      
      {/* Premium Bento Overview Dashboard */}
      <NFLManagerBentoDashboard 
        pool={pool} 
        entries={entries} 
        games={games} 
        week={week} 
        user={user} 
        onSelectTab={onSelectTab} 
      />

      {/* Feedback Alert */}
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
                  onChange={e => setPayoutMode(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Standings Only</option>
                  <option value="WEEKLY">Weekly Winner Only</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly Prizes)</option>
                </select>
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
                  onChange={e => setMarginPayoutMode(e.target.value)}
                  className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500 transition-all"
                >
                  <option value="SEASON">Season-End Totals Only</option>
                  <option value="WEEKLY">Weekly Highest Margin Wins</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly)</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Save Button ── */}
          <div className="pt-2 border-t border-line flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-3 px-8 rounded-lg flex items-center gap-2 shadow-card transition-all duration-150 hover:-translate-y-px cursor-pointer text-sm"
            >
              <Save size={15} />
              {isSavingSettings ? 'Saving...' : 'Save Pool Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
           SECTION: WEEKLY SCORING + ROSTER
      ═══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Weekly Scoring Console */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-card border border-line shadow-card rounded-xl p-6 space-y-5">
            <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
              <Activity size={14} className="text-navy-700 dark:text-gold-400" /> Week {week} Scoring Feed
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
                {isScoring ? 'Calculating...' : `Score & Recap Week ${week}`}
              </button>

              {!isWeekFullyFinal && (
                <p className="font-body text-[10px] text-muted mt-2.5 leading-relaxed text-center">
                  <AlertTriangle size={10} className="inline-block align-[-1px] text-gold-600 dark:text-gold-400" /> <strong>Warning:</strong> Some games are still active. SuperAdmins may override.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Participant Roster + Payment Tracker */}
        <div className="lg:col-span-2 space-y-6">
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
                    <th className="py-3.5 px-5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-center">Wk {week} Picks</th>
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
                          onClick={() => handleTogglePayment(row.uid, row.paidStatus, row.hasEntry)}
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
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleRemindOne(row.uid, !row.picked ? 'PICKS' : 'PAYMENT')}
                          disabled={
                            remindingUid !== null ||
                            bulkReminding !== null ||
                            (row.picked && row.paidStatus === 'PAID')
                          }
                          title={!row.picked ? 'Email a picks reminder' : row.paidStatus !== 'PAID' ? 'Email a payment reminder' : 'Picked and paid — nothing to remind'}
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
      </div>

      {/* ═══════════════════════════════════════════
           SECTION: COMMISSIONER EXCEPTIONS
           Sanctioned tools for the messy real-world cases (member in
           hospital, mis-set deadline, dead pool) — every action is
           audited and members are notified.
      ═══════════════════════════════════════════ */}
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

            {/* ── Extend Week Deadline ── */}
            <div className="bg-page border border-line rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-navy-700 dark:text-gold-400" />
                <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Extend Week {week} Deadline</p>
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
    </div>
  );
};
