/**
 * Stripe webhook durability helpers (PLAN-SECURITY-OBSERVABILITY Phase 1 #6/#7).
 *
 * PURE (no firebase-admin) so the retry/alert decisions are unit-testable
 * without the emulator. The webhook handler in stripe.ts applies the actual
 * Firestore writes; these functions only decide WHAT should happen.
 *
 * Durability model: a `stripeWebhookEvents/{event.id}` doc is the idempotency
 * marker AND the failure record. A failed event is NO LONGER deleted — it is
 * flipped to `status:"failed"` with an incrementing `attemptCount`, so Stripe's
 * retry of the same event.id de-dupes naturally and ops can alert on
 * age/attempt thresholds instead of on every retry.
 */

export type WebhookEventStatus = "processing" | "completed" | "failed";

export interface WebhookEventDoc {
    status?: WebhookEventStatus;
    startedAt?: number;
    attemptCount?: number;
}

/** A `processing` doc older than this is presumed abandoned (prior invocation died). */
export const WEBHOOK_STALE_MS = 5 * 60 * 1000;

/** Alert ops once an event has failed this many times — not on the first retry. */
export const WEBHOOK_ALERT_ATTEMPT_THRESHOLD = 3;

export type ClaimReason =
    | "no-doc"
    | "completed"
    | "failed-retry"
    | "stale-takeover"
    | "concurrent";

/**
 * Decide whether the current invocation should (re)claim an already-existing
 * `stripeWebhookEvents` doc. Called only from the ALREADY_EXISTS path (a fresh
 * create() already returns true). The caller applies the claiming write in a
 * transaction.
 *
 *  - completed            → never reclaim (a genuine Stripe duplicate).
 *  - failed               → reclaim (Stripe is retrying a previously-failed
 *                           event; before this change the failed doc was
 *                           deleted, so the retry hit create() cleanly — now
 *                           the doc persists, so the retry MUST be re-claimed
 *                           here or it would be dropped as a duplicate).
 *  - processing + stale   → reclaim (a prior invocation died mid-flight).
 *  - processing + fresh   → skip (a concurrent invocation owns it).
 *  - missing data         → reclaim (raced with a delete; safe to take).
 */
export function decideEventClaim(
    doc: WebhookEventDoc | undefined,
    nowMs: number,
    staleMs: number = WEBHOOK_STALE_MS,
): { take: boolean; reason: ClaimReason } {
    if (!doc) return { take: true, reason: "no-doc" };
    if (doc.status === "completed") return { take: false, reason: "completed" };
    if (doc.status === "failed") return { take: true, reason: "failed-retry" };
    if (doc.status === "processing" && nowMs - (doc.startedAt ?? 0) > staleMs) {
        return { take: true, reason: "stale-takeover" };
    }
    return { take: false, reason: "concurrent" };
}

/**
 * Thresholded alerting: fire the ops alert EXACTLY ONCE, on the attempt that
 * reaches the bar. `=== threshold` (not `>=`) so later retries don't re-write
 * the WEBHOOK_FAILED_<id> alert doc and clobber its createdAt on every attempt;
 * the escalating attemptCount still lives on the stripeWebhookEvents doc for
 * anyone who looks. attemptCount increments by exactly 1 per markFailed, so the
 * threshold is always hit precisely once.
 */
export function shouldAlertOnFailure(
    attemptCount: number,
    threshold: number = WEBHOOK_ALERT_ATTEMPT_THRESHOLD,
): boolean {
    return attemptCount === threshold;
}

/**
 * SLO objective (PLAN #14): "zero stripeWebhookEvents stuck in failed past
 * threshold". shouldAlertOnFailure() above only fires if Stripe actually
 * retries the SAME event.id up to the attempt threshold — a webhook that
 * fails once or twice and is never retried again would sit in status:"failed"
 * indefinitely without ever tripping that alert. webhookDurabilitySweep.ts's
 * daily scan uses this as a time-based backstop, independent of attemptCount.
 */
export const WEBHOOK_STUCK_MS = 24 * 60 * 60 * 1000; // 24h

export function isWebhookStuck(
    lastFailedAt: number | undefined,
    nowMs: number,
    thresholdMs: number = WEBHOOK_STUCK_MS,
): boolean {
    return nowMs - (lastFailedAt ?? 0) > thresholdMs;
}
