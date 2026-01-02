// Pre-defined Test Assertion Runner
// Replaces AI-based validation with deterministic code-based assertions

import type { TestAssertion, TestScenario } from './index';

export interface AssertionResult {
    assertion: TestAssertion;
    passed: boolean;
    actual?: any;
    message: string;
}

export interface ValidationResult {
    scenario: TestScenario;
    passed: boolean;
    passedCount: number;
    failedCount: number;
    results: AssertionResult[];
    summary: string;
}

export function runAssertions(
    scenario: TestScenario,
    winners: any[],
    pool: any
): ValidationResult {
    const results: AssertionResult[] = [];

    for (const assertion of scenario.assertions) {
        const result = runSingleAssertion(assertion, winners, pool);
        results.push(result);
    }

    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;
    const passed = failedCount === 0;

    const summary = passed
        ? `✅ All ${passedCount} assertions passed!`
        : `❌ ${failedCount}/${results.length} assertions failed`;

    return {
        scenario,
        passed,
        passedCount,
        failedCount,
        results,
        summary
    };
}

function runSingleAssertion(
    assertion: TestAssertion,
    winners: any[],
    pool: any
): AssertionResult {
    switch (assertion.type) {
        case 'winnerCount':
            return assertWinnerCount(assertion, winners);
        case 'winnerCountAtLeast':
            return assertWinnerCountAtLeast(assertion, winners);
        case 'winnerExists':
            return assertWinnerExists(assertion, winners);
        case 'totalPayout':
            return assertTotalPayout(assertion, winners);
        case 'poolStatus':
            return assertPoolStatus(assertion, pool);
        default:
            return {
                assertion,
                passed: false,
                message: `Unknown assertion type: ${(assertion as any).type}`
            };
    }
}

function assertWinnerCount(assertion: TestAssertion, winners: any[]): AssertionResult {
    const actual = winners.length;
    const expected = assertion.expected as number;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} (${actual} winners)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${actual}`
    };
}

function assertWinnerCountAtLeast(assertion: TestAssertion, winners: any[]): AssertionResult {
    const actual = winners.length;
    const expected = assertion.expected as number;
    const passed = actual >= expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} (${actual} winners)`
            : `❌ ${assertion.message} - Expected at least ${expected}, got ${actual}`
    };
}

function assertWinnerExists(assertion: TestAssertion, winners: any[]): AssertionResult {
    const expectedPeriod = assertion.period;
    const expectedDigits = assertion.digits || [0, 0];

    const matchingWinner = winners.find(w =>
        w.period === expectedPeriod &&
        w.homeDigit === expectedDigits[0] &&
        w.awayDigit === expectedDigits[1]
    );

    const passed = !!matchingWinner;

    return {
        assertion,
        passed,
        actual: matchingWinner ? `${matchingWinner.owner} [${matchingWinner.homeDigit}-${matchingWinner.awayDigit}]` : 'Not found',
        message: passed
            ? `✅ ${assertion.message} - Winner: ${matchingWinner.owner}`
            : `❌ ${assertion.message} - No winner found for ${expectedPeriod} with digits (${expectedDigits[0]},${expectedDigits[1]})`
    };
}

function assertTotalPayout(assertion: TestAssertion, winners: any[]): AssertionResult {
    const actual = winners.reduce((sum, w) => sum + (w.amount || 0), 0);
    const expected = assertion.expected as number;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} ($${actual})`
            : `❌ ${assertion.message} - Expected $${expected}, got $${actual}`
    };
}

function assertPoolStatus(assertion: TestAssertion, pool: any): AssertionResult {
    const actual = pool?.scores?.gameStatus;
    const expected = assertion.expected;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} (${actual})`
            : `❌ ${assertion.message} - Expected "${expected}", got "${actual}"`
    };
}
