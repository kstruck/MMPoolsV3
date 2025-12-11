import type { GameState } from './types';

export const DEFAULT_SQUARES = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  owner: null,
  isPaid: false
}));

export const createNewPool = (name: string = 'New March Melee Pool', ownerId?: string): GameState => ({
  id: Math.random().toString(36).substring(2, 9),
  name,
  urlSlug: Math.random().toString(36).substring(2, 7),
  contactEmail: '',
  paymentInstructions: 'Venmo @YourName to participate. Payments due before kickoff.',
  theme: 'Default Theme',
  gridUsername: '',
  gridPassword: '',

  homeTeam: '',
  awayTeam: '',
  gameId: undefined,

  costPerSquare: 10,
  maxSquaresPerPlayer: 10,
  lockGrid: false,
  numberSets: 1,

  gridSize: '10x10',
  numberTheSquares: true,
  showPaid: true,

  emailConfirmation: 'No Email Confirmation',
  notifyAdminFull: true,
  emailNumbersGenerated: false,

  collectReferral: false,
  collectPhone: false,
  collectNotes: false,
  collectAddress: false,

  additionalLinks: [],

  requireCode: false,
  enableSecondaryAdmins: false,

  isPublic: true,
  squares: Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null, isPaid: false })), // Deep copy
  axisNumbers: null,
  scores: {
    current: null,
    q1: null,
    half: null,
    q3: null,
    final: null,
  },
  scoreEvents: [],
  scoreChangePayoutAmount: 5, // Default $5 per score change
  payouts: {
    q1: 20,
    half: 20,
    q3: 20,
    final: 40,
  },
  isLocked: false,
  ruleVariations: {
    reverseWinners: false,
    quarterlyRollover: true,
    scoreChangePayout: false,
  },
  ownerId
});

export const PERIOD_LABELS: Record<string, string> = {
  q1: '1st Quarter',
  half: 'Halftime',
  q3: '3rd Quarter',
  final: 'Final Score',
};

// NFL Team Data for Logos
export const NFL_TEAMS: Record<string, { name: string; abbr: string; logo: string }> = {
  'ari': { name: 'Cardinals', abbr: 'ARI', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png' },
  'atl': { name: 'Falcons', abbr: 'ATL', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png' },
  'bal': { name: 'Ravens', abbr: 'BAL', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png' },
  'buf': { name: 'Bills', abbr: 'BUF', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png' },
  'car': { name: 'Panthers', abbr: 'CAR', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png' },
  'chi': { name: 'Bears', abbr: 'CHI', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  'cin': { name: 'Bengals', abbr: 'CIN', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png' },
  'cle': { name: 'Browns', abbr: 'CLE', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png' },
  'dal': { name: 'Cowboys', abbr: 'DAL', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  'den': { name: 'Broncos', abbr: 'DEN', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png' },
  'det': { name: 'Lions', abbr: 'DET', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  'gb': { name: 'Packers', abbr: 'GB', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png' },
  'hou': { name: 'Texans', abbr: 'HOU', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png' },
  'ind': { name: 'Colts', abbr: 'IND', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png' },
  'jax': { name: 'Jaguars', abbr: 'JAX', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png' },
  'kc': { name: 'Chiefs', abbr: 'KC', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png' },
  'lac': { name: 'Chargers', abbr: 'LAC', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png' },
  'lar': { name: 'Rams', abbr: 'LAR', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png' },
  'lv': { name: 'Raiders', abbr: 'LV', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png' },
  'mia': { name: 'Dolphins', abbr: 'MIA', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png' },
  'min': { name: 'Vikings', abbr: 'MIN', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' },
  'ne': { name: 'Patriots', abbr: 'NE', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png' },
  'no': { name: 'Saints', abbr: 'NO', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png' },
  'nyg': { name: 'Giants', abbr: 'NYG', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png' },
  'nyj': { name: 'Jets', abbr: 'NYJ', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png' },
  'phi': { name: 'Eagles', abbr: 'PHI', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  'pit': { name: 'Steelers', abbr: 'PIT', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png' },
  'sea': { name: 'Seahawks', abbr: 'SEA', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' },
  'sf': { name: '49ers', abbr: 'SF', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' },
  'tb': { name: 'Buccaneers', abbr: 'TB', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png' },
  'ten': { name: 'Titans', abbr: 'TEN', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png' },
  'wsh': { name: 'Commanders', abbr: 'WSH', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' },
};

// Helper to find logo from input string (fuzzy match)
export const getTeamLogo = (input: string): string | null => {
  if (!input) return null;
  const lower = input.toLowerCase();

  // Direct Key Match
  if (NFL_TEAMS[lower]) return NFL_TEAMS[lower].logo;

  // Name/Abbr Match
  const key = Object.keys(NFL_TEAMS).find(k =>
    NFL_TEAMS[k].name.toLowerCase().includes(lower) ||
    lower.includes(NFL_TEAMS[k].name.toLowerCase()) ||
    NFL_TEAMS[k].abbr.toLowerCase() === lower
  );

  return key ? NFL_TEAMS[key].logo : null;
};