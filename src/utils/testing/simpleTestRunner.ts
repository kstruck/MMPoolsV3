// Simplified Test Orchestrator
// Uses pre-defined scenarios instead of AI generation


import { getScenarioById, SCENARIO_LIST } from './scenarios';
import type { ValidationResult } from './scenarios/assertionRunner';
import { runAssertions } from './scenarios/assertionRunner';
import { runScenario } from './simulators/squaresSimulator';
import { dbService } from '../../services/dbService';
import { runScenario as runBracketScenario } from './simulators/bracketSimulator';
import { runScenario as runPropsScenario } from './simulators/propsSimulator';
import { runScenario as runPlayoffScenario } from './simulators/playoffSimulator';
import { runE2EBracketSimulation } from './simulators/bracketE2ESimulator';
import { runNFLSeasonScenario } from './simulators/nflSeasonSimulator';
import type { TestScenario } from './scenarios';
import type { Pool, Winner, PropCard, BracketEntry } from '../../types';

export interface SimpleTestResult {
    scenarioId: string;
    scenarioName: string;
    status: 'PASS' | 'FAIL' | 'ERROR';
    duration: number;
    validation: ValidationResult | null;
    error?: string;
    steps: { step: string; status: string; message?: string; data?: unknown }[];
    poolId?: string;
}

/**
 * Run a pre-defined test scenario
 * No AI involved - just simulation + code-based assertions
 */
export async function runPredefinedTest(scenarioId: string): Promise<SimpleTestResult> {
    const startTime = Date.now();

    const scenario = getScenarioById(scenarioId) as TestScenario;
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
        const poolType = scenario.poolType || 'SQUARES';
        let result: { poolId?: string; steps: { step: string; status: string; message: string; data?: unknown }[] };

        if (poolType === 'NFL_PICKEM' || poolType === 'NFL_SURVIVOR' || poolType === 'NFL_MARGIN') {
            // NFL season pools: the simulator creates via the real callable,
            // mutates only through the guarded sim harness, scores via the real
            // scoreNFLWeek, hydrates BEFORE guaranteed cleanup — so assertions
            // run on the returned snapshot, never on re-read (deleted) docs.
            const nflResult = await runNFLSeasonScenario(scenario);
            const nflPool = {
                ...(nflResult.poolSnapshot ?? {}),
                _nflEntries: nflResult.entries,
                _nflRecaps: nflResult.recaps,
            } as unknown as Pool;
            const validation = runAssertions(scenario, [], nflPool);
            return {
                scenarioId,
                scenarioName: scenario.name,
                status: nflResult.poolId
                    ? (validation.passed ? 'PASS' : 'FAIL')
                    : 'ERROR',
                duration: Date.now() - startTime,
                validation,
                error: nflResult.poolId ? undefined : 'Pool was not created',
                steps: nflResult.steps,
                poolId: nflResult.poolId,
            };
        }

        if (poolType === 'PROPS') {
            // Route to props simulator
            const propsSettings = {
                ...scenario.poolConfig,
                _fullScenario: {
                    poolConfig: scenario.poolConfig,
                    questions: scenario.questions,
                    testEntries: scenario.testEntries,
                    grading: scenario.grading
                }
            };
            // Props Simulator is now statically imported
            result = await runPropsScenario('props-basic', 'actual', propsSettings);
        } else if (poolType === 'BRACKET') {
            if (scenario.isE2E && scenario.e2eConfig) {
                // Route to E2E bracket simulator
                const e2eResult = await runE2EBracketSimulation(scenario.e2eConfig);
                result = {
                    poolId: e2eResult.poolId,
                    steps: e2eResult.steps.map(s => ({
                        step: s.label,
                        status: s.status,
                        message: s.detail,
                        data: s.data,
                    })),
                };
            } else {
                // Route to standard bracket simulator
                const bracketSettings = {
                    ...scenario.poolConfig,
                    _fullScenario: {
                        poolConfig: scenario.poolConfig,
                        testEntries: (scenario.testEntries || []).map(e => ({
                            userName: e.userName,
                            picks: e.picks || {},
                            // bracketSimulator reads `tiebreakerPrediction` — the
                            // key the bracket scenario JSONs use. Mapping it to
                            // `tiebreaker` here fed addDoc an undefined field and
                            // killed every entry write (the 0-entries cluster).
                            tiebreakerPrediction: e.tiebreakerPrediction ?? e.tiebreaker ?? e.tiebreakerVal
                        })),
                        tournamentResults: scenario.tournamentResults
                    }
                };
                result = await runBracketScenario('bracket-basic', 'actual', bracketSettings as Parameters<typeof runBracketScenario>[2]);
            }
        } else if (poolType === 'NFL_PLAYOFFS') {
            // Route to playoff simulator
            const playoffSettings = {
                ...scenario.poolConfig,
                _fullScenario: {
                    poolConfig: scenario.poolConfig,
                    testEntries: (scenario.testEntries || []).map(e => ({
                        userName: e.userName,
                        rankings: e.rankings || {},
                        tiebreaker: e.tiebreaker || e.tiebreakerVal
                    })),
                    roundResults: scenario.roundResults
                }
            };
            // Playoff Simulator is now statically imported
            result = await runPlayoffScenario('playoff-basic', 'actual', playoffSettings as Parameters<typeof runPlayoffScenario>[2]);
        } else {
            // SQUARES (default)
            const settings = {
                ...scenario.poolConfig,
                _fullScenario: {
                    testUsers: scenario.testUsers,
                    squareCount: scenario.squareCount || 100,
                    actions: (scenario.scoreUpdates || []).map(u => ({
                        actionType: 'SCORE_UPDATE',
                        period: u.period,
                        homeScore: u.homeScore,
                        awayScore: u.awayScore
                    }))
                }
            };
            result = await runScenario('basic-100', 'actual', settings);
        }

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
        // Use a local intersection type to allow testing-specific properties
        type TestPool = Pool & { _propCards?: PropCard[]; _bracketEntries?: BracketEntry[] };
        const pool = await dbService.getPoolById(result.poolId) as TestPool;
        let winners: Winner[] = [];

        if (poolType === 'PROPS') {
            // For props, fetch prop cards and attach to pool object
            const propCards = await dbService.getPropCards(result.poolId);
            pool._propCards = propCards as unknown as PropCard[];
        } else if (poolType === 'BRACKET') {
            // For brackets, fetch entries and attach to pool object
            const bracketEntries = await dbService.getBracketEntries(result.poolId);
            pool._bracketEntries = bracketEntries as unknown as BracketEntry[];
        } else {
            // SQUARES - get winners
            winners = await dbService.getWinners(result.poolId);
        }

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

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            scenarioId,
            scenarioName: scenario.name,
            status: 'ERROR',
            duration: Date.now() - startTime,
            validation: null,
            error: errorMessage,
            steps: []
        };
    }
}

/**
 * Get list of available test scenarios for UI dropdown
 */
export function getAvailableScenarios(): Array<{ id: string; name: string; description: string; poolType: string }> {
    return SCENARIO_LIST.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        poolType: s.poolType ?? 'SQUARES',
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
