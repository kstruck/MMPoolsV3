"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMISSIONER_SYSTEM_PROMPT = exports.generateAIResponse = void 0;
const generative_ai_1 = require("@google/generative-ai");
const params_1 = require("firebase-functions/params");
const geminiApiKey = (0, params_1.defineSecret)("GEMINI_API_KEY");
const OUTPUT_SCHEMA = {
    type: generative_ai_1.SchemaType.OBJECT,
    properties: {
        headline: { type: generative_ai_1.SchemaType.STRING, description: "Short, punchy title for the update." },
        summaryBullets: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: { type: generative_ai_1.SchemaType.STRING },
            description: "2-3 key takeaway points."
        },
        explanationSteps: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: { type: generative_ai_1.SchemaType.STRING },
            description: "Step-by-step logic explaining the result, citing numbers and teams."
        },
        confidence: { type: generative_ai_1.SchemaType.NUMBER, description: "0.0 to 1.0 score of confidence based on facts provided." },
        missingFacts: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: { type: generative_ai_1.SchemaType.STRING },
            description: "List of any critical data points that were not provided."
        },
    },
    required: ["headline", "summaryBullets", "explanationSteps", "confidence"],
};
const generateAIResponse = async (systemInstruction, facts, jsonSchema = OUTPUT_SCHEMA) => {
    const apiKey = geminiApiKey.value();
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set.");
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: jsonSchema,
            temperature: 0.2, // Low temperature for factual accuracy
        },
        systemInstruction: {
            role: "system",
            parts: [{ text: systemInstruction }]
        }
    });
    const prompt = `
    Analyze the following Verified Facts JSON payload. 
    You must strictly adhere to the system instructions.
    Do not use external knowledge. Use ONLY these facts.
    
    FACTS:
    ${JSON.stringify(facts, null, 2)}
    `;
    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        return JSON.parse(responseText);
    }
    catch (error) {
        console.error("Gemini API Error:", error);
        throw new Error("Failed to generate AI response.");
    }
};
exports.generateAIResponse = generateAIResponse;
exports.COMMISSIONER_SYSTEM_PROMPT = `
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
//# sourceMappingURL=gemini.js.map