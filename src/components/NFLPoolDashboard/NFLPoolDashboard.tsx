import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { BillingGate } from '../billing';
import { Calendar, Lock, Settings, Share2, FileText, Mail, Phone, Trophy, Target, Timer, Flame } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { User, Pool, NFLGame, WeeklyRecap } from '../../types';

// Lazy load or import sub-views (we will create them next!)
import { PickemPickEntry } from './PickemPickEntry';
import { SurvivorPickEntry } from './SurvivorPickEntry';
import { MarginPickEntry } from './MarginPickEntry';
import { NFLStandings } from './NFLStandings';
import { NFLPoolRules } from './NFLPoolRules';
import { NFLManagerView } from './NFLManagerView';
import { PickDistribution } from './PickDistribution';
import { NFLUserBentoDashboard } from './NFLUserBentoDashboard';
import { AICommissioner } from '../AICommissioner';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';
import { now as serverNow } from '../../utils/serverClock';
import { usesWeeklyHardLock, normalizeLockBufferMinutes } from '@shared/weeklyHardLock';
import { WeekChecklist } from './WeekChecklist';
import { PaymentsPanel } from '../PaymentsPanel';

interface NFLPoolDashboardProps {
  pool: Pool;
  user: User | null;
  isManager: boolean;
  onBack: () => void;
  onOpenAuth: () => void;
}

export const NFLPoolDashboard: React.FC<NFLPoolDashboardProps> = ({
  pool,
  user,
  isManager,
  onBack,
  onOpenAuth
}) => {
  const castPool = pool as any;
  const toast = useToast();

  // Tab lives in the URL so the browser Back button steps through tabs (and refresh
  // restores the view) instead of leaving the pool. Tab changes push a history entry.
  const [searchParams, setSearchParams] = useSearchParams();
  type TabType = 'dashboard' | 'picks' | 'standings' | 'recaps' | 'rules' | 'payments' | 'manager';
  const VALID_TABS: TabType[] = ['dashboard', 'picks', 'standings', 'recaps', 'rules', 'payments', 'manager'];
  const tabParam = searchParams.get('tab') as TabType | null;
  const activeTab: TabType = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'dashboard';
  const setActiveTab = (tab: TabType) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', tab);
      return p;
    });
  };

  // Estimate current NFL Week based on date (standard season calculations)
  const getEstimatedNFLWeek = (): number => {
    const now = Date.now();
    const isPre = Number(castPool.seasonType) === 1;

    if (isPre) {
      const preseasonStart = new Date('2026-08-06T00:00:00').getTime(); // HOF Weekend kickoff
      if (now < preseasonStart) return 1;
      const diffMs = now - preseasonStart;
      const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
      return Math.min(4, Math.max(1, weekNum));
    } else {
      const seasonStart = new Date('2026-09-10T00:00:00').getTime(); // Estimated kickoff of Week 1
      if (now < seasonStart) return 1;
      const diffMs = now - seasonStart;
      const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
      return Math.min(18, Math.max(1, weekNum));
    }
  };

  const currentEstWeek = useMemo(() => getEstimatedNFLWeek(), [castPool.seasonType]);
  // Selected week also rides in the URL (?week=) so refresh/Back restore the drilldown.
  // Week changes replace (not push) so scrubbing weeks doesn't spam browser history.
  const weekParam = searchParams.get('week');
  const parsedWeek = weekParam ? Number(weekParam) : NaN;
  const selectedWeek: number = Number.isFinite(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 18 ? parsedWeek : currentEstWeek;
  const setSelectedWeek = (week: number) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('week', String(week));
      return p;
    }, { replace: true });
  };

  // Subscribed States
  const [games, setGames] = useState<NFLGame[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Subscribe to NFL Games
  useEffect(() => {
    setIsLoading(true);
    const unsub = dbService.subscribeToNFLGames(castPool.season, (data) => {
      setGames(data);
      setIsLoading(false);
    });
    return () => unsub();
  }, [castPool.season]);

  // 2. Entry data, split by role (ADR 0005 Phase 2). Rules now restrict non-owner
  // participant reads of NFL entries until the pool is FINAL, so:
  // - manager/owner: raw entries collection (management reads stay allowed)
  // - member: the reveal-safe standings projection + their OWN entry doc (merged in,
  //   so their current-week picks still render). Standings are empty until the first
  //   scored week — members see only their own row before then.
  const [standingsRows, setStandingsRows] = useState<any[]>([]);
  const [ownEntry, setOwnEntry] = useState<any | null>(null);

  useEffect(() => {
    if (isManager) {
      const unsub = dbService.subscribeToNFLEntries(pool.id, (data) => {
        setEntries(data);
      });
      return () => unsub();
    }
    const unsubStandings = dbService.subscribeToNFLStandings(pool.id, setStandingsRows);
    const unsubOwn = user
      ? dbService.subscribeToMyNFLEntry(pool.id, user.id, setOwnEntry)
      : undefined;
    return () => { unsubStandings(); unsubOwn?.(); };
  }, [pool.id, isManager, user?.id]);

  useEffect(() => {
    if (isManager) return;
    const others = standingsRows.filter(r => !ownEntry || r.ownerUid !== ownEntry.ownerUid);
    setEntries(ownEntry ? [ownEntry, ...others] : others);
  }, [isManager, standingsRows, ownEntry]);

  // 2b. Subscribe to Member Records (roster truth — everyone who joined, ADR 0003)
  useEffect(() => {
    const unsub = dbService.subscribeToPoolMembers(pool.id, (data) => {
      setMembers(data);
    });
    return () => unsub();
  }, [pool.id]);

  // 3. Subscribe to Weekly Recaps
  useEffect(() => {
    const unsub = dbService.subscribeToWeeklyRecaps(pool.id, (data) => {
      setRecaps(data);
    });
    return () => unsub();
  }, [pool.id]);

  // Filter games for the currently selected week and seasonType
  const weeklyGames = useMemo(() => {
    const filtered = games.filter(g => g.week === selectedWeek && Number(g.seasonType) === Number(castPool.seasonType));
    console.log("[NFLPoolDashboard] weeklyGames filter ran:", {
      selectedWeek,
      poolSeasonType: castPool.seasonType,
      totalGamesCount: games.length,
      filteredGamesCount: filtered.length,
      filteredGames: filtered.map(g => ({ id: g.id, week: g.week, seasonType: g.seasonType }))
    });
    return filtered;
  }, [games, selectedWeek, castPool.seasonType]);

  // Retrieve user's personal entry
  const myEntry = useMemo(() => {
    if (!user) return null;
    return entries.find(e => e.ownerUid === user.id) || null;
  }, [entries, user]);

  // Check if the current selected week is locked (earliest game kicked off).
  // Server-corrected clock — device time can drift and lie about the deadline.
  const isWeekLocked = useMemo(() => {
    if (weeklyGames.length === 0) return false;
    // Survivor/Margin run a hard weekly deadline and the server snaps their buffer
    // to an allowed preset — normalize here too, or the UI would disagree with the
    // server on a legacy value (a stored 0 would show picks open past the deadline
    // the server actually enforces).
    const bufferMinutes = usesWeeklyHardLock(castPool.type)
      ? normalizeLockBufferMinutes(castPool.settings?.lockBufferMinutes)
      : (castPool.settings?.lockBufferMinutes ?? 5);
    const bufferMs = bufferMinutes * 60 * 1000;
    const earliestKickoff = Math.min(...weeklyGames.map(g => g.startTime));
    return serverNow() >= (earliestKickoff - bufferMs);
  }, [weeklyGames, castPool.settings?.lockBufferMinutes, castPool.type]);

  // Time remaining to earliest game this week
  const earliestGame = useMemo(() => {
    if (weeklyGames.length === 0) return null;
    return weeklyGames.reduce((prev, curr) => prev.startTime < curr.startTime ? prev : curr);
  }, [weeklyGames]);

  // Season opener — the first kickoff of the whole season. Rules edits lock here.
  const seasonOpenTime = useMemo(() => {
    const seasonGames = games.filter(g => Number(g.seasonType) === Number(castPool.seasonType));
    if (seasonGames.length === 0) return null;
    return Math.min(...seasonGames.map(g => g.startTime));
  }, [games, castPool.seasonType]);

  // Share handler
  const handleShare = () => {
    const url = `${window.location.origin}/join/${pool.id}`;
    navigator.clipboard.writeText(url);
    toast.success('Invite link copied to clipboard!');
  };

  const branding = castPool.branding || {};
  const accentHex = branding.secondaryColor || '#C9A867';

  return (
    <BillingGate pool={pool as any} isCommissioner={isManager}>
    <div
      className="min-h-screen bg-page text-[color:var(--text)] font-body pb-20 relative transition-colors duration-500"
      style={{ backgroundColor: branding.bgColor || undefined }}
    >
      {/* Pool Header Bar */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 border border-line rounded-xl shadow-card">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {branding.logoUrl && (
                <img src={branding.logoUrl} className="h-12 w-auto object-contain drop-shadow" alt="Logo" />
              )}
              <h1 className="font-display font-extrabold uppercase text-3xl text-[color:var(--text)] leading-none">{pool.name}</h1>
            </div>
            <p className="text-muted font-body text-sm font-semibold mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 flex-wrap">
                Host: <strong className="text-[color:var(--text)] font-bold">{pool.managerName || 'Host'}</strong>
                {castPool.contactMethod !== 'none' && (
                  <span className="flex items-center gap-1.5 ml-1 inline-flex">
                    {(castPool.contactMethod === 'email' || castPool.contactMethod === 'both' || !castPool.contactMethod) && pool.contactEmail && (
                      <a
                        href={`mailto:${pool.contactEmail}`}
                        className="p-1 bg-navy-800/5 hover:bg-navy-800/10 text-navy-700 dark:bg-gold-400/10 dark:hover:bg-gold-400/20 dark:text-gold-400 border border-line rounded-sm transition-all duration-150 hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Email Host: ${pool.contactEmail}`}
                      >
                        <Mail size={12} />
                      </a>
                    )}
                    {(castPool.contactMethod === 'phone' || castPool.contactMethod === 'both') && castPool.contactPhone && (
                      <a
                        href={`tel:${castPool.contactPhone}`}
                        className="p-1 bg-navy-800/5 hover:bg-navy-800/10 text-navy-700 dark:bg-gold-400/10 dark:hover:bg-gold-400/20 dark:text-gold-400 border border-line rounded-sm transition-all duration-150 hover:scale-105 flex items-center justify-center cursor-pointer"
                        title={`Call/SMS Host: ${castPool.contactPhone}`}
                      >
                        <Phone size={12} />
                      </a>
                    )}
                  </span>
                )}
              </span>
              <span className="text-faint">•</span>
              <span className="text-navy-700 dark:text-gold-400 uppercase font-display font-bold text-[12px] tracking-[0.08em]">
                {pool.type === 'NFL_PICKEM' ? 'Weekly Pick\'em' :
                 pool.type === 'NFL_SURVIVOR' ? 'Survivor Pool' : 'Margin Pool'}
              </span>
            </p>
          </div>

          <div className="flex gap-2.5 items-center flex-wrap">
            {/* Week Selector */}
            <div className="flex items-center gap-2 bg-page border-[1.5px] border-line rounded-md px-3 py-1.5">
              <Calendar size={16} className="text-muted" />
              <select
                value={selectedWeek}
                onChange={e => setSelectedWeek(parseInt(e.target.value))}
                className="bg-transparent focus:outline-none font-body text-sm text-[color:var(--text)] font-bold cursor-pointer"
              >
                {Array.from({ length: Number(castPool.seasonType) === 1 ? 4 : 18 }, (_, i) => i + 1).map(w => (
                  <option key={w} value={w} className="bg-card text-[color:var(--text)]">
                    {Number(castPool.seasonType) === 1
                      ? w === 1
                        ? 'HOF Weekend'
                        : `Preseason Week ${w - 1}`
                      : `Week ${w}`}
                  </option>
                ))}
              </select>
            </div>

            <Button variant="ghost" size="sm" onClick={handleShare}>
              <Share2 size={13} /> Invite Link
            </Button>

            {isManager && (
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('manager')}>
                <Settings size={13} /> Commissioner
              </Button>
            )}
          </div>
        </div>

        {/* Week-by-week pending/done strip + "picks due" call-to-action */}
        {!isLoading && (
          <div className="mt-6">
            <WeekChecklist
              pool={pool}
              entry={myEntry}
              games={games}
              selectedWeek={selectedWeek}
              onSelectWeek={setSelectedWeek}
              onPickNow={(week) => { setSelectedWeek(week); setActiveTab('picks'); }}
            />
          </div>
        )}

        {/* Global tab routing headers */}
        <div className="flex border-b border-line mt-8 mb-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'dashboard'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'dashboard' ? { borderBottomColor: accentHex } : {}}
          >
            Pool Home
          </button>
          <button
            onClick={() => setActiveTab('picks')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'picks'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'picks' ? { borderBottomColor: accentHex } : {}}
          >
            My Entry
          </button>
          <button
            onClick={() => setActiveTab('standings')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'standings'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'standings' ? { borderBottomColor: accentHex } : {}}
          >
            Standings & Leaderboard
          </button>
          <button
            onClick={() => setActiveTab('recaps')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'recaps'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'recaps' ? { borderBottomColor: accentHex } : {}}
          >
            Weekly Recaps
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
              activeTab === 'rules'
                ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                : 'text-muted hover:text-[color:var(--text)] border-transparent'
            }`}
            style={activeTab === 'rules' ? { borderBottomColor: accentHex } : {}}
          >
            Rules & Rulesets
          </button>
          {user && (
            <button
              onClick={() => setActiveTab('payments')}
              className={`py-3 px-6 font-display font-bold uppercase text-[13px] tracking-[0.08em] transition-all duration-150 border-b-2 ${
                activeTab === 'payments'
                  ? 'text-[color:var(--text)] border-navy-600 dark:border-gold-500'
                  : 'text-muted hover:text-[color:var(--text)] border-transparent'
              }`}
              style={activeTab === 'payments' ? { borderBottomColor: accentHex } : {}}
            >
              Payments
            </button>
          )}
        </div>

        {/* Tab View Routers */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="text-center py-16">
              <div className="animate-spin w-10 h-10 border-4 border-gold-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted font-body font-bold">Synchronizing game feeds...</p>
            </div>
          ) : (
            <>
              {/* TAB 0: BENTO DASHBOARD OVERVIEW */}
              {activeTab === 'dashboard' && (
                <>
                  <NFLUserBentoDashboard
                    pool={pool}
                    user={user}
                    games={games}
                    entries={entries}
                    recaps={recaps}
                    selectedWeek={selectedWeek}
                    setSelectedWeek={setSelectedWeek}
                    isWeekLocked={isWeekLocked}
                    earliestGame={earliestGame}
                    onBack={onBack}
                    onOpenAuth={onOpenAuth}
                    isManager={isManager}
                    onSelectTab={(tab) => setActiveTab(tab)}
                  />
                  {castPool.billing?.featuresUnlocked?.aiCommissioner && (
                    <div className="max-w-4xl mx-auto mt-6">
                      <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                    </div>
                  )}
                </>
              )}

              {/* TAB 1: PICK ENTRY */}
              {activeTab === 'picks' && (
                <>
                  {!user ? (
                    <div className="bg-card border border-line rounded-xl shadow-card p-8 text-center max-w-md mx-auto my-12">
                      <Lock size={40} className="text-faint mx-auto mb-3" />
                      <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Member Authentication Required</h3>
                      <p className="font-body text-muted text-sm mb-6">
                        You must sign in or register to submit or review pick sheets in this pool.
                      </p>
                      <Button onClick={onOpenAuth}>
                        Sign In / Register
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Left/Center columns: Matchups/Picks list */}
                      <div className="lg:col-span-2 space-y-6">
                        {pool.type === 'NFL_PICKEM' && (
                          <PickemPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                            onGoToWeek={setSelectedWeek}
                          />
                        )}

                        {pool.type === 'NFL_SURVIVOR' && (
                          <SurvivorPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                          />
                        )}

                        {pool.type === 'NFL_MARGIN' && (
                          <MarginPickEntry
                            pool={pool}
                            user={user}
                            week={selectedWeek}
                            games={weeklyGames}
                            entry={myEntry}
                            isWeekLocked={isWeekLocked}
                          />
                        )}
                      </div>

                      {/* Right column: Quick overview/stats */}
                      <div className="space-y-6">
                        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                          <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-4">
                            Week {selectedWeek} Lock Status
                          </h3>

                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              {isWeekLocked ? (
                                <div className="p-2.5 bg-cream rounded-md text-muted border border-line">
                                  <Lock size={18} />
                                </div>
                              ) : (
                                <div className="p-2.5 bg-[#E5EDF6] rounded-md text-[#142A4C] border border-[#CBDCEC] animate-pulse">
                                  <Calendar size={18} />
                                </div>
                              )}
                              <div>
                                <h4 className="font-display font-bold uppercase text-sm text-[color:var(--text)]">
                                  {isWeekLocked ? 'Selections Locked' : 'Picks are Open'}
                                </h4>
                                <p className="font-body text-[11px] text-muted">
                                  {isWeekLocked
                                    ? 'Host is syncing game outcomes.'
                                    : 'Make changes before kickoff.'}
                                </p>
                              </div>
                            </div>

                            {earliestGame && !isWeekLocked && (
                              <div className="bg-page p-3 rounded-lg text-center border border-line">
                                <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted block mb-1">
                                  Locks in
                                </span>
                                <span className="text-gold-600 dark:text-gold-400 num font-bold text-sm">
                                  {new Date(earliestGame.startTime).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <PickDistribution
                          pool={pool}
                          games={weeklyGames}
                          week={selectedWeek}
                          isWeekLocked={isWeekLocked}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TAB 2: STANDINGS */}
              {activeTab === 'standings' && (
                <NFLStandings
                  pool={pool}
                  entries={entries}
                  games={games}
                  week={selectedWeek}
                />
              )}

              {/* TAB 3: RECAPS */}
              {activeTab === 'recaps' && (
                <div className="max-w-xl mx-auto space-y-6">
                  {castPool.billing?.featuresUnlocked?.aiCommissioner && (
                    <AICommissioner poolId={pool.id} userId={user?.id} userName={user?.name} poolType={pool.type} />
                  )}
                  {recaps.length === 0 ? (
                    <div className="bg-card border border-line rounded-xl p-8 text-center shadow-card">
                      <FileText size={40} className="text-faint mx-auto mb-3" />
                      <h4 className="font-display font-bold uppercase text-sm text-[color:var(--text)]">No Weekly Recaps Available</h4>
                      <p className="font-body text-[13px] text-muted mt-1">
                        Recaps will compile automatically after commissioner scores active weeks.
                      </p>
                    </div>
                  ) : (
                    recaps.map(recap => (
                      <div key={recap.id} className="bg-card border border-line rounded-xl p-6 shadow-card space-y-4">
                        <div className="flex justify-between items-center border-b border-line pb-3">
                          <h4 className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2">
                            <Trophy size={18} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Week {recap.week} Recap Summary
                          </h4>
                          <span className="text-[11px] text-muted font-bold num">
                            {new Date(recap.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="space-y-3.5 font-body text-sm">
                          {recap.sharpOfWeek && (
                            <div className="flex justify-between items-center border-b border-line pb-2">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Target size={13} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Sharp of the Week:</span>
                              <span className="text-[color:var(--text)] font-display font-bold num">
                                {recap.sharpOfWeek.userName} ({recap.sharpOfWeek.score} pts)
                              </span>
                            </div>
                          )}

                          {recap.closestTiebreaker && (
                            <div className="flex justify-between items-center border-b border-line pb-2">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Timer size={13} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Closest Tiebreaker:</span>
                              <span className="text-[color:var(--text)] font-display font-bold num">
                                {recap.closestTiebreaker.userName} (diff: {recap.closestTiebreaker.diff})
                              </span>
                            </div>
                          )}

                          {recap.attritionCount !== undefined && (
                            <div className="flex justify-between items-center">
                              <span className="text-muted font-bold flex items-center gap-1.5"><Flame size={13} className="text-brandred-600" aria-hidden="true" /> Survivor Attrition Remaining:</span>
                              <span className="text-brandred-600 font-display font-bold num">
                                {recap.attritionCount} Players Alive
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: RULES */}
              {activeTab === 'rules' && (
                <NFLPoolRules
                  pool={pool}
                  isManager={isManager}
                  onEditRules={() => setActiveTab('manager')}
                  lockTime={seasonOpenTime}
                />
              )}

              {/* TAB 5: PAYMENTS — member money view (status, pot, ledger) */}
              {activeTab === 'payments' && user && (
                <PaymentsPanel pool={pool} user={user} entries={entries} members={members} isManager={isManager} onManagePayments={() => setActiveTab('manager')} />
              )}

              {/* TAB 5: COMMISSIONER */}
              {activeTab === 'manager' && isManager && (
                <NFLManagerView
                  pool={pool}
                  entries={entries}
                  members={members}
                  games={games}
                  week={selectedWeek}
                  user={user}
                  onSelectTab={(tab) => setActiveTab(tab)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </BillingGate>
  );
};
