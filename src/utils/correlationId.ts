/**
 * FE half of callable correlation (PLAN-SECURITY-OBSERVABILITY.md #9).
 *
 * Firebase's httpsCallable transport won't forward custom sentry-trace/baggage
 * headers, so FE<->BE stitching for callable traffic rides in the DATA
 * payload instead. The backend (`validated()` in functions/src/lib/validated.ts)
 * strips this key before schema validation, so it's safe to attach even on
 * callables with a `.strict()` zod schema.
 */
export function generateCorrelationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns a shallow copy of `data` with a fresh `_correlationId` attached. */
export function withCorrelationId<T extends Record<string, unknown> | undefined>(
    data: T,
): (T extends undefined ? Record<string, unknown> : T) & { _correlationId: string } {
    return { ...(data ?? {}), _correlationId: generateCorrelationId() } as (T extends undefined ? Record<string, unknown> : T) & { _correlationId: string };
}
