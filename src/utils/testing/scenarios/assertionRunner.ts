// Pre-defined Test Assertion Runner
// Replaces AI-based validation with deterministic code-based assertions

import type { TestAssertion, TestScenario } from './index';
import type { Pool, Winner } from '../../../types';

export interface AssertionResult {
    assertion: TestAssertion;
    passed: boolean;
    actual?: unknown;
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
    winners: Winner[],
    pool: Pool
): ValidationResult {
    const results: AssertionResult[] = [];

    for (const assertion of scenario.assertions) {
        const result = runSingleAssertion(assertion, winners, pool as TestPool, scenario);
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

// Extended Pool interface for testing properties
type TestPool = Pool & {
    _propCards?: { score?: number; userName?: string }[];
    _bracketEntries?: {
        score?: number;
        name?: string;
        tieBreakerPrediction?: number;
        maxPossibleScore?: number;
    }[];
    entryCount?: number;
    entries?: Record<string, { totalScore?: number; userName?: string }>;
    [key: string]: unknown; // Allow safe access to other properties
};

function runSingleAssertion(
    assertion: TestAssertion,
    winners: Winner[],
    pool: TestPool,
    scenario?: TestScenario
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
            return assertBracketWinner(assertion, pool, scenario);
        case 'bracketTopScore':
            return assertBracketTopScore(assertion, pool);
        case 'maxScoreAtLeast':
            return assertMaxScoreAtLeast(assertion, pool);
        // Playoff-specific assertions
        case 'playoffEntryCount':
            return assertPlayoffEntryCount(assertion, pool);
        case 'playoffWinner':
            return assertPlayoffWinner(assertion, pool);
        default:
            return {
                assertion,
                passed: false,
                message: `Unknown assertion type: ${(assertion as { type: string }).type}`
            };
    }
}

function assertWinnerCount(assertion: TestAssertion, winners: Winner[]): AssertionResult {
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

function assertWinnerCountAtLeast(assertion: TestAssertion, winners: Winner[]): AssertionResult {
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

function assertWinnerExists(assertion: TestAssertion, winners: Winner[]): AssertionResult {
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

function assertTotalPayout(assertion: TestAssertion, winners: Winner[]): AssertionResult {
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

function assertPoolStatus(assertion: TestAssertion, pool: TestPool): AssertionResult {
    // Check specific field if provided (e.g., isLocked), otherwise check scores.gameStatus
    const field = (assertion as { field?: string }).field;
    let actual: unknown;

    if (field) {
        actual = pool[field];
    } else {
        // Safe access for scores if it exists
        const p = pool as { scores?: { gameStatus?: string } };
        actual = p.scores?.gameStatus;
    }

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

function assertPropCardCount(assertion: TestAssertion, pool: TestPool): AssertionResult {
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

function assertPropWinner(assertion: TestAssertion, pool: TestPool): AssertionResult {
    const cards = pool._propCards || [];
    // Sort by score descending
    const sorted = [...cards].sort((a, b) => (b.score || 0) - (a.score || 0));
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

function assertPropTopScore(assertion: TestAssertion, pool: TestPool): AssertionResult {
    const cards = pool._propCards || [];
    const topScore = cards.reduce((max: number, c) => Math.max(max, c.score || 0), 0);
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

function assertBracketEntryCount(assertion: TestAssertion, pool: TestPool): AssertionResult {
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

function assertBracketWinner(assertion: TestAssertion, pool: TestPool, scenario?: TestScenario): AssertionResult {
    const entries = pool._bracketEntries || [];

    // Derive the championship total score from tournament results for tiebreaker resolution
    let championshipTotal: number | null = null;
    if (scenario) {
        const tournamentResults = (scenario as { tournamentResults?: { round: number; homeScore: number; awayScore: number }[] }).tournamentResults || [];
        // Find the highest-round game to get the championship total
        const champGame = tournamentResults.reduce((best: { round: number } | null, g: { round: number }) =>
            (!best || g.round > best.round) ? g : best, null) as { round: number; homeScore: number; awayScore: number } | null;
        if (champGame && champGame.homeScore != null && champGame.awayScore != null) {
            championshipTotal = champGame.homeScore + champGame.awayScore;
        }
    }

    // Sort by score descending, then by tiebreaker proximity to championship total
    const sorted = [...entries].sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        // Tiebreaker: closest to championship total wins
        if (championshipTotal != null) {
            const aDiff = Math.abs((a.tieBreakerPrediction || 0) - championshipTotal);
            const bDiff = Math.abs((b.tieBreakerPrediction || 0) - championshipTotal);
            return aDiff - bDiff; // Lower diff = closer = better
        }
        return 0;
    });

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

function assertBracketTopScore(assertion: TestAssertion, pool: TestPool): AssertionResult {
    const entries = pool._bracketEntries || [];
    const topScore = entries.reduce((max: number, e) => Math.max(max, e.score || 0), 0);
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

function assertPlayoffEntryCount(assertion: TestAssertion, pool: TestPool): AssertionResult {
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

function assertPlayoffWinner(assertion: TestAssertion, pool: TestPool): AssertionResult {
    const entries = Object.values(pool.entries || {});
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

function assertMaxScoreAtLeast(assertion: TestAssertion, pool: TestPool): AssertionResult {
    const entries = pool._bracketEntries || [];
    // Find max "maxPossibleScore" across all entries
    const maxPossible = entries.reduce((max: number, e) => Math.max(max, e.maxPossibleScore || 0), 0);
    const expected = assertion.expected as number;
    const passed = maxPossible >= expected;

    return {
        assertion,
        passed,
        actual: maxPossible,
        message: passed
            ? `✅ ${assertion.message} (Max Possible: ${maxPossible})`
            : `❌ ${assertion.message} - Expected at least ${expected}, got ${maxPossible}`
    };
}
