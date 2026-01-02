// Simplified Test Orchestrator
// Uses pre-defined scenarios instead of AI generation


import { getScenarioById, SCENARIO_LIST } from './scenarios';
import type { ValidationResult } from './scenarios/assertionRunner';
import { runAssertions } from './scenarios/assertionRunner';
import { runScenario } from './simulators/squaresSimulator';
import { dbService } from '../../services/dbService';

export interface SimpleTestResult {
    scenarioId: string;
    scenarioName: string;
    status: 'PASS' | 'FAIL' | 'ERROR';
    duration: number;
    validation: ValidationResult | null;
    error?: string;
    steps: any[];
    poolId?: string;
}

/**
 * Run a pre-defined test scenario
 * No AI involved - just simulation + code-based assertions
 */
export async function runPredefinedTest(scenarioId: string): Promise<SimpleTestResult> {
    const startTime = Date.now();

    const scenario = getScenarioById(scenarioId);
    if (!scenario) {
        return {
            scenarioId,
            scenarioName: 'Unknown',
            status: 'ERROR',
            duration: 0,
            validation: null,
            error: `Scenario not found: ${scenarioId}`,
            steps: []
        };
    }

    try {
        // Run simulation with pre-defined scenario
        const settings = {
            ...scenario.poolConfig,
            _fullScenario: {
                testUsers: scenario.testUsers,
                actions: scenario.scoreUpdates.map(u => ({
                    actionType: 'SCORE_UPDATE',
                    period: u.period,
                    homeScore: u.homeScore,
                    awayScore: u.awayScore
                }))
            }
        };

        const result = await runScenario('basic-100', 'actual', settings);

        if (!result.poolId) {
            return {
                scenarioId,
                scenarioName: scenario.name,
                status: 'ERROR',
                duration: Date.now() - startTime,
                validation: null,
                error: 'Pool was not created',
                steps: result.steps
            };
        }

        // Fetch final data for validation
        const pool = await dbService.getPoolById(result.poolId);
        const winners = await dbService.getWinners(result.poolId);

        // Run assertions
        const validation = runAssertions(scenario, winners, pool);

        return {
            scenarioId,
            scenarioName: scenario.name,
            status: validation.passed ? 'PASS' : 'FAIL',
            duration: Date.now() - startTime,
            validation,
            steps: result.steps,
            poolId: result.poolId
        };

    } catch (error: any) {
        return {
            scenarioId,
            scenarioName: scenario.name,
            status: 'ERROR',
            duration: Date.now() - startTime,
            validation: null,
            error: error.message,
            steps: []
        };
    }
}

/**
 * Get list of available test scenarios for UI dropdown
 */
export function getAvailableScenarios(): Array<{ id: string; name: string; description: string }> {
    return SCENARIO_LIST.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description
    }));
}

/**
 * Run all pre-defined tests and return summary
 */
export async function runAllTests(): Promise<{
    passed: number;
    failed: number;
    errors: number;
    results: SimpleTestResult[];
}> {
    const results: SimpleTestResult[] = [];

    for (const scenario of SCENARIO_LIST) {
        const result = await runPredefinedTest(scenario.id);
        results.push(result);
    }

    return {
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length,
        errors: results.filter(r => r.status === 'ERROR').length,
        results
    };
}
