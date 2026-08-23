
import { GoogleGenAI, Type } from "@google/genai";
import { defineSecret } from "firebase-functions/params";
import { recordUsageEvent } from "./lib/usageEvents";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

const OUTPUT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        headline: { type: Type.STRING, description: "Short, punchy title for the update." },
        summaryBullets: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "2-3 key takeaway points."
        },
        explanationSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Step-by-step logic explaining the result, citing numbers and teams."
        },
        confidence: { type: Type.NUMBER, description: "0.0 to 1.0 score of confidence based on facts provided." },
        missingFacts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of any critical data points that were not provided."
        },
    },
    required: ["headline", "summaryBullets", "explanationSteps", "confidence"],
};

/**
 * Attribution context for a Gemini call (PLAN-COST-CONTROLS Phase 1.3).
 *
 * REQUIRED, and deliberately not optional: the plan's Phase 1 exit gate is that
 * EVERY external paid call produces an attributable usage event. An optional
 * parameter would let a new call site silently opt out of attribution, which is
 * exactly the enumeration gap the sweeps exist to close. Same reasoning as the
 * `audience` parameter added to `sendCourierSMS` in Phase 0.5.3.
 */
export interface AIUsageContext {
    /** Stable feature label, e.g. "ai.dispute" / "ai.winner" / "ai.recap". */
    feature: string;
    poolId?: string | null;
    userId?: string | null;
}

export const generateAIResponse = async (
    systemInstruction: string,
    facts: any,
    usageContext: AIUsageContext,
    jsonSchema: any = OUTPUT_SCHEMA
): Promise<any> => {
    const startedAt = Date.now();
    // Guards against double-counting ONE provider call. The JSON parsing below
    // runs inside the same try block as the API call and can itself throw
    // ("Failed to parse AI JSON"), which lands in the outer catch — so without
    // this flag a malformed response records BOTH a success and an error event,
    // inflating `calls` in the daily rollup while the cost lands only once.
    // The cost ledger's question is "did the provider run and bill us", and a
    // parse failure downstream does not change that answer.
    let providerCallRecorded = false;
    const apiKey = geminiApiKey.value();
    let selectedModelName = "gemini-1.5-flash"; // Default fallback

    // Dynamic Model Discovery
    try {
        console.log("DEBUG: Discovering available models...");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (response.ok) {
            const data = await response.json();
            const modelNames = (data as any).models?.map((m: any) => m.name) || [];

            // Prioritize Flash -> Pro -> standard Gemini
            const bestModel = modelNames.find((m: string) => m.includes("flash") && !m.includes("8b")) ||
                modelNames.find((m: string) => m.includes("pro")) ||
                modelNames.find((m: string) => m.includes("gemini"));

            if (bestModel) {
                // The API returns 'models/model-name', SDK expects just 'model-name' usually, 
                // but sometimes accepts full path. We'll strip 'models/' to be safe if SDK requires it,
                // or keep it if SDK handles it. SDK usually handles 'models/' prefix fine or needs it.
                // Let's use the exact name returned by API but strip 'models/' prefix if present just in case the SDK adds it.
                selectedModelName = bestModel.replace("models/", "");
                console.log(`DEBUG: Selected Dynamic Model: ${selectedModelName} (from ${bestModel})`);
            }
        }
    } catch (e) {
        console.warn("DEBUG: Model discovery failed, using fallback:", e);
    }

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set.");
    }

    const genAI = new GoogleGenAI({ apiKey });
    const model = genAI.models;

    const prompt = `
    Analyze the following Verified Facts JSON payload. 
    You must strictly adhere to the system instructions.
    
    FACTS:
    ${JSON.stringify(facts, null, 2)}
    `;

    try {
        const result = await model.generateContent({
            model: selectedModelName,
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            ],
            config: {
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema: jsonSchema || undefined,
                systemInstruction: systemInstruction + "\n\nIMPORTANT: You must return valid PURE JSON matching the provided schema.",
            },
        });
        // Phase 1.3: usageMetadata was previously discarded here — it is the only
        // measured token count available, and Phase 2.3's spend breaker is built
        // on it. Field names vary across SDK versions, so read defensively; a
        // missing count records as unpriced rather than as zero.
        const usage: any = (result as any)?.usageMetadata ?? {};
        const inputTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null;
        const outputTokens = typeof usage.candidatesTokenCount === "number"
            ? usage.candidatesTokenCount
            : (typeof usage.responseTokenCount === "number" ? usage.responseTokenCount : null);

        await recordUsageEvent({
            provider: "gemini",
            feature: usageContext.feature,
            outcome: "success",
            latencyMs: Date.now() - startedAt,
            poolId: usageContext.poolId ?? null,
            userId: usageContext.userId ?? null,
            model: selectedModelName,
            inputTokens,
            outputTokens,
        });
        providerCallRecorded = true;

        let text = result.text ?? '';

        // Robust JSON Cleaning
        text = text.replace(/```json/g, '').replace(/```/g, '').trim(); // Strip Markdown

        // Attempt to fix common JSON errors
        text = text.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

        console.log("Debug: Raw AI Response", text.substring(0, 100) + "...");

        try {
            return JSON.parse(text);
        } catch (parseError: any) {
            console.error("JSON Parse Error:", parseError);
            console.error("Raw Text:", text);
            // Fallback: If text starts with { or [, treat as malformed
            if (text.startsWith('{') || text.startsWith('[')) {
                throw new Error(`Failed to parse AI JSON: ${parseError.message}`);
            }
            // Fallback: Return as raw object if purely text
            return { raw_response: text };
        }
    } catch (error: any) {
        // An ATTEMPTED call that failed may still be billed, and a spike in
        // errors is itself a cost signal — so failures are recorded too.
        // `errorCode` is a short class only: the raw provider message can echo
        // the prompt back, and prompts must never enter telemetry (1.4).
        //
        // Skipped when the provider call already succeeded: reaching here after
        // that means OUR parsing threw, not the provider. Recording a second
        // event would double-count a single billed call.
        if (!providerCallRecorded) await recordUsageEvent({
            provider: "gemini",
            feature: usageContext.feature,
            outcome: "error",
            latencyMs: Date.now() - startedAt,
            poolId: usageContext.poolId ?? null,
            userId: usageContext.userId ?? null,
            model: selectedModelName,
            errorCode: typeof error?.status === "number" ? `http_${error.status}` : (error?.code ? String(error.code) : "unknown"),
        });

        console.error("Gemini API Error Full Details:", JSON.stringify(error, Object.getOwnPropertyNames(error)));

        // DEBUG: Try to list models to see if key is valid
        try {
            console.log("Attempting to list models via raw fetch...");
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();
            console.log("Debug: Available Models Response", JSON.stringify(data));
        } catch (fetchError) {
            console.error("Debug: Failed to list models", fetchError);
        }

        throw new Error(`Failed to generate AI response: ${error.message || error}`);
    }
};

export const COMMISSIONER_SYSTEM_PROMPT = `
You are the AI Commissioner for a Super Bowl Squares Pool.
Your job is to explain game outcomes and resolve disputes with absolute neutrality and precision.

CORE RULES:
1. **NO HALLUCINATIONS**: You must NEVER invent scores, team names, or events. If a fact is missing from the JSON, explicitly list it in 'missingFacts' and state you cannot verify.
2. **SHOW THE MATH**: When explaining a winner, always cite:
   - The verified final score digits (Last digit of Home/Away).
   - The Axis Numbers matching those digits.
   - The Intersection square ID.
3. **TONE**: Professional, authoritative, yet approachable. Like a fair referee.
4. **INTEGRITY**: Use the Audit Log events to prove when actions happened (e.g. "Numbers were locked at [Time] which is BEFORE the game started").

OUTPUT FORMAT:
Return a JSON object matching the provided schema.
`;
