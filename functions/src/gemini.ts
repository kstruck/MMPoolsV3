
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { defineSecret } from "firebase-functions/params";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

const OUTPUT_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        headline: { type: SchemaType.STRING, description: "Short, punchy title for the update." },
        summaryBullets: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "2-3 key takeaway points."
        },
        explanationSteps: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "Step-by-step logic explaining the result, citing numbers and teams."
        },
        confidence: { type: SchemaType.NUMBER, description: "0.0 to 1.0 score of confidence based on facts provided." },
        missingFacts: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: "List of any critical data points that were not provided."
        },
    },
    required: ["headline", "summaryBullets", "explanationSteps", "confidence"],
};

export const generateAIResponse = async (
    systemInstruction: string,
    facts: any,
    jsonSchema: any = OUTPUT_SCHEMA
): Promise<any> => {
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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: selectedModelName,
        // responseSchema: schema // DISABLED: Using text generation for reliability
        generationConfig: {
            temperature: 0.2,
        },
        systemInstruction: {
            role: "system",
            parts: [{ text: systemInstruction + "\n\nIMPORTANT: You must return PURE JSON. Do not include markdown formatting like ```json ... ```. Just the raw JSON object." }]
        }
    });

    const prompt = `
    Analyze the following Verified Facts JSON payload. 
    You must strictly adhere to the system instructions.
    
    FACTS:
    ${JSON.stringify(facts, null, 2)}
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();

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
