/**
 * Payload hygiene for Firebase callables.
 *
 * The callable serializer encodes a key that is PRESENT with an `undefined`
 * value as `null` on the wire — `Serializer.encode` walks the object with
 * `for (const key in data)`, which does not skip undefined values, and returns
 * `null` for anything `== null`. Server schemas in `shared/schemas/*` use
 * `.optional()`, which accepts an ABSENT key and rejects `null`.
 *
 * So `{ couponCode: undefined }` fails validation while `{}` succeeds, and the
 * client idiom `couponCode: x ? x : undefined` produces the failing shape.
 * Strip the keys so optional fields are genuinely omitted.
 *
 * Lives in its own module rather than inside `dbService` so it can be unit
 * tested without pulling in the Firebase SDK, and so there is ONE definition —
 * the second inline copy is what let `getPoolQuote` ship without it
 * (PLAN-BUYFLOW-QUOTE-DEADEND).
 *
 * Only `undefined` and `null` are dropped. `0`, `''` and `false` are meaningful
 * values on these payloads (`estimatedPlayers: 0`, `usedCredit: false`) and a
 * plain falsy filter would silently delete them.
 */
export function stripEmptyCallableFields<T extends object>(params: T): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    );
}
