import React, { useEffect, useMemo, useState } from 'react';
import { BarChart2, Eye } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { useSiteConsensusState } from './pickSheet/useSiteConsensus';
import { readStoredScope, writeStoredScope, type DistributionScope } from './pickSheet/distributionScope';
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
//
// 🔨 KEVIN 2026-08-27 — SCOPE TOGGLE. The card now reads EITHER the pool-scoped
// aggregate (`pools/{id}/consensus`) or the Site-Wide one
// (`consensus/{season}_{seasonType}_{week}/{poolType}`), and the reader chooses.
// Both projections already existed and are written by the same recompute
// (`functions/src/consensus.ts`); the site one was already on the pick rows, and
// only this card was not wired to it. Site scope is confined to pools of the SAME
// type, season and seasonType — a Pick'em pool never sees Survivor or Margin
// picks — and it is the same counts-only aggregate, so it widens the crowd, not
// the disclosure. It also fixes the small-pool anonymity problem above for anyone
// who prefers the wider number: a one-player pool reads as its own picks, the
// site number does not.
export const PickDistribution: React.FC<PickDistributionProps> = ({
  pool,
  games,
  week,
}) => {
  const [scope, setScope] = useState<DistributionScope>(readStoredScope);
  const selectScope = (next: DistributionScope) => {
    setScope(next);
    writeStoredScope(next);
  };

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
  // every other consensus reader shares — out of this PR's bounds. The
  // site-scoped path shares the ambiguity for the same reason.
  //
  // The `poolId` stamp is the same render-time invalidation the site hook carries
  // (codex r2 P2): resetting `loaded` only inside the effect leaves one painted
  // frame where `pool.id` is already the new pool and `loaded` is still the old
  // one's `true`.
  const [consensus, setConsensus] = useState<{ poolId: string; byGame: Record<string, any> }>({
    poolId: pool.id, byGame: {},
  });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    setLoadedFor(null);
    return dbService.subscribeToPoolConsensus(pool.id, (byGame) => {
      setConsensus({ poolId: pool.id, byGame });
      setLoadedFor(pool.id);
    });
  }, [pool.id]);
  const poolByGame = consensus.poolId === pool.id ? consensus.byGame : {};
  const loaded = loadedFor === pool.id;

  // BOTH subscriptions run regardless of scope. Subscribing only to the selected
  // one would make every toggle a fresh round-trip that shows "Loading picks…"
  // for a card the reader has already seen — and the site projection is a small
  // per-week document set that the pick rows on this same screen are already
  // reading, so it costs nothing new.
  const site = useSiteConsensusState(pool, week);

  const isSite = scope === 'site';
  const scopeLoaded = isSite ? site.loaded : loaded;

  // Compile pick distribution statistics from the selected server aggregate
  const distributionData = useMemo(() => {
    if (games.length === 0) return [];

    return games.map(game => {
      // The two projections are the same shape by construction (`projDoc` in
      // functions/src/consensus.ts writes both), but the site hook has already
      // dropped rows with no picks and narrowed the types, so it is read directly
      // rather than through the same `typeof` guards.
      const c = isSite ? site.byGame[game.id] : poolByGame[game.id];
      // `undefined` where the aggregate has nothing for this game — NOT 0.
      // The renderer distinguishes "not loaded" from "loaded, nobody picked".
      return {
        game,
        totalPicksForGame: typeof c?.total === 'number' ? c.total : undefined,
        homePct: typeof c?.homePct === 'number' ? c.homePct : undefined,
        awayPct: typeof c?.awayPct === 'number' ? c.awayPct : undefined,
      };
    });
  }, [poolByGame, site.byGame, isSite, games, week]);

  const tabClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] transition-colors ${
      active
        ? 'bg-navy-700 text-white dark:bg-gold-400 dark:text-navy-900'
        : 'text-muted hover:text-[color:var(--text)]'
    }`;

  return (
    <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
          <BarChart2 size={15} className="text-navy-700 dark:text-gold-400" /> Pick Distribution
        </h3>
        {/* TOGGLE BUTTONS (`aria-pressed`), deliberately NOT `role="radiogroup"`
            with `role="radio"`. A radio group carries a keyboard contract — arrow
            keys move between options and only one option is in the tab order —
            and announcing that contract without implementing it is worse for a
            screen-reader user than not claiming it: they press Right, nothing
            happens, and the control appears broken. Two pressed-state buttons
            state which scope is showing and behave exactly as they look. */}
        <div
          role="group"
          aria-label="Pick distribution scope"
          className="flex items-center gap-1 bg-page border border-line rounded-lg p-0.5"
        >
          <button
            type="button"
            aria-pressed={!isSite}
            onClick={() => selectScope('pool')}
            className={tabClass(!isSite)}
          >
            My Pool
          </button>
          <button
            type="button"
            aria-pressed={isSite}
            onClick={() => selectScope('site')}
            className={tabClass(isSite)}
          >
            Site
          </button>
        </div>
      </div>

      {/* Says WHOSE picks the numbers below are. Without it the two scopes are
          indistinguishable on a week where they happen to agree, and "42 picks"
          on a three-player pool reads as a defect rather than a wider crowd. */}
      <p className="font-body text-[12px] text-faint">
        {isSite
          ? 'Everyone on the site playing this pool type, this week.'
          : 'This pool only.'}
      </p>

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
                  {/* `scopeLoaded` IS THE DISCRIMINATOR, not the presence of a
                      per-game entry. Once the snapshot has arrived, a game the
                      aggregate says nothing about genuinely has NO picks — the
                      consensus doc is written on the first pick, so an unpicked
                      game never has one. Testing `totalPicksForGame !== undefined`
                      instead made every such game read "—" (and, below, "Loading
                      picks…") for ever. */}
                  {!scopeLoaded ? '—' : `${totalPicksForGame ?? 0} ${(totalPicksForGame ?? 0) === 1 ? 'pick' : 'picks'}`}
                </span>
              </div>

              {/* Progress Bar Distribution */}
              {!scopeLoaded || !totalPicksForGame ? (
                <div className="h-10 border border-dashed border-line rounded-md flex items-center justify-center font-display font-bold uppercase text-[11px] tracking-[0.08em] text-faint bg-page/50">
                  {scopeLoaded ? 'No picks yet' : 'Loading picks…'}
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
