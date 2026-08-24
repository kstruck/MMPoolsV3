/**
 * Provider failure reporting for the AI Commissioner. PURE — no SDK import, no
 * firebase-admin — so it is unit-testable without `@google/genai` installed,
 * the same reason every other `lib/` module here is pure.
 *
 * 🛑 WHY THIS EXISTS. The AI Commissioner had never once worked in production.
 * On 2026-08-24 the cause turned out to be an HTTP-referrer restriction on the
 * Gemini API key: Cloud Functions call the provider server-to-server and send no
 * `Referer` header, so every request came back
 * `403 API_KEY_HTTP_REFERRER_BLOCKED`.
 *
 * Finding that took a production log pull, because every layer above the
 * provider reported the same sentence — "the AI could not write that one" — for
 * a permanent config mistake, a transient network failure and an empty model
 * response alike. A commissioner cannot ACT on `API_KEY_HTTP_REFERRER_BLOCKED`,
 * but they can read it out, and that is the difference between a screenshot and
 * an hour of log archaeology.
 */

/**
 * A provider failure with the reason kept MACHINE-READABLE.
 *
 * `message` stays full for the logs; `reason` is the short stable code callers
 * persist on the request document.
 */
export class AIProviderError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = "AIProviderError";
  }
}

/**
 * Pull a short, stable code out of whatever the provider threw.
 *
 * The Google SDK's `ApiError` carries a JSON body whose `error.details[]`
 * include an ErrorInfo with a `reason`. Falls back to the RPC `status`, then the
 * HTTP code, then `UNKNOWN`.
 *
 * ⚠️ NEVER THROWS. It runs inside a catch block, so a parse failure here would
 * replace a diagnosable provider error with a meaningless one — precisely the
 * failure mode it was written to end.
 */
export function providerFailureReason(error: unknown): string {
  try {
    const raw = (error as { message?: string })?.message ?? "";
    const start = raw.indexOf("{");
    if (start >= 0) {
      const body = JSON.parse(raw.slice(start)) as {
        error?: { status?: string; code?: number; details?: Array<{ reason?: string }> };
      };
      const detail = body.error?.details?.find((d) => typeof d?.reason === "string")?.reason;
      const resolved = detail
        || body.error?.status
        || (body.error?.code ? `HTTP_${body.error.code}` : undefined);
      if (resolved) return resolved;
    }
  } catch {
    // fall through to the status-based guess below
  }
  const status = (error as { status?: number })?.status;
  return typeof status === "number" ? `HTTP_${status}` : "UNKNOWN";
}
