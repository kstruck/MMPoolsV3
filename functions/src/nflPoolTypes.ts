export interface PayoutSettings {
  places: { rank: number; percentage: number }[];
  bonuses: { name: string; percentage: number }[];
}

export interface NFLGame {
  id: string; // e.g. "espn_401671234"
  espnGameId: string;
  week: number;
  season: string; // e.g. "2026"
  seasonType: 1 | 2 | 3; // 1=Preseason, 2=Regular, 3=Postseason
  homeTeam: {
    id: string;
    name: string;
    abbreviation: string;
    logoUrl?: string;
  };
  awayTeam: {
    id: string;
    name: string;
    abbreviation: string;
    logoUrl?: string;
  };
  scores?: {
    home: number;
    away: number;
  };
  startTime: number; // UTC Epoch timestamp in milliseconds
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'CANCELLED';
  clock?: string;
  period?: number;
  isMonday?: boolean;
  spread?: {
    value: number; // Relative to home team. Negative means home is favored.
    locked: boolean;
  };
}

export interface NFLPickemPool {
  id: string;
  type: 'NFL_PICKEM';
  league: 'NFL';
  name: string;
  ownerId: string;
  managerUid: string;
  participantIds?: string[];
  urlSlug?: string;
  season: string;
  createdAt: number;
  isLocked: boolean;
  status?: 'active' | 'archived';
  isPublic?: boolean;
  entryCount?: number;

  settings: {
    entryFee: number;
    paymentInstructions: string;
    isListedPublic: boolean;
    payouts: PayoutSettings;
    confidenceMode: boolean;
    lockMode: 'PER_GAME' | 'WEEKLY';
    lockBufferMinutes: number;
    payoutMode: 'SEASON' | 'WEEKLY' | 'HYBRID';
    pickMode: 'STRAIGHT' | 'ATS';
  };

  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;

  branding?: {
    logo?: string;
    bgColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
}

export interface NFLSurvivorPool {
  id: string;
  type: 'NFL_SURVIVOR';
  league: 'NFL';
  name: string;
  ownerId: string;
  managerUid: string;
  participantIds?: string[];
  urlSlug?: string;
  season: string;
  createdAt: number;
  isLocked: boolean;
  status?: 'active' | 'archived';
  isPublic?: boolean;
  entryCount?: number;

  settings: {
    entryFee: number;
    paymentInstructions: string;
    isListedPublic: boolean;
    payouts: PayoutSettings;
    maxStrikes: number;
    maxRebuys: number;
    rebuyDeadlineWeek: number;
    rebuyCost: number;
    pickLosersMode: boolean;
    autoSurviveExemptionEnabled: boolean;
  };

  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;

  branding?: {
    logo?: string;
    bgColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
}

export interface NFLMarginPool {
  id: string;
  type: 'NFL_MARGIN';
  league: 'NFL';
  name: string;
  ownerId: string;
  managerUid: string;
  participantIds?: string[];
  urlSlug?: string;
  season: string;
  createdAt: number;
  isLocked: boolean;
  status?: 'active' | 'archived';
  isPublic?: boolean;
  entryCount?: number;

  settings: {
    entryFee: number;
    paymentInstructions: string;
    isListedPublic: boolean;
    payouts: PayoutSettings;
    payoutMode: 'SEASON' | 'WEEKLY' | 'HYBRID';
  };

  managerName?: string;
  contactEmail?: string;
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;

  branding?: {
    logo?: string;
    bgColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
}

export interface NFLPickemEntry {
  id: string;
  poolId: string;
  ownerUid: string;
  userName: string;
  entryName?: string;
  picks: Record<string, string>; // gameId -> pickedTeamId
  confidence?: Record<string, number>; // gameId -> confidence rank [1-16]
  weeklyTiebreakers?: Record<number, number>; // week -> predicted MNF combined score
  weeklyPoints?: Record<number, number>; // week -> points earned
  totalScore: number;
  submittedAt: number;
  paidStatus: 'PAID' | 'UNPAID';
}

export interface SurvivorEntry {
  id: string;
  poolId: string;
  ownerUid: string;
  userName: string;
  entryName?: string;
  status: 'ALIVE' | 'ELIMINATED';
  strikesUsed: number;
  // Per-week strike ledger: scoreNFLWeek recomputes strikesUsed =
  // strikeWeeks.length so rescoring a week is idempotent (set semantics).
  strikeWeeks?: number[];
  rebuysUsed: number;
  eliminatedWeek?: number;
  // Set by executeSurvivorRebuy; rescoring weeks <= lastRebuyWeek must not
  // re-strike a player who bought back in.
  lastRebuyWeek?: number;
  usedTeams: string[];
  picks: Record<number, string>; // week -> pickedTeamId
  exemptWeeks: number[];
  submittedAt: number;
  paidStatus: 'PAID' | 'UNPAID';
}

export interface MarginEntry {
  id: string;
  poolId: string;
  ownerUid: string;
  userName: string;
  entryName?: string;
  picks: Record<number, string>; // week -> pickedTeamId
  usedTeams: string[];
  weeklyScores: Record<number, number>; // week -> score differential
  seasonTotal: number;
  negativeBurden: number;
  positiveWeeks: number;
  bestWeek: number;
  submittedAt: number;
  paidStatus: 'PAID' | 'UNPAID';
}

export interface WeeklyRecap {
  id: string;
  poolId: string;
  week: number;
  sharpOfWeek?: { userId: string; userName: string; score: number };
  biggestUpsetPick?: { userId: string; userName: string; gameId: string; teamName: string };
  closestTiebreaker?: { userId: string; userName: string; diff: number };
  mostContrarianPick?: { userId: string; userName: string; gameId: string; teamName: string };
  attritionCount?: number;
  recapText?: string;
  createdAt: number;
}
