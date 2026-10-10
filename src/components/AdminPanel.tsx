import { OverlayRoot } from './ui/OverlayRoot';
import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { PoolTheme, GameState, Scores, Square, User, PropCard, WaitlistEntry, PlayerDetails } from '../types';
import type { ESPNGame, ESPNCompetitor, ESPNCompetition } from '../types/espn';

import Settings from 'lucide-react/dist/esm/icons/settings';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Lock from 'lucide-react/dist/esm/icons/lock';
import Unlock from 'lucide-react/dist/esm/icons/unlock';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Share2 from 'lucide-react/dist/esm/icons/share-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Wifi from 'lucide-react/dist/esm/icons/wifi';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Save from 'lucide-react/dist/esm/icons/save';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign';
import Mail from 'lucide-react/dist/esm/icons/mail';
import Users from 'lucide-react/dist/esm/icons/users';
import UserIcon from 'lucide-react/dist/esm/icons/user';
import Heart from 'lucide-react/dist/esm/icons/heart';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Download from 'lucide-react/dist/esm/icons/download';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import Hammer from 'lucide-react/dist/esm/icons/hammer';
import Dices from 'lucide-react/dist/esm/icons/dices';
import { HelpRoutePublisher } from '../help/publish';
import { useUrlTab } from './help/useUrlTab';

/**
 * The squares manager tabs, as one list. `useUrlTab` needs it to reject a stale
 * `?tab=`, and `src/help/content/pool-pages.ts` names the same ids.
 */
const ADMIN_PANEL_TABS = [
  'settings', 'reminders', 'players', 'scoring', 'game',
  'payouts', 'communications', 'stats', 'props', 'grading',
] as const;

import { Badge, Button, StatTile, Switch } from './ui';



import { fetchGameScore } from '../services/scoreService';
import { AnnouncementManager } from './AnnouncementManager';
import { useToast } from './ui/Toast';

import { PropGradingDashboard } from './Props/PropGradingDashboard';
import { PoolStatistics } from './PoolStatistics';
import {

  WizardStepMatchup, WizardStepBasics, WizardStepRules, WizardStepPayouts,
  WizardStepSideHustle, WizardStepBrandingAdmin, WizardStepReminders, WizardStepFinish, WizardStepSummary
} from './admin';

interface AdminPanelProps {
  gameState: GameState;
  updateConfig: (updates: Partial<GameState>) => void;
  updateScores: (scores: Partial<Scores>) => void;
  generateNumbers: () => Promise<void> | void;
  resetGame: () => void;
  onBack: () => void;
  onShare: () => void;
  checkSlugAvailable: (slug: string) => boolean;
  checkNameAvailable: (name: string) => boolean;
  currentUser: User | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  gameState,
  updateConfig,
  updateScores,
  generateNumbers,
  onBack,
  onShare,
  checkSlugAvailable,
  checkNameAvailable,
  currentUser
}) => {


  // Updated Tab Order and Default
  // T2 / K13: the tab moved into `?tab=` so help search results can link to it
  // and Back works. Same list the squares admin help pages name.
  const [activeTab, setActiveTab] = useUrlTab('tab', ADMIN_PANEL_TABS, 'settings');

  const toast = useToast();

  const [wizardStep, setWizardStep] = useState(1);
  const TOTAL_STEPS = 9;

  const [isFetchingScores, setIsFetchingScores] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ type: 'success' | 'error' | 'neutral', msg: string } | null>(null);



  // Auto-detect season type: Dec-Feb is postseason, otherwise regular
  const getDefaultSeasonType = () => {
    const month = new Date().getMonth();
    return (month === 11 || month === 0 || month === 1) ? '3' : '2';
  };
  const [seasonType, setSeasonType] = useState(getDefaultSeasonType());
  const [week, setWeek] = useState('2'); // Default to Divisional for postseason
  const [scheduleGames, setScheduleGames] = useState<ESPNGame[]>([]);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Players Tab State
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<{ originalName: string, name: string, email: string, phone: string, notes: string } | null>(null);

  // Player PII (email/phone/notes) lives in the restricted squarePrivate
  // subcollection (audit H1), keyed by squareId. Owner/manager-only read.
  const [squarePrivate, setSquarePrivate] = useState<Record<number, PlayerDetails>>({});
  useEffect(() => {
    if (!gameState.id) return;
    const unsub = dbService.subscribeToSquarePrivate(gameState.id, setSquarePrivate);
    return () => unsub();
  }, [gameState.id]);
  // Contact info for a player = the private record of their first square.
  const contactFor = (squares: Square[]): PlayerDetails | undefined => {
    for (const s of squares) {
      if (squarePrivate[s.id]) return squarePrivate[s.id];
    }
    return undefined;
  };

  // Email Broadcast State removed (replaced by AnnouncementManager)


  // Theme State
  const [availableThemes, setAvailableThemes] = useState<PoolTheme[]>([]);

  useEffect(() => {
    const fetchThemes = async () => {
      const themes = await dbService.getActiveThemes();
      if (themes && themes.length > 0) {
        setAvailableThemes(themes as PoolTheme[]);
      } else {
        // Fallback to presets if DB is empty
        const { PRESET_THEMES } = await import('../constants/presetThemes');
        setAvailableThemes(PRESET_THEMES as unknown as PoolTheme[]);
      }
    };
    fetchThemes();
  }, []);

  // Prop Player Management
  const [propCards, setPropCards] = useState<PropCard[]>([]);
  const [playerTab, setPlayerTab] = useState<'grid' | 'props'>('grid');

  useEffect(() => {
    if (activeTab === 'players' && gameState.id) {
      const unsub = dbService.subscribeToAllPropCards(gameState.id, (cards: PropCard[]) => {
        setPropCards(cards);
      });
      return () => unsub();
    }
  }, [activeTab, gameState.id]);


  const updatePlayerDetails = async (originalName: string, newDetails: { name: string, email: string, phone: string, notes: string }) => {
    // Name is public (square.owner); PII is written to squarePrivate. Both handled server-side.
    await dbService.updatePlayer(gameState.id, originalName, newDetails);
    setEditingPlayer(null);
    setExpandedPlayer(null); // Close expanded view to refresh
  };


  // Helper to safely update nested score state
  const handleScoreChange = (period: 'current' | 'q1' | 'half' | 'q3' | 'final', team: 'home' | 'away', value: string) => {
    const numVal = value === '' ? 0 : parseInt(value);
    if (isNaN(numVal)) return;

    const currentPeriodScore = gameState.scores[period] || { home: 0, away: 0 };
    updateScores({
      [period]: {
        ...currentPeriodScore,
        [team]: numVal
      }
    });
  };

  const togglePeriodActive = (period: 'current' | 'q1' | 'half' | 'q3' | 'final') => {
    if (gameState.scores[period]) {
      updateScores({ [period]: null });
    } else {
      updateScores({ [period]: { home: 0, away: 0 } });
    }
  };

  const toggleLock = async () => {
    if (!gameState.isLocked && !gameState.axisNumbers) {
      // If unlocking or numbers not set, and we are starting: Use Server Function
      await generateNumbers();
    } else {
      // Just toggle the lock state (Pause/Unpause)
      updateConfig({ isLocked: !gameState.isLocked, lockGrid: !gameState.isLocked });
    }
  };

  const handleThemeSelect = async (theme: PoolTheme) => {
    if (!theme.id) {
      // Must be a preset. Save it to DB to make it real.
      const newId = await dbService.saveTheme(theme);
      // Update user config
      updateConfig({ themeId: newId });
      // Update local list to reflect reality
      setAvailableThemes(prev => prev.map(t => t.name === theme.name ? { ...t, id: newId } : t));
    } else {
      updateConfig({ themeId: theme.id });
    }
  };

  const handleSave = () => {
    setSaveMessage('Settings Saved Successfully!');
    setTimeout(() => {
      setSaveMessage(null);
      window.location.href = `/pool/${gameState.id}`;
    }, 1500);
  };

  const handleExportUsers = () => {
    const uniqueUsers = new Map<string, { name: string; email: string; phone: string }>();

    gameState.squares.forEach(square => {
      if (!square.owner) return;

      // Use email as key if available, otherwise name
      const priv = squarePrivate[square.id];
      const email = priv?.email || '';
      const name = square.owner;
      const key = email || name;

      if (!uniqueUsers.has(key)) {
        uniqueUsers.set(key, {
          name,
          email,
          phone: priv?.phone || ''
        });
      }
    });

    // CSV Header
    let csvContent = "Email Address,First Name,Phone Number\n";

    // CSV Rows
    uniqueUsers.forEach(user => {
      // Escape commas in fields
      const safeName = user.name.replace(/,/g, '');
      const safeEmail = user.email.replace(/,/g, '');
      const safePhone = user.phone.replace(/,/g, '');

      // Only include if we have at least a name
      if (safeName) {
        csvContent += `${safeEmail},${safeName},${safePhone} \n`;
      }
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${gameState.urlSlug || 'pool'} _participants.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // handleSendBroadcast removed


  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Security: Validate file type to prevent SVG/JS injection via logo upload
    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
      e.target.value = ''; // Reset the input so the same file can't be resubmitted
      return;
    }

    if (file.size > 2 * 1024 * 1024) { // 2MB Limit
      toast.error("Logo file is too large! Max size is 2MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      updateConfig({ branding: { ...gameState.branding, logoUrl: base64 } });
    };
    reader.readAsDataURL(file);
  };

  const fetchSchedule = async () => {
    setIsLoadingSchedule(true);
    setScheduleGames([]);
    setShowSchedule(true);
    try {
      const leaguePath = gameState.league === 'college' || gameState.league === 'ncaa' ? 'college-football' : 'nfl';
      let url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?seasontype=${seasonType}&week=${week}`;
      if (leaguePath === 'college-football') {
        url += `&groups=${cfbConference}`;
        // If searching specific conference, disable limit to ensure visibility, though groups usually limits enough
        url += `&limit=100`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch schedule');
      const data = await response.json();
      const events = data.events || [];

      // Filter for future games only (based on user request)
      const now = new Date();
      // Optional: buffer of 0 hours, strict future.
      const upcoming = events.filter((e: ESPNGame) => {
        const gameDate = new Date(e.date);
        return gameDate > now;
      });

      setScheduleGames(upcoming);
    } catch (e) {
      logger.error(e);
      // Sandbox fix: Remove alert
      setShowSchedule(false);
    }
    setIsLoadingSchedule(false);
  };

  const selectGame = (game: ESPNGame) => {
    const comp: ESPNCompetition = game.competitions[0];
    const home = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'home')?.team;
    const away = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'away')?.team;
    if (!home || !away) return; // Guard clause
    // Auto-set the Lock Time to the game start time
    const gameDate = new Date(game.date);
    const existingReminders = gameState.reminders || {
      payment: { enabled: true, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: true },
      lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: gameDate.getTime() - (15 * 60 * 1000) },
      winner: { enabled: true, channels: ['email'], includeDigits: true, includeCharityImpact: true }
    };

    // Auto-Name Logic
    let candidateName = `${away.displayName} @ ${home.displayName}`;
    let counter = 2;
    // Check if taken (simple loop)
    // Note: checkNameAvailable returns TRUE if available, FALSE if taken
    if (!checkNameAvailable(candidateName)) {
      while (!checkNameAvailable(`${candidateName} (${counter})`)) {
        counter++;
      }
      candidateName = `${candidateName} (${counter})`;
    }

    updateConfig({
      name: candidateName, // Set the auto-generated unique name
      homeTeam: home.displayName,
      awayTeam: away.displayName,
      gameId: game.id,
      homeTeamLogo: home.logo,
      awayTeamLogo: away.logo,
      seasonType: seasonType as '1' | '2' | '3', // Save the season type
      week: parseInt(week), // Save the week number
      reminders: {
        ...existingReminders,
        lock: {
          ...existingReminders.lock,
          lockAt: gameDate.getTime() - (15 * 60 * 1000)
        }
      },
      scores: {
        ...gameState.scores,
        startTime: game.date // Ensure startTime is set for the wizard to use
      }
    });

    setShowSchedule(false);
  };

  const handleFetchLiveScores = async () => {
    setIsFetchingScores(true);
    setFetchStatus({ type: 'neutral', msg: 'Connecting...' });
    const result = await fetchGameScore(gameState);

    if (result) {
      updateScores(result.scores);
      setFetchStatus({ type: 'success', msg: `Updated: ${result.status}` });
    } else {
      setFetchStatus({ type: 'error', msg: 'Game not found.' });
    }
    setIsFetchingScores(false);
  };

  const [isFixing, setIsFixing] = useState(false);
  const handleFixSync = async () => {
    const ok = await toast.confirm({ title: 'Reset & Re-Sync Scores?', message: 'This will reset the score events and force a full re-sync from ESPN. Use this ONLY if scores are stuck or missing.', confirmLabel: 'Re-Sync', danger: true });
    if (!ok) return;
    setIsFixing(true);
    setFetchStatus({ type: 'neutral', msg: 'Repairing...' });
    try {
      const result = await dbService.fixPoolScores(gameState.id);
      if (result.success) {
        setFetchStatus({ type: 'success', msg: 'Repair Complete' });
        // Optional: reload to see changes
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setFetchStatus({ type: 'error', msg: 'Repair Failed' });
      }
    } catch (e) {
      logger.error(e);
      setFetchStatus({ type: 'error', msg: 'Repair Error' });
    }
    setIsFixing(false);
  };

  const totalPayout = (gameState.payouts.q1 || 0) + (gameState.payouts.half || 0) + (gameState.payouts.q3 || 0) + (gameState.payouts.final || 0);

  // Player Management Logic
  interface PlayerSummary {
    name: string;
    squares: Square[];
    totalPaid: number;
    totalOwed: number;
    contact?: { email?: string; phone?: string; notes?: string };
  }

  const getPlayers = (): PlayerSummary[] => {
    const players: Record<string, Square[]> = {};
    gameState.squares.forEach(sq => {
      if (sq.owner) {
        if (!players[sq.owner]) players[sq.owner] = [];
        players[sq.owner].push(sq);
      }
    });
    return Object.entries(players).map(([name, squares]) => ({
      name,
      squares,
      totalPaid: squares.filter(s => s.isPaid).length * gameState.costPerSquare,
      totalOwed: squares.filter(s => !s.isPaid).length * gameState.costPerSquare,
      contact: contactFor(squares)
    }));
  };

  interface PropPlayerSummary {
    uid: string;
    name: string;
    cards: PropCard[];
    totalPaid: number;
    totalOwed: number;
    email?: string;
  }

  const getPropPlayers = (): PropPlayerSummary[] => {
    // Group cards by user
    const players: Record<string, PropCard[]> = {};
    propCards.forEach(card => {
      const uId = card.userId || 'unknown';
      if (!players[uId]) players[uId] = [];
      players[uId].push(card);
    });

    return Object.entries(players).map(([uid, cards]) => ({
      uid,
      name: cards[0].userName || 'Unknown User',
      cards,
      totalPaid: cards.filter(c => c.isPaid).length * (gameState.props?.cost || 0),
      totalOwed: cards.filter(c => !c.isPaid).length * (gameState.props?.cost || 0),
      email: cards[0].userEmail
    }));
  };

  const updatePropPlayerDetails = async (uid: string, details: { name: string, email: string, phone: string, notes: string }) => {
    const userCards = propCards.filter(c => c.userId === uid && c.id);
    const updates: Partial<PropCard> = { userName: details.name, userEmail: details.email };
    await Promise.all(userCards.map(c => dbService.updatePropCard(gameState.id, c.id!, updates)));
    setEditingPlayer(null);
  };

  const removePropPlayer = async (uid: string) => {
    // No confirmation dialog (Sandbox restriction)
    const userCards = propCards.filter(c => c.userId === uid && c.id);
    await Promise.all(userCards.map(c => dbService.deletePropCard(gameState.id, c.id!)));
  };




  const releasePlayer = async (ownerName: string) => {
    // Release + PII deletion handled server-side (squarePrivate is Cloud-Functions-only).
    await dbService.releaseSquares(gameState.id, { ownerName });
  };

  const [isRandomizing, setIsRandomizing] = useState(false);
  const [randomizingNumber, setRandomizingNumber] = useState<number | null>(null);

  const handleRandomizeWinner = () => {
    setIsRandomizing(true);
    let count = 0;
    const interval = setInterval(() => {
      setRandomizingNumber(Math.floor(Math.random() * 100));
      count++;
      if (count > 40) { // Approx 4-5 seconds
        clearInterval(interval);
        const winningSquareId = Math.floor(Math.random() * 100);
        setRandomizingNumber(winningSquareId);
        setTimeout(() => {
          setIsRandomizing(false);
          setRandomizingNumber(null);
          const owner = gameState.squares[winningSquareId].owner || 'Unclaimed Square';

          // Update Game State
          updateConfig({
            randomWinner: {
              squareId: winningSquareId,
              owner: owner,
              amount: 0, // Calculated dynamically in gameLogic
              timestamp: Date.now()
            }
          });
        }, 2000);
      }
    }, 100);
  };

  const [cfbConference, setCfbConference] = useState('80'); // Default to All FBS

  /* Helper to estimate current NFL week */
  /* Helper to estimate current NFL week */
  const getEstimatedWeek = () => {
    const now = new Date();
    // Week 1 is roughly first week of Sept.
    // If we are in Jan/Feb, we are late season (Week 18+ or playoffs)
    // 2024 season started Sept 5.
    // Let's assume current season starts first thursday of Sept.

    let year = now.getFullYear();
    if (now.getMonth() < 6) year--; // If Jan-June, we are in the tail of previous year's season

    const seasonStart = new Date(year, 8, 5); // Approx Sept 5th
    const diff = now.getTime() - seasonStart.getTime();

    // If before season start, return 1
    if (diff < 0) return 1;

    const weekNum = Math.ceil(diff / (1000 * 60 * 60 * 24 * 7));
    // Cap at 18
    return Math.max(1, weekNum);
  };

  const currentEstimatedWeek = getEstimatedWeek();



  // Render Wizard STep 1 (Now Matchup)


  return (
    <div className="min-h-screen bg-page text-[color:var(--text)] pb-20">
      {/* T2: the squares manager's tab and its player sub-tab, for the Help panel. */}
      <HelpRoutePublisher tab={activeTab} subTab={activeTab === 'players' ? playerTab : undefined} isManager />
      <div className="bg-surface border-b border-line sticky top-0 z-20 shadow-panel">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-full hover:bg-card text-muted hover:text-[color:var(--text)] transition-colors"><ArrowLeft size={20} /></button>
            <div><h1 className="text-xl font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2"><Settings className="text-gold-500" size={20} /> {gameState.name} {gameState.charity?.enabled && <span className="text-xs font-display font-bold uppercase tracking-[0.08em] bg-[#FBF3E0] text-gold-700 border border-[#EAD9A8] px-2 py-0.5 rounded-full">Charity</span>}</h1><p className="text-xs font-body text-muted">Admin Editor</p></div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onShare} variant="ghost" size="sm"><Share2 size={14} /> Share</Button>
            <Button onClick={() => window.location.href = `/pool/${gameState.id}`} variant="secondary" size="sm">Open Public View</Button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-6 text-sm">
          <div className="max-w-5xl mx-auto px-6 flex gap-6 text-sm overflow-x-auto">
            {(['settings', 'reminders', 'players', 'scoring', 'game', 'payouts', 'props', 'grading', 'communications', 'stats'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 border-b-2 transition-colors font-display font-bold uppercase tracking-[0.05em] whitespace-nowrap ${activeTab === tab ? 'border-gold-500 text-gold-600 dark:text-gold-400' : 'border-transparent text-muted hover:text-[color:var(--text)]'}`}
              >
                {tab === 'settings' ? 'Setup Wizard' : tab === 'reminders' ? 'Smart Reminders' : tab === 'game' ? 'Game Status' : tab === 'stats' ? 'Statistics' : tab === 'payouts' ? 'Payouts' : tab === 'props' ? 'Side Hustle' : tab === 'grading' ? 'Grading' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {saveMessage && (<div className="fixed top-24 left-1/2 -translate-x-1/2 bg-[#0F7B4A] text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 flex items-center gap-2 font-display font-bold uppercase tracking-[0.05em]"><CheckCircle size={20} />{saveMessage}</div>)}

        {/* SETTINGS (WIZARD) TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="mb-8">
              {/* Clickable Wizard Progress Indicators */}
              <div className="flex justify-between text-xs font-display font-bold uppercase tracking-[0.08em] text-muted mb-2">
                {[
                  { step: 1, label: '1. Matchup' },
                  { step: 2, label: '2. Basics' },
                  { step: 3, label: '3. Rules' },
                  { step: 4, label: '4. Payouts' },
                  { step: 5, label: '5. Side Hustle' },
                  { step: 6, label: '6. Branding' },
                  { step: 7, label: '7. Reminders' },
                  { step: 8, label: '8. Summary' },
                  { step: 9, label: '9. Finish' }
                ].map(s => (
                  <button
                    key={s.step}
                    onClick={() => setWizardStep(s.step)}
                    className={`uppercase font-bold transition-colors hover:text-[color:var(--text)] ${wizardStep >= s.step ? 'text-gold-600 dark:text-gold-400' : ''}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="h-2 bg-line rounded-full overflow-hidden">
                <div className="h-full w-full origin-left bg-gold-foil transition-transform duration-300 ease-out" style={{ transform: `scaleX(${wizardStep / TOTAL_STEPS})` }}></div>
              </div>
            </div>

            {wizardStep === 1 && (
              <WizardStepMatchup
                gameState={gameState}
                updateConfig={updateConfig}
                seasonType={seasonType}
                setSeasonType={setSeasonType}
                week={week}
                setWeek={setWeek}
                scheduleGames={scheduleGames}
                isLoadingSchedule={isLoadingSchedule}
                showSchedule={showSchedule}
                setShowSchedule={setShowSchedule}
                fetchSchedule={fetchSchedule}
                selectGame={selectGame}
                currentEstimatedWeek={currentEstimatedWeek}
                cfbConference={cfbConference}
                setCfbConference={setCfbConference}
              />
            )}
            {wizardStep === 2 && (
              <WizardStepBasics
                gameState={gameState}
                updateConfig={updateConfig}
                checkSlugAvailable={checkSlugAvailable}
              />
            )}
            {wizardStep === 3 && (
              <WizardStepRules
                gameState={gameState}
                updateConfig={updateConfig}
              />
            )}
            {wizardStep === 4 && (
              <WizardStepPayouts
                gameState={gameState}
                updateConfig={updateConfig}
                totalPayout={totalPayout}
              />
            )}
            {wizardStep === 5 && (
              <WizardStepSideHustle
                gameState={gameState}
                updateConfig={updateConfig}
              />
            )}
            {wizardStep === 6 && (
              <WizardStepBrandingAdmin
                gameState={gameState}
                updateConfig={updateConfig}
                availableThemes={availableThemes}
                handleThemeSelect={handleThemeSelect}
                handleLogoUpload={handleLogoUpload}
              />
            )}
            {wizardStep === 7 && (
              <WizardStepReminders
                gameState={gameState}
                updateConfig={updateConfig}
              />
            )}
            {wizardStep === 8 && (
              <WizardStepSummary
                gameState={gameState}
                onEditStep={(step) => setWizardStep(step)}
                updateConfig={updateConfig as any}
              />
            )}
            {wizardStep === 9 && (
              <WizardStepFinish
                gameState={gameState}
                updateConfig={updateConfig}
                handleFixSync={handleFixSync}
                isFixing={isFixing}
                currentUser={currentUser || undefined}
              />
            )}

            <div className="flex justify-between pt-6 border-t border-line">
              <Button onClick={() => setWizardStep(Math.max(1, wizardStep - 1))} disabled={wizardStep === 1} variant="ghost"><ArrowLeft size={18} /> Previous</Button>
              {wizardStep < TOTAL_STEPS ? (
                <Button onClick={() => setWizardStep(Math.min(TOTAL_STEPS, wizardStep + 1))} variant="secondary">Next Step <ArrowRight size={18} /></Button>
              ) : (
                <Button onClick={handleSave}><Save size={18} /> Save Complete Pool</Button>
              )}
            </div>
          </div>
        )}

        {/* GAME STATUS TAB */}
        {activeTab === 'game' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-card p-6 rounded-xl border border-line shadow-card"><div className="flex justify-between items-center mb-6"><div><h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)]">Game Status</h3><p className="text-sm font-body text-muted">Control the betting and number generation.</p></div>{gameState.isLocked ? <Badge status="locked" /> : <Badge status="open" />}</div><button onClick={toggleLock} className={`w-full py-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center justify-center gap-2 transition-ui duration-150 fine:hover:-translate-y-px text-lg ${gameState.isLocked ? 'bg-card hover:bg-surface text-[color:var(--text)] border border-line' : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-red-cta'}`}>{gameState.isLocked ? <><Unlock size={20} /> Unlock Grid</> : <><Lock size={20} /> Lock & Start Game</>}</button></div>
            <div className="bg-card p-6 rounded-xl border border-line"><h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-4">Grid Numbers</h3><div className="flex gap-4 items-center"><div className="flex-1"><button onClick={generateNumbers} disabled={gameState.isLocked} className="bg-navy-800 hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-ui duration-150"><Shuffle size={16} />{gameState.axisNumbers ? 'Regenerate' : 'Generate'} Numbers</button></div>{gameState.axisNumbers && (<div className="text-gold-500 bg-gold-500/10 p-4 rounded-full border border-gold-500/20"><Sparkles size={24} /></div>)}</div></div>

            {/* RANDOMIZER SECTION */}
            {gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'random' && gameState.ruleVariations.quarterlyRollover && (
              (() => {
                // Calculate conditions
                const gameIsOver = gameState.scores.gameStatus === 'post';
                const finalScore = gameState.scores.final;
                let finalSquareIsEmpty = false;

                if (finalScore && gameState.axisNumbers) {
                  const homeDigit = finalScore.home % 10;
                  const awayDigit = finalScore.away % 10;
                  const colIdx = gameState.axisNumbers.away.indexOf(awayDigit);
                  const rowIdx = gameState.axisNumbers.home.indexOf(homeDigit);
                  if (colIdx !== -1 && rowIdx !== -1) {
                    const squareId = rowIdx * 10 + colIdx;
                    finalSquareIsEmpty = !gameState.squares[squareId]?.owner;
                  }
                }

                const randomizerAvailable = gameIsOver && finalSquareIsEmpty;

                return (
                  <div className="bg-card p-6 rounded-xl border border-line border-t-4 border-t-gold-500 shadow-card">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2"><Sparkles className="text-gold-500" /> Final Prize Randomizer</h3>
                        <p className="text-sm font-body text-muted">Randomly select a square for the unclaimed rollover pot.</p>
                      </div>
                      {gameState.randomWinner ? (
                        <Badge status="winner">Winner Selected</Badge>
                      ) : randomizerAvailable ? (
                        <div className="bg-gold-500/15 text-gold-700 dark:text-gold-400 border border-gold-500/30 px-3 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em]">Ready to Roll</div>
                      ) : (
                        <Badge status="locked">Waiting</Badge>
                      )}
                    </div>

                    {/* Condition Checklist - show when not yet available */}
                    {!randomizerAvailable && !gameState.randomWinner && (
                      <div className="bg-surface border border-line rounded-lg p-4 mb-4">
                        <p className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mb-3">This feature will unlock when:</p>
                        <ul className="space-y-2 text-sm font-body">
                          <li className={`flex items-center gap-2 ${gameIsOver ? 'text-[#0F7B4A]' : 'text-muted'}`}>
                            {gameIsOver ? <CheckCircle size={16} className="text-[#0F7B4A]" /> : <div className="w-4 h-4 border-2 border-line rounded-full" />}
                            The game has ended (Final score recorded)
                          </li>
                          <li className={`flex items-center gap-2 ${finalSquareIsEmpty ? 'text-[#0F7B4A]' : 'text-muted'}`}>
                            {finalSquareIsEmpty ? <CheckCircle size={16} className="text-[#0F7B4A]" /> : <div className="w-4 h-4 border-2 border-line rounded-full" />}
                            The final winning square is unclaimed (empty)
                          </li>
                        </ul>
                      </div>
                    )}

                    {!gameState.randomWinner ? (
                      <button
                        onClick={handleRandomizeWinner}
                        disabled={!randomizerAvailable || isRandomizing}
                        className={`w-full py-6 rounded-xl font-display font-bold uppercase tracking-[0.05em] text-xl transition-ui duration-150 flex flex-col items-center gap-2 ${randomizerAvailable
                          ? 'bg-gold-foil text-navy-900 hover:brightness-105 fine:hover:-translate-y-px shadow-[0_6px_16px_rgba(140,109,51,0.28)]'
                          : 'bg-card text-faint border border-line cursor-not-allowed'
                          }`}
                      >
                        {isRandomizing ? 'ROLLING THE DICE...' : <span className="flex items-center gap-2"><Dices size={24} /> CLICK TO PICK RANDOM WINNER</span>}
                        {!isRandomizing && randomizerAvailable && <span className="text-xs font-normal opacity-80 uppercase tracking-widest">Hold Your Breath</span>}
                        {!randomizerAvailable && <span className="text-xs font-normal opacity-60 uppercase tracking-widest">Conditions Not Met</span>}
                      </button>
                    ) : (
                      <div className="bg-surface rounded-xl p-6 text-center border border-gold-500/40 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gold-foil"></div>
                        <p className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em] mb-2">The Lucky Square Is</p>
                        <div className="text-6xl font-display font-bold text-[color:var(--text)] num mb-2">#{gameState.randomWinner.squareId}</div>
                        <div className="text-xl text-gold-700 dark:text-gold-400 font-display font-bold uppercase mb-4">{gameState.randomWinner.owner}</div>
                        <p className="text-xs text-faint num">Selected at {new Date(gameState.randomWinner.timestamp).toLocaleTimeString()}</p>
                        <button
                          onClick={() => updateConfig({ randomWinner: undefined })}
                          className="mt-4 text-xs text-faint hover:text-brandred-600 underline"
                        >
                          Reset (Admin Only)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()
            )}

          </div>
        )}

        {/* PAYOUTS TAB */}
        {activeTab === 'payouts' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-card p-6 rounded-xl border border-line shadow-card">
              <h3 className="text-xl font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-2 flex items-center gap-2">
                <DollarSign size={20} className="text-gold-500" /> Winner Payout Tracking
              </h3>
              <p className="text-muted font-body text-sm mb-6">Track which winners have been paid out.</p>

              {(() => {
                // Calculate all winners from gameState
                const winners: { period: string; label: string; homeDigit: number; awayDigit: number; owner: string | null; squareId: number; amount: number; isPaid: boolean; paidAt?: number }[] = [];
                const periods = ['q1', 'half', 'q3', 'final'] as const;
                const periodLabels = { q1: 'Q1', half: 'Halftime', q3: 'Q3', final: 'Final' };

                // Helper to get the correct axis numbers for a period (4-set mode support)
                const getAxisForPeriod = (period: typeof periods[number]) => {
                  if (gameState.numberSets === 4 && gameState.quarterlyNumbers) {
                    const periodToQuarter = { q1: 'q1', half: 'q2', q3: 'q3', final: 'q4' } as const;
                    const quarterKey = periodToQuarter[period];
                    return gameState.quarterlyNumbers[quarterKey] || gameState.axisNumbers;
                  }
                  return gameState.axisNumbers;
                };

                // Check if we have any axis numbers (single set or quarterly)
                const hasAxisNumbers = gameState.axisNumbers ||
                  (gameState.numberSets === 4 && gameState.quarterlyNumbers &&
                    (gameState.quarterlyNumbers.q1 || gameState.quarterlyNumbers.q2 ||
                      gameState.quarterlyNumbers.q3 || gameState.quarterlyNumbers.q4));

                if (hasAxisNumbers) {
                  const totalPot = gameState.costPerSquare * gameState.squares.filter(s => s.owner).length;
                  const charityDeduction = gameState.charity?.enabled ? (totalPot * (gameState.charity.percentage / 100)) : 0;
                  const netPot = totalPot - charityDeduction;

                  periods.forEach((period) => {
                    const score = gameState.scores[period];
                    if (score) {
                      const currentAxis = getAxisForPeriod(period);
                      if (!currentAxis) return; // Skip if no axis for this period

                      const homeDigit = score.home % 10;
                      const awayDigit = score.away % 10;
                      const homeIdx = currentAxis.home.indexOf(homeDigit);
                      const awayIdx = currentAxis.away.indexOf(awayDigit);
                      const squareId = homeIdx * 10 + awayIdx;
                      const square = gameState.squares[squareId];
                      const payoutPct = gameState.payouts[period as keyof typeof gameState.payouts] || 0;
                      const amount = netPot * (payoutPct / 100);

                      winners.push({
                        period,
                        label: periodLabels[period],
                        homeDigit,
                        awayDigit,
                        owner: square?.owner || null,
                        squareId,
                        amount,
                        isPaid: square?.isPaid || false,
                        paidAt: square?.paidAt ?? undefined
                      });
                    }
                  });
                }

                const totalOwed = winners.reduce((acc, w) => acc + w.amount, 0);
                const totalPaid = winners.filter(w => w.isPaid).reduce((acc, w) => acc + w.amount, 0);

                return (
                  <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <StatTile label="Total Prize Pool" value={`$${totalOwed.toLocaleString()}`} accent="gold" />
                      <StatTile label="Paid Out" value={`$${totalPaid.toLocaleString()}`} accent="gold" />
                      <StatTile label="Pending" value={`$${(totalOwed - totalPaid).toLocaleString()}`} accent="gold" />
                    </div>

                    {/* Winners Table */}
                    {winners.length === 0 ? (
                      <div className="text-center py-12 text-muted">
                        <DollarSign size={40} className="mx-auto mb-4 opacity-50" />
                        <p className="font-display font-bold uppercase tracking-[0.05em]">No winners yet</p>
                        <p className="text-sm font-body">Winners will appear here once quarterly scores are recorded.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {winners.map((win) => (
                          <div
                            key={win.period}
                            className={`p-4 rounded-lg border flex items-center justify-between transition-ui ${win.isPaid ? 'bg-[#0F7B4A]/5 border-[#0F7B4A]/30' : 'bg-surface border-line'}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm ${win.isPaid ? 'bg-[#E4F5EC] text-[#0F7B4A]' : 'bg-card text-muted border border-line'}`}>
                                {(win.owner || '??').substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2">
                                  {win.label}
                                  <span className="text-xs text-muted num">({win.homeDigit}-{win.awayDigit})</span>
                                </div>
                                <div className="text-sm font-body text-muted">
                                  {win.owner || <span className="text-brandred-600 italic">Unclaimed Square</span>}
                                  <span className="text-faint ml-2 num">• Square #{win.squareId}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="font-display font-bold text-lg text-gold-700 dark:text-gold-400 num">${win.amount.toLocaleString()}</div>
                                {win.isPaid && win.paidAt && (
                                  <div className="text-[10px] text-faint num">Paid {new Date(win.paidAt).toLocaleDateString()}</div>
                                )}
                              </div>
                              <button
                                onClick={async () => {
                                  await dbService.markSquarePaid(gameState.id, [win.squareId], !win.isPaid);
                                }}
                                className={`px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-ui duration-150 ${win.isPaid
                                  ? 'bg-[#0F7B4A] text-white'
                                  : 'bg-navy-800 hover:bg-navy-700 text-white'}`}
                              >
                                {win.isPaid ? <span className="flex items-center gap-1"><CheckCircle size={14} /> Paid</span> : 'Mark Paid'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* COMMUNICATIONS TAB (ANNOUNCEMENTS) */}
        {activeTab === 'communications' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-card border border-line rounded-xl p-6">
              {currentUser ? (
                <AnnouncementManager pool={gameState} currentUser={currentUser} />
              ) : (
                <div className="text-center text-muted py-8">Please log in to send announcements.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'props' && (
          <div className="space-y-6 animate-in fade-in">
            <WizardStepSideHustle
              gameState={gameState}
              updateConfig={updateConfig}
            />
          </div>
        )}

        {activeTab === 'grading' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-card border border-line rounded-xl p-6">
              <PropGradingDashboard gameState={gameState} />
            </div>
          </div>
        )}

        {/* SCORING TAB */}
        {activeTab === 'scoring' && (
          <div className="space-y-8 animate-in fade-in">
            {/* MANUAL OVERRIDE TOGGLE */}
            <div className={`p-6 rounded-xl border transition-ui ${gameState.manualScoreOverride ? 'bg-gold-500/10 border-gold-500/50' : 'bg-card border-line'}`}>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className={`font-display font-bold uppercase tracking-[0.02em] text-lg ${gameState.manualScoreOverride ? 'text-gold-600 dark:text-gold-400' : 'text-[color:var(--text)]'}`}>Manual Score Override</h3>
                  <p className="text-sm font-body text-muted">Disable auto-updates and manually set scores in the database.</p>
                </div>
                <Switch
                  checked={!!gameState.manualScoreOverride}
                  onChange={(manualScoreOverride) => updateConfig({ manualScoreOverride })}
                  label="Manual score override"
                  tone="gold"
                />
              </div>
            </div>

            <div className={`bg-card p-6 rounded-xl border border-line relative overflow-hidden ${gameState.manualScoreOverride ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Wifi className="text-gold-500" size={20} /><h3 className="font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)]">Live Updates</h3></div>
                {fetchStatus && (<span className={`text-xs px-2 py-1 rounded font-display font-bold uppercase tracking-[0.05em] ${fetchStatus.type === 'success' ? 'text-[#0F7B4A] bg-[#0F7B4A]/10' : fetchStatus.type === 'error' ? 'text-brandred-600 bg-brandred-600/10' : 'text-muted'}`}>{fetchStatus.msg}</span>)}
              </div>
              <p className="text-muted font-body text-sm mb-6">{gameState.gameId ? `Linked to Game ID: ${gameState.gameId}. Updates will be precise.` : `Fuzzy matching active.`}</p>
              <button onClick={handleFetchLiveScores} disabled={isFetchingScores} className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 shadow-red-cta transition-ui duration-150 fine:hover:-translate-y-px"><RefreshCw size={18} className={isFetchingScores ? 'animate-spin' : ''} />{isFetchingScores ? 'Fetching Data...' : 'Auto-Update Scores'}</button>
              <button onClick={handleFixSync} disabled={isFixing} className="border border-brandred-600/40 bg-brandred-600/5 hover:bg-brandred-600/10 disabled:opacity-50 disabled:cursor-wait text-brandred-600 px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-ui duration-150 ml-2"><Hammer size={18} className={isFixing ? 'animate-spin' : ''} />{isFixing ? 'Repairing...' : 'Fix Sync'}</button>
            </div>
            <div className="bg-card p-6 rounded-xl border border-line"><h3 className="font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-4">Quarterly Scores</h3><div className="grid gap-4">{(['q1', 'half', 'q3', 'final'] as const).map((period) => {
              const isActive = !!gameState.scores[period];
              const label = period === 'q1' ? '1st Quarter' : period === 'half' ? 'Halftime' : period === 'q3' ? '3rd Quarter' : 'Final Score';
              return (<div key={period} className={`p-5 rounded-xl border transition-ui ${isActive ? 'bg-surface border-gold-500/50 shadow-card' : 'bg-card border-line opacity-60'}`}><div className="flex justify-between items-center mb-4"><h3 className="font-display font-bold uppercase tracking-[0.02em] text-lg text-[color:var(--text)]">{label}</h3><Switch checked={isActive} onChange={() => togglePeriodActive(period)} label={`Enable ${label} scoring`} tone="gold" /></div>{isActive && (<div className="flex items-center gap-4"><div className="flex-1"><label className="block text-xs text-muted mb-1 uppercase font-display font-bold tracking-[0.08em]">{gameState.homeTeam}</label><input type="number" value={gameState.scores[period]?.home || 0} onChange={(e) => handleScoreChange(period, 'home', e.target.value)} className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-[color:var(--text)] font-display num text-xl text-center focus:ring-2 focus:ring-gold-500 outline-none" /></div><div className="text-faint font-bold text-xl mt-4">-</div><div className="flex-1"><label className="block text-xs text-muted mb-1 uppercase font-display font-bold tracking-[0.08em]">{gameState.awayTeam}</label><input type="number" value={gameState.scores[period]?.away || 0} onChange={(e) => handleScoreChange(period, 'away', e.target.value)} className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-[color:var(--text)] font-display num text-xl text-center focus:ring-2 focus:ring-gold-500 outline-none" /></div></div>)}</div>);
            })}</div></div>
          </div>
        )}

        {/* REMINDERS TAB */}
        {activeTab === 'reminders' && (
          <div className="space-y-6 animate-in fade-in">
            <WizardStepReminders
              gameState={gameState}
              updateConfig={updateConfig}
            />
          </div>
        )}

        {/* PLAYERS TAB */}
        {activeTab === 'players' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatTile label="Total Players" value={getPlayers().length} />
              <StatTile label="Squares Sold" value={<>{gameState.squares.filter(s => s.owner).length} <span className="text-sm font-normal text-muted">/ 100</span></>} />
              <StatTile
                label="Revenue Collected"
                accent="gold"
                value={<>
                  ${getPlayers().reduce((acc, p) => acc + p.totalPaid, 0).toLocaleString()}
                  <span className="text-sm text-muted font-body font-normal ml-2">/ ${gameState.squares.filter(s => s.owner).length * gameState.costPerSquare}</span>
                </>}
              />
            </div>

            {/* Waitlist Section - Added for visibility */}
            {gameState.waitlist && gameState.waitlist.length > 0 && (
              <div className="bg-card border border-line rounded-xl overflow-hidden mb-6">
                <div className="p-4 border-b border-line bg-surface flex justify-between items-center">
                  <h3 className="font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2">
                    <Clock size={18} className="text-gold-500" /> Waitlist
                    <span className="bg-gold-500/10 text-gold-700 dark:text-gold-400 text-xs px-2 py-0.5 rounded-full border border-gold-500/20 num">{gameState.waitlist.length}</span>
                  </h3>
                  <button onClick={() => updateConfig({ waitlist: [] })} className="text-xs font-display font-bold uppercase tracking-[0.05em] text-brandred-600 hover:text-brandred-500">Clear List</button>
                </div>
                <div className="divide-y divide-line">
                  {gameState.waitlist.map((entry: WaitlistEntry, idx: number) => (
                    <div key={idx} className="p-4 flex items-center justify-between hover:bg-surface transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-muted text-xs font-display font-bold num">
                          {idx + 1}
                        </div>
                        <div>
                          <div className="font-body font-bold text-[color:var(--text)] text-sm">{entry.name}</div>
                          <div className="text-xs text-muted">{entry.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-display font-bold tracking-[0.08em] text-faint">Joined</div>
                          <div className="text-xs text-muted num">{new Date(entry.timestamp).toLocaleDateString()}</div>
                        </div>
                        <button
                          onClick={() => {
                            const newList = [...gameState.waitlist!];
                            newList.splice(idx, 1);
                            updateConfig({ waitlist: newList });
                          }}
                          className="text-faint hover:text-brandred-600 transition-colors p-2"
                          title="Remove from waitlist"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-card border border-line rounded-xl overflow-hidden">
              <div className="p-4 border-b border-line bg-surface flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2"><Users size={18} className="text-gold-500" /> Player List</h3>
                  {gameState.props?.enabled && (
                    <div className="flex bg-card rounded-lg p-1 border border-line">
                      <button
                        onClick={() => setPlayerTab('grid')}
                        className={`px-3 py-1 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-md transition-colors ${playerTab === 'grid' ? 'bg-navy-800 text-white shadow' : 'text-muted hover:text-[color:var(--text)]'}`}
                      >
                        Grid
                      </button>
                      <button
                        onClick={() => setPlayerTab('props')}
                        className={`px-3 py-1 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-md transition-colors ${playerTab === 'props' ? 'bg-navy-800 text-white shadow' : 'text-muted hover:text-[color:var(--text)]'}`}
                      >
                        Side Hustle
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleExportUsers} className="text-xs bg-navy-600/10 hover:bg-navy-600/20 text-navy-700 dark:text-gold-400 px-3 py-1.5 rounded font-display font-bold uppercase tracking-[0.05em] transition-colors flex items-center gap-1"><Download size={12} /> Export CSV</button>
                  {playerTab === 'grid' && (
                    <button onClick={async () => {
                      const ids = gameState.squares.filter(s => s.owner && !s.isPaid).map(s => s.id);
                      if (ids.length) await dbService.markSquarePaid(gameState.id, ids, true);
                    }} className="text-xs bg-[#0F7B4A]/10 hover:bg-[#0F7B4A]/20 text-[#0F7B4A] px-3 py-1.5 rounded font-display font-bold uppercase tracking-[0.05em] transition-colors">Mark All Paid</button>
                  )}
                </div>
              </div>

              {playerTab === 'grid' ? (
                getPlayers().length === 0 ? (
                  <div className="p-8 text-center text-muted">No players yet. Share the pool link!</div>
                ) : (
                  <div className="divide-y divide-line">
                    {getPlayers().map((player: PlayerSummary) => (

                      <div key={player.name} className="bg-card hover:bg-surface transition-colors">
                        <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpandedPlayer(expandedPlayer === player.name ? null : player.name)}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-surface rounded-full flex items-center justify-center border border-line">
                              <UserIcon size={20} className="text-muted" />
                            </div>
                            <div>
                              <h4 className="font-body font-bold text-[color:var(--text)] text-sm">{player.name}</h4>
                              <div className="flex gap-2 text-xs">
                                {!!gameState.charity?.enabled && (
                                  <div className="flex items-center gap-2 p-3 bg-surface rounded-lg border border-line">
                                    <div className="w-8 h-8 rounded-full bg-gold-500/10 flex items-center justify-center">
                                      <Heart size={16} className="text-gold-600 dark:text-gold-400" />
                                    </div>
                                    <div>
                                      <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">Charity</div>
                                      <div className="text-sm font-bold text-[color:var(--text)]">{gameState.charity?.name || 'Not Set'}</div>
                                    </div>
                                  </div>
                                )}
                                <span className="text-muted num">{player.squares.length} Squares</span>
                                {player.totalOwed > 0 && <span className="text-[#B4530A] font-bold num">Owes ${player.totalOwed}</span>}
                                {player.totalOwed === 0 && <span className="text-[#0F7B4A] font-bold">Paid in Full</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {player.contact?.email && (
                              <a href={`mailto:${player.contact.email}?subject=${encodeURIComponent(gameState.name)} Payment Reminder`} onClick={(e) => e.stopPropagation()} className="p-2 text-muted hover:text-gold-600 dark:hover:text-gold-400 transition-colors" title="Email Player"><Mail size={16} /></a>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setEditingPlayer({ originalName: player.name, name: player.name, email: player.contact?.email || '', phone: player.contact?.phone || '', notes: player.contact?.notes || '' }) }} className="p-2 text-muted hover:text-gold-600 dark:hover:text-gold-400 transition-colors" title="Edit Player"><Settings size={16} /></button>
                            <div className={`transition-transform duration-200 ${expandedPlayer === player.name ? 'rotate-180' : ''}`}><ArrowRight size={16} className="text-faint rotate-90" /></div>
                          </div>
                        </div>

                        {expandedPlayer === player.name && (
                          <div className="px-4 pb-4 pl-16 animate-in slide-in-from-top-2">
                            <div className="bg-surface rounded-lg p-4 border border-line">
                              {player.contact && (
                                <div className="mb-4 text-xs text-muted grid grid-cols-2 gap-2 pb-4 border-b border-line">
                                  {player.contact.email && <div><span className="font-display font-bold block text-faint uppercase tracking-[0.08em]">Email</span>{player.contact.email}</div>}
                                  {player.contact.phone && <div><span className="font-display font-bold block text-faint uppercase tracking-[0.08em]">Phone</span>{player.contact.phone}</div>}
                                  {player.contact.notes && player.contact.notes !== 'Test' && player.contact.notes !== 'test' && <div className="col-span-2"><span className="font-display font-bold block text-faint uppercase tracking-[0.08em]">Notes</span>{player.contact.notes}</div>}
                                </div>
                              )}

                              <div className="space-y-2">
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">Squares Owned</span>
                                  <button onClick={async () => {
                                    const ids = player.squares.map((s: Square) => s.id);
                                    if (ids.length) await dbService.markSquarePaid(gameState.id, ids, true);
                                  }} className="text-xs text-[#0F7B4A] hover:opacity-80 font-display font-bold uppercase tracking-[0.05em]">Mark All Paid</button>
                                </div>
                                {player.squares.map((sq: Square) => (
                                  <div key={sq.id} className="flex justify-between items-center bg-card p-2 rounded border border-line">
                                    <span className="text-sm font-body text-[color:var(--text)] num">Square #{sq.id}</span>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={async () => await dbService.markSquarePaid(gameState.id, [sq.id], !sq.isPaid)}
                                        className={`text-xs px-2 py-1 rounded-full font-display font-bold uppercase tracking-[0.08em] border transition-colors ${sq.isPaid ? 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]' : 'bg-[#FBEEDD] text-[#B4530A] border-[#F2D6B0]'}`}
                                      >
                                        {sq.isPaid ? 'PAID' : 'UNPAID'}
                                      </button>
                                      <button
                                        onClick={async () => { await dbService.releaseSquares(gameState.id, { squareIds: [sq.id] }); }}
                                        className="text-faint hover:text-brandred-600 transition-colors"
                                        title="Release Square"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-4 pt-4 border-t border-line flex justify-end">
                                <button onClick={() => releasePlayer(player.name)} className="text-xs text-brandred-600 hover:text-brandred-500 font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1"><Trash2 size={12} /> Remove Player & Release All Squares</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                // SIDE HUSTLE PLAYERS VIEW
                getPropPlayers().length === 0 ? (
                  <div className="p-8 text-center text-muted">No prop cards purchased yet.</div>
                ) : (
                  <div className="divide-y divide-line">
                    {getPropPlayers().map((player: PropPlayerSummary) => (
                      <div key={player.uid} className="bg-card hover:bg-surface transition-colors">
                        <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpandedPlayer(expandedPlayer === player.uid ? null : player.uid)}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-surface rounded-full flex items-center justify-center border border-line">
                              <UserIcon size={20} className="text-muted" />
                            </div>
                            <div>
                              <h4 className="font-body font-bold text-[color:var(--text)] text-sm">{player.name}</h4>
                              <div className="flex gap-2 text-xs">
                                <span className="text-muted num">{player.cards.length} Cards</span>
                                {player.totalOwed > 0 && <span className="text-[#B4530A] font-bold num">Owes ${player.totalOwed}</span>}
                                {player.totalOwed === 0 && <span className="text-[#0F7B4A] font-bold">Paid in Full</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            {player.email && (
                              <a href={`mailto:${player.email}?subject=${encodeURIComponent(gameState.name)} Payment Reminder`} onClick={(e) => e.stopPropagation()} className="p-2 text-muted hover:text-gold-600 dark:hover:text-gold-400 transition-colors" title="Email Player"><Mail size={16} /></a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingPlayer({
                                  originalName: player.uid, // Use UID as key
                                  name: player.name,
                                  email: player.email || '',
                                  phone: '',
                                  notes: ''
                                });
                              }}
                              className="p-2 text-muted hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                              title="Edit Player"
                            >
                              <Settings size={16} />
                            </button>
                            <div className={`transition-transform duration-200 ${expandedPlayer === player.uid ? 'rotate-180' : ''}`}>
                              <ArrowRight size={16} className="text-faint rotate-90" />
                            </div>
                          </div>
                        </div>

                        {expandedPlayer === player.uid && (
                          <div className="px-4 pb-4 pl-16 animate-in slide-in-from-top-2">
                            <div className="bg-surface rounded-lg p-4 border border-line">
                              <div className="space-y-2">
                                {player.cards.map((card: PropCard, idx: number) => (
                                  <div key={card.id} className="bg-card border border-line rounded p-3">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-sm font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] num">Card #{idx + 1}</span>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => dbService.updatePropCard(gameState.id, card.id!, { isPaid: !card.isPaid })}
                                          className={`text-xs px-2 py-1 rounded-full font-display font-bold uppercase tracking-[0.08em] border transition-colors ${card.isPaid ? 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]' : 'bg-[#FBEEDD] text-[#B4530A] border-[#F2D6B0]'}`}
                                        >
                                          {card.isPaid ? 'PAID' : 'UNPAID'}
                                        </button>
                                        <button
                                          onClick={() => dbService.deletePropCard(gameState.id, card.id!)}
                                          className="text-faint hover:text-brandred-600 transition-colors"
                                          title="Delete Card"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    {/* Answers Summary */}
                                    <div className="text-xs text-muted grid grid-cols-2 gap-x-4 gap-y-1">
                                      {gameState.props?.questions.map((q, i) => (
                                        <div key={q.id} className="truncate">
                                          <span className="font-bold text-faint mr-1 num">{i + 1}.</span>
                                          <span className={card.answers?.[q.id] ? 'text-muted' : 'text-faint italic'}>
                                            {card.answers?.[q.id] || 'No Answer'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 pt-4 border-t border-line flex justify-end">
                                <button onClick={() => removePropPlayer(player.uid)} className="text-xs text-brandred-600 hover:text-brandred-500 font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1"><Trash2 size={12} /> Remove Player & Delete All Cards</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>


            {/* EDIT PLAYER MODAL */}
            {editingPlayer && (
              <OverlayRoot id="squares-edit-player" label="Edit player details" onEscape={() => setEditingPlayer(null)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-card border border-line p-6 rounded-xl shadow-panel max-w-md w-full">
                  <h3 className="text-xl font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] mb-4">Edit Player Details</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Name</label>
                      <input type="text" value={editingPlayer.name} onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })} className="w-full bg-surface border border-line rounded px-3 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Email</label>
                      <input type="email" value={editingPlayer.email} onChange={(e) => setEditingPlayer({ ...editingPlayer, email: e.target.value })} className="w-full bg-surface border border-line rounded px-3 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Phone</label>
                      <input type="text" value={editingPlayer.phone} onChange={(e) => setEditingPlayer({ ...editingPlayer, phone: e.target.value })} className="w-full bg-surface border border-line rounded px-3 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Notes</label>
                      <textarea value={editingPlayer.notes} onChange={(e) => setEditingPlayer({ ...editingPlayer, notes: e.target.value })} className="w-full bg-surface border border-line rounded px-3 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500 h-24 resize-none" />
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <button onClick={() => setEditingPlayer(null)} className="px-4 py-2 text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]">Cancel</button>
                      <Button
                        onClick={() => {
                          if (playerTab === 'props') {
                            updatePropPlayerDetails(editingPlayer.originalName, editingPlayer);
                          } else {
                            updatePlayerDetails(editingPlayer.originalName, editingPlayer);
                          }
                        }}
                        size="sm"
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </div>
              </OverlayRoot>
            )}

          </div>
        )}

        {/* STATISTICS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-gold-500/10 p-3 rounded-xl border border-gold-500/30">
                <TrendingUp size={24} className="text-gold-600 dark:text-gold-400" />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)]">Pool Statistics</h2>
                <p className="text-sm font-body text-muted">Revenue, participation, and performance metrics</p>
              </div>
            </div>
            <PoolStatistics pool={gameState} />
          </div>
        )}
      </div>
      {/* RANDOMIZER OVERLAY */}
      {
        isRandomizing && (
          <OverlayRoot id="squares-randomizer" dialog={false} className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center backdrop-blur-md cursor-wait">
            <h2 className="text-4xl md:text-6xl font-display font-extrabold uppercase leading-[0.9] text-white mb-8 animate-pulse text-center">PICKING A WINNER</h2>
            <div className="w-64 h-64 bg-navy-900 rounded-3xl border-4 border-gold-500 flex items-center justify-center shadow-[0_0_100px_rgba(201,168,103,0.5)]">
              <span className="text-8xl font-display font-bold text-white tabular-nums">
                {randomizingNumber}
              </span>
            </div>
            <p className="text-gold-400 mt-8 font-display font-bold uppercase animate-bounce-3 tracking-widest">GOOD LUCK...</p>
          </OverlayRoot>
        )
      }
    </div >
  );
};

export default AdminPanel;
