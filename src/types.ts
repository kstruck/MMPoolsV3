// Firestore Timestamp compatibility type
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
  toMillis: () => number;
}

// Core Pool Types
// Core Pool Types
export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS';
export type Pool = GameState | BracketPool | PlayoffPool | PropsPool;

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
  userId: string;
  userName: string; // Denormalized for display
  rankings: Record<string, number>; // teamId -> rank (1-14)
  tiebreaker: number; // Super Bowl Total Score
  totalScore: number;
  submittedAt: number;
}

export interface PlayoffPool {
  id: string;
  type: 'NFL_PLAYOFFS';
  league: 'NFL';
  name: string;
  ownerId: string;
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

  // NEW: Manager Contact Info
  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  googlePay?: string;
  cashapp?: string;
  paypal?: string;

  // NEW: Branding Customization
  branding?: {
    logo?: string; // Firebase Storage URL
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
}

export interface PropsPool {
  id: string;
  type: 'PROPS';
  name: string;
  ownerId: string;
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
    googlePay?: string;
  };
  // New fields for wizard
  collectPhone?: boolean;
  collectAddress?: boolean;
  collectReferral?: boolean;
  collectNotes?: boolean;
  emailConfirmation?: string;
  notifyAdminFull?: boolean;
  gridPassword?: string;
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
  playerDetails?: PlayerDetails;
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
    googlePay?: string;
  };
  contactEmail: string;
  managerName: string; // Name of the pool manager
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
  createdAt?: any; // Firestore Timestamp - kept as any for method access compatibility
  updatedAt?: any; // Firestore Timestamp - kept as any for method access compatibility
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
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'POOL_MANAGER' | 'PARTICIPANT' | 'SUPER_ADMIN';
  provider: 'password' | 'google';
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
  emailVerified?: boolean; // Is email verified by Firebase?
  welcomeEmailSent?: boolean; // Has the welcome email been sent?
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
  status: 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'COMPLETED';

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
  };

  name: string;
  description?: string;
  managerUid: string;
  ownerId?: string; // Back-compat / Rules
  seasonYear: number;
  gender: 'mens' | 'womens';

  // NEW: Manager Contact Info
  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  googlePay?: string;
  cashapp?: string;
  paypal?: string;

  // NEW: Branding Customization
  branding?: {
    logo?: string; // Firebase Storage URL
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

  createdAt: number;
  updatedAt?: number;
}

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
  score: number;
  rank?: number;

  createdAt: number;
  updatedAt: number;
}

export interface Tournament {
  id: string; // e.g. "mens-2025"
  seasonYear: number;
  gender: 'mens' | 'womens';
  isFinalized: boolean; // Tournament over?

  games: Record<string, Game>;
  slots: Record<string, TournamentSlot>;
}

export interface Game {
  id: string;
  startTime: string; // ISO
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId?: string;
  round: number; // 0=FirstFour, 1=R64, 2=R32...
  region?: string;
}

export interface TournamentSlot {
  id: string; // e.g. "R1-W1"
  gameId: string;
  nextSlotId?: string; // Where winner goes

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
}

// --- SYSTEM TYPES ---

export interface SystemSettings {
  enableBracketPools: boolean;
  maintenanceMode: boolean;
  currentSeason: number;
  propCategories: string[]; // Dynamic categories for prop seeds
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