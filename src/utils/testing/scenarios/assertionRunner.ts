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
        // Props-specific assertions
        case 'propCardCount':
            return assertPropCardCount(assertion, pool);
        case 'propWinner':
            return assertPropWinner(assertion, pool);
        case 'propTopScore':
            return assertPropTopScore(assertion, pool);
        // Bracket-specific assertions
        case 'bracketEntryCount':
            return assertBracketEntryCount(assertion, pool);
        case 'bracketWinner':
            return assertBracketWinner(assertion, pool);
        case 'bracketTopScore':
            return assertBracketTopScore(assertion, pool);
        // Playoff-specific assertions
        case 'playoffEntryCount':
            return assertPlayoffEntryCount(assertion, pool);
        case 'playoffWinner':
            return assertPlayoffWinner(assertion, pool);
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
    // Use tolerance for floating-point comparison (within $0.01)
    const tolerance = 0.01;
    const passed = Math.abs(actual - expected) < tolerance;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} ($${actual.toFixed(2)})`
            : `❌ ${assertion.message} - Expected $${expected}, got $${actual.toFixed(2)}`
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

// === PROPS-SPECIFIC ASSERTIONS ===

function assertPropCardCount(assertion: TestAssertion, pool: any): AssertionResult {
    const actual = pool?._propCards?.length || pool?.entryCount || 0;
    const expected = assertion.expected as number;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} (${actual} cards)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${actual}`
    };
}

function assertPropWinner(assertion: TestAssertion, pool: any): AssertionResult {
    const cards = pool?._propCards || [];
    // Sort by score descending
    const sorted = [...cards].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const winner = sorted[0];
    const actual = winner?.userName || 'No winner';
    const expected = assertion.expected as string;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} - Winner: ${actual}`
            : `❌ ${assertion.message} - Expected "${expected}", got "${actual}"`
    };
}

function assertPropTopScore(assertion: TestAssertion, pool: any): AssertionResult {
    const cards = pool?._propCards || [];
    const topScore = cards.reduce((max: number, c: any) => Math.max(max, c.score || 0), 0);
    const expected = assertion.expected as number;
    const passed = topScore === expected;

    return {
        assertion,
        passed,
        actual: topScore,
        message: passed
            ? `✅ ${assertion.message} (${topScore} points)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${topScore}`
    };
}

// === BRACKET-SPECIFIC ASSERTIONS ===

function assertBracketEntryCount(assertion: TestAssertion, pool: any): AssertionResult {
    const actual = pool?._bracketEntries?.length || pool?.entryCount || 0;
    const expected = assertion.expected as number;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} (${actual} entries)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${actual}`
    };
}

function assertBracketWinner(assertion: TestAssertion, pool: any): AssertionResult {
    const entries = pool?._bracketEntries || [];
    // Sort by score descending, then by tiebreaker
    const sorted = [...entries].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const winner = sorted[0];
    const actual = winner?.name || 'No winner';
    const expected = assertion.expected as string;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} - Winner: ${actual}`
            : `❌ ${assertion.message} - Expected "${expected}", got "${actual}"`
    };
}

function assertBracketTopScore(assertion: TestAssertion, pool: any): AssertionResult {
    const entries = pool?._bracketEntries || [];
    const topScore = entries.reduce((max: number, e: any) => Math.max(max, e.score || 0), 0);
    const expected = assertion.expected as number;
    const passed = topScore === expected;

    return {
        assertion,
        passed,
        actual: topScore,
        message: passed
            ? `✅ ${assertion.message} (${topScore} points)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${topScore}`
    };
}

// === PLAYOFF-SPECIFIC ASSERTIONS ===

function assertPlayoffEntryCount(assertion: TestAssertion, pool: any): AssertionResult {
    const entries = pool?.entries ? Object.keys(pool.entries).length : 0;
    const expected = assertion.expected as number;
    const passed = entries === expected;

    return {
        assertion,
        passed,
        actual: entries,
        message: passed
            ? `✅ ${assertion.message} (${entries} entries)`
            : `❌ ${assertion.message} - Expected ${expected}, got ${entries}`
    };
}

function assertPlayoffWinner(assertion: TestAssertion, pool: any): AssertionResult {
    const entries = Object.values(pool?.entries || {}) as any[];
    // Sort by totalScore descending
    const sorted = [...entries].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    const winner = sorted[0];
    const actual = winner?.userName || 'No winner';
    const expected = assertion.expected as string;
    const passed = actual === expected;

    return {
        assertion,
        passed,
        actual,
        message: passed
            ? `✅ ${assertion.message} - Winner: ${actual}`
            : `❌ ${assertion.message} - Expected "${expected}", got "${actual}"`
    };
}
