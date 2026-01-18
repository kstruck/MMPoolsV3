import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { PoolTheme, GameState, Scores, Square } from '../types';
import { Settings, Sparkles, Lock, Unlock, Trash2, Shuffle, ArrowLeft, Share2, RefreshCw, Wifi, CheckCircle, Save, ArrowRight, DollarSign, Mail, Users, User as UserIcon, Heart, Clock, Download, TrendingUp, Hammer } from 'lucide-react';



import { fetchGameScore } from '../services/scoreService';
import { AnnouncementManager } from './AnnouncementManager';

import { PropGradingDashboard } from './Props/PropGradingDashboard';
import { PoolStatistics } from './PoolStatistics';
import {

  WizardStepMatchup, WizardStepBasics, WizardStepRules, WizardStepPayouts,
  WizardStepSideHustle, WizardStepBrandingAdmin, WizardStepReminders, WizardStepFinish
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


  // Updated Tab Order and Default
  const [activeTab, setActiveTab] = useState<'settings' | 'reminders' | 'players' | 'scoring' | 'game' | 'payouts' | 'communications' | 'stats' | 'props' | 'grading'>('settings');

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
      window.location.href = `/pool/${gameState.id}`;
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
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
            <div><h1 className="text-xl font-bold text-white flex items-center gap-2"><Settings className="text-indigo-400" size={20} /> {gameState.name} {gameState.charity?.enabled && <span className="text-xs bg-rose-500 text-white px-2 py-0.5 rounded-full">Charity</span>}</h1><p className="text-xs text-slate-500">Admin Editor</p></div>
          </div>
          <div className="flex gap-2">
            <button onClick={onShare} className="text-xs bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-600 px-3 py-2 rounded font-bold cursor-pointer flex items-center gap-2"><Share2 size={14} /> Share</button>
            <button onClick={() => window.location.href = `/pool/${gameState.id}`} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded font-bold cursor-pointer">Open Public View</button>
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
              <WizardStepFinish
                gameState={gameState}
                updateConfig={updateConfig}
                handleFixSync={handleFixSync}
                isFixing={isFixing}
              />
            )}

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
            <WizardStepSideHustle
              gameState={gameState}
              updateConfig={updateConfig}
            />
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
            <WizardStepReminders
              gameState={gameState}
              updateConfig={updateConfig}
            />
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
