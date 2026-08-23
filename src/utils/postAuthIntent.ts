/**
 * A one-shot "where the visitor was going before we asked them to sign in"
 * (PLAN-WIZARD-BUYFLOW-FIXES G2, codex r2).
 *
 * G2's fix is that an anonymous create CTA opens the auth modal instead of
 * bouncing silently. Continuing to the wizard afterwards cannot live in the
 * page that started it:
 *
 *  - a NEW account is navigated to `/participant` by `App`'s post-auth handler,
 *    which unmounts that page before any effect of its own could run (r2 [P1]);
 *  - an intent left lying around fires on a LATER, unrelated sign-in from the
 *    header (r2 [P2]).
 *
 * So the intent lives here, module-scoped, and `App` — which owns post-auth
 * navigation already — consumes it once or discards it when the modal closes
 * without authenticating.
 *
 * Deliberately in memory only. A sessionStorage copy would survive a reload and
 * teleport someone into the wizard on a later visit, which is the same bug in a
 * longer-lived form.
 */
let pendingPath: string | null = null;

/** Remember where to go once authentication succeeds. Replaces any prior intent. */
export function setPostAuthIntent(path: string): void {
    pendingPath = path;
}

/** Is an intent waiting? Does NOT consume it. */
export function hasPostAuthIntent(): boolean {
    return pendingPath !== null;
}

/** Consume the intent. Returns null when there is none. */
export function takePostAuthIntent(): string | null {
    const path = pendingPath;
    pendingPath = null;
    return path;
}

/** Drop the intent — the visitor closed the modal without signing in. */
export function clearPostAuthIntent(): void {
    pendingPath = null;
}
