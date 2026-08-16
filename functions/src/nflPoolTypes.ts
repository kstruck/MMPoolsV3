import type { WeeklyTiebreaker } from './shared/nflTiebreaker';
import type { WeeklyPlace, WeeklyPrizeSnapshot } from './shared/weeklyPrizes';

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
  /**
   * TV / streaming listing for the game, e.g. "NFL Net", "CBS", "CBS/Paramount+".
   *
   * Captured by the importer from ESPN's
   * `events[].competitions[].broadcasts[].names` (joined on `/` for a simulcast)
   * and rendered on the pick sheet's game row.
   *
   * ⚠️ ABSENT on most games, and that is the feed's normal state, not a defect:
   * a game carried only in its local markets has no national listing. Measured
   * 2026-08-12 — present on 11/16 preseason week-2 games, 13/16 week 3, 11/16
   * week 4. Also absent on every game imported before 2026-08-12; there is no
   * backfill, so it fills in on the next import of that week. Surfaces must omit
   * the field, never print a placeholder for it.
   *
   * ⚠️ Written as `null` rather than omitted when the feed has no listing. Game
   * writes are `merge: true`, and merge KEEPS a field the new payload omits — so
   * omission would leave a stale channel on a game that lost its national slot.
   * `null` and absent are equivalent to every reader (all test truthiness).
   */
  broadcast?: string | null;
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
  // Raw stored pool status. Distinct from the DERIVED lifecycle label from
  // getPoolLifecycleState (which adds CLOSED for admin-close). Aligned to the values
  // actually written by the create/lifecycle paths.
  status?: 'OPEN' | 'LOCKED' | 'LIVE' | 'FINAL' | 'CANCELED' | 'COMPLETED' | 'archived';
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
    /**
     * How a weekly tie breaks. OPTIONAL — absence means `MNF_COMBINED`, the
     * rule every pre-existing pool has been playing. Always resolve through
     * `effectiveWeeklyTiebreaker`, never by reading this field raw.
     */
    weeklyTiebreaker?: WeeklyTiebreaker;
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
  // Raw stored pool status. Distinct from the DERIVED lifecycle label from
  // getPoolLifecycleState (which adds CLOSED for admin-close). Aligned to the values
  // actually written by the create/lifecycle paths.
  status?: 'OPEN' | 'LOCKED' | 'LIVE' | 'FINAL' | 'CANCELED' | 'COMPLETED' | 'archived';
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
    // Both OPTIONAL and both default to today's behaviour, so no existing pool
    // doc carries them and none needs a migration. Defaults are applied at read
    // sites only, via shared/survivorReuse.ts.
    tieCountsAs?: 'WIN' | 'LOSS';   // absent ⇒ a tie is a strike in BOTH modes
    maxTeamUses?: number;           // absent ⇒ 1; 0 = unlimited
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
  // Raw stored pool status. Distinct from the DERIVED lifecycle label from
  // getPoolLifecycleState (which adds CLOSED for admin-close). Aligned to the values
  // actually written by the create/lifecycle paths.
  status?: 'OPEN' | 'LOCKED' | 'LIVE' | 'FINAL' | 'CANCELED' | 'COMPLETED' | 'archived';
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
  /** PLAN-MULTI-ENTRY D1 — 1 for `entries/{uid}` (absent on legacy docs ⇒ 1), n for `e${n}:${uid}`. */
  entryIndex?: number;
  picks: Record<string, string>; // gameId -> pickedTeamId
  confidence?: Record<string, number>; // gameId -> confidence rank [1-16]
  weeklyTiebreakers?: Record<number, number>; // week -> predicted MNF combined score
  weeklyPoints?: Record<number, number>; // week -> points earned
  // Real per-week W-L, persisted by scoreNFLWeek (ADR 0004). resultsVersion bumps each score.
  // `mode` + per-game graded outcomes added by ADR 0005 (Player Profiles) — written only
  // after games are final, so reveal-safe by construction; rescore overwrites the week.
  weeklyResults?: Record<number, {
    correct: number;
    total: number;
    points: number;
    mode?: 'STRAIGHT' | 'ATS';
    games?: Record<string, { pick: string; result: 'W' | 'L' | 'PUSH' | 'VOID'; away?: string; home?: string }>;
  }>;
  resultsVersion?: number;
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
  /** PLAN-MULTI-ENTRY D1 — 1 for `entries/{uid}` (absent on legacy docs ⇒ 1), n for `e${n}:${uid}`. */
  entryIndex?: number;
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
  // Per-week scored outcome (ADR 0004 shape + ADR 0005 per-pick game record).
  weeklyResults?: Record<number, {
    survived: boolean;
    strike: boolean;
    game?: { gameId: string; pick: string; result: 'SURVIVED' | 'STRUCK' | 'VOID' };
  }>;
  resultsVersion?: number;
  submittedAt: number;
  paidStatus: 'PAID' | 'UNPAID';
}

export interface MarginEntry {
  id: string;
  poolId: string;
  ownerUid: string;
  userName: string;
  entryName?: string;
  /** PLAN-MULTI-ENTRY D1 — 1 for `entries/{uid}` (absent on legacy docs ⇒ 1), n for `e${n}:${uid}`. */
  entryIndex?: number;
  picks: Record<number, string>; // week -> pickedTeamId
  usedTeams: string[];
  weeklyScores: Record<number, number>; // week -> score differential
  // Per-week scored outcome (ADR 0004 shape + ADR 0005 per-pick game record).
  weeklyResults?: Record<number, {
    net: number;
    game?: { gameId: string; pick: string; net: number };
  }>;
  resultsVersion?: number;
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
  /**
   * Who won the week, after the pool's tie-breaker rule
   * (PLAN-WEEKLY-TIEBREAKERS §8b). Pick'em and Margin only — Survivor has no
   * weekly score to rank.
   *
   * ALWAYS an array: more than one entry means a shared win, which is the
   * ordinary outcome of a tie the tiebreaker cannot separate, not an error.
   * ABSENT means "not computed" — an older recap, a Survivor pool, or a week
   * with no scored entries. It never means "nobody won".
   */
  weeklyWinners?: Array<{ entryId?: string; userId: string; userName: string; points: number; tiebreakDiff?: number }>;
  /**
   * The Weekly Winners List (PLAN-WEEKLY-PRIZES §3): EVERY scored entry,
   * competition-ranked (1,1,3), `prize` on paid ranks of a priced week.
   * ABSENT = not computed (older recap, void week, Survivor) — never "nobody".
   */
  weeklyPlaces?: WeeklyPlace[];
  /**
   * The frozen pot/places/entryCount/weeks the prizes came from (§3b-i), or
   * `null` = published UNPRICED (SEASON mode / no pot) — never re-priced.
   * Absent = not published by this feature.
   */
  weeklyPrize?: WeeklyPrizeSnapshot | null;
  /** Publication failed closed (§9 A5): an error code, e.g. PRIZE_SPLIT_DUPLICATE_RANK. */
  weeklyPlacesError?: string;
  attritionCount?: number;
  recapText?: string;
  createdAt: number;
}
