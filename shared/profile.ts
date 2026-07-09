// Player Profile public projection contract — shared by src/ (profile page, dev harness)
// and functions/ (projection recompute, expert grader).
// See docs/adr/0005-player-profile-data-model.md and PLAN-PLAYER-PROFILES.md.
//
// INVARIANTS (leak rules, per ADR 0005):
// - The public projection carries ZERO pool identifiers (no poolId, no poolName anywhere).
//   Per-pool detail is served only by the viewer-gated getProfilePoolDetail(subjectId, poolId)
//   callable (subject / co-member of that pool / admin).
// - Pick history contains SCORED picks only (never a pick whose game is not final+scored).
// - No blended cross-type or cross-mode accuracy: stats are bucketed by (poolType, pickMode).
// - Experts carry no money figures (profit stays null).
// This file is framework-free (no firebase imports) so both client and functions import it.

export const PROFILE_SCHEMA_VERSION = 1;

export type SubjectKind = 'PLAYER' | 'EXPERT';

// ---------------------------------------------------------------------------
// Expert subject ids
// ---------------------------------------------------------------------------
// Experts live in the SAME publicProfiles collection as players, under reserved ids.
// Collision invariant: this app only ever creates Firebase Auth users through standard
// signup, whose auto-generated uids are 28-char alphanumerics — they cannot contain '_'.
// The Admin SDK could mint custom uids containing '_', which is why no code path in this
// repo may ever create a custom-uid user (guarded by isReservedSubjectId below at any
// future custom-uid creation site, and by tests in shared/__tests__/profile.test.ts).

export const EXPERT_SUBJECT_PREFIX = 'expert_';

export const EXPERT_SUBJECT_IDS = {
  espnFpi: `${EXPERT_SUBJECT_PREFIX}espnFpi`,
  vegas: `${EXPERT_SUBJECT_PREFIX}vegas`,
} as const;

export type ExpertSubjectId = (typeof EXPERT_SUBJECT_IDS)[keyof typeof EXPERT_SUBJECT_IDS];

export function isExpertSubjectId(subjectId: string): boolean {
  return subjectId.startsWith(EXPERT_SUBJECT_PREFIX);
}

/** True for any subject id reserved for non-player use. A player uid must never match. */
export function isReservedSubjectId(subjectId: string): boolean {
  return isExpertSubjectId(subjectId);
}

// ---------------------------------------------------------------------------
// Per-pick graded outcomes (persisted on the entry inside weeklyResults[week];
// written only by scoreNFLWeek AFTER games are final — reveal-safe by construction)
// ---------------------------------------------------------------------------

export type NFLPickMode = 'STRAIGHT' | 'ATS';

export type PickemPickResult = 'W' | 'L' | 'PUSH' | 'VOID'; // VOID = canceled/postponed
export type SurvivorPickResult = 'SURVIVED' | 'STRUCK' | 'VOID';

export interface PickemGameResult {
  pick: string; // team abbreviation the member picked
  result: PickemPickResult;
}

/** Pickem: weeklyResults[week].games */
export type PickemWeekGames = Record<string, PickemGameResult>; // key: gameId

/** Survivor: weeklyResults[week].game */
export interface SurvivorWeekGame {
  gameId: string;
  pick: string;
  result: SurvivorPickResult;
}

/** Margin: weeklyResults[week].game */
export interface MarginWeekGame {
  gameId: string;
  pick: string;
  net: number;
}

// ---------------------------------------------------------------------------
// Public projection (publicProfiles/{subjectId}) — aggregate-only, world-readable
// ---------------------------------------------------------------------------

export interface ProfileOverall {
  accuracy: number; // Pickem-scoped %, 0 when no picks
  correct: number;
  total: number;
  points: number;
  poolsEntered: number;
  seasonsPlayed: number;
}

/** One row per (season, week), aggregated ACROSS pools — deliberately no pool identifiers. */
export interface ProfileWeeklyRow {
  season: string;
  week: number;
  correct: number;
  total: number;
  points: number;
}

/** Best final rank achieved in a season — rank only, never the pool's name/id publicly. */
export interface ProfileBestFinish {
  rank: number;
  totalEntries: number;
}

export interface ProfileYearlyRow {
  season: string;
  correct: number;
  total: number;
  accuracy: number;
  profitNet: number | null; // null until payout recording exists for that season
  bestFinish: ProfileBestFinish | null;
}

/** Team-by-team stats are bucketed — never one blended accuracy table. */
export interface ProfileTeamBucket {
  poolType: 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
  pickMode?: NFLPickMode; // Pickem only
  teams: ProfileTeamRow[];
}

export interface ProfileTeamRow {
  team: string; // abbreviation
  wins: number;
  losses: number;
  pushes: number;
  accuracy: number; // within-bucket %
}

/** Minimum picked-for count before a team may be ranked most/least accurate (render-time). */
export const TEAM_RANK_MIN_PICKS = 3;

/** Scored picks only; no pool identifiers. */
export interface ProfilePickHistoryRow {
  season: string;
  week: number;
  gameId: string;
  awayAbbr: string;
  homeAbbr: string;
  pick: string;
  result: PickemPickResult | SurvivorPickResult;
  poolType: 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';
  pickMode?: NFLPickMode;
  net?: number; // Margin
}

/** Cap on pickHistory rows stored in the projection doc (newest first). */
export const PICK_HISTORY_CAP = 200;

export interface ProfileProfit {
  won: number; // sum of non-superseded recorded award amounts (settled or not)
  feesOwed: number; // sum of Member Record feeOwed (+ rebuyOwed) across NFL pools
  net: number; // won - feesOwed
  poolsPendingPayouts: number; // finalized pools lacking payoutsRecordedAt
  feesEstimated: boolean; // true when any contributing feeOwed is BACKFILL_ESTIMATE
}

export interface PublicProfile {
  uid: string; // subject id (player uid or expert_* id)
  subjectKind: SubjectKind;
  userName: string;
  overall: ProfileOverall;
  weekly: ProfileWeeklyRow[];
  yearly: ProfileYearlyRow[];
  teamByTeam: ProfileTeamBucket[];
  pickHistory: ProfilePickHistoryRow[];
  profit: ProfileProfit | null; // null for experts, and until Phase 4 lands
  schemaVersion: number;
  updatedAt?: unknown; // Firestore Timestamp (server) / raw value (client)
}
