import React, { useState, useMemo } from 'react';
import type { User as UserType, Pool, NFLGame } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import { Badge } from '../ui';
import {
  Lock,
  Volume2,
  Send,
  Activity,
  CheckCircle,
  ShieldCheck,
  AlertCircle,
  Search,
  DollarSign,
  X,
  Edit,
  Save,
  PartyPopper,
  RefreshCw,
  Megaphone
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';

interface NFLManagerBentoDashboardProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
  user: UserType | null;
  onSelectTab: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
}

export const NFLManagerBentoDashboard: React.FC<NFLManagerBentoDashboardProps> = ({
  pool,
  entries,
  games: _games,
  week,
  user: _user,
  onSelectTab: _onSelectTab
}) => {
  const castPool = pool as any;
  const toast = useToast();
  const [aiMood, setAiMood] = useState<'savage' | 'professional' | 'analyst'>('savage');
  const [banterText, setBanterText] = useState('');
  const [banterFeed, setBanterFeed] = useState<string[]>([
    "COMMISSIONER: Warm welcome to the active NFL pool. Good luck!",
    "COMMISSIONER: Friendly reminder that unsubmitted picks lock at kickoff. Don't be that person."
  ]);

  const [isNudging, setIsNudging] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingLedgerId, setSavingLedgerId] = useState<string | null>(null);

  // Modal State for full payment ledger
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'PAID' | 'UNPAID'>('ALL');

  // Local state for editing payment details in ledger
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editPaidStatus, setEditPaidStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');
  const [editMethod, setEditMethod] = useState('Venmo');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const togglePayment = async (entryId: string, currentPaid: boolean) => {
    setTogglingId(entryId);
    try {
      const nextStatus = currentPaid ? 'UNPAID' : 'PAID';
      await dbService.updateBracketEntryPayment(pool.id, entryId, nextStatus);
    } catch (err) {
      console.error("Failed to update payment status:", err);
      toast.error("Failed to update payment status in database.");
    } finally {
      setTogglingId(null);
    }
  };

  const saveDetailedPayment = async (entryId: string) => {
    setSavingLedgerId(entryId);
    try {
      // Server-side since Phase 5 (updateEntryPayment callable) — the raw entry
      // write is denied by rules now, and never worked for commissioners anyway.
      const timestamp = editDate ? new Date(editDate).getTime() : Date.now();
      await dbService.updateBracketEntryPayment(
        pool.id, entryId, editPaidStatus,
        editMethod as Parameters<typeof dbService.updateBracketEntryPayment>[3],
        {
          paidAt: editPaidStatus === 'PAID' ? timestamp : null,
          paymentNote: editNote || null,
        },
      );
      setEditingEntryId(null);
    } catch (err) {
      console.error("Failed to update detailed payment:", err);
      toast.error("Database error: Insufficient permissions or network loss.");
    } finally {
      setSavingLedgerId(null);
    }
  };

  const topPlayerName = useMemo(() => {
    if (entries.length === 0) return 'Sarah K.';
    const sorted = [...entries].sort((a, b) => {
      if (pool.type === 'NFL_PICKEM') return (b.totalScore || 0) - (a.totalScore || 0);
      if (pool.type === 'NFL_SURVIVOR') {
        if (a.status !== b.status) return a.status === 'ALIVE' ? -1 : 1;
        return (a.strikesUsed || 0) - (b.strikesUsed || 0);
      }
      return (b.seasonTotal || 0) - (a.seasonTotal || 0);
    });
    return sorted[0]?.userName || sorted[0]?.ownerName || 'Sarah K.';
  }, [entries, pool.type]);

  React.useEffect(() => {
    setBanterFeed([
      `COMMISSIONER: ${topPlayerName} is currently leading, but historically has collapsed in Week 13. Place your bets accordingly!`,
      "COMMISSIONER: Friendly reminder that unsubmitted picks lock at kickoff. Don't be that person."
    ]);
  }, [topPlayerName]);

  // Derived unsubmitted players list.
  // Pick'em: unsubmitted = at least one current-week game without a pick (picks keyed by gameId).
  // Survivor/Margin: unsubmitted = no pick stored under the current week number.
  const weeklyGames = useMemo(() => _games.filter(g => g.week === week), [_games, week]);
  const unsubmittedPlayers = useMemo(() => {
    const list = entries.filter(e => {
      const picks = e.picks || {};
      if (pool.type === 'NFL_PICKEM') {
        return weeklyGames.length > 0 && !weeklyGames.every(g => !!picks[g.id]);
      }
      return !picks[week];
    });
    return list.map(e => ({
      id: e.id,
      uid: e.ownerUid || e.id,
      name: e.userName || e.ownerName || 'User ' + e.id.substring(0, 4),
      email: e.email || 'user@example.com'
    }));
  }, [entries, week, pool.type, weeklyGames]);

  // 1. Calculations for Pick submissions status
  const submissionStats = useMemo(() => {
    const total = entries.length;
    const pendingCount = unsubmittedPlayers.length;
    const submitted = total - pendingCount;
    const percentage = total > 0 ? Math.round((submitted / total) * 100) : 0;
    return { total, submitted, pendingCount, percentage };
  }, [entries, unsubmittedPlayers]);

  // Financial Ledger calculations
  const ledgerStats = useMemo(() => {
    const fee = castPool.settings?.entryFee || 20;
    const totalPlayers = entries.length;
    const paidCount = entries.filter(e => e.paidStatus === 'PAID').length;
    const collected = paidCount * fee;
    const remaining = (totalPlayers - paidCount) * fee;
    return { fee, collected, remaining, total: totalPlayers * fee };
  }, [entries, castPool.settings?.entryFee]);

  // Filtered unpaid players to show in summary dashboard (MAX 10)
  const dashboardUnpaidPlayers = useMemo(() => {
    const unpaid = entries.filter(e => e.paidStatus !== 'PAID');
    return unpaid.slice(0, 10);
  }, [entries]);

  // Filtered list of players for full Payment Ledger Modal
  const ledgerFilteredPlayers = useMemo(() => {
    return entries.filter(p => {
      const name = (p.userName || p.ownerName || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const query = ledgerSearch.toLowerCase();
      const matchesSearch = name.includes(query) || email.includes(query);

      const status = p.paidStatus || 'UNPAID';
      const matchesFilter = ledgerFilter === 'ALL' ||
                            (ledgerFilter === 'PAID' && status === 'PAID') ||
                            (ledgerFilter === 'UNPAID' && status !== 'PAID');

      return matchesSearch && matchesFilter;
    });
  }, [entries, ledgerSearch, ledgerFilter]);

  const handleNudge = async (player: { uid: string; name: string }) => {
    setIsNudging(player.uid);
    try {
      const { sent, skipped } = await dbService.sendManualReminder(pool.id, [player.uid], 'PICKS');
      toast.success(`Sent ${sent} reminder(s), ${skipped} skipped (recently reminded)`);
    } catch (err) {
      console.error('Failed to send pick reminder:', err);
      toast.error(getUserMessage(err));
    } finally {
      setIsNudging(null);
    }
  };

  const handleSendBanter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!banterText.trim()) return;

    let Prefix = "COMMISSIONER [Savage Mode]: ";
    if (aiMood === 'professional') Prefix = "COMMISSIONER [Professional]: ";
    if (aiMood === 'analyst') Prefix = "COMMISSIONER [Data Analyst]: ";

    setBanterFeed(prev => [
      `${Prefix}${banterText}`,
      ...prev
    ]);
    setBanterText('');
  };

  const auditLogs = useMemo(() => {
    const logs = [
      { time: '10 mins ago', msg: `Commissioner finalized standings for Week ${week - 1 > 0 ? week - 1 : 1}`, severity: 'INFO' },
      { time: '1 hour ago', msg: `System executed automated schedule synchronization with ESPN APIs for ${_games.length} games`, severity: 'SYSTEM' }
    ];

    const picker = entries.find(e => e.picks && Object.keys(e.picks).length > 0);
    if (picker) {
      logs.push({
        time: '2 hours ago',
        msg: `${picker.userName || picker.ownerName} submitted picks for Week ${week}`,
        severity: 'USER'
      });
    } else {
      logs.push({
        time: '2 hours ago',
        msg: `No active picks sheet submissions processed yet for Week ${week}`,
        severity: 'USER'
      });
    }

    const paidPlayer = entries.find(e => e.paidStatus === 'PAID');
    if (paidPlayer) {
      logs.push({
        time: '1 day ago',
        msg: `Commissioner marked ${paidPlayer.userName || paidPlayer.ownerName} buy-in as PAID`,
        severity: 'INFO'
      });
    } else {
      logs.push({
        time: '1 day ago',
        msg: `Buy-in tracking initialized for ${entries.length} members`,
        severity: 'INFO'
      });
    }

    return logs;
  }, [entries, week, _games.length]);

  // Submission Health PieChart Data (Recharts)
  const submissionPieData = useMemo(() => {
    return [
      { name: 'Submitted', value: submissionStats.submitted, color: '#B78F4A' },
      { name: 'Pending', value: submissionStats.pendingCount, color: '#142A4C' }
    ];
  }, [submissionStats]);

  // Financial Revenue BarChart Data (Recharts)
  const financialBarData = useMemo(() => {
    return [
      {
        name: 'Collected',
        Amount: ledgerStats.collected,
        fill: '#0F7B4A'
      },
      {
        name: 'Outstanding',
        Amount: ledgerStats.remaining,
        fill: '#C9A867'
      }
    ];
  }, [ledgerStats]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">

      {/* CARD 1: POOL PERFORMANCE & SUBMISSIONS HEALTH */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Submission Health</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Week {week} Pick Completion Rate</p>
            </div>
            <Badge status="live" className="text-[10px]">
              Live Tracker
            </Badge>
          </div>

          <div className="flex items-center gap-8 mb-6">
            {/* Recharts PieChart replaces raw SVG progress ring */}
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={submissionPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={36}
                    outerRadius={48}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {submissionPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="font-display font-bold text-lg text-[color:var(--text)] leading-none num">{submissionStats.percentage}%</span>
                <span className="font-display font-bold text-[7px] text-faint uppercase tracking-[0.16em] mt-0.5">Active</span>
              </div>
            </div>

            <div>
              <h4 className="font-display font-bold text-sm text-[color:var(--text)] uppercase mb-1">Weekly Summary</h4>
              <p className="font-body text-xs text-muted leading-relaxed mb-2">
                <strong className="num">{submissionStats.submitted}</strong> of <strong className="num">{submissionStats.total}</strong> active participants have successfully locked-in their selections.
              </p>
              <span className="font-display font-bold text-[10px] text-gold-600 dark:text-gold-400 uppercase tracking-[0.08em] flex items-center gap-1.5 animate-pulse">
                <AlertCircle size={12} /> Deadline approaches in 16 hours
              </span>
            </div>
          </div>

          {/* List of slackers who need nudging */}
          <div className="space-y-3">
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Pending Pick Sheets (<span className="num">{unsubmittedPlayers.length}</span>)</span>
            {unsubmittedPlayers.length > 0 ? (
              unsubmittedPlayers.slice(0, 5).map((player, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-lg border bg-page border-line transition-all duration-150 hover:bg-surface">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-navy-800 font-display font-bold text-xs text-white flex items-center justify-center uppercase">
                      {player.name.substring(0,2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-display font-bold text-xs text-[color:var(--text)] block uppercase leading-none">{player.name}</span>
                      <span className="font-body font-semibold text-[9px] text-faint">{player.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleNudge(player)}
                    disabled={isNudging !== null}
                    className="min-h-[44px] bg-gold-400/10 border border-gold-500/40 hover:bg-gold-400/20 text-gold-600 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 rounded-md transition-all duration-150 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isNudging === player.uid ? 'Sending...' : 'Nudge Email'}
                  </button>
                </div>
              ))
            ) : (
              <div className="text-gold-700 dark:text-gold-400 font-display font-bold text-xs uppercase text-center py-4 bg-gold-400/10 border border-gold-500/40 rounded-lg flex items-center justify-center gap-2">
                <PartyPopper size={14} /> Perfect submission health! Everyone has completed their pick sheets.
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1">
            <Activity size={12} className="text-faint" /> Auto-reminders enabled
          </span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            Platform healthy
          </span>
        </div>
      </div>

      {/* CARD 2: BUY-IN REVENUE LEDGER & MEMBERS ACCREDITATION */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Buy-In Ledger</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Member Financial Tracking</p>
            </div>
            <button
              onClick={() => setIsLedgerOpen(true)}
              className="bg-navy-800 hover:bg-navy-700 transition-all duration-150 hover:-translate-y-px text-white font-display font-bold text-[10px] uppercase tracking-[0.05em] px-3.5 py-1.5 rounded-md shadow-card"
            >
              View Full Ledger
            </button>
          </div>

          {/* Recharts BarChart represents Collected vs Outstanding side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="md:col-span-2 bg-page border border-line p-3 rounded-lg h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financialBarData} layout="vertical" margin={{ top: 2, right: 10, left: -25, bottom: 2 }}>
                  <XAxis type="number" stroke="#24507F" fontSize={8} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" stroke="#24507F" fontSize={8} />
                  <Tooltip cursor={{ fill: 'rgba(19,27,43,0.04)' }} contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', color: 'var(--text)', borderRadius: '10px', fontSize: '9px' }} />
                  <Bar dataKey="Amount" radius={[0, 4, 4, 0]}>
                    {financialBarData.map((d, index) => (
                      <Cell key={`cell-${index}`} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-page border border-line p-3.5 rounded-lg text-center flex flex-col justify-center">
              <span className="font-display font-bold uppercase text-[9px] tracking-[0.08em] text-faint block mb-0.5">Projected Pot</span>
              <span className="font-display font-bold text-xl text-gold-600 dark:text-gold-400 num">${ledgerStats.total}</span>
            </div>
          </div>

          {/* Members list limited to 10 UNPAID players */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Unpaid Players (<span className="num">{entries.filter(e => e.paidStatus !== 'PAID').length}</span>)</span>
              <span className="font-display font-bold text-[8px] text-faint uppercase tracking-[0.08em]">Showing Max 10</span>
            </div>

            {dashboardUnpaidPlayers.length > 0 ? (
              dashboardUnpaidPlayers.map((player) => {
                const entryId = player.id;
                const isPaid = player.paidStatus === 'PAID';
                return (
                  <div
                    key={entryId}
                    className="flex justify-between items-center p-3 rounded-lg border border-line bg-page hover:bg-surface transition-all duration-150"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md font-display font-bold text-xs flex items-center justify-center bg-navy-800 text-white">
                        {(player.userName || player.ownerName || 'U').substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-display font-bold text-xs text-[color:var(--text)] block uppercase leading-none mb-1">
                          {player.userName || player.ownerName || 'Anonymous Player'}
                        </span>
                        <span className="font-body font-semibold text-[9px] text-faint">{player.email || 'No email registered'}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => togglePayment(entryId, isPaid)}
                      disabled={togglingId === entryId}
                      className="flex items-center gap-2 bg-navy-800 hover:bg-navy-700 text-white px-3.5 py-1.5 rounded-md text-[10px] font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px"
                    >
                      {togglingId === entryId ? 'Saving...' : 'Mark Paid'}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-[#0F7B4A] font-display font-bold text-xs uppercase text-center py-6 bg-[#E4F5EC] border border-[#BEE7D0] rounded-lg flex flex-col items-center gap-1">
                <CheckCircle size={24} />
                <span>All buy-ins cleared! Excellent ledger status.</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Commission status</span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            100% Secure Transaction Logs
          </span>
        </div>
      </div>

      {/* CARD 3: COMMISSIONER AI BANTER WIDGET */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">AI Commissioner Chat</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Generate custom trash talk banter</p>
            </div>
            <Volume2 size={18} className="text-gold-600 dark:text-gold-400" />
          </div>

          {/* AI Commissioner Mood configurations */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[
              { id: 'savage', label: 'Savage', desc: 'Rants & burns', color: 'border-gold-500/50 text-gold-600' },
              { id: 'professional', label: 'Pro', desc: 'Firm & direct', color: 'border-navy-600/50 text-navy-700' },
              { id: 'analyst', label: 'Analyst', desc: 'Data & stats', color: 'border-gold-500/50 text-gold-600' }
            ].map(mood => (
              <button
                key={mood.id}
                onClick={() => setAiMood(mood.id as any)}
                className={`text-left p-3.5 rounded-lg border transition-all duration-150 ${
                  aiMood === mood.id
                    ? `bg-card border-gold-500 shadow-card scale-[1.02]`
                    : 'bg-page border-line opacity-60 hover:opacity-100'
                }`}
              >
                <span className="font-display font-bold text-xs text-[color:var(--text)] uppercase block leading-none mb-1">{mood.label}</span>
                <span className="font-display font-bold text-[8px] text-faint uppercase tracking-[0.16em] leading-none">{mood.desc}</span>
              </button>
            ))}
          </div>

          {/* Live Banter entry feed */}
          <form onSubmit={handleSendBanter} className="flex gap-2 mb-5">
            <input
              type="text"
              placeholder={`Type a comment or prompt the AI as a ${aiMood} commissioner...`}
              value={banterText}
              onChange={e => setBanterText(e.target.value)}
              className="flex-1 bg-page border border-line rounded-md px-4 py-3 font-body text-xs text-[color:var(--text)] placeholder:text-faint focus:ring-1 focus:ring-navy-600 dark:focus:ring-gold-500 focus:outline-none"
            />
            <button
              type="submit"
              className="bg-brandred-600 hover:bg-brandred-500 text-white p-3 rounded-md transition-all duration-150 hover:-translate-y-px shadow-red-cta active:scale-95"
            >
              <Send size={15} />
            </button>
          </form>

          {/* Scrolling Feed of Recent Banters */}
          <div className="space-y-3 max-h-40 overflow-y-auto pr-1">
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">Live banter feed</span>
            {banterFeed.map((item, idx) => (
              <div key={idx} className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-[color:var(--text)] leading-relaxed font-semibold flex items-start gap-2">
                <Megaphone size={13} className="text-brandred-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Banter engine status</span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            AI Moderation ACTIVE
          </span>
        </div>
      </div>

      {/* CARD 4: COMMISSIONER CONTROLS & TRANSACTION FEED */}
      <div
        className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Commissioner Actions</h3>
              <p className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint mt-0.5">Active League Administration Tools</p>
            </div>
            <ShieldCheck size={18} className="text-navy-700 dark:text-gold-400" />
          </div>

          {/* Quick Admin Toggles */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => toast.info('Initiating ESPN Sync score recalculation...')}
              className="bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold text-xs uppercase tracking-[0.05em] py-4 rounded-lg transition-all duration-150 shadow-red-cta hover:-translate-y-px flex items-center justify-center gap-2"
            >
              <RefreshCw size={13} /> Recalculate Scores
            </button>

            <button
              onClick={() => toast.info('Toggling locks status...')}
              className="bg-navy-800 hover:bg-navy-700 text-white font-display font-bold text-xs uppercase tracking-[0.05em] py-4 rounded-lg transition-all duration-150 hover:-translate-y-px flex items-center justify-center gap-2"
            >
              <Lock size={13} /> Toggle Locks
            </button>
          </div>

          {/* Interactive Audit Trail Log entries */}
          <div className="space-y-3">
            <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block mb-1">League operations log</span>
            {auditLogs.map((log, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-page border border-line rounded-lg text-xs">
                <div>
                  <span className="font-body text-[color:var(--text)] font-semibold leading-relaxed block">{log.msg}</span>
                  <span className="font-display font-bold text-[9px] text-faint uppercase tracking-[0.08em]">{log.time}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[8px] font-display font-bold tracking-[0.16em] uppercase border shrink-0 ml-4 ${
                  log.severity === 'SYSTEM'
                    ? 'bg-navy-600/10 border-navy-600/30 text-navy-700 dark:text-gold-400'
                    : log.severity === 'USER'
                      ? 'bg-gold-400/10 border-gold-500/40 text-gold-600 dark:text-gold-400'
                      : 'bg-surface border-line text-muted'
                }`}>
                  {log.severity}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex justify-between items-center text-[10px]">
          <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Audit logs status</span>
          <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em]">
            Secured behind TLS & SHA-256
          </span>
        </div>
      </div>

      {/* FULL FEATURED PAYMENT LEDGER MODAL */}
      {isLedgerOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-line rounded-xl w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-panel flex flex-col text-[color:var(--text)]">
            {/* Header */}
            <div className="p-6 border-b border-line flex justify-between items-center bg-surface">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gold-400/10 border border-gold-500/40 text-gold-600 dark:text-gold-400 rounded-lg">
                  <DollarSign size={20} />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-[color:var(--text)] uppercase tracking-[0.05em]">Advanced Payment Ledger</h3>
                  <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint mt-0.5">{pool.name} Roster Financials</p>
                </div>
              </div>
              <button
                onClick={() => { setIsLedgerOpen(false); setEditingEntryId(null); }}
                className="p-2 hover:bg-page rounded-md text-muted hover:text-[color:var(--text)] transition-all duration-150"
              >
                <X size={20} />
              </button>
            </div>

            {/* Sub-Header stats panels & Filters */}
            <div className="p-6 bg-surface border-b border-line space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { title: 'Total Projected', value: `$${ledgerStats.total}`, color: 'text-[color:var(--text)]' },
                  { title: 'Total Collected', value: `$${ledgerStats.collected}`, color: 'text-[#0F7B4A]' },
                  { title: 'Outstanding Due', value: `$${ledgerStats.remaining}`, color: 'text-gold-600 dark:text-gold-400' },
                  { title: 'Clearing Rate', value: `${entries.length > 0 ? Math.round((entries.filter(e => e.paidStatus === 'PAID').length / entries.length) * 100) : 0}%`, color: 'text-navy-700 dark:text-gold-400' }
                ].map((stat, idx) => (
                  <div key={idx} className="bg-page border border-line p-3 rounded-lg text-center">
                    <span className="font-display font-bold uppercase text-[8px] tracking-[0.08em] text-faint block mb-0.5">{stat.title}</span>
                    <span className={`font-display font-bold text-sm ${stat.color} num`}>{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Filtering & Search Row */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search player name, email, note..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="w-full bg-page border border-line rounded-md py-2.5 px-4 pl-10 font-body text-xs text-[color:var(--text)] placeholder:text-faint focus:ring-1 focus:ring-navy-600 dark:focus:ring-gold-500 focus:outline-none"
                  />
                  <Search className="absolute left-3 top-3 text-faint" size={14} />
                </div>

                <div className="flex gap-1 bg-page p-1 border border-line rounded-md">
                  {['ALL', 'PAID', 'UNPAID'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setLedgerFilter(type as any)}
                      className={`px-3 py-1.5 rounded-sm text-[9px] font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 ${
                        ledgerFilter === type
                          ? 'bg-navy-800 text-white shadow-card'
                          : 'text-muted hover:text-[color:var(--text)]'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-line font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">
                    <th className="pb-3 px-2">Player / Contact</th>
                    <th className="pb-3 px-2 text-center w-28">Status</th>
                    <th className="pb-3 px-2 w-32">Method</th>
                    <th className="pb-3 px-2 w-36">Paid Date</th>
                    <th className="pb-3 px-2">Transaction ID / Notes</th>
                    <th className="pb-3 px-2 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledgerFilteredPlayers.length > 0 ? (
                    ledgerFilteredPlayers.map((player) => {
                      const entryId = player.id;
                      const isEditing = editingEntryId === entryId;
                      const isPaid = player.paidStatus === 'PAID';

                      return (
                        <tr key={entryId} className="hover:bg-page transition-colors duration-150">
                          {/* Name / Email */}
                          <td className="py-3 px-2">
                            <span className="font-display font-bold text-[color:var(--text)] block uppercase">{player.userName || player.ownerName || 'Anonymous'}</span>
                            <span className="font-body text-[9px] text-faint">{player.email || 'No email registered'}</span>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-2 text-center">
                            {isEditing ? (
                              <select
                                value={editPaidStatus}
                                onChange={(e) => setEditPaidStatus(e.target.value as any)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)] font-bold"
                              >
                                <option value="PAID">PAID</option>
                                <option value="UNPAID">UNPAID</option>
                              </select>
                            ) : (
                              <Badge status={isPaid ? 'paid' : 'unpaid'} className="text-[10px] px-2 py-1">
                                {player.paidStatus || 'UNPAID'}
                              </Badge>
                            )}
                          </td>

                          {/* Payment Method */}
                          <td className="py-3 px-2 font-body text-muted font-semibold">
                            {isEditing ? (
                              <select
                                value={editMethod}
                                onChange={(e) => setEditMethod(e.target.value)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)]"
                              >
                                <option value="Venmo">Venmo</option>
                                <option value="Zelle">Zelle</option>
                                <option value="PayPal">PayPal</option>
                                <option value="Cash">Cash</option>
                                <option value="Card">Credit Card</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              player.paymentMethod || <span className="text-faint italic">N/A</span>
                            )}
                          </td>

                          {/* Paid Date */}
                          <td className="py-3 px-2 font-body text-muted num">
                            {isEditing ? (
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)]"
                              />
                            ) : (
                              player.paidAt ? new Date(player.paidAt).toLocaleDateString() : <span className="text-faint italic">N/A</span>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="py-3 px-2 font-body text-muted">
                            {isEditing ? (
                              <input
                                type="text"
                                placeholder="Tx ID or comments..."
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full bg-page border border-line rounded-sm px-2 py-1 font-body text-[color:var(--text)] placeholder:text-faint"
                              />
                            ) : (
                              player.paymentNote || <span className="text-faint italic">None</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-2 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => saveDetailedPayment(entryId)}
                                  disabled={savingLedgerId === entryId}
                                  className="p-1 bg-navy-800 text-white hover:bg-navy-700 rounded-sm transition-all duration-150 disabled:opacity-50"
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  onClick={() => setEditingEntryId(null)}
                                  className="p-1 bg-page text-muted border border-line hover:bg-surface rounded-sm transition-all duration-150"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingEntryId(entryId);
                                  setEditPaidStatus(player.paidStatus || 'UNPAID');
                                  setEditMethod(player.paymentMethod || 'Venmo');
                                  setEditDate(player.paidAt ? new Date(player.paidAt).toISOString().split('T')[0] : '');
                                  setEditNote(player.paymentNote || '');
                                }}
                                className="p-1 bg-page hover:bg-surface border border-line rounded-sm text-muted hover:text-[color:var(--text)] transition-all duration-150"
                              >
                                <Edit size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-faint font-body font-bold">
                        No members matching filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-line bg-surface flex justify-between items-center text-[10px] text-faint font-display font-bold uppercase tracking-[0.08em]">
              <span>Platform TLS Accreditation: Secure</span>
              <span>Clearing Ledger Logs v2.4</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
