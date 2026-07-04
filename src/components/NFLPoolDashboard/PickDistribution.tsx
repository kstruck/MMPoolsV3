import React, { useMemo } from 'react';
import { BarChart2, Lock, Eye } from 'lucide-react';
import { now as serverNow } from '../../utils/serverClock';
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
    return serverNow() >= (game.startTime - bufferMs);
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
    <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-5">
      <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
        <BarChart2 size={15} className="text-navy-700 dark:text-gold-400" /> Pick Distribution
      </h3>

      <div className="space-y-4">
        {games.length === 0 ? (
          <p className="font-body text-[13px] text-faint italic text-center py-4">No active games scheduled.</p>
        ) : (
          distributionData.map(({ game, locked, homePct, awayPct, totalPicksForGame }) => (
            <div key={game.id} className="bg-page p-4 border border-line rounded-lg space-y-2">
              {/* Game Teams Header */}
              <div className="flex justify-between items-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
                <span>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</span>
                {locked ? (
                  <span className="text-navy-700 dark:text-gold-400 flex items-center gap-1 num">
                    <Eye size={10} /> Revealed ({totalPicksForGame} picks)
                  </span>
                ) : (
                  <span className="text-faint flex items-center gap-1">
                    <Lock size={9} /> Locked until kickoff
                  </span>
                )}
              </div>

              {/* Progress Bar Distribution */}
              {locked ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-baseline font-display font-bold text-[13px] num text-[color:var(--text)]">
                    <span className={awayPct >= homePct ? 'text-navy-700 dark:text-gold-400' : 'text-muted'}>
                      {game.awayTeam.abbreviation} {awayPct}%
                    </span>
                    <span className={homePct >= awayPct ? 'text-navy-700 dark:text-gold-400' : 'text-muted'}>
                      {homePct}% {game.homeTeam.abbreviation}
                    </span>
                  </div>

                  {/* Split distribution bar */}
                  <div className="h-2 w-full bg-line rounded-full overflow-hidden flex">
                    <div
                      className="bg-navy-600 transition-all duration-500"
                      style={{ width: `${awayPct}%` }}
                    />
                    <div
                      className="bg-transparent transition-all duration-500"
                      style={{ width: `${100 - awayPct - homePct}%` }}
                    />
                    <div
                      className="bg-gold-foil transition-all duration-500"
                      style={{ width: `${homePct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-10 border border-dashed border-line rounded-md flex items-center justify-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint bg-page/50">
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
