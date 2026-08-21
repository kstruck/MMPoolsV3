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
  // `loaded` is not ceremony. Until the first snapshot arrives every game is
  // absent from the map, and rendering that as "0 picks / No picks yet" states a
  // fact the client does not have — the same substitute-for-unavailable-data
  // problem the standings cell has (qodo #5 on this PR). Before the snapshot the
  // card says so; after it, an absent game genuinely means nobody has picked.
  //
  // ⚠️ KNOWN AMBIGUITY, left as it is: `subscribeToPoolConsensus` reports a
  // read FAILURE by calling back with `{}` (dbService), so a permission error
  // and an empty pool are indistinguishable here and both land as "no picks
  // yet". Narrowing that means changing the subscription's error contract, which
  // every other consensus reader shares — out of this PR's bounds.
  const [consensus, setConsensus] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    return dbService.subscribeToPoolConsensus(pool.id, (byGame) => {
      setConsensus(byGame);
      setLoaded(true);
    });
  }, [pool.id]);

  // Compile pick distribution statistics from the server aggregate
  const distributionData = useMemo(() => {
    if (games.length === 0) return [];

    return games.map(game => {
      const c = consensus[game.id];
      // `undefined` where the aggregate has nothing for this game — NOT 0.
      // The renderer distinguishes "not loaded" from "loaded, nobody picked".
      return {
        game,
        totalPicksForGame: typeof c?.total === 'number' ? c.total : undefined,
        homePct: typeof c?.homePct === 'number' ? c.homePct : undefined,
        awayPct: typeof c?.awayPct === 'number' ? c.awayPct : undefined,
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
                  <Eye size={10} aria-hidden="true" />{' '}
                  {/* `loaded` IS THE DISCRIMINATOR, not the presence of a
                      per-game entry. Once the snapshot has arrived, a game the
                      aggregate says nothing about genuinely has NO picks — the
                      consensus doc is written on the first pick, so an unpicked
                      game never has one. Testing `totalPicksForGame !== undefined`
                      instead made every such game read "—" (and, below, "Loading
                      picks…") for ever. */}
                  {!loaded ? '—' : `${totalPicksForGame ?? 0} ${(totalPicksForGame ?? 0) === 1 ? 'pick' : 'picks'}`}
                </span>
              </div>

              {/* Progress Bar Distribution */}
              {!loaded || !totalPicksForGame ? (
                <div className="h-10 border border-dashed border-line rounded-md flex items-center justify-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint bg-page/50">
                  {loaded ? 'No picks yet' : 'Loading picks…'}
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
