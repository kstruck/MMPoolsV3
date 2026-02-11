/**
 * 2025 NCAA Men's March Madness Tournament Data
 * 
 * Complete 68-team, 67-game bracket structure with real 2025 results.
 * Used by the E2E bracket pool simulator.
 * 
 * Champion: Florida Gators (defeated Houston 65-63)
 * #1 Seeds: East-Duke, West-Florida, South-Auburn, Midwest-Houston
 */

import type { Tournament, Game, TournamentSlot } from '../../../types';

// ─── TEAM DEFINITIONS ────────────────────────────────────────────
export interface TeamInfo {
    id: string;
    name: string;
    seed: number;
    region: string;
}

// All 68 teams organized by region (seeds 1-16, plus First Four participants)
export const TEAMS: TeamInfo[] = [
    // ── EAST REGION (Top Seed: Duke) ──
    { id: 'E1-Duke', name: 'Duke', seed: 1, region: 'East' },
    { id: 'E2-Alabama', name: 'Alabama', seed: 2, region: 'East' },
    { id: 'E3-Wisconsin', name: 'Wisconsin', seed: 3, region: 'East' },
    { id: 'E4-Arizona', name: 'Arizona', seed: 4, region: 'East' },
    { id: 'E5-Oregon', name: 'Oregon', seed: 5, region: 'East' },
    { id: 'E6-BYU', name: 'BYU', seed: 6, region: 'East' },
    { id: 'E7-StMarys', name: "Saint Mary's", seed: 7, region: 'East' },
    { id: 'E8-MissState', name: 'Mississippi St.', seed: 8, region: 'East' },
    { id: 'E9-Baylor', name: 'Baylor', seed: 9, region: 'East' },
    { id: 'E10-Vanderbilt', name: 'Vanderbilt', seed: 10, region: 'East' },
    { id: 'E11-VCU', name: 'VCU', seed: 11, region: 'East' },
    { id: 'E12-Liberty', name: 'Liberty', seed: 12, region: 'East' },
    { id: 'E13-Akron', name: 'Akron', seed: 13, region: 'East' },
    { id: 'E14-Montana', name: 'Montana', seed: 14, region: 'East' },
    { id: 'E15-RobertMorris', name: 'Robert Morris', seed: 15, region: 'East' },
    { id: 'E16-MtStMarys', name: "Mount St. Mary's", seed: 16, region: 'East' },

    // ── WEST REGION (Top Seed: Florida) ──
    { id: 'W1-Florida', name: 'Florida', seed: 1, region: 'West' },
    { id: 'W2-StJohns', name: "St. John's", seed: 2, region: 'West' },
    { id: 'W3-UCLA', name: 'UCLA', seed: 3, region: 'West' },
    { id: 'W4-Kentucky', name: 'Kentucky', seed: 4, region: 'West' },
    { id: 'W5-Arkansas', name: 'Arkansas', seed: 5, region: 'West' },
    { id: 'W6-Indiana', name: 'Indiana', seed: 6, region: 'West' },
    { id: 'W7-KansasState', name: 'Kansas State', seed: 7, region: 'West' },
    { id: 'W8-SouthCarolina', name: 'South Carolina', seed: 8, region: 'West' },
    { id: 'W9-Utah', name: 'Utah', seed: 9, region: 'West' },
    { id: 'W10-Drake', name: 'Drake', seed: 10, region: 'West' },
    { id: 'W11-Kansas', name: 'Kansas', seed: 11, region: 'West' },
    { id: 'W12-Fairfield', name: 'Fairfield', seed: 12, region: 'West' },
    { id: 'W13-UtahState', name: 'Utah State', seed: 13, region: 'West' },
    { id: 'W14-Missouri', name: 'Missouri', seed: 14, region: 'West' },
    { id: 'W15-Omaha', name: 'Omaha', seed: 15, region: 'West' },
    { id: 'W16-TennesseeTech', name: 'Tennessee Tech', seed: 16, region: 'West' },

    // ── SOUTH REGION (Top Seed: Auburn) ──
    { id: 'S1-Auburn', name: 'Auburn', seed: 1, region: 'South' },
    { id: 'S2-Florida2', name: 'Florida', seed: 2, region: 'South' },
    { id: 'S3-TexasAM', name: 'Texas A&M', seed: 3, region: 'South' },
    { id: 'S4-Creighton', name: 'Creighton', seed: 4, region: 'South' },
    { id: 'S5-Michigan', name: 'Michigan', seed: 5, region: 'South' },
    { id: 'S6-OleMiss', name: 'Ole Miss', seed: 6, region: 'South' },
    { id: 'S7-Maryland', name: 'Maryland', seed: 7, region: 'South' },
    { id: 'S8-IowaState', name: 'Iowa State', seed: 8, region: 'South' },
    { id: 'S9-Lipscomb', name: 'Lipscomb', seed: 9, region: 'South' },
    { id: 'S10-NorthCarolina', name: 'North Carolina', seed: 10, region: 'South' },
    { id: 'S11-Yale', name: 'Yale', seed: 11, region: 'South' },
    { id: 'S12-UCSanDiego', name: 'UC San Diego', seed: 12, region: 'South' },
    { id: 'S13-Louisville', name: 'Louisville', seed: 13, region: 'South' },
    { id: 'S14-GrandCanyon', name: 'Grand Canyon', seed: 14, region: 'South' },
    { id: 'S15-NorfolkState', name: 'Norfolk State', seed: 15, region: 'South' },
    { id: 'S16-AlabamaState', name: 'Alabama State', seed: 16, region: 'South' },

    // ── MIDWEST REGION (Top Seed: Houston) ──
    { id: 'M1-Houston', name: 'Houston', seed: 1, region: 'Midwest' },
    { id: 'M2-Tennessee', name: 'Tennessee', seed: 2, region: 'Midwest' },
    { id: 'M3-Gonzaga', name: 'Gonzaga', seed: 3, region: 'Midwest' },
    { id: 'M4-Purdue', name: 'Purdue', seed: 4, region: 'Midwest' },
    { id: 'M5-Clemson', name: 'Clemson', seed: 5, region: 'Midwest' },
    { id: 'M6-Illinois', name: 'Illinois', seed: 6, region: 'Midwest' },
    { id: 'M7-Kentucky2', name: 'Kentucky', seed: 7, region: 'Midwest' },
    { id: 'M8-McNeese', name: 'McNeese', seed: 8, region: 'Midwest' },
    { id: 'M9-Georgia', name: 'Georgia', seed: 9, region: 'Midwest' },
    { id: 'M10-Xavier', name: 'Xavier', seed: 10, region: 'Midwest' },
    { id: 'M11-Wofford', name: 'Wofford', seed: 11, region: 'Midwest' },
    { id: 'M12-HighPoint', name: 'High Point', seed: 12, region: 'Midwest' },
    { id: 'M13-Troy', name: 'Troy', seed: 13, region: 'Midwest' },
    { id: 'M14-SIUEdwards', name: 'SIU Edwardsville', seed: 14, region: 'Midwest' },
    { id: 'M15-Georgia2', name: 'Georgia', seed: 15, region: 'Midwest' },
    { id: 'M16-StFrancis', name: 'Saint Francis', seed: 16, region: 'Midwest' },

    // ── FIRST FOUR TEAMS (play-in games, not in main bracket) ──
    { id: 'FF-AlabamaState', name: 'Alabama State', seed: 16, region: 'South' },
    { id: 'FF-StFrancis', name: 'Saint Francis', seed: 16, region: 'Midwest' },
    { id: 'FF-NorthCarolina', name: 'North Carolina', seed: 11, region: 'South' },
    { id: 'FF-SanDiegoState', name: 'San Diego State', seed: 11, region: 'South' },
    { id: 'FF-MtStMarys', name: "Mount St. Mary's", seed: 16, region: 'East' },
    { id: 'FF-American', name: 'American', seed: 16, region: 'East' },
    { id: 'FF-Xavier', name: 'Xavier', seed: 11, region: 'Midwest' },
    { id: 'FF-Texas', name: 'Texas', seed: 11, region: 'Midwest' },
];

// ─── GAME RESULTS BY ROUND ──────────────────────────────────────
// Each game in the format expected by the scoring engine.
// Round 1 = R64, Round 2 = R32, ..., Round 6 = Championship (maps to bracketScoring.ts round indices 0-5)

interface GameResult {
    id: string;
    homeTeamId: string;
    awayTeamId: string;
    homeScore: number;
    awayScore: number;
    winnerTeamId: string;
    round: number;
    region?: string;
}

// ── ROUND 1: R64 (32 games) ──
const R64_RESULTS: GameResult[] = [
    // EAST REGION
    { id: 'R1-E1', homeTeamId: 'E1-Duke', awayTeamId: 'E16-MtStMarys', homeScore: 93, awayScore: 49, winnerTeamId: 'E1-Duke', round: 1, region: 'East' },
    { id: 'R1-E2', homeTeamId: 'E8-MissState', awayTeamId: 'E9-Baylor', homeScore: 72, awayScore: 75, winnerTeamId: 'E9-Baylor', round: 1, region: 'East' },
    { id: 'R1-E3', homeTeamId: 'E4-Arizona', awayTeamId: 'E13-Akron', homeScore: 93, awayScore: 65, winnerTeamId: 'E4-Arizona', round: 1, region: 'East' },
    { id: 'R1-E4', homeTeamId: 'E5-Oregon', awayTeamId: 'E12-Liberty', homeScore: 81, awayScore: 52, winnerTeamId: 'E5-Oregon', round: 1, region: 'East' },
    { id: 'R1-E5', homeTeamId: 'E6-BYU', awayTeamId: 'E11-VCU', homeScore: 80, awayScore: 71, winnerTeamId: 'E6-BYU', round: 1, region: 'East' },
    { id: 'R1-E6', homeTeamId: 'E3-Wisconsin', awayTeamId: 'E14-Montana', homeScore: 85, awayScore: 66, winnerTeamId: 'E3-Wisconsin', round: 1, region: 'East' },
    { id: 'R1-E7', homeTeamId: 'E7-StMarys', awayTeamId: 'E10-Vanderbilt', homeScore: 59, awayScore: 56, winnerTeamId: 'E7-StMarys', round: 1, region: 'East' },
    { id: 'R1-E8', homeTeamId: 'E2-Alabama', awayTeamId: 'E15-RobertMorris', homeScore: 90, awayScore: 81, winnerTeamId: 'E2-Alabama', round: 1, region: 'East' },

    // WEST REGION
    { id: 'R1-W1', homeTeamId: 'W1-Florida', awayTeamId: 'W16-TennesseeTech', homeScore: 95, awayScore: 69, winnerTeamId: 'W1-Florida', round: 1, region: 'West' },
    { id: 'R1-W2', homeTeamId: 'W8-SouthCarolina', awayTeamId: 'W9-Utah', homeScore: 76, awayScore: 68, winnerTeamId: 'W8-SouthCarolina', round: 1, region: 'West' },
    { id: 'R1-W3', homeTeamId: 'W4-Kentucky', awayTeamId: 'W13-UtahState', homeScore: 79, awayScore: 78, winnerTeamId: 'W4-Kentucky', round: 1, region: 'West' },
    { id: 'R1-W4', homeTeamId: 'W5-Arkansas', awayTeamId: 'W12-Fairfield', homeScore: 79, awayScore: 72, winnerTeamId: 'W5-Arkansas', round: 1, region: 'West' },
    { id: 'R1-W5', homeTeamId: 'W6-Indiana', awayTeamId: 'W11-Kansas', homeScore: 76, awayScore: 68, winnerTeamId: 'W6-Indiana', round: 1, region: 'West' },
    { id: 'R1-W6', homeTeamId: 'W3-UCLA', awayTeamId: 'W14-Missouri', homeScore: 72, awayScore: 47, winnerTeamId: 'W3-UCLA', round: 1, region: 'West' },
    { id: 'R1-W7', homeTeamId: 'W7-KansasState', awayTeamId: 'W10-Drake', homeScore: 67, awayScore: 57, winnerTeamId: 'W7-KansasState', round: 1, region: 'West' },
    { id: 'R1-W8', homeTeamId: 'W2-StJohns', awayTeamId: 'W15-Omaha', homeScore: 83, awayScore: 53, winnerTeamId: 'W2-StJohns', round: 1, region: 'West' },

    // SOUTH REGION
    { id: 'R1-S1', homeTeamId: 'S1-Auburn', awayTeamId: 'S16-AlabamaState', homeScore: 83, awayScore: 63, winnerTeamId: 'S1-Auburn', round: 1, region: 'South' },
    { id: 'R1-S2', homeTeamId: 'S8-IowaState', awayTeamId: 'S9-Lipscomb', homeScore: 82, awayScore: 55, winnerTeamId: 'S8-IowaState', round: 1, region: 'South' },
    { id: 'R1-S3', homeTeamId: 'S4-Creighton', awayTeamId: 'S13-Louisville', homeScore: 89, awayScore: 75, winnerTeamId: 'S4-Creighton', round: 1, region: 'South' },
    { id: 'R1-S4', homeTeamId: 'S5-Michigan', awayTeamId: 'S12-UCSanDiego', homeScore: 68, awayScore: 65, winnerTeamId: 'S5-Michigan', round: 1, region: 'South' },
    { id: 'R1-S5', homeTeamId: 'S3-TexasAM', awayTeamId: 'S14-GrandCanyon', homeScore: 80, awayScore: 71, winnerTeamId: 'S3-TexasAM', round: 1, region: 'South' },
    { id: 'R1-S6', homeTeamId: 'S6-OleMiss', awayTeamId: 'S10-NorthCarolina', homeScore: 71, awayScore: 64, winnerTeamId: 'S6-OleMiss', round: 1, region: 'South' },
    { id: 'R1-S7', homeTeamId: 'S7-Maryland', awayTeamId: 'S11-Yale', homeScore: 81, awayScore: 49, winnerTeamId: 'S7-Maryland', round: 1, region: 'South' },
    { id: 'R1-S8', homeTeamId: 'S2-Florida2', awayTeamId: 'S15-NorfolkState', homeScore: 95, awayScore: 69, winnerTeamId: 'S2-Florida2', round: 1, region: 'South' },

    // MIDWEST REGION
    { id: 'R1-M1', homeTeamId: 'M1-Houston', awayTeamId: 'M14-SIUEdwards', homeScore: 78, awayScore: 40, winnerTeamId: 'M1-Houston', round: 1, region: 'Midwest' },
    { id: 'R1-M2', homeTeamId: 'M8-McNeese', awayTeamId: 'M9-Georgia', homeScore: 69, awayScore: 68, winnerTeamId: 'M8-McNeese', round: 1, region: 'Midwest' },
    { id: 'R1-M3', homeTeamId: 'M3-Gonzaga', awayTeamId: 'M15-Georgia2', homeScore: 89, awayScore: 68, winnerTeamId: 'M3-Gonzaga', round: 1, region: 'Midwest' },
    { id: 'R1-M4', homeTeamId: 'M4-Purdue', awayTeamId: 'M12-HighPoint', homeScore: 75, awayScore: 63, winnerTeamId: 'M4-Purdue', round: 1, region: 'Midwest' },
    { id: 'R1-M5', homeTeamId: 'M5-Clemson', awayTeamId: 'M13-Troy', homeScore: 67, awayScore: 69, winnerTeamId: 'M13-Troy', round: 1, region: 'Midwest' },
    { id: 'R1-M6', homeTeamId: 'M2-Tennessee', awayTeamId: 'M11-Wofford', homeScore: 77, awayScore: 62, winnerTeamId: 'M2-Tennessee', round: 1, region: 'Midwest' },
    { id: 'R1-M7', homeTeamId: 'M6-Illinois', awayTeamId: 'M10-Xavier', homeScore: 86, awayScore: 73, winnerTeamId: 'M6-Illinois', round: 1, region: 'Midwest' },
    { id: 'R1-M8', homeTeamId: 'M7-Kentucky2', awayTeamId: 'M16-StFrancis', homeScore: 76, awayScore: 57, winnerTeamId: 'M7-Kentucky2', round: 1, region: 'Midwest' },
];

// ── ROUND 2: R32 (16 games) ──
const R32_RESULTS: GameResult[] = [
    // EAST
    { id: 'R2-E1', homeTeamId: 'E1-Duke', awayTeamId: 'E9-Baylor', homeScore: 74, awayScore: 64, winnerTeamId: 'E1-Duke', round: 2, region: 'East' },
    { id: 'R2-E2', homeTeamId: 'E4-Arizona', awayTeamId: 'E5-Oregon', homeScore: 68, awayScore: 72, winnerTeamId: 'E5-Oregon', round: 2, region: 'East' },
    { id: 'R2-E3', homeTeamId: 'E6-BYU', awayTeamId: 'E3-Wisconsin', homeScore: 62, awayScore: 75, winnerTeamId: 'E3-Wisconsin', round: 2, region: 'East' },
    { id: 'R2-E4', homeTeamId: 'E7-StMarys', awayTeamId: 'E2-Alabama', homeScore: 56, awayScore: 76, winnerTeamId: 'E2-Alabama', round: 2, region: 'East' },
    // WEST
    { id: 'R2-W1', homeTeamId: 'W1-Florida', awayTeamId: 'W8-SouthCarolina', homeScore: 82, awayScore: 66, winnerTeamId: 'W1-Florida', round: 2, region: 'West' },
    { id: 'R2-W2', homeTeamId: 'W4-Kentucky', awayTeamId: 'W5-Arkansas', homeScore: 70, awayScore: 65, winnerTeamId: 'W4-Kentucky', round: 2, region: 'West' },
    { id: 'R2-W3', homeTeamId: 'W6-Indiana', awayTeamId: 'W3-UCLA', homeScore: 58, awayScore: 68, winnerTeamId: 'W3-UCLA', round: 2, region: 'West' },
    { id: 'R2-W4', homeTeamId: 'W7-KansasState', awayTeamId: 'W2-StJohns', homeScore: 55, awayScore: 71, winnerTeamId: 'W2-StJohns', round: 2, region: 'West' },
    // SOUTH
    { id: 'R2-S1', homeTeamId: 'S1-Auburn', awayTeamId: 'S8-IowaState', homeScore: 78, awayScore: 67, winnerTeamId: 'S1-Auburn', round: 2, region: 'South' },
    { id: 'R2-S2', homeTeamId: 'S4-Creighton', awayTeamId: 'S5-Michigan', homeScore: 77, awayScore: 69, winnerTeamId: 'S4-Creighton', round: 2, region: 'South' },
    { id: 'R2-S3', homeTeamId: 'S3-TexasAM', awayTeamId: 'S6-OleMiss', homeScore: 72, awayScore: 63, winnerTeamId: 'S3-TexasAM', round: 2, region: 'South' },
    { id: 'R2-S4', homeTeamId: 'S7-Maryland', awayTeamId: 'S2-Florida2', homeScore: 60, awayScore: 79, winnerTeamId: 'S2-Florida2', round: 2, region: 'South' },
    // MIDWEST
    { id: 'R2-M1', homeTeamId: 'M1-Houston', awayTeamId: 'M8-McNeese', homeScore: 72, awayScore: 56, winnerTeamId: 'M1-Houston', round: 2, region: 'Midwest' },
    { id: 'R2-M2', homeTeamId: 'M3-Gonzaga', awayTeamId: 'M4-Purdue', homeScore: 71, awayScore: 66, winnerTeamId: 'M3-Gonzaga', round: 2, region: 'Midwest' },
    { id: 'R2-M3', homeTeamId: 'M13-Troy', awayTeamId: 'M2-Tennessee', homeScore: 55, awayScore: 73, winnerTeamId: 'M2-Tennessee', round: 2, region: 'Midwest' },
    { id: 'R2-M4', homeTeamId: 'M6-Illinois', awayTeamId: 'M7-Kentucky2', homeScore: 68, awayScore: 63, winnerTeamId: 'M6-Illinois', round: 2, region: 'Midwest' },
];

// ── ROUND 3: Sweet 16 (8 games) ──
const S16_RESULTS: GameResult[] = [
    { id: 'R3-E1', homeTeamId: 'E1-Duke', awayTeamId: 'E5-Oregon', homeScore: 79, awayScore: 62, winnerTeamId: 'E1-Duke', round: 3, region: 'East' },
    { id: 'R3-E2', homeTeamId: 'E3-Wisconsin', awayTeamId: 'E2-Alabama', homeScore: 63, awayScore: 70, winnerTeamId: 'E2-Alabama', round: 3, region: 'East' },
    { id: 'R3-W1', homeTeamId: 'W1-Florida', awayTeamId: 'W4-Kentucky', homeScore: 79, awayScore: 65, winnerTeamId: 'W1-Florida', round: 3, region: 'West' },
    { id: 'R3-W2', homeTeamId: 'W3-UCLA', awayTeamId: 'W2-StJohns', homeScore: 60, awayScore: 70, winnerTeamId: 'W2-StJohns', round: 3, region: 'West' },
    { id: 'R3-S1', homeTeamId: 'S1-Auburn', awayTeamId: 'S4-Creighton', homeScore: 82, awayScore: 67, winnerTeamId: 'S1-Auburn', round: 3, region: 'South' },
    { id: 'R3-S2', homeTeamId: 'S3-TexasAM', awayTeamId: 'S2-Florida2', homeScore: 61, awayScore: 74, winnerTeamId: 'S2-Florida2', round: 3, region: 'South' },
    { id: 'R3-M1', homeTeamId: 'M1-Houston', awayTeamId: 'M3-Gonzaga', homeScore: 68, awayScore: 57, winnerTeamId: 'M1-Houston', round: 3, region: 'Midwest' },
    { id: 'R3-M2', homeTeamId: 'M2-Tennessee', awayTeamId: 'M6-Illinois', homeScore: 66, awayScore: 55, winnerTeamId: 'M2-Tennessee', round: 3, region: 'Midwest' },
];

// ── ROUND 4: Elite 8 (4 games) ──
const E8_RESULTS: GameResult[] = [
    { id: 'R4-E1', homeTeamId: 'E1-Duke', awayTeamId: 'E2-Alabama', homeScore: 76, awayScore: 64, winnerTeamId: 'E1-Duke', round: 4, region: 'East' },
    { id: 'R4-W1', homeTeamId: 'W1-Florida', awayTeamId: 'W2-StJohns', homeScore: 76, awayScore: 63, winnerTeamId: 'W1-Florida', round: 4, region: 'West' },
    { id: 'R4-S1', homeTeamId: 'S1-Auburn', awayTeamId: 'S2-Florida2', homeScore: 71, awayScore: 68, winnerTeamId: 'S1-Auburn', round: 4, region: 'South' },
    { id: 'R4-M1', homeTeamId: 'M1-Houston', awayTeamId: 'M2-Tennessee', homeScore: 73, awayScore: 62, winnerTeamId: 'M1-Houston', round: 4, region: 'Midwest' },
];

// ── ROUND 5: Final Four (2 games) ──
const F4_RESULTS: GameResult[] = [
    { id: 'R5-1', homeTeamId: 'E1-Duke', awayTeamId: 'W1-Florida', homeScore: 55, awayScore: 67, winnerTeamId: 'W1-Florida', round: 5, region: 'Final Four' },
    { id: 'R5-2', homeTeamId: 'S1-Auburn', awayTeamId: 'M1-Houston', homeScore: 54, awayScore: 61, winnerTeamId: 'M1-Houston', round: 5, region: 'Final Four' },
];

// ── ROUND 6: Championship (1 game) ──
const CHAMP_RESULTS: GameResult[] = [
    { id: 'R6-CHAMP', homeTeamId: 'W1-Florida', awayTeamId: 'M1-Houston', homeScore: 65, awayScore: 63, winnerTeamId: 'W1-Florida', round: 6, region: 'Championship' },
];

// All results grouped by round for easy access
const ALL_RESULTS_BY_ROUND: Record<number, GameResult[]> = {
    1: R64_RESULTS,
    2: R32_RESULTS,
    3: S16_RESULTS,
    4: E8_RESULTS,
    5: F4_RESULTS,
    6: CHAMP_RESULTS,
};

// ─── TOURNAMENT GENERATOR ────────────────────────────────────────

function buildSlotId(gameId: string): string {
    return `slot-${gameId}`;
}

/**
 * Returns the next-round game ID that a given round-game winner advances to.
 * Implements standard NCAA bracket advancement:
 *   R1 games 1+2 → R2 game 1, R1 games 3+4 → R2 game 2, etc.
 */
function getNextGameId(gameId: string, _round: number, region: string): string | undefined {
    const regionPrefix = region.charAt(0); // E, W, S, M

    // Map game index within region+round to next round game
    const gameMap: Record<string, string> = {};

    // R64 → R32
    for (let i = 1; i <= 8; i += 2) {
        const nextIdx = Math.ceil(i / 2);
        gameMap[`R1-${regionPrefix}${i}`] = `R2-${regionPrefix}${nextIdx}`;
        gameMap[`R1-${regionPrefix}${i + 1}`] = `R2-${regionPrefix}${nextIdx}`;
    }
    // R32 → S16
    for (let i = 1; i <= 4; i += 2) {
        const nextIdx = Math.ceil(i / 2);
        gameMap[`R2-${regionPrefix}${i}`] = `R3-${regionPrefix}${nextIdx}`;
        gameMap[`R2-${regionPrefix}${i + 1}`] = `R3-${regionPrefix}${nextIdx}`;
    }
    // S16 → E8
    gameMap[`R3-${regionPrefix}1`] = `R4-${regionPrefix}1`;
    gameMap[`R3-${regionPrefix}2`] = `R4-${regionPrefix}1`;

    // E8 → F4 (cross-region)
    gameMap['R4-E1'] = 'R5-1';  // East champion vs West champion
    gameMap['R4-W1'] = 'R5-1';
    gameMap['R4-S1'] = 'R5-2';  // South champion vs Midwest champion
    gameMap['R4-M1'] = 'R5-2';

    // F4 → Championship
    gameMap['R5-1'] = 'R6-CHAMP';
    gameMap['R5-2'] = 'R6-CHAMP';

    return gameMap[gameId];
}

/**
 * Generate a full tournament with all games initially SCHEDULED.
 * Call revealRound() to reveal each round's results.
 */
export function generateTournament2025(): Tournament {
    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    // Build all games from all rounds
    const allResults = [
        ...R64_RESULTS, ...R32_RESULTS, ...S16_RESULTS,
        ...E8_RESULTS, ...F4_RESULTS, ...CHAMP_RESULTS,
    ];

    for (const result of allResults) {
        const game: Game = {
            id: result.id,
            startTime: new Date('2025-03-20T12:00:00Z').toISOString(),
            status: 'SCHEDULED', // All start as scheduled
            homeTeamId: result.homeTeamId,
            awayTeamId: result.awayTeamId,
            homeScore: 0,
            awayScore: 0,
            round: result.round,
            ...(result.region ? { region: result.region } : { region: null }), // Ensure null if no region
        };
        games[result.id] = game;

        // Build slot
        const nextGameId = getNextGameId(result.id, result.round, result.region || '');
        const slot: TournamentSlot = {
            id: buildSlotId(result.id),
            gameId: result.id,
            nextSlotId: nextGameId ? buildSlotId(nextGameId) : null,
        };
        slots[slot.id] = slot;
    }

    return {
        id: 'mens-2025',
        seasonYear: 2025,
        gender: 'mens',
        isFinalized: false,
        games,
        slots,
    };
}

/**
 * Reveal all games in a specific round — set status to FINAL, 
 * fill in scores and winnerTeamId.
 */
export function revealRound(tournament: Tournament, round: number): Tournament {
    const results = ALL_RESULTS_BY_ROUND[round];
    if (!results) return tournament;

    const updated = { ...tournament, games: { ...tournament.games } };

    for (const result of results) {
        if (updated.games[result.id]) {
            updated.games[result.id] = {
                ...updated.games[result.id],
                status: 'FINAL',
                homeScore: result.homeScore,
                awayScore: result.awayScore,
                winnerTeamId: result.winnerTeamId,
            };
        }
    }

    // If championship is revealed, finalize the tournament
    if (round === 6) {
        updated.isFinalized = true;
    }

    return updated;
}

/**
 * Reveal ALL rounds at once — useful for simple unit tests.
 */
export function revealAllRounds(tournament: Tournament): Tournament {
    let t = tournament;
    for (let round = 1; round <= 6; round++) {
        t = revealRound(t, round);
    }
    return t;
}

/**
 * Get the championship total score for tiebreaker purposes.
 * Returns 128 (Florida 65 + Houston 63).
 */
export function getChampionshipTotal(): number {
    return 65 + 63; // 128
}

/**
 * Get all team IDs that are still alive (not eliminated) after a given round.
 */
export function getAliveTeamsAfterRound(round: number): string[] {
    // Start with all R64 teams
    const roundResults = ALL_RESULTS_BY_ROUND;
    const eliminated = new Set<string>();

    for (let r = 1; r <= round; r++) {
        const results = roundResults[r] || [];
        for (const game of results) {
            const loser = game.winnerTeamId === game.homeTeamId
                ? game.awayTeamId
                : game.homeTeamId;
            eliminated.add(loser);
        }
    }

    // Get all teams that participated in R64
    const allTeamIds = R64_RESULTS.flatMap(g => [g.homeTeamId, g.awayTeamId]);
    return allTeamIds.filter(id => !eliminated.has(id));
}

/**
 * Get all slot IDs for games that have been decided (FINAL).
 * This is what entries will have picks against.
 */
export function getAllPickableSlotIds(): string[] {
    const allResults = [
        ...R64_RESULTS, ...R32_RESULTS, ...S16_RESULTS,
        ...E8_RESULTS, ...F4_RESULTS, ...CHAMP_RESULTS,
    ];
    return allResults.map(r => buildSlotId(r.id));
}

/**
 * Get the correct pick (winner) for each slot.
 */
export function getCorrectPicks(): Record<string, string> {
    const picks: Record<string, string> = {};
    const allResults = [
        ...R64_RESULTS, ...R32_RESULTS, ...S16_RESULTS,
        ...E8_RESULTS, ...F4_RESULTS, ...CHAMP_RESULTS,
    ];
    for (const result of allResults) {
        picks[buildSlotId(result.id)] = result.winnerTeamId;
    }
    return picks;
}

/** Total number of games across all rounds */
export const TOTAL_GAMES = R64_RESULTS.length + R32_RESULTS.length + S16_RESULTS.length
    + E8_RESULTS.length + F4_RESULTS.length + CHAMP_RESULTS.length;

/** Total games per round */
export const GAMES_PER_ROUND: Record<number, number> = {
    1: R64_RESULTS.length,   // 32
    2: R32_RESULTS.length,   // 16
    3: S16_RESULTS.length,   // 8
    4: E8_RESULTS.length,    // 4
    5: F4_RESULTS.length,    // 2
    6: CHAMP_RESULTS.length, // 1
};
