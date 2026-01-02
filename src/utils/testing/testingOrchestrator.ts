/**
 * Testing Orchestrator
 * Coordinates test execution across all pool types
 */

import {
    getTrackedResources,
    clearTrackedResources,
    cleanupTestResources,
    log,
    getLogs,
    clearLogs,
    type CreatedResource,
    type TestLog
} from './simulators/common';

// ===== TYPES =====

export type PoolType = 'SQUARES' | 'BRACKET' | 'NFL_PLAYOFFS' | 'PROPS';
export type TestMode = 'dry-run' | 'actual';
export type TestStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface TestConfig {
    poolType: PoolType;
    scenario: string;
    mode: TestMode;
    settings?: Record<string, any>;
}

export interface TestStepResult {
    step: string;
    status: 'success' | 'failed' | 'skipped';
    message: string;
    duration: number;
    error?: string;
    data?: any;
}

export interface TestResult {
    id: string;
    config: TestConfig;
    status: TestStatus;
    startedAt: number;
    completedAt?: number;
    duration?: number;
    poolId?: string;
    steps: TestStepResult[];
    resources: CreatedResource[];
    logs: TestLog[];
    errors: string[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
    // Extended data for AI Validation
    finalPoolData?: any;
    winners?: any[];
    finalStatus?: string;
}

// ===== SCENARIO DEFINITIONS =====

export interface TestScenario {
    id: string;
    label: string;
    description: string;
    poolType: PoolType;
}

export const TEST_SCENARIOS: Record<PoolType, TestScenario[]> = {
    SQUARES: [
        {
            id: 'basic-100',
            label: 'Basic 100-Square Grid',
            description: 'Full grid, all quarters, standard payouts',
            poolType: 'SQUARES'
        },
        {
            id: 'reverse-scores',
            label: 'Reverse Scores Enabled',
            description: 'Test reverse score winners',
            poolType: 'SQUARES'
        },
        {
            id: 'every-score-wins',
            label: 'Every Score Wins',
            description: 'Multiple winners per quarter',
            poolType: 'SQUARES'
        },
        {
            id: 'partial-fill',
            label: 'Partial Fill (50%)',
            description: 'Only 50 squares filled',
            poolType: 'SQUARES'
        },
        {
            id: 'tie-scenario',
            label: 'Tie Scenarios',
            description: 'Test tiebreaker logic',
            poolType: 'SQUARES'
        },
        {
            id: 'charity-pool',
            label: 'Charity Pool',
            description: 'Verify charity deduction in payouts',
            poolType: 'SQUARES'
        }
    ],
    BRACKET: [
        {
            id: 'perfect-bracket',
            label: 'Perfect Bracket',
            description: 'All picks correct, maximum score',
            poolType: 'BRACKET'
        },
        {
            id: 'classic-scoring',
            label: 'Classic Scoring (1-2-4-8-16-32)',
            description: 'Standard tournament scoring',
            poolType: 'BRACKET'
        },
        {
            id: 'espn-scoring',
            label: 'ESPN Scoring (10-20-40-80-160-320)',
            description: 'ESPN style scoring system',
            poolType: 'BRACKET'
        },
        {
            id: 'tiebreaker',
            label: 'Tiebreaker Test',
            description: 'Multiple brackets same score',
            poolType: 'BRACKET'
        },
        {
            id: 'incomplete-bracket',
            label: 'Incomplete Bracket',
            description: 'Missing picks handled gracefully',
            poolType: 'BRACKET'
        }
    ],
    NFL_PLAYOFFS: [
        {
            id: 'standard-playoffs',
            label: 'Standard Playoff Pool',
            description: '14 teams, standard multipliers (1-2-4-8)',
            poolType: 'NFL_PLAYOFFS'
        },
        {
            id: 'aggressive-multipliers',
            label: 'Aggressive Multipliers (1-3-9-27)',
            description: 'Exponential scoring test',
            poolType: 'NFL_PLAYOFFS'
        },
        {
            id: 'perfect-ranking',
            label: 'Perfect Ranking',
            description: 'Champion ranked #14, max score',
            poolType: 'NFL_PLAYOFFS'
        },
        {
            id: 'tiebreaker',
            label: 'Tiebreaker Test',
            description: 'Super Bowl total score prediction',
            poolType: 'NFL_PLAYOFFS'
        }
    ],
    PROPS: [
        {
            id: 'standard-props',
            label: 'Standard Props Pool',
            description: '10 questions, 8 users, standard scoring',
            poolType: 'PROPS'
        },
        {
            id: 'perfect-score',
            label: 'Perfect Score',
            description: 'One user gets all correct',
            poolType: 'PROPS'
        },
        {
            id: 'exact-tie',
            label: 'Exact Tie',
            description: 'Multiple users same score',
            poolType: 'PROPS'
        }
    ]
};

// ===== ORCHESTRATOR =====

class TestOrchestrator {
    private currentTest: TestResult | null = null;
    private testHistory: TestResult[] = [];

    async runTest(config: TestConfig): Promise<TestResult> {
        const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const result: TestResult = {
            id: testId,
            config,
            status: 'running',
            startedAt: Date.now(),
            steps: [],
            resources: [],
            logs: [],
            errors: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                skipped: 0
            }
        };

        this.currentTest = result;
        clearLogs();
        clearTrackedResources();

        log('info', `Starting test: ${config.poolType} - ${config.scenario}`, { mode: config.mode });

        try {
            // Import the appropriate simulator
            let simulator;
            let safeScenarioId = config.scenario;

            switch (config.poolType) {
                case 'SQUARES':
                    simulator = await import('./simulators/squaresSimulator');
                    // If scenario is not a known preset ID, default to basic-100 but keep settings
                    if (!['basic-100', 'partial-fill', 'reverse-scores', 'every-score-wins', 'tie-scenario', 'charity-pool'].includes(config.scenario)) {
                        safeScenarioId = 'basic-100';
                        log('info', `Using 'basic-100' logic for custom scenario: ${config.scenario}`);
                    }
                    break;
                case 'BRACKET':
                    simulator = await import('./simulators/bracketSimulator');
                    if (!['perfect-bracket', 'classic-scoring', 'espn-scoring', 'tiebreaker', 'incomplete-bracket'].includes(config.scenario)) {
                        safeScenarioId = 'perfect-bracket';
                    }
                    break;
                case 'NFL_PLAYOFFS':
                    simulator = await import('./simulators/playoffSimulator');
                    if (!['standard-playoffs', 'aggressive-multipliers', 'perfect-ranking', 'tiebreaker'].includes(config.scenario)) {
                        safeScenarioId = 'standard-playoffs';
                    }
                    break;
                case 'PROPS':
                    simulator = await import('./simulators/propsSimulator');
                    if (!['standard-props', 'perfect-score', 'exact-tie'].includes(config.scenario)) {
                        safeScenarioId = 'standard-props';
                    }
                    break;
                default:
                    throw new Error(`Unknown pool type: ${config.poolType}`);
            }

            // Run the simulator with the SAFE ID
            const simulatorResult = await simulator.runScenario(safeScenarioId, config.mode, config.settings);

            result.poolId = simulatorResult.poolId;
            result.steps = simulatorResult.steps || [];
            result.status = 'success';

            // Capture extended data if available
            if (simulatorResult.finalPoolData) result.finalPoolData = simulatorResult.finalPoolData;
            if (simulatorResult.winners) result.winners = simulatorResult.winners;
            if (simulatorResult.finalStatus) result.finalStatus = simulatorResult.finalStatus;
            log('success', 'Test completed successfully!');

        } catch (error: any) {
            result.status = 'failed';
            result.errors.push(error.message);
            log('error', `Test failed: ${error.message}`, error);
        } finally {
            result.completedAt = Date.now();
            result.duration = result.completedAt - result.startedAt;
            result.resources = getTrackedResources();
            result.logs = getLogs();

            // Calculate summary
            result.summary.total = result.steps.length;
            result.summary.passed = result.steps.filter(s => s.status === 'success').length;
            result.summary.failed = result.steps.filter(s => s.status === 'failed').length;
            result.summary.skipped = result.steps.filter(s => s.status === 'skipped').length;

            this.testHistory.push(result);
            this.currentTest = null;
        }

        return result;
    }

    async cleanupTest(testId: string): Promise<void> {
        const test = this.testHistory.find(t => t.id === testId);
        if (!test) {
            throw new Error(`Test not found: ${testId}`);
        }

        log('info', `Cleaning up test: ${testId}`);
        await cleanupTestResources(test.resources);
        log('success', 'Cleanup complete');
    }

    async cleanupAllTests(): Promise<void> {
        log('info', `Cleaning up ${this.testHistory.length} tests...`);

        for (const test of this.testHistory) {
            try {
                await cleanupTestResources(test.resources);
            } catch (error) {
                log('error', `Failed to cleanup test ${test.id}`, error);
            }
        }

        this.testHistory = [];
        log('success', 'All tests cleaned up');
    }

    getCurrentTest(): TestResult | null {
        return this.currentTest;
    }

    getTestHistory(): TestResult[] {
        return [...this.testHistory];
    }

    getTest(testId: string): TestResult | undefined {
        return this.testHistory.find(t => t.id === testId);
    }
}

// Export singleton instance
export const testOrchestrator = new TestOrchestrator();

// Export helper functions
export async function runTest(config: TestConfig): Promise<TestResult> {
    return testOrchestrator.runTest(config);
}

export async function cleanupTest(testId: string): Promise<void> {
    return testOrchestrator.cleanupTest(testId);
}

export async function cleanupAllTests(): Promise<void> {
    return testOrchestrator.cleanupAllTests();
}

export function getCurrentTest(): TestResult | null {
    return testOrchestrator.getCurrentTest();
}

export function getTestHistory(): TestResult[] {
    return testOrchestrator.getTestHistory();
}

export function getTest(testId: string): TestResult | undefined {
    return testOrchestrator.getTest(testId);
}
