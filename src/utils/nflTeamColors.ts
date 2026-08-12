/**
 * Primary brand colour per NFL team, keyed by the abbreviation every pick
 * surface already uses.
 *
 * A STATIC MAP ON PURPOSE. ESPN's scoreboard payload does carry `team.color`,
 * but `nfl_games` does not store it (see `NFLGame` in src/types) — so using the
 * feed would mean an importer field, a functions deploy and a backfill for a
 * value that changes roughly never. Thirty-two hex strings cost nothing and work
 * on data already in hand.
 *
 * These are the teams' PRIMARY colours. Several are dark enough that white text
 * is the only legible foreground, which is why `teamColorStyle` below returns a
 * ready-made pair rather than just the hex — a caller that picks its own text
 * colour will eventually get navy-on-navy.
 *
 * ⚠️ Unknown abbreviation → `undefined`, and every caller must render a neutral
 * fallback for that. Abbreviations are ESPN's and have changed before (WSH, LAR,
 * LAC, LV), so a missing key is a live possibility rather than a defensive
 * flourish.
 */

const TEAM_COLORS: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D',
  CAR: '#0085CA', CHI: '#0B162A', CIN: '#FB4F14', CLE: '#311D00',
  DAL: '#041E42', DEN: '#FB4F14', DET: '#0076B6', GB: '#203731',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', KC: '#E31837',
  LV: '#000000', LAC: '#0080C6', LAR: '#003594', MIA: '#008E97',
  MIN: '#4F2683', NE: '#002244', NO: '#D3BC8D', NYG: '#0B2265',
  NYJ: '#125740', PHI: '#004C54', PIT: '#FFB612', SEA: '#002244',
  SF: '#AA0000', TB: '#D50A0A', TEN: '#0C2340', WSH: '#5A1414',
};

/** Legacy / alternate abbreviations seen in older `nfl_games` documents. */
const ALIASES: Record<string, string> = {
  WAS: 'WSH', JAC: 'JAX', LA: 'LAR', SD: 'LAC', OAK: 'LV', STL: 'LAR',
};

export function teamColor(abbr: string | undefined): string | undefined {
  if (!abbr) return undefined;
  const key = abbr.toUpperCase();
  return TEAM_COLORS[key] ?? TEAM_COLORS[ALIASES[key] ?? ''];
}

/**
 * Relative luminance of a #RRGGBB colour, per WCAG. Used only to choose between
 * white and near-black text, which is the whole reason this file computes
 * anything at all: two of the colours above (PIT gold, NO gold) are light enough
 * that white text on them is unreadable, and hardcoding "white always" would
 * have shipped exactly that.
 */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export interface TeamColorStyle {
  /** The team's primary colour. */
  bg: string;
  /** White or near-black, whichever is legible on `bg`. */
  fg: string;
}

/**
 * Background + legible foreground for a selected team's card, or `undefined`
 * when the abbreviation is unknown — callers fall back to the app's own
 * selection styling rather than guessing a colour.
 */
export function teamColorStyle(abbr: string | undefined): TeamColorStyle | undefined {
  const bg = teamColor(abbr);
  if (!bg) return undefined;
  // 0.45 rather than the usual 0.5: measured against this palette, it puts PIT
  // (#FFB612) and NO (#D3BC8D) on dark text and everything else on white, which
  // is the split the eye expects.
  return { bg, fg: luminance(bg) > 0.45 ? '#0B162A' : '#FFFFFF' };
}
