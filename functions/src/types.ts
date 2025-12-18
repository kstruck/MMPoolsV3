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
    };
    ownerId?: string; // ID of the user who owns this pool
    createdByUid?: string; // Required for RBAC
    status?: 'DRAFT' | 'LOCKED' | 'LIVE' | 'FINAL';
    manualScoreOverride?: boolean;
    reminders?: ReminderSettings;
}

export interface ReminderSettings {
    payment: {
        enabled: boolean;
        graceMinutes: number;
        repeatEveryHours: number;
        notifyUsers: boolean;
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
    seasonYear: number;

    participantCount?: number;
    entryCount?: number;

    createdAt: number;
    updatedAt?: number;
}

export interface PayoutSettings {
    places: { rank: number; percentage: number }[];
    bonuses: { name: string; percentage: number }[];
}

