import React, { useState, useMemo } from 'react';
import { Settings, Shield, DollarSign, Award, CheckCircle, XCircle, RefreshCw, Users, Activity, Play } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { Pool, NFLGame } from '../../types';

interface NFLManagerViewProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
}

export const NFLManagerView: React.FC<NFLManagerViewProps> = ({
  pool,
  entries,
  games,
  week
}) => {
  const [isScoring, setIsScoring] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const type = pool.type;
  
  // Games state in current week
  const weeklyGames = useMemo(() => {
    return games.filter(g => g.week === week);
  }, [games, week]);

  const finalGamesCount = useMemo(() => {
    return weeklyGames.filter(g => g.status === 'FINAL' || g.status === 'CANCELLED').length;
  }, [weeklyGames]);

  const totalGamesCount = weeklyGames.length;
  const isWeekFullyFinal = totalGamesCount > 0 && finalGamesCount === totalGamesCount;

  const handleScoreWeek = async () => {
    if (!window.confirm(`Are you absolutely sure you want to run the scoring calculations and generate the weekly recap for Week ${week}?`)) return;
    
    setIsScoring(true);
    setFeedback(null);

    try {
      const res = await dbService.scoreNFLWeek(pool.id, week);
      setFeedback({
        type: 'success',
        message: res.message || `Week ${week} has been successfully scored and locked!`
      });
    } catch (err: any) {
      logger.error(`Failed to score week ${week}:`, err);
      setFeedback({
        type: 'error',
        message: err.message || `Scoring failed. Ensure all games in Week ${week} are final before triggering.`
      });
    } finally {
      setIsScoring(false);
    }
  };

  const handleTogglePayment = async (entryId: string, currentStatus: string) => {
    setIsSavingPayment(entryId);
    setFeedback(null);

    const nextStatus = currentStatus === 'PAID' ? 'UNPAID' : 'PAID';

    try {
      await dbService.updateBracketEntryPayment(pool.id, entryId, nextStatus);
    } catch (err: any) {
      logger.error(`Failed to update payment status for entry ${entryId}:`, err);
      setFeedback({
        type: 'error',
        message: 'Permission denied or update failed. You may need higher access privileges.'
      });
    } finally {
      setIsSavingPayment(null);
    }
  };

  const branding = pool.branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Feedback Alert banner */}
      {feedback && (
        <div className={`p-4 rounded-2xl text-xs font-bold flex gap-2 items-center ${
          feedback.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {feedback.message}
        </div>
      )}

      {/* Control Room Card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden">
        <div
          className="absolute -right-16 -top-16 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryAccent }}
        />
        <div className="flex gap-4 items-center">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-2xl">
            <Settings size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Commissioner Control Room</h3>
            <p className="text-slate-400 text-xs mt-1">
              You are recognized as the pool host. You hold write capabilities to score weeks, update user payout statuses, and audit all selections.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Weekly Scoring Console */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-5">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" /> Week {week} Scoring Feed
            </h4>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                <span className="text-slate-400 font-semibold">Total Matchups:</span>
                <span className="text-white font-extrabold font-mono">{totalGamesCount}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                <span className="text-slate-400 font-semibold">Completed Games:</span>
                <span className={`font-extrabold font-mono ${isWeekFullyFinal ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {finalGamesCount} / {totalGamesCount}
                </span>
              </div>
            </div>

            {/* Score Trigger Button */}
            <div className="pt-2">
              <button
                onClick={handleScoreWeek}
                disabled={isScoring || totalGamesCount === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <Play size={14} className={isScoring ? 'animate-spin' : ''} />
                {isScoring ? 'Calculating...' : `Score & Recap Week ${week}`}
              </button>
              
              {!isWeekFullyFinal && (
                <p className="text-[10px] text-slate-500 mt-2.5 leading-relaxed text-center">
                  ⚠️ <strong>Warning:</strong> Some active games are still playing. Scoring prior to game completions is restricted to SuperAdmins.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Participant Payment Tracker & Roster */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl overflow-hidden backdrop-blur-sm">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/10">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Users size={14} className="text-indigo-400" /> Member Roster & Payments
              </h4>
              <span className="text-[10px] text-slate-500 font-bold bg-slate-950 px-2 py-0.5 border border-slate-850 rounded-full">
                {entries.length} members
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/20 text-slate-500">
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider">Name</th>
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Status</th>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Strikes</th>
                        <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-center">Rebuys</th>
                      </>
                    )}
                    {type === 'NFL_MARGIN' && (
                      <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-right">Margin Score</th>
                    )}
                    <th className="py-3.5 px-5 font-bold uppercase tracking-wider text-right w-36">Payment Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-900/10 transition-colors">
                      <td className="py-3.5 px-5 font-extrabold text-white">{entry.userName}</td>
                      
                      {/* Survivor Details */}
                      {type === 'NFL_SURVIVOR' && (
                        <>
                          <td className="py-3.5 px-5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                              entry.status === 'ALIVE' 
                                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                            }`}>
                              {entry.status ?? 'ALIVE'}
                            </span>
                          </td>
                          <td className="py-3.5 px-5 text-center font-bold font-mono text-slate-400">
                            {entry.strikesUsed ?? 0}
                          </td>
                          <td className="py-3.5 px-5 text-center font-bold font-mono text-slate-400">
                            {entry.rebuysUsed ?? 0}
                          </td>
                        </>
                      )}

                      {/* Margin Details */}
                      {type === 'NFL_MARGIN' && (
                        <td className="py-3.5 px-5 text-right font-black font-mono text-white">
                          {entry.seasonTotal ?? 0} pts
                        </td>
                      )}

                      {/* Payment Action */}
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleTogglePayment(entry.id, entry.paidStatus)}
                          disabled={isSavingPayment === entry.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all hover:scale-[1.03] cursor-pointer ${
                            entry.paidStatus === 'PAID'
                              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-rose-500/10 border border-rose-500/25 text-rose-400 hover:bg-rose-500/20'
                          }`}
                        >
                          <DollarSign size={10} />
                          {isSavingPayment === entry.id ? 'Saving...' : entry.paidStatus || 'UNPAID'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
