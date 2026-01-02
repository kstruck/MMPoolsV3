// Pre-defined Test Scenarios - Index
// Exports all available test scenarios for the UI dropdown

import basicQuarters from './basic-quarters.json';
import everyScoreWins from './every-score-wins.json';
import partialFill from './partial-fill.json';
import propsBasic from './props-basic.json';

export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS';

export interface TestAssertion {
    type: 'winnerCount' | 'winnerCountAtLeast' | 'winnerExists' | 'totalPayout' | 'poolStatus'
    | 'propCardCount' | 'propWinner' | 'propTopScore';
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
        answers: Record<string, number>;
        tiebreakerVal?: number;
    }>;
    grading?: Record<string, number>;
    assertions: TestAssertion[];
}

export const SCENARIOS: Record<string, TestScenario> = {
    'basic-quarters': basicQuarters as unknown as TestScenario,
    'every-score-wins': everyScoreWins as unknown as TestScenario,
    'partial-fill': partialFill as unknown as TestScenario,
    'props-basic': propsBasic as unknown as TestScenario,
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
