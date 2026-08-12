import React, { useEffect, useMemo, useState } from 'react';
import { BarChart2, Eye } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { Pool, NFLGame } from '../../types';

interface PickDistributionProps {
  pool: Pool;
  games: NFLGame[];
  week: number;
}

// Reads the server Pool Consensus aggregate (ADR 0004/0005) rather than computing
// the distribution client-side from raw entries — members cannot read other
// members' entries pre-FINAL, and this card never needed to.
//
// 🔨 KEVIN'S RULING 2026-08-11 (PLAN-COMMISSIONER-BLIND-PICKS Q4, OVERRULING the
// plan's own recommendation): **the live consensus is visible at all times and is
// never hidden.** This card used to hold each game's split behind that game's
// kickoff. It no longer does, and the plan's T5 — which would have gated the
// underlying `pools/{id}/consensus` documents to match — is dead.
//
// The split is an AGGREGATE: it says what fraction of the pool took each side,
// never who. Kevin's position is that a live crowd split is a feature of the
// product, and the thing commissioner-blind picks protects is an INDIVIDUAL's
// pick, which this card cannot express. `CONTEXT.md` §Pool Consensus was corrected
// to match the ruling; it previously described a post-lock reveal, and the ruling
// wins over the glossary.
//
// ⚠️ Small pools make the aggregate less anonymous — in a 2-person pool the split
// identifies both picks. That is a known and accepted consequence of the ruling,
// not an oversight. Reopening it is a product decision for Kevin, not a bug fix.
export const PickDistribution: React.FC<PickDistributionProps> = ({
  pool,
  games,
  week,
}) => {
  const [consensus, setConsensus] = useState<Record<string, any>>({});
  useEffect(() => {
    return dbService.subscribeToPoolConsensus(pool.id, setConsensus);
  }, [pool.id]);

  // Compile pick distribution statistics from the server aggregate
  const distributionData = useMemo(() => {
    if (games.length === 0) return [];

    return games.map(game => {
      const c = consensus[game.id];
      return {
        game,
        totalPicksForGame: c?.total ?? 0,
        homePct: c?.homePct ?? 0,
        awayPct: c?.awayPct ?? 0,
      };
    });
  }, [consensus, games, week]);

  return (
    <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-5">
      <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
        <BarChart2 size={15} className="text-navy-700 dark:text-gold-400" /> Pick Distribution
      </h3>

      <div className="space-y-4">
        {games.length === 0 ? (
          <p className="font-body text-[13px] text-faint italic text-center py-4">No active games scheduled.</p>
        ) : (
          distributionData.map(({ game, homePct, awayPct, totalPicksForGame }) => (
            <div key={game.id} className="bg-page p-4 border border-line rounded-lg space-y-2">
              {/* Game Teams Header */}
              <div className="flex justify-between items-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
                <span>{game.awayTeam.abbreviation} vs {game.homeTeam.abbreviation}</span>
                <span className="text-navy-700 dark:text-gold-400 flex items-center gap-1 num">
                  <Eye size={10} /> {totalPicksForGame} {totalPicksForGame === 1 ? 'pick' : 'picks'}
                </span>
              </div>

              {/* Progress Bar Distribution */}
              {totalPicksForGame === 0 ? (
                <div className="h-10 border border-dashed border-line rounded-md flex items-center justify-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint bg-page/50">
                  No picks yet
                </div>
              ) : (
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
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
