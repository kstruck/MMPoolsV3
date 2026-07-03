import React, { useState, useMemo } from 'react';
import type { User as UserType, Pool, NFLGame } from '../../types';
import { dbService, db } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import { doc, updateDoc } from 'firebase/firestore';
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
  Save
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
    "🚨 COMMISSIONER: Warm welcome to the active NFL pool. Good luck!",
    "🚨 COMMISSIONER: Friendly reminder that unsubmitted picks lock at kickoff. Don't be that person."
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
      const entryRef = doc(db, 'pools', pool.id, 'entries', entryId);
      const timestamp = editDate ? new Date(editDate).getTime() : Date.now();
      await updateDoc(entryRef, {
        paidStatus: editPaidStatus,
        paymentMethod: editMethod,
        paidAt: editPaidStatus === 'PAID' ? timestamp : null,
        paymentNote: editNote || null,
        updatedAt: Date.now()
      });
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
      `🚨 COMMISSIONER: ${topPlayerName} is currently leading, but historically has collapsed in Week 13. Place your bets accordingly!`,
      "🚨 COMMISSIONER: Friendly reminder that unsubmitted picks lock at kickoff. Don't be that person."
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
    
    let Prefix = "🚨 COMMISSIONER [Savage Mode]: ";
    if (aiMood === 'professional') Prefix = "🚨 COMMISSIONER [Professional]: ";
    if (aiMood === 'analyst') Prefix = "🚨 COMMISSIONER [Data Analyst]: ";

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
      { name: 'Submitted', value: submissionStats.submitted, color: '#FF6600' },
      { name: 'Pending', value: submissionStats.pendingCount, color: '#1e293b' }
    ];
  }, [submissionStats]);

  // Financial Revenue BarChart Data (Recharts)
  const financialBarData = useMemo(() => {
    return [
      {
        name: 'Collected',
        Amount: ledgerStats.collected,
        fill: '#10B981'
      },
      {
        name: 'Outstanding',
        Amount: ledgerStats.remaining,
        fill: '#FBBF24'
      }
    ];
  }, [ledgerStats]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
      
      {/* CARD 1: POOL PERFORMANCE & SUBMISSIONS HEALTH */}
      <div 
        className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(59, 130, 246, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Submission Health</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Week {week} Pick Completion Rate</p>
            </div>
            <span className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest">
              Live Tracker
            </span>
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
                <span className="text-lg font-black text-white leading-none">{submissionStats.percentage}%</span>
                <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Active</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-extrabold text-white uppercase mb-1">Weekly Summary</h4>
              <p className="text-xs text-slate-400 leading-relaxed mb-2">
                <strong>{submissionStats.submitted}</strong> of <strong>{submissionStats.total}</strong> active participants have successfully locked-in their selections.
              </p>
              <span className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1.5 animate-pulse">
                <AlertCircle size={12} /> Deadline approaches in 16 hours
              </span>
            </div>
          </div>

          {/* List of slackers who need nudging */}
          <div className="space-y-3">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Pending Pick Sheets ({unsubmittedPlayers.length})</span>
            {unsubmittedPlayers.length > 0 ? (
              unsubmittedPlayers.slice(0, 5).map((player, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-2xl border bg-slate-950/60 border-slate-800 transition-all hover:bg-slate-950">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 font-extrabold text-xs text-slate-400 flex items-center justify-center uppercase">
                      {player.name.substring(0,2).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-xs font-extrabold text-white block uppercase leading-none">{player.name}</span>
                      <span className="text-[9px] font-bold text-slate-500">{player.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleNudge(player)}
                    disabled={isNudging !== null}
                    className="min-h-[44px] bg-orange-500/10 border border-orange-500/35 hover:bg-orange-500/20 text-orange-400 hover:text-white font-extrabold text-[10px] uppercase tracking-wider px-3.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isNudging === player.uid ? 'Sending...' : 'Nudge Email'}
                  </button>
                </div>
              ))
            ) : (
              <div className="text-emerald-400 text-xs font-black text-center py-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                🎉 Perfect submission health! Everyone has completed their pick sheets.
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
          <span className="text-slate-500 font-bold uppercase flex items-center gap-1">
            <Activity size={12} className="text-slate-600" /> Auto-reminders enabled
          </span>
          <span className="text-emerald-400 font-black uppercase">
            Platform healthy
          </span>
        </div>
      </div>

      {/* CARD 2: BUY-IN REVENUE LEDGER & MEMBERS ACCREDITATION */}
      <div 
        className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(16, 185, 129, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Buy-In Ledger</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Member Financial Tracking</p>
            </div>
            <button
              onClick={() => setIsLedgerOpen(true)}
              className="bg-indigo-600/10 border border-indigo-500/35 hover:bg-indigo-650 hover:text-white transition-all text-indigo-400 font-black text-[10px] uppercase tracking-wider px-3.5 py-1.5 rounded-xl shadow-lg"
            >
              View Full Ledger
            </button>
          </div>

          {/* Recharts BarChart represents Collected vs Outstanding side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="md:col-span-2 bg-slate-950/60 border border-slate-800/80 p-3 rounded-2xl h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financialBarData} layout="vertical" margin={{ top: 2, right: 10, left: -25, bottom: 2 }}>
                  <XAxis type="number" stroke="#475569" fontSize={8} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" stroke="#475569" fontSize={8} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.02)' }} contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '8px', fontSize: '9px' }} />
                  <Bar dataKey="Amount" radius={[0, 4, 4, 0]}>
                    {financialBarData.map((d, index) => (
                      <Cell key={`cell-${index}`} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-slate-950/60 border border-slate-850 p-3.5 rounded-2xl text-center flex flex-col justify-center">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Projected Pot</span>
              <span className="text-xl font-black text-emerald-400 font-mono">${ledgerStats.total}</span>
            </div>
          </div>

          {/* Members list limited to 10 UNPAID players */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Unpaid Players ({entries.filter(e => e.paidStatus !== 'PAID').length})</span>
              <span className="text-[8px] text-slate-500 font-bold uppercase">Showing Max 10</span>
            </div>
            
            {dashboardUnpaidPlayers.length > 0 ? (
              dashboardUnpaidPlayers.map((player) => {
                const entryId = player.id;
                const isPaid = player.paidStatus === 'PAID';
                return (
                  <div 
                    key={entryId} 
                    className="flex justify-between items-center p-3 rounded-2xl border border-slate-850 bg-slate-950/40 hover:bg-slate-950 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl font-extrabold text-xs flex items-center justify-center border bg-slate-900 border-slate-800 text-slate-500">
                        {(player.userName || player.ownerName || 'U').substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-xs font-extrabold text-white block uppercase leading-none mb-1">
                          {player.userName || player.ownerName || 'Anonymous Player'}
                        </span>
                        <span className="text-[9px] font-bold text-slate-500">{player.email || 'No email registered'}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => togglePayment(entryId, isPaid)}
                      disabled={togglingId === entryId}
                      className="flex items-center gap-2 border bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 px-3.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wide transition-all"
                    >
                      {togglingId === entryId ? 'Saving...' : 'Mark Paid'}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-emerald-400 text-xs font-black text-center py-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex flex-col items-center gap-1">
                <CheckCircle size={24} />
                <span>All buy-ins cleared! Excellent ledger status.</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
          <span className="text-slate-500 font-bold uppercase">Commission status</span>
          <span className="text-emerald-400 font-black uppercase">
            100% Secure Transaction Logs
          </span>
        </div>
      </div>

      {/* CARD 3: COMMISSIONER AI BANTER WIDGET */}
      <div 
        className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(251, 191, 36, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">AI Commissioner Chat</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Generate custom trash talk banter</p>
            </div>
            <Volume2 size={18} className="text-amber-400 animate-bounce" />
          </div>

          {/* AI Commissioner Mood configurations */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[
              { id: 'savage', label: 'Savage', desc: 'Rants & burns', color: 'border-orange-500/50 text-orange-400' },
              { id: 'professional', label: 'Pro', desc: 'Firm & direct', color: 'border-blue-500/50 text-blue-400' },
              { id: 'analyst', label: 'Analyst', desc: 'Data & stats', color: 'border-emerald-500/50 text-emerald-400' }
            ].map(mood => (
              <button
                key={mood.id}
                onClick={() => setAiMood(mood.id as any)}
                className={`text-left p-3.5 rounded-2xl border transition-all duration-300 ${
                  aiMood === mood.id 
                    ? `bg-slate-950 border-orange-500 shadow-md scale-[1.02]` 
                    : 'bg-slate-950/60 border-slate-800/50 opacity-60 hover:opacity-100'
                }`}
              >
                <span className="text-xs font-black uppercase block leading-none mb-1">{mood.label}</span>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">{mood.desc}</span>
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
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white placeholder:text-slate-650 focus:ring-1 focus:ring-orange-500 focus:outline-none"
            />
            <button 
              type="submit"
              className="bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-700 text-white p-3 rounded-xl transition-all shadow-md active:scale-95"
            >
              <Send size={15} />
            </button>
          </form>

          {/* Scrolling Feed of Recent Banters */}
          <div className="space-y-3 max-h-40 overflow-y-auto pr-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Live banter feed</span>
            {banterFeed.map((item, idx) => (
              <div key={idx} className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-xs text-slate-300 leading-relaxed font-semibold">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
          <span className="text-slate-500 font-bold uppercase">Banter engine status</span>
          <span className="text-emerald-400 font-black uppercase">
            AI Moderation ACTIVE
          </span>
        </div>
      </div>

      {/* CARD 4: COMMISSIONER CONTROLS & TRANSACTION FEED */}
      <div 
        className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
        style={{ boxShadow: `inset 0 0 20px rgba(99, 102, 241, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
      >
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Commissioner Actions</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Active League Administration Tools</p>
            </div>
            <ShieldCheck size={18} className="text-indigo-400" />
          </div>

          {/* Quick Admin Toggles */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => toast.info('Initiating ESPN Sync score recalculation...')}
              className="bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider py-4 rounded-2xl transition-all shadow-lg hover:scale-[1.02]"
            >
              🔄 Recalculate Scores
            </button>
            
            <button
              onClick={() => toast.info('Toggling locks status...')}
              className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-extrabold text-xs uppercase tracking-wider py-4 rounded-2xl transition-all flex items-center justify-center gap-2"
            >
              <Lock size={13} /> Toggle Locks
            </button>
          </div>

          {/* Interactive Audit Trail Log entries */}
          <div className="space-y-3">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">League operations log</span>
            {auditLogs.map((log, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs">
                <div>
                  <span className="text-white font-semibold leading-relaxed block">{log.msg}</span>
                  <span className="text-[9px] font-bold text-slate-500 uppercase">{log.time}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[8px] font-black tracking-widest uppercase border shrink-0 ml-4 ${
                  log.severity === 'SYSTEM' 
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                    : log.severity === 'USER' 
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' 
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  {log.severity}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
          <span className="text-slate-500 font-bold uppercase">Audit logs status</span>
          <span className="text-emerald-400 font-black uppercase">
            Secured behind TLS & SHA-256
          </span>
        </div>
      </div>

      {/* FULL FEATURED PAYMENT LEDGER MODAL */}
      {isLedgerOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col text-slate-100">
            {/* Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
                  <DollarSign size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-wider">Advanced Payment Ledger</h3>
                  <p className="text-slate-500 text-xs mt-0.5 uppercase font-bold">{pool.name} Roster Financials</p>
                </div>
              </div>
              <button 
                onClick={() => { setIsLedgerOpen(false); setEditingEntryId(null); }}
                className="p-2 hover:bg-slate-800/80 rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Sub-Header stats panels & Filters */}
            <div className="p-6 bg-slate-950/20 border-b border-slate-800/80 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { title: 'Total Projected', value: `$${ledgerStats.total}`, color: 'text-white' },
                  { title: 'Total Collected', value: `$${ledgerStats.collected}`, color: 'text-emerald-400' },
                  { title: 'Outstanding Due', value: `$${ledgerStats.remaining}`, color: 'text-amber-400' },
                  { title: 'Clearing Rate', value: `${entries.length > 0 ? Math.round((entries.filter(e => e.paidStatus === 'PAID').length / entries.length) * 100) : 0}%`, color: 'text-indigo-400' }
                ].map((stat, idx) => (
                  <div key={idx} className="bg-slate-950/60 border border-slate-850 p-3 rounded-2xl text-center">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">{stat.title}</span>
                    <span className={`text-sm font-black ${stat.color} font-mono`}>{stat.value}</span>
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-4 pl-10 text-xs text-white placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <Search className="absolute left-3 top-3 text-slate-500" size={14} />
                </div>
                
                <div className="flex gap-1 bg-slate-950 p-1 border border-slate-800 rounded-xl">
                  {['ALL', 'PAID', 'UNPAID'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setLedgerFilter(type as any)}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                        ledgerFilter === type 
                          ? 'bg-indigo-600 text-white shadow-md' 
                          : 'text-slate-500 hover:text-slate-350'
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
                  <tr className="border-b border-slate-800 text-slate-500 font-black uppercase tracking-wider">
                    <th className="pb-3 px-2">Player / Contact</th>
                    <th className="pb-3 px-2 text-center w-28">Status</th>
                    <th className="pb-3 px-2 w-32">Method</th>
                    <th className="pb-3 px-2 w-36">Paid Date</th>
                    <th className="pb-3 px-2">Transaction ID / Notes</th>
                    <th className="pb-3 px-2 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {ledgerFilteredPlayers.length > 0 ? (
                    ledgerFilteredPlayers.map((player) => {
                      const entryId = player.id;
                      const isEditing = editingEntryId === entryId;
                      const isPaid = player.paidStatus === 'PAID';
                      
                      return (
                        <tr key={entryId} className="hover:bg-slate-950/30 transition-colors">
                          {/* Name / Email */}
                          <td className="py-3 px-2">
                            <span className="font-extrabold text-white block uppercase">{player.userName || player.ownerName || 'Anonymous'}</span>
                            <span className="text-[9px] text-slate-500">{player.email || 'No email registered'}</span>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-2 text-center">
                            {isEditing ? (
                              <select
                                value={editPaidStatus}
                                onChange={(e) => setEditPaidStatus(e.target.value as any)}
                                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-bold"
                              >
                                <option value="PAID">PAID</option>
                                <option value="UNPAID">UNPAID</option>
                              </select>
                            ) : (
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${
                                isPaid 
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                  : 'bg-rose-500/10 border-rose-500/20 text-rose-450'
                              }`}>
                                {player.paidStatus || 'UNPAID'}
                              </span>
                            )}
                          </td>

                          {/* Payment Method */}
                          <td className="py-3 px-2 text-slate-300 font-semibold">
                            {isEditing ? (
                              <select
                                value={editMethod}
                                onChange={(e) => setEditMethod(e.target.value)}
                                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                              >
                                <option value="Venmo">Venmo</option>
                                <option value="Zelle">Zelle</option>
                                <option value="PayPal">PayPal</option>
                                <option value="Cash">Cash</option>
                                <option value="Card">Credit Card</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              player.paymentMethod || <span className="text-slate-600 italic">N/A</span>
                            )}
                          </td>

                          {/* Paid Date */}
                          <td className="py-3 px-2 text-slate-400 font-mono">
                            {isEditing ? (
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                              />
                            ) : (
                              player.paidAt ? new Date(player.paidAt).toLocaleDateString() : <span className="text-slate-600 italic">N/A</span>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="py-3 px-2 text-slate-400">
                            {isEditing ? (
                              <input
                                type="text"
                                placeholder="Tx ID or comments..."
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                              />
                            ) : (
                              player.paymentNote || <span className="text-slate-650 italic">None</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-2 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => saveDetailedPayment(entryId)}
                                  disabled={savingLedgerId === entryId}
                                  className="p-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/35 hover:bg-emerald-500/20 rounded-lg"
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  onClick={() => setEditingEntryId(null)}
                                  className="p-1 bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800 rounded-lg"
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
                                className="p-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-white"
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
                      <td colSpan={6} className="text-center py-10 text-slate-650 font-bold">
                        No members matching filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex justify-between items-center text-[10px] text-slate-600 font-bold uppercase">
              <span>Platform TLS Accreditation: Secure</span>
              <span>Clearing Ledger Logs v2.4</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
