
import { GoogleGenAI, Type } from "@google/genai";
import { defineSecret } from "firebase-functions/params";
import { AIProviderError, providerFailureReason } from "./lib/aiProviderError";

// Re-exported so existing importers of `./gemini` keep working; the logic is
// pure and lives in `lib/` so it can be unit-tested without the provider SDK.
export { AIProviderError, providerFailureReason };

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

export const generateAIResponse = async (
    systemInstruction: string,
    facts: any,
    jsonSchema: any = OUTPUT_SCHEMA
): Promise<any> => {
    const apiKey = geminiApiKey.value();
    // Checked BEFORE any network call. It used to sit below model discovery, so a
    // missing secret produced a fetch with `key=undefined` and a confusing 400
    // before the honest "not set" error ever fired.
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set.");
    }
    let selectedModelName = "gemini-1.5-flash"; // Default fallback

    // Dynamic Model Discovery
    try {
        console.log("[gemini] discovering available models...");
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
                console.log(`[gemini] selected model: ${selectedModelName} (from ${bestModel})`);
            }
        }
    } catch (e) {
        console.warn("[gemini] model discovery failed, using fallback:", e);
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
        // 🛑 THE REASON IS EXTRACTED AND CARRIED, not just logged.
        //
        // On 2026-08-24 the AI Commissioner had never once worked in production:
        // the Gemini key carried an HTTP-referrer restriction, Cloud Functions
        // send no `Referer`, and every call came back 403
        // API_KEY_HTTP_REFERRER_BLOCKED. Diagnosing that took a production log
        // pull, because every layer above this reported "could not write that
        // one" — a config problem and a network blip were indistinguishable.
        // The reason now rides on the thrown error so the request document, and
        // therefore the commissioner's own screen, can name it.
        const reason = providerFailureReason(error);
        console.error(`[gemini] request failed (${reason}):`, JSON.stringify(error, Object.getOwnPropertyNames(error)));

        // The "list the models to see if the key is valid" retry that used to
        // live here is GONE. The key had just been rejected, so it fired a
        // second doomed request and logged the identical error a second time —
        // noise that made the real one harder to find, on a paid API.

        throw new AIProviderError(reason, error?.message || String(error));
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

/**
 * The banter voice (PLAN-WIZARD-BUYFLOW-FIXES T9). A SEPARATE prompt from
 * COMMISSIONER_SYSTEM_PROMPT on purpose: that one's whole job is neutrality and
 * "show the math" for dispute resolution, and asking the same instruction set
 * for trash talk produces a referee reading a scoreboard.
 *
 * The no-hallucination rule survives the tone change, and one rule is added
 * that a dispute prompt never needed: this text is posted to a shared feed the
 * whole pool reads, so it must be rude about PLAY, never about people.
 */
export const BANTER_SYSTEM_PROMPT = `
You are the AI Commissioner of a fantasy-style NFL pool, writing a short post
for the pool's shared feed. The human commissioner asked for this post and it
appears under your name to every member.

TONE: set by the "mood" field in the facts.
  - savage:       cocky, teasing, heavy on jokes. Roast the PICKS and the standings.
  - professional: brisk and businesslike. A commissioner's note, not a rant.
  - analyst:      numbers first. Cite ranks, records, margins, streaks.

CORE RULES:
1. **NO HALLUCINATIONS.** Only use names, records, ranks and results present in
   the facts. If the pool has not played a week yet, say so and keep it short —
   never invent a rivalry, a collapse, or a history that is not in the data.
2. **PLAY, NOT PEOPLE.** Mock picks, records, streaks and standings. Never a
   member's appearance, intelligence, character, job, family, or anything
   outside this pool. No slurs and no profanity, at any mood.
3. **HONOUR THE COMMISSIONER'S PROMPT.** The "commissionerPrompt" field is what
   they asked for. If it asks for something rule 2 forbids, write the closest
   thing that does not, rather than refusing silently.
4. **SHORT.** 1-3 sentences in the headline plus at most 3 bullets. This is a
   feed post, not a recap.

OUTPUT FORMAT:
Return a JSON object matching the provided schema.
`;
