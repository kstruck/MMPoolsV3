import React, { useMemo } from 'react';
import { BarChart2, Lock, Eye } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';

interface PickDistributionProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
  isWeekLocked: boolean;
}

export const PickDistribution: React.FC<PickDistributionProps> = ({
  pool,
  entries,
  games,
  week,
  isWeekLocked
}) => {
  const settings = (pool as any).settings || {};
  const lockBufferMinutes = settings.lockBufferMinutes ?? 5;

  const isGameLocked = (game: NFLGame): boolean => {
    if (isWeekLocked) return true;
    const bufferMs = lockBufferMinutes * 60 * 1000;
    return Date.now() >= (game.startTime - bufferMs);
  };

  // Compile pick distribution statistics
  const distributionData = useMemo(() => {
    if (!entries || entries.length === 0 || games.length === 0) return [];

    return games.map(game => {
      let homePicksCount = 0;
      let awayPicksCount = 0;
      let totalPicksForGame = 0;

      const locked = isGameLocked(game);

      // Only calculate if the selection is legally revealed (locked)
      if (locked) {
        entries.forEach(entry => {
          if (pool.type === 'NFL_PICKEM') {
            const pick = entry.picks?.[game.id];
            if (pick === game.homeTeam.abbreviation) {
              homePicksCount++;
              totalPicksForGame++;
            } else if (pick === game.awayTeam.abbreviation) {
              awayPicksCount++;
              totalPicksForGame++;
            }
          } else if (pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {
            // Survivor and Margin are stored as week -> pickedTeamId (abbreviation)
            const pick = entry.picks?.[week];
            if (pick === game.homeTeam.abbreviation) {
              homePicksCount++;
              totalPicksForGame++;
            } else if (pick === game.awayTeam.abbreviation) {
              awayPicksCount++;
              totalPicksForGame++;
            }
          }
        });
      }

      const homePct = totalPicksForGame > 0 ? Math.round((homePicksCount / totalPicksForGame) * 100) : 0;
      const awayPct = totalPicksForGame > 0 ? Math.round((awayPicksCount / totalPicksForGame) * 100) : 0;

      return {
        game,
        locked,
        homePicksCount,
        awayPicksCount,
        totalPicksForGame,
        homePct,
        awayPct
      };
    });
  }, [entries, games, week, isWeekLocked]);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm space-y-5">
      <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <BarChart2 size={15} className="text-indigo-400" /> Pick Distribution
      </h3>

      <div className="space-y-4">
        {games.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center py-4">No active games scheduled.</p>
        ) : (
          distributionData.map(({ game, locked, homePct, awayPct, totalPicksForGame }) => (
            <div key={game.id} className="bg-slate-950/50 p-4 border border-slate-900 rounded-2xl space-y-2">
              {/* Game Teams Header */}
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <span>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</span>
                {locked ? (
                  <span className="text-indigo-400 flex items-center gap-1">
                    <Eye size={10} /> Revealed ({totalPicksForGame} picks)
                  </span>
                ) : (
                  <span className="text-slate-600 flex items-center gap-1">
                    <Lock size={9} /> Locked until kickoff
                  </span>
                )}
              </div>

              {/* Progress Bar Distribution */}
              {locked ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-baseline text-xs font-black text-white font-mono">
                    <span className={awayPct >= homePct ? 'text-blue-400' : 'text-slate-405'}>
                      {game.awayTeam.abbreviation} {awayPct}%
                    </span>
                    <span className={homePct >= awayPct ? 'text-blue-400' : 'text-slate-405'}>
                      {homePct}% {game.homeTeam.abbreviation}
                    </span>
                  </div>
                  
                  {/* Glassmorphic progress bar */}
                  <div className="h-2 w-full bg-slate-900 border border-slate-800/80 rounded-full overflow-hidden flex">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                      style={{ width: `${awayPct}%` }}
                    />
                    <div
                      className="bg-slate-900 border-l border-slate-800 transition-all duration-500"
                      style={{ width: `${100 - awayPct - homePct}%` }}
                    />
                    <div
                      className="bg-gradient-to-l from-indigo-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${homePct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-10 border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-[10px] font-bold text-slate-600 tracking-wider uppercase bg-slate-950/20">
                  <Lock size={12} className="mr-1.5" /> Locked until kickoff
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
