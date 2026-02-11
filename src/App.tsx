import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';

// Components
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LandingPage } from './components/LandingPage';
import { GamedaySquaresLanding } from './components/GamedaySquaresLanding';
import { AuthModal } from './components/modals';
import { CreatePoolSelection } from './components/CreatePoolSelection';
import { BrowsePools } from './components/BrowsePools';
import { ParticipantDashboard } from './components/ParticipantDashboard';
import { FeaturesPage } from './components/FeaturesPage';
import { PrivacyPage } from './components/PrivacyPage';
import { TermsPage } from './components/TermsPage';
import { HowItWorksPage } from './components/HowItWorksPage';
import { SupportPage } from './components/SupportPage';
import { UserProfile } from './components/UserProfile';
import { Scoreboard } from './components/Scoreboard';
import { SuperBowlOddsArticle } from './components/articles/SuperBowlOddsArticle';

// Routes
import { PoolRoute } from './components/routes/PoolRoute';
import { AdminRoute } from './components/routes/AdminRoute';

// Wizards
import { BracketWizard } from './components/BracketWizard/BracketWizard';
import { PlayoffWizard } from './components/PlayoffPool/PlayoffWizard';
import { PropsWizard } from './components/PropsWizard/PropsWizard';
import { SetupWizard } from './components/SetupWizard';

// Admin / SuperAdmin
import { SuperAdmin } from './components/SuperAdmin';
import { TournamentSimulator } from './components/TournamentSimulator/TournamentSimulator';

// Services & Objects
import { authService } from './services/authService';
import { dbService, type GlobalStats } from './services/dbService';
import type { User, Pool } from './types';

// Legacy Hash Handler - redirects old hash-based URLs to clean URLs
const LegacyHashHandler = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      console.log('Migrating legacy hash:', hash);
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
  }, []); // Run once on mount - eslint-disable-line react-hooks/exhaustive-deps

  return null;
};


const App: React.FC = () => {
  const navigate = useNavigate();
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

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  if (isAuthLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white"><Loader className="animate-spin text-indigo-500" /></div>;
  }

  return (
    <>
      <LegacyHashHandler />
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

        {/* Global Pages */}
        <Route path="/browse" element={
          <BrowsePools user={user} pools={pools} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
        } />

        <Route path="/features" element={<FeaturesPage user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} />} />
        <Route path="/how-it-works" element={<HowItWorksPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
        <Route path="/privacy" element={<PrivacyPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
        <Route path="/terms" element={<TermsPage user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />} />
        <Route path="/support" element={
          <>
            <Header user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
            <SupportPage />
            <Footer />
          </>
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
            isSuperAdmin={isSuperAdmin}
            onOpenAuth={handleOpenAuth}
            onLogout={handleLogout}
            onCreatePool={handleCreatePoolClick}
            updatePool={dbService.updatePool as any}
          />
        } />

        <Route path="/super-admin" element={
          isSuperAdmin ? (
            <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white flex flex-col">
              <Header user={user} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <SuperAdmin />
              <Footer />
            </div>
          ) : <Navigate to="/" />
        } />

        {/* Tournament Simulator */}
        <Route path="/tournament-sim" element={
          <TournamentSimulator />
        } />

        {/* Creation Wizards */}
        <Route path="/create-pool" element={
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
        } />
        <Route path="/bracket-wizard" element={
          user ? (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
              <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <BracketWizard user={user} onSuccess={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
              <Footer />
            </div>
          ) : <Navigate to="/create-pool" />
        } />
        <Route path="/playoff-wizard" element={
          user ? (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
              <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <PlayoffWizard user={user} onComplete={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
              <Footer />
            </div>
          ) : <Navigate to="/create-pool" />
        } />
        <Route path="/props-wizard" element={
          user ? (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
              <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <PropsWizard user={user} onComplete={() => navigate('/participant')} onCancel={() => navigate('/create-pool')} />
              <Footer />
            </div>
          ) : <Navigate to="/create-pool" />
        } />

        <Route path="/grid-wizard" element={
          user ? (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
              <Header user={user} isManager={false} onOpenAuth={handleOpenAuth} onLogout={handleLogout} onCreatePool={handleCreatePoolClick} />
              <SetupWizard user={user} onComplete={() => { }} onBack={() => navigate('/create-pool')} />
              <Footer />
            </div>
          ) : <Navigate to="/create-pool" />
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
    </>
  );
};

export default App;