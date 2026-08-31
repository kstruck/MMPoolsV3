import React from 'react';
import { Lock, Radio } from 'lucide-react';
import type { NFLGame } from '../../../types';

/**
 * The one-line context strip above a matchup: day, kickoff time, TV network, and
 * the betting line where one exists.
 *
 * Kevin's testers, 2026-08-11: they wanted the information a CBS pick sheet puts
 * on the row — records, spreads, when it kicks off and where to watch it —
 * without leaving the pick page to find it. This is that row.
 *
 * ⚠️ EVERY FIELD HERE IS OPTIONAL AND OFTEN ABSENT, so each one renders only
 * when present rather than emitting a placeholder. Measured against the live
 * ESPN feed on 2026-08-12:
 *   - `broadcast` exists on 11/16 preseason week-2 games, 13/16 week 3,
 *     11/16 week 4 — local-market games simply carry no national listing.
 *   - `spread` exists on 16/16 week 2 and 0/16 weeks 3-4; preseason lines are
 *     not priced this far out.
 * A row that printed "—" for each missing field would be mostly dashes.
 */

interface GameMetaProps {
  game: NFLGame;
  /** Rendered with a lock glyph when the pick for this game can no longer move. */
  locked?: boolean;
}

/** "Thu 8:00 PM" in the VIEWER's zone — the zone label lives on the deadline copy. */
function kickoffLabel(startTime: number): string {
  const d = new Date(startTime);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

/**
 * The line, written the way a sheet writes it: relative to the FAVOURITE, not to
 * the home team. `spread.value` is stored home-relative (negative = home
 * favoured), which is correct in the data and unreadable on a row — "CIN -6.5"
 * is what a player expects, and "-6.5" alone next to two team names is ambiguous.
 */
export function spreadLabel(game: NFLGame): string | null {
  const v = game.spread?.value;
  if (typeof v !== 'number') return null;
  if (v === 0) return 'PK';
  const favourite = v < 0 ? game.homeTeam?.abbreviation : game.awayTeam?.abbreviation;
  if (!favourite) return null;
  return `${favourite} ${-Math.abs(v)}`;
}

export const GameMeta: React.FC<GameMetaProps> = ({ game, locked }) => {
  const spread = spreadLabel(game);
  const broadcast = game.broadcast;

  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted">
      <span className="num">{kickoffLabel(game.startTime)}</span>

      {broadcast && (
        <>
          <span className="text-faint" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Radio size={9} aria-hidden="true" /> {broadcast}
          </span>
        </>
      )}

      {spread && (
        <>
          <span className="text-faint" aria-hidden="true">·</span>
          <span className="num text-navy-700 dark:text-gold-400" title="Betting line, shown relative to the favourite">
            {spread}
          </span>
        </>
      )}

      {locked && (
        <span className="ml-auto inline-flex items-center gap-1 text-faint">
          <Lock size={9} aria-hidden="true" /> Locked
        </span>
      )}
    </div>
  );
};
