import React, { useState } from 'react';
import type { GameState, Scores, PayoutConfig, Square } from '../types';
import { Settings, Sparkles, Lock, Unlock, Trash2, Shuffle, ArrowLeft, Activity, Share2, RefreshCw, Wifi, Calendar, CheckCircle, Save, ArrowRight, DollarSign, Mail, Users, User, Shield, Heart, Bell, Clock, Download } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { getTeamLogo } from '../constants';
import { fetchGameScore } from '../services/scoreService';
import { emailService } from '../services/emailService';

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
}

// Internal Debounced Input Component to fix cursor jumping
const DebouncedInput = ({ value, onChange, className, placeholder, type = "text" }: { value: string, onChange: (val: string) => void, className?: string, placeholder?: string, type?: string }) => {
  const [localValue, setLocalValue] = useState(value);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [localValue, value, onChange]);

  return (
    <input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
      placeholder={placeholder}
    />
  );
};

const DebouncedTextarea = ({ value, onChange, className, placeholder }: { value: string, onChange: (val: string) => void, className?: string, placeholder?: string }) => {
  const [localValue, setLocalValue] = useState(value);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [localValue, value, onChange]);

  return (
    <textarea
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
      placeholder={placeholder}
    />
  );
};

export const AdminPanel: React.FC<AdminPanelProps> = ({
  gameState,
  updateConfig,
  updateScores,
  generateNumbers,
  onBack,
  onShare,
  checkSlugAvailable,
  checkNameAvailable
}) => {
  const [aiIdea, setAiIdea] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);

  // Updated Tab Order and Default
  const [activeTab, setActiveTab] = useState<'settings' | 'reminders' | 'players' | 'scoring' | 'game' | 'communications'>('settings');

  /* handleSlugChange removed in favor of inline DebouncedInput handler */

  const [wizardStep, setWizardStep] = useState(1);
  const TOTAL_STEPS = 6;

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

  // Email Broadcast State
  const [emailFilter, setEmailFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [includeRules, setIncludeRules] = useState(true);
  const [includePayouts, setIncludePayouts] = useState(true);
  const [includeLink, setIncludeLink] = useState(true);
  const [includeReplyTo, setIncludeReplyTo] = useState(true);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

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

  const handleSave = () => {
    setSaveMessage('Settings Saved Successfully!');
    setTimeout(() => {
      setSaveMessage(null);
      window.location.hash = `#pool/${gameState.id}`;
    }, 1500);
  };

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
    }
    setIsThinking(false);
  };

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

  const handleSendBroadcast = async () => {
    // 1. Rate Limit Check (15 mins)
    const now = Date.now();
    const lastSent = gameState.lastBroadcastTime || 0;
    const cooldown = 15 * 60 * 1000;

    if (now - lastSent < cooldown) {
      const remaining = Math.ceil((cooldown - (now - lastSent)) / 60000);
      setEmailStatus({ type: 'error', msg: `Please wait ${remaining} minutes before sending another email.` });
      return;
    }

    if (!emailSubject || !emailBody) {
      setEmailStatus({ type: 'error', msg: 'Subject and Message are required.' });
      return;
    }

    setIsSendingEmail(true);
    setEmailStatus(null);

    // 2. Filter Recipients
    const recipients = new Set<string>();
    gameState.squares.forEach(s => {
      if (!s.owner) return;
      const email = s.playerDetails?.email;
      if (!email) return;

      const matchesFilter =
        emailFilter === 'all' ||
        (emailFilter === 'paid' && s.isPaid) ||
        (emailFilter === 'unpaid' && !s.isPaid);

      if (matchesFilter) {
        recipients.add(email);
      }
    });

    const recipientList = Array.from(recipients);

    if (recipientList.length === 0) {
      setEmailStatus({ type: 'error', msg: 'No recipients found matching criteria.' });
      setIsSendingEmail(false);
      return;
    }

    // 3. Construct Content (Using bcc for privacy)
    const poolLink = `${window.location.origin}/#pool/${gameState.id}`;
    let htmlContent = `
      <div style="font-family: sans-serif; color: #333;">
        <h2>${gameState.name} Update</h2>
        <p>${emailBody.replace(/\n/g, '<br>')}</p>
        <hr style="border: 1px solid #eee; margin: 20px 0;" />
    `;

    if (includeLink) {
      htmlContent += `
        <p><strong>Access the Pool:</strong> <a href="${poolLink}">${poolLink}</a></p>
      `;
    }

    if (includeRules) {
      htmlContent += `
        <h3>Key Rules</h3>
        <ul>
          <li><strong>Cost:</strong> $${gameState.costPerSquare} per square</li>
          <li><strong>Lock Time:</strong> ${gameState.reminders?.lock.lockAt ? new Date(gameState.reminders.lock.lockAt).toLocaleString() : 'Not Set'}</li>
          <li><strong>Numbers:</strong> ${gameState.numberSets === 4 ? 'New numbers every quarter' : 'Same numbers all game'}</li>
        </ul>
      `;
    }

    if (includePayouts) {
      const totalPot = gameState.squares.filter(s => s.owner).length * gameState.costPerSquare;
      const charityDed = gameState.charity?.enabled ? (totalPot * (gameState.charity.percentage / 100)) : 0;
      const netPot = totalPot - charityDed;

      htmlContent += `
        <h3>Payouts (Est. based on current sales)</h3>
        <ul>
          <li><strong>Q1 (${gameState.payouts.q1}%):</strong> $${Math.floor(netPot * (gameState.payouts.q1 / 100))}</li>
          <li><strong>Half (${gameState.payouts.half}%):</strong> $${Math.floor(netPot * (gameState.payouts.half / 100))}</li>
          <li><strong>Q3 (${gameState.payouts.q3}%):</strong> $${Math.floor(netPot * (gameState.payouts.q3 / 100))}</li>
          <li><strong>Final (${gameState.payouts.final}%):</strong> $${Math.floor(netPot * (gameState.payouts.final / 100))}</li>
        </ul>
      `;
    }

    htmlContent += `
      <p style="font-size: 12px; color: #666; margin-top: 30px;">
        Sent via March Melee Pools • <a href="${poolLink}">View Pool</a>
      </p>
      </div>
    `;

    // 4. Send - Use BCC logic
    const replyTo = includeReplyTo && gameState.contactEmail ? gameState.contactEmail : undefined;

    try {
      // recipientList contains emails implicitly due to filtering logic
      await emailService.sendBroadcast(recipientList, emailSubject, htmlContent, replyTo, gameState.ownerId);
      updateConfig({ lastBroadcastTime: now });
      setEmailStatus({ type: 'success', msg: `Sent to ${recipientList.length} recipients!` });
      // Reset form slightly
      setEmailSubject('');
      setEmailBody('');
    } catch (e) {
      console.error(e);
      setEmailStatus({ type: 'error', msg: 'Failed to trigger email service.' });
    }

    setIsSendingEmail(false);
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

  const updatePlayerSquares = (ownerName: string, updates: Partial<Square>) => {
    const newSquares = gameState.squares.map(sq =>
      sq.owner === ownerName ? { ...sq, ...updates } : sq
    );
    updateConfig({ squares: newSquares });
  };

  const updateSquare = (id: number, updates: Partial<Square>) => {
    const newSquares = [...gameState.squares];
    newSquares[id] = { ...newSquares[id], ...updates };
    updateConfig({ squares: newSquares });
  };

  const releasePlayer = (ownerName: string) => {
    // Sandbox fix: Remove window.confirm
    const newSquares = gameState.squares.map(sq =>
      sq.owner === ownerName ? { ...sq, owner: null, playerDetails: undefined, isPaid: false } : sq
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
                  <p className="text-[10px] text-slate-500 mt-1">Wait time after reservation before nagging.</p>
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
                <label className="md:col-span-2 flex items-center gap-3 cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input
                    type="checkbox"
                    checked={safeReminders.payment.notifyUsers}
                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, notifyUsers: e.target.checked } } })}
                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600"
                  />
                  <span className="text-sm text-slate-300">Also email the <strong>Participants</strong> directly (not just Host summary)</span>
                </label>
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
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
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
                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: defaultTime.getTime() } } });
                  } else {
                    const offsetMins = parseInt(val);
                    if (gameState.scores.startTime) {
                      const start = new Date(gameState.scores.startTime).getTime();
                      updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: start - (offsetMins * 60 * 1000) } } });
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
                        value={new Date(safeReminders.lock.lockAt).toISOString().split('T')[0]}
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
            }} className="bg-slate-800 hover:bg-slate-700 text-indigo-300 px-4 py-2 rounded-lg text-sm font-bold border border-slate-700 transition-colors flex items-center gap-2"><Calendar size={16} /> {showSchedule ? 'Hide Schedule' : 'Find Game'}</button>
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
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-center font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="e.g. Away Team"
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
                className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white text-center font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                placeholder="e.g. Home Team"
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
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6"><div><h3 className="text-xl font-bold text-white mb-1">Payout & Charity Configuration</h3><p className="text-slate-400 text-sm">Define how the pot is split. Must total 100%.</p></div><div className={`text-xl font-bold font-mono px-4 py-2 rounded border ${totalPayout === 100 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50' : 'bg-rose-500/10 text-rose-400 border-rose-500/50'}`}>Total: {totalPayout}%</div></div>
        <div className="space-y-6">
          {['q1', 'half', 'q3', 'final'].map((key) => {
            const label = key === 'q1' ? '1st Quarter' : key === 'half' ? 'Halftime' : key === 'q3' ? '3rd Quarter' : 'Final Score';
            const val = gameState.payouts[key as keyof PayoutConfig];

            // Calculate Projected Amount
            const totalPot = gameState.costPerSquare * 100;
            const charityDeduction = gameState.charity?.enabled ? (totalPot * (gameState.charity.percentage / 100)) : 0;
            const netPot = totalPot - charityDeduction;
            const projectedAmount = (netPot * (val / 100));

            return (
              <div key={key} className="bg-slate-950 p-4 rounded-xl border border-slate-700 flex items-center gap-4">
                <div className="w-32 font-bold text-slate-300">
                  {label}
                  <div className="text-[10px] text-slate-500 font-normal">Est. ${projectedAmount.toLocaleString()}</div>
                </div>
                <input type="range" min="0" max="100" step="5" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseInt(e.target.value) } })} className="flex-1 accent-indigo-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                <div className="w-20 relative">
                  <input type="number" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseFloat(e.target.value) || 0 } })} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-right text-white font-mono font-bold outline-none focus:border-indigo-500" />
                  <span className="absolute right-6 top-1.5 text-slate-500 text-xs hidden">%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <Heart size={20} className="text-rose-500" /> Charity & Fundraising
            </h3>
            <p className="text-slate-400 text-sm">Dedicate a portion of the pot to a cause.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={gameState.charity?.enabled || false}
              onChange={(e) => updateConfig({ charity: { ...(gameState.charity || { name: '', percentage: 0, url: '' }), enabled: e.target.checked } })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
          </label>
        </div>

        {gameState.charity?.enabled && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Charity Name</label>
                <input
                  type="text"
                  value={gameState.charity.name}
                  onChange={(e) => updateConfig({ charity: { ...gameState.charity!, name: e.target.value } })}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-rose-500 outline-none"
                  placeholder="e.g. Red Cross"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Website URL (Optional)</label>
                <input
                  type="text"
                  value={gameState.charity.url || ''}
                  onChange={(e) => updateConfig({ charity: { ...gameState.charity!, url: e.target.value } })}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-rose-500 outline-none"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
              <div className="flex justify-between mb-2">
                <span className="font-bold text-slate-300">Donation Percentage</span>
                <span className="font-mono font-bold text-rose-400">{gameState.charity.percentage}% Off The Top</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={gameState.charity.percentage}
                onChange={(e) => updateConfig({ charity: { ...gameState.charity!, percentage: parseInt(e.target.value) } })}
                className="w-full accent-rose-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
              <p className="text-xs text-slate-500 mt-2">
                This percentage will be deducted from the <strong>Total Pot</strong> before winner payouts.
              </p>

              {/* Projected Donation Amount */}
              <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex justify-between items-center">
                <span className="text-xs font-bold text-rose-300 uppercase">Projected Donation (100 Sqs)</span>
                <span className="font-mono font-bold text-white text-lg">
                  ${((gameState.costPerSquare * 100) * (gameState.charity.percentage / 100)).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <Shield size={20} className="text-indigo-400" /> Unclaimed Prize Rules
            </h3>
            <p className="text-slate-400 text-sm">What happens if a winning square is empty?</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
            <div>
              <span className="font-bold text-slate-200 block">Roll Over Winnings</span>
              <span className="text-xs text-slate-500">Unclaimed money moves to the next quarter's pot.</span>
            </div>
            <input
              type="checkbox"
              checked={gameState.ruleVariations.quarterlyRollover}
              onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, quarterlyRollover: e.target.checked } })}
              className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
            />
          </label>

          {gameState.ruleVariations.quarterlyRollover && (
            <div className="animate-in fade-in slide-in-from-top-2 p-4 bg-slate-950/50 border border-slate-800 rounded-lg">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Final Score Unclaimed Logic</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'last_winner' } })}
                  className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'last_winner' || !gameState.ruleVariations.unclaimedFinalPrizeStrategy ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                  <div className="font-bold text-sm mb-1">Option A: Last Winner</div>
                  <div className="text-xs opacity-80">Award prize to the most recent previous winner (e.g. Q3).</div>
                </button>

                <button
                  onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'random' } })}
                  className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'random' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                  <div className="font-bold text-sm mb-1">Option B: Random Draw</div>
                  <div className="text-xs opacity-80">Activates a "Randomizer" button to pick a lucky square.</div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderWizardStep5 = () => renderWizardReminders();

  const renderWizardStep6 = () => (
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

          {/* Game Logic */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
            <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Activity size={16} className="text-rose-400" /> Game Logic</h4>
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded"><span className="text-sm text-slate-300">Reverse Winners (Split Pot)</span><input type="checkbox" checked={gameState.ruleVariations.reverseWinners} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, reverseWinners: e.target.checked } })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" /></label>
              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded"><span className="text-sm text-slate-300">Quarterly Rollovers</span><input type="checkbox" checked={gameState.ruleVariations.quarterlyRollover} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, quarterlyRollover: e.target.checked } })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" /></label>
              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded"><span className="text-sm text-slate-300">Score Change Payouts</span><input type="checkbox" checked={gameState.ruleVariations.scoreChangePayout} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangePayout: e.target.checked } })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" /></label>
              <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded"><span className="text-sm text-slate-300">Include Overtime in Final?</span><input type="checkbox" checked={gameState.includeOvertime} onChange={(e) => updateConfig({ includeOvertime: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" /></label>
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
            {(['settings', 'reminders', 'players', 'scoring', 'game', 'communications'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 border-b-2 transition-colors font-medium whitespace-nowrap ${activeTab === tab ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                {tab === 'settings' ? 'Setup Wizard' : tab === 'reminders' ? 'Smart Reminders' : tab === 'game' ? 'Game Status' : tab.charAt(0).toUpperCase() + tab.slice(1)}
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
                  { step: 5, label: '5. Reminders' },
                  { step: 6, label: '6. Finish' }
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
            <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-6 rounded-xl border border-indigo-500/30"><div className="flex items-center gap-2 mb-4"><Sparkles className="text-indigo-400" size={20} /><h3 className="text-lg font-bold text-indigo-100">AI Commissioner</h3></div>{aiIdea && (<div className="bg-slate-950/80 p-4 rounded-lg border border-indigo-500/30 mb-4 shadow-inner"><p className="text-lg text-indigo-200 font-serif italic">"{aiIdea}"</p></div>)}<button onClick={askGeminiForIdeas} disabled={isThinking} className="bg-indigo-600/80 hover:bg-indigo-500 text-white py-2 px-4 rounded-lg text-sm font-bold uppercase tracking-wide transition-colors">{isThinking ? 'Thinking...' : 'Suggest Rule Variation'}</button></div>

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

        {/* COMMUNICATIONS TAB (EMAIL BLAST) */}
        {activeTab === 'communications' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right duration-500">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Mail size={20} className="text-indigo-400" /> Mass Email Tool
                  </h3>
                  <p className="text-slate-400 text-sm">Send updates to your pool participants. 15-minute cooldown between sends.</p>
                </div>
                {gameState.lastBroadcastTime && (
                  <div className="text-right text-xs text-slate-500">
                    <span className="block font-bold uppercase">Last Sent</span>
                    <Clock size={12} className="inline mr-1" />
                    {new Date(gameState.lastBroadcastTime).toLocaleString()}
                  </div>
                )}
              </div>

              {/* RECIPIENT FILTER */}
              <div className="mb-6 p-4 bg-slate-950 rounded-lg border border-slate-800">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Recipients</label>
                <div className="flex gap-4 mb-3">
                  {['all', 'paid', 'unpaid'].map(filter => (
                    <button
                      key={filter}
                      onClick={() => setEmailFilter(filter as any)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold capitalize transition-colors ${emailFilter === filter ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <div className="text-sm text-indigo-400 font-bold">
                  {(() => {
                    const count = gameState.squares.filter(s => {
                      if (!s.owner || !s.playerDetails?.email) return false;
                      if (emailFilter === 'paid') return s.isPaid;
                      if (emailFilter === 'unpaid') return !s.isPaid;
                      return true;
                    }).map(s => s.playerDetails?.email).filter((v, i, a) => a.indexOf(v) === i).length;
                    return `${count} Unique Recipient(s) Selected`;
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* COMPOSER */}
                <div className="md:col-span-2 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Subject</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="e.g. Pool is locked!"
                      className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Message</label>
                    <textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Write your update here..."
                      className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-48 resize-none"
                    />
                  </div>

                  {/* INCLUDE CHECKBOXES */}
                  <div className="grid grid-cols-2 gap-4">
                    <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-950 rounded border border-slate-800 hover:border-slate-600">
                      <input type="checkbox" checked={includeRules} onChange={(e) => setIncludeRules(e.target.checked)} className="rounded bg-slate-800 border-slate-600 text-indigo-500" />
                      <span className="text-sm text-slate-300">Include Rules & Deadlines</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-950 rounded border border-slate-800 hover:border-slate-600">
                      <input type="checkbox" checked={includePayouts} onChange={(e) => setIncludePayouts(e.target.checked)} className="rounded bg-slate-800 border-slate-600 text-indigo-500" />
                      <span className="text-sm text-slate-300">Include Est. Payouts</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-950 rounded border border-slate-800 hover:border-slate-600">
                      <input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} className="rounded bg-slate-800 border-slate-600 text-indigo-500" />
                      <span className="text-sm text-slate-300">Include Pool Link</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer p-3 bg-slate-950 rounded border border-slate-800 hover:border-slate-600">
                      <input type="checkbox" checked={includeReplyTo} onChange={(e) => setIncludeReplyTo(e.target.checked)} className="rounded bg-slate-800 border-slate-600 text-indigo-500" />
                      <span className="text-sm text-slate-300">Reply-To: {gameState.contactEmail}</span>
                    </label>
                  </div>
                </div>

                {/* PREVIEW & SEND */}
                <div className="space-y-4">
                  <div className="bg-white text-slate-900 p-4 rounded-lg text-sm max-h-96 overflow-y-auto border-4 border-slate-800">
                    <h4 className="font-bold border-b pb-2 mb-2 text-xs uppercase text-slate-400 tracking-wider">Preview</h4>
                    <div className="font-bold text-lg mb-2">{emailSubject || '(No Subject)'}</div>
                    <div className="whitespace-pre-wrap mb-4">{emailBody || '(No Message)'}</div>
                    {includeLink && <div className="text-indigo-600 underline text-xs mb-2">Link to Pool</div>}
                    {includeRules && <div className="bg-slate-100 p-2 rounded text-xs mb-2"><strong>Key Rules:</strong><br />Cost: ${gameState.costPerSquare}<br />Lock: ...</div>}
                    {includePayouts && <div className="bg-slate-100 p-2 rounded text-xs"><strong>Payouts:</strong><br />Q1: ...<br />Final: ...</div>}
                  </div>

                  {emailStatus && (
                    <div className={`p-3 rounded text-sm font-bold ${emailStatus.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {emailStatus.msg}
                    </div>
                  )}

                  <button
                    onClick={handleSendBroadcast}
                    disabled={isSendingEmail}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2"
                  >
                    {isSendingEmail ? <RefreshCw className="animate-spin" size={18} /> : <Mail size={18} />}
                    {isSendingEmail ? 'Sending...' : 'Send Broadcast'}
                  </button>
                </div>
              </div>

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

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                <h3 className="font-bold text-white flex items-center gap-2"><Users size={18} className="text-indigo-400" /> Player List</h3>
                <div className="flex gap-2">
                  <button onClick={handleExportUsers} className="text-xs bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded font-bold transition-colors flex items-center gap-1"><Download size={12} /> Export CSV</button>
                  <button onClick={() => { updateConfig({ squares: gameState.squares.map(s => s.owner ? { ...s, isPaid: true } : s) }); }} className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded font-bold transition-colors">Mark All Paid</button>
                </div>
              </div>
              {getPlayers().length === 0 ? (
                <div className="p-8 text-center text-slate-500">No players yet. Share the pool link!</div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {getPlayers().map((player) => (
                    <div key={player.name} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                      <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpandedPlayer(expandedPlayer === player.name ? null : player.name)}>
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                            <User size={20} className="text-slate-400" />
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
                                {player.contact.notes && <div className="col-span-2"><span className="font-bold block text-slate-500 uppercase">Notes</span>{player.contact.notes}</div>}
                              </div>
                            )}

                            <div className="space-y-2">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-slate-500 uppercase">Squares Owned</span>
                                <button onClick={() => updatePlayerSquares(player.name, { isPaid: true })} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold">Mark All Paid</button>
                              </div>
                              {player.squares.map(sq => (
                                <div key={sq.id} className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-800">
                                  <span className="text-sm font-mono text-slate-300">Square #{sq.id}</span>
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => updateSquare(sq.id, { isPaid: !sq.isPaid })}
                                      className={`text-xs px-2 py-1 rounded font-bold border transition-colors ${sq.isPaid ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}
                                    >
                                      {sq.isPaid ? 'PAID' : 'UNPAID'}
                                    </button>
                                    <button
                                      onClick={() => { updateSquare(sq.id, { owner: null, playerDetails: undefined, isPaid: false }); }}
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
                      <button onClick={() => updatePlayerDetails(editingPlayer.originalName, editingPlayer)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold">Save Changes</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
