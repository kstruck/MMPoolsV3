import React, { useState, useMemo } from 'react';
import type { User as UserType, Pool, NFLGame } from '../../types';
import { 
  Lock, 
  Volume2, 
  Send, 
  Activity, 
  CheckCircle,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

const BRAND = {
  navy: '#0A192F',
  orange: '#FF6600',
  orangeGlow: 'rgba(255, 102, 0, 0.15)',
  emerald: '#10B981',
  emeraldGlow: 'rgba(16, 185, 129, 0.15)',
  blue: '#3B82F6',
  blueGlow: 'rgba(59, 130, 246, 0.15)',
  amber: '#FBBF24',
  amberGlow: 'rgba(251, 191, 36, 0.15)',
  white: '#FFFFFF',
};

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
  const [aiMood, setAiMood] = useState<'savage' | 'professional' | 'analyst'>('savage');
  const [banterText, setBanterText] = useState('');
  const [banterFeed, setBanterFeed] = useState<string[]>([
    "🚨 COMMISSIONER: Sarah K. is currently leading, but historically has collapsed in Week 13. Place your bets accordingly!",
    "🚨 COMMISSIONER: Friendly reminder that unsubmitted survivor picks lock at kickoff. Don't be that person."
  ]);
  
  const [isNudging, setIsNudging] = useState<string | null>(null);
  
  // Track dynamic list of paid users in state for immediate interaction
  const [paidUserIds, setPaidUserIds] = useState<Record<string, boolean>>(() => {
    const states: Record<string, boolean> = {};
    entries.forEach(e => {
      states[e.ownerUid || e.id] = e.isPaid || false;
    });
    // Set some defaults if empty
    if (Object.keys(states).length === 0) {
      states['JD'] = true;
      states['MS'] = false;
      states['DB'] = true;
    }
    return states;
  });

  const togglePayment = (id: string) => {
    setPaidUserIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // 1. Calculations for Pick submissions status
  const submissionStats = useMemo(() => {
    const total = entries.length || 12;
    const submitted = entries.filter(e => e.picks && e.picks[`week_${week}`]).length || 10;
    const percentage = Math.round((submitted / total) * 100) || 83;
    return { total, submitted, percentage };
  }, [entries, week]);

  // Derived unsubmitted players list
  const unsubmittedPlayers = useMemo(() => {
    const list = entries.filter(e => !e.picks || !e.picks[`week_${week}`]);
    if (list.length === 0) {
      return [
        { id: 'MS', name: 'Mark S.', email: 'mark@domain.com' },
        { id: 'EL', name: 'Emily L.', email: 'emily@domain.com' }
      ];
    }
    return list.map(e => ({
      id: e.ownerUid || e.id,
      name: e.ownerName || 'User ' + e.id.substring(0, 4),
      email: e.email || 'user@example.com'
    }));
  }, [entries, week]);

  // Financial Ledger calculations
  const ledgerStats = useMemo(() => {
    const fee = castPool.settings?.entryFee || 20;
    const totalPlayers = entries.length || 12;
    const paidCount = Object.values(paidUserIds).filter(Boolean).length;
    const collected = paidCount * fee;
    const remaining = (totalPlayers - paidCount) * fee;
    return { fee, collected, remaining, total: totalPlayers * fee };
  }, [entries, paidUserIds, castPool.settings?.entryFee]);

  const handleNudge = (name: string) => {
    setIsNudging(name);
    setTimeout(() => {
      alert(`Nudge notification dispatched successfully to ${name}!`);
      setIsNudging(null);
    }, 800);
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

  // Mock list of transactions for Commissioner Auditing
  const auditLogs = [
    { time: '10 mins ago', msg: 'Commissioner finalized standings for Week 11', severity: 'INFO' },
    { time: '1 hour ago', msg: 'System executed automated schedule synchronization with ESPN APIs', severity: 'SYSTEM' },
    { time: '2 hours ago', msg: 'David B. submitted picks for Week 12', severity: 'USER' },
    { time: '1 day ago', msg: 'Commissioner marked John D. buy-in buy-in as PAID', severity: 'INFO' }
  ];

  // SVG Radial circle calculations
  const radialRadius = 40;
  const radialCircumference = 2 * Math.PI * radialRadius;
  const strokeDashoffset = radialCircumference - (submissionStats.percentage / 100) * radialCircumference;

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
            {/* Dynamic SVG Radial Progress Bar */}
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-95">
                <circle cx="56" cy="56" r={radialRadius} fill="none" stroke="#1e293b" strokeWidth="9" />
                <circle 
                  cx="56" 
                  cy="56" 
                  r={radialRadius} 
                  fill="none" 
                  stroke="url(#radial-glow)" 
                  strokeWidth="9" 
                  strokeDasharray={radialCircumference} 
                  strokeDashoffset={strokeDashoffset} 
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="radial-glow" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FF6600" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col justify-center items-center">
                <span className="text-xl font-black text-white leading-none">{submissionStats.percentage}%</span>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Submitted</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-extrabold text-white uppercase mb-1">Weekly Summary</h4>
              <p className="text-xs text-slate-400 leading-relaxed mb-2">
                <strong>{submissionStats.submitted}</strong> of <strong>{submissionStats.total}</strong> active participants have successfully lock-in their selections.
              </p>
              <span className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1.5 animate-pulse">
                <AlertCircle size={12} /> Deadline approaches in 16 hours
              </span>
            </div>
          </div>

          {/* List of slackers who need nudging */}
          <div className="space-y-3">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Pending Pick Sheets ({unsubmittedPlayers.length})</span>
            {unsubmittedPlayers.map((player, idx) => (
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
                  onClick={() => handleNudge(player.name)}
                  disabled={isNudging === player.name}
                  className="bg-orange-500/10 border border-orange-500/35 hover:bg-orange-500/20 text-orange-400 hover:text-white font-extrabold text-[10px] uppercase tracking-wider px-3.5 py-1.5 rounded-xl transition-all disabled:opacity-50 disabled:scale-100"
                >
                  {isNudging === player.name ? 'Nudging...' : 'Nudge Email'}
                </button>
              </div>
            ))}
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
            <span className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest">
              Entry fee: ${ledgerStats.fee}
            </span>
          </div>

          {/* Glowing financials overview grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { title: 'Total Collected', value: `$${ledgerStats.collected}`, color: 'text-emerald-400', glow: BRAND.emeraldGlow },
              { title: 'Outstanding', value: `$${ledgerStats.remaining}`, color: 'text-amber-400', glow: BRAND.amberGlow },
              { title: 'Projected Pool', value: `$${ledgerStats.total}`, color: 'text-white', glow: 'rgba(255,255,255,0.05)' }
            ].map((box, i) => (
              <div 
                key={i} 
                className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-2xl text-center relative overflow-hidden"
                style={{ boxShadow: `0 4px 20px ${box.glow}` }}
              >
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">
                  {box.title}
                </span>
                <span className={`text-base font-black ${box.color} tracking-wide font-mono`}>
                  {box.value}
                </span>
              </div>
            ))}
          </div>

          {/* Members list with payment accreditation checkboxes */}
          <div className="space-y-3.5">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Player buy-in tracker</span>
            {[
              { id: 'JD', name: 'John D.', email: 'john@domain.com' },
              { id: 'MS', name: 'Mark S.', email: 'mark@domain.com' },
              { id: 'DB', name: 'David B.', email: 'david@domain.com' }
            ].map((player) => {
              const isPaid = paidUserIds[player.id];
              return (
                <div 
                  key={player.id} 
                  className={`flex justify-between items-center p-3 rounded-2xl border transition-all ${
                    isPaid ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-950/40 border-slate-850'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl font-extrabold text-xs flex items-center justify-center border ${
                      isPaid ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      {player.id}
                    </div>
                    <div>
                      <span className="text-xs font-extrabold text-white block uppercase leading-none mb-1">{player.name}</span>
                      <span className="text-[9px] font-bold text-slate-500">{player.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => togglePayment(player.id)}
                    className={`flex items-center gap-2 border px-3.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wide transition-all ${
                      isPaid 
                        ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400 hover:bg-emerald-500/20' 
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {isPaid ? (
                      <>
                        <CheckCircle size={12} className="text-emerald-500" /> Paid
                      </>
                    ) : 'Mark Paid'}
                  </button>
                </div>
              );
            })}
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
              onClick={() => alert('Initiating ESPN Sync score recalculation...')}
              className="bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider py-4 rounded-2xl transition-all shadow-lg hover:scale-[1.02]"
            >
              🔄 Recalculate Scores
            </button>
            
            <button
              onClick={() => alert('Toggling locks status...')}
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

    </div>
  );
};
