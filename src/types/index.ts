// Firestore Timestamp compatibility type
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
  toMillis: () => number;
}

export interface BanterMessage {
  id?: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

import type {
  NFLPickemPool,
  NFLSurvivorPool,
  NFLMarginPool
} from './nflPoolTypes';

export * from './nflPoolTypes';

// Core Pool Types
export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS' | 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
export type Pool = (GameState | BracketPool | PlayoffPool | PropsPool | NFLPickemPool | NFLSurvivorPool | NFLMarginPool) & { billing?: PoolBilling };

// --- NFL Playoff Pool Types ---

export type PlayoffRound = 'WILD_CARD' | 'DIVISIONAL' | 'CONF_CHAMP' | 'SUPER_BOWL';

export interface PlayoffTeam {
  id: string; // e.g. "KC", "SF"
  name: string; // "Kansas City Chiefs"
  conference: 'AFC' | 'NFC';
  seed: number; // 1-7
  eliminated: boolean;
  eliminatedRound?: PlayoffRound;
}

export interface PlayoffEntry {
  id?: string; // Unique Entry ID (v2 support)
  userId: string;
  userName: string; // Denormalized for display
  entryName?: string; // NEW: Custom entry name
  rankings: Record<string, number>; // teamId -> rank (1-14)
  tiebreaker: number; // Super Bowl Total Score
  totalScore: number;
  submittedAt: number;
  paid?: boolean; // NEW: Payment status
}

export interface PlayoffPool {
  id: string;
  type: 'NFL_PLAYOFFS';
  league: 'NFL';
  name: string;
  ownerId: string;
  managerUid: string;
  participantIds?: string[];
  urlSlug?: string;
  season: string;
  createdAt: number;

  settings: {
    entryFee: number;
    paymentInstructions: string;
    isListedPublic: boolean;
    payouts: PayoutSettings;
    scoring: {
      roundMultipliers: {
        WILD_CARD: number;
        DIVISIONAL: number;
        CONF_CHAMP: number;
        SUPER_BOWL: number;
      };
    };
  };

  isPublic: boolean; // Top-level for querying

  // NEW: Manager Contact Info
  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;

  // NEW: Branding Customization
  branding?: {
    logoUrl?: string; // Firebase Storage URL
    bgColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };

  // NEW: Reminder & Notification Settings
  reminders?: {
    auto24h?: boolean; // Send reminder 24h before lock
    auto1h?: boolean; // Send reminder 1h before lock
    autoLock?: boolean; // Auto-lock at Wild Card start
    announceWinner?: boolean; // Auto-announce winner when complete
    recipientFilter?: 'all' | 'unpaid' | 'noentry'; // Who gets reminders
    smsEnabled?: boolean; // Enable SMS notifications via Courier
  };

  // NEW: Access Control & Data Collection
  accessControl?: {
    password?: string; // Pool password
    requireEmail?: boolean;
    requirePhone?: boolean;
    customFields?: { label: string; required: boolean }[];
  };

  // NEW: QR Code for sharing
  qrCode?: string; // Data URI or Firebase Storage URL

  // State
  teams: PlayoffTeam[];
  entries: Record<string, PlayoffEntry>;
  results: {
    [key in PlayoffRound]?: string[];
  };

  isLocked: boolean;
  lockDate?: number;
  billing?: PoolBilling;
  entryCount?: number;
  /** Published at finalization (PLAN-WEEKLY-PRIZES step 3) — see shared/seasonPrizes. */
  seasonPlaces?: import('@shared/seasonPrizes').SeasonPlace[];
  seasonPrize?: import('@shared/seasonPrizes').SeasonPrizeSnapshot | null;
  seasonPlacesError?: string;
}

export interface PropsPool {
  id: string;
  type: 'PROPS';
  name: string;
  ownerId: string;
  managerUid: string;
  participantIds?: string[];
  createdAt: number;

  // Custom Branding
  theme: string;
  branding?: {
    logoUrl?: string;
    backgroundColor?: string;
  };

  // Game Info
  gameId?: string; // Optional if tied to a specific game
  homeTeam?: string;
  awayTeam?: string;
  seasonType?: '1' | '2' | '3';
  week?: number;
  date?: number; // Game start time (lock time)
  gameTime?: number;

  // Configuration
  props: {
    enabled: true; // Always true for this type
    cost: number;
    maxCards: number;
    payouts?: number[];
    gameTime?: number;
    questions: PropQuestion[];
  };

  // State
  isLocked: boolean;
  lockDate?: number;
  status?: 'active' | 'archived';
  isPublic?: boolean;
  entryCount?: number;

  // Reminders
  reminders?: ReminderSettings;

  // Common Meta
  urlSlug?: string;
  contactEmail?: string;
  managerName?: string;
  paymentInstructions?: string;
  paymentHandles?: {
    venmo?: string;
    cashapp?: string;
    paypal?: string;
    zelle?: string;
  };
  // New fields for wizard
  collectPhone?: boolean;
  collectAddress?: boolean;
  collectReferral?: boolean;
  collectNotes?: boolean;
  emailConfirmation?: string;
  notifyAdminFull?: boolean;
  gridPassword?: string;
  billing?: PoolBilling;
}

export interface Player {
  name: string;
  initials: string;
  color: string;
}

export interface PlayerDetails {
  name?: string; // Customer name for reservations
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  referral?: string;
}

export interface ClaimCode {
  claimId: string;
  claimCode: string;
  createdAt: number;
  guestClaimId: string;
  poolId?: string;
  uses: number;
  lastUsedAt?: number;
}

export interface Square {
  id: number; // 0-99
  owner: string | null; // Name of owner
  // Player PII (email/phone/etc) is NOT stored on the public pool doc — it lives
  // in the restricted /pools/{poolId}/squarePrivate/{squareId} subcollection (audit H1).
  isPaid?: boolean;
  pickedAsName?: string;
  guestDeviceKey?: string | null;
  guestClaimId?: string | null;
  reservedAt?: number | null;
  paidAt?: number | null;
  reservedByUid?: string | null;
  paidByUid?: string | null;
  paymentConfirmedAt?: number | null;
  paymentConfirmedByUid?: string | null;
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
  syncStatus?: 'searching' | 'found' | 'not-found';
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

export interface PropQuestion {
  id: string;
  text: string;
  options: string[]; // Supports 2-4 options
  correctOption?: number; // 0, 1, 2, or 3
  points?: number; // Point value for correct answer (default: 1)
  type?: 'standard' | 'tiebreaker'; // Question type (default: 'standard')
  category?: string; // Optional category (e.g. "Q1", "Player", "Fun")
  categories?: string[]; // Multiple categories support
}

export interface PropCard {
  id?: string; // Firestore document ID
  userId: string;
  userName?: string;
  cardName?: string; // User-given name for multiple cards (e.g. "Kevin's Card #1")
  purchasedAt: number;
  answers: Record<string, number>; // { questionId: optionIndex }
  score: number;
  tiebreakerVal?: number;
  isPaid?: boolean;
  userEmail?: string;
}

export interface PropSeed {
  id: string; // Auto-id
  text: string;
  options: string[];
  category?: string; // e.g. "Game", "Player", "Fun"
  categories?: string[]; // Multiple categories support
  createdAt: number;
}

export interface GameState {
  id: string; // Unique ID
  type: 'SQUARES'; // Discriminated Union
  name: string; // Pool Name (Title)
  urlSlug: string;
  gridUsername?: string;
  gridPassword?: string;
  paymentHandles?: {
    venmo?: string;
    zelle?: string;
  };
  contactEmail: string;
  managerName: string; // Name of the pool manager
  managerUid: string; // User ID of the pool manager
  participantIds?: string[]; // Users who have joined the pool
  paymentInstructions: string; // Instructions for payment (Venmo, etc.)
  theme: string;
  branding?: {
    logoUrl?: string;
    backgroundColor?: string;
  };

  homeTeam: string; // Row Team
  awayTeam: string; // Column Team
  league?: 'nfl' | 'college' | 'ncaa'; // League Context
  sport?: string; // Sport type (e.g., 'Football', 'Basketball', 'March Madness')
  homeTeamLogo?: string; // API provided logo
  awayTeamLogo?: string; // API provided logo
  gameId?: string; // ESPN Game ID for automated tracking
  gameTime?: number;
  seasonType?: '1' | '2' | '3'; // 1=Preseason, 2=Regular, 3=Postseason
  week?: number; // 1-18 for regular, 1-5 for postseason (5 = Super Bowl)

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
  createdAt?: number | FirestoreTimestamp;
  updatedAt?: number | FirestoreTimestamp;
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
  lockDate?: number; // Auto-lock timestamp
  ruleVariations: {
    reverseWinners: boolean; // Split pot with reverse digits
    quarterlyRollover: boolean; // Unsold squares roll money to next quarter
    scoreChangePayout: boolean; // Pay out on every score change
    scoreChangePayoutStrategy?: 'equal_split' | 'hybrid'; // Option A (Equal) vs Option B (Hybrid)
    scoreChangeHybridWeights?: { final: number; halftime: number; other: number }; // For Hybrid strategy
    scoreChangeHandleUnsold?: 'rollover_next' | 'house' | 'split_winners'; // Unsold handling
    combineTDandXP?: boolean; // Treat TD+XP as one event
    includeOTInScorePayouts?: boolean; // Include OT events in score payouts (distinct from Final Score OT rule)
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

  // Prop Bets / Side Hustle
  props?: {
    enabled: boolean;
    cost: number;
    maxCards: number; // Max cards per user (default: 1)
    payouts?: number[]; // Percentage split [1st, 2nd, 3rd...]
    questions: PropQuestion[];
  };
  lastBroadcastTime?: number; // Timestamp of last mass email
  status?: 'active' | 'archived'; // Pool lifecycle status (default: active)
  waitlist?: WaitlistEntry[]; // Users waiting for squares to open up
  postGameEmailSent?: boolean; // Track if post-game summary email was sent
  themeId?: string; // Reference to custom theme from themes collection
  billing?: PoolBilling;
  entryCount?: number;
}

export interface WaitlistEntry {
  email: string;
  name: string;
  timestamp: number;
}

export interface ReminderSettings {
  payment: {
    enabled: boolean;
    graceMinutes: number; // e.g., 60
    repeatEveryHours: number; // e.g., 12
    notifyUsers: boolean;
    autoRelease?: boolean; // If true, unpaid squares are released after X hours
    autoReleaseHours?: number; // Default 24?
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
  smsEnabled?: boolean; // Enable Courier SMS notifications
}

export interface UserHistoricalStats {
  totalPoints: number;
  totalWinnings: number;
  totalLosses: number; // Entry fees lost
  poolsEntered: number;
  poolsWon: number;
  correctPicks: number;
  incorrectPicks: number;
  marginDifferential: number; // Cumulative margin
}

export interface ManagerHistoricalStats {
  poolsManaged: number;
  totalRevenue: number; // Total entry fees collected
  totalPayouts: number; // Total prizes distributed
  totalParticipants: number;
}

// --- HISTORICAL STATS ---
export interface UserHistoricalStats {
  totalPoints: number;
  totalWinnings: number;
  totalLosses: number;
  poolsEntered: number;
  poolsWon: number;
  correctPicks: number;
  incorrectPicks: number;
  marginDifferential: number; // Positive if better, negative if worse
}

export interface ManagerHistoricalStats {
  poolsManaged: number;
  totalRevenue: number;
  totalPayouts: number;
  totalParticipants: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  // Canonical roles (T6) + legacy values still present in stored docs until the
  // backfill runs. Read through normalizeRole()/roleBadge() — never compare raw.
  role: 'SUPER_ADMIN' | 'MODERATOR' | 'COMMISSIONER' | 'MEMBER' | 'BANNED' | 'POOL_MANAGER' | 'PARTICIPANT';
  provider: 'password' | 'google';
  picture?: string | null; // Allow null for Firebase compatibility
  registrationMethod?: 'google' | 'email' | 'unknown';
  phone?: string;
  smsOptIn?: boolean; // User opted in to SMS notifications
  socialLinks?: {
    twitter?: string;
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    other?: string;
  };
  // The commissioner's own payout handles, remembered across pools.
  //
  // Widened from { venmo, zelle } on 2026-08-06 to match the FIVE the pool
  // wizard collects. It stored two of five, so a commissioner re-typed their
  // Cash App / PayPal / Google Pay details for every pool they created and the
  // profile could never prefill them.
  paymentHandles?: {
    venmo?: string;
    zelle?: string;
    cashapp?: string;
    paypal?: string;
    googlePay?: string;
  };
  // Referral System
  referralCode?: string; // Unique code for referral link (typically same as user ID)
  referredBy?: string; // UID of the user who referred this user
  referralCount?: number; // Number of users this user has referred
  createdAt?: number; // Timestamp of account creation
  emailVerified?: boolean; // Is email verified by Firebase?
  welcomeEmailSent?: boolean; // Has the welcome email been sent?
  updatedAt?: number; // Timestamp of last profile update
  lastLogin?: number | { seconds: number; nanoseconds: number }; // Last login timestamp
  referralCredits?: number; // Successful paying pool manager recruits
  freePoolsAvailable?: number; // Unused free pool tokens awarded
  activeBundleType?: 'buy_3' | 'unlimited_1yr';
  bundleExpiresAt?: number;
  poolCredits?: UserPoolCredit[];
  historicalStats?: UserHistoricalStats;
  managerStats?: ManagerHistoricalStats;
  // Server-maintained commissioner rollup (ADR 0003). Replaces the never-written managerStats.
  commissionerAggregate?: {
    poolsManaged: number;
    totalParticipants: number;
    duesExpected: number;
    duesCollected: number;
    totalPayouts: number;
    updatedAt?: number;
  };
}

export interface Winner {
  id?: string; // Firestore document ID
  period: string; // 'Q1', 'Half', 'Q3', 'Final', 'Event'
  squareId: number; // -1 if rollover
  owner: string;
  amount: number;
  homeDigit: number;
  awayDigit: number;
  isReverse?: boolean;
  isRollover?: boolean;
  description?: string;
  // Payout tracking
  isPaid?: boolean;
  paidAt?: number; // Timestamp
  paidByUid?: string; // Who marked it paid
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
  | 'PROP_CARD_PURCHASED'
  | 'PROP_QUESTION_GRADED'
  | 'AI_ARTIFACT_CREATED'
  | 'SURVIVOR_REBUY'
  | 'SURVIVOR_AUTO_STRIKE'
  | 'SCHEDULE_FLEX';

export interface AuditLogEvent {
  id: string; // Auto-generated
  poolId: string;
  timestamp: number;
  type: AuditEventType;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  actor: {
    uid: string;
    role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN' | 'GUEST';
    label?: string; // e.g. "Kevin" or "Scheduler"
  };
  payload?: Record<string, unknown>; // Structured details (JSON)
  dedupeKey?: string; // For idempotency
}

export interface NotificationLog {
  id: string; // dedupKey
  poolId: string;
  type: 'PAYMENT_HOST' | 'PAYMENT_USER' | 'LOCK_COUNTDOWN' | 'WINNER_ANNOUNCEMENT';
  recipient: string; // uid or email
  sentAt: number;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  metadata?: Record<string, unknown>;
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

export interface AIComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
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

// --- BRACKET POOL TYPES ---

export interface BracketPool {
  id: string;
  type: 'BRACKET';
  slug: string;
  slugLower: string;
  isListedPublic: boolean;
  passwordHash?: string; // If protected
  lockAt: number; // Timestamp
  status: 'DRAFT' | 'OPEN' | 'LOCKED' | 'LIVE' | 'COMPLETED';

  settings: {
    maxEntriesTotal: number; // -1 for unlimited
    maxEntriesPerUser: number; // -1 for unlimited
    entryFee: number;
    paymentInstructions: string;
    scoringSystem: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
    customScoring?: number[]; // [R64, R32, S16, E8, F4, CHAMPS]
    tieBreakers: {
      closestAbsolute: boolean;
      closestUnder: boolean;
    };
    payouts: PayoutSettings;
    charity?: CharityConfig; // Optional charity configuration
    upsetBonus?: {
      enabled: boolean;
      multiplier: number; // Points per seed differential (default: 5)
    };
    lockUnpaid?: boolean; // If true, entries must be PAID to submit brackets
  };

  name: string;
  description?: string;
  managerUid: string;
  ownerId?: string; // Back-compat / Rules
  participantIds?: string[];
  seasonYear: number;
  gender: 'mens' | 'womens';
  tournamentId?: string; // Links to tournaments/{id} in Firestore
  tournamentType?: 'ncaa' | 'conference'; // Conference pool or NCAA pool

  // NEW: Manager Contact Info
  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;

  // NEW: Branding Customization
  branding?: {
    logoUrl?: string; // Firebase Storage URL
    bgColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };

  // NEW: Reminder & Notification Settings
  reminders?: {
    auto24h?: boolean; // Send reminder 24h before lock
    auto1h?: boolean; // Send reminder 1h before lock
    autoLock?: boolean; // Auto-lock at tournament start
    announceWinner?: boolean; // Auto-announce winner when complete
    recipientFilter?: 'all' | 'unpaid' | 'noentry'; // Who gets reminders
    smsEnabled?: boolean; // Enable Courier SMS notifications
  };

  // NEW: Access Control & Data Collection
  accessControl?: {
    password?: string; // Pool password (separate from passwordHash for editing)
    requireEmail?: boolean;
    requirePhone?: boolean;
    customFields?: { label: string; required: boolean }[];
  };

  // NEW: QR Code for sharing
  qrCode?: string; // Data URI or Firebase Storage URL

  // Counts for easy display
  participantCount?: number;
  entryCount?: number;

  // Pool Deadlines
  registrationDeadline?: number;  // After this, no new members can join
  submissionDeadline?: number;    // After this, no new/edited brackets
  // Existing: lockAt (tournament start — auto-lock everything)

  // Commissioner Message
  commissionerMessage?: string;

  createdAt: number;
  updatedAt?: number;
  billing?: PoolBilling;
}

export type BracketRegion = 'East' | 'West' | 'South' | 'Midwest';

export interface PayoutSettings {
  places: { rank: number; percentage: number }[]; // e.g. [{rank: 1, percentage: 70}]
  bonuses: { name: string; percentage: number }[]; // e.g. [{name: "Underdog", percentage: 5}]
}

export interface BracketEntry {
  id: string;
  poolId: string;
  ownerUid: string;
  name: string;
  picks: Record<string, string>; // slotId -> teamId
  tieBreakerPrediction?: number; // Total score of championship
  status: 'DRAFT' | 'SUBMITTED';
  paidStatus: 'PAID' | 'UNPAID';
  paymentMethod?: 'Cash' | 'Check' | 'Venmo' | 'Google Pay' | 'Cash.me' | 'Other';
  score: number;
  maxPossibleScore?: number; // Set by scoring function; max points still achievable
  rank?: number;
  amountWon?: number;
  isWinner?: boolean;

  createdAt: number;
  updatedAt: number;
}

export interface PaymentRecord {
  id: string;
  entryId: string;        // Links to BracketEntry
  userName: string;
  amount: number;          // Amount paid
  amountOwed: number;      // Entry fee
  method: 'venmo' | 'zelle' | 'cashapp' | 'paypal' | 'cash' | 'other';
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
  paidAt?: number;
  note?: string;
  markedBy: string;        // Manager UID who marked it
  updatedAt: number;
}

export interface Tournament {
  id: string; // e.g. "mens-2025" or "bigeast-2026"
  seasonYear: number;
  gender: 'mens' | 'womens';
  isFinalized: boolean; // Tournament over?
  status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  lockAt?: number; // Timestamp: auto-lock bracket entries at tournament start

  // Conference tournament support
  tournamentType?: 'ncaa' | 'conference';
  conferenceName?: string; // e.g. "Big East"

  games: Record<string, Game>;
  slots: Record<string, TournamentSlot>;

  // ESPN Import Data
  importedGames?: Record<string, Game>;
  importedTeams?: Record<string, Team>;
  lastUpdated?: FirestoreTimestamp | { toDate: () => Date };
}

export interface Game {
  id: string; // e.g. "R1-W1"
  externalId?: string; // ESPN Game ID (e.g. "401638630")
  startTime: string; // ISO
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId?: string | null;
  round: number; // 0=FirstFour, 1=R64, 2=R32...
  region?: string | null;
  isFirstFour?: boolean;
  nextGameId?: string;
  period?: number;
  clock?: string;
  broadcast?: string;
}

export interface TournamentSlot {
  id: string; // e.g. "R1-W1"
  gameId: string;
  nextSlotId?: string | null; // Where winner goes

  // If play-in mapping
  isPlayInPlaceholder?: boolean;
  playInGameId?: string;
}

export interface Team {
  id: string;
  name: string;
  seed: number;
  region: string;
  logoUrl?: string;
  wins?: number;   // Season wins (from ESPN import)
  losses?: number; // Season losses (from ESPN import)
}

// --- POOL THEMES ---

export interface ThemeColors {
  primary: string;           // Main accent (buttons, highlights)
  secondary: string;         // Secondary accent
  background: string;        // Page background
  surface: string;           // Card backgrounds
  surfaceAlt: string;        // Alternating surfaces
  text: string;              // Primary text
  textMuted: string;         // Secondary text
  border: string;            // Border color
  success: string;           // Winner/positive
  warning: string;           // Alerts
  error: string;             // Errors
}

export interface ThemeGrid {
  cellBackground: string;    // Default cell bg
  cellBackgroundAlt: string; // Alternating pattern
  cellBorder: string;        // Cell borders
  headerBackground: string;  // Row/column headers
  winnerGlow: boolean;       // Glow effect on winners
  winnerGlowColor: string;   // Glow color
}

export interface ThemeBranding {
  logoUrl?: string;          // Optional theme logo
  backgroundPattern?: string; // CSS pattern or image URL
  gradientOverlay?: string;  // CSS gradient
}

export interface PoolTheme {
  id: string;
  name: string;
  description: string;
  category: 'sports' | 'holiday' | 'classic' | 'custom';
  isActive: boolean;         // SuperAdmin controls visibility
  isDefault: boolean;        // Only one can be default
  createdAt: number;
  createdBy: string;         // SuperAdmin UID
  updatedAt: number;
  colors: ThemeColors;
  grid: ThemeGrid;
  branding?: ThemeBranding;
  previewImage?: string;     // Auto-generated or uploaded
  // Pool types this theme is offered for (T13). Absent/empty => all types,
  // so existing (March-Madness-era) themes keep showing everywhere.
  appliesTo?: PoolType[];
}

// --- SYSTEM TYPES ---

export interface LoyaltyTier {
  id: string;
  name: string;
  minPools: number;
  description: string;
}

export interface SystemSettings {
  enableBracketPools: boolean;
  maintenanceMode: boolean;
  currentSeason: number;
  propCategories: string[]; // Dynamic categories for prop seeds
  loyaltyTiers?: LoyaltyTier[];
  // Per-pool-type creation flags (T5). Missing/partial => fail open to all-enabled.
  // Server enforces via functions/src/lib/systemGuards; this is the client mirror.
  poolTypeFlags?: Partial<Record<PoolType, boolean>>;
  // Auto-close sweep (T2). Kill-switch OFF by default; dryRun defaults true when enabled.
  autoClose?: { enabled?: boolean; dryRun?: boolean };
  // Live-score ticker scroll duration in seconds (higher = slower). Default 60.
  tickerDurationSec?: number;
}


// --- ANNOUNCEMENTS ---

export interface Announcement {
  id: string;
  poolId: string;
  authorId: string;
  subject: string;
  message: string;
  html?: string;
  createdAt: number;
  readBy?: string[];
}

// --- BILLING AND MONETIZATION ---

export type BillingStatus = 'free' | 'trial' | 'active' | 'grace_period' | 'locked';
export type BillingTier = 'free_tier' | 'standard_tier' | 'premium_tier';

export interface PoolBilling {
  status: BillingStatus;
  tier: BillingTier;
  pricePaid: number;
  stripeSessionId?: string;
  trialEndsAt?: number; // timestamp
  gracePeriodEndsAt?: number; // timestamp
  maxPlayersAllowed: number;
  couponCode?: string;
  /**
   * How the pool was activated when it was not a Stripe charge. Written as
   * `'credit'` by `redeemPoolCreditForPool` (functions/src/entitlements.ts:449),
   * which activates the pool and deliberately does NOT touch `tier` — so a
   * credit-activated pool can be `active` on `free_tier` with `pricePaid: 0`
   * and still be fully settled. Typed loosely because the server owns the
   * vocabulary and may add values without a client release.
   */
  paidVia?: string;
  featuresUnlocked: {
    aiCommissioner: boolean;
    whatIfSimulator: boolean;
    customBranding: boolean;
    smsNotifications?: boolean;
  };
}

// Billing config: the canonical contract is shared/schemas/billingConfig.ts
// (zod schema + inferred types) — the exact source Cloud Functions consume via
// the copy-shared mirror. Re-exported here so existing `from '../types'`
// imports keep working. Parse/normalize helpers (BillingConfigSchema,
// normalizeLegacyPackage) are value exports — import those directly from
// '@shared/schemas/billingConfig'.
export type {
  BillingConfig,
  BillingConfigInput,
  PricingTier,
  PricingKey,
  FormatTierMap,
  Package as BillingPackage,
  CreditBundlePackage,
  UnlimitedPassPackage,
  HeroPromo,
  BillingFeatureFlag,
} from '@shared/schemas/billingConfig';

/** @deprecated Legacy alias — use PricingTier from '@shared/schemas/billingConfig'. */
export type BillingTierPrice = import('@shared/schemas/billingConfig').PricingTier;

/**
 * @deprecated Legacy packagesList item shape (durationDays=0 => never expires,
 * poolsIncluded>=9999 => unlimited). New bundle products use `BillingPackage`
 * (CREDIT_BUNDLE | UNLIMITED_PASS); convert old Firestore data with
 * normalizeLegacyPackage from '@shared/schemas/billingConfig'.
 */
export type BillingBundle = import('@shared/schemas/billingConfig').LegacyBillingBundle;

export interface UserPoolCredit {
  id: string; // unique credit token ID
  bundleId: string; // reference to the source BillingBundle
  poolType: 'ALL' | PoolType;
  maxPlayersPerPool: number;
  expiresAt: number; // timestamp, 0 if never expires
  isUsed: boolean;
  usedForPoolId?: string;
}

export interface Coupon {
  id?: string;
  code: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  isActive: boolean;
  maxUses?: number;
  usesCount: number;
  expiresAt?: number;
  createdAt?: number;
  perUserLimit?: number; // Max uses per unique commissioner
  allowedPoolTypes?: PoolType[]; // Restrict to specific pool types (empty = all)
  usageLog?: Array<{ userId: string; poolId: string; usedAt: number }>; // Audit trail
}

export interface ReferralConfig {
  creditsRequiredForFreePool: number;
  discountPerCredit: number;
  rewardType: 'free_pool' | 'discount';
}

export interface ReferralRecord {
  id?: string;
  referrerId: string;
  referredUserId: string;
  status: 'pending' | 'confirmed';
  createdAt: number;
  confirmedAt?: number;
  creditAwarded: boolean;
}
