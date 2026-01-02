"use strict";
/**
 * AI Testing Cloud Functions
 * Backend functions that use Gemini AI for test scenario generation,
 * result validation, and report generation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTestReport = exports.validateTestResults = exports.generateTestScenario = void 0;
const https_1 = require("firebase-functions/v2/https");
const gemini_1 = require("./gemini");
const generative_ai_1 = require("@google/generative-ai");
// ===== SCENARIO GENERATION =====
const SCENARIO_GENERATION_SCHEMA = {
    type: generative_ai_1.SchemaType.OBJECT,
    properties: {
        scenarioName: { type: generative_ai_1.SchemaType.STRING },
        description: { type: generative_ai_1.SchemaType.STRING },
        poolConfig: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                name: { type: generative_ai_1.SchemaType.STRING },
                type: { type: generative_ai_1.SchemaType.STRING },
                props: {
                    type: generative_ai_1.SchemaType.OBJECT,
                    properties: {
                        costPerCard: { type: generative_ai_1.SchemaType.NUMBER },
                        isLocked: { type: generative_ai_1.SchemaType.BOOLEAN }
                    },
                    required: ["costPerCard", "isLocked"]
                },
                maxPlayers: { type: generative_ai_1.SchemaType.NUMBER }
            },
            required: ["name", "type", "props", "maxPlayers"]
        },
        testUsers: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: {
                type: generative_ai_1.SchemaType.OBJECT,
                properties: {
                    name: { type: generative_ai_1.SchemaType.STRING },
                    strategy: { type: generative_ai_1.SchemaType.STRING },
                    behavior: { type: generative_ai_1.SchemaType.STRING },
                },
                required: ["name", "strategy", "behavior"]
            },
        },
        expectedOutcome: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                winner: { type: generative_ai_1.SchemaType.STRING },
                topThree: { type: generative_ai_1.SchemaType.ARRAY, items: { type: generative_ai_1.SchemaType.STRING } },
                edgeCases: { type: generative_ai_1.SchemaType.ARRAY, items: { type: generative_ai_1.SchemaType.STRING } },
            },
            required: ["winner", "topThree", "edgeCases"]
        },
        actions: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: {
                type: generative_ai_1.SchemaType.OBJECT,
                properties: {
                    actionType: { type: generative_ai_1.SchemaType.STRING, description: "Use 'SCORE_UPDATE' for score changes" },
                    period: { type: generative_ai_1.SchemaType.STRING, description: "Q1, Q2, Q3, FINAL" },
                    homeScore: { type: generative_ai_1.SchemaType.NUMBER },
                    awayScore: { type: generative_ai_1.SchemaType.NUMBER },
                    description: { type: generative_ai_1.SchemaType.STRING }
                },
                required: ["actionType", "period", "homeScore", "awayScore"]
            }
        },
        validationChecks: { type: generative_ai_1.SchemaType.ARRAY, items: { type: generative_ai_1.SchemaType.STRING } },
    },
    required: ["scenarioName", "description", "poolConfig", "testUsers", "expectedOutcome", "validationChecks"],
};
const buildScenarioPrompt = (poolType) => `
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
exports.generateTestScenario = (0, https_1.onCall)({ secrets: [gemini_1.geminiApiKey], timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
    try {
        const { poolType, userRequest } = request.data;
        const systemPrompt = buildScenarioPrompt(poolType);
        const facts = {
            poolType,
            userRequest,
            timestamp: new Date().toISOString(),
        };
        const result = await (0, gemini_1.generateAIResponse)(systemPrompt, facts, SCENARIO_GENERATION_SCHEMA);
        return Object.assign(Object.assign({}, result), { poolType });
    }
    catch (error) {
        console.error("Error in generateTestScenario:", error);
        throw new https_1.HttpsError("internal", "Failed to generate test scenario");
    }
});
// ===== RESULT VALIDATION =====
const buildValidationPrompt = (poolType) => `
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
exports.validateTestResults = (0, https_1.onCall)({ secrets: [gemini_1.geminiApiKey], timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
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
        const result = await (0, gemini_1.generateAIResponse)(textPrompt, facts, null // Pass null to bypass schema generation
        );
        return result;
    }
    catch (error) {
        console.error("Error in validateTestResults:", error);
        throw new https_1.HttpsError("internal", "Failed to validate test results");
    }
});
// ===== REPORT GENERATION =====
const buildReportPrompt = () => `
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
exports.generateTestReport = (0, https_1.onCall)({ secrets: [gemini_1.geminiApiKey], timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
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
        const result = await (0, gemini_1.generateAIResponse)(textPrompt, facts, null);
        return result;
    }
    catch (error) {
        console.error("Error in generateTestReport:", error);
        throw new https_1.HttpsError("internal", "Failed to generate test report");
    }
});
//# sourceMappingURL=aiTesting.js.map