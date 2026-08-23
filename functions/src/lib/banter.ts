// The pure halves of AI banter generation (PLAN-WIZARD-BUYFLOW-FIXES T9).
//
// Kept free of firebase imports so they are unit-testable: `aiCommissioner.ts`
// calls `admin.firestore()` at module load, so importing it from a test needs a
// live app. These two functions decide what actually reaches a feed every
// member of the pool reads, which is exactly the part worth testing directly.

/** The moods the commissioner's card offers. */
export const BANTER_MOODS = ['savage', 'professional', 'analyst'] as const;
export type BanterMood = (typeof BANTER_MOODS)[number];

/**
 * Normalizes the mood off a client-written `ai_requests` document.
 *
 * Falls back to 'professional', deliberately NOT 'savage': this is the tone an
 * unrecognised value gets posted as, under the commissioner's name, to the
 * whole pool. 'professional' is the one tone that is safe unreviewed.
 */
export function normalizeBanterMood(raw: unknown): BanterMood {
    return (BANTER_MOODS as readonly string[]).includes(String(raw))
        ? (raw as BanterMood)
        : 'professional';
}

/**
 * Flattens the model's structured response into one feed post.
 *
 * The output schema is shared with dispute resolution, which wants headline +
 * bullets + step-by-step reasoning. A feed post wants prose, and
 * `explanationSteps` on a piece of trash talk reads like a court filing — so
 * the steps are dropped and only the headline and bullets survive.
 *
 * Returns '' when there is nothing usable. The caller treats that as a FAILURE
 * and marks the request ERROR rather than posting a blank message.
 */
export function banterTextFromAI(ai: unknown): string {
    const a = (ai ?? {}) as { headline?: unknown; summaryBullets?: unknown };
    const headline = typeof a.headline === 'string' ? a.headline.trim() : '';
    const bullets = Array.isArray(a.summaryBullets)
        ? a.summaryBullets
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .map((b) => b.trim())
        : [];
    return [headline, ...bullets].filter(Boolean).join(' ').trim();
}
