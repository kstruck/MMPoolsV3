/**
 * Paid-provider usage attribution (PLAN-COST-CONTROLS Phase 1.3/1.4).
 *
 * Answers the question the plan exists to make answerable: "what did AI cost
 * last month, per pool?" — from recorded events rather than guesswork.
 *
 * ⚠️ THIS MODULE MUST NEVER THROW INTO ITS CALLER. It observes paid calls; a
 * telemetry failure must not fail the AI generation or the SMS send it is
 * watching. Same swallow-and-log principle as `lib/sentryServer.ts` and
 * `logClientError.ts`. Every export catches its own errors and returns.
 *
 * ⚠️ WHAT MUST NEVER BE WRITTEN HERE (plan 1.4): prompts, model responses,
 * user questions, or phone numbers. This collection is readable by SUPER_ADMIN
 * and retained for 90 days; it records SHAPE and COST, never content. The
 * `userId`/`poolId` pair is the attribution key and is the only identifying
 * data that belongs in it.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { estimateGeminiCostUSD, PRICE_CATALOG_VERSION } from "./priceCatalog";

/** Raw, per-call events. 90-day TTL (D3). */
export const USAGE_EVENTS_COLLECTION = "provider_usage_events";
/** Rolled-up daily counters. 24-month retention (D3) — small, kept for season-over-season. */
export const USAGE_DAILY_COLLECTION = "provider_usage_daily";

/** Retention for raw events (D3: 90 days), applied via an `expiresAt` field. */
export const RAW_EVENT_TTL_DAYS = 90;

export type UsageProvider = "gemini" | "courier";

/**
 * Outcome of the provider call.
 * - `success`  — the provider answered and we used the answer.
 * - `error`    — the call was ATTEMPTED and failed. Bills may still apply.
 * - `skipped`  — no call was made (kill-switch, missing token). Costs nothing,
 *                but is recorded so a silent feature-off is visible.
 */
export type UsageOutcome = "success" | "error" | "skipped";

export interface UsageEventInput {
    provider: UsageProvider;
    /** Stable label for the calling feature, e.g. "ai.dispute", "sms.reminder". */
    feature: string;
    outcome: UsageOutcome;
    /** Wall-clock duration of the provider call in ms. */
    latencyMs?: number | null;
    poolId?: string | null;
    userId?: string | null;
    /** Model the provider actually used (Gemini only). */
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    /** Courier only: how many messages the send represents. */
    messageCount?: number | null;
    /** Short error class, NEVER the provider's raw message (may echo the prompt). */
    errorCode?: string | null;
}

/** UTC day key. Deliberately UTC, not ET: aggregates must not shift under DST. */
export function dayKeyUTC(now: Date): string {
    return now.toISOString().slice(0, 10);
}

/**
 * Aggregate doc id. Includes the pool so "top pools by AI spend" (Phase 6) is a
 * query rather than a scan, and so the Phase 2.3 per-pool breaker can read one
 * document. `__none__` keeps the id well-formed for pool-less events (ops SMS).
 *
 * Firestore ids may not contain '/', so any slash in a caller-supplied feature
 * label would create a nested path instead of a document. Sanitized here rather
 * than trusted, because the label is written by call sites, not by a schema.
 */
export function dailyAggregateId(
    dayKey: string,
    provider: UsageProvider,
    feature: string,
    poolId: string | null | undefined
): string {
    const safeFeature = feature.replace(/[/\s]+/g, "_");
    return `${dayKey}__${provider}__${safeFeature}__${poolId || "__none__"}`;
}

/**
 * Record one paid-provider call. Fire-and-forget by design — callers should
 * `await` it (it is cheap and keeps the write inside the function's lifetime,
 * which a detached promise does not guarantee on Cloud Functions), but they
 * must never branch on it: it resolves even when the write fails.
 */
export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
    try {
        const db = admin.firestore();
        const now = new Date();
        const dayKey = dayKeyUTC(now);

        const cost = input.provider === "gemini"
            ? estimateGeminiCostUSD(input.model, input.inputTokens, input.outputTokens)
            : { estimatedCostUSD: null, priced: false, pricedAs: null, catalogVersion: PRICE_CATALOG_VERSION };

        const event = {
            provider: input.provider,
            feature: input.feature,
            outcome: input.outcome,
            poolId: input.poolId ?? null,
            userId: input.userId ?? null,
            model: input.model ?? null,
            inputTokens: input.inputTokens ?? null,
            outputTokens: input.outputTokens ?? null,
            messageCount: input.messageCount ?? null,
            latencyMs: input.latencyMs ?? null,
            errorCode: input.errorCode ?? null,
            estimatedCostUSD: cost.estimatedCostUSD,
            priced: cost.priced,
            pricedAs: cost.pricedAs,
            priceCatalogVersion: cost.catalogVersion,
            dayKey,
            createdAt: FieldValue.serverTimestamp(),
            // Firestore TTL deletes on this field once a TTL policy names it.
            // ⚠️ The policy itself is a console/gcloud action and is NOT created
            // by any deploy command — until it exists this field is inert and
            // raw events accumulate. See the plan's deploy notes.
            expiresAt: admin.firestore.Timestamp.fromMillis(
                now.getTime() + RAW_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000
            ),
        };

        await db.collection(USAGE_EVENTS_COLLECTION).add(event);

        // Daily rollup (1.4). Counters only — no identifying data beyond the
        // pool the aggregate is already keyed by.
        const aggRef = db
            .collection(USAGE_DAILY_COLLECTION)
            .doc(dailyAggregateId(dayKey, input.provider, input.feature, input.poolId));

        // `unpricedCalls` is what stops a rollup reading as a small bill when it
        // is really an unknown one: cost sums NULL as nothing, so without this
        // counter an all-unpriced day and a genuinely free day look identical.
        await aggRef.set({
            dayKey,
            provider: input.provider,
            feature: input.feature,
            poolId: input.poolId ?? null,
            calls: FieldValue.increment(1),
            successes: FieldValue.increment(input.outcome === "success" ? 1 : 0),
            errors: FieldValue.increment(input.outcome === "error" ? 1 : 0),
            skipped: FieldValue.increment(input.outcome === "skipped" ? 1 : 0),
            inputTokens: FieldValue.increment(input.inputTokens ?? 0),
            outputTokens: FieldValue.increment(input.outputTokens ?? 0),
            messageCount: FieldValue.increment(input.messageCount ?? 0),
            estimatedCostUSD: FieldValue.increment(cost.estimatedCostUSD ?? 0),
            unpricedCalls: FieldValue.increment(cost.priced ? 0 : 1),
            priceCatalogVersion: cost.catalogVersion,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (e) {
        // Deliberately swallowed — see the module header.
        console.warn("[usageEvents] failed to record usage event; continuing", e);
    }
}
