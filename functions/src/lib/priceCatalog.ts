/**
 * Versioned price catalog for paid providers (PLAN-COST-CONTROLS Phase 1.5).
 *
 * Prices live in CODE, not Firestore, on purpose: a price change is a deploy
 * with review, not a console edit. Every usage event stamps the version that
 * priced it, so a later catalog change cannot silently rewrite the cost history
 * that Phase 7.3's invoice reconciliation is measured against.
 *
 * ⚠️ UNPRICED IS A FIRST-CLASS OUTCOME, NOT AN ERROR. A model this catalog does
 * not know returns `priced: false` and a NULL cost — never 0, never a guess.
 * Today `generateAIResponse` still picks its model by dynamic discovery
 * (`gemini.ts`), so an unknown model id is expected until Phase 3.4 pins one.
 * A guessed number here would flow into the Phase 2.3 spend breaker and either
 * trip it early or, worse, never trip it. The plan's rule for the dashboard is
 * the same rule: "show 'insufficient provider data' rather than inventing a
 * number".
 *
 * Sources for the numbers below are Google's published Gemini API list prices
 * for paid tier, text input/output, as read on the date in each row's `asOf`.
 * They are TARGETS TO VERIFY in Phase 0.2, not gospel — Kevin has not yet
 * confirmed the pinned model or its price (D1).
 */

/**
 * Bump on ANY change to the numbers below. Format: YYYY-MM-DD.N so a same-day
 * correction is still distinguishable in recorded events.
 */
export const PRICE_CATALOG_VERSION = "2026-08-23.1";

export interface TokenPrice {
    /** USD per 1,000,000 input tokens. */
    inputPerMillionUSD: number;
    /** USD per 1,000,000 output tokens. */
    outputPerMillionUSD: number;
    /** When these numbers were read from the provider's price page. */
    asOf: string;
}

/**
 * Keyed by the model id as the API reports it, WITHOUT any `models/` prefix —
 * `generateAIResponse` strips that before use, so lookups here must match the
 * stripped form. Keys are matched case-insensitively and by longest prefix, so
 * a dated variant (`gemini-2.0-flash-001`) prices off its family entry.
 */
export const GEMINI_PRICES: Readonly<Record<string, TokenPrice>> = Object.freeze({
    // ⚠️ DECLARATION ORDER IS DELIBERATELY ADVERSE: each family appears BEFORE
    // its own longer variants ("gemini-2.0-flash" above "gemini-2.0-flash-lite").
    // Lookup must not depend on this order — `lookupGeminiPrice` sorts by
    // descending key length — and writing the literal in the order that a naive
    // first-match scan gets WRONG is what makes the guard in
    // `priceCatalog.test.ts` real instead of incidentally passing. Do not
    // "tidy" these into longest-first order; that would make the test pass even
    // if the sort were deleted.
    "gemini-2.0-flash": { inputPerMillionUSD: 0.10, outputPerMillionUSD: 0.40, asOf: "2026-08-23" },
    "gemini-2.0-flash-lite": { inputPerMillionUSD: 0.075, outputPerMillionUSD: 0.30, asOf: "2026-08-23" },
    "gemini-1.5-flash": { inputPerMillionUSD: 0.075, outputPerMillionUSD: 0.30, asOf: "2026-08-23" },
    "gemini-1.5-flash-8b": { inputPerMillionUSD: 0.0375, outputPerMillionUSD: 0.15, asOf: "2026-08-23" },
    "gemini-1.5-pro": { inputPerMillionUSD: 1.25, outputPerMillionUSD: 5.00, asOf: "2026-08-23" },
});

export interface CostEstimate {
    /** Null when the model is not in the catalog — never a guessed number. */
    estimatedCostUSD: number | null;
    /** False when the model is unknown OR token counts were unavailable. */
    priced: boolean;
    /** The catalog entry actually used, for auditability. */
    pricedAs: string | null;
    catalogVersion: string;
}

/**
 * Longest-prefix match so `gemini-2.0-flash-lite-preview-02-05` prices as
 * flash-lite rather than falling back to the more expensive `gemini-2.0-flash`.
 * Sorting by descending key length is what makes that hold — a plain
 * `startsWith` scan over object order would let `gemini-2.0-flash` win, and
 * silently price a cheap model at 1.3x.
 */
export function lookupGeminiPrice(model: string | null | undefined): { key: string; price: TokenPrice } | null {
    if (!model) return null;
    const normalized = model.replace(/^models\//, "").trim().toLowerCase();
    if (!normalized) return null;

    const keys = Object.keys(GEMINI_PRICES).sort((a, b) => b.length - a.length);
    for (const key of keys) {
        if (normalized === key || normalized.startsWith(key)) {
            return { key, price: GEMINI_PRICES[key] };
        }
    }
    return null;
}

/**
 * Token counts come from the provider's own `usageMetadata`. When either count
 * is missing we do NOT substitute an estimate from prompt length — an estimate
 * derived from our own guesswork is indistinguishable, downstream, from a
 * measured number, and Phase 2.3's breaker is built on these values.
 */
export function estimateGeminiCostUSD(
    model: string | null | undefined,
    inputTokens: number | null | undefined,
    outputTokens: number | null | undefined
): CostEstimate {
    const found = lookupGeminiPrice(model);
    const haveTokens =
        typeof inputTokens === "number" && Number.isFinite(inputTokens) &&
        typeof outputTokens === "number" && Number.isFinite(outputTokens);

    if (!found || !haveTokens) {
        return {
            estimatedCostUSD: null,
            priced: false,
            pricedAs: found ? found.key : null,
            catalogVersion: PRICE_CATALOG_VERSION,
        };
    }

    const usd =
        (inputTokens as number) / 1_000_000 * found.price.inputPerMillionUSD +
        (outputTokens as number) / 1_000_000 * found.price.outputPerMillionUSD;

    return {
        // Sub-cent costs are the norm here (~$0.002/request), so rounding to
        // cents would record almost every call as $0.00 and make the monthly
        // rollup read zero. Six decimals keeps a single request meaningful.
        estimatedCostUSD: Math.round(usd * 1_000_000) / 1_000_000,
        priced: true,
        pricedAs: found.key,
        catalogVersion: PRICE_CATALOG_VERSION,
    };
}
