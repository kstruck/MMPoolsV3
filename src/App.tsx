import React, { useState, useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';

// Eagerly loaded components (needed on first paint)
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LandingPage } from './components/LandingPage';
import { RouteSEO } from './components/RouteSEO';
import { AuthModal } from './components/modals';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { useToast } from './components/ui/Toast';
import { PoolTypeGate } from './components/PoolTypeGate';

// Lazy-loaded route components (loaded on demand)
const GamedaySquaresLanding = React.lazy(() => import('./components/GamedaySquaresLanding').then(m => ({ default: m.GamedaySquaresLanding })));
const CreatePoolSelection = React.lazy(() => import('./components/CreatePoolSelection').then(m => ({ default: m.CreatePoolSelection })));
const BrowsePools = React.lazy(() => import('./components/BrowsePools').then(m => ({ default: m.BrowsePools })));
const ParticipantDashboard = React.lazy(() => import('./components/ParticipantDashboard').then(m => ({ default: m.ParticipantDashboard })));
const FeaturesPage = React.lazy(() => import('./components/FeaturesPage').then(m => ({ default: m.FeaturesPage })));
const PrivacyPage = React.lazy(() => import('./components/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = React.lazy(() => import('./components/TermsPage').then(m => ({ default: m.TermsPage })));
const HowItWorksPage = React.lazy(() => import('./components/HowItWorksPage').then(m => ({ default: m.HowItWorksPage })));
const UserProfile = React.lazy(() => import('./components/UserProfile').then(m => ({ default: m.UserProfile })));
const Scoreboard = React.lazy(() => import('./components/Scoreboard').then(m => ({ default: m.Scoreboard })));
const SuperBowlOddsArticle = React.lazy(() => import('./components/articles/SuperBowlOddsArticle').then(m => ({ default: m.SuperBowlOddsArticle })));
const MarchMadnessLanding = React.lazy(() => import('./components/MarchMadnessLanding').then(m => ({ default: m.MarchMadnessLanding })));
const NFLPlayoffsLanding = React.lazy(() => import('./components/NFLPlayoffsLanding').then(m => ({ default: m.NFLPlayoffsLanding })));
const PricingPage = React.lazy(() => import('./components/PricingPage').then(m => ({ default: m.PricingPage })));
const PaymentSuccess = React.lazy(() => import('./pages/PaymentSuccess').then(m => ({ default: m.PaymentSuccess })));
const AboutPage = React.lazy(() => import('./components/AboutPage').then(m => ({ default: m.AboutPage })));
const CharityPage = React.lazy(() => import('./components/CharityPage').then(m => ({ default: m.CharityPage })));
const AuthActionHandler = React.lazy(() => import('./components/AuthActionHandler').then(m => ({ default: m.AuthActionHandler })));
const ContactPage = React.lazy(() => import('./components/ContactPage').then(m => ({ default: m.ContactPage })));

// Lazy-loaded routes
const PoolRoute = React.lazy(() => import('./components/routes/PoolRoute').then(m => ({ default: m.PoolRoute })));
const AdminRoute = React.lazy(() => import('./components/routes/AdminRoute').then(m => ({ default: m.AdminRoute })));

// Lazy-loaded wizards
const BracketWizard = React.lazy(() => import('./components/BracketWizard/BracketWizard').then(m => ({ default: m.BracketWizard })));
const PlayoffWizard = React.lazy(() => import('./components/PlayoffPool/PlayoffWizard').then(m => ({ default: m.PlayoffWizard })));
const PropsWizard = React.lazy(() => import('./components/PropsWizard/PropsWizard').then(m => ({ default: m.PropsWizard })));
const SetupWizard = React.lazy(() => import('./components/SetupWizard').then(m => ({ default: m.SetupWizard })));
const NFLPoolWizard = React.lazy(() => import('./components/NFLPoolWizard/NFLPoolWizard').then(m => ({ default: m.NFLPoolWizard })));
const JoinPool = React.lazy(() => import('./components/JoinPool').then(m => ({ default: m.JoinPool })));

// Lazy-loaded admin
const SuperAdmin = React.lazy(() => import('./components/SuperAdmin').then(m => ({ default: m.SuperAdmin })));
const TournamentSimulator = React.lazy(() => import('./components/TournamentSimulator/TournamentSimulator').then(m => ({ default: m.TournamentSimulator })));

// Services & Objects
import { authService } from './services/authService';
import { dbService, type GlobalStats } from './services/dbService';
import type { User, Pool } from './types';
import { isSuperAdmin } from './utils/auth';
import { logger } from './utils/logger';

// Loading spinner for lazy-loaded routes
const RouteLoader = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center">
    <Loader className="animate-spin text-indigo-500 w-8 h-8" />
  </div>
);

// Legacy Hash Handler - redirects old hash-based URLs to clean URLs
const LegacyHashHandler = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      logger.log('Migrating legacy hash:', hash);
      const cleanHash = hash.substring(1); // remove #
      let targetPath: string | null = null;

      // Routes mapping
      if (cleanHash === 'home') targetPath = '/';
      else if (cleanHash === 'browse') targetPath = '/browse';
      else if (cleanHash === 'participant' || cleanHash === 'dashboard') targetPath = '/participant';
      else if (cleanHash === 'create-pool') targetPath = '/create-pool';
      else if (cleanHash === 'features') targetPath = '/features';
      else if (cleanHash === 'how-it-works') targetPath = '/how-it-works';
      else if (cleanHash === 'terms') targetPath = '/terms';
      else if (cleanHash === 'privacy') targetPath = '/privacy';
      else if (cleanHash === 'scoreboard') targetPath = '/scoreboard';
      else if (cleanHash === 'super-bowl-squares-odds') targetPath = '/odds/super-bowl-squares';
      else if (cleanHash === 'bracket-pool-guide') targetPath = '/articles/bracket-pool-guide';
      else if (cleanHash === 'super-admin') targetPath = '/super-admin';

      // Dynamic Routes
      else if (cleanHash.startsWith('pool/')) {
        const id = cleanHash.split('/')[1];
        targetPath = `/pool/${id}`;
      } else if (cleanHash.startsWith('admin/')) {
        const id = cleanHash.split('/')[1];
        targetPath = `/admin/${id}`;
      } else if (cleanHash === 'admin') {
        targetPath = '/admin';
      }

      // Wizards
      else if (cleanHash === 'bracket-wizard') targetPath = '/bracket-wizard';
      else if (cleanHash === 'props-wizard') targetPath = '/props-wizard';
      else if (cleanHash === 'playoff-wizard') targetPath = '/playoff-wizard';
      else if (cleanHash === 'grid-wizard' || cleanHash === 'wizard') targetPath = '/grid-wizard';

      // Navigate and clear the hash
      if (targetPath) {
        // Clear the hash from the URL first, then navigate
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        navigate(targetPath, { replace: true });
      }
    }
  }, [navigate]); // Run once on mount

  return null;
};


const App: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  // Global State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [pools, setPools] = useState<Pool[]>([]);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Auth Subscription
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((u) => {
      setUser(u);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Pools Subscription
  useEffect(() => {
    const unsubscribe = dbService.subscribeToPools((updatedPools: Pool[]) => {
      setPools(updatedPools);
    });
    return () => unsubscribe();
  }, []);

  // Referral Token Parsing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      authService.storeReferralCode(ref);
      // Clean up URL if desired
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('ref');
      window.history.replaceState(null, '', newUrl.toString());
    }
  }, []);

  // Global Stats Subscription
  const [stats, setStats] = useState<GlobalStats | null>(null);
  useEffect(() => {
    const unsubscribe = dbService.onGlobalStatsUpdate((newStats) => {
      setStats(newStats);
    });
    return () => unsubscribe();
  }, []);

  // Auth Helpers
  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthMode(mode);
    setShowAuthModal(true);
  };
  const handleLogout = async () => {
    await authService.logout();
    navigate('/');
  };

  // Pool Creation Handlers
  const handleCreatePoolClick = () => navigate('/create-pool');

  const checkAccess = () => {
    if (!user) {
      handleOpenAuth('register');
      return false;
    }
    return true;
  };

  const handleSquaresPoolCreate = () => {
    if (!checkAccess()) return;
    navigate('/grid-wizard');
  };

  const isAdmin = isSuperAdmin(user);

  if (isAuthLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-100"><Loader className="animate-spin text-indigo-500" /></div>;
  }

  return (
    <>
      <LegacyHashHandler />
      <RouteSEO />
      <OfflineBanner />
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          {/* Landing / Home */}
          <Route path="/" element={
            <>
              <LandingPage
                user={user}
                isLoggedIn={!!user}
                onLogin={() => handleOpenAuth('login')}
                onSignup={() => handleOpenAuth('register')}
                onLogout={handleLogout}
                onCreatePool={handleCreatePoolClick}
                onBrowse={() => navigate('/browse')}
                totalPrizes={stats?.totalRevenue || 0}
                totalDonated={stats?.totalDonated || 0}
              />
            </>
          } />

          {/* Squares Landing */}
          <Route path="/gameday-squares" element={
            <>
              <GamedaySquaresLanding
                user={user}
                isLoggedIn={!!user}
                onLogin={() => handleOpenAuth('login')}
                onSignup={() => handleOpenAuth('register')}
                onLogout={handleLogout}
                onCreatePool={handleCreatePoolClick}
                onBrowse={() => navigate('/browse')}
                totalPrizes={stats?.totalRevenue || 0}
                totalDonated={stats?.totalDonated || 0}
              />
            </>
          } />

          {/* Additional Landing Pages */}
          <Route path="/march-madness" element={
            <MarchMadnessLanding
              user={user}
              isLoggedIn={!!user}
              onLogin={() => handleOpenAuth('login')}
              onSignup={() => handleOpenAuth('register')}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
            />
          } />
          <Route path="/nfl-playoffs" element={
            <NFLPlayoffsLanding
              user={user}
              isLoggedIn={!!user}
              onLogin={() => handleOpenAuth('login')}
              onSignup={() => handleOpenAuth('register')}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
            />
          } />
          <Route path="/custom-sports" element={<Navigate to="/" replace />} />

          {/* Global Pages */}
          <Route path="/pricing" element={<PricingPage user={user} isLoggedIn={!!user} onLogin={() => handleOpenAuth('login')} onSignup={() => handleOpenAuth('register')} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/payment-success" element={<PaymentSuccess />} />
          <Route path="/about" element={<AboutPage user={user} isLoggedIn={!!user} onLogin={() => handleOpenAuth('login')} onSignup={() => handleOpenAuth('register')} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/charity" element={<CharityPage user={user} isLoggedIn={!!user} onLogin={() => handleOpenAuth('login')} onSignup={() => handleOpenAuth('register')} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/auth/action" element={<AuthActionHandler user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />

          <Route path="/browse" element={
            <BrowsePools user={user} pools={pools} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
          } />

          <Route path="/features" element={<FeaturesPage user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/how-it-works" element={<HowItWorksPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/privacy" element={<PrivacyPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/terms" element={<TermsPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/support" element={<Navigate to="/how-it-works?view=faq" replace />} />
          <Route path="/contact" element={
            <ContactPage
              user={user}
              onLogin={() => handleOpenAuth('login')}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
            />
          } />
          <Route path="/profile" element={
            user ? (
              <>
                <Header user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <UserProfile user={user} onUpdate={(u) => setUser(u)} />
                <Footer />
              </>
            ) : <Navigate to="/" replace />
          } />
          <Route path="/scoreboard" element={<Scoreboard user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
          <Route path="/odds/super-bowl-squares" element={
            <>
              <Header user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <SuperBowlOddsArticle />
              <Footer />
            </>
          } />
          <Route path="/articles/bracket-pool-guide" element={<Navigate to="/how-it-works?sport=brackets&view=strategy" replace />} />

          {/* User Dashboard */}
          <Route path="/participant" element={
            user ? (
              <ParticipantDashboard user={user} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
            ) : (
              <Navigate to="/" replace />
            )
          } />

          {/* Pool View */}
          <Route path="/pool/:id" element={
            <PoolRoute
              user={user}
              pools={pools}
              isLoading={false}
              onOpenAuth={handleOpenAuth}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
            />
          } />

          {/* Admin Views */}
          <Route path="/admin/:id" element={
            <AdminRoute
              user={user}
              pools={pools}
              isSuperAdmin={isAdmin}
              onOpenAuth={handleOpenAuth}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
              updatePool={(id, updates) => dbService.updatePool(id, updates)}
            />
          } />

          <Route path="/super-admin" element={
            isAdmin ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col">
                <Header user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <SuperAdmin />
                <Footer />
              </div>
            ) : <Navigate to="/" />
          } />

          {/* Tournament Simulator */}
          <Route path="/tournament-sim" element={
            <TournamentSimulator user={user} />
          } />

          {/* Creation Wizards */}
          <Route path="/create-pool" element={
            user ? (
              <CreatePoolSelection
                user={user}
                isManager={false}
                onSelectSquares={handleSquaresPoolCreate}
                onSelectBracket={() => navigate('/bracket-wizard')}
                onSelectPlayoff={() => navigate('/playoff-wizard')}
                onSelectProps={() => navigate('/props-wizard')}
                onOpenAuth={handleOpenAuth}
                onLogout={handleLogout}
                onCreatePool={handleCreatePoolClick}
              />
            ) : <Navigate to="/" replace />
          } />
          <Route path="/bracket-wizard" element={
            user ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <PoolTypeGate type="BRACKET">
                  <BracketWizard user={user} onSuccess={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
                </PoolTypeGate>
                <Footer />
              </div>
            ) : <Navigate to="/" replace />
          } />
          <Route path="/playoff-wizard" element={
            user ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <PoolTypeGate type="NFL_PLAYOFFS">
                  <PlayoffWizard user={user} onComplete={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
                </PoolTypeGate>
                <Footer />
              </div>
            ) : <Navigate to="/" replace />
          } />
          <Route path="/props-wizard" element={
            user ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <PoolTypeGate type="PROPS">
                  <PropsWizard user={user} onComplete={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
                </PoolTypeGate>
                <Footer />
              </div>
            ) : <Navigate to="/" replace />
          } />

          <Route path="/grid-wizard" element={
            user ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <PoolTypeGate type="SQUARES">
                  <SetupWizard user={user} onComplete={() => { }} onBack={() => navigate('/create-pool')} />
                </PoolTypeGate>
                <Footer />
              </div>
            ) : <Navigate to="/" replace />
          } />

          <Route path="/nfl-wizard" element={
            user ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
                <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
                <PoolTypeGate>
                  <NFLPoolWizard user={user} onComplete={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
                </PoolTypeGate>
                <Footer />
              </div>
            ) : <Navigate to="/" replace />
          } />

          <Route path="/join/:poolId" element={
            <JoinPool
              user={user}
              onOpenAuth={handleOpenAuth}
              onLogout={handleLogout}
              onCreatePool={handleCreatePoolClick}
            />
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode={authMode}
        onAuthenticated={(result) => {
          const path = window.location.pathname;
          if (result?.isNewUser) {
            toast.success('Account created! Check your email for a verification link.');
            // Join/pool pages handle their own post-auth continuation (auto-join) —
            // don't yank a fresh signup away from the pool they came to join
            if (!path.startsWith('/join') && !path.startsWith('/pool')) {
              navigate('/participant');
            }
          } else {
            toast.success('Welcome back!');
          }
        }}
      />
    </>
  );
};

export default App;