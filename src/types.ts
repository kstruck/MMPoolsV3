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
  gameStatus?: 'pre' | 'in' | 'post'; // Track game state
  clock?: string; // e.g. "12:45"
  period?: number; // 0=Pre, 1=Q1, 2=Q2, etc.
  startTime?: string; // ISO String or Display String
}

export interface PayoutConfig {
  q1: number;
  half: number;
  q3: number;
  final: number;
}

export interface CharityConfig {
  enabled: boolean;
  name: string;
  description?: string;
  url?: string;
  percentage: number; // 0-100
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
  managerName: string; // Name of the pool manager
  paymentInstructions: string; // Instructions for payment (Venmo, etc.)
  theme: string;

  homeTeam: string; // Row Team
  awayTeam: string; // Column Team
  league?: 'nfl' | 'college' | 'ncaa'; // League Context
  homeTeamLogo?: string; // API provided logo
  awayTeamLogo?: string; // API provided logo
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
  createdAt?: any; // Firestore Timestamp
  updatedAt?: any; // Firestore Timestamp
  axisNumbers: AxisNumbers | null; // For Single Set (or current set)
  quarterlyNumbers?: {
    q1?: AxisNumbers;
    q2?: AxisNumbers;
    q3?: AxisNumbers;
    q4?: AxisNumbers;
  };
  scores: Scores;
  scoreEvents: ScoreEvent[]; // Log of score changes
  scoreChangePayoutAmount: number; // Fixed $ amount per event
  payouts: PayoutConfig; // Percentages
  charity?: CharityConfig; // Optional charity configuration
  includeOvertime: boolean; // If true, Final score includes OT. If false, Final is end of Q4.
  isLocked: boolean; // If true, users can't buy squares, numbers are revealed
  ruleVariations: {
    reverseWinners: boolean; // Split pot with reverse digits
    quarterlyRollover: boolean; // Unsold squares roll money to next quarter
    scoreChangePayout: boolean; // Pay fixed amount on every score change
    unclaimedFinalPrizeStrategy?: 'last_winner' | 'random';
  };
  randomWinner?: {
    squareId: number;
    owner: string;
    amount: number;
    timestamp: number;
  };
  ownerId?: string; // ID of the user who owns this pool
  manualScoreOverride?: boolean;
  reminders?: ReminderSettings;
  lastBroadcastTime?: number; // Timestamp of last mass email
}

export interface ReminderSettings {
  payment: {
    enabled: boolean;
    graceMinutes: number; // e.g., 60
    repeatEveryHours: number; // e.g., 12
    notifyUsers: boolean;
  };
  lock: {
    enabled: boolean;
    lockAt?: number; // epoch timestamp
    scheduleMinutes: number[]; // e.g., [1440, 120, 15]
  };
  winner: {
    enabled: boolean;
    channels: ('email' | 'in-app')[];
    includeDigits: boolean;
    includeCharityImpact: boolean;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string | null; // Allow null for Firebase compatibility
  registrationMethod?: 'google' | 'email' | 'unknown';
  phone?: string;
  socialLinks?: {
    twitter?: string;
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    other?: string;
  };
  // Referral System
  referralCode?: string; // Unique code for referral link (typically same as user ID)
  referredBy?: string; // UID of the user who referred this user
  referralCount?: number; // Number of users this user has referred
  createdAt?: number; // Timestamp of account creation
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

// --- AUDIT LOG ---
export type AuditEventType =
  | 'POOL_CREATED'
  | 'POOL_LOCKED'
  | 'POOL_UNLOCKED'
  | 'POOL_STATUS_CHANGED'
  | 'DIGITS_GENERATED' // payload: { period, commitHash }
  | 'SCORE_FINALIZED'  // payload: { period, home, away, eventId, sourceHash }
  | 'WINNER_COMPUTED'  // payload: { period, squareId, winnerUid, amount }
  | 'SQUARE_RESERVED'  // payload: { squareId, ownerName }
  | 'SQUARE_RELEASED'
  | 'SQUARE_MARKED_PAID'
  | 'SQUARE_UNPAID_REVERTED'
  | 'ADMIN_OVERRIDE_SCORE'
  | 'ADMIN_OVERRIDE_WINNER'
  | 'ADMIN_OVERRIDE_DIGITS'
  | 'ADMIN_OVERRIDE_SQUARE_STATE'
  | 'AI_ARTIFACT_CREATED';

export interface AuditLogEvent {
  id: string; // Auto-generated
  poolId: string;
  timestamp: number;
  type: AuditEventType;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  actor: {
    uid: string;
    role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN';
    label?: string; // e.g. "Kevin" or "Scheduler"
  };
  payload?: any; // Structured details (JSON)
  dedupeKey?: string; // For idempotency
}

export interface NotificationLog {
  id: string; // dedupKey
  poolId: string;
  type: 'PAYMENT_HOST' | 'PAYMENT_USER' | 'LOCK_COUNTDOWN' | 'WINNER_ANNOUNCEMENT';
  recipient: string; // uid or email
  sentAt: number;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  metadata?: any;
}

// --- AI COMMISSIONER ---

export interface AIArtifact {
  id: string;
  type: 'WINNER_EXPLANATION' | 'PERIOD_RECAP' | 'DISPUTE_RESPONSE' | 'POOL_SUMMARY';
  period?: 'q1' | 'half' | 'q3' | 'final';
  targetId?: string; // winnerId or requestId
  content: {
    headline: string;
    summaryBullets: string[];
    explanationSteps: string[]; // Steps showing math
    confidence: number;
    missingFacts?: string[]; // If data was missing
  };
  factsHash: string; // SHA256 of input facts for idempotency
  createdAt: number;
}

export interface AIRequest {
  id: string;
  userId: string;
  poolId: string;
  question: string;
  category: 'DISPUTE' | 'CLARIFICATION' | 'OTHER';
  status: 'PENDING' | 'COMPLETED' | 'ERROR';
  responseArtifactId?: string;
  createdAt: number;
  updatedAt?: number;
}