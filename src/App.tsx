import React, { useState, useEffect, useMemo } from 'react';
import { Grid } from './components/Grid';
import { AdminPanel } from './components/AdminPanel';
import { Auth } from './components/Auth';
import { LandingPage } from './components/LandingPage';

import { createNewPool, getTeamLogo } from './constants';
import type { GameState, Scores, PlayerDetails, User } from './types';
import { calculateWinners, generateRandomAxis, calculateScenarioWinners, getLastDigit } from './services/gameLogic';
import { authService } from './services/authService';
import { fetchGameScore } from './services/scoreService';
import { dbService } from './services/dbService';
import { Share2, Plus, ArrowRight, LogOut, Zap, Globe, Lock, Unlock, Twitter, Facebook, Link as LinkIcon, MessageCircle, Trash2, Search, X, Loader } from 'lucide-react';

// Lazy load SuperAdmin
const SuperAdmin = React.lazy(() => import('./components/SuperAdmin').then(m => ({ default: m.SuperAdmin })));

// --- SHARED COMPONENTS ---

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
          <a href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-indigo-500 transition-colors"><Twitter size={20} className="fill-white" /></div><span className="text-xs text-slate-400">X</span></a>
          <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-blue-500 transition-colors"><Facebook size={20} className="text-blue-500" /></div><span className="text-xs text-slate-400">Facebook</span></a>
          <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + shareUrl)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-emerald-500 transition-colors"><MessageCircle size={20} className="text-emerald-500" /></div><span className="text-xs text-slate-400">WhatsApp</span></a>
          <button onClick={() => { navigator.clipboard.writeText(shareUrl); alert("Link copied!"); }} className="flex flex-col items-center gap-2 group"><div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-amber-500 transition-colors"><LinkIcon size={20} className="text-amber-500" /></div><span className="text-xs text-slate-400">Copy</span></button>
        </div>
      </div>
    </div>
  );
};

const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void; initialMode?: 'login' | 'register' }> = ({ isOpen, onClose, initialMode = 'login' }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md relative">
        <button onClick={onClose} className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors p-2"><X size={24} /></button>
        <Auth onLogin={() => { onClose(); window.location.hash = '#admin'; }} defaultIsRegistering={initialMode === 'register'} />
      </div>
    </div>
  );
};

import { Header } from './components/Header';

// --- MAIN APP ---

const App: React.FC = () => {
  const [hash, setHash] = useState(window.location.hash);
  const [user, setUser] = useState<User | null>(authService.getCurrentUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const [pools, setPools] = useState<GameState[]>([]);
  const [isPoolsLoading, setIsPoolsLoading] = useState(true);

  const [isSimulating, setIsSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    // Handle root path slugs (e.g. /my-slug -> /#pool/my-slug)
    const path = window.location.pathname;
    if (path.length > 1 && path !== '/index.html') {
      // Remove leading slash
      const slug = path.substring(1);
      // Redirect to hash route
      window.history.replaceState(null, '', `/#pool/${slug}`);
      setHash(`#pool/${slug}`);
    }

    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    return authService.onAuthStateChanged((u) => {
      setUser(u);
      if (u) {
        setShowAuthModal(false);
        dbService.saveUser(u); // Sync user to Firestore
      }
    });
  }, []);

  // Real-time subscription to pools
  useEffect(() => {
    const unsubscribe = dbService.subscribeToPools(
      (updatedPools) => {
        setPools(updatedPools);
        setIsPoolsLoading(false);
        setConnectionError(null);
      },
      (error) => {
        console.error("DB Error", error);
        setIsPoolsLoading(false);
        setConnectionError("Failed to connect to database. Please check configuration.");
      }
    );
    return () => unsubscribe();
  }, []);

  const route = useMemo(() => {
    if (hash.startsWith('#admin')) {
      const parts = hash.split('/');
      return parts.length === 2 ? { view: 'admin-editor', id: parts[1] } : { view: 'admin-dashboard', id: null };
    }
    if (hash.startsWith('#super-admin')) return { view: 'super-admin', id: null };
    if (hash.startsWith('#pool')) return { view: 'pool', id: hash.split('/')[1] };
    if (hash.startsWith('#browse')) return { view: 'browse', id: null };
    return { view: 'home', id: null };
  }, [hash]);

  const currentPool = useMemo(() => route.id ? pools.find(p => p.id === route.id || (p.urlSlug && p.urlSlug.toLowerCase() === route.id.toLowerCase())) || null : null, [pools, route.id]);

  useEffect(() => {
    if (!currentPool?.gameId || isSimulating) return;
    fetchGameScore(currentPool).then(res => { if (res) updateScores(currentPool.id, res.scores); });
    const interval = setInterval(() => {
      fetchGameScore(currentPool).then(res => { if (res) updateScores(currentPool.id, res.scores); });
    }, 60000);
    return () => clearInterval(interval);
  }, [currentPool?.gameId, currentPool?.id, isSimulating]);

  const winners = useMemo(() => {
    if (!currentPool) return [];
    return calculateWinners(currentPool);
  }, [currentPool]);

  // --- ACTIONS ---
  const addNewPool = async (p: GameState) => {
    await dbService.createPool(p);
  };

  const updatePool = async (id: string, updates: Partial<GameState>) => {
    await dbService.updatePool(id, updates);
  };

  const updateScores = async (id: string, scoreUpdates: Partial<Scores>) => {
    // We need to fetch current pool state really or structurally update deep object
    // For now, assume simple shallow merge of scores is tricky in Firestore without dot notation
    // But let's try a direct update. Note: Firestore map updates work with dot notation "scores.current"
    // However, dbService.updatePool expects Partial<GameState>.
    // To properly update nested scores in Firestore, we should use dot notation keys in updatePool impl,
    // For now, let's just do a full pool object read-modify-write if needed or use dbService helper.
    // Simplest: pass 'scores' object fully merged if possible, or update implementation of dbService.
    // For this step, let's keep it simple:
    await dbService.updatePool(id, { scores: { ...currentPool?.scores, ...scoreUpdates } as Scores });
  };

  const deletePool = async (id: string) => {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    await dbService.deletePool(id);
    window.location.hash = '';
  };

  const handleCreatePool = async () => {
    try {
      if (!user) {
        alert("You must be logged in to create a pool.");
        return;
      }
      const newPool = createNewPool(`Pool #${pools.length + 1}`, user.id);
      await addNewPool(newPool); // Now creates in DB
      window.location.hash = `#admin/${newPool.id}`;
    } catch (err: any) {
      console.error("Create failed", err);
      const isAuth = err.code === 'permission-denied';
      alert(`Failed to create pool: ${isAuth ? 'Permission Denied (Check Rules)' : err.message || err}.`);
    }
  };

  const handleDeletePool = (id: string) => {
    deletePool(id);
  };

  const handleRunSimulation = (poolId: string) => {
    setIsSimulating(true);
    setSimMessage("Simulation Started: Filling Grid...");
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

  const openShare = (id?: string) => {
    if (!id) return;
    const pool = pools.find(p => p.id === id);
    const identifier = pool?.urlSlug || id;
    setShareUrl(`${window.location.origin}/#pool/${identifier}`);
    setShowShareModal(true);
  };

  const handleClaimSquares = (ids: number[], name: string, details: PlayerDetails): { success: boolean; message?: string } => {
    if (!currentPool) return { success: false };
    const normalizedName = name.trim();
    if (!normalizedName) return { success: false, message: 'Name required' };
    const currentOwned = currentPool.squares.filter(s => s.owner && s.owner.toLowerCase() === normalizedName.toLowerCase()).length;
    const limit = Number(currentPool.maxSquaresPerPlayer) || 10;
    if (currentOwned + ids.length > limit) return { success: false, message: `Limit exceeded. Max ${limit}.` };
    const newSquares = [...currentPool.squares];
    const squaresInitials: string[] = [];
    ids.forEach(id => {
      if (!newSquares[id].owner) {
        newSquares[id] = { ...newSquares[id], owner: normalizedName, playerDetails: details, isPaid: false };
        squaresInitials.push(`#${id} (${normalizedName})`);
      }
    });

    updatePool(currentPool.id, { squares: newSquares });

    // Send Email Confirmation to User
    if ((currentPool.emailConfirmation === 'Email Confirmation' || currentPool.emailConfirmation === 'true') && details.email) {
      import('./services/emailService').then(({ emailService }) => {
        emailService.sendConfirmation(
          currentPool.name,
          squaresInitials,
          details.email!,
          normalizedName,
          currentPool.contactEmail,
          currentPool.id
        ).catch(err => console.error('Email failed', err));
      });
    }

    // Check for Grid Full
    const totalSold = newSquares.filter(s => s.owner).length;
    if (totalSold === 100 && currentPool.notifyAdminFull && currentPool.contactEmail) {
      import('./services/emailService').then(({ emailService }) => {
        emailService.sendGridFullNotification(
          currentPool.name,
          currentPool.contactEmail,
          currentPool.id
        ).then(() => console.log('Admin alert sent - Grid Full')).catch(err => console.error('Admin alert failed', err));
      });
    }

    return { success: true };
  };



  const sanitize = (n: any) => {
    if (n === null || n === undefined) return 0;
    const val = parseInt(n);
    return isNaN(val) ? 0 : val;
  };

  const getScoreboardVal = (period: 1 | 2 | 3 | 4, team: 'home' | 'away') => {
    if (!currentPool) return 0;
    const s = currentPool.scores;
    const cur = sanitize(s.current?.[team]);
    const q1 = s.q1?.[team] !== undefined ? sanitize(s.q1[team]) : null;
    const half = s.half?.[team] !== undefined ? sanitize(s.half[team]) : null;
    const q3 = s.q3?.[team] !== undefined ? sanitize(s.q3[team]) : null;
    const final = s.final?.[team] !== undefined ? sanitize(s.final[team]) : null;

    if (period === 1) return q1 ?? cur;
    if (period === 2) return half ?? (q1 !== null ? cur : 0);
    if (period === 3) return q3 ?? (half !== null ? cur : 0);
    if (period === 4) return final ?? (q3 !== null ? cur : 0);
    return 0;
  };

  const getQuarterData = (period: 'q1' | 'half' | 'q3' | 'final') => {
    if (!currentPool) return { home: 0, away: 0, qPointsHome: 0, qPointsAway: 0, winnerName: '', reverseWinnerName: null, amount: 0, isLocked: false };
    const isFinal = !!currentPool.scores[period];
    const lockedScore = currentPool.scores[period];
    const liveScore = currentPool.scores.current;

    const sHome = lockedScore ? sanitize(lockedScore.home) : sanitize(liveScore?.home);
    const sAway = lockedScore ? sanitize(lockedScore.away) : sanitize(liveScore?.away);

    const home = sHome;
    const away = sAway;

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
      const row = currentPool.axisNumbers.away.indexOf(aD);
      const col = currentPool.axisNumbers.home.indexOf(hD);
      if (row !== -1 && col !== -1) {
        winnerName = currentPool.squares[row * 10 + col].owner || (currentPool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold");
      }
      if (currentPool.ruleVariations.reverseWinners) {
        const rRow = currentPool.axisNumbers.away.indexOf(hD);
        const rCol = currentPool.axisNumbers.home.indexOf(aD);
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

  // --- RENDER SWITCH ---
  if (route.view === 'home') {
    return (
      <>
        <LandingPage
          onLogin={() => { setAuthMode('login'); setShowAuthModal(true); }}
          onSignup={() => { setAuthMode('register'); setShowAuthModal(true); }}
          onBrowse={() => window.location.hash = '#browse'}
          isLoggedIn={!!user}
        />
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
      </>
    );
  }

  if (route.view === 'super-admin') {
    return (
      <div className="min-h-screen bg-slate-950 pb-20">
        <Header user={user} onLogout={() => authService.logout().then(() => window.location.reload())} onOpenAuth={() => setShowAuthModal(true)} />
        <React.Suspense fallback={<div className="text-white p-10">Loading...</div>}>
          <SuperAdmin />
        </React.Suspense>
      </div>
    );
  }

  if (route.view === 'admin-dashboard') {
    if (!user) {
      return (
        <>
          <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
            <div className="text-center">
              <p className="mb-4 text-slate-400">Please sign in to access the dashboard.</p>
              <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="bg-indigo-600 px-4 py-2 rounded-lg text-white font-bold">Sign In</button>
            </div>
          </div>
          <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
        </>
      );
    }
    const userPools = pools.filter(p => p.ownerId === user.id);
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header user={user} onOpenAuth={() => { setAuthMode('login'); setShowAuthModal(true); }} onLogout={authService.logout} />
        <main className="max-w-5xl mx-auto p-6">
          <div className="flex justify-between items-end mb-8">
            <div><h2 className="text-3xl font-bold text-white">Dashboard</h2><p className="text-slate-400">Manage your pools</p></div>
            <button onClick={handleCreatePool} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20"><Plus size={18} /> Create Pool</button>
          </div>
          {connectionError && (
            <div className="bg-rose-500/10 border border-rose-500 text-rose-400 p-4 rounded mb-6 flex items-center gap-3">
              <Zap className="text-rose-500" />
              <div>
                <p className="font-bold">Connection Fail</p>
                <p className="text-sm">{connectionError}. Check your configuration.</p>
              </div>
            </div>
          )}
          {isPoolsLoading ? (
            <div className="text-center py-20"><Loader className="animate-spin inline-block mb-2" /> <p>Loading your pools...</p></div>
          ) : userPools.length === 0 ? (
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
    if (currentPool.ownerId && currentPool.ownerId !== user.id && user.email !== 'kstruck@gmail.com') return <div className="text-white p-10">Unauthorized</div>;

    return (
      <>
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
        <AdminPanel
          gameState={currentPool}
          updateConfig={(updates) => updatePool(currentPool.id, updates)}
          updateScores={(scores) => updateScores(currentPool.id, scores)}
          generateNumbers={() => updatePool(currentPool.id, { axisNumbers: { home: generateRandomAxis(), away: generateRandomAxis() } })}
          resetGame={() => { const fresh = createNewPool(currentPool.name, user.id); updatePool(currentPool.id, { ...fresh, id: currentPool.id }); }}
          onBack={() => window.location.hash = '#admin'}
          onShare={() => openShare(currentPool.id)}
          checkSlugAvailable={(slug) => !pools.some(p => p.urlSlug === slug && p.id !== currentPool.id)}
        />
        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />
      </>
    );
  }

  if (route.view === 'browse') {
    const publicPools = pools.filter(p => p.isPublic);
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
        <main className="max-w-3xl mx-auto p-6 mt-10">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">Public Grids</h2>
            <div className="mt-8 max-w-md mx-auto relative">
              <input type="text" placeholder="Search for a pool..." className="w-full bg-slate-800 border border-slate-700 rounded-full py-3 px-6 pl-12 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
              <Search className="absolute left-4 top-3.5 text-slate-500" size={20} />
            </div>
          </div>
          {connectionError && (
            <div className="bg-rose-500/10 border border-rose-500 text-rose-400 p-4 rounded mb-6 flex items-center gap-3">
              <Zap className="text-rose-500" />
              <div>
                <p className="font-bold">Connection Fail</p>
                <p className="text-sm">{connectionError}. Check your configuration.</p>
              </div>
            </div>
          )}
          {isPoolsLoading ? (
            <div className="text-center py-20"><Loader className="animate-spin inline-block mb-2" /> <p>Loading public grids...</p></div>
          ) : (
            <div className="space-y-4">
              {publicPools.map(pool => (
                <div key={pool.id} onClick={() => window.location.hash = `#pool/${pool.id}`} className="bg-slate-800 border border-slate-700 p-6 rounded-xl flex justify-between items-center cursor-pointer hover:border-indigo-500">
                  <div><h3 className="text-xl font-bold text-white">{pool.name}</h3><p className="text-sm text-slate-400">{pool.awayTeam} vs {pool.homeTeam}</p></div>
                  <ArrowRight size={20} />
                </div>
              ))}
              {publicPools.length === 0 && <div className="text-center text-slate-500 py-10">No public pools found.</div>}
            </div>
          )}
        </main>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    );
  }

  if (route.view === 'pool') {
    if (isPoolsLoading) return <div className="text-white p-10 flex flex-col items-center gap-4"><Loader className="animate-spin text-indigo-500" size={48} /><p>Loading Pool...</p></div>;
    if (!currentPool) {
      return (
        <div className="text-white p-10 font-mono flex flex-col items-center justify-center min-h-[50vh]">
          <h2 className="text-xl font-bold mb-4 text-rose-400">Pool Not Found (Debug Mode)</h2>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 max-w-2xl w-full text-sm space-y-2 shadow-2xl">
            <p><strong>Route Mode:</strong> {route.view}</p>
            <p><strong>Looking for ID/Slug:</strong> <span className="text-amber-300">"{route.id}"</span></p>
            <p><strong>Current Hash:</strong> "{hash}"</p>
            <p><strong>Window Path:</strong> "{window.location.pathname}"</p>
            <p><strong>Pools Loaded:</strong> {pools.length}</p>
            <div className="max-h-60 overflow-y-auto border border-slate-700 p-2 rounded bg-black/30 mt-4">
              <p className="text-xs text-slate-400 mb-1 sticky top-0 bg-slate-900/90 py-1">Available Pools (ID | Slug | Name):</p>
              {pools.map(p => (
                <div key={p.id} className="text-xs border-b border-slate-800/50 py-1 font-mono flex justify-between gap-4">
                  <span>{p.id}</span>
                  <span className="text-emerald-400">{p.urlSlug || 'NO_SLUG'}</span>
                  <span className="text-slate-500 truncate">{p.name}</span>
                </div>
              ))}
            </div>
            <div className="pt-4 flex gap-4">
              <button onClick={() => window.location.href = '/'} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-white font-bold transition-colors">Go Home</button>
              <button onClick={() => window.location.reload()} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-white font-bold transition-colors">Reload Page</button>
            </div>
          </div>
        </div>
      );
    }

    const q1Data = getQuarterData('q1');
    const halfData = getQuarterData('half');
    const q3Data = getQuarterData('q3');
    const finalData = getQuarterData('final');
    const homeLogo = getTeamLogo(currentPool.homeTeam);
    const awayLogo = getTeamLogo(currentPool.awayTeam);
    const homePredictions = calculateScenarioWinners(currentPool, 'home');
    const awayPredictions = calculateScenarioWinners(currentPool, 'away');
    const squaresRemaining = 100 - currentPool.squares.filter(s => s.owner).length;
    const latestWinner = winners.length > 0 ? winners[winners.length - 1].owner : null;
    const isAdmin = user && user.id === currentPool.ownerId;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-20 relative">
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />
        {/* Header Content */}
        <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-bold text-white mb-1">{currentPool.name}</h1>
            <p className="text-slate-400 text-sm font-medium">{squaresRemaining} Squares Remaining</p>
          </div>
          <div className="flex gap-2">
            {!user && (
              <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="hidden md:block bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                Sign In
              </button>
            )}
            <button onClick={() => openShare(currentPool.id)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Share</button>
          </div>
        </div>

        {/* Sim Banner */}
        {simMessage && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-fuchsia-600 text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-bounce flex items-center gap-2 font-bold"><Zap size={20} fill="currentColor" /> {simMessage}</div>
        )}
        {/* Sim Button */}
        {isAdmin && (
          <button onClick={() => handleRunSimulation(currentPool.id)} disabled={isSimulating} className="fixed bottom-6 right-6 z-50 bg-fuchsia-600 hover:bg-fuchsia-500 text-white p-4 rounded-full shadow-2xl shadow-fuchsia-500/40 flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:opacity-50 disabled:scale-100">
            {isSimulating ? <Zap className="animate-spin" size={24} /> : <Zap size={24} />}
          </button>
        )}

        {/* Latest Winner Banner */}
        {
          latestWinner && (
            <div className="flex justify-center mt-4 mb-2">
              <div className="bg-gradient-to-r from-amber-900/40 to-yellow-900/40 border border-amber-500/50 rounded-full px-8 py-2 text-amber-200 font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(245,158,11,0.1)] flex items-center gap-3">
                🤑 IN THE MONEY: <span className="text-white text-lg">{latestWinner}</span> 🤑
              </div>
            </div>
          )
        }

        {/* INFO & PAYOUTS ROW */}
        <div className="max-w-[1400px] mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 1. Grid Owner */}
          <div className="bg-black rounded-xl border border-slate-800 p-6 shadow-xl flex flex-col justify-center">
            <div className="mb-4"><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Grid Owner:</h3><p className="text-white font-medium">{currentPool.contactEmail || 'Admin'}</p></div>
            <div className="mb-4"><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Limits:</h3><p className="text-white font-medium text-sm">Max {currentPool.maxSquaresPerPlayer} squares per player</p></div>
            <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Instructions from Pool Manager:</h3><p className="text-slate-300 text-sm leading-relaxed">{currentPool.paymentInstructions}</p></div>
          </div>
          {/* 2. Scoreboard */}
          <div className="bg-black rounded-xl border border-slate-800 p-0 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-slate-800/20 rounded-full blur-2xl"></div>
            <div className="p-4 border-b border-slate-800 text-center"><h3 className="text-white font-bold">Game Scoreboard</h3></div>
            <div className="p-4">
              <div className="grid grid-cols-7 gap-2 text-center text-sm mb-2 text-slate-500 font-bold uppercase text-[10px]"><div className="col-span-2 text-left pl-2">Team</div><div>1</div><div>2</div><div>3</div><div>4</div><div>T</div></div>
              <div className="grid grid-cols-7 gap-2 text-center text-white font-bold items-center mb-3 bg-slate-900/50 p-2 rounded"><div className="col-span-2 text-left pl-2 flex items-center gap-2">{awayLogo && <img src={awayLogo} className="w-6 h-6 object-contain" />}{currentPool.awayTeam}</div><div>{getScoreboardVal(1, 'away')}</div><div>{getScoreboardVal(2, 'away')}</div><div>{getScoreboardVal(3, 'away')}</div><div>{getScoreboardVal(4, 'away')}</div><div className="text-indigo-400 text-lg">{sanitize(currentPool.scores.current?.away)}</div></div>
              <div className="grid grid-cols-7 gap-2 text-center text-white font-bold items-center bg-slate-900/50 p-2 rounded"><div className="col-span-2 text-left pl-2 flex items-center gap-2">{homeLogo && <img src={homeLogo} className="w-6 h-6 object-contain" />}{currentPool.homeTeam}</div><div>{getScoreboardVal(1, 'home')}</div><div>{getScoreboardVal(2, 'home')}</div><div>{getScoreboardVal(3, 'home')}</div><div>{getScoreboardVal(4, 'home')}</div><div className="text-rose-400 text-lg">{sanitize(currentPool.scores.current?.home)}</div></div>
            </div>
          </div>
          {/* 3. Payout Structure */}
          <div className="bg-black rounded-xl border border-slate-800 p-6 shadow-xl flex flex-col justify-center">
            <h3 className="text-center text-slate-300 font-bold mb-4 border-b border-slate-800 pb-2">Payout Structure</h3>
            <div className="space-y-3">
              {Object.entries(currentPool.payouts).map(([key, percent]) => {
                const effectivePot = Math.max(0, (currentPool.squares.filter(s => s.owner).length * currentPool.costPerSquare) - (currentPool.ruleVariations.scoreChangePayout ? (currentPool.scoreEvents.length * currentPool.scoreChangePayoutAmount) : 0));
                const amount = (effectivePot * (percent as number)) / 100;
                const label = key === 'q1' ? '1st Quarter' : key === 'half' ? '2nd Quarter' : key === 'q3' ? '3rd Quarter' : 'Final Score';
                return (<div key={key} className="flex justify-between items-center text-sm"><span className="text-slate-400 font-bold">{label}:</span><span className="text-white font-mono font-bold">${amount.toLocaleString(undefined, { minimumFractionDigits: 0 })}</span></div>);
              })}
            </div>
          </div>
        </div>

        {/* Grid Component */}
        <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col items-center">
          <div className="flex items-center gap-4 w-full justify-center">
            {/* Home Logo */}
            <div className="hidden md:flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-rose-900/20 rounded-full flex items-center justify-center border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] bg-white p-1">
                {homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" /> : <span className="text-rose-400 font-bold text-xl">{currentPool.homeTeam.substring(0, 2).toUpperCase()}</span>}
              </div>
            </div>
            {/* Grid */}
            <div className="flex-1 overflow-x-auto">
              <Grid
                gameState={currentPool}
                onClaimSquares={(ids, name, details) => handleClaimSquares(ids, name, details)}
                winners={winners}
                highlightHomeDigit={getLastDigit(currentPool.scores.current?.home ?? 0)}
                highlightAwayDigit={getLastDigit(currentPool.scores.current?.away ?? 0)}
              />
            </div>
            {/* Away Logo */}
            <div className="hidden md:flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-indigo-900/20 rounded-full flex items-center justify-center border-2 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)] bg-white p-1">
                {awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" /> : <span className="text-indigo-400 font-bold text-xl">{currentPool.awayTeam.substring(0, 2).toUpperCase()}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* WHAT IF SCENARIOS */}
        <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 xl:grid-cols-2 gap-8 items-start mb-8">
          <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{awayLogo && <img src={awayLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-indigo-400 font-bold">{currentPool.awayTeam}</span> score next...</h3></div>
            <div className="bg-black/50 p-4 space-y-4">{awayPredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-indigo-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
          </div>
          <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{homeLogo && <img src={homeLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-rose-400 font-bold">{currentPool.homeTeam}</span> score next...</h3></div>
            <div className="bg-black/50 p-4 space-y-4">{homePredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-rose-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
          </div>
        </div>

        {/* BOTTOM Payout Cards */}
        <div className="max-w-[1400px] mx-auto px-4 mb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Quarter 1', data: q1Data },
              { title: 'Quarter 2', data: halfData },
              { title: 'Quarter 3', data: q3Data },
              { title: 'Quarter 4', data: finalData }
            ].map((card, idx) => (
              <div key={idx} className="bg-black border border-slate-800 rounded-xl p-6 text-center shadow-lg relative overflow-hidden group">
                <div className={`absolute top-0 w-full h-1 opacity-20 group-hover:opacity-50 transition-opacity ${card.data.isLocked ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                <h4 className="text-slate-400 font-bold text-sm uppercase mb-4">{card.title}</h4>
                <div className="flex justify-center gap-4 text-white font-bold text-2xl mb-2 items-center">
                  <span>{card.data.home}</span> <span className="text-slate-600">-</span> <span>{card.data.away}</span>
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
                {card.data.isLocked ? <Lock size={20} className="text-rose-500/50 mx-auto" /> : <Unlock size={20} className="text-emerald-500/30 mx-auto" />}
              </div>
            ))}
          </div>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
      </div >
    );
  }

  return <div>Loading...</div>;
};

export default App;