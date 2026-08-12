import React from 'react';
import { Check } from 'lucide-react';
import type { NFLGame } from '../../../types';
import { teamColorStyle } from '../../../utils/nflTeamColors';

/** One side of a matchup. `NFLGame` declares these inline, so it is named here. */
export type PickTeam = NFLGame['homeTeam'];

/**
 * One tappable team on a pick sheet — the unit every NFL pick surface repeats.
 *
 * It exists because Survivor, Margin and Pick'em each grew their own copy of the
 * same button with slightly different rules about what counts as "selected", and
 * Kevin's testers asked for the same additions on all three (records, the crowd
 * split, team colours). One component means one place to add them, and one place
 * for the next reviewer to check.
 *
 * SELECTED STATE IS THE TEAM'S OWN COLOUR, with the city name behind it as a
 * watermark — the CBS treatment Kevin pointed at. When the abbreviation is not in
 * the colour map (ESPN has renamed teams before) it falls back to the app's gold
 * selection styling rather than guessing a colour.
 */

export interface TeamPickButtonProps {
  team: PickTeam;
  /** City / place name, drawn as the watermark behind a selected card. */
  subtitle?: string;
  /** "2-1" — from `computeTeamRecords`; omitted entirely when unknown. */
  record?: string;
  /** Percentage of site-wide picks on this team, 0-100. Omitted when unknown. */
  consensusPct?: number;
  selected: boolean;
  /** The pick the SERVER holds. Drives the "saved" vs "unsaved change" badge. */
  saved?: boolean;
  disabled?: boolean;
  /** Small pill in the top-left, e.g. "Used" / "2/3 used" on Survivor. */
  badge?: string | null;
  onSelect: () => void;
  title?: string;
}

export const TeamPickButton: React.FC<TeamPickButtonProps> = ({
  team,
  subtitle,
  record,
  consensusPct,
  selected,
  saved = false,
  disabled = false,
  badge,
  onSelect,
  title,
}) => {
  const colour = selected ? teamColorStyle(team.abbreviation) : undefined;

  // Unselected cards are ordinary surface cards. Selected ones take the team's
  // colour when we know it; when we do not, the app's own selection styling is
  // the fallback — a card with no visible selected state would be worse than an
  // off-brand one.
  const base = 'relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 p-3 rounded-lg border text-center transition-all duration-150 overflow-hidden';
  const state = selected
    ? (colour ? 'border-transparent shadow-card-hover' : 'bg-gold-400/15 border-gold-500 shadow-card-hover')
    : disabled
      ? 'bg-page border-line opacity-40 cursor-not-allowed'
      : 'bg-page border-line hover:-translate-y-0.5 hover:shadow-card-hover';

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      title={title}
      className={`${base} ${state}`}
      style={colour ? { backgroundColor: colour.bg, color: colour.fg } : undefined}
    >
      {/* City watermark — decorative, and hidden from assistive tech because the
          team name below already says it. `select-none` + `pointer-events-none`
          keep it from swallowing the tap on the button it sits inside. */}
      {selected && subtitle && (
        <span
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex items-center justify-center font-display font-bold uppercase tracking-[0.08em] text-[26px] opacity-[0.14] whitespace-nowrap"
        >
          {subtitle}
        </span>
      )}

      {badge && (
        <span className="absolute top-1.5 left-1.5 z-10 bg-page/90 border border-line text-faint text-[8px] font-display font-bold tracking-[0.16em] px-1.5 py-0.5 rounded-full uppercase">
          {badge}
        </span>
      )}

      {selected && (
        <span
          className={`absolute top-1.5 right-1.5 z-10 p-0.5 rounded-full ${
            saved ? 'bg-[#0F7B4A] text-white' : 'bg-gold-500 text-navy-900'
          }`}
          title={saved ? 'Saved' : 'Not saved yet'}
        >
          <Check size={10} className="stroke-[4]" aria-hidden="true" />
        </span>
      )}

      <div className="relative z-10 flex flex-col items-center gap-0.5 w-full">
        {team.logoUrl && (
          <img src={team.logoUrl} className="w-10 h-10 object-contain" alt="" aria-hidden="true" />
        )}
        <span className="font-display font-bold text-[13px] leading-tight truncate w-full">
          {team.name}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-display font-bold tracking-[0.1em] opacity-80 num">
          <span>{team.abbreviation}</span>
          {record && <span>{record}</span>}
        </span>
        {/* The crowd split. Rendered only when the site-wide aggregate has data
            for this game — `0%` and "nobody has picked yet" are different facts
            and the caller passes `undefined` for the second. */}
        {consensusPct !== undefined && (
          <span className="text-[9px] font-display font-bold tracking-[0.08em] opacity-70 num">
            {Math.round(consensusPct)}% picked
          </span>
        )}
      </div>
    </button>
  );
};
