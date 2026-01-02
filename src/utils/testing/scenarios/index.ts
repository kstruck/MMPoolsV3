// Pre-defined Test Scenarios - Index
// Exports all available test scenarios for the UI dropdown

import basicQuarters from './basic-quarters.json';
import everyScoreWins from './every-score-wins.json';
import partialFill from './partial-fill.json';

export interface TestAssertion {
    type: 'winnerCount' | 'winnerCountAtLeast' | 'winnerExists' | 'totalPayout' | 'poolStatus';
    expected?: number | string;
    period?: string;
    digits?: [number, number];
    message: string;
}

export interface TestScenario {
    id: string;
    name: string;
    description: string;
    poolConfig: {
        name: string;
        type: string;
        costPerSquare: number;
        maxPlayers: number;
        ruleVariations?: Record<string, any>;
    };
    squareCount?: number; // Default 100
    testUsers: Array<{
        name: string;
        strategy: string;
    }>;
    scoreUpdates: Array<{
        period: string;
        homeScore: number;
        awayScore: number;
    }>;
    assertions: TestAssertion[];
}

export const SCENARIOS: Record<string, TestScenario> = {
    'basic-quarters': basicQuarters as TestScenario,
    'every-score-wins': everyScoreWins as TestScenario,
    'partial-fill': partialFill as TestScenario,
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

export function getScenarioById(id: string): TestScenario | undefined {
    return SCENARIOS[id];
}
