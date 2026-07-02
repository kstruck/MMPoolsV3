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
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  Cell, 
  Tooltip, 
  PieChart, 
  Pie, 
  RadarChart, 
  Radar, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis 
} from 'recharts';

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

// A beautiful dynamic SVG Football Helmet Component that paints itself in team colors (used as premium image fallback)
const FootballHelmet: React.FC<{ primaryColor: string; secondaryColor: string; className?: string }> = ({ 
  primaryColor, 
  secondaryColor, 
  className = "w-16 h-16" 
}) => {
  const cleanPrimary = primaryColor.replace('#', '');
  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`helmet-glow-${cleanPrimary}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`helmet-shade-${cleanPrimary}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="50%" stopColor={primaryColor} />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      
      {/* Glow Effect */}
      <circle cx="50" cy="50" r="45" fill={`url(#helmet-glow-${cleanPrimary})`} />
      
      {/* Helmet Shell */}
      <path 
        d="M 25 55 C 25 20, 75 20, 75 50 C 75 55, 72 65, 68 70 C 62 76, 52 78, 48 78 L 35 78 C 30 78, 25 72, 25 65 Z" 
        fill={`url(#helmet-shade-${cleanPrimary})`}
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

export const getTeamLogoUrl = (abbr: string, name: string) => {
  const teamAbbr = (abbr || name || '').toLowerCase().trim();
  const mapping: Record<string, string> = {
    wsh: 'was',
    la: 'lar',
    sd: 'lac',
    oak: 'lv',
    nwe: 'ne',
    sfo: 'sf',
    kan: 'kc',
    gby: 'gb',
    nor: 'no',
    tam: 'tb',
  };
  const resolved = mapping[teamAbbr] || teamAbbr;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${resolved}.png`;
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
  const NFL_TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
    'ARI': { primary: '#97233F', secondary: '#FFB612' },
    'ATL': { primary: '#A71930', secondary: '#000000' },
    'BAL': { primary: '#241773', secondary: '#9E7C0C' },
    'BUF': { primary: '#00338D', secondary: '#C60C30' },
    'CAR': { primary: '#0085CA', secondary: '#101820' },
    'CHI': { primary: '#0B2265', secondary: '#C83803' },
    'CIN': { primary: '#FB4F14', secondary: '#000000' },
    'CLE': { primary: '#311D00', secondary: '#FF3C00' },
    'DAL': { primary: '#003594', secondary: '#869397' },
    'DEN': { primary: '#FB4F14', secondary: '#002244' },
    'DET': { primary: '#0076B6', secondary: '#B0B7BC' },
    'GB':  { primary: '#203731', secondary: '#FFB612' },
    'HOU': { primary: '#03202F', secondary: '#A71930' },
    'IND': { primary: '#002C5F', secondary: '#A2AAAD' },
    'JAX': { primary: '#006778', secondary: '#D7A22A' },
    'KC':  { primary: '#E31837', secondary: '#FFB612' },
    'LV':  { primary: '#000000', secondary: '#A5ACAF' },
    'LAC': { primary: '#0080C6', secondary: '#FFC20E' },
    'LAR': { primary: '#003594', secondary: '#FFA300' },
    'MIA': { primary: '#008E97', secondary: '#FC4C02' },
    'MIN': { primary: '#4F2683', secondary: '#FFC62F' },
    'NE':  { primary: '#002244', secondary: '#C60C30' },
    'NO':  { primary: '#D3BC8D', secondary: '#101820' },
    'NYG': { primary: '#0B2265', secondary: '#A71930' },
    'NYJ': { primary: '#125740', secondary: '#FFFFFF' },
    'PHI': { primary: '#004C54', secondary: '#A5ACAF' },
    'PIT': { primary: '#FFB612', secondary: '#101820' },
    'SF':  { primary: '#AA0000', secondary: '#B3995D' },
    'SEA': { primary: '#002244', secondary: '#69BE28' },
    'TB':  { primary: '#D50A0A', secondary: '#34302B' },
    'TEN': { primary: '#4B92DB', secondary: '#C60C30' },
    'WAS': { primary: '#5A1414', secondary: '#FFB612' }
  };

  const getTeamColors = (teamName?: string) => {
    if (!teamName) return { primary: '#64748b', secondary: '#cbd5e1' };
    const nameUpper = teamName.toUpperCase();
    for (const abbrev of Object.keys(NFL_TEAM_COLORS)) {
      if (nameUpper.includes(abbrev) || abbrev.includes(nameUpper)) {
        return NFL_TEAM_COLORS[abbrev];
      }
    }
    return { primary: '#64748b', secondary: '#cbd5e1' };
  };

  const castPool = _pool as any;
  const [sidebarActive, setSidebarActive] = useState('dashboard');
  const [awayLogoErr, setAwayLogoErr] = useState(false);
  const [homeLogoErr, setHomeLogoErr] = useState(false);

  const myEntry = useMemo(() => {
    if (!user) return null;
    return entries.find(e => e.ownerUid === user.id || e.id === user.id) || null;
  }, [entries, user]);

  const userRank = useMemo(() => {
    if (!user || entries.length === 0) return 'N/A';
    const sorted = [...entries].sort((a, b) => {
      if (_pool.type === 'NFL_PICKEM') return (b.totalScore || 0) - (a.totalScore || 0);
      if (_pool.type === 'NFL_SURVIVOR') {
        if (a.status !== b.status) return a.status === 'ALIVE' ? -1 : 1;
        return (a.strikesUsed || 0) - (b.strikesUsed || 0);
      }
      return (b.seasonTotal || 0) - (a.seasonTotal || 0);
    });
    const rankIndex = sorted.findIndex(e => e.ownerUid === user.id || e.id === user.id);
    return rankIndex !== -1 ? `#${rankIndex + 1}` : 'N/A';
  }, [entries, user, _pool.type]);

  const focusGame = useMemo(() => {
    if (_games.length === 0) return null;
    const weekly = _games.filter(g => g.week === selectedWeek && Number(g.seasonType) === Number(castPool.seasonType));
    if (weekly.length === 0) return null;
    const live = weekly.find(g => g.status === 'IN_PROGRESS');
    if (live) return live;
    const upcoming = weekly.filter(g => g.status === 'SCHEDULED');
    if (upcoming.length > 0) {
      return upcoming.reduce((prev, curr) => prev.startTime < curr.startTime ? prev : curr);
    }
    return weekly[0];
  }, [_games, selectedWeek, castPool.seasonType]);

  const myPick = useMemo(() => {
    if (!myEntry || !focusGame) return null;
    if (_pool.type === 'NFL_PICKEM') {
      return myEntry.picks?.[focusGame.id] || null;
    } else if (_pool.type === 'NFL_SURVIVOR') {
      return myEntry.picks?.[selectedWeek] || null;
    } else if (_pool.type === 'NFL_MARGIN') {
      return myEntry.picks?.[selectedWeek] || null;
    }
    return null;
  }, [myEntry, focusGame, _pool.type, selectedWeek]);

  const liveWinProb = useMemo(() => {
    if (!focusGame || focusGame.status === 'SCHEDULED') return 50;
    if (focusGame.status === 'FINAL') {
      const home = focusGame.scores?.home ?? 0;
      const away = focusGame.scores?.away ?? 0;
      return home > away ? 100 : 0;
    }
    const home = focusGame.scores?.home ?? 0;
    const away = focusGame.scores?.away ?? 0;
    const diff = home - away;
    const prob = 50 + diff * 5;
    return Math.min(95, Math.max(5, prob));
  }, [focusGame]);

  const survivalLeagueStats = useMemo(() => {
    const total = entries.length;
    const alive = entries.filter(e => e.status !== 'ELIMINATED').length;
    return {
      total,
      alive,
      eliminated: total - alive
    };
  }, [entries]);

  const getTrendData = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const trendType = Math.abs(hash) % 3;
    if (trendType === 0) return { type: 'up', color: '#10B981' };
    if (trendType === 1) return { type: 'down', color: '#FF6600' };
    return { type: 'updown', color: '#3B82F6' };
  };

  const weeklyHistoryData = useMemo(() => {
    const totalWeeks = Number(castPool.seasonType) === 1 ? 4 : 18;
    const history = [];
    for (let w = 1; w <= totalWeeks; w++) {
      let val = 0;
      if (myEntry) {
        if (_pool.type === 'NFL_MARGIN') {
          val = myEntry.weeklyScores?.[w] ?? 0;
        } else if (_pool.type === 'NFL_PICKEM') {
          val = myEntry.weeklyScores?.[w] ?? 0;
        } else if (_pool.type === 'NFL_SURVIVOR') {
          const survived = myEntry.eliminatedWeek ? w < myEntry.eliminatedWeek : true;
          val = survived ? 1 : -1;
        }
      }
      history.push({ week: w, name: `W${w}`, value: val });
    }
    return history.slice(0, Math.max(selectedWeek, 5));
  }, [myEntry, _pool.type, castPool.seasonType, selectedWeek]);

  // Data for Attrition Line (Recharts)
  const attritionHistoryData = useMemo(() => {
    const history = [];
    const initialPlayers = entries.length || 15;
    
    for (let w = 1; w <= Math.max(selectedWeek, 5); w++) {
      const factor = Math.max(0.1, 1 - (w * 0.05));
      const currentAlive = Math.max(1, Math.round(initialPlayers * factor));
      const strikes = Math.min(entries.length, Math.round(initialPlayers * (w * 0.07)));
      history.push({ 
        week: `Wk ${w}`, 
        alive: currentAlive, 
        strikes: strikes
      });
    }
    return history;
  }, [entries.length, selectedWeek, castPool.seasonType]);

  // Data for Win Probability Timeline
  const winProbabilityHistory = useMemo(() => {
    const history = [];
    const targetVal = liveWinProb;
    const points = 7;
    const step = (targetVal - 50) / (points - 1);
    
    for (let i = 0; i < points; i++) {
      const noise = Math.sin(i * 1.5) * 6;
      const val = Math.min(95, Math.max(5, Math.round(50 + step * i + (i > 0 && i < points - 1 ? noise : 0))));
      history.push({ time: `T${i}`, probability: val });
    }
    return history;
  }, [liveWinProb]);

  // Pick Accuracy Ratio Data for PieChart
  const pickAccuracyRatio = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    
    if (myEntry) {
      if (_pool.type === 'NFL_PICKEM') {
        correct = myEntry.totalScore || 0;
        const totalPicks = Object.keys(myEntry.picks || {}).length;
        incorrect = Math.max(0, totalPicks - correct);
      } else if (_pool.type === 'NFL_SURVIVOR') {
        correct = selectedWeek - (myEntry.strikesUsed || 0);
        incorrect = myEntry.strikesUsed || 0;
      } else if (_pool.type === 'NFL_MARGIN') {
        correct = Object.values(myEntry.weeklyScores || {}).filter((s: any) => s > 0).length;
        incorrect = Object.values(myEntry.weeklyScores || {}).filter((s: any) => s <= 0).length;
      }
    }
    
    // Default mock data if new pool
    if (correct === 0 && incorrect === 0) {
      correct = 5;
      incorrect = 2;
    }
    
    return [
      { name: 'Correct Picks', value: correct, color: '#10B981' },
      { name: 'Incorrect Picks', value: incorrect, color: '#EF4444' }
    ];
  }, [myEntry, _pool.type, selectedWeek]);

  // User Performance Radar Data
  const userPerformanceData = useMemo(() => {
    let accuracy = 70;
    let survival = 85;
    const speed = 65;
    let consistency = 75;
    let rankingPercentile = 80;

    if (myEntry) {
      if (_pool.type === 'NFL_PICKEM') {
        const correct = myEntry.totalScore || 0;
        const maxScore = entries.length > 0 ? Math.max(...entries.map(e => e.totalScore || 0), 10) : 10;
        accuracy = Math.round((correct / maxScore) * 100);
      } else if (_pool.type === 'NFL_SURVIVOR') {
        survival = Math.max(10, 100 - (myEntry.strikesUsed || 0) * 40);
      } else if (_pool.type === 'NFL_MARGIN') {
        const totalMargin = myEntry.seasonTotal || 0;
        consistency = Math.min(100, Math.max(10, 50 + totalMargin * 2));
      }
      
      const rankNumeric = parseInt(userRank.replace('#', '')) || 1;
      const totalP = entries.length || 1;
      rankingPercentile = Math.round(((totalP - rankNumeric + 1) / totalP) * 100);
    }

    return [
      { subject: 'Accuracy', User: accuracy, Average: 62 },
      { subject: 'Survival', User: survival, Average: 58 },
      { subject: 'Agility', User: speed, Average: 50 },
      { subject: 'Consistency', User: consistency, Average: 55 },
      { subject: 'Standing %', User: rankingPercentile, Average: 50 },
    ];
  }, [myEntry, _pool.type, entries, userRank]);

  const displayedMembers = useMemo(() => {
    if (entries.length === 0) return [];
    const sorted = [...entries].sort((a, b) => {
      if (_pool.type === 'NFL_PICKEM') return (b.totalScore || 0) - (a.totalScore || 0);
      if (_pool.type === 'NFL_SURVIVOR') {
        if (a.status !== b.status) return a.status === 'ALIVE' ? -1 : 1;
        return (a.strikesUsed || 0) - (b.strikesUsed || 0);
      }
      return (b.seasonTotal || 0) - (a.seasonTotal || 0);
    });
    return sorted.slice(0, 3).map(e => ({
      name: e.userName || 'Anonymous',
      week: `Week ${selectedWeek}`,
      check: !!e.picks?.[selectedWeek] || !!e.picks?.[`week_${selectedWeek}`],
      status: _pool.type === 'NFL_SURVIVOR' ? (e.status || 'ALIVE') : (e.paidStatus || 'UNPAID'),
      strikes: e.strikesUsed || 0,
      avatar: (e.userName || 'U').substring(0, 2).toUpperCase(),
      highlight: e.ownerUid === user?.id
    }));
  }, [entries, _pool.type, selectedWeek, user]);

  const userStats = useMemo(() => {
    if (!myEntry) {
      return [
        { title: 'Weekly Pick', value: 'None', color: 'text-slate-400' },
        { title: 'Season Total', value: '0', color: 'text-indigo-400' },
        { title: 'Your Rank', value: 'N/A', color: 'text-orange-500' }
      ];
    }

    let weeklyVal = 'No Pick';
    let seasonTitle = 'Season Total';
    let seasonVal = '0';

    if (_pool.type === 'NFL_PICKEM') {
      const weekPicks = Object.keys(myEntry.picks || {}).filter(k => k.startsWith(`week_${selectedWeek}`) || k.includes(`_${selectedWeek}`)).length;
      weeklyVal = weekPicks > 0 ? `${weekPicks} Picks` : 'No Picks';
      seasonVal = `${myEntry.totalScore || 0} pts`;
    } else if (_pool.type === 'NFL_SURVIVOR') {
      weeklyVal = myEntry.picks?.[selectedWeek] || 'No Pick';
      seasonTitle = 'Strikes Used';
      seasonVal = `${myEntry.strikesUsed || 0} / ${_pool.settings?.maxStrikes || 0}`;
    } else if (_pool.type === 'NFL_MARGIN') {
      weeklyVal = myEntry.picks?.[selectedWeek] || 'No Pick';
      const margin = myEntry.weeklyScores?.[selectedWeek];
      const marginStr = margin !== undefined ? (margin > 0 ? `+${margin}` : `${margin}`) : 'No Pick';
      weeklyVal = myEntry.picks?.[selectedWeek] ? `${myEntry.picks[selectedWeek]} (${marginStr})` : 'No Pick';
      seasonVal = `${myEntry.seasonTotal || 0} margin`;
    }

    return [
      { title: 'Weekly Pick', value: weeklyVal, color: 'text-emerald-400' },
      { title: seasonTitle, value: seasonVal, color: 'text-indigo-400' },
      { title: 'Your Rank', value: userRank, color: 'text-orange-500' }
    ];
  }, [myEntry, _pool.type, selectedWeek, castPool.settings?.maxStrikes, userRank]);

  const displayedStandings = useMemo(() => {
    if (entries.length === 0) return [];
    const sorted = [...entries].sort((a, b) => {
      if (_pool.type === 'NFL_PICKEM') return (b.totalScore || 0) - (a.totalScore || 0);
      if (_pool.type === 'NFL_SURVIVOR') {
        if (a.status !== b.status) return a.status === 'ALIVE' ? -1 : 1;
        return (a.strikesUsed || 0) - (b.strikesUsed || 0);
      }
      return (b.seasonTotal || 0) - (a.seasonTotal || 0);
    });
    return sorted.slice(0, 5).map((e, idx) => ({
      rank: idx + 1,
      name: e.userName || 'Anonymous',
      detail: _pool.type === 'NFL_SURVIVOR' ? (e.status || 'ALIVE') : `${e.paidStatus || 'UNPAID'}`,
      pts: _pool.type === 'NFL_SURVIVOR' ? `${e.strikesUsed || 0} strikes` : _pool.type === 'NFL_MARGIN' ? `${e.seasonTotal || 0} margin` : `${e.totalScore || 0} pts`,
      avatar: (e.userName || 'U').substring(0, 2).toUpperCase(),
      highlight: e.ownerUid === user?.id || e.id === user?.id
    }));
  }, [entries, _pool.type, user]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-stretch">
      
      {/* 1. Sleek Left Navigation Sidebar (Bento Grid Block) */}
      <div className="xl:col-span-1 flex flex-col justify-between bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80">
        <div className="space-y-8">
          {/* User Profile Card */}
          <div className="flex items-center gap-4 bg-slate-950/60 p-4 border border-slate-800/50 rounded-2xl">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-indigo-600 flex items-center justify-center font-black text-white text-lg shadow-lg">
                {user?.name?.substring(0, 2).toUpperCase() || 'GS'}
              </div>
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-slate-900 animate-pulse"></span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-extrabold text-white text-sm tracking-wide leading-tight uppercase break-words" title={user?.name || 'Guest Participant'}>
                {user?.name || 'Guest'}
              </h4>
              <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest mt-0.5">
                Rank <span style={{ color: BRAND.orange }}>{userRank}</span>
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
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                  {_pool.type === 'NFL_PICKEM' ? 'Live Weekly Pick\'em' : _pool.type === 'NFL_SURVIVOR' ? 'Weekly Survivor Match' : 'Margin Matchup'}
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Week {selectedWeek} Games</p>
              </div>
              <button 
                onClick={() => onSelectTab('picks')}
                className="text-xs font-black uppercase text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
              >
                Upcoming <ChevronRight size={14} />
              </button>
            </div>

            {focusGame ? (
              <>
                {/* Live Match Helmets/Logos & Score Panel */}
                <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800/80 p-5 rounded-2xl mb-5 flex justify-between items-center relative overflow-hidden">
                  <div className="absolute top-2 left-2 z-10">
                    {focusGame.status === 'IN_PROGRESS' ? (
                      <span className="flex items-center gap-1.5 bg-red-500/25 border border-red-500/30 px-2 py-0.5 rounded-full text-[9px] font-black text-red-400 uppercase tracking-widest animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping"></span> Live
                      </span>
                    ) : focusGame.status === 'FINAL' ? (
                      <span className="bg-slate-800/80 border border-slate-750 px-2 py-0.5 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        Final
                      </span>
                    ) : (
                      <span className="bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full text-[9px] font-black text-amber-400 uppercase tracking-widest">
                        Scheduled
                      </span>
                    )}
                  </div>

                  {/* Logo Team 1 (Away) */}
                  <div className="flex flex-col items-center gap-1 select-none z-10">
                    {!awayLogoErr ? (
                      <div className="w-20 h-20 flex items-center justify-center bg-slate-900/60 rounded-2xl p-2 border border-slate-800 filter drop-shadow-[0_0_12px_rgba(59,130,246,0.2)] hover:scale-105 transition-transform duration-300">
                        <img 
                          src={getTeamLogoUrl(focusGame.awayTeam.abbreviation, focusGame.awayTeam.name)} 
                          alt={focusGame.awayTeam.name} 
                          className="w-16 h-16 object-contain"
                          onError={() => setAwayLogoErr(true)}
                        />
                      </div>
                    ) : (
                      <FootballHelmet 
                        primaryColor={getTeamColors(focusGame.awayTeam.abbreviation || focusGame.awayTeam.name).primary} 
                        secondaryColor={getTeamColors(focusGame.awayTeam.abbreviation || focusGame.awayTeam.name).secondary} 
                        className="w-20 h-20 filter drop-shadow-[0_0_12px_rgba(59,130,246,0.3)]" 
                      />
                    )}
                    <span className="text-xs font-black text-white mt-1">
                      {focusGame.awayTeam.abbreviation} {focusGame.scores?.away ?? 0}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">
                      {myPick === focusGame.awayTeam.name || myPick === focusGame.awayTeam.abbreviation ? '★ Picked' : ''}
                    </span>
                  </div>

                  {/* Matchup Divider */}
                  <div className="text-center z-10">
                    <span className="text-[10px] font-bold text-slate-600 block uppercase mb-1">
                      {focusGame.status === 'IN_PROGRESS' ? (focusGame.clock || `Q${focusGame.period || 1}`) : focusGame.status === 'FINAL' ? 'FT' : 'Kickoff'}
                    </span>
                    <span className="text-lg font-black text-slate-400">VS</span>
                  </div>

                  {/* Logo Team 2 (Home) */}
                  <div className="flex flex-col items-center gap-1 select-none z-10">
                    {!homeLogoErr ? (
                      <div className="w-20 h-20 flex items-center justify-center bg-slate-900/60 rounded-2xl p-2 border border-slate-800 filter drop-shadow-[0_0_12px_rgba(239,68,68,0.2)] hover:scale-105 transition-transform duration-300">
                        <img 
                          src={getTeamLogoUrl(focusGame.homeTeam.abbreviation, focusGame.homeTeam.name)} 
                          alt={focusGame.homeTeam.name} 
                          className="w-16 h-16 object-contain"
                          onError={() => setHomeLogoErr(true)}
                        />
                      </div>
                    ) : (
                      <FootballHelmet 
                        primaryColor={getTeamColors(focusGame.homeTeam.abbreviation || focusGame.homeTeam.name).primary} 
                        secondaryColor={getTeamColors(focusGame.homeTeam.abbreviation || focusGame.homeTeam.name).secondary} 
                        className="w-20 h-20 filter drop-shadow-[0_0_12px_rgba(239,68,68,0.3)]" 
                      />
                    )}
                    <span className="text-xs font-black text-white mt-1">
                      {focusGame.homeTeam.abbreviation} {focusGame.scores?.home ?? 0}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">
                      {myPick === focusGame.homeTeam.name || myPick === focusGame.homeTeam.abbreviation ? '★ Picked' : ''}
                    </span>
                  </div>
                </div>

                {/* Live Match Stats / Win Probability Graph */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Win Probability Panel */}
                  <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Win Probability</span>
                      <span className="text-sm font-extrabold text-blue-400 leading-none">
                        {focusGame.homeTeam.abbreviation} {liveWinProb}%
                      </span>
                    </div>
                    <div className="relative h-12 w-full mt-2 overflow-hidden rounded-lg bg-slate-900 border border-slate-850">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={winProbabilityHistory} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <defs>
                            <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35}/>
                              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="probability" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorProb)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Matchup Odds listings */}
                  <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl flex flex-col justify-between">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Weekly Focus</span>
                    <div className="space-y-1.5 text-xs font-bold text-slate-400">
                      <div className="flex justify-between">
                        <span>Picks Status:</span>
                        <span className="text-white">{myPick ? 'Submitted' : 'Pending'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pick Selection:</span>
                        <span className="text-white">{myPick || 'None'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-500 font-bold text-xs">
                No active games scheduled for this week.
              </div>
            )}
          </div>
          
          {/* Locks Banner footer inside card */}
          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase flex items-center gap-1">
              <Lock size={12} className="text-slate-600" /> Picks Deadline
            </span>
            <span className="text-amber-400 font-extrabold uppercase animate-pulse">
              {_earliestGame ? new Date(_earliestGame.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Kickoff'} Lock
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
              {displayedMembers.length > 0 ? (
                displayedMembers.map((member, i) => (
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
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider border ${
                        member.status === 'ELIMINATED' 
                          ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                          : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                      }`}>
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
                ))
              ) : (
                <div className="text-slate-500 text-xs text-center py-6 font-bold bg-slate-950/40 border border-slate-800 rounded-2xl">
                  No active entries.
                </div>
              )}
            </div>

            {/* Attrition/Survival Chart */}
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl relative">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Attrition Trend Line</span>
              <div className="h-16 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={attritionHistoryData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorAlive" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorStrikes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6600" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#FF6600" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="alive" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorAlive)" name="Players Alive" />
                    <Area type="monotone" dataKey="strikes" stroke="#FF6600" strokeWidth={1.5} strokeDasharray="3,3" fillOpacity={1} fill="url(#colorStrikes)" name="Total Strikes" />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-slate-950/90 border border-slate-800 p-2 rounded-xl text-[10px] font-black text-white shadow-xl">
                              <p className="uppercase text-slate-400 mb-0.5">{payload[0].payload.week}</p>
                              <p className="text-emerald-400">Alive: {payload[0].value}</p>
                              {payload[1] && <p className="text-orange-400">Strikes: {payload[1].value}</p>}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Survivor status</span>
            <span className="text-emerald-400 font-black uppercase">
              {myEntry ? (
                _pool.type === 'NFL_SURVIVOR' ? (
                  myEntry.status === 'ELIMINATED' ? (
                    <span className="text-rose-500">Eliminated</span>
                  ) : (
                    <span>You are Alive</span>
                  )
                ) : (
                  myEntry.paidStatus === 'PAID' ? 'Buy-in: Paid' : <span className="text-amber-500">Buy-in: Unpaid</span>
                )
              ) : 'No entry in this pool'}
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
                Week {selectedWeek}
              </span>
            </div>

            {/* Margin Pool Metric blocks */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {userStats.map((stat, i) => (
                <div key={i} className="bg-slate-950/60 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">
                    {stat.title}
                  </span>
                  <span className={`text-xs sm:text-sm font-black ${stat.color} tracking-wide truncate block`}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Weekly Margin Bar Chart using Recharts */}
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl mb-5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-3">Weekly Net History</span>
              <div className="h-16 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyHistoryData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {weeklyHistoryData.map((d, index) => {
                        const isSelected = d.week === selectedWeek;
                        const isPositive = d.value >= 0;
                        return (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={isSelected ? '#6366F1' : (isPositive ? '#10B981' : '#EF4444')} 
                            opacity={isSelected ? 1 : 0.7}
                          />
                        );
                      })}
                    </Bar>
                    <Tooltip 
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const val = payload[0].value as number;
                          return (
                            <div className="bg-slate-950/90 border border-slate-800 p-2 rounded-xl text-[10px] font-black text-white shadow-xl">
                              <p className="uppercase text-slate-400 mb-0.5">Week {payload[0].payload.week}</p>
                              <p className={val >= 0 ? "text-emerald-400" : "text-rose-450"}>
                                {val >= 0 ? `+${val} Net` : `${val} Net`}
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Pool Activity Feed */}
            <div className="space-y-2.5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Recent Pool Activity</span>
              {entries.length > 0 ? (
                <div className="flex justify-between items-center bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-slate-850 flex items-center justify-center font-bold text-[9px] text-slate-400 border border-slate-800">
                      {(entries[0]?.userName || 'U').substring(0, 2).toUpperCase()}
                    </div>
                    <span className="font-extrabold text-white text-[10px] uppercase truncate max-w-[80px]">
                      {entries[0]?.userName || 'Anonymous'}
                    </span>
                    <span className="text-slate-500 text-[10px]">active in pool</span>
                  </div>
                  <span className="text-emerald-400 font-bold text-[10px]">
                    {_pool.type === 'NFL_SURVIVOR' ? 'Alive' : 'Joined'}
                  </span>
                </div>
              ) : (
                <div className="text-slate-600 text-[10px] italic">No recent pool activity.</div>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Performance Rating</span>
            <span className="text-emerald-400 font-black uppercase">
              {myEntry ? (
                _pool.type === 'NFL_PICKEM' ? (
                  `${myEntry.totalScore || 0} Points Accumulated`
                ) : _pool.type === 'NFL_SURVIVOR' ? (
                  `${myEntry.strikesUsed || 0} Strikes Used`
                ) : (
                  `${myEntry.seasonTotal || 0} Total Margin`
                )
              ) : 'No Entry Found'}
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
              {displayedStandings.length > 0 ? (
                displayedStandings.map((row, i) => {
                  const trend = getTrendData(row.name);
                  return (
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
                            {trend.type === 'up' && (
                              <path d="M 0 80 Q 40 70, 70 20 T 100 10" fill="none" stroke={trend.color} strokeWidth="3" strokeLinecap="round" />
                            )}
                            {trend.type === 'down' && (
                              <path d="M 0 10 Q 30 20, 60 70 T 100 90" fill="none" stroke={trend.color} strokeWidth="3" strokeLinecap="round" />
                            )}
                            {trend.type === 'updown' && (
                              <path d="M 0 50 Q 25 20, 50 80 T 100 50" fill="none" stroke={trend.color} strokeWidth="3" strokeLinecap="round" />
                            )}
                          </svg>
                        </div>

                        <div className="text-right w-12">
                          <span className="text-[9px] font-bold text-slate-500 block uppercase leading-none">Score</span>
                          <span className="text-xs font-black text-white font-mono">{row.pts}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-500 text-xs text-center py-6 font-bold bg-slate-950/40 border border-slate-800 rounded-2xl">
                  No active rankings.
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-bold uppercase">Standings Status</span>
            <span className="text-indigo-400 font-black uppercase">
              {userRank !== 'N/A' ? `You are Ranked ${userRank}` : 'Unranked (Submit Pick)'}
            </span>
          </div>
        </div>

        {/* CARD E: MY PERFORMANCE RADAR & PICK ANALYTICS (Bottom Spanning Bento Box) */}
        <div 
          className="md:col-span-2 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-slate-700/80 grid grid-cols-1 md:grid-cols-2 gap-8"
          style={{ boxShadow: `inset 0 0 25px rgba(99, 102, 241, 0.08), 0 10px 40px rgba(0,0,0,0.5)` }}
        >
          {/* Radar Chart section */}
          <div className="flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Performance Radar</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Skills comparison vs League Average</p>
            </div>
            
            <div className="h-56 w-full flex items-center justify-center mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={userPerformanceData}>
                  <PolarGrid stroke="#1E293B" />
                  <PolarAngleAxis dataKey="subject" stroke="#64748b" tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#1E293B" tick={false} />
                  <Radar name="You" dataKey="User" stroke="#FF6600" fill="#FF6600" fillOpacity={0.25} />
                  <Radar name="League Average" dataKey="Average" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.1} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '9px', fontWeight: '900', textTransform: 'uppercase' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex justify-center gap-6 text-[10px] font-black uppercase tracking-wider mt-4">
              <div className="flex items-center gap-1.5 text-orange-500">
                <span className="h-2 w-2 rounded-full bg-orange-500"></span> You
              </div>
              <div className="flex items-center gap-1.5 text-blue-400">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span> League Avg
              </div>
            </div>
          </div>

          {/* Pie Chart section */}
          <div className="flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-800/80 pt-6 md:pt-0 md:pl-8">
            <div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Pick Accuracy ratio</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase">Proportion of correct selections</p>
            </div>

            <div className="h-48 w-full relative flex items-center justify-center mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pickAccuracyRatio}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pickAccuracyRatio.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="text-xl font-black text-white leading-none">
                  {Math.round((pickAccuracyRatio[0].value / (pickAccuracyRatio[0].value + pickAccuracyRatio[1].value)) * 100)}%
                </span>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Accuracy</span>
              </div>
            </div>

            <div className="flex justify-around text-[10px] font-black uppercase tracking-wider mt-4">
              <div className="text-center">
                <span className="text-emerald-400 block text-sm font-black">{pickAccuracyRatio[0].value}</span>
                <span className="text-slate-500">Correct</span>
              </div>
              <div className="text-center">
                <span className="text-rose-500 block text-sm font-black">{pickAccuracyRatio[1].value}</span>
                <span className="text-slate-500">Incorrect</span>
              </div>
            </div>
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
