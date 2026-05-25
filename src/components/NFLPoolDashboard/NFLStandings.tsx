import React, { useMemo } from 'react';
import { Trophy, Heart, ShieldAlert, Award, Star, ArrowUpRight, ArrowDownRight, Compass, Shield } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';

interface NFLStandingsProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
}

export const NFLStandings: React.FC<NFLStandingsProps> = ({
  pool,
  entries,
  games,
  week
}) => {
  const type = pool.type;

  // Rank and sort entries based on pool type rulesets
  const sortedEntries = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    const copy = [...entries];

    if (type === 'NFL_PICKEM') {
      // Sort Pick'em: totalScore desc, then correctCount desc (fallback), then name
      return copy.sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

    if (type === 'NFL_SURVIVOR') {
      // Sort Survivor: ALIVE first, then lowest strikes, then lowest rebuys, then eliminated week desc
      return copy.sort((a, b) => {
        const aAlive = a.status === 'ALIVE' ? 1 : 0;
        const bAlive = b.status === 'ALIVE' ? 1 : 0;

        if (bAlive !== aAlive) {
          return bAlive - aAlive; // ALIVE first
        }

        // If both ALIVE, sort by strikes used (lower strikes is better)
        if (a.status === 'ALIVE') {
          if (a.strikesUsed !== b.strikesUsed) {
            return a.strikesUsed - b.strikesUsed;
          }
          if (a.rebuysUsed !== b.rebuysUsed) {
            return a.rebuysUsed - b.rebuysUsed;
          }
        } else {
          // If both ELIMINATED, sort by who lasted longest
          const aElimWeek = a.eliminatedWeek ?? 0;
          const bElimWeek = b.eliminatedWeek ?? 0;
          if (bElimWeek !== aElimWeek) {
            return bElimWeek - aElimWeek; // Lasted longer is better
          }
        }

        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

    if (type === 'NFL_MARGIN') {
      // Sort Margin: 5-level tiebreaker cascade
      return copy.sort((a, b) => {
        // 1. Season Total (higher is better)
        const aTotal = a.seasonTotal ?? 0;
        const bTotal = b.seasonTotal ?? 0;
        if (bTotal !== aTotal) {
          return bTotal - aTotal;
        }

        // 2. Lowest Negative Burden (lower is better)
        const aBurden = a.negativeBurden ?? 0;
        const bBurden = b.negativeBurden ?? 0;
        if (aBurden !== bBurden) {
          return aBurden - bBurden;
        }

        // 3. Most Positive Weeks (higher is better)
        const aPos = a.positiveWeeks ?? 0;
        const bPos = b.positiveWeeks ?? 0;
        if (bPos !== aPos) {
          return bPos - aPos;
        }

        // 4. Highest Single Week (higher is better)
        const aBest = a.bestWeek ?? 0;
        const bBest = b.bestWeek ?? 0;
        if (bBest !== aBest) {
          return bBest - aBest;
        }

        // 5. Deterministic fallback
        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

    return copy;
  }, [entries, type]);

  const renderRankBadge = (index: number) => {
    if (index === 0) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-black shadow-sm shadow-amber-500/5">
          <Star size={10} className="fill-amber-400 mr-0.5" /> 1
        </span>
      );
    }
    if (index === 1) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-350/20 text-slate-350 border border-slate-350/30 text-xs font-black">
          2
        </span>
      );
    }
    if (index === 2) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-600 border border-amber-700/30 text-xs font-black">
          3
        </span>
      );
    }
    return <span className="text-slate-500 font-mono text-xs font-bold pl-2">{index + 1}</span>;
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-3xl overflow-hidden backdrop-blur-sm">
      <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/10">
        <h3 className="text-base font-black text-white flex items-center gap-2">
          <Trophy size={18} className="text-yellow-500" /> Standings Leaderboard
        </h3>
        <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-widest bg-slate-950 border border-slate-850 px-3 py-1 rounded-full">
          {entries.length} Entries
        </span>
      </div>

      <div className="overflow-x-auto">
        {sortedEntries.length === 0 ? (
          <div className="text-center py-12 text-slate-500 font-bold">
            No entries have registered in this pool yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-950/20">
                <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 w-16">Rank</th>
                <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Player</th>
                
                {/* Custom Pool Columns */}
                {type === 'NFL_PICKEM' && (
                  <>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Week {week} Pick</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">MNF Score</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-right w-24">Total Points</th>
                  </>
                )}

                {type === 'NFL_SURVIVOR' && (
                  <>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Status</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Strikes</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Rebuys</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Week {week} Pick</th>
                  </>
                )}

                {type === 'NFL_MARGIN' && (
                  <>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Week {week} Pick</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Negative Burden</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Win Wks</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-center">Best Wk</th>
                    <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-right w-28">Season Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sortedEntries.map((entry, index) => {
                const isMyEntry = false; // user profile checking is bypassed/not needed for row highlight

                return (
                  <tr
                    key={entry.id}
                    className={`transition-colors hover:bg-slate-900/20 ${
                      isMyEntry ? 'bg-indigo-500/5 hover:bg-indigo-500/10' : ''
                    }`}
                  >
                    {/* Rank */}
                    <td className="py-4 px-6 font-bold">{renderRankBadge(index)}</td>

                    {/* Username */}
                    <td className="py-4 px-6 font-extrabold text-white text-sm">
                      {entry.userName}
                      {isMyEntry && (
                        <span className="ml-1.5 text-[8px] font-black tracking-widest text-indigo-400 uppercase bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                          Me
                        </span>
                      )}
                    </td>

                    {/* Pick'em Columns */}
                    {type === 'NFL_PICKEM' && (
                      <>
                        <td className="py-4 px-6 text-center text-xs font-bold text-slate-400">
                          {Object.keys(entry.picks || {}).length} Picks Set
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-mono font-bold text-slate-500">
                          {entry.weeklyTiebreakers?.[week] ? `${entry.weeklyTiebreakers[week]} pts` : '—'}
                        </td>
                        <td className="py-4 px-6 text-right font-black text-white text-sm font-mono">
                          {entry.totalScore ?? 0}
                        </td>
                      </>
                    )}

                    {/* Survivor Columns */}
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <td className="py-4 px-6 text-center">
                          {entry.status === 'ALIVE' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-extrabold text-emerald-400 uppercase tracking-wide">
                              <Heart size={8} className="fill-emerald-400/20" /> Alive
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-[9px] font-extrabold text-rose-400 uppercase tracking-wide">
                              <ShieldAlert size={8} /> Eliminated
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-bold font-mono text-slate-400">
                          {entry.strikesUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-bold font-mono text-slate-400">
                          {entry.rebuysUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-black text-indigo-400 uppercase tracking-wider">
                          {entry.picks?.[week] || (
                            <span className="text-slate-650 italic text-[10px]">No selection</span>
                          )}
                        </td>
                      </>
                    )}

                    {/* Margin Columns */}
                    {type === 'NFL_MARGIN' && (
                      <>
                        <td className="py-4 px-6 text-center text-xs font-black text-indigo-400 uppercase tracking-wider">
                          {entry.picks?.[week] || (
                            <span className="text-slate-650 italic text-[10px]">No selection</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-bold font-mono text-rose-400">
                          -{entry.negativeBurden ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-bold font-mono text-slate-400">
                          {entry.positiveWeeks ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-xs font-bold font-mono text-emerald-400">
                          +{entry.bestWeek ?? 0}
                        </td>
                        <td className="py-4 px-6 text-right font-black text-white text-sm font-mono">
                          {entry.seasonTotal ?? 0}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
