import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Calendar, Lock, Settings, Share2, HelpCircle, FileText, ChevronRight } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { User, Pool, NFLGame, WeeklyRecap } from '../../types';

// Lazy load or import sub-views (we will create them next!)
import { PickemPickEntry } from './PickemPickEntry';
import { SurvivorPickEntry } from './SurvivorPickEntry';
import { MarginPickEntry } from './MarginPickEntry';
import { NFLStandings } from './NFLStandings';
import { NFLPoolRules } from './NFLPoolRules';
import { NFLManagerView } from './NFLManagerView';
import { PickDistribution } from './PickDistribution';

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
  const [activeTab, setActiveTab] = useState<'picks' | 'standings' | 'recaps' | 'rules' | 'manager'>('picks');

  // Estimate current NFL Week based on date (standard season calculations)
  const getEstimatedNFLWeek = (): number => {
    const now = Date.now();
    // Default start week is Week 1
    const seasonStart = new Date('2026-09-10T00:00:00').getTime(); // Estimated kickoff of Week 1
    if (now < seasonStart) return 1;

    const diffMs = now - seasonStart;
    const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
    return Math.min(18, Math.max(1, weekNum));
  };

  const currentEstWeek = useMemo(() => getEstimatedNFLWeek(), []);
  const [selectedWeek, setSelectedWeek] = useState<number>(currentEstWeek);

  // Subscribed States
  const [games, setGames] = useState<NFLGame[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Subscribe to NFL Games
  useEffect(() => {
    setIsLoading(true);
    const unsub = dbService.subscribeToNFLGames(pool.season, (data) => {
      setGames(data);
      setIsLoading(false);
    });
    return () => unsub();
  }, [pool.season]);

  // 2. Subscribe to Pool Participant Entries
  useEffect(() => {
    const unsub = dbService.subscribeToNFLEntries(pool.id, (data) => {
      setEntries(data);
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

  // Filter games for the currently selected week
  const weeklyGames = useMemo(() => {
    return games.filter(g => g.week === selectedWeek);
  }, [games, selectedWeek]);

  // Retrieve user's personal entry
  const myEntry = useMemo(() => {
    if (!user) return null;
    return entries.find(e => e.ownerUid === user.id) || null;
  }, [entries, user]);

  // Check if the current selected week is locked (earliest game kicked off)
  const isWeekLocked = useMemo(() => {
    if (weeklyGames.length === 0) return false;
    const bufferMs = (pool.settings?.lockBufferMinutes ?? 5) * 60 * 1000;
    const earliestKickoff = Math.min(...weeklyGames.map(g => g.startTime));
    return Date.now() >= (earliestKickoff - bufferMs);
  }, [weeklyGames, pool.settings?.lockBufferMinutes]);

  // Time remaining to earliest game this week
  const earliestGame = useMemo(() => {
    if (weeklyGames.length === 0) return null;
    return weeklyGames.reduce((prev, curr) => prev.startTime < curr.startTime ? prev : curr);
  }, [weeklyGames]);

  // Share handler
  const handleShare = () => {
    const url = `${window.location.origin}/join/${pool.id}`;
    navigator.clipboard.writeText(url);
    alert('Invite link copied to clipboard!');
  };

  const branding = pool.branding || {};
  const accentHex = branding.secondaryColor || '#6366f1';

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20 relative transition-colors duration-500"
      style={{ backgroundColor: branding.bgColor || '#020617' }}
    >
      {/* Pool Header Bar */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/40 p-6 border border-slate-800 rounded-3xl backdrop-blur-sm">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {branding.logo && (
                <img src={branding.logo} className="h-12 w-auto object-contain drop-shadow" alt="Logo" />
              )}
              <h1 className="text-3xl font-black text-white leading-none">{pool.name}</h1>
            </div>
            <p className="text-slate-400 text-sm font-semibold mt-1.5 flex items-center gap-2">
              <span>Host: <strong>{pool.managerName || 'Host'}</strong></span>
              <span className="text-slate-700">•</span>
              <span className="text-blue-400 uppercase font-black text-xs">
                {pool.type === 'NFL_PICKEM' ? 'Weekly Pick\'em' :
                 pool.type === 'NFL_SURVIVOR' ? 'Survivor Pool' : 'Margin Pool'}
              </span>
            </p>
          </div>

          <div className="flex gap-2.5 items-center flex-wrap">
            {/* Week Selector */}
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-2xl px-3 py-1.5">
              <Calendar size={16} className="text-slate-500" />
              <select
                value={selectedWeek}
                onChange={e => setSelectedWeek(parseInt(e.target.value))}
                className="bg-transparent focus:outline-none text-sm text-white font-bold cursor-pointer"
              >
                {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
                  <option key={w} value={w} className="bg-slate-950">Week {w}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleShare}
              className="bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white px-4 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-1.5"
            >
              <Share2 size={13} /> Invite Link
            </button>

            {isManager && (
              <button
                onClick={() => setActiveTab('manager')}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-1.5"
              >
                <Settings size={13} /> Commissioner
              </button>
            )}
          </div>
        </div>

        {/* Global tab routing headers */}
        <div className="flex border-b border-slate-800/80 mt-8 mb-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <button
            onClick={() => setActiveTab('picks')}
            className={`py-3 px-6 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'picks'
                ? 'text-white border-blue-500 font-black'
                : 'text-slate-500 hover:text-slate-400 border-transparent'
            }`}
            style={activeTab === 'picks' ? { borderBottomColor: accentHex } : {}}
          >
            My Entry
          </button>
          <button
            onClick={() => setActiveTab('standings')}
            className={`py-3 px-6 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'standings'
                ? 'text-white border-blue-500 font-black'
                : 'text-slate-500 hover:text-slate-400 border-transparent'
            }`}
            style={activeTab === 'standings' ? { borderBottomColor: accentHex } : {}}
          >
            Standings & Leaderboard
          </button>
          <button
            onClick={() => setActiveTab('recaps')}
            className={`py-3 px-6 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'recaps'
                ? 'text-white border-blue-500 font-black'
                : 'text-slate-500 hover:text-slate-400 border-transparent'
            }`}
            style={activeTab === 'recaps' ? { borderBottomColor: accentHex } : {}}
          >
            Weekly Recaps
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-3 px-6 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === 'rules'
                ? 'text-white border-blue-500 font-black'
                : 'text-slate-500 hover:text-slate-400 border-transparent'
            }`}
            style={activeTab === 'rules' ? { borderBottomColor: accentHex } : {}}
          >
            Rules & Rulesets
          </button>
        </div>

        {/* Tab View Routers */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="text-center py-16">
              <div className="animate-spin text-blue-500 w-10 h-10 border-4 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-slate-500 font-bold">Synchronizing game feeds...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: PICK ENTRY */}
              {activeTab === 'picks' && (
                <>
                  {!user ? (
                    <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center max-w-md mx-auto my-12">
                      <Lock size={40} className="text-slate-600 mx-auto mb-3" />
                      <h3 className="text-xl font-bold text-white mb-2">Member Authentication Required</h3>
                      <p className="text-slate-400 text-sm mb-6">
                        You must sign in or register to submit or review pick sheets in this pool.
                      </p>
                      <button
                        onClick={onOpenAuth}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold px-6 py-3 rounded-xl text-sm transition-all"
                      >
                        Sign In / Register
                      </button>
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
                        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm">
                          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">
                            Week {selectedWeek} Lock Status
                          </h3>

                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              {isWeekLocked ? (
                                <div className="p-2.5 bg-red-500/10 rounded-xl text-red-400 border border-red-500/20">
                                  <Lock size={18} />
                                </div>
                              ) : (
                                <div className="p-2.5 bg-green-500/10 rounded-xl text-green-400 border border-green-500/20 animate-pulse">
                                  <Calendar size={18} />
                                </div>
                              )}
                              <div>
                                <h4 className="text-sm font-bold text-white">
                                  {isWeekLocked ? 'Selections Locked' : 'Picks are Open'}
                                </h4>
                                <p className="text-[10px] text-slate-500">
                                  {isWeekLocked 
                                    ? 'Host is syncing game outcomes.' 
                                    : 'Make changes before kickoff.'}
                                </p>
                              </div>
                            </div>

                            {earliestGame && !isWeekLocked && (
                              <div className="bg-slate-950 p-3 rounded-2xl text-center border border-slate-800">
                                <span className="text-[10px] text-slate-500 font-extrabold uppercase block mb-1">
                                  Locks in
                                </span>
                                <span className="text-amber-400 font-mono font-bold text-sm">
                                  {new Date(earliestGame.startTime).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <PickDistribution
                          pool={pool}
                          entries={entries}
                          games={games}
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
                  {recaps.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 text-center backdrop-blur-sm">
                      <FileText size={40} className="text-slate-600 mx-auto mb-3" />
                      <h4 className="text-sm font-bold text-slate-300">No Weekly Recaps Available</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Recaps will compile automatically after commissioner scores active weeks.
                      </p>
                    </div>
                  ) : (
                    recaps.map(recap => (
                      <div key={recap.id} className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-4">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                          <h4 className="text-lg font-black text-white flex items-center gap-2">
                            🏆 Week {recap.week} Recap Summary
                          </h4>
                          <span className="text-[10px] text-slate-500 font-bold font-mono">
                            {new Date(recap.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="space-y-3.5 text-sm">
                          {recap.sharpOfWeek && (
                            <div className="flex justify-between items-center border-b border-slate-800/40 pb-2">
                              <span className="text-slate-400 font-bold">🎯 Sharp of the Week:</span>
                              <span className="text-white font-extrabold">
                                {recap.sharpOfWeek.userName} ({recap.sharpOfWeek.score} pts)
                              </span>
                            </div>
                          )}

                          {recap.closestTiebreaker && (
                            <div className="flex justify-between items-center border-b border-slate-800/40 pb-2">
                              <span className="text-slate-400 font-bold">⏱️ Closest Tiebreaker:</span>
                              <span className="text-white font-extrabold">
                                {recap.closestTiebreaker.userName} (diff: {recap.closestTiebreaker.diff})
                              </span>
                            </div>
                          )}

                          {recap.attritionCount !== undefined && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 font-bold">🔥 Survivor Attrition Remaining:</span>
                              <span className="text-red-400 font-black">
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
                <NFLPoolRules pool={pool} />
              )}

              {/* TAB 5: COMMISSIONER */}
              {activeTab === 'manager' && isManager && (
                <NFLManagerView
                  pool={pool}
                  entries={entries}
                  games={games}
                  week={selectedWeek}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
