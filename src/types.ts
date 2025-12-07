export interface Player {
  name: string;
  initials: string;
  color: string;
}

export interface PlayerDetails {
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  referral?: string;
}

export interface Square {
  id: number; // 0-99
  owner: string | null; // Name of owner
  playerDetails?: PlayerDetails;
  isPaid?: boolean;
}

export interface GameScore {
  home: number;
  away: number;
}

export interface Scores {
  current: GameScore | null; // Live score right now
  q1: GameScore | null;
  half: GameScore | null;
  q3: GameScore | null;
  final: GameScore | null;
}

export interface PayoutConfig {
  q1: number;
  half: number;
  q3: number;
  final: number;
}

export interface AxisNumbers {
  home: number[]; // Array of 10 numbers (0-9)
  away: number[]; // Array of 10 numbers (0-9)
}

export interface ScoreEvent {
  id: string;
  home: number;
  away: number;
  description: string;
  timestamp: number;
}

export interface LinkItem {
  id: string;
  url: string;
  text: string;
}

export interface GameState {
  id: string; // Unique ID
  name: string; // Pool Name (Title)
  urlSlug: string;
  gridUsername?: string;
  gridPassword?: string;
  contactEmail: string;
  paymentInstructions: string; // Instructions for payment (Venmo, etc.)
  theme: string;

  homeTeam: string; // Row Team
  awayTeam: string; // Column Team
  gameId?: string; // ESPN Game ID for automated tracking

  costPerSquare: number;
  maxSquaresPerPlayer: number;
  lockGrid: boolean; // Alias for isLocked logic in UI, mapped to isLocked
  numberSets: number; // 1 or 4

  // Display Settings
  gridSize: string; // "10x10"
  numberTheSquares: boolean;
  showPaid: boolean;

  // Email Settings
  emailConfirmation: string;
  notifyAdminFull: boolean;
  emailNumbersGenerated: boolean;

  // User Settings
  collectReferral: boolean;
  collectPhone: boolean;
  collectNotes: boolean;
  collectAddress: boolean;

  // Links
  additionalLinks: LinkItem[];

  // Advanced
  requireCode: boolean;
  enableSecondaryAdmins: boolean;

  isPublic: boolean; // Visibility on public listing
  squares: Square[];
  axisNumbers: AxisNumbers | null; // Null means not generated yet
  scores: Scores;
  scoreEvents: ScoreEvent[]; // Log of score changes
  scoreChangePayoutAmount: number; // Fixed $ amount per event
  payouts: PayoutConfig; // Percentages
  isLocked: boolean; // If true, users can't buy squares, numbers are revealed
  ruleVariations: {
    reverseWinners: boolean; // Split pot with reverse digits
    quarterlyRollover: boolean; // Unsold squares roll money to next quarter
    scoreChangePayout: boolean; // Pay fixed amount on every score change
  };
  ownerId?: string; // ID of the user who owns this pool
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string | null; // Allow null for Firebase compatibility
}

export interface Winner {
  period: string; // 'Q1', 'Half', 'Q3', 'Final', 'Event'
  squareId: number; // -1 if rollover
  owner: string;
  amount: number;
  homeDigit: number;
  awayDigit: number;
  isReverse?: boolean;
  isRollover?: boolean;
  description?: string;
}