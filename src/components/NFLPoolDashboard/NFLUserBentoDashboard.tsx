import React, { useState, useMemo } from 'react';
import type { User as UserType, Pool, NFLGame, WeeklyRecap } from '../../types';
import { 
  LayoutGrid, 
  CheckCircle2, 
  Shield, 
  Zap, 
  Percent, 
  Lock, 
  Settings, 
  ArrowLeft, 
  ChevronRight 
} from 'lucide-react';

// Brand Design Tokens
const BRAND = {
  navy: '#0A192F',
  darkBlue: '#0E1E38',
  slateDark: '#122543',
  orange: '#FF6600',
  orangeGlow: 'rgba(255, 102, 0, 0.15)',
  emerald: '#10B981',
  emeraldGlow: 'rgba(16, 185, 129, 0.15)',
  blue: '#3B82F6',
  blueGlow: 'rgba(59, 130, 246, 0.15)',
  amber: '#FBBF24',
  amberGlow: 'rgba(251, 191, 36, 0.15)',
  white: '#FFFFFF',
  lightGray: '#E5E7EB',
};

interface NFLUserBentoDashboardProps {
  pool: Pool;
  user: UserType | null;
  games: NFLGame[];
  entries: any[];
  recaps: WeeklyRecap[];
  selectedWeek: number;
  setSelectedWeek: (week: number) => void;
  isWeekLocked: boolean;
  earliestGame: NFLGame | null;
  onBack: () => void;
  onOpenAuth: () => void;
  isManager: boolean;
  onSelectTab: (tab: 'picks' | 'standings' | 'recaps' | 'rules' | 'manager') => void;
}

// A beautiful dynamic SVG Football Helmet Component that paints itself in team colors
const FootballHelmet: React.FC<{ primaryColor: string; secondaryColor: string; className?: string }> = ({ 
  primaryColor, 
  secondaryColor, 
  className = "w-16 h-16" 
}) => {
  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`helmet-glow-${primaryColor.replace('#', '')}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`helmet-shade-${primaryColor.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="50%" stopColor={primaryColor} />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      
      {/* Glow Effect */}
      <circle cx="50" cy="50" r="45" fill={`url(#helmet-glow-${primaryColor.replace('#', '')})`} />
      
      {/* Helmet Shell */}
      <path 
        d="M 25 55 C 25 20, 75 20, 75 50 C 75 55, 72 65, 68 70 C 62 76, 52 78, 48 78 L 35 78 C 30 78, 25 72, 25 65 Z" 
        fill={`url(#helmet-shade-${primaryColor.replace('#', '')})`}
        stroke={secondaryColor} 
        strokeWidth="1.5" 
      />
      
      {/* Ear Hole Detail */}
      <circle cx="48" cy="58" r="8" fill="#1e293b" stroke={secondaryColor} strokeWidth="1" />
      <circle cx="48" cy="58" r="5" fill="#0f172a" />
      
      {/* Helmet Jaw Guard */}
      <path d="M 25 62 L 20 62 C 18 62, 17 65, 18 67 L 22 75 C 24 78, 28 80, 32 80 L 40 80" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      
      {/* Face Mask / Grill */}
      <path d="M 52 75 L 75 75" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
      <path d="M 58 68 L 78 68" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
      <path d="M 64 58 L 80 58" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
      <path d="M 50 48 L 72 58 L 72 75 L 50 78" fill="none" stroke="#64748b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 72 58 L 76 48 L 68 45" fill="none" stroke="#64748b" strokeWidth="2" />
      
      {/* Helmet Stripe (Diagonal / Center) */}
      <path d="M 46 23 C 48 24, 52 24, 54 23 C 58 35, 58 45, 54 50 C 52 49, 48 49, 46 50 Z" fill={secondaryColor} opacity="0.85" />
    </svg>
  );
};

export const NFLUserBentoDashboard: React.FC<NFLUserBentoDashboardProps> = ({
  pool: _pool,
  user,
  games: _games,
  entries,
  recaps: _recaps,
  selectedWeek,
  setSelectedWeek: _setSelectedWeek,
  isWeekLocked: _isWeekLocked,
  earliestGame: _earliestGame,
  onBack,
  onOpenAuth: _onOpenAuth,
  isManager,
  onSelectTab
}) => {
  const [sidebarActive, setSidebarActive] = useState('dashboard');
  
  // Custom states for interactive elements (such as Mock Win Probability updates or live ticks)
  const liveWinProb = 61;

  // Quick statistics derived from entries
  const survivalLeagueStats = useMemo(() => {
    const total = entries.length || 32;
    const alive = entries.filter(e => e.isAlive !== false).length || 14;
    return {
      total,
      alive,
      eliminated: total - alive
    };
  }, [entries]);

  // Mock graph coordinates for custom SVG renders
  const winProbabilityPath = "M 0 60 C 20 50, 40 85, 60 40 S 80 15, 100 12";
  const winProbabilityPathOverlay = "M 0 60 C 20 50, 40 85, 60 40 S 80 15, 100 12 L 100 100 L 0 100 Z";
  
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-stretch">
      
      {/* 1. Sleek Left Navigation Sidebar (Bento Grid Block) */}
      <div className="xl:col-span-1 flex flex-col justify-between bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80">
        <div className="space-y-8">
          {/* User Profile Card */}
          <div className="flex items-center gap-4 bg-slate-950/60 p-4 border border-slate-800/50 rounded-2xl">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-indigo-600 flex items-center justify-center font-black text-white text-lg shadow-lg">
                {user?.name?.substring(0, 2).toUpperCase() || 'DB'}
              </div>
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-slate-900 animate-pulse"></span>
            </div>
            <div>
              <h4 className="font-extrabold text-white text-sm tracking-wide leading-tight uppercase">
                {user?.name || 'David B.'}
              </h4>
              <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest mt-0.5">
                Rank <span style={{ color: BRAND.orange }}>#42</span>
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, active: true },
              { id: 'picks', label: 'Pick\'em', icon: Zap, tab: 'picks' as const },
              { id: 'survivor', label: 'Survivor', icon: Shield, tab: 'picks' as const },
              { id: 'margin', label: 'Margin', icon: Percent, tab: 'picks' as const },
              { id: 'rules', label: 'Rules & Settings', icon: Settings, tab: 'rules' as const }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setSidebarActive(item.id);
                  if (item.tab) onSelectTab(item.tab);
                }}
                className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 ${
                  sidebarActive === item.id
                    ? 'bg-gradient-to-r from-orange-500/10 to-indigo-600/10 text-white border-l-4 border-orange-500 shadow-md'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'
                }`}
              >
                <item.icon size={16} className={sidebarActive === item.id ? 'text-orange-500' : 'text-slate-500'} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Panel / Logo */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 flex flex-col gap-2">
          {isManager && (
            <button
              onClick={() => onSelectTab('manager')}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all shadow-lg hover:scale-[1.02]"
            >
              <Settings size={14} /> Commissioner
            </button>
          )}
          <button 
            onClick={onBack}
            className="w-full flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white font-extrabold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all"
          >
            <ArrowLeft size={14} /> Leave Pool
          </button>
        </div>
      </div>

      {/* 2. Interactive Main Bento Dashboard Area */}
      <div className="xl:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        
        {/* CARD A: LIVE WEEKLY PICK'EM (Top Left) */}
        <div 
          className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
          style={{ boxShadow: `inset 0 0 20px rgba(59, 130, 246, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Live Weekly Pick'em</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Week {selectedWeek} Matches</p>
              </div>
              <button 
                onClick={() => onSelectTab('picks')}
                className="text-xs font-black uppercase text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
              >
                Upcoming <ChevronRight size={14} />
              </button>
            </div>

            {/* Simulated Live Match Helmets & Score Panel */}
            <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 p-5 rounded-2xl mb-5 flex justify-between items-center relative overflow-hidden">
              <div className="absolute top-2 left-2 z-10">
                <span className="flex items-center gap-1.5 bg-red-500/25 border border-red-500/30 px-2 py-0.5 rounded-full text-[9px] font-black text-red-400 uppercase tracking-widest animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping"></span> Live
                </span>
              </div>

              {/* Helmet Team 1 (BAL) */}
              <div className="flex flex-col items-center gap-1 select-none z-10">
                <FootballHelmet primaryColor="#241773" secondaryColor="#9E7C0C" className="w-20 h-20 filter drop-shadow-[0_0_12px_rgba(36,23,115,0.4)]" />
                <span className="text-xs font-black text-white mt-1">BAL 17</span>
                <span className="text-[9px] font-bold text-slate-500">My Pick: BAL</span>
              </div>

              {/* Matchup Divider */}
              <div className="text-center z-10">
                <span className="text-[10px] font-bold text-slate-600 block uppercase mb-1">Q3 12:45</span>
                <span className="text-lg font-black text-slate-400">VS</span>
              </div>

              {/* Helmet Team 2 (CIN) */}
              <div className="flex flex-col items-center gap-1 select-none z-10">
                <FootballHelmet primaryColor="#FB4F14" secondaryColor="#000000" className="w-20 h-20 filter drop-shadow-[0_0_12px_rgba(251,79,20,0.4)]" />
                <span className="text-xs font-black text-white mt-1">CIN 14</span>
                <span className="text-[9px] font-bold text-slate-500">Spread: +3.0</span>
              </div>
            </div>

            {/* Live Match Stats / Win Probability Graph */}
            <div className="grid grid-cols-2 gap-4">
              {/* Win Probability Panel */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Win Probability</span>
                  <span className="text-sm font-extrabold text-blue-400 leading-none">
                    BAL {liveWinProb}%
                  </span>
                </div>
                <div className="relative h-12 w-full mt-2 overflow-hidden rounded-lg bg-slate-900 border border-slate-800">
                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Background shading */}
                    <path d={winProbabilityPathOverlay} fill="url(#probability-shade)" opacity="0.15" />
                    {/* Dynamic line */}
                    <path d={winProbabilityPath} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  
                  {/* Glowing pointer */}
                  <div className="absolute top-[12%] right-[5%] h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_10px_#3B82F6] animate-pulse"></div>

                  {/* Gradient definitions inside SVG */}
                  <svg className="hidden">
                    <defs>
                      <linearGradient id="probability-shade" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#3B82F6" />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              {/* Matchup Odds listings */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl flex flex-col justify-between">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Selected Week Odds</span>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-400">BAL @ CIN</span>
                    <span className="text-white">+125</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-400">NE @ MIA</span>
                    <span className="text-white">+150</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-400">DAL @ PHI</span>
                    <span className="text-white">+150</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Locks Banner footer inside card */}
          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase flex items-center gap-1">
              <Lock size={12} className="text-slate-600" /> Matches locking soon
            </span>
            <span className="text-amber-400 font-extrabold uppercase animate-pulse">
              11:45 PM EST LOCK
            </span>
          </div>
        </div>

        {/* CARD B: SURVIVOR LEAGUE (Top Right) */}
        <div 
          className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
          style={{ boxShadow: `inset 0 0 20px rgba(16, 185, 129, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Survivor Attrition</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">
                  {survivalLeagueStats.alive} / {survivalLeagueStats.total} Players Alive
                </p>
              </div>
              <button 
                onClick={() => onSelectTab('standings')}
                className="text-xs font-black uppercase text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
              >
                View Grid <ChevronRight size={14} />
              </button>
            </div>

            {/* List of active survivors and their strikes */}
            <div className="space-y-3.5 mb-5">
              {[
                { name: 'John D.', week: 'Week 11', check: true, status: 'ALIVE', strikes: 0, avatar: 'JD' },
                { name: 'Mark S.', week: 'Week 11', check: true, status: 'ALIVE', strikes: 1, avatar: 'MS' },
                { name: 'David B.', week: 'ME - Week 11', check: true, status: 'ALIVE', strikes: 0, avatar: 'DB', highlight: true }
              ].map((member, i) => (
                <div 
                  key={i} 
                  className={`flex justify-between items-center p-3 rounded-2xl border transition-all ${
                    member.highlight 
                      ? 'bg-gradient-to-r from-emerald-500/10 to-indigo-600/10 border-emerald-500/40 shadow-md' 
                      : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center ${
                      member.highlight ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-400'
                    }`}>
                      {member.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-white uppercase">{member.name}</span>
                        {member.check && <CheckCircle2 size={12} className="text-emerald-500" />}
                      </div>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">{member.week}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[9px] font-black text-emerald-400 tracking-wider">
                      {member.status}
                    </span>
                    <div className="text-right">
                      <span className="text-[9px] font-bold text-slate-500 block uppercase leading-none">Strikes</span>
                      <span className={`text-xs font-black ${member.strikes > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {member.strikes}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Attrition/Survival Chart */}
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl relative">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Attrition Trend Line</span>
              <div className="h-16 w-full relative">
                {/* SVG Attrition Line Graph */}
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Grid Lines */}
                  <line x1="0" y1="25" x2="100" y2="25" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="75" x2="100" y2="75" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />
                  
                  {/* Active Entries Line (Blue) */}
                  <path d="M 0 30 Q 30 40, 50 65 T 100 80" fill="none" stroke="#3B82F6" strokeWidth="2.5" />
                  {/* Strikes Line (Orange) */}
                  <path d="M 0 85 Q 25 80, 60 40 T 100 20" fill="none" stroke="#FF6600" strokeWidth="2.5" />
                </svg>
                
                {/* Bottom X labels */}
                <div className="absolute bottom-0 inset-x-0 flex justify-between text-[7px] font-black text-slate-600 px-1 uppercase tracking-widest mt-1">
                  <span>Wk 1</span>
                  <span>Wk 4</span>
                  <span>Wk 8</span>
                  <span>Wk 11</span>
                  <span>Wk 14</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Survivor status</span>
            <span className="text-emerald-400 font-black uppercase">
              David B. is Alive
            </span>
          </div>
        </div>

        {/* CARD C: MARGIN POOL STATS (Bottom Left) */}
        <div 
          className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
          style={{ boxShadow: `inset 0 0 20px rgba(251, 191, 36, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Margin Pool Stats</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Current Week Performance</p>
              </div>
              <span className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Week 12
              </span>
            </div>

            {/* Margin Pool Metric blocks */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { title: 'Weekly Diff', value: '+38 pts', color: 'text-emerald-400' },
                { title: 'Net Margin', value: '+21', color: 'text-emerald-400' },
                { title: 'Rank', value: '#8', color: 'text-orange-500' }
              ].map((stat, i) => (
                <div key={i} className="bg-slate-950/60 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">
                    {stat.title}
                  </span>
                  <span className={`text-sm font-black ${stat.color} tracking-wide`}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Weekly Margin Bar Chart */}
            <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl mb-5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-3">Weekly Net Margins</span>
              <div className="h-16 flex items-end justify-between gap-1 px-1">
                {[12, 18, 14, 25, 29, 21, -8, 18, 14, 11, 23, 21].map((val, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center h-full justify-end relative group">
                    <div 
                      className={`w-full rounded-t-sm transition-all duration-300 group-hover:brightness-110 ${
                        val < 0 
                          ? 'bg-orange-500 shadow-[0_-2px_10px_rgba(255,102,0,0.3)]' 
                          : i === 11 
                            ? 'bg-gradient-to-t from-orange-500 to-indigo-600 shadow-[0_-2px_10px_rgba(255,102,0,0.4)]'
                            : 'bg-blue-500 shadow-[0_-2px_10px_rgba(59,130,246,0.3)]'
                      }`}
                      style={{ 
                        height: `${Math.abs(val) * 2.2}%`,
                        maxHeight: '100%'
                      }}
                    ></div>
                    {/* Hover tooltip */}
                    <span className="absolute -top-6 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded text-[8px] font-black text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                      {val > 0 ? `+${val}` : val}
                    </span>
                    <span className="text-[7px] font-bold text-slate-600 uppercase mt-1 block">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Pool Activity Feed */}
            <div className="space-y-2.5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Recent Pool Activity</span>
              <div className="flex justify-between items-center bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-slate-850 flex items-center justify-center font-bold text-[9px] text-slate-400 border border-slate-800">
                    AR
                  </div>
                  <span className="font-extrabold text-white text-[10px] uppercase">Alex R.</span>
                  <span className="text-slate-500 text-[10px]">submitted picks</span>
                </div>
                <span className="text-emerald-400 font-bold text-[10px]">+38 pts</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Margin statistics</span>
            <span className="text-emerald-400 font-black uppercase">
              Consistent Performance
            </span>
          </div>
        </div>

        {/* CARD D: GLOBAL STANDINGS (Bottom Right) */}
        <div 
          className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 flex flex-col justify-between"
          style={{ boxShadow: `inset 0 0 20px rgba(99, 102, 241, 0.05), 0 10px 40px rgba(0,0,0,0.4)` }}
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Global Standings</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Leaderboard Positions</p>
              </div>
              <button 
                onClick={() => onSelectTab('standings')}
                className="text-xs font-black uppercase text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                Full Standings <ChevronRight size={14} />
              </button>
            </div>

            {/* Standings Rows with Highlight for David B (Active User) */}
            <div className="space-y-3">
              {[
                { rank: 1, name: 'Sarah K.', detail: 'TOP RANKED', pts: 198, trend: 'updown', avatar: 'SK', color: '#3B82F6' },
                { rank: 2, name: 'Mark S.', detail: 'WEEK 11: 4', pts: 198, trend: 'down', avatar: 'MS', color: '#FF6600' },
                { rank: 3, name: 'David B.', detail: 'ME - WEEK 11', pts: '#3rd', trend: 'up', avatar: 'DB', highlight: true, color: '#10B981' },
                { rank: 4, name: 'Alex R.', detail: 'TOP RANKED', pts: 198, trend: 'up', avatar: 'AR', color: '#10B981' },
                { rank: 5, name: 'Emily L.', detail: 'WEEK 11: 2', pts: 198, trend: 'down', avatar: 'EL', color: '#FF6600' }
              ].map((row, i) => (
                <div 
                  key={i} 
                  className={`flex justify-between items-center p-3 rounded-2xl border transition-all ${
                    row.highlight 
                      ? 'bg-gradient-to-r from-orange-500/10 to-indigo-600/10 border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.25)] scale-[1.02]' 
                      : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-500 w-3 text-center">{row.rank}</span>
                    <div className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center ${
                      row.highlight ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-900 text-slate-400'
                    }`}>
                      {row.avatar}
                    </div>
                    <div>
                      <span className="text-xs font-extrabold text-white block uppercase leading-none mb-1">{row.name}</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">{row.detail}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* SVG Trend Sparkline */}
                    <div className="w-12 h-6 overflow-hidden select-none">
                      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        {row.trend === 'up' && (
                          <path d="M 0 80 Q 40 70, 70 20 T 100 10" fill="none" stroke={row.color} strokeWidth="3" strokeLinecap="round" />
                        )}
                        {row.trend === 'down' && (
                          <path d="M 0 10 Q 30 20, 60 70 T 100 90" fill="none" stroke={row.color} strokeWidth="3" strokeLinecap="round" />
                        )}
                        {row.trend === 'updown' && (
                          <path d="M 0 50 Q 25 20, 50 80 T 100 50" fill="none" stroke={row.color} strokeWidth="3" strokeLinecap="round" />
                        )}
                      </svg>
                    </div>

                    <div className="text-right w-12">
                      <span className="text-[9px] font-bold text-slate-500 block uppercase leading-none">Score</span>
                      <span className="text-xs font-black text-white font-mono">{row.pts}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Standings index</span>
            <span className="text-indigo-400 font-black uppercase">
              David B. is #3
            </span>
          </div>
        </div>

      </div>

      {/* 3. Floating Bottom Timeline Block */}
      <div className="xl:col-span-5 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-5 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-6 overflow-x-auto select-none py-2 px-4 whitespace-nowrap">
          
          {/* Timeline Node 1 */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
            <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest block mb-0.5 transition-colors group-hover:text-slate-400">
              NFL Kickoff
            </span>
            <span className="text-emerald-400 font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span> Sep 10
            </span>
          </div>

          {/* Spacer Line */}
          <div className="hidden sm:block w-px h-8 bg-slate-800/80"></div>

          {/* Timeline Node 2 */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
            <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest block mb-0.5 transition-colors group-hover:text-slate-400">
              Mid-Season Rebuy
            </span>
            <span className="text-amber-400 font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span> Week 4-6 Cutoff
            </span>
          </div>

          {/* Spacer Line */}
          <div className="hidden sm:block w-px h-8 bg-slate-800/80"></div>

          {/* Timeline Node 3 */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
            <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest block mb-0.5 transition-colors group-hover:text-slate-400">
              Super Bowl LX
            </span>
            <span className="text-white font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-white"></span> Feb 8
            </span>
          </div>

          {/* Action Call to join */}
          <div className="sm:ml-auto w-full sm:w-auto">
            <button 
              onClick={() => onSelectTab('picks')}
              className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-700 text-white font-black text-xs uppercase tracking-widest py-3 px-6 rounded-2xl transition-all shadow-lg hover:shadow-orange-500/20 hover:scale-[1.03]"
            >
              Submit My Picks Now
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
