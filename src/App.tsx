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

// --- Sub-components moved outside main App to prevent nesting errors ---

const ShareModal: React.FC<{ isOpen: boolean; onClose: () => void; shareUrl: string }> = ({ isOpen, onClose, shareUrl }) => {
  if (!isOpen) return null;
  const encodedUrl = encodeURIComponent(shareUrl);
  const text = "Join my Super Bowl Squares pool! Pick your winning squares now.";
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white"><LogOut className="rotate-45" size={20} /></button>
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

const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md relative">
        <button onClick={onClose} className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors p-2"><X size={24} /></button>
        <Auth onLogin={() => { onClose(); window.location.hash = '#admin'; }} />
      </div>
    </div>
  );
};

const Header: React.FC<{ user: User | null; onOpenAuth: () => void; onLogout: () => void }> = ({ user, onOpenAuth, onLogout }) => (
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
            <button onClick={onLogout} className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 py-1.5 rounded text-slate-300 transition-colors"><LogOut size={14} /></button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={onOpenAuth} className="text-xs font-bold text-slate-300 hover:text-white px-3 py-1.5 transition-colors">Sign In</button>
            <button onClick={onOpenAuth} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors">Register</button>
          </div>
        )}
      </div>
    </div>
  </header>
);

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [hash, setHash] = useState(window.location.hash);
  const [user, setUser] = useState<User | null>(authService.getCurrentUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [pools, setPools] = useState<GameState[]>(() => {
    try {
      const saved = localStorage.getItem('sbSquaresPools');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      // Ensure fields helper (simplified for brevity)
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [isSimulating, setIsSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    return authService.onAuthStateChanged((u) => {
      setUser(u);
      if (u) setShowAuthModal(false);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('sbSquaresPools', JSON.stringify(pools));
  }, [pools]);

  const route = useMemo(() => {
    if (hash.startsWith('#admin')) {
      const parts = hash.split('/');
      return parts.length === 2 ? { view: 'admin-editor', id: parts[1] } : { view: 'admin-dashboard', id: null };
    }
    if (hash.startsWith('#pool')) return { view: 'pool', id: hash.split('/')[1] };
    if (hash.startsWith('#browse')) return { view: 'browse', id: null };
    return { view: 'home', id: null };
  }, [hash]);

  const currentPool = useMemo(() => route.id ? pools.find(p => p.id === route.id) || null : null, [pools, route.id]);

  // Polling
  useEffect(() => {
    if (!currentPool?.gameId || isSimulating) return;
    fetchGameScore(currentPool).then(res => { if (res) updateScores(currentPool.id, res.scores); });
    const interval = setInterval(() => {
      fetchGameScore(currentPool).then(res => { if (res) updateScores(currentPool.id, res.scores); });
    }, 60000);
    return () => clearInterval(interval);
  }, [currentPool?.gameId, currentPool?.id, isSimulating]);

  const updatePool = (id: string, updates: Partial<GameState>) => {
    setPools(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const updateScores = (id: string, scoreUpdates: Partial<Scores>) => {
    setPools(prev => prev.map(p => p.id === id ? { ...p, scores: { ...p.scores, ...scoreUpdates } } : p));
  };

  const handleCreatePool = () => {
    const newPool = createNewPool(`Pool #${pools.length + 1}`, user?.id);
    setPools([...pools, newPool]);
    window.location.hash = `#admin/${newPool.id}`;
  };

  const handleDeletePool = (id: string) => {
    setPools(pools.filter(p => p.id !== id));
  };

  const openShare = (id?: string) => {
    if (!id) return;
    setShareUrl(`${window.location.origin}${window.location.pathname}#pool/${id}`);
    setShowShareModal(true);
  };

  // Helper function for sanitize
  const sanitize = (n: any) => {
    if (n === null || n === undefined) return 0;
    const val = parseInt(n);
    return isNaN(val) ? 0 : val;
  };

  // Helper for Quarter Data
  const getQuarterData = (pool: GameState, period: 'q1' | 'half' | 'q3' | 'final') => {
    const isFinal = !!pool.scores[period];
    const lockedScore = pool.scores[period];
    const liveScore = pool.scores.current;
    const home = sanitize(lockedScore?.home) || sanitize(liveScore?.home) || 0;
    const away = sanitize(lockedScore?.away) || sanitize(liveScore?.away) || 0;

    let prevHome = 0, prevAway = 0;
    if (period === 'half') { prevHome = sanitize(pool.scores.q1?.home); prevAway = sanitize(pool.scores.q1?.away); }
    else if (period === 'q3') { prevHome = sanitize(pool.scores.half?.home); prevAway = sanitize(pool.scores.half?.away); }
    else if (period === 'final') { prevHome = sanitize(pool.scores.q3?.home); prevAway = sanitize(pool.scores.q3?.away); }

    const qPointsHome = home - prevHome;
    const qPointsAway = away - prevAway;

    let winnerName = "TBD";
    let reverseWinnerName: string | null = null;
    let isLocked = isFinal;

    if (pool.axisNumbers) {
      const hD = getLastDigit(home);
      const aD = getLastDigit(away);
      const row = pool.axisNumbers.home.indexOf(hD);
      const col = pool.axisNumbers.away.indexOf(aD);
      if (row !== -1 && col !== -1) winnerName = pool.squares[row * 10 + col].owner || (pool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold");

      if (pool.ruleVariations.reverseWinners) {
        const rRow = pool.axisNumbers.home.indexOf(aD);
        const rCol = pool.axisNumbers.away.indexOf(hD);
        if (rRow !== -1 && rCol !== -1) {
          const rSqId = rRow * 10 + rCol;
          if (rSqId !== (row * 10 + col)) reverseWinnerName = pool.squares[rSqId].owner || (pool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold");
        }
      }
    }
    const totalPot = pool.squares.filter(s => s.owner).length * pool.costPerSquare;
    let distributablePot = Math.max(0, totalPot - (pool.ruleVariations.scoreChangePayout ? (pool.scoreEvents.length * pool.scoreChangePayoutAmount) : 0));
    let amount = (distributablePot * pool.payouts[period]) / 100;
    if (reverseWinnerName) amount = amount / 2;
    return { home, away, qPointsHome, qPointsAway, winnerName, reverseWinnerName, amount, isLocked };
  };

  // --- VIEW RENDERING ---

  if (route.view === 'home') {
    return (
      <>
        <LandingPage onLogin={() => setShowAuthModal(true)} onSignup={() => setShowAuthModal(true)} onBrowse={() => window.location.hash = '#browse'} isLoggedIn={!!user} />
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  if (route.view === 'admin-dashboard') {
    if (!user) {
      return (
        <>
          <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
            <div className="text-center">
              <p className="mb-4 text-slate-400">Please sign in to access the dashboard.</p>
              <button onClick={() => setShowAuthModal(true)} className="bg-indigo-600 px-4 py-2 rounded-lg text-white font-bold">Sign In</button>
            </div>
          </div>
          <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
      );
    }
    const userPools = pools.filter(p => p.ownerId === user.id);
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
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
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    );
  }

  if (route.view === 'admin-editor') {
    if (!user) return <AuthModal isOpen={true} onClose={() => window.location.hash = '#'} />;
    if (!currentPool) return <div className="text-white p-10">Pool Not Found</div>;
    if (currentPool.ownerId && currentPool.ownerId !== user.id) return <div className="text-white p-10">Unauthorized</div>;

    return (
      <>
        <AdminPanel
          gameState={currentPool}
          updateConfig={(updates) => updatePool(currentPool.id, updates)}
          updateScores={(scores) => updateScores(currentPool.id, scores)}
          generateNumbers={() => updatePool(currentPool.id, { axisNumbers: { home: generateRandomAxis(), away: generateRandomAxis() } })}
          resetGame={() => {/* */ }}
          onBack={() => window.location.hash = '#admin'}
          onShare={() => openShare(currentPool.id)}
        />
        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />
      </>
    );
  }

  if (route.view === 'browse') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
        <main className="max-w-3xl mx-auto p-6 mt-10">
          {/* Browse Content */}
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">Public Grids</h2>
            {/* Search Input */}
          </div>
          <div className="space-y-4">
            {pools.filter(p => p.isPublic).map(pool => (
              <div key={pool.id} onClick={() => window.location.hash = `#pool/${pool.id}`} className="bg-slate-800 border border-slate-700 p-6 rounded-xl flex justify-between items-center cursor-pointer hover:border-indigo-500">
                <div><h3 className="text-xl font-bold text-white">{pool.name}</h3><p className="text-sm text-slate-400">{pool.awayTeam} vs {pool.homeTeam}</p></div>
                <ArrowRight size={20} />
              </div>
            ))}
          </div>
        </main>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    );
  }

  if (route.view === 'pool') {
    if (!currentPool) return <div className="text-white p-10">Pool Not Found</div>;

    const q1Data = getQuarterData(currentPool, 'q1');
    const halfData = getQuarterData(currentPool, 'half');
    const q3Data = getQuarterData(currentPool, 'q3');
    const finalData = getQuarterData(currentPool, 'final');

    const homeLogo = getTeamLogo(currentPool.homeTeam);
    const awayLogo = getTeamLogo(currentPool.awayTeam);
    const winners = calculateWinners(currentPool);

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20 relative">
        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />
        {/* Header/Nav */}
        <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
          <button onClick={() => window.location.hash = '#'} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Return to My Grids</button>
          <div className="text-center"><h1 className="text-3xl font-bold text-white mb-1">{currentPool.name}</h1></div>
          <button onClick={() => openShare(currentPool.id)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Share</button>
        </div>

        {/* Grid Component */}
        <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col items-center">
          <Grid
            gameState={currentPool}
            onClaimSquares={(ids, name, details) => handleClaimSquares(ids, name, details)}
            winners={winners}
            highlightHomeDigit={getLastDigit(currentPool.scores.current?.home ?? 0)}
            highlightAwayDigit={getLastDigit(currentPool.scores.current?.away ?? 0)}
          />
        </div>

        {/* Payout Cards */}
        <div className="max-w-[1400px] mx-auto px-4 mb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Quarter 1', data: q1Data },
              { title: 'Quarter 2', data: halfData },
              { title: 'Quarter 3', data: q3Data },
              { title: 'Quarter 4', data: finalData }
            ].map((card, idx) => (
              <div key={idx} className="bg-black border border-slate-800 rounded-xl p-6 text-center">
                <h4 className="text-slate-400 font-bold text-sm uppercase mb-4">{card.title}</h4>
                <div className="flex justify-center gap-4 text-white font-bold text-2xl mb-2">
                  <span>{card.data.home}</span> - <span>{card.data.away}</span>
                </div>
                <div className="text-emerald-400 font-mono font-bold text-xl">${card.data.amount}</div>
                <div className="text-white mt-2">{card.data.winnerName}</div>
              </div>
            ))}
          </div>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    );
  }

  return <div>Loading...</div>;
};

export default App;