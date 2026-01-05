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
    reservedAt?: number | null;
    guestDeviceKey?: string | null;
    guestClaimId?: string | null;
    reservedByUid?: string | null;
}

export interface GameScore {
    home: number;
    away: number;
}

export interface Winner {
    period: string;
    squareId: number;
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

export interface Scores {
    current: GameScore | null; // Live score right now
    q1: GameScore | null;
    half: GameScore | null;
    q3: GameScore | null;
    final: GameScore | null;
    gameStatus?: 'pre' | 'in' | 'post'; // Track game state
    clock?: string; // e.g. "12:45"
    period?: number; // 0=Pre, 1=Q1, 2=Q2, etc.
    startTime?: string; // ISO String
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
    options: string[];
    correctOption?: number; // 0 or 1, etc.
}

export interface PropCard {
    userId: string;
    userName?: string;
    cardName?: string; // User-given name for multiple cards
    purchasedAt: number;
    answers: Record<string, number>; // { questionId: optionIndex }
    score: number;
    tiebreakerVal?: number;
}

export interface GameState {
    id: string; // Unique ID
    name: string; // Pool Name (Title)
    urlSlug: string;
    gridUsername?: string;
    gridPassword?: string;
    contactEmail: string;
    managerName: string; // Name of the pool manager
    managerUid?: string; // UID of the pool manager
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
        scoreChangePayoutStrategy?: 'equal_split' | 'hybrid';
        scoreChangeHybridWeights?: { final: number; halftime: number; other: number };
        scoreChangeHandleUnsold?: 'rollover_next' | 'house';
        includeOTInScorePayouts?: boolean;
        combineTDandXP?: boolean;
    };
    ownerId?: string; // ID of the user who owns this pool
    createdByUid?: string; // Required for RBAC
    status?: 'DRAFT' | 'LOCKED' | 'LIVE' | 'FINAL';
    manualScoreOverride?: boolean;
    reminders?: any; // Simplified for backend
    waitlist?: WaitlistEntry[];

    // Prop Bets / Side Hustle
    props?: {
        enabled: boolean;
        cost: number;
        maxCards?: number; // Max cards per user (default: 1)
        payouts?: number[]; // Percentage split [1st, 2nd, 3rd...]
        questions: PropQuestion[];
    };
}

export interface WaitlistEntry {
    email: string;
    name: string;
    timestamp: number;
}

export interface ReminderSettings {
    payment: {
        enabled: boolean;
        graceMinutes: number;
        repeatEveryHours: number;
        notifyUsers: boolean;
        autoRelease?: boolean;
        autoReleaseHours?: number;
    };
    lock: {
        enabled: boolean;
        lockAt?: number;
        scheduleMinutes: number[];
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
    role?: 'POOL_MANAGER' | 'PARTICIPANT' | 'SUPER_ADMIN';
    provider?: 'password' | 'google';
}

// --- AUDIT LOG ---
export type AuditEventType =
    | 'POOL_CREATED'
    | 'POOL_LOCKED'
    | 'POOL_UNLOCKED'
    | 'DIGITS_GENERATED'
    | 'SCORE_FINALIZED'
    | 'WINNER_COMPUTED'
    | 'SQUARE_RESERVED'
    | 'SQUARE_RELEASED'
    | 'ADMIN_OVERRIDE_SCORE'
    | 'ADMIN_OVERRIDE_WINNER'
    | 'ADMIN_OVERRIDE_DIGITS'
    | 'ADMIN_OVERRIDE_SQUARE_STATE'
    | 'PROP_CARD_PURCHASED'
    | 'PROP_QUESTION_GRADED'
    | 'SQUARE_MARKED_PAID'
    | 'PAYMENT_CONFIRMED'
    | 'AI_ARTIFACT_CREATED';

export interface AuditLogEvent {
    id: string;
    poolId: string;
    timestamp: number;
    type: AuditEventType;
    message: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    actor: {
        uid: string;
        role: 'SYSTEM' | 'ADMIN' | 'USER' | 'ESPN' | 'GUEST';
        label?: string;
    };
    payload?: any;
    dedupeKey?: string;
}

export interface NotificationLog {
    id: string;
    poolId: string;
    type: 'PAYMENT_HOST' | 'PAYMENT_USER' | 'LOCK_COUNTDOWN' | 'WINNER_ANNOUNCEMENT';
    recipient: string;
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

// --- Core Pool Types
export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS';
export type Pool = GameState | BracketPool | PlayoffPool | PropsPool;

// --- NFL Playoff Pool Types ---

export type PlayoffRound = 'WILD_CARD' | 'DIVISIONAL' | 'CONF_CHAMP' | 'SUPER_BOWL';

export interface PlayoffTeam {
    id: string;
    name: string;
    conference: 'AFC' | 'NFC';
    seed: number;
    eliminated: boolean;
    eliminatedRound?: PlayoffRound;
}

export interface PlayoffEntry {
    id?: string; // Unique Entry ID
    userId: string;
    userName: string;
    rankings: Record<string, number>; // teamId -> rank (1-14)
    tiebreaker: number;
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
    gameId?: string;
    homeTeam?: string;
    awayTeam?: string;
    seasonType?: '1' | '2' | '3';
    week?: number;
    date?: number;

    // Configuration
    props: {
        enabled: true;
        cost: number;
        maxCards: number;
        payouts?: number[];
        questions: PropQuestion[];
    };

    // State
    isLocked: boolean;
    lockDate?: number;
    status?: 'active' | 'archived';

    // Reminders
    reminders?: ReminderSettings;
}

// --- BRACKET POOL TYPES ---

export interface BracketPool {
    id: string;
    type: 'BRACKET';
    slug: string;
    slugLower: string;
    isListedPublic: boolean;
    passwordHash?: string;
    lockAt: number;
    status: 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'COMPLETED';

    settings: {
        maxEntriesTotal: number;
        maxEntriesPerUser: number;
        entryFee: number;
        paymentInstructions: string;
        scoringSystem: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        customScoring?: number[];
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

    participantCount?: number;
    entryCount?: number;

    createdAt: number;
    updatedAt?: number;
}

export interface PayoutSettings {
    places: { rank: number; percentage: number }[];
    bonuses: { name: string; percentage: number }[];
}

