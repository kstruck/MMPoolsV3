/**
 * AI Testing Service
 * Integrates with Gemini AI for intelligent test generation, validation, and reporting
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { PoolType } from '../types';
import type { TestResult } from '../utils/testing/testingOrchestrator';

// ===== TYPES =====

export interface TestScenario {
    scenarioName: string;
    poolType: PoolType;
    description: string;
    poolConfig: Record<string, any>;
    testUsers: TestUserStrategy[];
    expectedOutcome: ExpectedOutcome;
    validationChecks: string[];
}

export interface TestUserStrategy {
    name: string;
    strategy: 'chalk' | 'upset' | 'random' | 'strategic' | 'balanced';
    behavior: string;
}

export interface ExpectedOutcome {
    winner?: string;
    topThree?: string[];
    edgeCases: string[];
    scoreRange?: { min: number; max: number };
}

export interface ValidationResult {
    passed: boolean;
    confidence: number; // 0-100
    findings: Finding[];
    anomalies: string[];
    recommendations: string[];
}

export interface Finding {
    type: 'success' | 'warning' | 'error';
    message: string;
    evidence?: string;
}

export interface TestReport {
    executiveSummary: string;
    testCoverage: string[];
    keyFindings: string[];
    detailedResults: string;
    recommendations: string[];
    nextSteps: string[];
}

// ===== CLOUD FUNCTION INTERFACES =====

interface GenerateScenarioRequest {
    poolType: PoolType;
    userRequest: string;
}

interface ValidateResultsRequest {
    scenario: TestScenario;
    testResult: TestResult;
}

interface GenerateReportRequest {
    scenario: TestScenario;
    testResult: TestResult;
    validation: ValidationResult;
}

// ===== CLOUD FUNCTION CALLS =====

/**
 * Generate a Test Scenario using AI
 */
export async function generateTestScenario(
    poolType: PoolType,
    userRequest: string
): Promise<TestScenario> {
    try {
        const generateScenario = httpsCallable<GenerateScenarioRequest, TestScenario>(
            functions,
            'generateTestScenario'
        );

        const result = await generateScenario({ poolType, userRequest });
        return parseResult(result.data);
    } catch (error) {
        console.error('Error generating test scenario:', error);
        throw new Error('Failed to generate test scenario with AI');
    }
}

/**
 * Validate Test Results using AI
 */
export async function validateTestResults(
    scenario: TestScenario,
    testResult: TestResult
): Promise<ValidationResult> {
    try {
        const validateResults = httpsCallable<ValidateResultsRequest, ValidationResult>(
            functions,
            'validateTestResults'
        );

        const result = await validateResults({ scenario, testResult });
        return parseResult(result.data);
    } catch (error) {
        console.error('Error validating test results:', error);
        throw new Error('Failed to validate test results with AI');
    }
}

/**
 * Generate Test Report using AI
 */
const parseResult = (data: any) => {
    if (typeof data === 'string') {
        try {
            // Remove markdown code blocks if present
            const clean = data.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(clean);
        } catch (e) {
            console.error("Failed to parse AI response:", e);
            return data;
        }
    }
    return data;
};

export async function generateTestReport(
    scenario: TestScenario,
    testResult: TestResult,
    validation: ValidationResult
): Promise<TestReport> {
    try {
        const generateReport = httpsCallable<GenerateReportRequest, TestReport>(
            functions,
            'generateTestReport'
        );

        const result = await generateReport({ scenario, testResult, validation });
        return parseResult(result.data);
    } catch (error) {
        console.error('Error generating test report:', error);
        throw new Error('Failed to generate test report with AI');
    }
}

// ===== HELPER FUNCTIONS =====

/**
 * Run a complete AI-powered test
 */
export async function runAIEnhancedTest(
    poolType: PoolType,
    userRequest: string,
    mode: 'dry-run' | 'actual' = 'dry-run'
): Promise<{
    scenario: TestScenario;
    testResult: TestResult;
    validation: ValidationResult;
    report: TestReport;
}> {
    // 1. Generate scenario with AI
    console.log('🤖 Generating test scenario with AI...');
    const scenario = await generateTestScenario(poolType, userRequest);

    // 2. Run test (import orchestrator dynamically to avoid circular deps)
    console.log('🧪 Running test...');
    const { runTest } = await import('../utils/testing/testingOrchestrator');
    const testResult = await runTest({
        poolType,
        scenario: scenario.scenarioName,
        mode,
        settings: scenario.poolConfig
    });

    // 3. Validate results with AI
    console.log('✅ Validating results with AI...');
    const validation = await validateTestResults(scenario, testResult);

    // 4. Generate report with AI
    console.log('📊 Generating report with AI...');
    const report = await generateTestReport(scenario, testResult, validation);

    return { scenario, testResult, validation, report };
}

/**
 * Get suggested test scenarios for a pool type
 */
export async function getSuggestedScenarios(poolType: PoolType): Promise<string[]> {
    const suggestions: Record<PoolType, string[]> = {
        SQUARES: [
            'Test a basic squares pool with 100% fill and standard payouts',
            'Test reverse scores with partial grid fill',
            'Test every score wins with many score changes',
            'Test charity pool with 10% donation'
        ],
        BRACKET: [
            'Test a pool where everyone picks chalk except one upset picker',
            'Test perfect bracket scenario',
            'Test tiebreaker with total points prediction',
            'Test incomplete brackets with missing picks'
        ],
        NFL_PLAYOFFS: [
            'Test standard playoff pool with balanced rankings',
            'Test perfect ranking where one user picks champion correctly',
            'Test aggressive multipliers with upset results',
            'Test tiebreaker with Super Bowl score prediction'
        ],
        PROPS: [
            'Test standard props with 10 questions and varied answers',
            'Test perfect score where one user gets all correct',
            'Test partial participation with some skipped questions',
            'Test exact tie scenario'
        ]
    };

    return suggestions[poolType] || [];
}
