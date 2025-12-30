import React, { useState, useEffect, useMemo, useRef } from 'react';
import confetti from 'canvas-confetti';
import { Grid } from './components/Grid';
import { AdminPanel } from './components/AdminPanel';
import { Auth } from './components/Auth';
import { LandingPage } from './components/LandingPage';
import { BracketWizard } from './components/BracketWizard/BracketWizard';
import { CreatePoolSelection } from './components/CreatePoolSelection';
import { BracketPoolDashboard } from './components/BracketPoolDashboard/BracketPoolDashboard';

import { createNewPool, getTeamLogo, PERIOD_LABELS } from './constants';
import type { GameState, Scores, PlayerDetails, User, Pool } from './types';
import { calculateScenarioWinners, getLastDigit } from './services/gameLogic';
import { authService } from './services/authService';
import { fetchGameScore } from './services/scoreService';
import { dbService } from './services/dbService';
import { Share2, HelpCircle, Lock, ArrowRight, ExternalLink, LogOut, Unlock, Twitter, Facebook, Link as LinkIcon, MessageCircle, X, Loader, Shield, Zap, Heart, ChevronDown, ChevronUp, Trophy, Edit2, Check, Shuffle } from 'lucide-react';

import { AuditLog } from './components/AuditLog'; // Standard import
import { AICommissioner } from './components/AICommissioner';
// Theme utilities available: import { themeToStyleVars, getPoolBackground } from './utils/themeUtils';
// Theme type available: import type { PoolTheme } from './types';

// Lazy load SuperAdmin
const SuperAdmin = React.lazy(() => import('./components/SuperAdmin').then(m => ({ default: m.SuperAdmin })));
const ParticipantDashboard = React.lazy(() => import('./components/ParticipantDashboard').then(m => ({ default: m.ParticipantDashboard })));
import { UserProfile } from './components/UserProfile';
import { BrowsePools } from './components/BrowsePools';
import { FeaturesPage } from './components/FeaturesPage';
import { PrivacyPage } from './components/PrivacyPage';
import { TermsPage } from './components/TermsPage';
import { HowItWorksPage } from './components/HowItWorksPage'; // Added import
import { SupportPage } from './components/SupportPage';
import { ManagerDashboard } from './components/ManagerDashboard';
import { Scoreboard } from './components/Scoreboard';

// --- SHARED COMPONENTS ---

const ShareModal: React.FC<{ isOpen: boolean; onClose: () => void; shareUrl: string }> = ({ isOpen, onClose, shareUrl }) => {
  if (!isOpen) return null;
  const encodedUrl = encodeURIComponent(shareUrl);
  const text = "Join my Game Day Squares pool! Pick your winning squares now.";
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
        <Auth onLogin={() => { onClose(); }} defaultIsRegistering={initialMode === 'register'} />
      </div>
    </div>
  );
};

const PoolTimer = ({ targetDate, gameStatus, isLocked }: { targetDate?: string | number, gameStatus?: string, isLocked: boolean }) => {
  const [timeLeft, setTimeLeft] = useState<{ d: number, h: number, m: number, s: number } | null>(null);

  useEffect(() => {
    if (!targetDate || gameStatus === 'in' || gameStatus === 'post') {
      setTimeLeft(null);
      return;
    }

    const target = new Date(targetDate).getTime();
    const update = () => {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft({ d: 0, h: 0, m: 0, s: 0 });
        return;
      }
      setTimeLeft({
        d: Math.floor(diff / (1000 * 60 * 60 * 24)),
        h: Math.floor((diff / (1000 * 60 * 60)) % 24),
        m: Math.floor((diff / 1000 / 60) % 60),
        s: Math.floor((diff / 1000) % 60)
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate, gameStatus]);

  if (gameStatus === 'post' || gameStatus === 'final') return <span className="text-slate-500 font-bold uppercase tracking-wider text-xs">Game Complete</span>;
  if (gameStatus === 'in') return <span className="text-emerald-400 font-bold uppercase tracking-wider text-xs animate-pulse">Game In Progress</span>;
  if (!timeLeft) return <span className="text-slate-500 font-bold uppercase tracking-wider text-xs">{isLocked ? "Pool Locked" : "Waiting for Schedule"}</span>;

  // Determine color
  const totalHours = timeLeft.d * 24 + timeLeft.h;
  let color = 'text-emerald-400';
  if (totalHours === 0 && timeLeft.m < 10) color = 'text-rose-500 animate-pulse';
  else if (totalHours === 0) color = 'text-amber-500';

  return (
    <div className={`font-mono font-bold text-xl ${color}`}>
      {timeLeft.d > 0 && <span>{timeLeft.d}d </span>}
      <span>{timeLeft.h.toString().padStart(2, '0')}h </span>
      <span>{timeLeft.m.toString().padStart(2, '0')}m </span>
      <span>{timeLeft.s.toString().padStart(2, '0')}s</span>
      <p className="text-[10px] text-slate-500 font-sans uppercase tracking-widest mt-1">Time Until Kickoff</p>
    </div>
  );
};

import { Header } from './components/Header';
import { Footer } from './components/Footer';

// --- MAIN APP ---
import { BUILD_TIMESTAMP } from './version';

const App: React.FC = () => {
  console.log('App Version:', BUILD_TIMESTAMP);
  const [hash, setHash] = useState(window.location.hash);
  const [user, setUser] = useState<User | null>(authService.getCurrentUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [statusTab, setStatusTab] = useState<'overview' | 'rules' | 'payment'>('overview');
  const [showPoolInfo, setShowPoolInfo] = useState(true);
  const [shareUrl, setShareUrl] = useState('');
  const [showAudit, setShowAudit] = useState(false); // New State
  const [pendingAction, setPendingActionState] = useState<'create_pool' | null>(() => {
    return localStorage.getItem('pendingAction') as 'create_pool' | null;
  });

  const setPendingAction = (action: 'create_pool' | null) => {
    setPendingActionState(action);
    if (action) {
      localStorage.setItem('pendingAction', action);
    } else {
      localStorage.removeItem('pendingAction');
    }
  };
  const [syncStatus, setSyncStatus] = useState<'idle' | 'searching' | 'found' | 'not-found' | 'error'>('idle');

  const [pools, setPools] = useState<Pool[]>([]);
  const [isPoolsLoading, setIsPoolsLoading] = useState(true);


  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Capture referral code from URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    if (refCode) {
      authService.storeReferralCode(refCode);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
  }, []);

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

  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    return authService.onAuthStateChanged(async (u) => {
      if (u) {
        // Fetch full profile from DB to get the correct ROLE
        const fullProfile = await authService.syncUserToFirestore(u);
        setUser(fullProfile);
        setShowAuthModal(false);
        dbService.saveUser(fullProfile);

        // Attempt to merge guest squares if we have context
        const guestKey = localStorage.getItem('mmp_guest_key');
        const hash = window.location.hash;
        if (guestKey && hash.startsWith('#pool/')) {
          const poolId = hash.replace('#pool/', '');
          // Silent merge attempt
          dbService.claimMySquares(poolId, guestKey)
            .then(res => {
              if (res.success && res.warnings.length === 0) {
                console.log("Automatically merged guest squares.");
              }
            })
            .catch(err => console.error("Auto-merge failed", err));
        }
      } else {
        setUser(null);
      }
      setIsAuthLoading(false);
    });
  }, []);

  // Effect to handle pending actions after login
  useEffect(() => {
    // Check both state and localStorage for robustness
    const action = pendingAction || localStorage.getItem('pendingAction');
    if (user && action === 'create_pool') {
      setPendingAction(null); // Clear pending action first to prevent loops
      handleCreatePool();
    }
  }, [user, pendingAction]);

  // Real-time subscription to pools
  useEffect(() => {
    // We need two subscriptions:
    // 1. All Public Pools (for browsing)
    // 2. My Pools (for management, including private ones)
    // We merge them into one list.

    let publicPools: GameState[] = [];
    let myPools: GameState[] = [];

    // Helper to merge and set
    const updateMergedPools = () => {
      // Merge arrays and deduplicate by ID
      const map = new Map();
      [...publicPools, ...myPools].forEach(p => map.set(p.id, p));
      setPools(Array.from(map.values()));
      setIsPoolsLoading(false);
    };

    // Sub 1: Public Pools
    const unsubPublic = dbService.subscribeToPools(
      (p) => {
        publicPools = p;
        updateMergedPools();
        setConnectionError(null);
      },
      (error) => {
        console.error("Public Pool Sup Error", error);
        // Don't block app if public sub fails, might be just connection
        if (!user) { // Only set global error if we have no user fallback
          setIsPoolsLoading(false);
          setConnectionError("Failed to connect to database.");
        }
      }
      // No ownerFilter -> implies "isPublic == true" per dbService change
    );

    let unsubMine = () => { };

    if (user) {
      unsubMine = dbService.subscribeToPools(
        (p) => {
          myPools = p;
          updateMergedPools();
        },
        (error) => {
          console.error("My Pool Sub Error", error);
        },
        user.id
      );
    } else {
      myPools = [];
      updateMergedPools();
    }

    return () => {
      unsubPublic();
      unsubMine();
    };
  }, [user?.id]); // Re-run when user changes (login/logout)

  const route = useMemo(() => {
    if (hash.startsWith('#admin')) {
      const parts = hash.split('/');
      return parts.length === 2 ? { view: 'admin-editor', id: parts[1] } : { view: 'admin-dashboard', id: null };
    }
    if (hash.startsWith('#super-admin')) return { view: 'super-admin', id: null };
    if (hash.startsWith('#participant')) return { view: 'participant', id: null };
    if (hash.startsWith('#pool')) return { view: 'pool', id: hash.split('/')[1] };
    if (hash.startsWith('#browse')) return { view: 'browse', id: null };
    if (hash.startsWith('#features')) return { view: 'features', id: null };
    if (hash.startsWith('#profile')) return { view: 'profile', id: null };
    if (hash.startsWith('#privacy')) return { view: 'privacy', id: null };
    if (hash.startsWith('#terms')) return { view: 'terms', id: null };
    if (hash.startsWith('#how-it-works')) return { view: 'how-it-works', id: null };
    if (hash.startsWith('#scoreboard')) return { view: 'scoreboard', id: null };
    if (hash.startsWith('#support')) return { view: 'support', id: null };
    if (hash.startsWith('#support')) return { view: 'support', id: null };
    if (hash.startsWith('#create-pool')) return { view: 'create-pool', id: null };
    if (hash.startsWith('#bracket-wizard')) return { view: 'bracket-wizard', id: null };
    return { view: 'home', id: null };
  }, [hash]);

  // Single Pool Subscription (for robust Deep Linking & Guest Access)
  const [singlePool, setSinglePool] = useState<GameState | null>(null);
  const [isSinglePoolLoading, setIsSinglePoolLoading] = useState(false);
  const [singlePoolError, setSinglePoolError] = useState<any>(null);

  useEffect(() => {
    if ((route.view === 'pool' || route.view === 'admin-editor') && route.id) {
      setIsSinglePoolLoading(true);
      setSinglePoolError(null);
      const unsub = dbService.subscribeToPool(route.id, (p) => {
        setSinglePool(p);
        setIsSinglePoolLoading(false);
      }, (err) => {
        setSinglePoolError(err);
        setIsSinglePoolLoading(false);
      });
      return () => unsub();
    } else {
      setSinglePool(null);
      setIsSinglePoolLoading(false);
      setSinglePoolError(null);
      return undefined;
    }
  }, [route.view, route.id]);



  const currentPool = useMemo(() => {
    // Priority 1: Directly fetched single pool (most robust for deep links)
    if (singlePool && route.id && (singlePool.id === route.id || singlePool.urlSlug === route.id)) return singlePool;

    // Priority 2: Find in the global list (fallback if single fetch failed or is loading, but list has it)
    if (route.id) {
      return pools.find(p => {
        if (p.id === route.id) return true;
        const slug = p.type === 'BRACKET' ? p.slug : p.urlSlug;
        return slug && slug.toLowerCase() === route.id.toLowerCase();
      }) || null;
    }
    return null;
  }, [pools, singlePool, route.id]);

  // State for Password Gate
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const handlePasswordSubmit = () => {
    if (currentPool && (currentPool.type === 'SQUARES' || !currentPool.type) && (currentPool as GameState).gridPassword) {
      if (enteredPassword === (currentPool as GameState).gridPassword) {
        setIsUnlocked(true);
        setPasswordError(false);
      } else {
        setPasswordError(true);
      }
      return;
    }
    setPasswordError(true);
  };

  useEffect(() => {
    if (currentPool) {
      // Bracket pools might use passwordHash, checking gridPassword for Squares
      if (currentPool.type === 'BRACKET') {
        // Bracket dashboard handles its own locking or isUnlocked state if needed
        setIsUnlocked(true); // Brackets don't use this gate logic yet
      } else {
        setIsUnlocked(!(currentPool as GameState).gridPassword);
      }
    }
  }, [currentPool?.id]);



  useEffect(() => {
    if (!user || !currentPool || currentPool.type === 'BRACKET') return;
    const squaresPool = currentPool as GameState;

    // Only sync scores if user is the pool owner (has permission to update)
    const isPoolOwner = user && squaresPool.ownerId === user.id;
    if (!isPoolOwner) {
      return; // Don't attempt score sync for non-owners
    }

    // Fetch if gameId exists OR (homeTeam AND awayTeam exist for fuzzy match)
    const canFetch = squaresPool.gameId || (squaresPool.homeTeam && squaresPool.awayTeam);
    if (!canFetch || squaresPool.manualScoreOverride || squaresPool.scores.gameStatus === 'post') {
      setSyncStatus('idle');
      return;
    }

    const doFetch = async () => {
      setSyncStatus('searching');
      const res = await fetchGameScore(squaresPool);
      if (res) {
        updateScores(squaresPool.id, res.scores);
        setSyncStatus('found');
      } else {
        setSyncStatus('not-found');
      }
    };

    doFetch();
    const interval = setInterval(doFetch, 60000);
    return () => clearInterval(interval);
  }, [user, currentPool?.id, (currentPool as GameState)?.scores?.final]); // Simplified dependency array to avoid deep access issues

  // Fetch Winners from Subcollection (Authoritative)
  const [winners, setWinners] = useState<any[]>([]);
  const prevWinnersCountRef = useRef<number>(0);

  useEffect(() => {
    if (!currentPool || currentPool.type === 'BRACKET') {
      setWinners([]);
      prevWinnersCountRef.current = 0;
      return;
    }
    const unsub = dbService.subscribeToWinners(currentPool.id, (wins) => {
      // Check if new winner was added (trigger celebration)
      if (wins.length > prevWinnersCountRef.current && prevWinnersCountRef.current > 0) {
        // 🎉 Trigger confetti celebration!
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#FF6600', '#10B981', '#FBBF24', '#3B82F6', '#F472B6']
        });

        // Play celebration sound if enabled
        const audio = document.getElementById('winner-sound') as HTMLAudioElement;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => { }); // Ignore autoplay errors
        }
      }
      prevWinnersCountRef.current = wins.length;
      setWinners(wins);
    });
    return () => unsub();
  }, [currentPool?.id]);

  // Calculate isManager once
  const isManager = useMemo(() => {
    return !!user && (
      user.role === 'POOL_MANAGER' ||
      user.role === 'SUPER_ADMIN' ||
      pools.some(p => {
        if (p.type === 'BRACKET') return p.managerUid === user.id;
        return (p as GameState).ownerId === user.id;
      })
    );
  }, [user, pools]);

  // --- ACTIONS ---


  const addNewPool = async (p: GameState): Promise<string> => {
    return await dbService.createPool(p);
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
    if (!currentPool || currentPool.type === 'BRACKET') return;
    // Just force update assuming squares pool context
    await dbService.updatePool(id, { scores: { ...(currentPool as GameState).scores, ...scoreUpdates } as Scores });
  };

  const deletePool = async (id: string) => {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    await dbService.deletePool(id);
    // Only redirect if we are actively viewing the pool being deleted
    if (currentPool?.id === id) {
      window.location.hash = '';
    }
  };

  async function handleCreatePool() {
    if (!user) {
      setPendingAction('create_pool');
      setAuthMode('register');
      setShowAuthModal(true);
      return;
    }
    // New Flow: Redirect to Create Selection
    window.location.hash = '#create-pool';
  };

  const handleSquaresPoolCreate = async () => {
    try {
      if (!user) return;
      const newPool = createNewPool(`Pool #${pools.length + 1}`, user.id, user.name, user.email);

      // Only warn if the user is a Participant AND not already a Manager (first-time upgrade)
      if (!isManager && user.role === 'PARTICIPANT') {
        if (!confirm("Creating a pool will upgrade your account to Pool Manager. Continue?")) return;
      }

      const poolId = await addNewPool(newPool);
      // Refresh User Profile
      const freshUser = await authService.getUserData(user.id);
      if (freshUser) {
        setUser(freshUser);
        dbService.saveUser(freshUser);
      }

      window.location.hash = `#admin/${poolId}`;
    } catch (err: any) {
      console.error("Create failed", err);
      const isAuth = err.code === 'permission-denied';
      alert(`Failed to create pool: ${isAuth ? 'Permission Denied (Check Rules)' : err.message || err}.`);
    }
  };

  const handleDeletePool = (id: string) => {
    deletePool(id);
  };

  const handleArchivePool = async (id: string, archive: boolean) => {
    try {
      await dbService.archivePool(id, archive);
    } catch (err: any) {
      console.error('Archive pool failed:', err);
      alert(`Failed to ${archive ? 'archive' : 'restore'} pool: ${err.message}`);
    }
  };

  const handleDuplicatePool = async (id: string) => {
    try {
      const sourcePod = pools.find(p => p.id === id) as GameState | undefined;
      if (!sourcePod || sourcePod.type !== 'SQUARES') {
        alert('Cannot duplicate this pool type');
        return;
      }
      if (!user) {
        alert('Please sign in to duplicate pools');
        return;
      }

      // Create a copy with reset data
      const newPool: GameState = {
        ...sourcePod,
        id: '', // Will be assigned by createPool
        name: `${sourcePod.name} (Copy)`,
        urlSlug: `${sourcePod.urlSlug}-${Date.now().toString(36).slice(-4)}`,
        squares: Array.from({ length: 100 }, (_, i) => ({ id: i, owner: '' })), // Reset squares
        axisNumbers: null, // Reset axis numbers
        scores: {
          current: null,
          q1: null,
          half: null,
          q3: null,
          final: null,
          gameStatus: 'pre',
        },
        scoreEvents: [],
        isLocked: false,
        status: 'active',
        waitlist: [],
        postGameEmailSent: false,
        ownerId: user.id,
        createdAt: undefined,
        updatedAt: undefined,
      };

      const newPoolId = await addNewPool(newPool);
      window.location.hash = `#admin/${newPoolId}`;
    } catch (err: any) {
      console.error('Duplicate pool failed:', err);
      alert(`Failed to duplicate pool: ${err.message}`);
    }
  };

  const openShare = (id?: string) => {
    if (!id) return;
    const pool = pools.find(p => p.id === id);
    const identifier = (pool?.type === 'BRACKET' ? pool.slug : pool?.urlSlug) || id;
    setShareUrl(`${window.location.origin}/#pool/${identifier}`);
    setShowShareModal(true);
  };

  const handleClaimSquares = async (ids: number[], name: string, details: PlayerDetails, guestKey?: string): Promise<{ success: boolean; message?: string }> => {
    if (!currentPool) return { success: false };
    if (currentPool.type === 'BRACKET') return { success: false, message: "Use bracket builder" };

    const squaresPool = currentPool as GameState;
    const normalizedName = name.trim();
    if (!normalizedName) return { success: false, message: 'Name required' };

    // Limits check is now redundant (enforced by server), but good for UX feedback
    const currentOwned = squaresPool.squares.filter(s => s.owner && s.owner.toLowerCase() === normalizedName.toLowerCase()).length;
    const limit = Number(currentPool.maxSquaresPerPlayer) || 10;
    if (currentOwned + ids.length > limit && currentPool.ownerId !== user?.id) return { success: false, message: `Limit exceeded. Max ${limit}.` };

    try {
      const promises = ids.map(id => dbService.reserveSquare(
        currentPool.id,
        id,
        { ...details, name: normalizedName },
        guestKey, // Pass Guest Key
        normalizedName // pickedAsName
      ));
      await Promise.all(promises);
    } catch (error: any) {
      console.error("Reserve failed", error);
      return { success: false, message: error.message || "Reservation failed." };
    }

    // Send Email Confirmation (Client-side trigger kept for now, though ideally this moves to backend trigger too)
    // NOTE: Sending email BEFORE confirmation of success is risky, but we await the promise above.
    // Ideally, we use a Firestore Trigger for email sending to ensure it only happens on successful DB write.
    // For this migration, I will keep the existing client-side email logic but ensure it runs AFTER await.



    console.log('[App] Processing Square Claim. Config:', {
      emailSetting: currentPool.emailConfirmation,
      userEmail: details.email
    });

    if ((currentPool.emailConfirmation === 'Email Confirmation' || currentPool.emailConfirmation === 'true') && details.email) {
      console.log('[App] Email condition met. Importing service...');
      const ownerId = (currentPool as any).ownerId || (currentPool as any).managerUid;
      import('./services/emailService').then(({ emailService }) => {
        console.log('[App] Service imported. Sending confirmation...');
        emailService.sendConfirmation(
          currentPool.name,
          ids.map(id => ({ id, cost: (currentPool as GameState).costPerSquare })),
          details.email!,
          normalizedName,
          currentPool.id,
          {
            ruleVariations: (currentPool as GameState).ruleVariations,
            charity: (currentPool as GameState).charity,
            costPerSquare: (currentPool as GameState).costPerSquare,
            payouts: (currentPool as GameState).payouts
          },
          ownerId, // Pool owner's referral code
          squaresPool.paymentHandles // Add payment handles
        ).then((res) => console.log('[App] Email Service Response:', res))
          .catch(err => console.error('[App] Email failed', err));
      }).catch(err => console.error('[App] Failed to import emailService', err));
    }

    // Check for Grid Full
    // We need to fetch the LATEST state to know if full, or just guess based on local + 1.
    // Current pool state might not be updated yet via subscription.
    // We can skip this check logic for now or rely on the backend to trigger it eventually.

    return { success: true };
  };



  const sanitize = (n: any) => {
    if (n === null || n === undefined) return 0;
    const val = parseInt(n);
    return isNaN(val) ? 0 : val;
  };

  const getScoreboardVal = (period: 1 | 2 | 3 | 4, team: 'home' | 'away') => {
    if (!currentPool || currentPool.type === 'BRACKET') return 0;
    const s = (currentPool as GameState).scores;
    const cur = sanitize(s.current?.[team]);

    const q1 = s.q1?.[team] !== undefined ? sanitize(s.q1[team]) : null;
    const half = s.half?.[team] !== undefined ? sanitize(s.half[team]) : null;
    const q3 = s.q3?.[team] !== undefined ? sanitize(s.q3[team]) : null;
    const final = s.final?.[team] !== undefined ? sanitize(s.final[team]) : null;

    const currentPeriod = s.period || 1;
    const isPost = s.gameStatus === 'post';

    // Q1
    if (period === 1) {
      if (currentPeriod > 1 || isPost) return q1 ?? 0;
      return cur; // Current Live
    }
    // Q2
    if (period === 2) {
      if (currentPeriod > 2 || isPost) {
        if (half !== null) return half - (q1 ?? 0);
        return 0;
      }
      if (currentPeriod === 2) {
        return Math.max(0, cur - (q1 ?? 0));
      }
      return 0; // Future
    }
    // Q3
    if (period === 3) {
      if (currentPeriod > 3 || isPost) {
        if (q3 !== null) return q3 - (half ?? 0);
        return 0;
      }
      if (currentPeriod === 3) {
        return Math.max(0, cur - (half ?? 0));
      }
      return 0;
    }
    // Q4
    if (period === 4) {
      if (currentPeriod > 4 || isPost) {
        if (final !== null) return final - (q3 ?? 0);
        return Math.max(0, (final ?? cur) - (q3 ?? 0));
      }
      if (currentPeriod >= 4) {
        return Math.max(0, cur - (q3 ?? 0));
      }
      return 0;
    }
    return 0;
  };

  const quarterlyPayouts = useMemo(() => {
    if (!currentPool || currentPool.type === 'BRACKET') return [];
    const squaresPool = currentPool as GameState;
    const periods = ['q1', 'half', 'q3', 'final'] as const;
    let accumulatedRollover = 0;

    const totalPot = squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare;
    const charityDeduction = squaresPool.charity?.enabled ? Math.floor(totalPot * (squaresPool.charity.percentage / 100)) : 0;
    const netPot = totalPot - charityDeduction;

    return periods.map(period => {
      const percent = squaresPool.payouts[period];
      const baseAmount = Math.floor(netPot * (percent / 100));
      let currentAmount = baseAmount;
      let rolloverContribution = 0;

      // Score Logic
      const isFinal = !!squaresPool.scores[period];
      const lockedScore = squaresPool.scores[period];
      const liveScore = squaresPool.scores.current;
      const home = lockedScore ? sanitize(lockedScore.home) : sanitize(liveScore?.home);
      const away = lockedScore ? sanitize(lockedScore.away) : sanitize(liveScore?.away);

      // Previous Score
      let prevHome = 0, prevAway = 0;
      if (period === 'half') { prevHome = sanitize(squaresPool.scores.q1?.home); prevAway = sanitize(squaresPool.scores.q1?.away); }
      else if (period === 'q3') { prevHome = sanitize(squaresPool.scores.half?.home); prevAway = sanitize(squaresPool.scores.half?.away); }
      else if (period === 'final') { prevHome = sanitize(squaresPool.scores.q3?.home); prevAway = sanitize(squaresPool.scores.q3?.away); }

      const qPointsHome = home - prevHome;
      const qPointsAway = away - prevAway;

      // Winner Logic
      let winnerName = "TBD";
      let reverseWinnerName: string | null = null;
      let hasWinner = false;

      // Check for Official Winner (Backend Authoritative)
      const officialWinner = winners.find(w => (w.period === period && !w.isReverse));
      // Also check for reverse winner from backend
      const officialReverseWinner = winners.find(w => (w.period === period && w.isReverse === true));

      if (officialWinner) {
        winnerName = officialWinner.owner;
        hasWinner = true;
        // Use reverse winner from backend if available
        if (officialReverseWinner) {
          reverseWinnerName = officialReverseWinner.owner;
        }
      } else if (squaresPool.axisNumbers) {
        const hD = getLastDigit(home);
        const aD = getLastDigit(away);
        // Standard Winner
        // Only calculate if scores exist (game started)
        if (squaresPool.scores.gameStatus === 'in' || squaresPool.scores.gameStatus === 'post' || isFinal) {
          const row = squaresPool.axisNumbers.away.indexOf(aD);
          const col = squaresPool.axisNumbers.home.indexOf(hD);
          if (row !== -1 && col !== -1) {
            const owner = squaresPool.squares[row * 10 + col].owner;
            if (owner) {
              winnerName = owner;
              hasWinner = true;
            } else {
              winnerName = squaresPool.ruleVariations.quarterlyRollover ? "Rollover" : "Unsold";
            }
          }
        }

        // Reverse Winner
        if (squaresPool.ruleVariations.reverseWinners && hasWinner) {
          // ... keep existing reverse logic ...
          // Re-calc for reverse
          const row = squaresPool.axisNumbers.away.indexOf(aD);
          const col = squaresPool.axisNumbers.home.indexOf(hD);
          const rRow = squaresPool.axisNumbers.away.indexOf(hD);
          const rCol = squaresPool.axisNumbers.home.indexOf(aD);
          if (rRow !== -1 && rCol !== -1) {
            const rSqId = rRow * 10 + rCol;
            if (rSqId !== (row * 10 + col)) {
              const rOwner = squaresPool.squares[rSqId].owner;
              if (rOwner) reverseWinnerName = rOwner;
            }
          }
        }
      }

      // Rollover Calculation
      const isRollover = winnerName === "Rollover";
      if (isRollover) {
        accumulatedRollover += baseAmount;
        currentAmount = 0;
      } else if (hasWinner) {
        rolloverContribution = accumulatedRollover;
        currentAmount += accumulatedRollover;
        accumulatedRollover = 0;
      }

      // Split for Reverse
      let finalAmount = currentAmount;
      if (reverseWinnerName) finalAmount = finalAmount / 2;

      return {
        period,
        label: PERIOD_LABELS[period] || period,
        home, away, qPointsHome, qPointsAway,
        winnerName, reverseWinnerName,
        amount: finalAmount,
        baseAmount,
        rolloverAdded: rolloverContribution,
        isLocked: isFinal,
        isRollover,
        isPaid: officialWinner?.isPaid
      };
    });
  }, [currentPool, winners]);

  // Calculate Total Charity
  const totalCharity = useMemo(() => {
    return pools.reduce((acc, pool) => {
      if (pool.type === 'BRACKET') return acc; // TODO: Bracket Charity
      const squaresPool = pool as GameState;
      if (!squaresPool.charity?.enabled) return acc;
      const filled = squaresPool.squares.filter(s => s.owner).length;
      const pot = filled * squaresPool.costPerSquare;
      const donation = pot * (squaresPool.charity.percentage / 100);
      return acc + donation;
    }, 0);
  }, [pools]);

  // Fetch Global Stats (Total Prizes)
  const [totalPrizes, setTotalPrizes] = useState(0);
  useEffect(() => {
    // Subscribe to global stats
    const unsubscribe = dbService.onGlobalStatsUpdate((stats: any) => {
      // console.log("Stats update:", stats);
      if (stats?.totalPrizes) {
        setTotalPrizes(stats.totalPrizes);
      }
    }, (error: any) => {
      console.error("Failed to load global stats:", error);
    });
    return () => unsubscribe();
  }, []);

  // --- RENDER SWITCH ---

  const renderPasswordGate = () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} className="text-indigo-500" /></div>
        <h2 className="text-2xl font-bold text-white mb-2">Password Protected</h2>
        <p className="text-slate-400 mb-6">This pool is private. Please enter the password to view it.</p>
        {passwordError && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-sm mb-4">Incorrect password.</div>}
        <div className="flex gap-2">
          <input type="password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} placeholder="Enter Password" className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500" onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()} />
          <button onClick={handlePasswordSubmit} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg">Unlock</button>
        </div>
        <div className="mt-6 pt-6 border-t border-slate-800"><p className="text-xs text-slate-500">Contact the pool manager for access.</p></div>
      </div>
    </div>
  );

  // Permission Error Check (Private Pools w/o Read Access)
  if (singlePoolError?.code === 'permission-denied' || singlePoolError?.message?.includes('permission')) {
    return renderPasswordGate();
  }

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader className="animate-spin text-indigo-500 mb-4" size={40} />
        <p className="text-slate-400 font-bold animate-pulse">Initializing March Melee Pools...</p>
      </div>
    );
  }

  if (route.view === 'home') {
    return (
      <>
        <LandingPage
          user={user}
          isManager={isManager}
          onLogin={() => { setAuthMode('login'); setShowAuthModal(true); }}
          onSignup={() => { setAuthMode('register'); setShowAuthModal(true); }}
          onLogout={authService.logout}
          onCreatePool={handleCreatePool}
          onBrowse={() => window.location.hash = '#browse'}
          onGoToDashboard={() => window.location.hash = '#participant'}
          isLoggedIn={!!user}
          totalDonated={totalCharity}
          totalPrizes={totalPrizes}
        />
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
      </>
    );
  }

  if (route.view === 'super-admin') {
    return (
      <div className="min-h-screen bg-slate-950 pb-20">
        <Header
          user={user}
          isManager={isManager}
          onLogout={() => authService.logout().then(() => window.location.reload())}
          onOpenAuth={() => setShowAuthModal(true)}
          onCreatePool={handleCreatePool}
        />
        <React.Suspense fallback={<div className="text-white p-10">Loading...</div>}>
          <SuperAdmin />
        </React.Suspense>
        <Footer />
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
    const userPools = pools.filter(p => p.type === 'BRACKET' ? p.managerUid === user.id : (p as GameState).ownerId === user.id);
    return (
      <ManagerDashboard
        user={user}
        pools={userPools}
        isLoading={isPoolsLoading}
        connectionError={connectionError}
        onCreatePool={handleCreatePool}
        onDeletePool={handleDeletePool}
        onArchivePool={handleArchivePool}
        onDuplicatePool={handleDuplicatePool}
        onOpenAuth={() => { setAuthMode('login'); setShowAuthModal(true); }}
        onLogout={authService.logout}
      />
    );
  }

  if (route.view === 'admin-editor') {
    if (isPoolsLoading || isSinglePoolLoading) return <div className="text-white p-10 flex flex-col items-center gap-4"><Loader className="animate-spin text-indigo-500" size={48} /><p>Loading Pool...</p></div>;
    if (!user) return <AuthModal isOpen={true} onClose={() => window.location.hash = '#'} />;
    if (!currentPool) return <div className="text-white p-10">Pool Not Found</div>;
    const ownerId = (currentPool as any).ownerId || (currentPool as any).managerUid;
    if (ownerId && ownerId !== user.id && user.email !== 'kstruck@gmail.com') return <div className="text-white p-10">Unauthorized</div>;

    if ('type' in currentPool && currentPool.type === 'BRACKET') {
      return (
        <BracketPoolDashboard
          pool={currentPool as any}
          user={user}
          onBack={() => window.location.hash = '#participant'}
          onShare={() => {
            navigator.clipboard.writeText(window.location.href);
            alert("Link copied to clipboard!");
          }}
        />
      );
    }

    return (
      <>
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />
        <AdminPanel
          gameState={currentPool}
          updateConfig={(updates) => updatePool(currentPool.id, updates)}
          updateScores={(scores) => updateScores(currentPool.id, scores)}
          generateNumbers={() => dbService.lockPool(currentPool.id)}
          resetGame={() => { const fresh = createNewPool(currentPool.name, user.id); updatePool(currentPool.id, { ...fresh, id: currentPool.id }); }}
          onBack={() => window.location.hash = '#admin'}
          onShare={() => openShare(currentPool.id)}
          checkSlugAvailable={(slug) => !pools.some(p => {
            const pooledSlug = p.type === 'BRACKET' ? p.slug : (p as GameState).urlSlug;
            return pooledSlug === slug && p.id !== currentPool.id;
          })}
          checkNameAvailable={(name) => !pools.some(p => p.name === name && p.id !== currentPool.id)}
          currentUser={user}
        />
        <ShareModal isOpen={showShareModal} onClose={() => setShowAuthModal(false)} shareUrl={shareUrl} />
        <Footer />
      </>
    );
  }

  if (route.view === 'browse') {
    return <BrowsePools user={user} pools={pools} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />;
  }

  if (route.view === 'participant') {
    if (!user) {
      // Force login
      return (
        <>
          <div className="min-h-screen bg-slate-900 flex items-center justify-center">
            <p className="text-slate-500">Redirecting to login...</p>
          </div>
          <AuthModal isOpen={true} onClose={() => window.location.hash = '#'} initialMode='login' />
        </>
      );
    }
    return (
      <React.Suspense fallback={<div className="text-white p-10 flex justify-center"><Loader className="animate-spin" /></div>}>
        <ParticipantDashboard user={user} onLogout={authService.logout} onCreatePool={handleCreatePool} />
      </React.Suspense>
    );
  }

  if (route.view === 'features') {
    return <FeaturesPage user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} />;
  }

  if (route.view === 'privacy') {
    return (
      <PrivacyPage
        user={user}
        isManager={isManager}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={authService.logout}
        onCreatePool={handleCreatePool}
      />
    );
  }

  if (route.view === 'terms') {
    return (
      <TermsPage
        user={user}
        isManager={isManager}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={authService.logout}
        onCreatePool={handleCreatePool}
      />
    );
  }

  if (route.view === 'how-it-works') {
    return (
      <HowItWorksPage
        user={user}
        isManager={isManager}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={authService.logout}
        onCreatePool={handleCreatePool}
      />
    );
  }

  if (route.view === 'scoreboard') {
    return (
      <Scoreboard
        user={user}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={authService.logout}
        onCreatePool={handleCreatePool}
      />
    );
  }

  if (route.view === 'create-pool') {
    return (
      <CreatePoolSelection
        user={user}
        isManager={isManager}
        onSelectSquares={handleSquaresPoolCreate}
        onSelectBracket={() => { window.location.hash = '#bracket-wizard'; }}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={authService.logout}
        onCreatePool={handleCreatePool}
      />
    );
  }

  if (route.view === 'bracket-wizard') {
    if (!user) {
      window.location.hash = '#create-pool';
      return null;
    }
    return (
      <BracketWizard
        user={user}
        onCancel={() => window.location.hash = '#participant'}
        onSuccess={(poolId) => {
          window.location.hash = `#admin/${poolId}`;
        }}
      />
    );
  }

  if (route.view === 'support') {
    return <SupportPage />;
  }

  if (route.view === 'profile') {
    if (!user) { window.location.hash = '#'; return null; }
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
        <Header
          user={user}
          isManager={isManager}
          onOpenAuth={() => setShowAuthModal(true)}
          onLogout={authService.logout}
          onCreatePool={handleCreatePool}
        />
        <main className="max-w-4xl mx-auto p-6 mt-10">
          <UserProfile
            user={user}
            onUpdate={(updatedUser) => {
              setUser(updatedUser);
              dbService.saveUser(updatedUser);
            }}
          />
        </main>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        <Footer />
      </div>
    );
  }

  if (route.view === 'pool') {
    if (isPoolsLoading || isSinglePoolLoading) return <div className="text-white p-10 flex flex-col items-center gap-4"><Loader className="animate-spin text-indigo-500" size={48} /><p>Loading Pool...</p></div>;
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
                  <span className="text-emerald-400">{(p.type === 'BRACKET' ? p.slug : p.urlSlug) || 'NO_SLUG'}</span>
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



    if (currentPool.type === 'BRACKET') {
      return (
        <BracketPoolDashboard
          pool={currentPool}
          user={user}
          onBack={() => window.location.hash = '#'}
          onShare={() => {
            navigator.clipboard.writeText(window.location.href);
            alert("Link copied!");
          }}
        />
      );
    }

    const squaresPool = currentPool as GameState;

    // Password Check (Public Pools w/ Password)
    if (squaresPool.gridPassword && !isUnlocked) {
      return renderPasswordGate();
    }

    const homeLogo = squaresPool.homeTeamLogo || getTeamLogo(squaresPool.homeTeam);
    const awayLogo = squaresPool.awayTeamLogo || getTeamLogo(squaresPool.awayTeam);
    const homePredictions = calculateScenarioWinners(squaresPool, 'home');
    const awayPredictions = calculateScenarioWinners(squaresPool, 'away');
    const squaresRemaining = 100 - squaresPool.squares.filter(s => s.owner).length;
    const latestWinner = winners.length > 0 ? winners[winners.length - 1].owner : null;


    return (
      <div
        className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-20 relative transition-colors duration-500"
        style={{ backgroundColor: squaresPool.branding?.backgroundColor || '#020617' }} // Default Slate-950 equivalent
      >
        <Header user={user} onOpenAuth={() => setShowAuthModal(true)} onLogout={authService.logout} onCreatePool={handleCreatePool} />
        <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />
        {/* Header Content */}
        <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
          <div className="text-center md:text-left">
            <div className="flex items-center gap-3 mb-1">
              {squaresPool.branding?.logoUrl && (
                <img src={squaresPool.branding.logoUrl} className="h-16 w-auto object-contain drop-shadow-lg" alt="Pool Logo" />
              )}
              <h1 className="text-3xl font-bold text-white">{squaresPool.name}</h1>
              <button onClick={() => setShowAudit(true)} className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                <Shield size={10} className="fill-emerald-400/20" /> Fully Auditable
              </button>
            </div>
            <p className="text-slate-400 text-sm font-medium">{squaresRemaining} Squares Remaining</p>
          </div>
          <div className="flex gap-2">
            {user && (user.id === squaresPool.ownerId || user.role === 'SUPER_ADMIN') && (
              <a href={`/#admin/${squaresPool.id}`} className="bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
                <Edit2 size={16} /> Manage Pool
              </a>
            )}
            {!user && (
              <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="hidden md:block bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                Sign In to Manage Your Pool
              </button>
            )}
            <button onClick={() => openShare(squaresPool.id)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Share</button>
          </div>
        </div>



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
        <div className="max-w-[1400px] mx-auto px-4 py-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-400 font-black uppercase text-xl tracking-wider">Pool Details</h3>
            <button
              onClick={() => setShowPoolInfo(!showPoolInfo)}
              className="bg-slate-900 hover:bg-slate-800 text-slate-400 p-2 rounded-full transition-colors"
              aria-label={showPoolInfo ? "Collapse Info" : "Expand Info"}
            >
              {showPoolInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          <div className={`transition-all duration-500 ease-in-out overflow-hidden ${showPoolInfo ? 'max-h-[1000px] opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${squaresPool.charity?.enabled ? 'lg:grid-cols-3' : 'lg:grid-cols-2 max-w-5xl mx-auto'}`}>
              {/* 1. Status Card (Tabbed) */}
              <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
                {/* Tabs Header */}
                <div className="flex border-b border-slate-800">
                  <button
                    onClick={() => setStatusTab('overview')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'overview' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                  >
                    Overview
                  </button>
                  <button
                    onClick={() => setStatusTab('rules')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'rules' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                  >
                    Rules
                  </button>
                  <button
                    onClick={() => setStatusTab('payment')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'payment' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                  >
                    Payment
                  </button>
                </div>

                {/* Tab Content */}
                <div className="p-6 flex-1 flex flex-col justify-center">

                  {statusTab === 'overview' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                      <div>
                        <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Status:</h3>
                        {(() => {
                          if (!squaresPool.isLocked) return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span>
                              <div><p className="text-emerald-400 font-bold text-sm leading-none">Open</p><p className="text-slate-500 text-[10px]">Grid is available to choose squares</p></div>
                            </div>
                          );
                          const status = squaresPool.scores.gameStatus;
                          const isFinal = status === 'post' || !!squaresPool.scores.final;
                          const isLive = status === 'in';
                          if (isFinal) return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3"><span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>
                              <div><p className="text-blue-500 font-bold text-sm leading-none">Locked - Final</p><p className="text-slate-500 text-[10px]">Game has completed</p></div>
                            </div>
                          );
                          if (isLive) return (
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span></span>
                              <div><p className="text-rose-500 font-bold text-sm leading-none">Locked - Live</p><p className="text-slate-500 text-[10px]">Game has started</p></div>
                            </div>
                          );
                          return (
                            <div className="flex items-center gap-2">
                              <Lock size={14} className="text-amber-500" />
                              <div><p className="text-amber-500 font-bold text-sm leading-none">Locked - Pending</p><p className="text-slate-500 text-[10px]">Waiting for kickoff</p></div>
                            </div>
                          );
                        })()}
                      </div>
                      <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Grid Owner:</h3><p className="text-white font-medium">{currentPool.contactEmail || 'Admin'}</p></div>
                      <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Cost Per Square:</h3><p className="text-white font-medium text-sm">${currentPool.costPerSquare}</p></div>
                    </div>
                  )}

                  {statusTab === 'rules' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      {/* Countdown Timer */}
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                        <PoolTimer
                          targetDate={squaresPool.scores.startTime}
                          gameStatus={squaresPool.scores.gameStatus}
                          isLocked={squaresPool.isLocked}
                        />
                      </div>

                      <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Limits:</h3><p className="text-white font-medium text-sm">Max {currentPool.maxSquaresPerPlayer} squares per player</p></div>

                      {/* NEW: Score Change Rule Explanation */}
                      {squaresPool.ruleVariations.scoreChangePayout && (
                        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-3 text-sm">
                          <h4 className="text-emerald-400 font-bold uppercase text-xs mb-1 flex items-center gap-1">
                            <Trophy size={12} /> Every Score Pays Rule
                          </h4>
                          <p className="text-slate-300 text-xs leading-relaxed">
                            This pool pays out whenever the score changes.
                            {squaresPool.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? (
                              <span> <strong>Equal Split:</strong> The total prize pot is divided equally among all scoring events.</span>
                            ) : squaresPool.ruleVariations.scoreChangePayoutStrategy === 'hybrid' ? (
                              <span> <strong>Hybrid Split:</strong> Weighted payouts for Final/Halftime, with the remainder split among all other scores.</span>
                            ) : (
                              <span> A fixed amount of <strong>${squaresPool.scoreChangePayoutAmount}</strong> is deducted from the pot for each score.</span>
                            )}
                            <br />
                            <span className="text-slate-500 italic mt-1 block">
                              Winning square is determined by the last digits of the NEW score.
                            </span>
                          </p>
                        </div>
                      )}

                      <div>
                        <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Active Rules:</h3>
                        <div className="flex flex-col gap-2 items-start">
                          <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left">
                            {currentPool.ruleVariations.quarterlyRollover ? (
                              <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">
                                <Zap size={12} className="fill-emerald-400" /> Rollover Active
                              </div>
                            ) : (
                              <div className="bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded text-xs font-bold">Standard Payouts</div>
                            )}
                            <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
                          </button>

                          {currentPool.ruleVariations.reverseWinners && (
                            <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left mt-1">
                              <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ml-0.5">
                                <Zap size={12} className="fill-indigo-400" /> Reverse Winners Active
                              </div>
                              <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
                            </button>
                          )}

                          {squaresPool.numberSets === 4 && (
                            <button onClick={() => setShowRulesModal(true)} title="New random numbers are generated for every quarter (4 sets total)." className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left mt-1">
                              <div className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ml-0.5">
                                <Shuffle size={12} className="text-blue-400" /> 4 Sets (Quarterly Numbers)
                              </div>
                              <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {statusTab === 'payment' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                      {(currentPool.paymentHandles?.venmo || currentPool.paymentHandles?.googlePay) ? (
                        <div>
                          <h3 className="text-slate-500 font-bold uppercase text-xs mb-2">Payment Options:</h3>
                          <div className="flex flex-col gap-2">
                            {currentPool.paymentHandles?.venmo && (
                              <a href={`https://venmo.com/u/${currentPool.paymentHandles.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center transition-colors w-full">
                                Venmo: {currentPool.paymentHandles.venmo} <ExternalLink size={14} />
                              </a>
                            )}
                            {currentPool.paymentHandles?.googlePay && (
                              <div className="bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center w-full">
                                <span className="text-slate-400 text-xs uppercase mr-1">GPay:</span> {currentPool.paymentHandles.googlePay}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-500 text-xs italic">No digital payment methods configured.</div>
                      )}

                      <div className="border-t border-slate-800 pt-3">
                        <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Instructions:</h3>
                        <p className="text-slate-300 text-sm leading-relaxed max-h-32 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                          {squaresPool.paymentInstructions || "No additional instructions."}
                        </p>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* Charity Card (Moved to Top Row if enabled, sharing grid) */}
              {squaresPool.charity?.enabled && (
                <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-6 shadow-lg shadow-rose-500/10 relative overflow-hidden flex flex-col justify-center">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Heart size={80} className="text-rose-500" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="bg-rose-500/20 p-1.5 rounded-lg">
                        <Heart size={18} className="text-rose-400" />
                      </div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Proudly Supporting</h3>
                    </div>
                    <h2 className="text-2xl font-black text-rose-400 mb-1 leading-tight">{squaresPool.charity.name}</h2>
                    <div className="mt-3">
                      <span className="text-xs text-slate-500 uppercase font-bold block mb-1">Donation Amount</span>
                      <span className="text-2xl font-mono font-bold text-white">
                        ${(Math.floor((squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare * (squaresPool.charity.percentage / 100)))).toLocaleString()}
                      </span>
                      {squaresPool.charity.url && (
                        <a
                          href={squaresPool.charity.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-rose-400 hover:text-white font-bold text-xs flex items-center gap-1 mt-2 transition-colors"
                        >
                          Learn More <ArrowRight size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Payout Structure Card - Updated Logic */}
              <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
                <div className="flex border-b border-slate-800 bg-slate-900 px-6 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Payout Structure</h3>
                </div>

                <div className="p-6 flex-1 flex flex-col justify-center">
                  <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="space-y-3">
                      {/* Total Collected */}
                      <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                        <span className="text-slate-400">Total Pot</span>
                        <span className="text-white font-mono font-bold">
                          ${(currentPool.squares.filter((s: any) => s.owner).length * currentPool.costPerSquare).toLocaleString()}
                        </span>
                      </div>

                      {/* Charity Deduction Line */}
                      {currentPool.charity?.enabled && (
                        <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2 text-rose-300">
                          <span className="flex items-center gap-1"><Heart size={12} /> Less Donation ({currentPool.charity.percentage}%)</span>
                          <span className="font-mono font-bold">
                            -${(Math.floor((currentPool.squares.filter((s: any) => s.owner).length * currentPool.costPerSquare * (currentPool.charity.percentage / 100)))).toLocaleString()}
                          </span>
                        </div>
                      )}

                      {/* Net Prize Pot */}
                      <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-2 mb-2">
                        <span className="text-white font-bold">Net Prize Pool</span>
                        <span className="text-emerald-400 font-mono font-bold text-lg">
                          ${(Math.floor((currentPool.squares.filter((s: any) => s.owner).length * currentPool.costPerSquare * (1 - (currentPool.charity?.enabled ? currentPool.charity.percentage / 100 : 0))))).toLocaleString()}
                        </span>
                      </div>

                    </div>
                    <div className="space-y-1">
                      {quarterlyPayouts
                        .filter(card => {
                          // Hybrid Strategy: Only show Half and Final cards
                          if ((squaresPool as GameState).ruleVariations.scoreChangePayout && (squaresPool as GameState).ruleVariations.scoreChangePayoutStrategy === 'hybrid') {
                            return card.period === 'half' || card.period === 'final';
                          }
                          // Equal Split: Hide all fixed period cards (all are event based)
                          if ((squaresPool as GameState).ruleVariations.scoreChangePayout && (squaresPool as GameState).ruleVariations.scoreChangePayoutStrategy === 'equal_split') {
                            return false;
                          }
                          // Standard: Show all 4
                          return true;
                        })
                        .map((card) => {
                          const percent = squaresPool.payouts[card.period as keyof typeof squaresPool.payouts];
                          // allow 0% if it's a major prize in Hybrid mode? OR just rely on logic above.
                          // Existing logic checks if (!percent) return null. 
                          // In Hybrid, Half/Final have weights in `scoreChangeHybridWeights`, not necessarily `payouts` object (which is for standard).
                          // We need to ensure we display the correct "Potential Prize" for hybrid cards. 
                          // Currently `quarterlyPayouts` calculation handles this via `baseAmount`.

                          if (!percent && !(squaresPool as GameState).ruleVariations.scoreChangePayout) return null;

                          return (
                            <div key={card.period} className="flex justify-between items-center text-sm">
                              <span className="text-slate-400 font-bold">{card.label}
                                <span className="text-slate-600 font-normal ml-1">
                                  {(squaresPool as GameState).ruleVariations.scoreChangePayoutStrategy === 'hybrid'
                                    ? `(${(squaresPool as GameState).ruleVariations.scoreChangeHybridWeights?.[card.period === 'half' ? 'halftime' : 'final'] || 0}%)`
                                    : `(${percent}%)`}
                                </span>
                              </span>
                              <div className="flex flex-col items-end">
                                <span className="text-white font-mono font-bold">
                                  ${(card.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                </span>
                                {card.rolloverAdded > 0 && <span className="text-[10px] text-emerald-500 font-bold">Includes Rollover</span>}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Win Report Block Removed */}
                </div>
              </div>
            </div>
          </div>

          {/* SCOREBOARD (Full Width Row) */}
          <div className="bg-black rounded-xl border border-slate-800 p-0 shadow-xl overflow-hidden relative mb-8 max-w-4xl mx-auto">
            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/20 rounded-full blur-3xl"></div>
            <div className="p-4 border-b border-slate-800 text-center relative z-10 flex flex-col md:flex-row items-center justify-between px-8">
              <h3 className="text-white font-bold text-xl tracking-tight">Game Scoreboard</h3>
              {/* Game Status Info */}
              {(() => {
                const { gameStatus, startTime, clock, period } = squaresPool.scores;

                // Live Game
                if (gameStatus === 'in') {
                  const pLabel = period === 1 ? '1st' : period === 2 ? '2nd' : period === 3 ? '3rd' : period === 4 ? '4th' : 'OT';
                  return <div className="text-emerald-400 font-bold uppercase tracking-wider animate-pulse flex items-center gap-2 text-sm"><span className="w-2 h-2 bg-emerald-400 rounded-full"></span> Live • {pLabel} Qtr • {clock || '0:00'}</div>;
                }

                // Final Game
                if (gameStatus === 'post') {
                  return <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Final Score</p>;
                }

                // Default / Pre-Game
                if (startTime) {
                  const dateObj = new Date(startTime);
                  const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
                  const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
                  return <p className="text-sm text-slate-500 font-bold uppercase tracking-wider">{dateStr} • {timeStr}</p>;
                }

                // Fallback / Sync Status
                if (syncStatus === 'searching') return <p className="text-sm text-indigo-400 font-bold uppercase tracking-wider animate-pulse">Searching for Game...</p>;
                if (syncStatus === 'not-found') return <p className="text-sm text-rose-500 font-bold uppercase tracking-wider" title="Ensure Home/Away teams match ESPN names">No Active Game Found</p>;
                if (syncStatus === 'found' && !startTime) return <p className="text-sm text-amber-500 font-bold uppercase tracking-wider">Game Matched • Time TBD</p>;

                return <p className="text-sm text-slate-600 font-bold uppercase tracking-wider">Status: Pending (Idle)</p>;
              })()}
            </div>

            {/* Scoreboard Grid */}
            <div className="p-6">
              <div className="grid grid-cols-7 gap-4 text-center text-slate-500 font-bold uppercase text-xs mb-3">
                <div className="col-span-2 text-left pl-4">Team</div>
                <div>1</div><div>2</div><div>3</div><div>4</div><div>T</div>
              </div>

              {/* Away Team Row */}
              <div className="grid grid-cols-7 gap-4 text-center text-white font-bold items-center mb-3 bg-slate-900 p-4 rounded-lg border border-slate-800/50">
                <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                  {awayLogo ? <img src={awayLogo} className="w-10 h-10 object-contain drop-shadow-md" /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{squaresPool.awayTeam.charAt(0)}</div>}
                  <span className="text-lg">{squaresPool.awayTeam}</span>
                </div>
                <div className="text-xl text-slate-400">{getScoreboardVal(1, 'away')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(2, 'away')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(3, 'away')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(4, 'away')}</div>
                <div className="text-3xl text-indigo-400 font-black">{sanitize(squaresPool.scores.current?.away)}</div>
              </div>

              {/* Home Team Row */}
              <div className="grid grid-cols-7 gap-4 text-center text-white font-bold items-center bg-slate-900 p-4 rounded-lg border border-slate-800/50">
                <div className="col-span-2 text-left pl-2 flex items-center gap-3">
                  {homeLogo ? <img src={homeLogo} className="w-10 h-10 object-contain drop-shadow-md" /> : <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-xs">{squaresPool.homeTeam.charAt(0)}</div>}
                  <span className="text-lg">{squaresPool.homeTeam}</span>
                </div>
                <div className="text-xl text-slate-400">{getScoreboardVal(1, 'home')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(2, 'home')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(3, 'home')}</div>
                <div className="text-xl text-slate-400">{getScoreboardVal(4, 'home')}</div>
                <div className="text-3xl text-rose-400 font-black">{sanitize(squaresPool.scores.current?.home)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Grid Component */}
        <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col items-center">
          <div className="flex items-center gap-4 w-full justify-center">
            {/* Away Logo (Left - Matches Rows) */}
            <div className="hidden md:flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-indigo-900/20 rounded-full flex items-center justify-center border-2 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)] bg-white p-1">
                {awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" /> : <span className="text-indigo-400 font-bold text-xl">{squaresPool.awayTeam.substring(0, 2).toUpperCase()}</span>}
              </div>
            </div>
            {/* Grid */}
            <div className="flex-1 overflow-x-auto">
              <Grid
                gameState={squaresPool}
                onClaimSquares={(ids, name, details, guestKey) => handleClaimSquares(ids, name, details, guestKey)}
                winners={winners}
                highlightHomeDigit={getLastDigit(squaresPool.scores.current?.home ?? 0)}
                highlightAwayDigit={getLastDigit(squaresPool.scores.current?.away ?? 0)}
                currentUser={user}
                onLogin={() => { setAuthMode('login'); setShowAuthModal(true); }}
                onCreateClaimCode={(k) => dbService.createClaimCode(squaresPool.id, k)}
                onClaimByCode={(c) => dbService.claimByCode(c)}
              />
            </div>
            {/* Home Logo (Right - Matches Cols) */}
            <div className="hidden md:flex flex-col items-center gap-2">
              <div className="w-16 h-16 bg-rose-900/20 rounded-full flex items-center justify-center border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] bg-white p-1">
                {homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" /> : <span className="text-rose-400 font-bold text-xl">{squaresPool.homeTeam.substring(0, 2).toUpperCase()}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* WHAT IF SCENARIOS */}
        <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 xl:grid-cols-2 gap-8 items-start mb-8">
          <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{awayLogo && <img src={awayLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-indigo-400 font-bold">{squaresPool.awayTeam}</span> score next...</h3></div>
            <div className="bg-slate-950 p-4 space-y-4">{awayPredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-indigo-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
          </div>
          <div className="border border-amber-500/30 rounded-xl p-0 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-slate-800 flex items-center gap-2">{homeLogo && <img src={homeLogo} className="w-8 h-8 object-contain" />}<h3 className="text-amber-400 font-medium text-sm">If the <span className="text-rose-400 font-bold">{squaresPool.homeTeam}</span> score next...</h3></div>
            <div className="bg-slate-950 p-4 space-y-4">{homePredictions.map((pred) => (<div key={pred.points} className="flex justify-between items-center group border-b border-slate-800/50 pb-2 last:border-0 last:pb-0"><div><span className="block text-slate-300 font-bold text-sm group-hover:text-rose-400 transition-colors">+{pred.points} points</span><span className="text-[10px] text-slate-500">New digit: {pred.newDigit}</span></div><span className="text-white font-bold text-sm">{pred.owner}</span></div>))}</div>
          </div>
        </div>


        {/* BOTTOM Payout Cards */}
        {
          (!(squaresPool as GameState).ruleVariations.scoreChangePayout || (squaresPool as GameState).ruleVariations.scoreChangePayoutStrategy !== 'equal_split') && (
            <div className="max-w-[1400px] mx-auto px-4 mb-10">
              <div className="flex flex-wrap justify-center gap-6">
                {quarterlyPayouts
                  .filter(card => {
                    if ((squaresPool as GameState).ruleVariations.scoreChangePayout && (squaresPool as GameState).ruleVariations.scoreChangePayoutStrategy === 'hybrid') {
                      return card.period === 'half' || card.period === 'final';
                    }
                    return true;
                  })
                  .map((card, idx) => {
                    return (
                      <div key={idx} className="bg-black border border-slate-800 rounded-xl p-6 text-center shadow-lg relative overflow-hidden group w-full md:w-[320px]">
                        <div className={`absolute top-0 w-full h-1 opacity-20 group-hover:opacity-50 transition-opacity ${card.isLocked ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                        <h4 className="text-slate-400 font-bold text-sm uppercase mb-4">{card.label}</h4>
                        <div className="flex justify-center gap-4 text-white font-bold text-2xl mb-2 items-center">
                          <span>{card.home}</span> <span className="text-slate-600">-</span> <span>{card.away}</span>
                        </div>

                        {/* Winning Digits Display */}
                        <div className="flex justify-center gap-6 mb-4 bg-slate-900/50 py-1.5 rounded border border-slate-800/50">
                          <div className="flex flex-col items-center">
                            <span className="text-[9px] text-rose-400/80 uppercase font-bold tracking-wider">Home Digit</span>
                            <span className="font-mono text-lg font-bold text-white leading-none mt-0.5">{card.home !== undefined ? getLastDigit(card.home) : '-'}</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <span className="text-[9px] text-indigo-400/80 uppercase font-bold tracking-wider">Away Digit</span>
                            <span className="font-mono text-lg font-bold text-white leading-none mt-0.5">{card.away !== undefined ? getLastDigit(card.away) : '-'}</span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mb-6 font-medium">This Quarter: {card.qPointsHome} - {card.qPointsAway}</p>
                        <div className="mb-4">
                          <p className="text-xs text-slate-400 uppercase font-bold mb-1">In the money:</p>
                          {card.isRollover ? (
                            <p className="text-emerald-400 font-bold text-lg italic flex items-center justify-center gap-1"><Zap size={16} fill="currentColor" /> Rollover</p>
                          ) : (
                            <p className="text-white font-bold text-lg">{card.winnerName}</p>
                          )}
                          {card.reverseWinnerName && (
                            <div className="mt-1 flex flex-col items-center">
                              <span className="text-[10px] text-slate-500">AND (Reverse)</span>
                              <span className="text-indigo-300 font-bold text-sm">{card.reverseWinnerName}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-center mb-4">
                          {card.isRollover ? (
                            <div className="text-slate-500 font-mono font-bold text-sm uppercase">Accumulating...</div>
                          ) : (
                            <>
                              <div className="text-2xl font-bold font-mono text-emerald-400">${(card.amount || 0).toLocaleString()}</div>
                              {card.rolloverAdded > 0 && <span className="text-[10px] text-emerald-500 font-bold">(Includes ${card.rolloverAdded} Rollover)</span>}
                            </>
                          )}
                        </div>

                        {/* Payout Status Control */}
                        {card.winnerName && card.winnerName !== 'Unsold' && (
                          <div className="mb-4">
                            {card.isPaid ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                                  <Check size={10} strokeWidth={4} /> Paid
                                </span>
                                {isManager && (
                                  <button
                                    onClick={() => dbService.updateWinnerPaidStatus(currentPool.id, card.label.toLowerCase(), false)}
                                    className="text-slate-500 hover:text-white text-[10px] underline"
                                  >Undo</button>
                                )}
                              </div>
                            ) : (
                              isManager && (
                                <button
                                  onClick={() => dbService.updateWinnerPaidStatus(currentPool.id, card.label.toLowerCase(), true)}
                                  className="text-slate-500 hover:text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-slate-700 hover:border-emerald-500 px-2 py-1 rounded transition-colors"
                                >
                                  Mark Paid
                                </button>
                              )
                            )}
                          </div>
                        )}

                        {card.isLocked ? <Lock size={20} className="text-rose-500/50 mx-auto" /> : <Unlock size={20} className="text-emerald-500/30 mx-auto" />}
                      </div>
                    );
                  })}
              </div>
            </div>
          )
        }

        {/* Score Change History Table (For 'Every Score Pays' pools) */}
        {(squaresPool as GameState).ruleVariations.scoreChangePayout && (
          <div className="max-w-[1400px] mx-auto px-4 mb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-slate-400 font-bold text-sm uppercase mb-4 text-center">Score Change History</h3>
            <div className="w-full overflow-hidden rounded-lg border border-slate-800 bg-black">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Winner</th>
                    <th className="px-4 py-3 text-right">Prize</th>
                    {isManager && <th className="px-4 py-3 text-center">Paid</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {winners.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500 italic">No score changes yet.</td></tr>
                  ) : (
                    winners.map((win, idx) => (
                      <tr key={`${win.period}-${win.squareId}-${idx}`} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-300">
                          {win.period === 'Event' || win.period === 'Bonus' ? (
                            <div className="flex flex-col">
                              <span className="text-emerald-400 font-bold text-xs uppercase">{win.description?.split(':')[0]}</span>
                              <span className="text-[10px] text-slate-500 truncate">{win.description?.split(':')[1] || win.description}</span>
                            </div>
                          ) : (
                            <span className="text-white font-bold">{PERIOD_LABELS[win.period] || win.period}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {win.isRollover ? (
                            <span className="text-emerald-400 font-bold italic flex items-center gap-1">Rollover</span>
                          ) : win.owner === 'Unsold' || win.owner === 'Unsold (House)' ? (
                            <span className="text-slate-500">{win.owner}</span>
                          ) : (
                            <span className="text-white font-bold">{win.owner}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span className="text-emerald-400 font-bold">${(win.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                        </td>
                        {isManager && (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => dbService.updateWinnerPaidStatus(currentPool.id, win.id, !win.isPaid, user?.id)}
                              className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${win.isPaid ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-emerald-500'}`}
                              title={win.isPaid ? `Paid on ${new Date(win.paidAt).toLocaleDateString()}` : 'Mark as paid'}
                            >
                              {win.isPaid && <Check size={14} />}
                            </button>
                          </td>
                        )}
                      </tr>
                    )))}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* AI COMMISSIONER */}
        <div className="max-w-[1400px] mx-auto px-4 mb-20">
          <AICommissioner poolId={currentPool.id} userId={user?.id} />
        </div>

        {/* Rules Explanation Modal */}
        {
          showRulesModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
              <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl shadow-2xl max-w-md w-full relative">
                <button onClick={() => setShowRulesModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={20} /></button>
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Shield size={20} className="text-emerald-400" /> Unclaimed Prize Rules
                </h3>

                <div className="space-y-4">
                  <div className={`p-4 rounded-lg border ${currentPool.ruleVariations.quarterlyRollover ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-950 border-slate-800'}`}>
                    <h4 className={`font-bold text-sm mb-1 ${currentPool.ruleVariations.quarterlyRollover ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {currentPool.ruleVariations.quarterlyRollover ? '✅ Quarterly Rollover is ON' : 'Standard Rules (No Rollover)'}
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {currentPool.ruleVariations.quarterlyRollover
                        ? "If a winning square is empty for Q1, Half, or Q3, the prize money automatically rolls over to the next quarter's pot. This creates bigger jackpots for later winners!"
                        : "If a winning square is empty, the prize is typically kept by the house or split among other winners (see Manager instructions)."}
                    </p>
                  </div>

                  {currentPool.ruleVariations.reverseWinners && (
                    <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                      <h4 className="font-bold text-sm text-indigo-400 mb-1">🔄 Reverse Winners is ON</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Every prize is <strong>SPLIT 50/50</strong> between the standard winner and the "Reverse" winner (swapping the Home and Away digits). Double the winners, double the fun!
                      </p>
                    </div>
                  )}

                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                    <h4 className="font-bold text-sm text-slate-300 mb-1">Final Prize Strategy</h4>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${currentPool.ruleVariations.unclaimedFinalPrizeStrategy === 'random' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-400'}`}>
                        {currentPool.ruleVariations.unclaimedFinalPrizeStrategy === 'random' ? 'Random Draw' : 'Last Winner'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {currentPool.ruleVariations.unclaimedFinalPrizeStrategy === 'random'
                        ? "If the final square is empty, the Commissioner will activate the site's 'Randomizer' function to determine a winner. The system will randomly select a winner from all occupied squares."
                        : "If the final square is empty, the prize reverts to the most recent previous winner (e.g. 3rd Quarter)."}
                    </p>
                  </div>

                  <div className="flex items-start gap-2 p-3 bg-slate-950 rounded border border-slate-800">
                    <Shield size={14} className="text-slate-500 mt-0.5" />
                    <p className="text-[10px] text-slate-500 leading-tight">
                      <strong className="text-slate-400">Audit Verified:</strong> All automated decisions, including rollover calculations and random winner selections, are securely recorded in the <span className="font-mono text-emerald-500">Immutable Audit Log</span>.
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
                  <button onClick={() => setShowRulesModal(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold rounded-lg transition-colors">
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )
        }

        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
        {showAudit && <AuditLog poolId={currentPool.id} onClose={() => setShowAudit(false)} />}

        {/* Winner Celebration Sound Effect */}
        <audio id="winner-sound" preload="auto" src="https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3" />

        <Footer />
      </div >
    );
  }

  return <div>Loading...</div>;
};

export default App;