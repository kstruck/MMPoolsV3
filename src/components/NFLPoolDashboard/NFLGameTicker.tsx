import React from 'react';
import type { NFLGame } from '../../types';
import { Ticker } from '../ui/Ticker';

/**
 * Auto-scrolling live-score ticker for a week's NFL slate. Real data from `nfl_games`
 * (scores/clock/status). Clicking a game selects it as the homepage focus game.
 */
export const NFLGameTicker: React.FC<{ games: NFLGame[]; onSelectGame?: (gameId: string) => void }> = ({ games, onSelectGame }) => {
  if (!games || games.length === 0) return null;

  return (
    <div className="bg-card border border-line rounded-xl shadow-card py-2.5 px-3 mb-8">
      <Ticker>
        {games.map(g => {
          const live = g.status === 'IN_PROGRESS';
          const final = g.status === 'FINAL';
          const showScore = live || final;
          return (
            <button
              key={g.id}
              onClick={() => onSelectGame?.(g.id)}
              className="inline-flex items-center gap-2 whitespace-nowrap font-display font-bold uppercase text-[12px] tracking-[0.04em] num hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
            >
              {live && <span className="h-1.5 w-1.5 rounded-full bg-brandred-600 animate-live-pulse" />}
              <span className="text-[color:var(--text)]">
                {g.awayTeam.abbreviation}{showScore && <span className="text-gold-600 dark:text-gold-400"> {g.scores?.away ?? 0}</span>}
                <span className="text-faint mx-1">@</span>
                {g.homeTeam.abbreviation}{showScore && <span className="text-gold-600 dark:text-gold-400"> {g.scores?.home ?? 0}</span>}
              </span>
              <span className="text-muted text-[10px]">
                {live ? (g.clock || `Q${g.period || 1}`)
                  : final ? 'FINAL'
                  : new Date(g.startTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>
            </button>
          );
        })}
      </Ticker>
    </div>
  );
};
