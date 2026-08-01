/**
 * Central error → user-facing message mapping.
 * Every catch block that shows an error to the user should route through
 * getUserMessage() so users see actionable copy, never raw codes or stack text.
 */

interface ErrorLike {
    code?: string;
    message?: string;
}

// Server callables prefix domain errors inside the message, e.g.
// "WEEK_LOCKED: All picks in weekly lock pools are locked."
const DOMAIN_PREFIX_MESSAGES: Record<string, string> = {
    WEEK_LOCKED: 'This week is locked — the first game has already kicked off, so picks can no longer be changed.',
    GAME_LOCKED: 'That game has already started, so this pick is locked. Your other picks were not affected — review and resubmit them.',
    SPREADS_NOT_LOCKED: "This week's spreads aren't finalized yet. Picks open once all lines are set — check back soon.",
    ELIMINATED: "You've been eliminated from this pool, so new picks can't be submitted.",
    NOT_ELIMINATED: 'A rebuy is only available after elimination.',
    HARD_WEEKLY_LOCK: 'Survivor and Margin pools use a fixed weekly deadline before the first kickoff, so a week cannot be reopened once it locks. The Pick Deadline setting controls how early picks close for weeks that have not locked yet.',
    // setPaidStatus refuses a payment self-report from someone the pool cannot
    // prove is a member. Without this entry the prefix falls through to the
    // generic permission-denied copy ("contact your pool commissioner"), which
    // tells a legacy member nothing about what is actually wrong.
    //
    // ⚠️ NOT reachable from today's UI: nothing in `src/` sends `claim` to
    // setPaidStatus or reads `memberReportedPaid` — the self-report is a
    // server-side capability with no front end yet. Wired here anyway, per
    // PLAN-SETPAIDSTATUS-MEMBERSHIP D3: an unregistered prefix is a machine
    // token in front of a message nobody sees, and the half that is easy to
    // forget is this one.
    NOT_A_POOL_MEMBER: "You're not listed as a member of this pool, so a payment can't be reported against it. If you joined and this looks wrong, ask the commissioner to add you to the roster.",
    // setPaidStatus throws `not-found` for BOTH "pool missing" and "member not
    // on the roster". Without this prefix the second renders as "that pool or
    // entry couldn't be found" — about a pool plainly on the commissioner's
    // screen. See PLAN-PAYMENT-TRUTH §6b round 4.
    MEMBER_NOT_ON_ROSTER: "That member is no longer on this pool's roster, so their payment status cannot be changed. Refresh the roster to see the current members.",
};

const AUTH_MESSAGES: Record<string, string> = {
    'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
    'auth/invalid-email': "That doesn't look like a valid email address.",
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/wrong-password': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
    'auth/network-request-failed': 'Network problem — check your connection and try again.',
    'auth/popup-closed-by-user': 'Sign-in window was closed before finishing. Try again when ready.',
    'auth/invalid-action-code': 'This link has expired or was already used. Request a new one below.',
    'auth/expired-action-code': 'This link has expired. Request a new one below.',
};

const GENERIC_CODE_MESSAGES: Record<string, string> = {
    'permission-denied': "You don't have permission to do that. If this seems wrong, contact your pool commissioner.",
    'functions/permission-denied': "You don't have permission to do that. If this seems wrong, contact your pool commissioner.",
    'unauthenticated': 'Your session has expired. Please sign in again.',
    'functions/unauthenticated': 'Your session has expired. Please sign in again.',
    'unavailable': 'Connection problem — the server is unreachable. Check your network and try again.',
    'functions/unavailable': 'Connection problem — the server is unreachable. Check your network and try again.',
    'functions/resource-exhausted': 'Too many requests right now. Wait a moment and try again.',
    'functions/deadline-exceeded': 'The request timed out. Check your connection and try again — your previous picks are unchanged until a submit succeeds.',
    'functions/not-found': "That pool or entry couldn't be found. It may have been removed.",
    'functions/already-exists': 'That already exists — you may have submitted this twice.',
};

export function getUserMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
    const e = (err ?? {}) as ErrorLike;
    const message = typeof e.message === 'string' ? e.message : '';
    const code = typeof e.code === 'string' ? e.code : '';

    // 1. Domain-prefixed messages from callables (highest specificity)
    const prefix = message.match(/^([A-Z_]{4,}):/)?.[1];
    if (prefix && DOMAIN_PREFIX_MESSAGES[prefix]) return DOMAIN_PREFIX_MESSAGES[prefix];

    // 2. Firebase Auth codes
    if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];

    // 3. Firestore / callable transport codes
    if (GENERIC_CODE_MESSAGES[code]) return GENERIC_CODE_MESSAGES[code];

    // 4. Browser-level offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return "You're offline. Reconnect and try again — nothing was submitted.";
    }
    if (/network|fetch|Failed to load/i.test(message)) {
        return 'Network problem — check your connection and try again.';
    }

    return fallback;
}

/** True when the server rejected because a deadline passed — callers can render lock-specific UI. */
export function isLockError(err: unknown): boolean {
    const message = ((err ?? {}) as ErrorLike).message ?? '';
    return /^(WEEK_LOCKED|GAME_LOCKED):/.test(message);
}
