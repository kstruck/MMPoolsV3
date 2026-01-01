/**
 * AI Testing Cloud Functions
 * Backend functions that use Gemini AI for test scenario generation,
 * result validation, and report generation
 */

import * as functions from "firebase-functions";
import { geminiApiKey, generateAIResponse } from "./gemini";
import { SchemaType } from "@google/generative-ai";

// ===== SCENARIO GENERATION =====

const SCENARIO_GENERATION_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        scenarioName: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        poolConfig: { type: SchemaType.OBJECT },
        testUsers: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    name: { type: SchemaType.STRING },
                    strategy: { type: SchemaType.STRING },
                    behavior: { type: SchemaType.STRING },
                },
            },
        },
        expectedOutcome: {
            type: SchemaType.OBJECT,
            properties: {
                winner: { type: SchemaType.STRING },
                topThree: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                edgeCases: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            },
        },
        validationChecks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    },
    required: ["scenarioName", "description", "poolConfig", "testUsers", "expectedOutcome", "validationChecks"],
};

const buildScenarioPrompt = (poolType: string): string => `
You are a QA testing expert for a sports pool application.

Your task is to generate detailed, realistic test scenarios based on user requests.

Pool Type: ${poolType}

Guidelines:
1. Create realistic pool names (e.g., "Sarah's March Madness 2025" not "TEST_123")
2. Generate diverse test users with varied strategies
3. Define clear expected outcomes
4. List specific validation checks

Provide all configuration needed to run the test.
`;

export const generateTestScenario = functions.https.onCall(
    { secrets: [geminiApiKey] },
    async (request) => {
        try {
            const { poolType, userRequest } = request.data;

            const systemPrompt = buildScenarioPrompt(poolType);
            const facts = {
                poolType,
                userRequest,
                timestamp: new Date().toISOString(),
            };

            const result = await generateAIResponse(
                systemPrompt,
                facts,
                SCENARIO_GENERATION_SCHEMA
            );

            return {
                ...result,
                poolType,
            };
        } catch (error) {
            console.error("Error in generateTestScenario:", error);
            throw new functions.https.HttpsError("internal", "Failed to generate test scenario");
        }
    });

// ===== RESULT VALIDATION =====

const VALIDATION_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        passed: { type: SchemaType.BOOLEAN },
        confidence: { type: SchemaType.NUMBER },
        findings: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    type: { type: SchemaType.STRING },
                    message: { type: SchemaType.STRING },
                    evidence: { type: SchemaType.STRING },
                },
            },
        },
        anomalies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        recommendations: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    },
    required: ["passed", "confidence", "findings", "anomalies", "recommendations"],
};

const buildValidationPrompt = (poolType: string): string => `
You are a QA expert analyzing test results for a ${poolType} pool.

Your task is to validate test results against expected outcomes.

Guidelines:
1. Check if winners match expected logic
2. Verify scores calculated correctly
3. Ensure payouts distributed properly
4. Check audit trail completeness
5. Identify any anomalies or unexpected results
6. Provide specific recommendations if issues found

Be precise and cite evidence from the test results.
`;

export const validateTestResults = functions.https.onCall(
    { secrets: [geminiApiKey] },
    async (request) => {
        try {
            const { scenario, testResult } = request.data;

            const systemPrompt = buildValidationPrompt(scenario.poolType);
            const facts = {
                scenario,
                testResult,
                timestamp: new Date().toISOString(),
            };

            const result = await generateAIResponse(
                systemPrompt,
                facts,
                VALIDATION_SCHEMA
            );

            return result;
        } catch (error) {
            console.error("Error in validateTestResults:", error);
            throw new functions.https.HttpsError("internal", "Failed to validate test results");
        }
    });

// ===== REPORT GENERATION =====

const REPORT_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        executiveSummary: { type: SchemaType.STRING },
        testCoverage: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        keyFindings: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        detailedResults: { type: SchemaType.STRING },
        recommendations: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        nextSteps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    },
    required: ["executiveSummary", "testCoverage", "keyFindings", "detailedResults", "recommendations", "nextSteps"],
};

const buildReportPrompt = (): string => `
You are a QA report writer creating comprehensive test reports.

Your task is to create markdown-formatted reports with:
1. Executive Summary (2-3 sentences)
2. Test Coverage (what was tested)
3. Key Findings (successes and issues)
4. Detailed Results
5. Recommendations (if any issues)
6. Next Steps

Use emojis for visual clarity (✅ ❌ ⚠️).
Be concise but thorough.
Provide actionable recommendations.
`;

export const generateTestReport = functions.https.onCall(
    { secrets: [geminiApiKey] },
    async (request) => {
        try {
            const { scenario, testResult, validation } = request.data;

            const systemPrompt = buildReportPrompt();
            const facts = {
                scenario,
                testResult,
                validation,
                timestamp: new Date().toISOString(),
            };

            const result = await generateAIResponse(
                systemPrompt,
                facts,
                REPORT_SCHEMA
            );

            return result;
        } catch (error) {
            console.error("Error in generateTestReport:", error);
            throw new functions.https.HttpsError("internal", "Failed to generate test report");
        }
    });
