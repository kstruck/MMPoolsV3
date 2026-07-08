// Pre-defined Test Scenarios - Index
// Exports all available test scenarios for the UI dropdown

import basicQuarters from './basic-quarters.json';
import everyScoreWins from './every-score-wins.json';
import partialFill from './partial-fill.json';
import propsBasic from './props-basic.json';
import bracketBasic from './bracket-basic.json';
import playoffBasic from './playoff-basic.json';
import playoffLifecycle from './playoff-lifecycle.json';
import bracketFibonacci from './bracket-fibonacci.json';
import bracketCustom from './bracket-custom.json';
import bracketMaxScore from './bracket-max-score.json';
import bracketEspn from './bracket-espn.json';
import bracketTiebreaker from './bracket-tiebreaker.json';
import bracketIncomplete from './bracket-incomplete.json';
import bracketZeroCorrect from './bracket-zero-correct.json';
import bracketE2EFullTournament from './bracket-e2e-full-tournament.json';
import nflPickemBasic from './nfl-pickem-basic.json';
import nflSurvivorBasic from './nfl-survivor-basic.json';
import nflMarginBasic from './nfl-margin-basic.json';

export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS'
    | 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';

export interface TestAssertion {
    type: 'winnerCount' | 'winnerCountAtLeast' | 'winnerExists' | 'totalPayout' | 'poolStatus'
    | 'propCardCount' | 'propWinner' | 'propTopScore'
    | 'bracketEntryCount' | 'bracketWinner' | 'bracketTopScore' | 'maxScoreAtLeast'
    | 'playoffEntryCount' | 'playoffWinner'
    // NFL season pools (entries/recaps hydrated by nflSeasonSimulator)
    | 'nflEntryCount' | 'nflTotalScore' | 'nflWeeklyPoints' | 'nflWinner'
    | 'survivorStatus' | 'survivorStrikes'
    | 'marginSeasonTotal' | 'marginRank'
    | 'recapExists' | 'recapClosestTiebreaker';
    expected?: number | string | boolean;
    period?: string;
    digits?: [number, number];
    field?: string; // For poolStatus checks
    userName?: string; // NFL assertions target an entry by user name
    week?: number; // NFL weekly assertions / recap checks
    message: string;
}

// Synthetic NFL game in a scenario. Keyed by array order: game N is
// addressable in picks as "gN" (1-based); the simulator translates those keys
// to the run's real sim- doc IDs at seed time.
export interface ScenarioNFLGame {
    week: number;
    home: string; // team abbreviation, e.g. "KC"
    away: string;
    homeScore?: number;
    awayScore?: number;
    status?: 'FINAL' | 'IN_PROGRESS' | 'SCHEDULED' | 'CANCELLED'; // default FINAL
    isMonday?: boolean;
    spread?: number; // relative to home (negative = home favored); locked at seed
}

export interface TestScenario {
    id: string;
    name: string;
    description: string;
    poolType?: PoolType; // Default: SQUARES
    isE2E?: boolean; // If true, uses E2E simulator instead of standard simulator
    poolConfig: {
        name: string;
        type: string;
        costPerSquare?: number;
        cost?: number; // For props
        maxPlayers?: number;
        maxCards?: number; // For props
        ruleVariations?: Record<string, unknown>;
        scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        entryFee?: number;
    };
    // E2E-specific configuration
    e2eConfig?: {
        entryCount?: number;
        scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        customScoring?: number[];
        chalkBias?: number;
        seed?: number;
        includePerfectBracket?: boolean;
        includeControlEntries?: boolean;
    };
    squareCount?: number; // Default 100 (SQUARES only)
    testUsers?: Array<{
        name: string;
        strategy: string;
    }>;
    scoreUpdates?: Array<{
        period: string;
        homeScore: number;
        awayScore: number;
    }>;
    // Props-specific
    questions?: Array<{
        id: string;
        text: string;
        options: string[];
        points?: number;
    }>;
    testEntries?: Array<{
        userName: string;
        answers?: Record<string, number>; // Props
        rankings?: Record<string, number>; // Playoff
        picks?: Record<string, string>; // Bracket
        tiebreaker?: number; // Props
        tiebreakerVal?: number; // Playoff (standardize?)
        tiebreakerPrediction?: number; // Bracket
        // NFL Pick'em: week -> gameKey ("g1"...) -> team abbreviation
        pickemPicks?: Record<string, Record<string, string>>;
        // NFL Pick'em confidence: week -> gameKey -> value
        confidence?: Record<string, Record<string, number>>;
        // NFL Pick'em: week -> MNF combined-score prediction
        weeklyTiebreakers?: Record<string, number>;
        // NFL Survivor / Margin: week -> team abbreviation
        survivorPicks?: Record<string, string>;
        marginPicks?: Record<string, string>;
        usedTeams?: string[]; // Survivor pre-seeded history
    }>;
    grading?: Record<string, number>;
    assertions: TestAssertion[];
    tournamentResults?: unknown; // Bracket results
    roundResults?: unknown; // Playoff round results
    // NFL season pools: synthetic games (seeded via simSeedNFLGames) + which
    // weeks to score via the real scoreNFLWeek callable, in order.
    nflGames?: ScenarioNFLGame[];
    scoreWeeks?: number[];
}

export const SCENARIOS: Record<string, TestScenario> = {
    'basic-quarters': basicQuarters as unknown as TestScenario,
    'every-score-wins': everyScoreWins as unknown as TestScenario,
    'partial-fill': partialFill as unknown as TestScenario,
    'props-basic': propsBasic as unknown as TestScenario,
    'bracket-basic': bracketBasic as unknown as TestScenario,
    'playoff-basic': playoffBasic as unknown as TestScenario,
    'playoff-lifecycle': playoffLifecycle as unknown as TestScenario,
    'bracket-fibonacci': bracketFibonacci as unknown as TestScenario,
    'bracket-custom': bracketCustom as unknown as TestScenario,
    'bracket-max-score': bracketMaxScore as unknown as TestScenario,
    'bracket-espn': bracketEspn as unknown as TestScenario,
    'bracket-tiebreaker': bracketTiebreaker as unknown as TestScenario,
    'bracket-incomplete': bracketIncomplete as unknown as TestScenario,
    'bracket-zero-correct': bracketZeroCorrect as unknown as TestScenario,
    'bracket-e2e-full-tournament': bracketE2EFullTournament as unknown as TestScenario,
    'nfl-pickem-basic': nflPickemBasic as unknown as TestScenario,
    'nfl-survivor-basic': nflSurvivorBasic as unknown as TestScenario,
    'nfl-margin-basic': nflMarginBasic as unknown as TestScenario,
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
