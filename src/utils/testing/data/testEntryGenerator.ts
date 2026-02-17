/**
 * Test Entry Generator for E2E Bracket Pool Simulation
 * 
 * Generates N bracket entries with deterministic semi-random picks.
 * Uses a seeded PRNG for reproducibility — same seed = same entries every time.
 */

import { getCorrectPicks, generateTournament2025, getNextGameId, buildSlotId } from './tournament2025';
import type { Game } from '../../../types';

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
    const tournament = generateTournament2025();
    const games = Object.values(tournament.games);

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

        const entryPicks: Record<string, string> = {};

        // Helper to pick a winner between two teams
        const pickWinner = (t1: string, t2: string, slotId: string): string => {
            const correct = correctPicks[slotId];
            // If we have a chalk bias, and one of these teams is the correct winner, favor them
            if (rng() < chalkBias) {
                if (t1 === correct) return t1;
                if (t2 === correct) return t2;
            }
            // Otherwise random choice between the TWO participants
            return rng() < 0.5 ? t1 : t2;
        };

        // Standard 6-round advancement
        for (let r = 1; r <= 6; r++) {
            const roundGames = games.filter(g => (g as Game).round === r) as Game[];
            for (const g of roundGames) {
                const slotId = buildSlotId(g.id);
                let team1: string | undefined;
                let team2: string | undefined;

                if (r === 1) {
                    team1 = g.homeTeamId;
                    team2 = g.awayTeamId;
                } else {
                    // Logic to find which games lead to this one
                    const feederGames = games.filter(fg => {
                        const nextId = getNextGameId(fg.id, fg.round, fg.region || '');
                        return nextId === g.id;
                    });

                    if (feederGames.length === 2) {
                        team1 = entryPicks[buildSlotId(feederGames[0].id)];
                        team2 = entryPicks[buildSlotId(feederGames[1].id)];
                    } else if (feederGames.length === 1) {
                        // Safety for uneven transitions
                        team1 = entryPicks[buildSlotId(feederGames[0].id)];
                    }
                }

                if (team1 && team2) {
                    entryPicks[slotId] = pickWinner(team1, team2, slotId);
                } else if (team1) {
                    entryPicks[slotId] = team1;
                }
            }
        }

        // Tiebreaker: random value between 120-170
        const tiebreakerPrediction = Math.floor(120 + rng() * 50);

        entries.push({
            userName,
            picks: entryPicks,
            tiebreakerPrediction,
        });
    }

    return entries;
}

/**
 * Generate a small batch of hand-crafted entries for focused testing.
 */
export function generateControlEntries(): GeneratedEntry[] {
    const tournament = generateTournament2025();
    const games = Object.values(tournament.games);

    const generateSpecific = (mode: 'chalk' | 'upset' | 'half'): Record<string, string> => {
        const picks: Record<string, string> = {};
        const isCorrect = (_slotId: string, round: number, count: number) => {
            if (mode === 'chalk') return true;
            if (mode === 'upset') return false;
            // Alternating pattern for HalfRight
            return (round + count) % 2 === 0;
        };

        let count = 0;
        for (let r = 1; r <= 6; r++) {
            const roundGames = games.filter(g => (g as Game).round === r) as Game[];
            for (const g of roundGames) {
                count++;
                const slotId = buildSlotId(g.id);
                const winner = getCorrectPicks()[slotId];

                let team1: string, team2: string;
                if (r === 1) {
                    team1 = g.homeTeamId;
                    team2 = g.awayTeamId;
                } else {
                    const feeders = games.filter(fg => getNextGameId(fg.id, fg.round, fg.region || '') === g.id);
                    team1 = picks[buildSlotId(feeders[0].id)];
                    team2 = picks[buildSlotId(feeders[1].id)];
                }

                const loser = (team1 === winner) ? team2 : team1;
                picks[slotId] = isCorrect(slotId, r, count) ? winner : (loser || team2);
            }
        }
        return picks;
    };

    return [
        {
            userName: 'AllChalk',
            picks: generateSpecific('chalk'),
            tiebreakerPrediction: 128,
        },
        {
            userName: 'AllUpset',
            picks: generateSpecific('upset'),
            tiebreakerPrediction: 160,
        },
        {
            userName: 'HalfRight',
            picks: generateSpecific('half'),
            tiebreakerPrediction: 140,
        },
    ];
}

