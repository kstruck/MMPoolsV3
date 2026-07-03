import React, { useState, useMemo, useEffect } from 'react';
import {
  Settings, DollarSign, CheckCircle, XCircle, Users, Activity,
  Play, Edit3, Save, Lock, Unlock, AlertTriangle, ShieldCheck, BellRing
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
  games: NFLGame[];
  week: number;
  user: User | null;
  onSelectTab?: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
}

export const NFLManagerView: React.FC<NFLManagerViewProps> = ({
  pool,
  entries,
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

  // Picked-current-week: pick'em = every current-week game picked;
  // survivor/margin = picks keyed by week number.
  const pickedMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const entry of entries) {
      const picks = entry.picks || {};
      if (type === 'NFL_PICKEM') {
        map[entry.id] = weeklyGames.length > 0 && weeklyGames.every(g => !!picks[g.id]);
      } else {
        map[entry.id] = !!picks[week];
      }
    }
    return map;
  }, [entries, weeklyGames, week, type]);

  const unpickedCount = useMemo(() => entries.filter(e => !pickedMap[e.id]).length, [entries, pickedMap]);
  const unpaidCount = useMemo(() => entries.filter(e => e.paidStatus !== 'PAID').length, [entries]);

  // --- Handlers ---
  const handleRemindOne = async (entry: any, kind: 'PICKS' | 'PAYMENT') => {
    const uid = targetUidOf(entry);
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
      ? entries.filter(e => !pickedMap[e.id])
      : entries.filter(e => e.paidStatus !== 'PAID')
    ).map(targetUidOf);
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

  const handleTogglePayment = async (entryId: string, currentStatus: string) => {
    setIsSavingPayment(entryId);
    setFeedback(null);
    const nextStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';
    try {
      await dbService.updateBracketEntryPayment(pool.id, entryId, nextStatus);
    } catch (err: any) {
      logger.error(`Failed to update payment for entry ${entryId}:`, err);
      setFeedback({ type: 'error', message: 'Permission denied or update failed.' });
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

  const branding = castPool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      
      {/* 👑 Premium Bento Overview Dashboard */}
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
        <div className={`p-4 rounded-2xl text-xs font-bold flex gap-2 items-center ${
          feedback.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {feedback.message}
        </div>
      )}

      {/* Control Room Header */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryAccent }}
        />
        <div className="flex gap-4 items-center">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-2xl">
            <Settings size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Commissioner Control Room</h3>
            <p className="text-slate-400 text-xs mt-1">
              Pool host with write capabilities: score weeks, update payment statuses, and configure pool rules.
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
           SECTION: POOL SETTINGS EDITOR
      ═══════════════════════════════════════════ */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-3xl backdrop-blur-sm overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/20">
          <div className="flex items-center gap-2">
            <Edit3 size={14} className="text-indigo-400" />
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-widest">Pool Rules & Settings Editor</h4>
          </div>

          {/* Access badge */}
          {isSuperAdmin ? (
            <div className="flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full px-3 py-1">
              <ShieldCheck size={11} className="text-purple-400" />
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-wider">Super Admin — Full Access</span>
            </div>
          ) : isPreSeason ? (
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
              <Unlock size={11} className="text-emerald-400" />
              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">Pre-Season — Editable</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
              <Lock size={11} className="text-amber-400" />
              <span className="text-[10px] font-black text-amber-400 uppercase tracking-wider">Season Active — Locked</span>
            </div>
          )}
        </div>

        {/* Locked notice for regular managers in-season */}
        {!canEditSettings && (
          <div className="mx-6 mt-5 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-amber-400 text-xs font-bold">Settings Locked During Active Season</p>
              <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                Pool rules cannot be modified once the season has started. Contact your platform Super Admin to make changes if needed.
              </p>
            </div>
          </div>
        )}

        <div className={`p-6 space-y-6 ${!canEditSettings ? 'opacity-40 pointer-events-none select-none' : ''}`}>

          {/* Settings Feedback */}
          {settingsFeedback && (
            <div className={`p-3.5 rounded-2xl text-xs font-bold flex gap-2 items-center ${
              settingsFeedback.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {settingsFeedback.type === 'success' ? <CheckCircle size={15} /> : <XCircle size={15} />}
              {settingsFeedback.message}
            </div>
          )}

          {/* ── General Settings ── */}
          <div className="space-y-4">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">General</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">Pool Name</label>
                <input
                  type="text"
                  value={poolName}
                  onChange={e => setPoolName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">Entry Fee ($)</label>
                <input
                  type="number"
                  value={entryFee}
                  min={0}
                  onChange={e => setEntryFee(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5">Payment Instructions</label>
              <textarea
                value={paymentInstructions}
                onChange={e => setPaymentInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Venmo @your-handle — include your name in the note."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
              />
            </div>

            <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
              <div>
                <p className="text-xs font-bold text-white">List Pool Publicly</p>
                <p className="text-[10px] text-slate-500">Allow others to find this pool via the public browser</p>
              </div>
              <input
                type="checkbox"
                checked={isListedPublic}
                onChange={e => setIsListedPublic(e.target.checked)}
                className="w-5 h-5 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
              />
            </div>

            {/* Host Profile & Contact Links */}
            <div className="space-y-4 pt-4 border-t border-slate-800/60">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Host Profile & Contact Links</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Host Name</label>
                  <input
                    type="text"
                    value={editManagerName}
                    onChange={e => setEditManagerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all animate-none"
                    placeholder="Host Display Name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Contact Email</label>
                  <input
                    type="email"
                    value={editContactEmail}
                    onChange={e => setEditContactEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all animate-none"
                    placeholder="host@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Contact Phone</label>
                  <input
                    type="text"
                    value={editContactPhone}
                    onChange={e => setEditContactPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all animate-none"
                    placeholder="+1 (555) 0199"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">Contact Link Options</label>
                <select
                  value={editContactMethod}
                  onChange={e => setEditContactMethod(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
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
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Pick'em Rules</p>

              {/* Confidence Mode */}
              <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-white">Confidence Mode</p>
                  <p className="text-[10px] text-slate-500">Players rank games 1–N; highest rank earns most points</p>
                </div>
                <input
                  type="checkbox"
                  checked={confidenceMode}
                  onChange={e => setConfidenceMode(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 text-blue-500 focus:ring-blue-500 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Lock Mode</label>
                  <select
                    value={lockMode}
                    disabled={confidenceMode}
                    onChange={e => setLockMode(e.target.value as 'PER_GAME' | 'WEEKLY')}
                    className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${confidenceMode ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <option value="PER_GAME">Per-Game (each game locks at kickoff)</option>
                    <option value="WEEKLY">Weekly (all locks at first kickoff)</option>
                  </select>
                  {confidenceMode && <p className="text-[10px] text-yellow-500 font-bold mt-1">* Forced Weekly in Confidence Mode</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Lock Buffer</label>
                  <select
                    value={lockBufferMinutes}
                    onChange={e => setLockBufferMinutes(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  >
                    <option value={0}>0 min (exactly at kickoff)</option>
                    <option value={5}>5 min grace (recommended)</option>
                    <option value={10}>10 min grace</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">Payout Method</label>
                <select
                  value={payoutMode}
                  onChange={e => setPayoutMode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                >
                  <option value="SEASON">Season-End Standings Only</option>
                  <option value="WEEKLY">Weekly Winner Only</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly Prizes)</option>
                </select>
              </div>

              {/* Scoring Configuration */}
              <div className="bg-slate-950/60 border border-blue-900/30 rounded-2xl p-5 space-y-5">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">🏆 Scoring Configuration</p>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Base Points Per Correct Pick</label>
                  <p className="text-[11px] text-slate-500 mb-2">Default is 1. Increase to reward all correct picks more.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={pointsPerPick}
                      min={1}
                      max={10}
                      onChange={e => setPointsPerPick(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                    <span className="text-slate-400 text-xs font-bold">point(s) per correct pick</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Primetime Game Bonus Points</label>
                  <p className="text-[11px] text-slate-500 mb-3">Flat bonus added on top of the base score for correct primetime picks. Set 0 to disable.</p>
                  <div className="space-y-2.5">
                    {[
                      { label: '🌙 Thursday Night Game (TNF)', value: thursdayBonus, setter: setThursdayBonus },
                      { label: '⭐ Sunday Night Game (SNF)', value: sundayNightBonus, setter: setSundayNightBonus },
                      { label: '🏈 Monday Night Game (MNF)', value: mondayBonus, setter: setMondayBonus },
                    ].map(({ label, value, setter }) => (
                      <div key={label} className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5">
                        <span className="text-slate-300 text-xs font-bold">{label}</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={value}
                            min={0}
                            max={10}
                            onChange={e => setter(Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                          />
                          <span className="text-slate-500 text-[11px] w-20 text-right">{value > 0 ? `+${value} bonus pts` : 'disabled'}</span>
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
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Survivor Rules</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Strikes Limit</label>
                  <select
                    value={maxStrikes}
                    onChange={e => setMaxStrikes(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  >
                    <option value={0}>0 — Sudden Death</option>
                    <option value={1}>1 — Double Elimination</option>
                    <option value={2}>2 — Triple Elimination</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">Max Rebuys</label>
                  <select
                    value={maxRebuys}
                    onChange={e => setMaxRebuys(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  >
                    <option value={0}>None</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              </div>

              {maxRebuys > 0 && (
                <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-400 mb-1.5 uppercase">Rebuy Cutoff Week</label>
                    <input
                      type="number"
                      value={rebuyDeadlineWeek}
                      min={1}
                      max={18}
                      onChange={e => setRebuyDeadlineWeek(Math.max(1, Math.min(18, parseInt(e.target.value) || 1)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-400 mb-1.5 uppercase">Rebuy Fee ($)</label>
                    <input
                      type="number"
                      value={rebuyCost}
                      min={0}
                      onChange={e => setRebuyCost(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-white">Pick-Loser Mode</p>
                  <p className="text-[10px] text-slate-500">Players pick a team to LOSE instead of win</p>
                </div>
                <input
                  type="checkbox"
                  checked={pickLosersMode}
                  onChange={e => setPickLosersMode(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 text-red-500 focus:ring-red-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* ── Margin Rules ── */}
          {type === 'NFL_MARGIN' && (
            <div className="space-y-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Margin Rules</p>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">Payout Method</label>
                <select
                  value={marginPayoutMode}
                  onChange={e => setMarginPayoutMode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                >
                  <option value="SEASON">Season-End Totals Only</option>
                  <option value="WEEKLY">Weekly Highest Margin Wins</option>
                  <option value="HYBRID">Hybrid (Season-End + Weekly)</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Save Button ── */}
          <div className="pt-2 border-t border-slate-800 flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold py-3 px-8 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-600/15 transition-all hover:scale-[1.02] cursor-pointer text-sm"
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
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-5">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" /> Week {week} Scoring Feed
            </h4>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                <span className="text-slate-400 font-semibold">Total Matchups:</span>
                <span className="text-white font-extrabold font-mono">{totalGamesCount}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                <span className="text-slate-400 font-semibold">Completed Games:</span>
                <span className={`font-extrabold font-mono ${isWeekFullyFinal ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {finalGamesCount} / {totalGamesCount}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleScoreWeek}
                disabled={isScoring || totalGamesCount === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <Play size={14} className={isScoring ? 'animate-spin' : ''} />
                {isScoring ? 'Calculating...' : `Score & Recap Week ${week}`}
              </button>

              {!isWeekFullyFinal && (
                <p className="text-[10px] text-slate-500 mt-2.5 leading-relaxed text-center">
                  ⚠️ <strong>Warning:</strong> Some games are still active. SuperAdmins may override.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Participant Roster + Payment Tracker */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl overflow-hidden backdrop-blur-sm">
            <div className="p-5 border-b border-slate-800 bg-slate-900/10 space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Users size={14} className="text-indigo-400" /> Member Roster & Payments
                </h4>
                <span className="text-[10px] text-slate-500 font-bold bg-slate-950 px-2 py-0.5 border border-slate-800 rounded-full">
                  {entries.length} members
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleRemindBulk('PICKS')}
                  disabled={bulkReminding !== null || unpickedCount === 0}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider bg-orange-500/10 border border-orange-500/25 text-orange-400 hover:bg-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <BellRing size={12} />
                  {bulkReminding === 'PICKS' ? 'Sending...' : `Remind all unpicked (${unpickedCount})`}
                </button>
                <button
                  onClick={() => handleRemindBulk('PAYMENT')}
                  disabled={bulkReminding !== null || unpaidCount === 0}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <DollarSign size={12} />
                  {bulkReminding === 'PAYMENT' ? 'Sending...' : `Remind all unpaid (${unpaidCount})`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/20 text-slate-500">
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider">Name</th>
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Status</th>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Strikes</th>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Rebuys</th>
                      </>
                    )}
                    {type === 'NFL_MARGIN' && (
                      <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-right">Margin Score</th>
                    )}
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Wk {week} Picks</th>
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-right w-36">Payment</th>
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-right w-32">Remind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-900/10 transition-colors">
                      <td className="py-3.5 px-5 font-extrabold text-white">{entry.userName}</td>

                      {type === 'NFL_SURVIVOR' && (
                        <>
                          <td className="py-3.5 px-5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                              entry.status === 'ALIVE'
                                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                            }`}>
                              {entry.status ?? 'ALIVE'}
                            </span>
                          </td>
                          <td className="py-3.5 px-5 text-center font-bold font-mono text-slate-400">{entry.strikesUsed ?? 0}</td>
                          <td className="py-3.5 px-5 text-center font-bold font-mono text-slate-400">{entry.rebuysUsed ?? 0}</td>
                        </>
                      )}

                      {type === 'NFL_MARGIN' && (
                        <td className="py-3.5 px-5 text-right font-black font-mono text-white">
                          {entry.seasonTotal ?? 0} pts
                        </td>
                      )}

                      <td className="py-3.5 px-5 text-center">
                        {pickedMap[entry.id] ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            <CheckCircle size={10} /> Picked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-rose-500/10 border border-rose-500/20 text-rose-400">
                            <XCircle size={10} /> Missing
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleTogglePayment(entry.id, entry.paidStatus)}
                          disabled={isSavingPayment === entry.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all hover:scale-[1.03] cursor-pointer ${
                            entry.paidStatus === 'PAID'
                              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-rose-500/10 border border-rose-500/25 text-rose-400 hover:bg-rose-500/20'
                          }`}
                        >
                          <DollarSign size={10} />
                          {isSavingPayment === entry.id ? 'Saving...' : entry.paidStatus || 'UNPAID'}
                        </button>
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleRemindOne(entry, !pickedMap[entry.id] ? 'PICKS' : 'PAYMENT')}
                          disabled={
                            remindingUid !== null ||
                            bulkReminding !== null ||
                            (pickedMap[entry.id] && entry.paidStatus === 'PAID')
                          }
                          title={!pickedMap[entry.id] ? 'Email a picks reminder' : entry.paidStatus !== 'PAID' ? 'Email a payment reminder' : 'Picked and paid — nothing to remind'}
                          className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                        >
                          <BellRing size={10} />
                          {remindingUid === targetUidOf(entry) ? 'Sending...' : 'Remind'}
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
    </div>
  );
};
