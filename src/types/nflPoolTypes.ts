import type { PayoutSettings } from './index';

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
  isMonday?: boolean; // Helpful for tiebreakers
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
    lockMode: 'PER_GAME' | 'WEEKLY'; // WEEKLY is forced if confidenceMode is true
    lockBufferMinutes: number; // grace period buffer (default: 5)
    payoutMode: 'SEASON' | 'WEEKLY' | 'HYBRID';
    pickMode: 'STRAIGHT' | 'ATS'; // ATS (Against the Spread) reserved for V2
    // Custom scoring options
    pointsPerPick?: number; // base points awarded per correct pick (default: 1)
    primetimeBonus?: {
      thursday?: number;    // bonus points added for correct Thursday Night Game pick
      sundayNight?: number; // bonus points added for correct Sunday Night Game pick
      monday?: number;      // bonus points added for correct Monday Night Game pick
    };
  };

  managerName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMethod?: 'email' | 'phone' | 'both' | 'none';
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
    maxStrikes: number; // 0 = sudden death (first loss/tie = eliminated), 1+ = mulligans
    maxRebuys: number; // Default 0
    rebuyDeadlineWeek: number; // e.g. Week 4
    rebuyCost: number; // Default equal to entryFee
    pickLosersMode: boolean; // true = pick team to LOSE. false = pick team to WIN
    autoSurviveExemptionEnabled: boolean; // optional: survives if no eligible teams are left (on bye or picked)
  };

  managerName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMethod?: 'email' | 'phone' | 'both' | 'none';
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
  contactPhone?: string;
  contactMethod?: 'email' | 'phone' | 'both' | 'none';
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
  picks: Record<string, string>; // gameId -> pickedTeamId (abbreviation or name)
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
  rebuysUsed: number;
  eliminatedWeek?: number;
  usedTeams: string[]; // List of team abbreviations/names picked previously in the season
  picks: Record<number, string>; // week -> pickedTeamId
  exemptWeeks: number[]; // List of weeks participant received auto-survive exemption
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
  usedTeams: string[]; // List of team abbreviations/names picked previously
  weeklyScores: Record<number, number>; // week -> score differential
  seasonTotal: number;
  negativeBurden: number; // Sum of absolute value of negative margins
  positiveWeeks: number; // Count of weeks margin > 0
  bestWeek: number; // Single highest margin in the season
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
  attritionCount?: number; // Survivor remaining alive count
  recapText?: string; // AI generated context
  createdAt: number;
}
