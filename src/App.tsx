import React, { useState, useEffect, useMemo } from 'react';
import { Grid } from './components/Grid';
import { AdminPanel } from './components/AdminPanel';
import { Auth } from './components/Auth';
import { LandingPage } from './components/LandingPage';
import { Logo } from './components/Logo';
import { createNewPool, getTeamLogo } from './constants';
import type { GameState, Scores, PlayerDetails, User } from './types';
import { calculateWinners, generateRandomAxis, calculateScenarioWinners, getLastDigit } from './services/gameLogic';
import { authService } from './services/authService';
import { fetchGameScore } from './services/scoreService';
import { Share2, Plus, ArrowRight, LogOut, Zap, Globe, Lock, Unlock, Twitter, Facebook, Link as LinkIcon, MessageCircle, Trash2, LayoutGrid, Search, X } from 'lucide-react';

const App: React.FC = () => {
  // --- Routing & State ---
  const [hash, setHash] = useState(window.location.hash);
  const [user, setUser] = useState<User | null>(authService.getCurrentUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  const [pools, setPools] = useState<GameState[]>(() => {
    try {
      const saved = localStorage.getItem('sbSquaresPools');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      const ensureFields = (p: any) => ({
        ...createNewPool(p.name || 'Pool', p.ownerId),
        ...p,
        id: p.id || Math.random().toString(36).substring(2, 9),
        isPublic: p.isPublic !== undefined ? p.isPublic : true,
        ruleVariations: p.ruleVariations ? { ...createNewPool().ruleVariations, ...p.ruleVariations } : createNewPool().ruleVariations,
        scoreEvents: p.scoreEvents || [],
        scoreChangePayoutAmount: p.scoreChangePayoutAmount ?? 5,
        scores: { ...createNewPool().scores, ...p.scores }
      });
      if (!Array.isArray(parsed) && typeof parsed === 'object') return [ensureFields(parsed)];
      if (Array.isArray(parsed)) return parsed.map(ensureFields);
      return [];
    } catch (e) {
      return [];
    }
  });

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((u) => {
      setUser(u);
      if (u) setShowAuthModal(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    localStorage.setItem('sbSquaresPools', JSON.stringify(pools));
  }, [pools]);

  const route = useMemo(() => {
    if (hash.startsWith('#admin')) {
      const parts = hash.split('/');
      if (parts.length === 2) return { view: 'admin-editor', id: parts[1] };
      return { view: 'admin-dashboard', id: null };
    }
    if (hash.startsWith('#pool')) {
      const parts = hash.split('/');
      return { view: 'pool', id: parts[1] };
    }
    if (hash.startsWith('#browse')) {
      return { view: 'browse', id: null };
    }
    return { view: 'home', id: null };
  }, [hash]);

  const currentPool = useMemo(() => {
    if (!route.id) return null;
    return pools.find(p => p.id === route.id) || null;
  }, [pools, route.id]);

  useEffect(() => {
    if (!currentPool?.gameId || isSimulating) return;
    fetchGameScore(currentPool).then(result => { if (result) updateScores(currentPool.id, result.scores); });
    const interval = setInterval(() => {
      fetchGameScore(currentPool).then(result => { if (result) updateScores(currentPool.id, result.scores); });
    }, 60000);
    return () => clearInterval(interval);
  }, [currentPool?.gameId, currentPool?.id, isSimulating]);

  const winners = useMemo(() => {
    if (!currentPool) return [];
    return calculateWinners(currentPool);
  }, [currentPool]);

  const updatePool = (id: string, updates: Partial<GameState>) => {
    setPools(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const updateScores = (id: string, scoreUpdates: Partial<Scores>) => {
    setPools(prevPools => prevPools.map(pool => {
      if (pool.id !== id) return pool;
      return { ...pool, scores: { ...pool.scores, ...scoreUpdates } };
    }));
  };

  const handleClaimSquares = (ids: number[], name: string, details: PlayerDetails): { success: boolean; message?: string } => {
    if (!currentPool) return { success: false };
    const normalizedName = name.trim();
    if (!normalizedName) return { success: false, message: 'Name required' };
    const currentOwned = currentPool.squares.filter(s => s.owner && s.owner.toLowerCase() === normalizedName.toLowerCase()).length;
    const limit = Number(currentPool.maxSquaresPerPlayer) || 10;
    if (currentOwned + ids.length > limit) return { success: false, message: `Limit exceeded. Max ${limit}.` };
    const newSquares = [...currentPool.squares];
    ids.forEach(id => {
      if (!newSquares[id].owner) {
        newSquares[id] = { ...newSquares[id], owner: normalizedName, playerDetails: details, isPaid: false };
      }
    });
    updatePool(currentPool.id, { squares: newSquares });
    return { success: true };
  };

  const handleCreatePool = () => {
    const newPool = createNewPool(`Pool #${pools.length + 1}`, user?.id);
    setPools([...pools, newPool]);
    window.location.hash = `#admin/${newPool.id}`;
  };

  const handleDeletePool = (id: string) => {
    setPools(pools.filter(p => p.id !== id));
  };

  const handleRunSimulation = (poolId: string) => {
    setIsSimulating(true);
    setSimMessage("Simulation Started...");
    setPools(prev => prev.map(p => {
      if (p.id !== poolId) return p;
      const filledSquares = p.squares.map((s) => s.owner ? s : { ...s, owner: `SimBot`, isPaid: true });
      const newHomeAxis = p.axisNumbers ? p.axisNumbers.home : generateRandomAxis();
      const newAwayAxis = p.axisNumbers ? p.axisNumbers.away : generateRandomAxis();
      return {
        ...p,
        squares: filledSquares, isLocked: true, lockGrid: true,
        axisNumbers: { home: newHomeAxis, away: newAwayAxis },
        scores: { current: { home: 0, away: 0 }, q1: null, half: null, q3: null, final: null },
        gameId: undefined
      };
    }));
    const sequence = [
      { delay: 3000, scores: { current: { home: 7, away: 0 }, q1: { home: 7, away: 0 } }, msg: "End of 1st" },
      { delay: 6000, scores: { current: { home: 7, away: 3 }, half: { home: 7, away: 3 } }, msg: "Halftime" },
      { delay: 9000, scores: { current: { home: 14, away: 3 }, q3: { home: 14, away: 3 } }, msg: "End of 3rd" },
      { delay: 12000, scores: { current: { home: 14, away: 10 }, final: { home: 14, away: 10 } }, msg: "Final" }
    ];
    sequence.forEach(step => {
      setTimeout(() => { updateScores(poolId, step.scores); setSimMessage(step.msg); }, step.delay);
    });
    setTimeout(() => { setIsSimulating(false); setSimMessage(null); }, 13000);
  };

  const openShareModal = (poolId?: string) => {
    const id = poolId || currentPool?.id;
    if (!id) return;
    setShareUrl(`${window.location.origin}${window.location.pathname}#pool/${id}`);
    setShowShareModal(true);
  };

  const handleOpenAuth = (mode: 'login' | 'signup') => {
    if (user) { window.location.hash = '#admin'; return; }
    setAuthMode(mode);
    setShowAuthModal(true);
  };

  const sanitize = (n: any) => {
    if (n === null || n === undefined) return 0;
    const val = parseInt(n);
    return isNaN(val) ? 0 : val;
  };

  const getQuarterData = (period: 'q1' | 'half' | 'q3' | 'final') => {
    if (!currentPool) return { home: 0, away: 0, qPointsHome: 0, qPointsAway: 0, winnerName: '', reverseWinnerName: null, amount: 0, isLocked: false };
    const isFinal = !!currentPool.scores[period];
    const lockedScore = currentPool.scores[period];
    const liveScore = currentPool.scores.current;
    const home = sanitize(lockedScore?.home) || sanitize(liveScore?.home) || 0;
    const away = sanitize(lockedScore?.away) || sanitize(liveScore?.away) || 0;
    let prevHome = 0, prevAway = 0;
    if (period === 'half') { prevHome = sanitize(currentPool.scores.q1?.home); prevAway = sanitize(currentPool.scores.q1?.away); }
    else if (period === 'q3') { prevHome = sanitize(currentPool.scores.half?.home); prevAway = sanitize(currentPool.scores.half?.away); }
    else if (period === 'final') { prevHome = sanitize(currentPool.scores.q3?.home); prevAway = sanitize(currentPool.scores.q3?.away); }
    const qPointsHome = home - prevHome;
    const qPointsAway = away - prevAway;
    let winnerName = "TBD";
    let reverseWinnerName: string | null = null;
    let isLocked = isFinal;
    if (currentPool.axisNumbers) {
      const hD = getLastDigit(home);
      const aD = getLastDigit(away);
      const row = currentPool.axisNumbers.home.indexOf(hD);
      const col = currentPool.axisNumbers.away.indexOf(aD);
      if (row !== -1 && col !== -1) {
        winnerName = currentPool.squares[row * 10 + col].owner || (currentPool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold");
      }
      if (currentPool.ruleVariations.reverseWinners) {
        const rRow = currentPool.axisNumbers.home.indexOf(aD);
        const rCol = currentPool.axisNumbers.away.indexOf(hD);
        if (rRow !== -1 && rCol !== -1) {
          const rSqId = rRow * 10 + rCol;
          if (rSqId !== (row * 10 + col)) {
            reverseWinnerName = currentPool.squares[rSqId].owner || (currentPool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold");
          }
        }
      }
    }
    const totalPot = currentPool.squares.filter(s => s.owner).length * currentPool.costPerSquare;
    let distributablePot = Math.max(0, totalPot - (currentPool.ruleVariations.scoreChangePayout ? (currentPool.scoreEvents.length * currentPool.scoreChangePayoutAmount) : 0));
    let amount = (distributablePot * currentPool.payouts[period]) / 100;
    if (reverseWinnerName) amount = amount / 2;
    return { home, away, qPointsHome, qPointsAway, winnerName, reverseWinnerName, amount, isLocked };
  };

  const AuthModal = () => {
    if (!showAuthModal) return null;
    return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-md relative">
          <button onClick={() => setShowAuthModal(false)} className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors p-2"><X size={24} /></button>
          <Auth onLogin={() => { setShowAuthModal(false); window.location.hash = '#admin'; }} />
        </div>
      </div>
    );
  };

  const ShareModal = () => {
    if (!showShareModal) return null;
    const encodedUrl = encodeURIComponent(shareUrl);
    const text = "Join my Super Bowl Squares pool! Pick your winning squares now.";
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
          <button onClick={() => setShowShareModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><LogOut className="rotate-45" size={20} /></button>
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2"><Share2 size={20} className="text-indigo-400" /> Share Pool</h3>
          <p className="text-sm text-slate-400 mb-6">Invite friends to join the action.</p>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <a href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodeURIComponent(text)}`} target="_blank" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-indigo-500 transition-colors"><Twitter size={20} className="fill-white" /></div><span className="text-xs text-slate-400">X</span></a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`} target="_blank" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-blue-500 transition-colors"><Facebook size={20} className="text-blue-500" /></div><span className="text-xs text-slate-400">Facebook</span></a>
            <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + shareUrl)}`} target="_blank" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-emerald-500 transition-colors"><MessageCircle size={20} className="text-emerald-500" /></div><span className="text-xs text-slate-400">WhatsApp</span></a>
            <button onClick={() => { navigator.clipboard.writeText(shareUrl); alert("Link copied!"); }} className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-amber-500 transition-colors"><LinkIcon size={20} className="text-amber-500" /></div><span className="text-xs text-slate-400">Copy</span></button>
          </div>
        </div>
      </div>
    );
  };

  const Header = () => (
    <header className="bg-slate-800/50 border-b border-slate-700 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.location.hash = '#'}>
          <Logo />
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => window.location.hash = '#browse'} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white transition-colors mr-2">
            <LayoutGrid size={16} /> Public Grids
          </button>
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-300">Hi, {user.name}</span>
              <button onClick={() => window.location.hash = '#admin'} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors">My Pools</button>
              <button onClick={() => authService.logout()} className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 py-1.5 rounded text-slate-300 transition-colors"><LogOut size={14} /></button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => handleOpenAuth('login')} className="text-xs font-bold text-slate-300 hover:text-white px-3 py-1.5 transition-colors">Sign In</button>
              <button onClick={() => handleOpenAuth('signup')} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors">Register</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  // --- Views ---

  if (route.view === 'home') {
    return (
      <React.Fragment>
        <LandingPage onLogin={() => handleOpenAuth('login')} onSignup={() => handleOpenAuth('signup')} onBrowse={() => window.location.hash = '#browse'} isLoggedIn={!!user} />
        <AuthModal />
      </React.Fragment>
    );
  }

  if (route.view === 'admin-dashboard') {
    if (!user) {
      return (
        <React.Fragment>
          <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
            <div className="text-center">
              <p className="mb-4 text-slate-400">Please sign in to access the dashboard.</p>
              <button onClick={() => handleOpenAuth('login')} className="bg-indigo-600 px-4 py-2 rounded-lg text-white font-bold">Sign In</button>
            </div>
          </div>
          <AuthModal />
        </React.Fragment>
      );
    }
    const userPools = pools.filter(p => p.ownerId === user.id);
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header />
        <main className="max-w-5xl mx-auto p-6">
          <div className="flex justify-between items-end mb-8">
            <div><h2 className="text-3xl font-bold text-white">Dashboard</h2><p className="text-slate-400">Manage your pools</p></div>
            <button onClick={handleCreatePool} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20"><Plus size={18} /> Create Pool</button>
          </div>
          {userPools.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700 border-dashed">
              <Globe size={48} className="mx-auto text-slate-600 mb-4" /><p className="text-slate-400 font-medium">You haven't created any pools yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {userPools.map(pool => (
                <div key={pool.id} className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-indigo-500/50 transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <div><h3 className="text-xl font-bold text-white flex items-center gap-2">{pool.name}{!pool.isPublic && <Lock size={14} className="text-amber-500" />}</h3><p className="text-sm text-slate-400">{pool.awayTeam} @ {pool.homeTeam}</p></div>
                    <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${pool.isLocked ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{pool.isLocked ? 'Locked' : 'Open'}</span>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button onClick={() => window.location.hash = `#admin/${pool.id}`} className="flex-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white py-2 rounded-lg font-medium transition-colors">Manage</button>
                    <button onClick={() => window.location.hash = `#pool/${pool.id}`} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white py-2 rounded-lg font-medium transition-colors">View Grid</button>
                    <button onClick={() => handleDeletePool(pool.id)} className="px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors"><Trash2 size={18} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
        <AuthModal />
      </div>
    );
  }

  if (route.view === 'admin-editor') {
    if (!user) return <AuthModal />;
    if (!currentPool) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4">
          <div className="text-xl font-bold mb-4">Pool Not Found</div>
          <button onClick={() => window.location.hash = '#admin'} className="text-indigo-400 hover:underline">Return to Dashboard</button>
        </div>
      );
    }
    if (currentPool.ownerId && currentPool.ownerId !== user.id) {
      return <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">Unauthorized</div>;
    }
    return (
      <React.Fragment>
        <AdminPanel
          gameState={currentPool}
          updateConfig={(updates) => updatePool(currentPool.id, updates)}
          updateScores={(scores) => updateScores(currentPool.id, scores)}
          generateNumbers={() => updatePool(currentPool.id, { axisNumbers: { home: generateRandomAxis(), away: generateRandomAxis() } })}
          resetGame={() => { const fresh = createNewPool(currentPool.name, user.id); updatePool(currentPool.id, { ...fresh, id: currentPool.id }); }}
          onBack={() => window.location.hash = '#admin'}
          onShare={() => openShareModal(currentPool.id)}
        />
        <ShareModal />
      </React.Fragment>
    );
  }

  if (route.view === 'browse') {
    const publicPools = pools.filter(p => p.isPublic);
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header />
        <main className="max-w-3xl mx-auto p-6 mt-10">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400 mb-4">
              Public Grids
            </h2>
            <p className="text-slate-400 text-lg">Browse active pools open to the public.</p>
            <div className="mt-8 max-w-md mx-auto relative">
              <input type="text" placeholder="Search for a pool..." className="w-full bg-slate-800 border border-slate-700 rounded-full py-3 px-6 pl-12 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
              <Search className="absolute left-4 top-3.5 text-slate-500" size={20} />
            </div>
          </div>
          <div className="space-y-4">
            {publicPools.map(pool => (
              <div key={pool.id} onClick={() => window.location.hash = `#pool/${pool.id}`} className="bg-slate-800 border border-slate-700 p-6 rounded-xl flex justify-between items-center cursor-pointer hover:scale-[1.01] hover:border-indigo-500 transition-all shadow-lg group">
                <div><h3 className="text-xl font-bold text-white group-hover:text-indigo-400 transition-colors">{pool.name}</h3><p className="text-sm text-slate-400 mt-1">{pool.awayTeam} vs {pool.homeTeam} • ${pool.costPerSquare}/square</p></div>
                <div className="flex items-center gap-4"><div className="text-right"><span className="block text-xs text-slate-500 uppercase font-bold">Pot</span><span className="text-emerald-400 font-mono font-bold">${pool.costPerSquare * 100}</span></div><div className="bg-slate-700 p-2 rounded-full text-slate-300"><ArrowRight size={20} /></div></div>
              </div>
            ))}
            {publicPools.length === 0 && (
              <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700 border-dashed">
                <p className="text-slate-400 font-medium mb-4">No public pools available right now.</p>
                <button onClick={() => window.location.hash = '#admin'} className="text-indigo-400 hover:text-white font-bold underline">Create the first one!</button>
              </div>
            )}
          </div>
        </main>
        <AuthModal />
      </div>
    );
  }

  // POOL VIEW
  if (route.view === 'pool') {
    if (!currentPool) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col items-center justify-center p-4">
          <h1 className="text-4xl font-bold text-white mb-4">404</h1>
          <p className="text-slate-400 text-lg mb-8">Pool Not Found</p>
          <button onClick={() => window.location.hash = '#browse'} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-bold">Browse Public Pools</button>
          <button onClick={() => { localStorage.removeItem('sbSquaresPools'); window.location.reload(); }} className="mt-8 text-xs text-rose-500 hover:underline opacity-50">Clear Local Data (Reset App)</button>
        </div>
      );
    }

    // Move derived data inside the block where it's used
    const homeLogo = getTeamLogo(currentPool.homeTeam);
    const awayLogo = getTeamLogo(currentPool.awayTeam);
    const homePredictions = calculateScenarioWinners(currentPool, 'home');
    const awayPredictions = calculateScenarioWinners(currentPool, 'away');
    const squaresRemaining = 100 - currentPool.squares.filter(s => s.owner).length;
    const latestWinner = winners.length > 0 ? winners[winners.length - 1].owner : null;
    const isAdmin = user && user.id === currentPool.ownerId;
    const q1Data = getQuarterData('q1');
    const halfData = getQuarterData('half');
    const q3Data = getQuarterData('q3');
    const finalData = getQuarterData('final');

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-20 relative">
        <ShareModal />
        {simMessage && (
            <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-fuchsia-600 text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-bounce flex items-center gap-2 font-bold">
               <Zap size={20} fill="currentColor" /> {simMessage}
            </div>
        )}
        {isAdmin && (
           <button 
             onClick={() => handleRunSimulation(currentPool.id)} 
             disabled={isSimulating}
             className="fixed bottom-6 right-6 z-50 bg-fuchsia-600 hover:bg-fuchsia-500 text-white p-4 rounded-full shadow-2xl shadow-fuchsia-500/40 flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:opacity-50 disabled:scale-100"
             title="Run Live Game Simulation"
           >
             {isSimulating ? <Zap className="animate-spin" size={24} /> : <Zap size={24} />}
           </button>
        )}

        <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
             <button onClick={() => window.location.hash = '#'} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all">Return to My Grids</button>
             <div className="text-center"><h1 className="text-3xl font-bold text-white mb-1">{currentPool.name}</h1><p className="text-slate-400 text-sm">{squaresRemaining} Squares Remaining</p></div>
             <button onClick={() => openShareModal()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all">Copy Link Invite</button>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
             <div className="bg-black rounded-xl border border-slate-800 p-6 shadow-xl flex flex-col justify-center">
                <div className="mb-4"><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Grid Owner:</h3><p className="text-white font-medium">{currentPool.contactEmail || 'Admin'}</p></div>
                <div className="mb-4"><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Limits:</h3><p className="text-white font-medium text-sm">Max {currentPool.maxSquaresPerPlayer} squares per player</p></div>
                <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Instructions from Pool Manager:</h3><p className="text-slate-300 text-sm leading-relaxed">{currentPool.paymentInstructions}</p></div>
             </div>
             <div className="bg-black rounded-xl border border-slate-800 p-0 shadow-xl overflow-hidden relative">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-slate-800/20 rounded-full blur-2xl"></div>
                 <div className="p-4 border-b border-slate-800 text-center"><h3 className="text-white font-bold">Game Scoreboard</h3></div>
                 <div className="p-4">
                    <div className="grid grid-cols-6 gap-2 text-center text-sm mb-2 text-slate-500 font-bold uppercase text-[10px]"><div className="col-span-2 text-left pl-2">Team</div><div>1</div><div>2</div><div>3</div><div>4</div><div>T</div></div>
                    <div className="grid grid-cols-6 gap-2 text-center text-white font-bold items-center mb-3 bg-slate-900/50 p-2 rounded"><div className="col-span-2 text-left pl-2 flex items-center gap-2">{awayLogo && <img src={awayLogo} className="w-6 h-6 object-contain" />}{currentPool.awayTeam}</div><div>{sanitize(currentPool.scores.q1?.away)}</div><div>{sanitize(currentPool.scores.half?.away) - sanitize(currentPool.scores.q1?.away)}</div><div>{sanitize(currentPool.scores.q3?.away) - sanitize(currentPool.scores.half?.away)}</div><div>{sanitize(currentPool.scores.final?.away) - sanitize(currentPool.scores.q3?.away)}</div><div className="text-indigo-400 text-lg">{sanitize(currentPool.scores.current?.away)}</div></div>
                    <div className="grid grid-cols-6 gap-2 text-center text-white font-bold items-center bg-slate-900/50 p-2 rounded"><div className="col-span-2 text-left pl-2 flex items-center gap-2">{homeLogo && <img src={homeLogo} className="w-6 h-6 object-contain" />}{currentPool.homeTeam}</div><div>{sanitize(currentPool.scores.q1?.home)}</div><div>{sanitize(currentPool.scores.half?.home) - sanitize(currentPool.scores.q1?.home)}</div><div>{sanitize(currentPool.scores.q3?.home) - sanitize(currentPool.scores.half?.home)}</div><div>{sanitize(currentPool.scores.final?.home) - sanitize(currentPool.scores.q3?.home)}</div><div className="text-rose-400 text-lg">{sanitize(currentPool.scores.current?.home)}</div></div>
                    <div className="mt-3 text-[10px] text-slate-600 text-right">Updated: {new Date().toLocaleTimeString()}</div>
                 </div>
             </div>
             <div className="bg-black rounded-xl border border-slate-800 p-6 shadow-xl flex flex-col justify-center">
                 <h3 className="text-center text-slate-300 font-bold mb-4 border-b border-slate-800 pb-2">Payout Structure</h3>
                 <div className="space-y-3">
                   {Object.entries(currentPool.payouts).map(([key, percent]) => {
                     const effectivePot = Math.max(0, totalPot - (currentPool.ruleVariations.scoreChangePayout ? (currentPool.scoreEvents.length * currentPool.scoreChangePayoutAmount) : 0));
                     const amount = (effectivePot * (percent as number)) / 100;
                     const label = key === 'q1' ? '1st Quarter' : key === 'half' ? '2nd Quarter' : key === 'q3' ? '3rd Quarter' : 'Final Score';
                     return (<div key={key} className="flex justify-between items-center text-sm"><span className="text-slate-400 font-bold">{label}:</span><span className="text-white font-mono font-bold">${amount.toLocaleString(undefined, {minimumFractionDigits: 0})}</span></div>);
                   })}
                 </div>
             </div>
        </div>

        {latestWinner && (
          <div className="max-w-[1400px] mx-auto px-4 mb-4 text-center animate-in zoom-in duration-300">
             <div className="inline-block bg-slate-800/80 border border-amber-500/50 rounded-full px-8 py-2 text-amber-300 font-bold text-lg shadow-[0_0_20px_rgba(245,158,11,0.2)]">🤑 IN THE MONEY: {latestWinner} 🤑</div>
          </div>
        )}

        <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 xl:grid-cols-[300px_1fr_300px] gap-8 items-start mb-8">
            <div className="hidden xl:block">
                <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{awayLogo && <img src={awayLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-indigo-400 font-bold">{currentPool.awayTeam}</span> score next...</h3></div>
                    <div className="bg-black/50 p-4 space-y-4">{awayPredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-indigo-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
                </div>
            </div>
            <div className="flex flex-col items-center">
               <div className="mb-4"><div className="w-16 h-16 bg-indigo-900/20 rounded-full flex items-center justify-center border-2 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)] bg-white p-1">{awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" /> : <span className="text-indigo-400 font-bold text-xl">{currentPool.awayTeam.substring(0,2).toUpperCase()}</span>}</div></div>
               <div className="flex items-center gap-4 w-full">
                  <div className="hidden md:flex flex-col items-center gap-2"><div className="w-16 h-16 bg-rose-900/20 rounded-full flex items-center justify-center border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] bg-white p-1">{homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" /> : <span className="text-rose-400 font-bold text-xl">{currentPool.homeTeam.substring(0,2).toUpperCase()}</span>}</div></div>
                  <div className="flex-1 overflow-x-auto"><Grid gameState={currentPool} onClaimSquares={handleClaimSquares} winners={winners} highlightHomeDigit={getLastDigit(currentPool.scores.current?.home ?? 0)} highlightAwayDigit={getLastDigit(currentPool.scores.current?.away ?? 0)} /></div>
               </div>
            </div>
            <div className="hidden xl:block">
                <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{homeLogo && <img src={homeLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-rose-400 font-bold">{currentPool.homeTeam}</span> score next...</h3></div>
                    <div className="bg-black/50 p-4 space-y-4">{homePredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-rose-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
                </div>
            </div>
        </div>

        {/* --- NEW PAYOUTS SECTION BELOW GRID --- */}
        <div className="max-w-[1400px] mx-auto px-4 mb-20">
           <h3 className="text-center text-slate-400 font-bold uppercase tracking-widest text-sm mb-6">Payouts & Winners</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { title: 'Quarter 1', data: q1Data },
                { title: 'Quarter 2', data: halfData },
                { title: 'Quarter 3', data: q3Data },
                { title: 'Quarter 4', data: finalData }
              ].map((card, idx) => (
                <div key={idx} className="bg-black border border-slate-800 rounded-xl p-6 flex flex-col items-center text-center shadow-lg relative overflow-hidden group">
                   <div className={`absolute top-0 w-full h-1 opacity-20 group-hover:opacity-50 transition-opacity ${card.data.isLocked ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                   <h4 className="text-slate-400 font-bold text-sm uppercase mb-4">{card.title}</h4>
                   <div className="flex items-center gap-4 mb-2">
                      <div className="flex items-center gap-2">
                         {homeLogo ? <img src={homeLogo} className="w-8 h-8 object-contain" /> : <div className="w-8 h-8 bg-rose-900/50 rounded-full"></div>}
                         <span className="text-3xl font-bold text-white">{card.data.home}</span>
                      </div>
                      <span className="text-slate-600 font-bold">-</span>
                      <div className="flex items-center gap-2">
                         <span className="text-3xl font-bold text-white">{card.data.away}</span>
                         {awayLogo ? <img src={awayLogo} className="w-8 h-8 object-contain" /> : <div className="w-8 h-8 bg-indigo-900/50 rounded-full"></div>}
                      </div>
                   </div>
                   <p className="text-xs text-slate-500 mb-6 font-medium">This Quarter: {card.data.qPointsHome} - {card.data.qPointsAway}</p>
                   <div className="mb-4">
                      <p className="text-xs text-slate-400 uppercase font-bold mb-1">In the money:</p>
                      <p className="text-white font-bold text-lg">{card.data.winnerName}</p>
                      {card.data.reverseWinnerName && (
                          <div className="mt-1 flex flex-col items-center">
                              <span className="text-[10px] text-slate-500">AND (Reverse)</span>
                              <span className="text-indigo-300 font-bold text-sm">{card.data.reverseWinnerName}</span>
                          </div>
                      )}
                   </div>
                   <div className="text-2xl font-bold font-mono text-emerald-400 mb-4">${card.data.amount.toLocaleString()}</div>
                   {card.data.isLocked ? (
                      <Lock size={20} className="text-rose-500/50" />
                   ) : (
                      <Unlock size={20} className="text-emerald-500/30" />
                   )}
                </div>
              ))}
           </div>
        </div>
      </div>
      <AuthModal />
    </div >
  );
  }

// Fallback return if no route matches
return <div>Loading...</div>;
};

export default App;