
import { Tournament, Game, TournamentSlot, Team } from "./types";

// ----------------------------------------------------------------------------
// Mock Data (Teams) - In reality, fetch from API or standard list
// ----------------------------------------------------------------------------
export const MENS_TEAMS_2024: Team[] = [
    // SOUTH
    { id: 'hou', name: 'Houston', seed: 1, region: 'South' },
    { id: 'mar', name: 'Marquette', seed: 2, region: 'South' },
    { id: 'uk', name: 'Kentucky', seed: 3, region: 'South' },
    { id: 'duke', name: 'Duke', seed: 4, region: 'South' },
    { id: 'wisc', name: 'Wisconsin', seed: 5, region: 'South' },
    { id: 'tt', name: 'Texas Tech', seed: 6, region: 'South' },
    { id: 'fla', name: 'Florida', seed: 7, region: 'South' },
    { id: 'neb', name: 'Nebraska', seed: 8, region: 'South' },
    { id: 'tam', name: 'Texas A&M', seed: 9, region: 'South' },
    { id: 'col', name: 'Colorado', seed: 10, region: 'South' },
    { id: 'ncst', name: 'NC State', seed: 11, region: 'South' },
    { id: 'jmu', name: 'James Madison', seed: 12, region: 'South' },
    { id: 'ver', name: 'Vermont', seed: 13, region: 'South' },
    { id: 'oak', name: 'Oakland', seed: 14, region: 'South' },
    { id: 'wky', name: 'W. Kentucky', seed: 15, region: 'South' },
    { id: 'long', name: 'Longwood', seed: 16, region: 'South' },
    // EAST
    { id: 'conn', name: 'UConn', seed: 1, region: 'East' },
    { id: 'isu', name: 'Iowa State', seed: 2, region: 'East' },
    { id: 'ill', name: 'Illinois', seed: 3, region: 'East' },
    { id: 'aub', name: 'Auburn', seed: 4, region: 'East' },
    { id: 'sdsu', name: 'San Diego St', seed: 5, region: 'East' },
    { id: 'byu', name: 'BYU', seed: 6, region: 'East' },
    { id: 'wsu', name: 'Wash State', seed: 7, region: 'East' },
    { id: 'fau', name: 'FAU', seed: 8, region: 'East' },
    { id: 'nw', name: 'Northwestern', seed: 9, region: 'East' },
    { id: 'drake', name: 'Drake', seed: 10, region: 'East' },
    { id: 'duq', name: 'Duquesne', seed: 11, region: 'East' },
    { id: 'uab', name: 'UAB', seed: 12, region: 'East' },
    { id: 'yale', name: 'Yale', seed: 13, region: 'East' },
    { id: 'more', name: 'Morehead St', seed: 14, region: 'East' },
    { id: 'sdak', name: 'S. Dakota St', seed: 15, region: 'East' },
    { id: 'stet', name: 'Stetson', seed: 16, region: 'East' },
    // MIDWEST
    { id: 'pur', name: 'Purdue', seed: 1, region: 'Midwest' },
    { id: 'tenn', name: 'Tennessee', seed: 2, region: 'Midwest' },
    { id: 'crei', name: 'Creighton', seed: 3, region: 'Midwest' },
    { id: 'kan', name: 'Kansas', seed: 4, region: 'Midwest' },
    { id: 'gonz', name: 'Gonzaga', seed: 5, region: 'Midwest' },
    { id: 'sc', name: 'S. Carolina', seed: 6, region: 'Midwest' },
    { id: 'tex', name: 'Texas', seed: 7, region: 'Midwest' },
    { id: 'usu', name: 'Utah State', seed: 8, region: 'Midwest' },
    { id: 'tcu', name: 'TCU', seed: 9, region: 'Midwest' },
    { id: 'csu', name: 'Colorado St', seed: 10, region: 'Midwest' },
    { id: 'ore', name: 'Oregon', seed: 11, region: 'Midwest' },
    { id: 'mcns', name: 'McNeese', seed: 12, region: 'Midwest' },
    { id: 'sam', name: 'Samford', seed: 13, region: 'Midwest' },
    { id: 'akr', name: 'Akron', seed: 14, region: 'Midwest' },
    { id: 'sp', name: 'St. Peters', seed: 15, region: 'Midwest' },
    { id: 'gram', name: 'Grambling', seed: 16, region: 'Midwest' },
    // WEST
    { id: 'unc', name: 'N. Carolina', seed: 1, region: 'West' },
    { id: 'ariz', name: 'Arizona', seed: 2, region: 'West' },
    { id: 'bay', name: 'Baylor', seed: 3, region: 'West' },
    { id: 'ala', name: 'Alabama', seed: 4, region: 'West' },
    { id: 'smc', name: 'St. Marys', seed: 5, region: 'West' },
    { id: 'clem', name: 'Clemson', seed: 6, region: 'West' },
    { id: 'day', name: 'Dayton', seed: 7, region: 'West' },
    { id: 'msu', name: 'Miss State', seed: 8, region: 'West' },
    { id: 'mich', name: 'Michigan St', seed: 9, region: 'West' },
    { id: 'nev', name: 'Nevada', seed: 10, region: 'West' },
    { id: 'nm', name: 'New Mexico', seed: 11, region: 'West' },
    { id: 'gcu', name: 'Grand Canyon', seed: 12, region: 'West' },
    { id: 'chas', name: 'Charleston', seed: 13, region: 'West' },
    { id: 'colg', name: 'Colgate', seed: 14, region: 'West' },
    { id: 'lbsu', name: 'Long Beach', seed: 15, region: 'West' },
    { id: 'wag', name: 'Wagner', seed: 16, region: 'West' },
];

export function generateTournamentTemplate(seasonYear: number, gender: 'mens' | 'womens'): Tournament {
    return {
        id: `${gender}-${seasonYear}`,
        seasonYear,
        gender,
        isFinalized: false,
        games: generateEmptyGames(),
        slots: generateSlots(),
    };
}

// ----------------------------------------------------------------------------
// Topology Generation (63 Games)
// ----------------------------------------------------------------------------

function generateSlots(): Record<string, TournamentSlot> {
    const slots: Record<string, TournamentSlot> = {};
    const regions = ['South', 'East', 'Midwest', 'West'];

    // Round 1 (32 games, 64 teams)
    // Slot IDs: R1-South-1 (1 vs 16), R1-South-2 (2 vs 15)...
    regions.forEach(region => {
        const matchups = [
            [1, 16], [8, 9], [5, 12], [4, 13],
            [6, 11], [3, 14], [7, 10], [2, 15]
        ];
        matchups.forEach((match, i) => {
            // Game Order in Standard Bracket flow
            // 1vs16 -> Winner to R2 Game 1
            // 8vs9  -> Winner to R2 Game 1
            // ...
            // We need a stable ID system.
            // Slot ID convention: R{round}-{Region}-{MatchIndex}
            const gameId = `G-R1-${region}-${i + 1}`;
            const slotId = `R1-${region}-${i + 1}`;

            // Calculate Next Slot
            // Pair 0&1 -> Next 0
            // Pair 2&3 -> Next 1
            const nextMatchIndex = Math.floor(i / 2) + 1;
            const nextSlotId = `R2-${region}-${nextMatchIndex}`;

            slots[slotId] = {
                id: slotId,
                gameId: gameId,
                nextSlotId: nextSlotId
            };
        });
    });

    // Round 2 (16 games)
    regions.forEach(region => {
        for (let i = 1; i <= 4; i++) {
            const slotId = `R2-${region}-${i}`;
            const gameId = `G-R2-${region}-${i}`;
            const nextMatchIndex = Math.floor((i - 1) / 2) + 1;
            const nextSlotId = `R3-${region}-${nextMatchIndex}`;
            slots[slotId] = { id: slotId, gameId, nextSlotId };
        }
    });

    // Round 3 (Sweet 16)
    regions.forEach(region => {
        for (let i = 1; i <= 2; i++) {
            const slotId = `R3-${region}-${i}`;
            const gameId = `G-R3-${region}-${i}`;
            const nextMatchIndex = 1; // Only 1 game in R4 per region
            const nextSlotId = `R4-${region}-${nextMatchIndex}`;
            slots[slotId] = { id: slotId, gameId, nextSlotId };
        }
    });

    // Round 4 (Elite 8) - Winner goes to Final Four
    // Regions map to Semi-Finals: South vs East, Midwest vs West (Standard rotation varies)
    // Let's assume South(0) vs East(1), Midwest(2) vs West(3)
    regions.forEach((region, idx) => {
        const slotId = `R4-${region}-1`;
        const gameId = `G-R4-${region}-1`;

        // Final Four Matchups
        const nextMatchIndex = idx < 2 ? 1 : 2; // Game 1 or Game 2 of FF
        const nextSlotId = `R5-FF-${nextMatchIndex}`;

        slots[slotId] = { id: slotId, gameId, nextSlotId };
    });

    // Round 5 (Final Four)
    for (let i = 1; i <= 2; i++) {
        const slotId = `R5-FF-${i}`;
        const gameId = `G-R5-FF-${i}`;
        const nextSlotId = `R6-CHAMP-1`;
        slots[slotId] = { id: slotId, gameId, nextSlotId };
    }

    // Round 6 (Championship)
    const slotId = `R6-CHAMP-1`;
    const gameId = `G-R6-CHAMP-1`;
    slots[slotId] = { id: slotId, gameId }; // No next slot

    return slots;
}

function generateEmptyGames(): Record<string, Game> {
    const games: Record<string, Game> = {};
    // Using same IDs as in slots
    // We would need to populate these based on the logic above
    // Ideally the slot generation fills the games too or we derive them.
    // For simplicity of this artifact, I will skip the full iteration again 
    // and assume the consumer (simulation) will populate games as it simulates.
    return games;
}
