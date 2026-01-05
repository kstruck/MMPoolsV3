// Pre-defined Test Scenarios - Index
// Exports all available test scenarios for the UI dropdown

import basicQuarters from './basic-quarters.json';
import everyScoreWins from './every-score-wins.json';
import partialFill from './partial-fill.json';
import propsBasic from './props-basic.json';
import bracketBasic from './bracket-basic.json';
import playoffBasic from './playoff-basic.json';
import playoffLifecycle from './playoff-lifecycle.json';

export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS';

export interface TestAssertion {
    type: 'winnerCount' | 'winnerCountAtLeast' | 'winnerExists' | 'totalPayout' | 'poolStatus'
    | 'propCardCount' | 'propWinner' | 'propTopScore'
    | 'bracketEntryCount' | 'bracketWinner' | 'bracketTopScore'
    | 'playoffEntryCount' | 'playoffWinner';
    expected?: number | string | boolean;
    period?: string;
    digits?: [number, number];
    field?: string; // For poolStatus checks
    message: string;
}

export interface TestScenario {
    id: string;
    name: string;
    description: string;
    poolType?: PoolType; // Default: SQUARES
    poolConfig: {
        name: string;
        type: string;
        costPerSquare?: number;
        cost?: number; // For props
        maxPlayers?: number;
        maxCards?: number; // For props
        ruleVariations?: Record<string, any>;
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
        tiebreaker?: number; // Props
        tiebreakerVal?: number; // Playoff (standardize?)
    }>;
    grading?: Record<string, number>;
    assertions: TestAssertion[];
    roundResults?: any; // Playoff round results
}

export const SCENARIOS: Record<string, TestScenario> = {
    'basic-quarters': basicQuarters as unknown as TestScenario,
    'every-score-wins': everyScoreWins as unknown as TestScenario,
    'partial-fill': partialFill as unknown as TestScenario,
    'props-basic': propsBasic as unknown as TestScenario,
    'bracket-basic': bracketBasic as unknown as TestScenario,
    'playoff-basic': playoffBasic as unknown as TestScenario,
    'playoff-lifecycle': playoffLifecycle as unknown as TestScenario,
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
