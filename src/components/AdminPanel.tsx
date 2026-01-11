import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { PoolTheme, GameState, PropsPool, Scores, Square } from '../types';
import { Settings, Sparkles, Lock, Unlock, Trash2, Shuffle, ArrowLeft, Share2, RefreshCw, Wifi, Calendar, CheckCircle, Save, ArrowRight, DollarSign, Mail, Users, User as UserIcon, Shield, Heart, Bell, Clock, Download, Globe, QrCode, TrendingUp, Plus, Hammer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { getTeamLogo } from '../constants';
import { fetchGameScore } from '../services/scoreService';
import { AnnouncementManager } from './AnnouncementManager';
import { PropsManager } from './Props/PropsManager';
import { PropGradingDashboard } from './Props/PropGradingDashboard';
import { PoolStatistics } from './PoolStatistics';
import { DebouncedInput, DebouncedTextarea, WizardStepPayouts } from './admin';

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
  currentUser: any;
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
  /* AI Commissioner State - Commented out for now
  const [aiIdea, setAiIdea] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  */
  const [slugError, setSlugError] = useState<string | null>(null);

  // Updated Tab Order and Default
  const [activeTab, setActiveTab] = useState<'settings' | 'reminders' | 'players' | 'scoring' | 'game' | 'payouts' | 'communications' | 'stats' | 'props' | 'grading'>('settings');

  /* handleSlugChange removed in favor of inline DebouncedInput handler */

  const [wizardStep, setWizardStep] = useState(1);
  const TOTAL_STEPS = 8;

  const [isFetchingScores, setIsFetchingScores] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ type: 'success' | 'error' | 'neutral', msg: string } | null>(null);

  const [seasonType, setSeasonType] = useState('2');
  const [week, setWeek] = useState('1');
  const [scheduleGames, setScheduleGames] = useState<any[]>([]);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Players Tab State
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<{ originalName: string, name: string, email: string, phone: string, notes: string } | null>(null);

  // Email Broadcast State removed (replaced by AnnouncementManager)
  const [showQRCode, setShowQRCode] = useState(false);

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
  const [propCards, setPropCards] = useState<any[]>([]);
  const [playerTab, setPlayerTab] = useState<'grid' | 'props'>('grid');

  useEffect(() => {
    if (activeTab === 'players' && gameState.id) {
      const unsub = dbService.subscribeToAllPropCards(gameState.id, (cards) => {
        setPropCards(cards);
      });
      return () => unsub();
    }
  }, [activeTab, gameState.id]);


  const updatePlayerDetails = (originalName: string, newDetails: { name: string, email: string, phone: string, notes: string }) => {
    const newSquares = gameState.squares.map(sq => {
      if (sq.owner === originalName) {
        return {
          ...sq,
          owner: newDetails.name,
          playerDetails: {
            ...sq.playerDetails,
            email: newDetails.email,
            phone: newDetails.phone,
            notes: newDetails.notes
          }
        };
      }
      return sq;
    });
    updateConfig({ squares: newSquares });
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
      window.location.hash = `#pool/${gameState.id}`;
    }, 1500);
  };

  /*
  const askGeminiForIdeas = async () => {
    setIsThinking(true);
    setAiIdea('');
    try {
      const apiKey = import.meta.env.VITE_API_KEY;

      if (!apiKey) {
        setAiIdea("API Key missing. Please check configuration.");
        setIsThinking(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Generate a fun, creative, short rule variation for a Super Bowl Squares betting pool. Examples: 'Touchdowns on the 7 get a bonus', 'Score change payouts'. Keep it under 25 words.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      setAiIdea(response.text || "Could not generate idea.");
    } catch (error) {
      console.error("Gemini Error", error);
      setAiIdea("Failed to connect to AI Commissioner.");
    setIsThinking(false);
  };
  */

  const handleExportUsers = () => {
    const uniqueUsers = new Map<string, { name: string; email: string; phone: string }>();

    gameState.squares.forEach(square => {
      if (!square.owner) return;

      // Use email as key if available, otherwise name
      const email = square.playerDetails?.email || '';
      const name = square.owner;
      const key = email || name;

      if (!uniqueUsers.has(key)) {
        uniqueUsers.set(key, {
          name,
          email,
          phone: square.playerDetails?.phone || ''
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
        csvContent += `${safeEmail},${safeName},${safePhone}\n`;
      }
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${gameState.urlSlug || 'pool'}_participants.csv`);
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

    if (file.size > 2 * 1024 * 1024) { // 2MB Limit
      alert("Logo file is too large! Max size is 2MB.");
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
      const upcoming = events.filter((e: any) => {
        const gameDate = new Date(e.date);
        return gameDate > now;
      });

      setScheduleGames(upcoming);
    } catch (e) {
      console.error(e);
      // Sandbox fix: Remove alert
      setShowSchedule(false);
    }
    setIsLoadingSchedule(false);
  };

  const selectGame = (game: any) => {
    const comp = game.competitions[0];
    const home = comp.competitors.find((c: any) => c.homeAway === 'home').team;
    const away = comp.competitors.find((c: any) => c.homeAway === 'away').team;
    // Auto-set the Lock Time to the game start time
    const gameDate = new Date(game.date);
    const existingReminders = gameState.reminders || {
      payment: { enabled: false, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: false },
      lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: gameDate.getTime() },
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
          lockAt: gameDate.getTime()
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
    if (!window.confirm("This will reset the score events and force a full re-sync from ESPN. Use this ONLY if scores are stuck or missing. Continue?")) return;
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
      console.error(e);
      setFetchStatus({ type: 'error', msg: 'Repair Error' });
    }
    setIsFixing(false);
  };

  const totalPayout = (gameState.payouts.q1 || 0) + (gameState.payouts.half || 0) + (gameState.payouts.q3 || 0) + (gameState.payouts.final || 0);

  // Player Management Logic
  const getPlayers = () => {
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
      contact: squares[0].playerDetails
    }));
  };

  const getPropPlayers = () => {
    // Group cards by user
    const players: Record<string, any[]> = {};
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
    const userCards = propCards.filter(c => c.userId === uid);
    const updates: any = { userName: details.name, userEmail: details.email };
    await Promise.all(userCards.map(c => dbService.updatePropCard(gameState.id, c.id, updates)));
    setEditingPlayer(null);
  };

  const removePropPlayer = async (uid: string) => {
    // No confirmation dialog (Sandbox restriction)
    const userCards = propCards.filter(c => c.userId === uid);
    await Promise.all(userCards.map(c => dbService.deletePropCard(gameState.id, c.id)));
  };




  const updateSquare = (id: number, updates: Partial<Square>) => {
    const newSquares = [...gameState.squares];
    newSquares[id] = { ...newSquares[id], ...updates };
    updateConfig({ squares: newSquares });
  };

  const releasePlayer = (ownerName: string) => {
    // Sandbox fix: Remove window.confirm
    const newSquares = gameState.squares.map(sq =>
      sq.owner === ownerName ? { ...sq, owner: null, playerDetails: null, isPaid: false } : sq
    );
    updateConfig({ squares: newSquares });
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

  const CFB_CONFERENCES = [
    { id: '80', name: 'All FBS (Div I-A)' },
    { id: '81', name: 'All FCS (Div I-AA)' },
    { id: '1', name: 'ACC' },
    { id: '4', name: 'Big 12' },
    { id: '5', name: 'Big Ten' },
    { id: '8', name: 'SEC' },
    { id: '9', name: 'Pac-12' },
    { id: '151', name: 'American' },
    { id: '12', name: 'C-USA' },
    { id: '15', name: 'MAC' },
    { id: '17', name: 'Mountain West' },
    { id: '37', name: 'Sun Belt' },
  ];

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

  const renderWizardReminders = () => {
    // Safe access with defaults to prevent crashes
    const defaultReminders = {
      payment: { enabled: false, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: false },
      lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: undefined as number | undefined },
      winner: { enabled: true, channels: ['email'] as ('email' | 'in-app')[], includeDigits: true, includeCharityImpact: true }
    };

    const safeReminders = {
      payment: { ...defaultReminders.payment, ...(gameState.reminders?.payment || {}) },
      lock: { ...defaultReminders.lock, ...(gameState.reminders?.lock || {}) },
      winner: { ...defaultReminders.winner, ...(gameState.reminders?.winner || {}) }
    };

    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-300">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
            <Bell size={20} className="text-amber-400" /> Payment Reminders
          </h3>
          <p className="text-slate-400 text-sm mb-6">Automate follow-ups for unpaid squares.</p>

          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
              <div>
                <span className="font-bold text-slate-200 block">Enable Auto-Reminders</span>
                <span className="text-xs text-slate-500">System checks every 15 mins for unpaid reservations.</span>
              </div>
              <input
                type="checkbox"
                checked={safeReminders.payment.enabled}
                onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, enabled: e.target.checked } } })}
                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
            </label>

            {safeReminders.payment.enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Grace Period (Minutes)</label>
                  <input
                    type="number"
                    value={safeReminders.payment.graceMinutes}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, graceMinutes: parseInt(e.target.value) || 0 } } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Wait time after reservation before detailed reminder.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Repeat Every (Hours)</label>
                  <input
                    type="number"
                    value={safeReminders.payment.repeatEveryHours}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, repeatEveryHours: parseInt(e.target.value) || 0 } } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Frequency of follow-up emails.</p>
                </div>

                {/* Notify Users Toggle */}
                <label className="md:col-span-2 flex items-center gap-3 cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input
                    type="checkbox"
                    checked={safeReminders.payment.notifyUsers}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, notifyUsers: e.target.checked } } })}
                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600"
                  />
                  <span className="text-sm text-slate-300">Also email the <strong>Participants</strong> directly (not just Host summary)</span>
                </label>

                {/* Auto-Release Configuration */}
                <div className="md:col-span-2 pt-4 border-t border-slate-800 mt-2">
                  <label className="flex items-center justify-between cursor-pointer p-2 mb-2">
                    <div>
                      <span className="font-bold text-rose-400 block flex items-center gap-2">
                        <Trash2 size={14} /> Auto-Release Unpaid Squares
                      </span>
                      <span className="text-xs text-slate-500">Automatically remove reservation if not paid in time.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={safeReminders.payment.autoRelease}
                      onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, autoRelease: e.target.checked } } })}
                      className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-rose-600 focus:ring-rose-500"
                    />
                  </label>

                  {safeReminders.payment.autoRelease && (
                    <div className="pl-4 animate-in fade-in">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Release After (Hours)</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          value={safeReminders.payment.autoReleaseHours || 24}
                          onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, autoReleaseHours: parseInt(e.target.value) || 0 } } })}
                          className="w-24 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-rose-500"
                        />
                        <span className="text-xs text-slate-500">hours from reservation time.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
            <Clock size={20} className="text-rose-400" /> Auto-Lock & Number Generation
          </h3>
          <p className="text-slate-400 text-sm mb-6">Automatically lock the grid and reveal numbers.</p>

          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-900 rounded mb-2 border border-transparent hover:border-slate-700 transition-all">
              <input
                type="checkbox"
                checked={safeReminders.lock.enabled}
                onChange={(e) => updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: e.target.checked } } })}
                className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="text-sm font-bold text-slate-200 block">Enable Auto-Lock System</span>
                <span className="text-xs text-slate-500">If disabled, the pool will NEVER auto-lock.</span>
              </div>
            </label>

            <div className={`bg-slate-950 p-4 rounded-lg border border-slate-800 ${!safeReminders.lock.enabled ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Trigger Time</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white mb-4 outline-none focus:border-indigo-500"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'manual') {
                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: undefined } } });
                  } else if (val === 'custom') {
                    // Default to Game Start Time if available, otherwise Now + 1 Hour
                    let defaultTime = new Date();
                    if (gameState.scores.startTime) {
                      defaultTime = new Date(gameState.scores.startTime);
                    } else {
                      defaultTime.setMinutes(defaultTime.getMinutes() + 60);
                    }
                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: defaultTime.getTime() } } });
                  } else {
                    const offsetMins = parseInt(val);
                    if (gameState.scores.startTime) {
                      const start = new Date(gameState.scores.startTime).getTime();
                      updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: start - (offsetMins * 60 * 1000) } } });
                    }
                  }
                }}
                value={
                  !safeReminders.lock.lockAt ? 'manual' :
                    gameState.scores.startTime && Math.abs(safeReminders.lock.lockAt - (new Date(gameState.scores.startTime).getTime() - 3600000)) < 10000 ? '60' :
                      gameState.scores.startTime && Math.abs(safeReminders.lock.lockAt - (new Date(gameState.scores.startTime).getTime() - 1800000)) < 10000 ? '30' :
                        gameState.scores.startTime && Math.abs(safeReminders.lock.lockAt - (new Date(gameState.scores.startTime).getTime() - 900000)) < 10000 ? '15' :
                          gameState.scores.startTime && Math.abs(safeReminders.lock.lockAt - (new Date(gameState.scores.startTime).getTime() - 300000)) < 10000 ? '5' :
                            'custom'
                }
              >
                <option value="manual">Manual (I will click 'Lock')</option>
                <option value="60" disabled={!gameState.scores.startTime}>1 Hour Before Kickoff</option>
                <option value="30" disabled={!gameState.scores.startTime}>30 Minutes Before Kickoff</option>
                <option value="15" disabled={!gameState.scores.startTime}>15 Minutes Before Kickoff</option>
                <option value="5" disabled={!gameState.scores.startTime}>5 Minutes Before Kickoff</option>
                <option value="custom">Custom Date & Time...</option>
              </select>

              {safeReminders.lock.lockAt && (
                <div className="animate-in fade-in slide-in-from-top-2 border-t border-slate-800 pt-4 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Date</label>
                      <input
                        type="date"
                        value={(() => {
                          // Fix: Use LOCAL date, not UTC (toISOString uses UTC)
                          const d = new Date(safeReminders.lock.lockAt);
                          const year = d.getFullYear();
                          const month = String(d.getMonth() + 1).padStart(2, '0');
                          const day = String(d.getDate()).padStart(2, '0');
                          return `${year}-${month}-${day}`;
                        })()}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const [y, m, d] = e.target.value.split('-').map(Number);
                          const current = new Date(safeReminders.lock.lockAt!);
                          current.setFullYear(y);
                          current.setMonth(m - 1);
                          current.setDate(d);
                          updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Time</label>
                      <div className="flex bg-slate-900 border border-slate-700 rounded px-1">
                        <select
                          className="bg-transparent text-white outline-none text-center font-bold font-mono py-2 flex-1"
                          value={(() => {
                            let h = new Date(safeReminders.lock.lockAt!).getHours();
                            if (h === 0) h = 12;
                            else if (h > 12) h -= 12;
                            return h;
                          })()}
                          onChange={(e) => {
                            const newH = parseInt(e.target.value);
                            const current = new Date(safeReminders.lock.lockAt!);
                            const isPM = current.getHours() >= 12;
                            let h = newH;
                            if (isPM && newH !== 12) h += 12;
                            if (!isPM && newH === 12) h = 0;
                            current.setHours(h);
                            updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                          }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h} className="bg-slate-900 text-white">{h}</option>)}
                        </select>
                        <span className="py-2 text-slate-500">:</span>
                        <select
                          className="bg-transparent text-white outline-none text-center font-bold font-mono py-2 flex-1"
                          value={Math.floor(new Date(safeReminders.lock.lockAt).getMinutes() / 5) * 5}
                          onChange={(e) => {
                            const m = parseInt(e.target.value);
                            const current = new Date(safeReminders.lock.lockAt!);
                            current.setMinutes(m);
                            updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                          }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i * 5).map(m => <option key={m} value={m} className="bg-slate-900 text-white">{m.toString().padStart(2, '0')}</option>)}
                        </select>
                        <select
                          className="bg-transparent text-indigo-400 outline-none font-bold py-2 pl-2"
                          value={new Date(safeReminders.lock.lockAt).getHours() >= 12 ? 'PM' : 'AM'}
                          onChange={(e) => {
                            const isPM = e.target.value === 'PM';
                            const current = new Date(safeReminders.lock.lockAt!);
                            let h = current.getHours();
                            if (isPM && h < 12) h += 12;
                            if (!isPM && h >= 12) h -= 12;
                            current.setHours(h);
                            updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                          }}
                        >
                          <option value="AM" className="bg-slate-900 text-white">AM</option>
                          <option value="PM" className="bg-slate-900 text-white">PM</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-emerald-400 mt-2 flex items-center gap-1">
                    <CheckCircle size={10} /> Grid will automatically lock and numbers will be generated at this time.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                    📍 Times shown in your local timezone: <span className="font-mono text-slate-400">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span> <br />
                    (Server Time: {new Date().toLocaleTimeString([], { timeZoneName: 'short' })})
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
            <Sparkles size={20} className="text-emerald-400" /> Winner Announcements
          </h3>
          <p className="text-slate-400 text-sm mb-6">Instant alerts when a quarter closes.</p>
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
              <div>
                <span className="font-bold text-slate-200 block">Enable Winner Emails</span>
                <span className="text-xs text-slate-500">Auto-email all participants when a winner is calculated.</span>
              </div>
              <input
                type="checkbox"
                checked={safeReminders.winner.enabled}
                onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, enabled: e.target.checked } } })}
                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
            {safeReminders.winner.enabled && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={safeReminders.winner.includeDigits}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, includeDigits: e.target.checked } } })}
                    className="w-5 h-5 rounded bg-slate-800 border-slate-600"
                  />
                  <span className="text-sm text-slate-300">Include Winning Digits</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={safeReminders.winner.includeCharityImpact}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, includeCharityImpact: e.target.checked } } })}
                    className="w-5 h-5 rounded bg-slate-800 border-slate-600"
                  />
                  <span className="text-sm text-slate-300">Include Charity Impact</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render Wizard STep 1 (Now Matchup)
  const renderWizardStep1 = () => {
    // Prefer API logos, fallback to local map
    const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam);
    const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam);
    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-300">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-start mb-6">
            <div><h3 className="text-xl font-bold text-white mb-2">The Matchup</h3><p className="text-slate-400 text-sm">Select the teams. Import from the schedule to auto-fetch logos.</p></div>
            <button onClick={() => {
              setShowSchedule(!showSchedule);
              if (!showSchedule) {
                // Smart Defaults
                const isCollege = gameState.league === 'college' || gameState.league === 'ncaa';
                const month = new Date().getMonth();
                if (isCollege && (month === 11 || month === 0)) {
                  setSeasonType('3'); // Postseason
                  setWeek('1');
                } else {
                  setWeek(currentEstimatedWeek.toString());
                }
              }
            }} className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${showSchedule ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.6)] border border-indigo-400 hover:scale-105 ring-2 ring-indigo-500/30'}`}>
              <Calendar size={18} className={!showSchedule ? 'animate-pulse' : ''} />
              {showSchedule ? 'Hide Schedule' : 'Find Game'}
            </button>
          </div>
          {showSchedule && (
            <div className="mb-6 bg-slate-950 border border-slate-700 rounded-xl p-4 animate-in fade-in">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <select value={gameState.league || 'nfl'} onChange={(e) => updateConfig({ league: e.target.value as any })} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm outline-none font-bold">
                  <option value="nfl">NFL (Pro)</option>
                  <option value="college">College (NCAA)</option>
                </select>

                <select value={seasonType} onChange={(e) => {
                  const newType = e.target.value;
                  setSeasonType(newType);
                  // Reset week logic
                  if (newType === '2') {
                    setWeek(currentEstimatedWeek.toString());
                  } else {
                    setWeek('1');
                  }
                }} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm outline-none">
                  <option value="1">Preseason</option>
                  <option value="2">Regular Season</option>
                  <option value="3">Postseason</option>
                </select>

                <span className="text-slate-500 text-sm">Week</span>
                <select value={week} onChange={(e) => setWeek(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm outline-none">
                  {seasonType === '2' ? (
                    Array.from({ length: 18 }).map((_, i) => {
                      const w = i + 1;
                      if (w < currentEstimatedWeek) return null;
                      return <option key={i} value={w}>Week {w}</option>;
                    })
                  ) : (
                    seasonType === '1' ? Array.from({ length: 4 }).map((_, i) => <option key={i} value={i + 1}>Week {i + 1}</option>) : null
                  )}
                  {seasonType === '3' && (
                    <>
                      <option value="1">Wild Card</option>
                      <option value="2">Divisional</option>
                      <option value="3">Conf. Champ</option>
                      <option value="4">Pro Bowl</option>
                      <option value="5">Super Bowl</option>
                    </>
                  )}
                </select>

                {(gameState.league === 'college' || gameState.league === 'ncaa') && (
                  <select value={cfbConference} onChange={(e) => setCfbConference(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm outline-none max-w-[150px]">
                    {CFB_CONFERENCES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}

                <button onClick={fetchSchedule} disabled={isLoadingSchedule} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-bold ml-auto flex items-center gap-2">
                  {isLoadingSchedule ? 'Loading...' : <><RefreshCw size={14} /> Find Games</>}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {scheduleGames.length === 0 && !isLoadingSchedule && (
                  <div className="text-slate-500 text-sm text-center py-4">No future games found for this week.</div>
                )}
                {scheduleGames.map((game: any) => {
                  const comp = game.competitions[0];
                  const home = comp.competitors.find((c: any) => c.homeAway === 'home').team;
                  const away = comp.competitors.find((c: any) => c.homeAway === 'away').team;
                  const dateStr = new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={game.id} onClick={() => selectGame(game)} className="flex items-center justify-between p-2 rounded hover:bg-slate-800 cursor-pointer border border-transparent hover:border-indigo-500/30 group transition-all">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 w-24">{dateStr}</span>
                        <div className="flex items-center gap-2">
                          <img src={away.logo} className="w-5 h-5 object-contain" />
                          <span className="text-sm text-slate-300 font-bold">{away.abbreviation}</span>
                        </div>
                        <span className="text-xs text-slate-600">@</span>
                        <div className="flex items-center gap-2">
                          <img src={home.logo} className="w-5 h-5 object-contain" />
                          <span className="text-sm text-slate-300 font-bold">{home.abbreviation}</span>
                        </div>
                      </div>
                      <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 font-bold transition-opacity">Select</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="bg-slate-950 border border-slate-700 rounded-xl p-6 relative group hover:border-indigo-500/50 transition-colors"><label className="block text-xs font-bold text-indigo-400 uppercase mb-4 text-center">Column Team (Top)</label><div className="flex flex-col items-center gap-4"><div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center border-2 border-slate-800 p-4 shadow-xl">{awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" /> : <Shield size={40} className="text-slate-600" />}</div>
              <DebouncedInput
                value={gameState.awayTeam}
                onChange={(val) => {
                  updateConfig({ awayTeam: val });
                  if (!gameState.name || gameState.name === 'New Pool') {
                    updateConfig({ name: `${val} vs ${gameState.homeTeam || 'Home'} Squares` });
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-center font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Select a game above"
                disabled={true}
              />
            </div></div>
            <div className="bg-slate-950 border border-slate-700 rounded-xl p-6 relative group hover:border-rose-500/50 transition-colors"><label className="block text-xs font-bold text-rose-400 uppercase mb-4 text-center">Row Team (Left)</label><div className="flex flex-col items-center gap-4"><div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center border-2 border-slate-800 p-4 shadow-xl">{homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" /> : <Shield size={40} className="text-slate-600" />}</div>
              <DebouncedInput
                value={gameState.homeTeam}
                onChange={(val) => {
                  updateConfig({ homeTeam: val });
                  if (!gameState.name || gameState.name === 'New Pool') {
                    updateConfig({ name: `${gameState.awayTeam || 'Away'} vs ${val} Squares` });
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-center font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Select a game above"
                disabled={true}
              />
            </div></div>
          </div>
        </div>
      </div >
    )
  };

  // Step 2 is now Basic Information
  const renderWizardStep2 = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-2">Basic Information</h3>
        <p className="text-slate-400 text-sm mb-6">Let's verify the core details of your pool.</p>

        {/* Public Visibility Toggle */}
        <div className="mb-6 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${gameState.isPublic ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
              <Globe size={24} />
            </div>
            <div>
              <h4 className={`font-bold ${gameState.isPublic ? 'text-white' : 'text-slate-400'}`}>Public Visibility</h4>
              <p className="text-xs text-slate-500">
                {gameState.isPublic
                  ? "Your pool is listed in the 'Browse Pools' directory."
                  : "Only people with the link can access this pool."}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={!!gameState.isPublic}
              onChange={(e) => updateConfig({ isPublic: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label><DebouncedInput value={gameState.name} onChange={(val) => updateConfig({ name: val })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Enter Pool Name" /></div>

          {/* League Selector Moved to Step 1 */}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">URL Slug</label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-slate-600 font-mono text-sm">/</span>
              <DebouncedInput value={gameState.urlSlug || ''} onChange={(val) => {
                const safe = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
                if (safe && !checkSlugAvailable(safe)) setSlugError("Slug is already taken");
                else setSlugError(null);
                updateConfig({ urlSlug: safe });
              }} className={`w-full bg-slate-950 border ${slugError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} rounded pl-6 pr-4 py-3 text-white focus:ring-1 outline-none`} placeholder="unique-id" />
            </div>
            {slugError && <p className="text-rose-500 text-xs mt-1 font-bold">{slugError}</p>}
            <p className="text-slate-500 text-[10px] mt-1">Lowercase letters, numbers, and dashes only.</p>
          </div>
          <div className="md:col-span-1"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Manager Name</label><DebouncedInput value={gameState.managerName || ''} onChange={(val) => updateConfig({ managerName: val })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Your Name" /></div>
          <div className="md:col-span-1"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email</label><DebouncedInput value={gameState.contactEmail} onChange={(val) => updateConfig({ contactEmail: val })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="admin@example.com" /></div>
          <div className="md:col-span-1"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo Handle (@username)</label><DebouncedInput value={gameState.paymentHandles?.venmo || ''} onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, venmo: val } })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="@YourVenmo" /></div>
          <div className="md:col-span-1"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Google Pay Info</label><DebouncedInput value={gameState.paymentHandles?.googlePay || ''} onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, googlePay: val } })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Email or Phone" /></div>
          <div className="md:col-span-2"><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label><DebouncedTextarea value={gameState.paymentInstructions} onChange={(val) => updateConfig({ paymentInstructions: val })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-24 resize-none" /></div>
        </div>
      </div>
    </div>
  );

  const renderWizardStep3 = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-2">Grid Rules</h3>
        <p className="text-slate-400 text-sm mb-6">Set the pricing and limitations for your players.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-700"><label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cost Per Square</label><div className="flex items-center gap-3"><div className="bg-emerald-500/20 p-3 rounded-lg text-emerald-400"><DollarSign size={24} /></div><input type="number" value={gameState.costPerSquare} onChange={(e) => updateConfig({ costPerSquare: parseInt(e.target.value) || 0 })} className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-emerald-500 py-1" /></div></div>
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-700"><label className="block text-xs font-bold text-slate-400 uppercase mb-2">Max Squares / Player</label><div className="flex items-center gap-3"><div className="bg-indigo-500/20 p-3 rounded-lg text-indigo-400"><Shield size={24} /></div><input type="number" value={gameState.maxSquaresPerPlayer} onChange={(e) => updateConfig({ maxSquaresPerPlayer: parseInt(e.target.value) || 0 })} className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-indigo-500 py-1" /></div></div>
          <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Number Sets</label><select value={gameState.numberSets} onChange={(e) => updateConfig({ numberSets: parseInt(e.target.value) || 1 })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"><option value="1">Single Set (Same numbers all game)</option><option value="4">4 Sets (New numbers every quarter)</option></select></div>
          <div><label className="block text-xs font-bold text-slate-400 uppercase mb-1">Show "Paid" Status</label><select value={gameState.showPaid ? 'Yes' : 'No'} onChange={(e) => updateConfig({ showPaid: e.target.value === 'Yes' })} className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"><option>Yes</option><option>No</option></select></div>
        </div>
      </div>
    </div>
  );

  const renderWizardStep4 = () => (
    <WizardStepPayouts
      gameState={gameState}
      updateConfig={updateConfig}
      totalPayout={totalPayout}
    />
  );

  const renderWizardStep5 = () => {
    // Default props structure for SQUARES pools
    const sideHustle = gameState.props || {
      enabled: false,
      cost: 10,
      maxCards: 1,
      payouts: [100],
      questions: []
    };

    const toggleSideHustle = (enabled: boolean) => {
      updateConfig({
        props: {
          ...sideHustle,
          enabled
        }
      });
    };

    const updateSideHustle = (updates: Partial<typeof sideHustle>) => {
      updateConfig({
        props: {
          ...sideHustle,
          ...updates
        }
      });
    };

    const payoutTotal = sideHustle.payouts?.reduce((a, b) => a + b, 0) || 0;

    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-300">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                <Sparkles size={20} className="text-amber-400" /> Side Hustle Props
              </h3>
              <p className="text-slate-400 text-sm">Add a bonus prop bet game alongside your squares pool.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={sideHustle.enabled}
                onChange={(e) => toggleSideHustle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {sideHustle.enabled && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-6">
              {/* Basic Settings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Entry Fee ($)</label>
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-500/20 p-3 rounded-lg text-emerald-400">
                      <DollarSign size={24} />
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={sideHustle.cost}
                      onChange={(e) => updateSideHustle({ cost: Number(e.target.value) })}
                      className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-emerald-500 py-1"
                    />
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Max Cards Per Player</label>
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-500/20 p-3 rounded-lg text-indigo-400">
                      <Users size={24} />
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={sideHustle.maxCards}
                      onChange={(e) => updateSideHustle({ maxCards: Number(e.target.value) })}
                      className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-indigo-500 py-1"
                    />
                  </div>
                </div>
              </div>

              {/* Payout Structure */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <h4 className="font-bold text-white mb-4 flex items-center justify-between">
                  <span>Payout Structure (Percentages)</span>
                  <span className={`text-sm ${payoutTotal === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    Total: {payoutTotal}%
                  </span>
                </h4>

                <div className="space-y-3">
                  {sideHustle.payouts?.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 text-sm">
                        {idx + 1}
                      </div>
                      <div className="flex-grow relative">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={p}
                          onChange={(e) => {
                            const newPayouts = [...(sideHustle.payouts || [])];
                            newPayouts[idx] = Number(e.target.value);
                            updateSideHustle({ payouts: newPayouts });
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white pr-8 focus:border-indigo-500 outline-none"
                        />
                        <span className="absolute right-3 top-2 text-slate-500">%</span>
                      </div>
                      <button
                        onClick={() => {
                          const newPayouts = sideHustle.payouts?.filter((_, i) => i !== idx);
                          updateSideHustle({ payouts: newPayouts });
                        }}
                        className="p-2 text-slate-500 hover:text-rose-400 transition-colors"
                        disabled={(sideHustle.payouts?.length || 0) <= 1}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      const currentTotal = sideHustle.payouts?.reduce((a, b) => a + b, 0) || 0;
                      if (currentTotal < 100) {
                        updateSideHustle({ payouts: [...(sideHustle.payouts || []), 100 - currentTotal] });
                      }
                    }}
                    className="w-full py-2 border border-dashed border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <Plus size={16} /> Add Place
                  </button>
                </div>
              </div>

              {/* Props Questions Manager */}
              <div className="border-t border-slate-800 pt-6">
                <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                  <span className="text-lg">❓</span> Prop Questions
                </h4>
                <PropsManager
                  gameState={gameState as unknown as PropsPool}
                  updateConfig={updateConfig as any}
                  isWizardMode={true}
                />
              </div>
            </div>
          )}

          {!sideHustle.enabled && (
            <div className="text-center py-8 text-slate-500">
              <Sparkles size={48} className="mx-auto mb-4 opacity-30" />
              <p>Enable Side Hustle to add a bonus prop bet game to your pool.</p>
              <p className="text-xs mt-2">Players can pick answers to fun prop questions for a chance to win extra prizes!</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWizardStep6 = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      {/* Theme Selector */}
      {availableThemes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
            <Sparkles size={20} className="text-amber-400" /> Pool Theme
          </h3>
          <p className="text-slate-400 text-sm mb-6">Select a color theme for your pool. This changes the overall look and feel.</p>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* No Theme Option */}
            <button
              onClick={() => updateConfig({ themeId: undefined })}
              className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${!gameState.themeId ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-950'}`}
            >
              <div className="h-12 rounded-lg bg-slate-800 mb-3 flex items-center justify-center">
                <span className="text-slate-500 text-xs">Default</span>
              </div>
              <span className="font-bold text-white text-sm">Classic Dark</span>
              <span className="text-xs text-slate-400 block">Original theme</span>
            </button>

            {availableThemes.map((theme) => (
              <button
                key={theme.id || theme.name}
                onClick={() => handleThemeSelect(theme)}
                className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${gameState.themeId === theme.id ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-slate-700 hover:border-slate-500'}`}
              >
                {/* Theme Preview */}
                <div
                  className="h-12 rounded-lg mb-3 flex items-center justify-center"
                  style={{ background: theme.colors?.background }}
                >
                  {/* Mini grid preview */}
                  <div className="flex gap-0.5">
                    {[0, 1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-sm"
                        style={{
                          background: i % 2 === 0 ? theme.grid?.cellBackground : theme.grid?.cellBackgroundAlt,
                          border: `1px solid ${theme.grid?.cellBorder}`
                        }}
                      />
                    ))}
                  </div>
                </div>
                <span className="font-bold text-white text-sm">{theme.name}</span>
                <span className="text-xs text-slate-400 block truncate">{theme.description}</span>
                {/* Color dots */}
                <div className="flex gap-1 mt-2">
                  {['primary', 'secondary', 'success'].map(key => (
                    <div
                      key={key}
                      className="w-3 h-3 rounded-full border border-slate-600"
                      style={{ background: (theme.colors as any)?.[key] }}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-2">Customization</h3>
        <p className="text-slate-400 text-sm mb-6">Make the pool your own with a custom logo and background.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Logo Upload */}
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-amber-400" /> Pool Logo
            </h4>

            <div className="flex flex-col items-center gap-4">
              {gameState.branding?.logoUrl ? (
                <div className="relative group">
                  <div className="w-32 h-32 bg-slate-900 rounded-lg flex items-center justify-center border border-slate-600 p-2">
                    <img src={gameState.branding.logoUrl} className="max-w-full max-h-full object-contain" />
                  </div>
                  <button
                    onClick={() => updateConfig({ branding: { ...gameState.branding, logoUrl: undefined } })}
                    className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg hover:bg-rose-600 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="w-32 h-32 bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 gap-2">
                  <div className="p-2 bg-slate-800 rounded-full"><Sparkles size={20} /></div>
                  <span className="text-xs">No Logo</span>
                </div>
              )}

              <div className="w-full">
                <label className="block text-center cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                  Upload Logo (Max 2MB)
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
                <p className="text-[10px] text-slate-500 text-center mt-2">Recommended: Square PNG with transparent background.</p>
              </div>
            </div>
          </div>

          {/* Background Color */}
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
              <Settings size={16} className="text-emerald-400" /> Background color
            </h4>
            <p className="text-xs text-slate-400 mb-4">Choose a background color for your pool page.</p>

            <div className="flex items-center gap-4">
              <input
                type="color"
                value={gameState.branding?.backgroundColor || '#0f172a'} // Default Slate-900
                onChange={(e) => updateConfig({ branding: { ...gameState.branding, backgroundColor: e.target.value } })}
                className="w-16 h-16 rounded cursor-pointer border-none p-0 bg-transparent"
              />
              <div className="flex-1">
                <div className="font-mono text-white mb-1">{gameState.branding?.backgroundColor || '#0f172a'}</div>
                <button
                  onClick={() => updateConfig({ branding: { ...gameState.branding, backgroundColor: '#0f172a' } })}
                  className="text-xs text-slate-500 hover:text-white underline"
                >
                  Reset to Default
                </button>
              </div>
            </div>

            {/* Mini Preview */}
            <div className="mt-8">
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Live Preview</p>
              <div
                className="w-full h-24 rounded-lg flex items-center justify-center border border-slate-600 relative overflow-hidden"
                style={{ backgroundColor: gameState.branding?.backgroundColor || '#0f172a' }}
              >
                {gameState.branding?.logoUrl && (
                  <img src={gameState.branding.logoUrl} className="h-12 w-12 object-contain drop-shadow-lg" />
                )}
                <div className="absolute bottom-2 left-0 w-full text-center">
                  <span className="text-[10px] text-white/50 font-bold uppercase tracking-widest">Your Pool</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWizardStep7 = () => renderWizardReminders();

  const renderWizardStep8 = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-2">Final Preferences</h3>
        <p className="text-slate-400 text-sm mb-6">Customize data collection, notifications, and advanced rules.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Player Data */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Users size={16} className="text-indigo-400" /> Player Data Collection</h4>
            <div className="space-y-3">
              {['collectPhone', 'collectAddress', 'collectReferral', 'collectNotes'].map((field) => (
                <label key={field} className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                  <span className="text-sm text-slate-300 capitalize">{field.replace('collect', '').replace(/([A-Z])/g, ' $1').trim()}</span>
                  <input type="checkbox" checked={(gameState as any)[field]} onChange={(e) => updateConfig({ [field]: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                </label>
              ))}
            </div>
          </div>

          {/* Email Notifications - NEW */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Mail size={16} className="text-sky-400" /> Email Notifications</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 uppercase font-bold mb-1">User Picks Confirmation</label>
                <select
                  value={gameState.emailConfirmation}
                  onChange={(e) => updateConfig({ emailConfirmation: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
                >
                  <option value="No Email Confirmation">Don't Send</option>
                  <option value="Email Confirmation">Send Email Receipt</option>
                </select>
              </div>

              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                <span className="text-sm text-slate-300">Email Players when Numbers Set</span>
                <input type="checkbox" checked={gameState.emailNumbersGenerated} onChange={(e) => updateConfig({ emailNumbersGenerated: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
              </label>

              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded border-t border-slate-800 pt-3">
                <span className="text-sm text-slate-300">Alert Admin when Grid Full</span>
                <input type="checkbox" checked={gameState.notifyAdminFull} onChange={(e) => updateConfig({ notifyAdminFull: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
              </label>
            </div>
          </div>

          {/* Access Control */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Lock size={16} className="text-amber-400" /> Access Control</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Grid Password</label>
                <input type="text" value={gameState.gridPassword} onChange={(e) => updateConfig({ gridPassword: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white outline-none" placeholder="Optional" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input type="checkbox" checked={gameState.isPublic} onChange={(e) => updateConfig({ isPublic: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm text-slate-300">List in Public Directory</span>
              </label>
            </div>
          </div>

          {/* QR Code Sharing */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2"><QrCode size={16} className="text-emerald-400" /> Share via QR Code</h4>
            <div className="text-center">
              <button
                onClick={() => setShowQRCode(!showQRCode)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
              >
                <QrCode size={16} />
                {showQRCode ? 'Hide QR Code' : 'Generate QR Code'}
              </button>
              {showQRCode && (
                <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                  <div className="bg-white p-4 rounded-xl inline-block">
                    <QRCodeSVG
                      id="pool-qr-code"
                      value={`${window.location.origin}/#pool/${gameState.urlSlug || gameState.id}`}
                      size={180}
                      level="H"
                      includeMargin
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-3">Scan to join pool</p>
                  <button
                    onClick={() => {
                      const svg = document.getElementById('pool-qr-code');
                      if (!svg) return;
                      const svgData = new XMLSerializer().serializeToString(svg);
                      const canvas = document.createElement('canvas');
                      const ctx = canvas.getContext('2d');
                      const img = new Image();
                      img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx?.drawImage(img, 0, 0);
                        const pngUrl = canvas.toDataURL('image/png');
                        const a = document.createElement('a');
                        a.href = pngUrl;
                        a.download = `${gameState.urlSlug || 'pool'}_qr.png`;
                        a.click();
                      };
                      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                    }}
                    className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors inline-flex items-center gap-2"
                  >
                    <Download size={14} /> Download PNG
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
            <div><h1 className="text-xl font-bold text-white flex items-center gap-2"><Settings className="text-indigo-400" size={20} /> {gameState.name} {gameState.charity?.enabled && <span className="text-xs bg-rose-500 text-white px-2 py-0.5 rounded-full">Charity</span>}</h1><p className="text-xs text-slate-500">Admin Editor</p></div>
          </div>
          <div className="flex gap-2">
            <button onClick={onShare} className="text-xs bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-600 px-3 py-2 rounded font-bold cursor-pointer flex items-center gap-2"><Share2 size={14} /> Share</button>
            <button onClick={() => window.location.hash = `#pool/${gameState.id}`} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded font-bold cursor-pointer">Open Public View</button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-6 text-sm">
          <div className="max-w-5xl mx-auto px-6 flex gap-6 text-sm overflow-x-auto">
            {(['settings', 'reminders', 'players', 'scoring', 'game', 'payouts', 'props', 'grading', 'communications', 'stats'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 border-b-2 transition-colors font-medium whitespace-nowrap ${activeTab === tab ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                {tab === 'settings' ? 'Setup Wizard' : tab === 'reminders' ? 'Smart Reminders' : tab === 'game' ? 'Game Status' : tab === 'stats' ? 'Statistics' : tab === 'payouts' ? 'Payouts' : tab === 'props' ? 'Side Hustle' : tab === 'grading' ? 'Grading' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {saveMessage && (<div className="fixed top-24 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 flex items-center gap-2"><CheckCircle size={20} />{saveMessage}</div>)}

        {/* SETTINGS (WIZARD) TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="mb-8">
              {/* Clickable Wizard Progress Indicators */}
              <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-2">
                {[
                  { step: 1, label: '1. Matchup' },
                  { step: 2, label: '2. Basics' },
                  { step: 3, label: '3. Rules' },
                  { step: 4, label: '4. Payouts' },
                  { step: 5, label: '5. Side Hustle' },
                  { step: 6, label: '6. Branding' },
                  { step: 7, label: '7. Reminders' },
                  { step: 8, label: '8. Finish' }
                ].map(s => (
                  <button
                    key={s.step}
                    onClick={() => setWizardStep(s.step)}
                    className={`uppercase font-bold transition-colors hover:text-white ${wizardStep >= s.step ? 'text-indigo-400' : ''}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 transition-all duration-500 ease-out" style={{ width: `${(wizardStep / TOTAL_STEPS) * 100}%` }}></div>
              </div>
            </div>

            {wizardStep === 1 && renderWizardStep1()}
            {wizardStep === 2 && renderWizardStep2()}
            {wizardStep === 3 && renderWizardStep3()}
            {wizardStep === 4 && renderWizardStep4()}
            {wizardStep === 5 && renderWizardStep5()}
            {wizardStep === 6 && renderWizardStep6()}
            {wizardStep === 7 && renderWizardStep7()}
            {wizardStep === 8 && renderWizardStep8()}

            <div className="flex justify-between pt-6 border-t border-slate-800">
              <button onClick={() => setWizardStep(Math.max(1, wizardStep - 1))} disabled={wizardStep === 1} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all"><ArrowLeft size={18} /> Previous</button>
              {wizardStep < TOTAL_STEPS ? (
                <button onClick={() => setWizardStep(Math.min(TOTAL_STEPS, wizardStep + 1))} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20">Next Step <ArrowRight size={18} /></button>
              ) : (
                <button onClick={handleSave} className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"><Save size={18} /> Save Complete Pool</button>
              )}
            </div>
          </div>
        )}

        {/* GAME STATUS TAB */}
        {activeTab === 'game' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm"><div className="flex justify-between items-center mb-6"><div><h3 className="text-lg font-bold text-white">Game Status</h3><p className="text-sm text-slate-500">Control the betting and number generation.</p></div><span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wide ${gameState.isLocked ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>{gameState.isLocked ? 'Locked' : 'Open'}</span></div><button onClick={toggleLock} className={`w-full py-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all text-lg ${gameState.isLocked ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'}`}>{gameState.isLocked ? <><Unlock size={20} /> Unlock Grid</> : <><Lock size={20} /> Lock & Start Game</>}</button></div>
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800"><h3 className="text-lg font-bold text-white mb-4">Grid Numbers</h3><div className="flex gap-4 items-center"><div className="flex-1"><button onClick={generateNumbers} disabled={gameState.isLocked} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg text-sm font-medium flex items-center gap-2 border border-slate-700"><Shuffle size={16} />{gameState.axisNumbers ? 'Regenerate' : 'Generate'} Numbers</button></div>{gameState.axisNumbers && (<div className="text-emerald-400 bg-emerald-500/10 p-4 rounded-full border border-emerald-500/20"><Sparkles size={24} /></div>)}</div></div>
            {/* <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-6 rounded-xl border border-indigo-500/30"><div className="flex items-center gap-2 mb-4"><Sparkles className="text-indigo-400" size={20} /><h3 className="text-lg font-bold text-indigo-100">AI Commissioner</h3></div>{aiIdea && (<div className="bg-slate-950/80 p-4 rounded-lg border border-indigo-500/30 mb-4 shadow-inner"><p className="text-lg text-indigo-200 font-serif italic">"{aiIdea}"</p></div>)}<button onClick={askGeminiForIdeas} disabled={isThinking} className="bg-indigo-600/80 hover:bg-indigo-500 text-white py-2 px-4 rounded-lg text-sm font-bold uppercase tracking-wide transition-colors">{isThinking ? 'Thinking...' : 'Suggest Rule Variation'}</button></div> */}

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
                  <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 border-t-4 border-t-amber-500 shadow-xl">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles className="text-amber-400" /> Final Prize Randomizer</h3>
                        <p className="text-sm text-slate-400">Randomly select a square for the unclaimed rollover pot.</p>
                      </div>
                      {gameState.randomWinner ? (
                        <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-bold uppercase">Winner Selected</div>
                      ) : randomizerAvailable ? (
                        <div className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-bold uppercase">Ready to Roll</div>
                      ) : (
                        <div className="bg-slate-700/50 text-slate-400 border border-slate-600/30 px-3 py-1 rounded-full text-xs font-bold uppercase">Waiting</div>
                      )}
                    </div>

                    {/* Condition Checklist - show when not yet available */}
                    {!randomizerAvailable && !gameState.randomWinner && (
                      <div className="bg-slate-950 border border-slate-700 rounded-lg p-4 mb-4">
                        <p className="text-xs text-slate-400 font-bold uppercase mb-3">This feature will unlock when:</p>
                        <ul className="space-y-2 text-sm">
                          <li className={`flex items-center gap-2 ${gameIsOver ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {gameIsOver ? <CheckCircle size={16} className="text-emerald-400" /> : <div className="w-4 h-4 border-2 border-slate-600 rounded-full" />}
                            The game has ended (Final score recorded)
                          </li>
                          <li className={`flex items-center gap-2 ${finalSquareIsEmpty ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {finalSquareIsEmpty ? <CheckCircle size={16} className="text-emerald-400" /> : <div className="w-4 h-4 border-2 border-slate-600 rounded-full" />}
                            The final winning square is unclaimed (empty)
                          </li>
                        </ul>
                      </div>
                    )}

                    {!gameState.randomWinner ? (
                      <button
                        onClick={handleRandomizeWinner}
                        disabled={!randomizerAvailable || isRandomizing}
                        className={`w-full py-6 rounded-xl font-bold text-xl shadow-lg transition-all flex flex-col items-center gap-2 ${randomizerAvailable
                          ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-orange-500/20'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                      >
                        {isRandomizing ? 'ROLLING THE DICE...' : '🎲 CLICK TO PICK RANDOM WINNER'}
                        {!isRandomizing && randomizerAvailable && <span className="text-xs font-normal opacity-80 uppercase tracking-widest">Hold Your Breath</span>}
                        {!randomizerAvailable && <span className="text-xs font-normal opacity-60 uppercase tracking-widest">Conditions Not Met</span>}
                      </button>
                    ) : (
                      <div className="bg-slate-950 rounded-xl p-6 text-center border border-emerald-500/30 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500"></div>
                        <p className="text-slate-500 text-xs font-bold uppercase mb-2">The Lucky Square Is</p>
                        <div className="text-6xl font-black text-white font-mono mb-2">#{gameState.randomWinner.squareId}</div>
                        <div className="text-xl text-emerald-400 font-bold mb-4">{gameState.randomWinner.owner}</div>
                        <p className="text-xs text-slate-600">Selected at {new Date(gameState.randomWinner.timestamp).toLocaleTimeString()}</p>
                        <button
                          onClick={() => updateConfig({ randomWinner: undefined })}
                          className="mt-4 text-xs text-slate-500 hover:text-rose-500 underline"
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
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <DollarSign size={20} className="text-emerald-400" /> Winner Payout Tracking
              </h3>
              <p className="text-slate-400 text-sm mb-6">Track which winners have been paid out.</p>

              {(() => {
                // Calculate all winners from gameState
                const winners: { period: string; label: string; homeDigit: number; awayDigit: number; owner: string | null; squareId: number; amount: number; isPaid: boolean; paidAt?: number }[] = [];
                const periods = ['q1', 'half', 'q3', 'final'] as const;
                const periodLabels = { q1: 'Q1', half: 'Halftime', q3: 'Q3', final: 'Final' };

                if (gameState.axisNumbers) {
                  const totalPot = gameState.costPerSquare * gameState.squares.filter(s => s.owner).length;
                  const charityDeduction = gameState.charity?.enabled ? (totalPot * (gameState.charity.percentage / 100)) : 0;
                  const netPot = totalPot - charityDeduction;

                  periods.forEach((period) => {
                    const score = gameState.scores[period];
                    if (score) {
                      const homeDigit = score.home % 10;
                      const awayDigit = score.away % 10;
                      const homeIdx = gameState.axisNumbers!.home.indexOf(homeDigit);
                      const awayIdx = gameState.axisNumbers!.away.indexOf(awayDigit);
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
                      <div className="bg-slate-950 border border-slate-700 p-4 rounded-lg">
                        <p className="text-slate-400 text-xs font-bold uppercase mb-1">Total Prize Pool</p>
                        <div className="text-2xl font-bold text-white font-mono">${totalOwed.toLocaleString()}</div>
                      </div>
                      <div className="bg-slate-950 border border-emerald-500/30 p-4 rounded-lg">
                        <p className="text-emerald-400 text-xs font-bold uppercase mb-1">Paid Out</p>
                        <div className="text-2xl font-bold text-emerald-400 font-mono">${totalPaid.toLocaleString()}</div>
                      </div>
                      <div className="bg-slate-950 border border-amber-500/30 p-4 rounded-lg">
                        <p className="text-amber-400 text-xs font-bold uppercase mb-1">Pending</p>
                        <div className="text-2xl font-bold text-amber-400 font-mono">${(totalOwed - totalPaid).toLocaleString()}</div>
                      </div>
                    </div>

                    {/* Winners Table */}
                    {winners.length === 0 ? (
                      <div className="text-center py-12 text-slate-500">
                        <DollarSign size={40} className="mx-auto mb-4 opacity-50" />
                        <p className="font-bold">No winners yet</p>
                        <p className="text-sm">Winners will appear here once quarterly scores are recorded.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {winners.map((win) => (
                          <div
                            key={win.period}
                            className={`p-4 rounded-lg border flex items-center justify-between transition-all ${win.isPaid ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-950 border-slate-700'}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${win.isPaid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                                <DollarSign size={20} />
                              </div>
                              <div>
                                <div className="font-bold text-white flex items-center gap-2">
                                  {win.label}
                                  <span className="text-xs font-mono text-slate-500">({win.homeDigit}-{win.awayDigit})</span>
                                </div>
                                <div className="text-sm text-slate-400">
                                  {win.owner || <span className="text-rose-400 italic">Unclaimed Square</span>}
                                  <span className="text-slate-600 ml-2">• Square #{win.squareId}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="font-bold text-lg text-emerald-400 font-mono">${win.amount.toLocaleString()}</div>
                                {win.isPaid && win.paidAt && (
                                  <div className="text-[10px] text-slate-500">Paid {new Date(win.paidAt).toLocaleDateString()}</div>
                                )}
                              </div>
                              <button
                                onClick={async () => {
                                  await dbService.markSquarePaid(gameState.id, [win.squareId], !win.isPaid);
                                }}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${win.isPaid
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                              >
                                {win.isPaid ? '✓ Paid' : 'Mark Paid'}
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
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <AnnouncementManager pool={gameState} currentUser={currentUser} />
            </div>
          </div>
        )}

        {activeTab === 'props' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {renderWizardStep5()}
          </div>
        )}

        {activeTab === 'grading' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <PropGradingDashboard gameState={gameState} />
            </div>
          </div>
        )}

        {/* SCORING TAB */}
        {activeTab === 'scoring' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* MANUAL OVERRIDE TOGGLE */}
            <div className={`p-6 rounded-xl border transition-all ${gameState.manualScoreOverride ? 'bg-amber-900/20 border-amber-500/50' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className={`font-bold text-lg ${gameState.manualScoreOverride ? 'text-amber-400' : 'text-slate-200'}`}>Manual Score Override</h3>
                  <p className="text-sm text-slate-400">Disable auto-updates and manually set scores in the database.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={!!gameState.manualScoreOverride} onChange={(e) => updateConfig({ manualScoreOverride: e.target.checked })} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            </div>

            <div className={`bg-slate-900 p-6 rounded-xl border border-slate-800 relative overflow-hidden ${gameState.manualScoreOverride ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Wifi className="text-indigo-400" size={20} /><h3 className="font-bold text-white">Live Updates</h3></div>
                {fetchStatus && (<span className={`text-xs px-2 py-1 rounded font-bold ${fetchStatus.type === 'success' ? 'text-emerald-400 bg-emerald-900/30' : fetchStatus.type === 'error' ? 'text-rose-400 bg-rose-900/30' : 'text-slate-400'}`}>{fetchStatus.msg}</span>)}
              </div>
              <p className="text-slate-400 text-sm mb-6">{gameState.gameId ? `Linked to Game ID: ${gameState.gameId}. Updates will be precise.` : `Fuzzy matching active.`}</p>
              <button onClick={handleFetchLiveScores} disabled={isFetchingScores} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"><RefreshCw size={18} className={isFetchingScores ? 'animate-spin' : ''} />{isFetchingScores ? 'Fetching Data...' : 'Auto-Update Scores'}</button>
              <button onClick={handleFixSync} disabled={isFixing} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all ml-2"><Hammer size={18} className={isFixing ? 'animate-spin' : ''} />{isFixing ? 'Repairing...' : 'Fix Sync'}</button>
            </div>
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800"><h3 className="font-bold text-white mb-4">Quarterly Scores</h3><div className="grid gap-4">{(['q1', 'half', 'q3', 'final'] as const).map((period) => {
              const isActive = !!gameState.scores[period];
              const label = period === 'q1' ? '1st Quarter' : period === 'half' ? 'Halftime' : period === 'q3' ? '3rd Quarter' : 'Final Score';
              return (<div key={period} className={`p-5 rounded-xl border transition-all ${isActive ? 'bg-slate-800 border-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'bg-slate-900 border-slate-800 opacity-60'}`}><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg text-slate-200">{label}</h3><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={isActive} onChange={() => togglePeriodActive(period)} className="sr-only peer" /><div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div></label></div>{isActive && (<div className="flex items-center gap-4"><div className="flex-1"><label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider">{gameState.homeTeam}</label><input type="number" value={gameState.scores[period]?.home || 0} onChange={(e) => handleScoreChange(period, 'home', e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-xl text-center focus:ring-2 focus:ring-indigo-500 outline-none" /></div><div className="text-slate-600 font-bold text-xl mt-4">-</div><div className="flex-1"><label className="block text-xs text-slate-500 mb-1 uppercase font-bold tracking-wider">{gameState.awayTeam}</label><input type="number" value={gameState.scores[period]?.away || 0} onChange={(e) => handleScoreChange(period, 'away', e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-xl text-center focus:ring-2 focus:ring-indigo-500 outline-none" /></div></div>)}</div>);
            })}</div></div>
          </div>
        )}

        {/* REMINDERS TAB */}
        {activeTab === 'reminders' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {renderWizardReminders()}
          </div>
        )}

        {/* PLAYERS TAB */}
        {activeTab === 'players' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Total Players</p>
                <div className="text-3xl font-bold text-white">{getPlayers().length}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Squares Sold</p>
                <div className="text-3xl font-bold text-white">{gameState.squares.filter(s => s.owner).length} <span className="text-sm font-normal text-slate-500">/ 100</span></div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Revenue Collected</p>
                <div className="text-3xl font-bold text-emerald-400 font-mono">
                  ${getPlayers().reduce((acc, p) => acc + p.totalPaid, 0).toLocaleString()}
                  <span className="text-sm text-slate-500 font-sans font-normal ml-2">/ ${gameState.squares.filter(s => s.owner).length * gameState.costPerSquare}</span>
                </div>
              </div>
            </div>

            {/* Waitlist Section - Added for visibility */}
            {gameState.waitlist && gameState.waitlist.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
                <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Clock size={18} className="text-amber-400" /> Waitlist
                    <span className="bg-amber-500/10 text-amber-400 text-xs px-2 py-0.5 rounded-full border border-amber-500/20">{gameState.waitlist.length}</span>
                  </h3>
                  <button onClick={() => updateConfig({ waitlist: [] })} className="text-xs text-rose-400 hover:text-rose-300">Clear List</button>
                </div>
                <div className="divide-y divide-slate-800">
                  {gameState.waitlist.map((entry, idx) => (
                    <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-800/20 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xs font-bold">
                          {idx + 1}
                        </div>
                        <div>
                          <div className="font-bold text-white text-sm">{entry.name}</div>
                          <div className="text-xs text-slate-500">{entry.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] slate-500 uppercase font-bold text-slate-600">Joined</div>
                          <div className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleDateString()}</div>
                        </div>
                        <button
                          onClick={() => {
                            const newList = [...gameState.waitlist!];
                            newList.splice(idx, 1);
                            updateConfig({ waitlist: newList });
                          }}
                          className="text-slate-600 hover:text-rose-500 transition-colors p-2"
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

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="font-bold text-white flex items-center gap-2"><Users size={18} className="text-indigo-400" /> Player List</h3>
                  {gameState.props?.enabled && (
                    <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                      <button
                        onClick={() => setPlayerTab('grid')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${playerTab === 'grid' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Grid
                      </button>
                      <button
                        onClick={() => setPlayerTab('props')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${playerTab === 'props' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Side Hustle
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleExportUsers} className="text-xs bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded font-bold transition-colors flex items-center gap-1"><Download size={12} /> Export CSV</button>
                  {playerTab === 'grid' && (
                    <button onClick={async () => {
                      const ids = gameState.squares.filter(s => s.owner && !s.isPaid).map(s => s.id);
                      if (ids.length) await dbService.markSquarePaid(gameState.id, ids, true);
                    }} className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded font-bold transition-colors">Mark All Paid</button>
                  )}
                </div>
              </div>

              {playerTab === 'grid' ? (
                getPlayers().length === 0 ? (
                  <div className="p-8 text-center text-slate-500">No players yet. Share the pool link!</div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {getPlayers().map((player: any) => (

                      <div key={player.name} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                        <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpandedPlayer(expandedPlayer === player.name ? null : player.name)}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                              <UserIcon size={20} className="text-slate-400" />
                            </div>
                            <div>
                              <h4 className="font-bold text-white text-sm">{player.name}</h4>
                              <div className="flex gap-2 text-xs">
                                {!!gameState.charity?.enabled && (
                                  <div className="flex items-center gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                                    <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center">
                                      <Heart size={16} className="text-rose-500" />
                                    </div>
                                    <div>
                                      <div className="text-xs text-slate-500 font-bold uppercase">Charity</div>
                                      <div className="text-sm font-bold text-white">{gameState.charity?.name || 'Not Set'}</div>
                                    </div>
                                  </div>
                                )}
                                <span className="text-slate-400">{player.squares.length} Squares</span>
                                {player.totalOwed > 0 && <span className="text-rose-400 font-bold">Owes ${player.totalOwed}</span>}
                                {player.totalOwed === 0 && <span className="text-emerald-400 font-bold">Paid in Full</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {player.contact?.email && (
                              <a href={`mailto:${player.contact.email}?subject=${encodeURIComponent(gameState.name)} Payment Reminder`} onClick={(e) => e.stopPropagation()} className="p-2 text-slate-400 hover:text-indigo-400 transition-colors" title="Email Player"><Mail size={16} /></a>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setEditingPlayer({ originalName: player.name, name: player.name, email: player.contact?.email || '', phone: player.contact?.phone || '', notes: player.contact?.notes || '' }) }} className="p-2 text-slate-400 hover:text-indigo-400 transition-colors" title="Edit Player"><Settings size={16} /></button>
                            <div className={`transition-transform duration-200 ${expandedPlayer === player.name ? 'rotate-180' : ''}`}><ArrowRight size={16} className="text-slate-600 rotate-90" /></div>
                          </div>
                        </div>

                        {expandedPlayer === player.name && (
                          <div className="px-4 pb-4 pl-16 animate-in slide-in-from-top-2">
                            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                              {player.contact && (
                                <div className="mb-4 text-xs text-slate-400 grid grid-cols-2 gap-2 pb-4 border-b border-slate-800">
                                  {player.contact.email && <div><span className="font-bold block text-slate-500 uppercase">Email</span>{player.contact.email}</div>}
                                  {player.contact.phone && <div><span className="font-bold block text-slate-500 uppercase">Phone</span>{player.contact.phone}</div>}
                                  {player.contact.notes && player.contact.notes !== 'Test' && player.contact.notes !== 'test' && <div className="col-span-2"><span className="font-bold block text-slate-500 uppercase">Notes</span>{player.contact.notes}</div>}
                                </div>
                              )}

                              <div className="space-y-2">
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-xs font-bold text-slate-500 uppercase">Squares Owned</span>
                                  <button onClick={async () => {
                                    const ids = player.squares.map((s: any) => s.id);
                                    if (ids.length) await dbService.markSquarePaid(gameState.id, ids, true);
                                  }} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold">Mark All Paid</button>
                                </div>
                                {player.squares.map((sq: any) => (
                                  <div key={sq.id} className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-800">
                                    <span className="text-sm font-mono text-slate-300">Square #{sq.id}</span>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={async () => await dbService.markSquarePaid(gameState.id, [sq.id], !sq.isPaid)}
                                        className={`text-xs px-2 py-1 rounded font-bold border transition-colors ${sq.isPaid ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}
                                      >
                                        {sq.isPaid ? 'PAID' : 'UNPAID'}
                                      </button>
                                      <button
                                        onClick={() => { updateSquare(sq.id, { owner: null, playerDetails: null, isPaid: false }); }}
                                        className="text-slate-600 hover:text-rose-500 transition-colors"
                                        title="Release Square"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-4 pt-4 border-t border-slate-800 flex justify-end">
                                <button onClick={() => releasePlayer(player.name)} className="text-xs text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1"><Trash2 size={12} /> Remove Player & Release All Squares</button>
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
                  <div className="p-8 text-center text-slate-500">No prop cards purchased yet.</div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {getPropPlayers().map((player: any) => (
                      <div key={player.uid} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                        <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpandedPlayer(expandedPlayer === player.uid ? null : player.uid)}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                              <UserIcon size={20} className="text-slate-400" />
                            </div>
                            <div>
                              <h4 className="font-bold text-white text-sm">{player.name}</h4>
                              <div className="flex gap-2 text-xs">
                                <span className="text-slate-400">{player.cards.length} Cards</span>
                                {player.totalOwed > 0 && <span className="text-rose-400 font-bold">Owes ${player.totalOwed}</span>}
                                {player.totalOwed === 0 && <span className="text-emerald-400 font-bold">Paid in Full</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            {player.email && (
                              <a href={`mailto:${player.email}?subject=${encodeURIComponent(gameState.name)} Payment Reminder`} onClick={(e) => e.stopPropagation()} className="p-2 text-slate-400 hover:text-indigo-400 transition-colors" title="Email Player"><Mail size={16} /></a>
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
                              className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                              title="Edit Player"
                            >
                              <Settings size={16} />
                            </button>
                            <div className={`transition-transform duration-200 ${expandedPlayer === player.uid ? 'rotate-180' : ''}`}>
                              <ArrowRight size={16} className="text-slate-600 rotate-90" />
                            </div>
                          </div>
                        </div>

                        {expandedPlayer === player.uid && (
                          <div className="px-4 pb-4 pl-16 animate-in slide-in-from-top-2">
                            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                              <div className="space-y-2">
                                {player.cards.map((card: any, idx: number) => (
                                  <div key={card.id} className="bg-slate-900 border border-slate-800 rounded p-3">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-sm font-bold text-slate-300">Card #{idx + 1}</span>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => dbService.updatePropCard(gameState.id, card.id, { isPaid: !card.isPaid })}
                                          className={`text-xs px-2 py-1 rounded font-bold border transition-colors ${card.isPaid ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}
                                        >
                                          {card.isPaid ? 'PAID' : 'UNPAID'}
                                        </button>
                                        <button
                                          onClick={() => dbService.deletePropCard(gameState.id, card.id)}
                                          className="text-slate-600 hover:text-rose-500 transition-colors"
                                          title="Delete Card"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    {/* Answers Summary */}
                                    <div className="text-xs text-slate-500 grid grid-cols-2 gap-x-4 gap-y-1">
                                      {gameState.props?.questions.map((q, i) => (
                                        <div key={q.id} className="truncate">
                                          <span className="font-bold text-slate-600 mr-1">{i + 1}.</span>
                                          <span className={card.answers?.[q.id] ? 'text-slate-400' : 'text-slate-700 italic'}>
                                            {card.answers?.[q.id] || 'No Answer'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 pt-4 border-t border-slate-800 flex justify-end">
                                <button onClick={() => removePropPlayer(player.uid)} className="text-xs text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1"><Trash2 size={12} /> Remove Player & Delete All Cards</button>
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
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl shadow-2xl max-w-md w-full">
                  <h3 className="text-xl font-bold text-white mb-4">Edit Player Details</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Name</label>
                      <input type="text" value={editingPlayer.name} onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Email</label>
                      <input type="email" value={editingPlayer.email} onChange={(e) => setEditingPlayer({ ...editingPlayer, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Phone</label>
                      <input type="text" value={editingPlayer.phone} onChange={(e) => setEditingPlayer({ ...editingPlayer, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Notes</label>
                      <textarea value={editingPlayer.notes} onChange={(e) => setEditingPlayer({ ...editingPlayer, notes: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500 h-24 resize-none" />
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <button onClick={() => setEditingPlayer(null)} className="px-4 py-2 text-slate-300 hover:text-white font-bold">Cancel</button>
                      <button
                        onClick={() => {
                          if (playerTab === 'props') {
                            updatePropPlayerDetails(editingPlayer.originalName, editingPlayer);
                          } else {
                            updatePlayerDetails(editingPlayer.originalName, editingPlayer);
                          }
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* STATISTICS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/30">
                <TrendingUp size={24} className="text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Pool Statistics</h2>
                <p className="text-sm text-slate-500">Revenue, participation, and performance metrics</p>
              </div>
            </div>
            <PoolStatistics pool={gameState} />
          </div>
        )}
      </div>
      {/* RANDOMIZER OVERLAY */}
      {
        isRandomizing && (
          <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center backdrop-blur-md cursor-wait">
            <h2 className="text-4xl md:text-6xl font-black text-white mb-8 animate-pulse text-center">PICKING A WINNER</h2>
            <div className="w-64 h-64 bg-slate-900 rounded-3xl border-4 border-amber-500 flex items-center justify-center shadow-[0_0_100px_rgba(245,158,11,0.5)]">
              <span className="text-8xl font-mono font-bold text-white tabular-nums">
                {randomizingNumber}
              </span>
            </div>
            <p className="text-amber-400 mt-8 font-bold animate-bounce tracking-widest">GOOD LUCK...</p>
          </div>
        )
      }
    </div >
  );
};

export default AdminPanel;
