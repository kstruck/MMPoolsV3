import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { User as UserType, Pool, NFLGame, WeeklyRecap } from '../../types';
import { NFLGameTicker } from './NFLGameTicker';
import { 
  LayoutGrid, 
  CheckCircle2, 
  Shield, 
  Zap, 
  Percent, 
  Lock, 
  Settings,
  ArrowLeft,
  ChevronRight,
  Star
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
import { Badge, Button, RankChip, YouPill } from '../ui';

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

  // Full slate for the selected week (used to list every game, not just the focus game).
  const weeklyGames = useMemo(() => {
    return _games
      .filter(g => g.week === selectedWeek && Number(g.seasonType) === Number(castPool.seasonType))
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  }, [_games, selectedWeek, castPool.seasonType]);

  // Rebuy only exists on Survivor pools, and the cutoff is a DATE (the first kickoff of the
  // rebuyDeadlineWeek), not a "Week 4-6" range. Null on non-survivor pools -> the node hides.
  const rebuyInfo = useMemo(() => {
    if (_pool.type !== 'NFL_SURVIVOR') return null;
    const wk = castPool.settings?.rebuyDeadlineWeek;
    if (!wk) return null;
    const wkGames = _games.filter(g => g.week === wk && Number(g.seasonType) === Number(castPool.seasonType));
    const label = wkGames.length
      ? new Date(Math.min(...wkGames.map(g => g.startTime))).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : `Week ${wk}`;
    return { week: wk, label };
  }, [_pool.type, castPool.settings, _games, castPool.seasonType]);

  // Selected focus game rides in the URL (?game=) so a click updates the top panel and
  // Back/refresh restore it. Defaults to the live game, else the next kickoff.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedGameId = searchParams.get('game');
  const selectGame = (gameId: string) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('game', gameId);
      return p;
    }, { replace: true });
  };

  const focusGame = useMemo(() => {
    if (weeklyGames.length === 0) return null;
    const selected = selectedGameId ? weeklyGames.find(g => g.id === selectedGameId) : null;
    if (selected) return selected;
    const live = weeklyGames.find(g => g.status === 'IN_PROGRESS');
    if (live) return live;
    const upcoming = weeklyGames.filter(g => g.status === 'SCHEDULED');
    if (upcoming.length > 0) {
      return upcoming.reduce((prev, curr) => prev.startTime < curr.startTime ? prev : curr);
    }
    return weeklyGames[0];
  }, [weeklyGames, selectedGameId]);

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
    if (trendType === 0) return { type: 'up', color: '#C9A867' };
    if (trendType === 1) return { type: 'down', color: '#DA463F' };
    return { type: 'updown', color: 'var(--faint)' };
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
      { name: 'Correct Picks', value: correct, color: '#C9A867' },
      { name: 'Incorrect Picks', value: incorrect, color: '#C4342E' }
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
        { title: 'Weekly Pick', value: 'None', color: 'text-muted' },
        { title: 'Season Total', value: '0', color: 'text-navy-700 dark:text-gold-400' },
        { title: 'Your Rank', value: 'N/A', color: 'text-gold-600 dark:text-gold-400' }
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
      { title: 'Weekly Pick', value: weeklyVal, color: 'text-gold-600 dark:text-gold-400' },
      { title: seasonTitle, value: seasonVal, color: 'text-navy-700 dark:text-gold-400' },
      { title: 'Your Rank', value: userRank, color: 'text-gold-600 dark:text-gold-400' }
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
    <>
      {/* Live-score ticker across the top of the pool homepage (item 7) */}
      <NFLGameTicker games={weeklyGames} onSelectGame={selectGame} />

    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-stretch">

      {/* 1. Sleek Left Navigation Sidebar (Bento Grid Block) */}
      <div className="xl:col-span-1 flex flex-col justify-between bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150">
        <div className="space-y-8">
          {/* User Profile Card */}
          <div className="flex items-center gap-4 bg-page p-4 border border-line rounded-lg">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-navy-800 flex items-center justify-center font-display font-bold uppercase text-white text-lg shadow-card">
                {user?.name?.substring(0, 2).toUpperCase() || 'GS'}
              </div>
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-gold-500 border-2 border-[color:var(--page)] animate-live-pulse"></span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-display font-bold text-[color:var(--text)] text-sm tracking-[0.05em] leading-tight uppercase break-words" title={user?.name || 'Guest Participant'}>
                {user?.name || 'Guest'}
              </h4>
              <p className="text-muted text-[10px] uppercase font-display font-bold tracking-[0.08em] mt-0.5">
                Rank <span className="text-gold-600 dark:text-gold-400 num">{userRank}</span>
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, active: true },
              // Only the play link for THIS pool's type — a Pick'em pool shows Pick'em, not Survivor/Margin.
              ...(_pool.type === 'NFL_SURVIVOR'
                ? [{ id: 'survivor', label: 'Survivor', icon: Shield, tab: 'picks' as const }]
                : _pool.type === 'NFL_MARGIN'
                ? [{ id: 'margin', label: 'Margin', icon: Percent, tab: 'picks' as const }]
                : [{ id: 'picks', label: 'Pick\'em', icon: Zap, tab: 'picks' as const }]),
              { id: 'rules', label: 'Rules & Settings', icon: Settings, tab: 'rules' as const }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setSidebarActive(item.id);
                  if (item.tab) onSelectTab(item.tab);
                }}
                className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl font-display font-bold uppercase text-[12px] tracking-[0.08em] transition-all duration-150 ${
                  sidebarActive === item.id
                    ? 'bg-gold-400/10 text-[color:var(--text)] border-l-4 border-gold-500 shadow-card'
                    : 'text-muted hover:text-[color:var(--text)] hover:bg-page'
                }`}
              >
                <item.icon size={16} className={sidebarActive === item.id ? 'text-gold-600 dark:text-gold-400' : 'text-muted'} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Panel / Logo */}
        <div className="mt-8 pt-6 border-t border-line flex flex-col gap-2">
          {isManager && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSelectTab('manager')}
              className="w-full"
            >
              <Settings size={14} /> Commissioner
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="w-full"
          >
            <ArrowLeft size={14} /> Leave Pool
          </Button>
        </div>
      </div>

      {/* 2. Interactive Main Bento Dashboard Area */}
      <div className="xl:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        
        {/* CARD A: LIVE WEEKLY PICK'EM — full width so the week slate is readable */}
        <div
          className="md:col-span-2 bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">
                  {_pool.type === 'NFL_PICKEM' ? 'Live Weekly Pick\'em' : _pool.type === 'NFL_SURVIVOR' ? 'Weekly Survivor Match' : 'Margin Matchup'}
                </h3>
                <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">Week {selectedWeek} Games</p>
              </div>
              <button 
                onClick={() => onSelectTab('picks')}
                className="font-display font-bold uppercase text-[12px] tracking-[0.05em] text-navy-700 dark:text-gold-400 hover:text-navy-600 dark:hover:text-gold-300 flex items-center gap-1 transition-colors duration-150"
              >
                Upcoming <ChevronRight size={14} />
              </button>
            </div>

            {focusGame ? (
              <>
                {/* Live Match Helmets/Logos & Score Panel */}
                <div className="bg-page border border-line p-5 pt-7 rounded-lg mb-5 flex justify-between items-center relative overflow-hidden">
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
                    {focusGame.status === 'IN_PROGRESS' ? (
                      <Badge status="live" />
                    ) : focusGame.status === 'FINAL' ? (
                      <Badge status="locked">Final</Badge>
                    ) : (
                      <span className="bg-gold-400/10 border border-gold-500/40 px-2 py-0.5 rounded-full text-[9px] font-display font-bold text-gold-600 dark:text-gold-400 uppercase tracking-[0.08em]">
                        Scheduled
                      </span>
                    )}
                  </div>

                  {/* Logo Team 1 (Away) */}
                  <div className="flex flex-col items-center gap-1 select-none z-10">
                    {!awayLogoErr ? (
                      <div className="w-20 h-20 flex items-center justify-center bg-card rounded-lg p-2 border border-line shadow-card hover:scale-105 transition-transform duration-150">
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
                        className="w-20 h-20"
                      />
                    )}
                    <span className="text-xs font-display font-bold uppercase text-[color:var(--text)] mt-1 num">
                      {focusGame.awayTeam.abbreviation} {focusGame.scores?.away ?? 0}
                    </span>
                    <span className="text-[9px] font-display font-bold uppercase tracking-[0.08em] text-gold-600 dark:text-gold-400 inline-flex items-center gap-0.5">
                      {myPick === focusGame.awayTeam.name || myPick === focusGame.awayTeam.abbreviation ? (<><Star size={9} className="fill-current" /> Picked</>) : ''}
                    </span>
                  </div>

                  {/* Matchup Divider */}
                  <div className="text-center z-10">
                    <span className="text-[10px] font-display font-bold text-faint block uppercase tracking-[0.08em] mb-1 num">
                      {focusGame.status === 'IN_PROGRESS' ? (focusGame.clock || `Q${focusGame.period || 1}`) : focusGame.status === 'FINAL' ? 'FT' : 'Kickoff'}
                    </span>
                    <span className="text-lg font-display font-bold uppercase text-muted">VS</span>
                  </div>

                  {/* Logo Team 2 (Home) */}
                  <div className="flex flex-col items-center gap-1 select-none z-10">
                    {!homeLogoErr ? (
                      <div className="w-20 h-20 flex items-center justify-center bg-card rounded-lg p-2 border border-line shadow-card hover:scale-105 transition-transform duration-150">
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
                        className="w-20 h-20"
                      />
                    )}
                    <span className="text-xs font-display font-bold uppercase text-[color:var(--text)] mt-1 num">
                      {focusGame.homeTeam.abbreviation} {focusGame.scores?.home ?? 0}
                    </span>
                    <span className="text-[9px] font-display font-bold uppercase tracking-[0.08em] text-gold-600 dark:text-gold-400 inline-flex items-center gap-0.5">
                      {myPick === focusGame.homeTeam.name || myPick === focusGame.homeTeam.abbreviation ? (<><Star size={9} className="fill-current" /> Picked</>) : ''}
                    </span>
                  </div>
                </div>

                {/* Live Match Stats / Win Probability Graph */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Win Probability Panel */}
                  <div className="bg-page border border-line p-3.5 rounded-xl flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-0.5">Win Probability</span>
                      <span className="text-sm font-display font-bold uppercase text-navy-700 dark:text-gold-400 leading-none num">
                        {focusGame.homeTeam.abbreviation} {liveWinProb}%
                      </span>
                    </div>
                    <div className="relative h-12 w-full mt-2 overflow-hidden rounded-lg bg-surface border border-line">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={winProbabilityHistory} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <defs>
                            <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#C9A867" stopOpacity={0.35}/>
                              <stop offset="95%" stopColor="#C9A867" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="probability" stroke="#C9A867" strokeWidth={2} fillOpacity={1} fill="url(#colorProb)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Matchup Odds listings */}
                  <div className="bg-page border border-line p-3.5 rounded-xl flex flex-col justify-between">
                    <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-1">Weekly Focus</span>
                    <div className="space-y-1.5 text-xs font-body font-bold text-muted">
                      <div className="flex justify-between">
                        <span>Picks Status:</span>
                        <span className="text-[color:var(--text)]">{myPick ? 'Submitted' : 'Pending'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pick Selection:</span>
                        <span className="text-[color:var(--text)]">{myPick || 'None'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full week slate — every game, not just the focus matchup */}
                {weeklyGames.length > 1 && (
                  <div className="mt-6">
                    <span className="text-[11px] font-display font-bold text-muted uppercase tracking-[0.1em] block mb-3">
                      Week {selectedWeek} Slate <span className="text-faint num">({weeklyGames.length})</span>
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                      {weeklyGames.map(g => {
                        const key = `${g.awayTeam.abbreviation}@${g.homeTeam.abbreviation}`;
                        const isFocus = focusGame && key === `${focusGame.awayTeam.abbreviation}@${focusGame.homeTeam.abbreviation}`;
                        const live = g.status === 'IN_PROGRESS';
                        const final = g.status === 'FINAL';
                        const showScore = live || final;
                        return (
                          <button key={key} onClick={() => selectGame(g.id)} className={`w-full text-left flex items-center justify-between px-4 py-3 rounded-lg border transition-colors hover:border-gold-500/40 ${isFocus ? 'border-gold-500/40 bg-gold-400/5' : 'border-line bg-page'}`}>
                            <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] num tracking-[0.04em]">
                              {g.awayTeam.abbreviation}{showScore && <span className="text-gold-600 dark:text-gold-400"> {g.scores?.away ?? 0}</span>}
                              <span className="text-faint mx-1.5">@</span>
                              {g.homeTeam.abbreviation}{showScore && <span className="text-gold-600 dark:text-gold-400"> {g.scores?.home ?? 0}</span>}
                            </span>
                            <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] num flex items-center gap-1.5">
                              {live ? (
                                <span className="inline-flex items-center gap-1 text-brandred-600"><span className="h-1.5 w-1.5 rounded-full bg-brandred-600 animate-live-pulse"></span>{g.clock || `Q${g.period || 1}`}</span>
                              ) : final ? (
                                <span className="text-muted">Final</span>
                              ) : (
                                <span className="text-muted">{new Date(g.startTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-page border border-line rounded-lg p-8 text-center text-muted font-body font-bold text-xs">
                No active games scheduled for this week.
              </div>
            )}
          </div>
          
          {/* Locks Banner footer inside card */}
          <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-[10px]">
            <span className="text-muted font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1">
              <Lock size={12} className="text-faint" /> Picks Deadline
            </span>
            <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] animate-pulse num">
              {_earliestGame ? new Date(_earliestGame.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Kickoff'} Lock
            </span>
          </div>
        </div>

        {/* CARD B: SURVIVOR LEAGUE (Top Right) — survivor pools only */}
        {_pool.type === 'NFL_SURVIVOR' && (
        <div
          className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Survivor Attrition</h3>
                <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">
                  {survivalLeagueStats.alive} / {survivalLeagueStats.total} Players Alive
                </p>
              </div>
              <button 
                onClick={() => onSelectTab('standings')}
                className="font-display font-bold uppercase text-[12px] tracking-[0.05em] text-navy-700 dark:text-gold-400 hover:text-navy-600 dark:hover:text-gold-300 flex items-center gap-1 transition-colors duration-150"
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
                    className={`flex justify-between items-center p-3 rounded-lg border transition-all duration-150 ${
                      member.highlight
                        ? 'bg-brandred-600/[0.07] border-brandred-600/30 shadow-card'
                        : 'bg-page border-line'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl font-display font-bold text-xs flex items-center justify-center ${
                        member.highlight ? 'bg-navy-800 text-white' : 'bg-surface text-muted'
                      }`}>
                        {member.avatar}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-display font-bold text-[color:var(--text)] uppercase">{member.name}</span>
                          {member.highlight && <YouPill />}
                          {member.check && <CheckCircle2 size={12} className="text-gold-600 dark:text-gold-400" />}
                        </div>
                        <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] num">{member.week}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-display font-bold uppercase tracking-[0.08em] border ${
                        member.status === 'ELIMINATED'
                          ? 'bg-brandred-600/10 border-brandred-600/30 text-brandred-600 dark:text-brandred-500'
                          : 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]'
                      }`}>
                        {member.status}
                      </span>
                      <div className="text-right">
                        <span className="text-[9px] font-display font-bold text-muted block uppercase tracking-[0.08em] leading-none">Strikes</span>
                        <span className={`text-xs font-display font-bold num ${member.strikes > 0 ? 'text-gold-600 dark:text-gold-400' : 'text-muted'}`}>
                          {member.strikes}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-muted font-body text-xs text-center py-6 font-bold bg-page border border-line rounded-lg">
                  No active entries.
                </div>
              )}
            </div>

            {/* Attrition/Survival Chart */}
            <div className="bg-page border border-line p-4 rounded-lg relative">
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Attrition Trend Line</span>
              <div className="h-16 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={attritionHistoryData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorAlive" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C9A867" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#C9A867" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorStrikes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#DA463F" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#DA463F" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="alive" stroke="#C9A867" strokeWidth={2} fillOpacity={1} fill="url(#colorAlive)" name="Players Alive" />
                    <Area type="monotone" dataKey="strikes" stroke="#DA463F" strokeWidth={1.5} strokeDasharray="3,3" fillOpacity={1} fill="url(#colorStrikes)" name="Total Strikes" />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-card border border-line p-2 rounded-xl text-[10px] font-display font-bold text-[color:var(--text)] shadow-panel">
                              <p className="uppercase text-muted mb-0.5 num">{payload[0].payload.week}</p>
                              <p className="text-gold-600 dark:text-gold-400 num">Alive: {payload[0].value}</p>
                              {payload[1] && <p className="text-brandred-600 dark:text-brandred-500 num">Strikes: {payload[1].value}</p>}
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

          <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-[10px]">
            <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Survivor status</span>
            <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em]">
              {myEntry ? (
                _pool.type === 'NFL_SURVIVOR' ? (
                  myEntry.status === 'ELIMINATED' ? (
                    <span className="text-brandred-600 dark:text-brandred-500">Eliminated</span>
                  ) : (
                    <span>You are Alive</span>
                  )
                ) : (
                  myEntry.paidStatus === 'PAID' ? 'Buy-in: Paid' : <span className="text-brandred-600 dark:text-brandred-500">Buy-in: Unpaid</span>
                )
              ) : 'No entry in this pool'}
            </span>
          </div>
        </div>
        )}

        {/* CARD C: MARGIN POOL STATS (Bottom Left) — margin pools only */}
        {_pool.type === 'NFL_MARGIN' && (
        <div
          className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Margin Pool Stats</h3>
                <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">Current Week Performance</p>
              </div>
              <span className="bg-page border border-line px-3 py-1 rounded-full text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] num">
                Week {selectedWeek}
              </span>
            </div>

            {/* Margin Pool Metric blocks */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {userStats.map((stat, i) => (
                <div key={i} className="bg-page border border-line p-3 rounded-lg text-center">
                  <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-0.5">
                    {stat.title}
                  </span>
                  <span className={`text-xs sm:text-sm font-display font-bold uppercase ${stat.color} tracking-wide truncate block num`}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Weekly Margin Bar Chart using Recharts */}
            <div className="bg-page border border-line p-4 rounded-lg mb-5">
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-3">Weekly Net History</span>
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
                            fill={isSelected ? '#C9A867' : (isPositive ? '#24507F' : '#C4342E')}
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
                            <div className="bg-card border border-line p-2 rounded-xl text-[10px] font-display font-bold text-[color:var(--text)] shadow-panel">
                              <p className="uppercase text-muted mb-0.5 num">Week {payload[0].payload.week}</p>
                              <p className={`num ${val >= 0 ? "text-gold-600 dark:text-gold-400" : "text-brandred-600 dark:text-brandred-500"}`}>
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
              <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block">Recent Pool Activity</span>
              {entries.length > 0 ? (
                <div className="flex justify-between items-center bg-page p-2.5 rounded-xl border border-line text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-surface flex items-center justify-center font-display font-bold text-[9px] text-muted border border-line">
                      {(entries[0]?.userName || 'U').substring(0, 2).toUpperCase()}
                    </div>
                    <span className="font-display font-bold text-[color:var(--text)] text-[10px] uppercase truncate max-w-[80px]">
                      {entries[0]?.userName || 'Anonymous'}
                    </span>
                    <span className="text-muted font-body text-[10px]">active in pool</span>
                  </div>
                  <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] text-[10px]">
                    Joined
                  </span>
                </div>
              ) : (
                <div className="text-faint font-body text-[10px] italic">No recent pool activity.</div>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-[10px]">
            <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Performance Rating</span>
            <span className="text-gold-600 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] num">
              {myEntry ? (
                `${myEntry.seasonTotal || 0} Total Margin`
              ) : 'No Entry Found'}
            </span>
          </div>
        </div>
        )}

        {/* CARD D: POOL STANDINGS (Bottom Right) — this pool's leaderboard */}
        <div
          className="bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 flex flex-col justify-between"
        >
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Pool Standings</h3>
                <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">Leaderboard Positions</p>
              </div>
              <button 
                onClick={() => onSelectTab('standings')}
                className="font-display font-bold uppercase text-[12px] tracking-[0.05em] text-navy-700 dark:text-gold-400 hover:text-navy-600 dark:hover:text-gold-300 flex items-center gap-1 transition-colors duration-150"
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
                      className={`flex justify-between items-center p-3 rounded-lg border transition-all duration-150 ${
                        row.highlight
                          ? 'bg-brandred-600/[0.07] border-brandred-600/30 shadow-card'
                          : 'bg-page border-line'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <RankChip rank={row.rank} />
                        <div className={`w-8 h-8 rounded-xl font-display font-bold text-xs flex items-center justify-center ${
                          row.highlight ? 'bg-navy-800 text-white' : 'bg-surface text-muted'
                        }`}>
                          {row.avatar}
                        </div>
                        <div>
                          <span className="text-xs font-display font-bold text-[color:var(--text)] flex items-center gap-1.5 uppercase leading-none mb-1">{row.name}{row.highlight && <YouPill />}</span>
                          <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em]">{row.detail}</span>
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
                          <span className="text-[9px] font-display font-bold text-muted block uppercase tracking-[0.08em] leading-none">Score</span>
                          <span className="text-xs font-display font-bold text-[color:var(--text)] num">{row.pts}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-muted font-body text-xs text-center py-6 font-bold bg-page border border-line rounded-lg">
                  No active rankings.
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-line flex justify-between items-center text-[10px]">
            <span className="text-muted font-display font-bold uppercase tracking-[0.08em]">Standings Status</span>
            <span className="text-navy-700 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] num">
              {userRank !== 'N/A' ? `You are Ranked ${userRank}` : 'Unranked (Submit Pick)'}
            </span>
          </div>
        </div>

        {/* CARD E: MY PERFORMANCE RADAR & PICK ANALYTICS (Bottom Spanning Bento Box) */}
        <div 
          className="md:col-span-2 bg-card border border-line rounded-xl p-6 shadow-card relative overflow-hidden transition-all duration-150 grid grid-cols-1 md:grid-cols-2 gap-8"
        >
          {/* Radar Chart section */}
          <div className="flex flex-col justify-between">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Performance Radar</h3>
              <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">Skills comparison vs League Average</p>
            </div>
            
            <div className="h-56 w-full flex items-center justify-center mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={userPerformanceData}>
                  <PolarGrid stroke="var(--line)" />
                  <PolarAngleAxis dataKey="subject" stroke="var(--text-muted)" tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--text-muted)' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="var(--line)" tick={false} />
                  <Radar name="You" dataKey="User" stroke="#C9A867" fill="#C9A867" fillOpacity={0.25} />
                  <Radar name="League Average" dataKey="Average" stroke="#24507F" fill="#24507F" fillOpacity={0.1} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', borderRadius: '12px', color: 'var(--text)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex justify-center gap-6 text-[10px] font-display font-bold uppercase tracking-[0.08em] mt-4">
              <div className="flex items-center gap-1.5 text-gold-600 dark:text-gold-400">
                <span className="h-2 w-2 rounded-full bg-gold-500"></span> You
              </div>
              <div className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-full bg-navy-600"></span> League Avg
              </div>
            </div>
          </div>

          {/* Pie Chart section */}
          <div className="flex flex-col justify-between border-t md:border-t-0 md:border-l border-line pt-6 md:pt-0 md:pl-8">
            <div>
              <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Pick Accuracy ratio</h3>
              <p className="text-[10px] text-faint mt-0.5 font-display font-bold uppercase tracking-[0.08em] num">Proportion of correct selections</p>
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
                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', borderRadius: '12px', color: 'var(--text)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              
              <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                <span className="text-xl font-display font-bold text-[color:var(--text)] leading-none num">
                  {Math.round((pickAccuracyRatio[0].value / (pickAccuracyRatio[0].value + pickAccuracyRatio[1].value)) * 100)}%
                </span>
                <span className="text-[8px] font-display font-bold text-muted uppercase tracking-[0.08em] mt-0.5">Accuracy</span>
              </div>
            </div>

            <div className="flex justify-around text-[10px] font-display font-bold uppercase tracking-[0.08em] mt-4">
              <div className="text-center">
                <span className="text-gold-600 dark:text-gold-400 block text-sm font-display font-bold num">{pickAccuracyRatio[0].value}</span>
                <span className="text-muted">Correct</span>
              </div>
              <div className="text-center">
                <span className="text-brandred-600 dark:text-brandred-500 block text-sm font-display font-bold num">{pickAccuracyRatio[1].value}</span>
                <span className="text-muted">Incorrect</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 3. Floating Bottom Timeline Block */}
      <div className="xl:col-span-5 bg-card border border-line rounded-xl p-5 shadow-card relative overflow-hidden transition-all duration-150">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-6 overflow-x-auto select-none py-2 px-4 whitespace-nowrap">
          
          {/* Timeline Node 1 */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
            <span className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] block mb-0.5 transition-colors duration-150 group-hover:text-[color:var(--text)]">
              NFL Kickoff
            </span>
            <span className="text-gold-600 dark:text-gold-400 font-display font-bold text-sm uppercase tracking-[0.05em] flex items-center gap-1.5 num">
              <span className="h-2 w-2 rounded-full bg-gold-500 animate-live-pulse"></span> Sep 10
            </span>
          </div>

          {/* Timeline Node 2 — Rebuy cutoff, Survivor pools only, shown as a real date */}
          {rebuyInfo && (
            <>
              <div className="hidden sm:block w-px h-8 bg-line"></div>
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
                <span className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] block mb-0.5 transition-colors duration-150 group-hover:text-[color:var(--text)]">
                  Rebuy Cutoff
                </span>
                <span className="text-gold-600 dark:text-gold-400 font-display font-bold text-sm uppercase tracking-[0.05em] flex items-center gap-1.5 num">
                  <span className="h-2 w-2 rounded-full bg-gold-500"></span> {rebuyInfo.label}
                </span>
              </div>
            </>
          )}

          {/* Spacer Line */}
          <div className="hidden sm:block w-px h-8 bg-line"></div>

          {/* Timeline Node 3 */}
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left group">
            <span className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] block mb-0.5 transition-colors duration-150 group-hover:text-[color:var(--text)]">
              Super Bowl LX
            </span>
            <span className="text-[color:var(--text)] font-display font-bold text-sm uppercase tracking-[0.05em] flex items-center gap-1.5 num">
              <span className="h-2 w-2 rounded-full bg-[color:var(--text)]"></span> Feb 8
            </span>
          </div>

          {/* Action Call to join */}
          <div className="sm:ml-auto w-full sm:w-auto">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSelectTab('picks')}
              className="w-full sm:w-auto"
            >
              Submit My Picks Now
            </Button>
          </div>
        </div>
      </div>

    </div>
    </>
  );
};
