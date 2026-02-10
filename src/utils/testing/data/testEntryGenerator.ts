/**
 * Test Entry Generator for E2E Bracket Pool Simulation
 * 
 * Generates N bracket entries with deterministic semi-random picks.
 * Uses a seeded PRNG for reproducibility — same seed = same entries every time.
 */

import { getCorrectPicks, getAllPickableSlotIds, TEAMS } from './tournament2025';

// ─── SEEDED PSEUDO-RANDOM NUMBER GENERATOR ───────────────────────
// Mulberry32 — simple, fast, deterministic
function mulberry32(seed: number): () => number {
    let a = seed | 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── ENTRY GENERATOR ─────────────────────────────────────────────

export interface GeneratedEntry {
    userName: string;
    picks: Record<string, string>;
    tiebreakerPrediction: number;
}

interface GeneratorOptions {
    /** 0-1: Higher = more chalk picks (favorites win). Default: 0.65 */
    chalkBias?: number;
    /** Seed for deterministic RNG. Default: 42 */
    seed?: number;
    /** Include one perfect bracket? Default: false */
    includePerfectBracket?: boolean;
}

// Fun bracket entry names
const ENTRY_NAMES = [
    'Cinderella Story', 'Bracketologist', 'March Madness', 'Chalk Walk',
    'Upset Special', 'Court Wizard', 'Net Cutter', 'Buzzer Beater',
    'Three-Pointer', 'Full Court Press', 'Slam Dunk', 'Glass Slipper',
    'Title Town', 'Dynasty Builder', 'Dark Horse', 'Wild Card',
    'Paint Beast', 'Floor General', 'Sixth Man', 'Bench Mob',
    'Lucky Bounce', 'Swish City', 'Ball Hawk', 'Rim Protector',
    'Fast Break', 'Pick and Roll', 'Alley Oop', 'Free Throw',
    'Double Dribble', 'Fadeaway', 'Hook Shot', 'Sky Hook',
    'Money Ball', 'nothing but Net', 'Air Ball', 'Bank Shot',
    'Hail Mary', 'Game Winner', 'Overtime Hero', 'Clutch Time',
    'Ice Cold', 'Hot Streak', 'Zone Buster', 'Man-to-Man',
    'Press Breaker', 'Shot Clock', 'Turnover King', 'Steal Artist',
    'Rebound King', 'Assist Leader',
];

/**
 * Generate N bracket entries with configurable randomness.
 * Each entry gets picks for all 63 games (R64 through Championship).
 */
export function generateEntries(
    count: number,
    options: GeneratorOptions = {}
): GeneratedEntry[] {
    const {
        chalkBias = 0.65,
        seed = 42,
        includePerfectBracket = false,
    } = options;

    const rng = mulberry32(seed);
    const correctPicks = getCorrectPicks();
    const slotIds = getAllPickableSlotIds();

    // Collect all team IDs that participate in R64
    const allTeamIds = TEAMS
        .filter(t => !t.id.startsWith('FF-')) // exclude First Four-only teams
        .map(t => t.id);

    const entries: GeneratedEntry[] = [];

    // Optionally add a perfect bracket as entry #0
    if (includePerfectBracket) {
        entries.push({
            userName: 'PerfectBracket',
            picks: { ...correctPicks },
            tiebreakerPrediction: 128, // Exact championship total (65+63)
        });
    }

    for (let i = 0; i < count; i++) {
        const entryIdx = entries.length;
        const baseName = ENTRY_NAMES[entryIdx % ENTRY_NAMES.length];
        const suffix = entryIdx >= ENTRY_NAMES.length ? ` #${Math.floor(entryIdx / ENTRY_NAMES.length) + 1}` : '';
        const userName = `${baseName}${suffix}`;

        const picks: Record<string, string> = {};

        for (const slotId of slotIds) {
            const correct = correctPicks[slotId];
            if (!correct) continue;

            // With chalkBias probability, pick the correct winner.
            // Otherwise, pick a random team from the pool.
            if (rng() < chalkBias) {
                picks[slotId] = correct;
            } else {
                // Pick a random team — weighted toward the other team in that matchup
                // For simplicity, just pick a random team from the full team pool
                const randomTeam = allTeamIds[Math.floor(rng() * allTeamIds.length)];
                picks[slotId] = randomTeam;
            }
        }

        // Tiebreaker: random value between 120-170 (reasonable championship total range)
        const tiebreakerPrediction = Math.floor(120 + rng() * 50);

        entries.push({
            userName,
            picks,
            tiebreakerPrediction,
        });
    }

    return entries;
}

/**
 * Generate a small batch of hand-crafted entries for focused testing.
 * These have predictable pick patterns:
 *   - allChalk: always picks the favorite (correct pick)
 *   - allUpset: always picks the underdog (wrong pick)
 *   - halfRight: alternates correct/incorrect
 */
export function generateControlEntries(): GeneratedEntry[] {
    const correctPicks = getCorrectPicks();
    const slotIds = getAllPickableSlotIds();

    // Collect all team IDs
    const allTeamIds = TEAMS
        .filter(t => !t.id.startsWith('FF-'))
        .map(t => t.id);

    // All chalk (should have highest score)
    const chalkPicks: Record<string, string> = { ...correctPicks };

    // All upset (should have lowest or zero score)
    const upsetPicks: Record<string, string> = {};
    for (const slotId of slotIds) {
        const correct = correctPicks[slotId];
        // Pick a team that is NOT the correct winner
        const wrongTeam = allTeamIds.find(t => t !== correct) || allTeamIds[0];
        upsetPicks[slotId] = wrongTeam;
    }

    // Half right (alternating)
    const halfPicks: Record<string, string> = {};
    let flipFlop = true;
    for (const slotId of slotIds) {
        if (flipFlop) {
            halfPicks[slotId] = correctPicks[slotId];
        } else {
            const correct = correctPicks[slotId];
            const wrongTeam = allTeamIds.find(t => t !== correct) || allTeamIds[0];
            halfPicks[slotId] = wrongTeam;
        }
        flipFlop = !flipFlop;
    }

    return [
        {
            userName: 'AllChalk',
            picks: chalkPicks,
            tiebreakerPrediction: 128, // Exact
        },
        {
            userName: 'AllUpset',
            picks: upsetPicks,
            tiebreakerPrediction: 160,
        },
        {
            userName: 'HalfRight',
            picks: halfPicks,
            tiebreakerPrediction: 140,
        },
    ];
}
