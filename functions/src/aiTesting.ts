/**
 * AI Testing Cloud Functions
 * Backend functions that use Gemini AI for test scenario generation,
 * result validation, and report generation
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { geminiApiKey, generateAIResponse } from "./gemini";
import { assertCallerRole } from "./lib/assertRole";
import { Type } from "@google/genai";

// ===== SCENARIO GENERATION =====

const SCENARIO_GENERATION_SCHEMA = {

    type: Type.OBJECT,
    properties: {
        scenarioName: { type: Type.STRING },
        description: { type: Type.STRING },
        poolConfig: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                type: { type: Type.STRING },
                props: {
                    type: Type.OBJECT,
                    properties: {
                        costPerCard: { type: Type.NUMBER },
                        isLocked: { type: Type.BOOLEAN }
                    },
                    required: ["costPerCard", "isLocked"]
                },
                maxPlayers: { type: Type.NUMBER }
            },
            required: ["name", "type", "props", "maxPlayers"]
        },
        testUsers: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    strategy: { type: Type.STRING },
                    behavior: { type: Type.STRING },
                },
                required: ["name", "strategy", "behavior"]
            },
        },
        expectedOutcome: {
            type: Type.OBJECT,
            properties: {
                winner: { type: Type.STRING },
                topThree: { type: Type.ARRAY, items: { type: Type.STRING } },
                edgeCases: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["winner", "topThree", "edgeCases"]
        },
        actions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    actionType: { type: Type.STRING, description: "Use 'SCORE_UPDATE' for score changes" },
                    period: { type: Type.STRING, description: "Q1, Q2, Q3, FINAL" },
                    homeScore: { type: Type.NUMBER },
                    awayScore: { type: Type.NUMBER },
                    description: { type: Type.STRING }
                },
                required: ["actionType", "period", "homeScore", "awayScore"]
            }
        },
        validationChecks: { type: Type.ARRAY, items: { type: Type.STRING } },
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

IMPORTANT: To simulate specific game outcomes, you MUST populate the 'actions' array with 'SCORE_UPDATE' events.
Example: { "actionType": "SCORE_UPDATE", "period": "Q1", "homeScore": 7, "awayScore": 0, "description": "Home TD" }
`;

export const generateTestScenario = onCall(
    { secrets: [geminiApiKey], timeoutSeconds: 300, memory: "1GiB" },
    async (request) => {
        // Test-only tooling that runs expensive Gemini jobs — SUPER_ADMIN only.
        // Without this, any authenticated user could drain the Gemini quota / bill.
        // CLAIM+DOC (PLAN-AUDIT-BACKEND-RESIDUE 17a): the check used to read the
        // JWT claim alone, so a demoted admin holding an un-expired token still
        // passed. assertCallerRole requires users/{uid}.role to agree — the same
        // edit PLAN-AUDIT-AUTH-HARDENING A1 made to siteAverages/expertProfiles.
        await assertCallerRole(request, "SUPER_ADMIN");
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
                { feature: "ai.test.scenario", userId: request.auth?.uid ?? null },
                SCENARIO_GENERATION_SCHEMA
            );

            return {
                ...result,
                poolType,
            };
        } catch (error) {
            console.error("Error in generateTestScenario:", error);
            throw new HttpsError("internal", "Failed to generate test scenario");
        }
    });

// ===== RESULT VALIDATION =====

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

export const validateTestResults = onCall(
    { secrets: [geminiApiKey], timeoutSeconds: 300, memory: "1GiB" },
    async (request) => {
        // Test-only tooling that runs expensive Gemini jobs — SUPER_ADMIN only.
        // Without this, any authenticated user could drain the Gemini quota / bill.
        // CLAIM+DOC (PLAN-AUDIT-BACKEND-RESIDUE 17a): the check used to read the
        // JWT claim alone, so a demoted admin holding an un-expired token still
        // passed. assertCallerRole requires users/{uid}.role to agree — the same
        // edit PLAN-AUDIT-AUTH-HARDENING A1 made to siteAverages/expertProfiles.
        await assertCallerRole(request, "SUPER_ADMIN");
        try {
            const { scenario, testResult } = request.data;

            const systemPrompt = buildValidationPrompt(scenario.poolType);
            const facts = {
                scenario,
                testResult,
                timestamp: new Date().toISOString(),
            };

            // Force text-based generation for robustness
            const textPrompt = systemPrompt + "\n\nRETURN ONLY RAW JSON. NO MARKDOWN. NOCODE BLOCKS.";

            const result = await generateAIResponse(
                textPrompt,
                facts,
                { feature: "ai.test.narrative", userId: request.auth?.uid ?? null },
                null // Pass null to bypass schema generation
            );

            return result;
        } catch (error) {
            console.error("Error in validateTestResults:", error);
            throw new HttpsError("internal", "Failed to validate test results");
        }
    });

// ===== REPORT GENERATION =====

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

export const generateTestReport = onCall(
    { secrets: [geminiApiKey], timeoutSeconds: 300, memory: "1GiB" },
    async (request) => {
        // Test-only tooling that runs expensive Gemini jobs — SUPER_ADMIN only.
        // Without this, any authenticated user could drain the Gemini quota / bill.
        // CLAIM+DOC (PLAN-AUDIT-BACKEND-RESIDUE 17a): the check used to read the
        // JWT claim alone, so a demoted admin holding an un-expired token still
        // passed. assertCallerRole requires users/{uid}.role to agree — the same
        // edit PLAN-AUDIT-AUTH-HARDENING A1 made to siteAverages/expertProfiles.
        await assertCallerRole(request, "SUPER_ADMIN");
        try {
            const { scenario, testResult, validation } = request.data;

            const systemPrompt = buildReportPrompt();
            const facts = {
                scenario,
                testResult,
                validation,
                timestamp: new Date().toISOString(),
            };

            // Force text-based generation
            const textPrompt = systemPrompt + "\n\nRETURN ONLY RAW JSON. NO MARKDOWN. NOCODE BLOCKS.";
            const result = await generateAIResponse(
                textPrompt,
                facts,
                { feature: "ai.test.analysis", userId: request.auth?.uid ?? null },
                null
            );

            return result;
        } catch (error) {
            console.error("Error in generateTestReport:", error);
            throw new HttpsError("internal", "Failed to generate test report");
        }
    });
