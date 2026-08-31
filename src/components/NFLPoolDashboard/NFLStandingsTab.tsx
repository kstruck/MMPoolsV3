import React, { useState } from 'react';
import { BarChart3, CalendarRange, Trophy } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import type { PoolPicksReveal } from '../../services/dbService';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType } from '../../utils/nflPending';
import type { StandingsScope } from '../../utils/nflStandingsScope';
import { NFLStandings } from './NFLStandings';
import { NFLResults } from './NFLResults';

/**
 * T10 — the merged Standings tab.
 *
 * ONE tab, one segmented scope control, on every NFL pool type. This component
 * owns nothing but the segment: it RE-PARENTS the two tested tables that were
 * already on screen and rewrites no ranking logic. `utils/nflResults.ts` still
 * ranks the week, `NFLStandings` still ranks the season.
 *
 * - **Season** (default) — `NFLStandings` with its week-scoped columns off, so
 *   a season page reads as a season page. Before this, the dominant columns on
 *   the season table were the week's pick cell and the week's tiebreaker guess,
 *   which is what made members go looking for the season totals on Results.
 * - **{Week}** — `NFLResults`' weekly table, row-expand pick reveal included.
 * - **Summary** — the players x weeks grid ("Season Summary" / "Margin
 *   Summary").
 *
 * ⚠️ SURVIVOR IS UNCHANGED, deliberately: no control, no segments, the same
 * single table it has always had. A survivor week has no score to tabulate, so
 * there is no weekly table to switch to — and Kevin named Survivor as the shape
 * the other types should copy.
 *
 * ⚠️ Margin's old "Margin Standings" sub-view is GONE and that is the point.
 * It was a Standings table living inside the Results tab, competing with the
 * Standings tab by name; the Season segment's Margin columns (Negative Burden /
 * Win Wks / Best Wk / Season Total) are a superset of what it showed.
 */
interface NFLStandingsTabProps {
  pool: Pool;
  /**
   * `buildMemberStandings` rows. Opaque HERE on purpose — this component only
   * hands them to the two tables that already know their shape, and typing them
   * `any` would be a new lint warning for a value it never reads.
   */
  entries: unknown[];
  games: NFLGame[];
  week: number;
  viewerUid?: string;
  pickCounts?: Record<string, number>;
  reveal?: PoolPicksReveal | null;
  ownEntryLoaded?: boolean;
  /**
   * Where the URL asked to land. `week` when the reader arrived on a stale
   * `?tab=results` link — see `utils/nflStandingsScope.ts`.
   */
  scope?: StandingsScope;
}

export const NFLStandingsTab: React.FC<NFLStandingsTabProps> = ({
  pool,
  entries,
  games,
  week,
  viewerUid,
  pickCounts,
  reveal,
  ownEntryLoaded = false,
  scope: requestedScope = 'season',
}) => {
  const isSurvivor = pool.type === 'NFL_SURVIVOR';
  const isMargin = pool.type === 'NFL_MARGIN';
  const seasonType = poolSeasonType(pool);

  // Follows the URL, and resets with the pool: `PoolRoute` reuses this
  // component across pool navigation, so a segment chosen in one pool would
  // otherwise leak into the next one (the same reason `NFLResults` resets its
  // own toggle on `pool.id`).
  //
  // Adjusted DURING RENDER against a reset key rather than in an effect. An
  // effect would set state synchronously on every pool/URL change — a cascading
  // render, and a lint error in this repo — and would render one frame of the
  // OLD pool's segment first.
  const resetKey = `${pool.id}|${requestedScope}`;
  const [chosen, setChosen] = useState<{ key: string; scope: StandingsScope }>({
    key: resetKey,
    scope: requestedScope,
  });
  const scope = chosen.key === resetKey ? chosen.scope : requestedScope;
  const setScope = (next: StandingsScope) => setChosen({ key: resetKey, scope: next });

  if (isSurvivor) {
    return (
      <NFLStandings
        pool={pool}
        entries={entries}
        games={games}
        week={week}
        viewerUid={viewerUid}
        pickCounts={pickCounts}
        reveal={reveal}
        ownEntryLoaded={ownEntryLoaded}
      />
    );
  }

  const segments: Array<{ key: StandingsScope; label: string; icon: React.ReactNode }> = [
    { key: 'season', label: 'Season', icon: <Trophy size={13} /> },
    // The week LABEL, not the words "This Week": the week selector is pool-wide
    // and a reader looking back at Week 1 in Week 5 would be told they are
    // looking at "this" week. The plan's wording, the header's job.
    { key: 'week', label: nflWeekLabel(seasonType, week), icon: <CalendarRange size={13} /> },
    { key: 'summary', label: 'Summary', icon: <BarChart3 size={13} /> },
  ];

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Standings scope"
        className="flex rounded-full border border-line overflow-hidden w-fit"
      >
        {segments.map(s => (
          <button
            key={s.key}
            type="button"
            aria-pressed={scope === s.key}
            onClick={() => setScope(s.key)}
            className={`px-4 py-1.5 font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors flex items-center gap-1.5 ${
              scope === s.key
                ? 'bg-navy-700 text-white dark:bg-gold-500 dark:text-navy-900'
                : 'bg-page text-muted hover:text-[color:var(--text)]'
            }`}
          >
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {scope === 'season' ? (
        <NFLStandings
          pool={pool}
          entries={entries}
          games={games}
          week={week}
          viewerUid={viewerUid}
          pickCounts={pickCounts}
          reveal={reveal}
          ownEntryLoaded={ownEntryLoaded}
          seasonOnly
        />
      ) : (
        <NFLResults
          pool={pool}
          entries={entries}
          games={games}
          week={week}
          viewerUid={viewerUid}
          reveal={reveal}
          ownEntryLoaded={ownEntryLoaded}
          view={scope === 'week' ? 'WEEKLY' : isMargin ? 'SUMMARY' : 'SEASON'}
        />
      )}
    </div>
  );
};
