/**
 * Input schemas for the three AI-testing callables (aiTesting.ts) —
 * PLAN-API-TRUST-BOUNDARY Phase 2. They were raw destructures of
 * `request.data`, so a null payload became a swallowed `internal` instead of
 * `invalid-argument`, and unbounded strings rode straight into Gemini prompt
 * construction on a 300s/1GiB budget.
 *
 * SUPER_ADMIN-only tooling, so the object payloads (`scenario`, `testResult`,
 * `validation`) stay deliberately shallow records — they are echoed to the
 * model as facts, not consumed field-by-field; the one dereferenced field
 * (`scenario.poolType`) gets its own bound. PURE: zod only.
 */

import { z } from "zod";

const boundedName = z.string().trim().min(1).max(64);
/** Reject null/array/primitive; keep contents loose (model-bound facts). */
const looseRecord = z.record(z.string().max(200), z.unknown()).refine(
    (v) => !Array.isArray(v),
    { message: "must be a plain object" },
);

export const generateTestScenarioSchema = z.object({
    poolType: boundedName,
    userRequest: z.string().max(4000).optional(),
});

export const validateTestResultsSchema = z.object({
    scenario: looseRecord.refine(
        (s) => typeof (s as Record<string, unknown>).poolType === "string"
            && ((s as Record<string, unknown>).poolType as string).length <= 64,
        { message: "scenario.poolType must be a string (max 64 chars)" },
    ),
    testResult: looseRecord,
});

export const generateTestReportSchema = z.object({
    scenario: looseRecord,
    testResult: looseRecord,
    validation: looseRecord.optional(),
});
