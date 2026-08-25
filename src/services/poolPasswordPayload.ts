/**
 * Pull a pool password out of a create/update payload
 * (PLAN-AUDIT-AUTH-HARDENING Phase B, audit items 13a/13b).
 *
 * Every squares/props wizard puts `gridPassword` in the same object as the rest
 * of the pool config, and the bracket dashboard used to put
 * `accessControl.password` there — so the plaintext travelled with every save
 * and landed on `pools/{id}`, a document that is `allow get: if true`. This is
 * the single client-side seam where it comes back out; the value then goes
 * through the `setPoolPassword` callable, which hashes it and stores the record
 * in `pools/{id}/private/access`.
 *
 * ⚠️ EMPTY IS NOT A CLEAR. `''`, `null` and `undefined` all return
 * `password: undefined`, so the caller does nothing. `src/constants.ts` ships
 * `gridPassword: ''` as the wizard default, and once the value no longer lives
 * on the document the wizard reloads that field EMPTY — so encoding "clear it"
 * as the empty string would un-gate a pool every time its commissioner saved an
 * unrelated setting. Clearing is explicit:
 * `dbService.setPoolPassword(poolId, null)`.
 *
 * Lives in its own module rather than inside `dbService`, for the same reason
 * `callableParams.ts` does: so it can be unit-tested without pulling in the
 * Firebase SDK.
 */
export function splitPoolPassword(
    input: Record<string, unknown>,
): { payload: Record<string, unknown>; password?: string } {
    const payload: Record<string, unknown> = { ...input };
    const candidates: unknown[] = [payload.gridPassword];

    delete payload.gridPassword;
    // Dotted-path form, as the bracket dashboard's updateDoc used to send it.
    if ('accessControl.password' in payload) {
        candidates.push(payload['accessControl.password']);
        delete payload['accessControl.password'];
    }
    const ac = payload.accessControl;
    if (ac && typeof ac === 'object' && !Array.isArray(ac) && 'password' in (ac as object)) {
        const copy = { ...(ac as Record<string, unknown>) };
        candidates.push(copy.password);
        delete copy.password;
        payload.accessControl = copy;
    }
    // Never let a client-chosen hash or marker ride along either — the server
    // owns both, and firestore.rules now denies them.
    delete payload.passwordHash;
    delete payload.hasPoolPassword;

    const password = candidates.find((c): c is string => typeof c === 'string' && c.length > 0);
    return password ? { payload, password } : { payload };
}
