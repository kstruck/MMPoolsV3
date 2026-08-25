import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Which callables leave a trace in Cloud Functions logs, and which are invisible.
 *
 * WHY THIS EXISTS. On 2026-08-07 Kevin ran the NFL Schedule import from
 * SuperAdmin and reported it as a silent no-op: nothing visibly happened, and
 * `importNFLSchedule` had **zero invocation logs**. The absent log was read as
 * evidence the click never reached the callable. It was not evidence of
 * anything.
 *
 * `validated()` (functions/src/lib/validated.ts) is the trust-boundary wrapper
 * every hardened callable goes through, and ALL of its logging is conditional:
 *
 *     if (correlationId) logger.info(`[correlation] ${label} start`, …)
 *     …
 *     if (correlationId) logger.error(`[correlation] ${label} error`, …)
 *
 * With no `_correlationId` in the payload it emits nothing on entry, nothing on
 * success, and — the one that matters here — **nothing when it rejects the call
 * at the auth, role or schema gate**. So for such a callable, "no logs" is what
 * a successful run looks like, what a permission-denied looks like, and what a
 * call that never arrived looks like. Three very different states, one identical
 * signal.
 *
 * `src/utils/correlationId.ts` exists precisely to fix this, and 31 of the 66
 * callables in dbService already use it. This test stops that number going
 * backwards, and makes each remaining gap a deliberate, listed decision rather
 * than an oversight.
 *
 * ⚠️ THIS IS A RATCHET, NOT A BAN. The list below is allowed to SHRINK freely;
 * growing it requires editing this file, which is the point. Do not "fix" a
 * failure by adding the new callable to the list without saying why in the PR.
 *
 * ⚠️ AND IT IS NOT A BLANKET LICENCE TO ADD `withCorrelationId` EVERYWHERE.
 * 25 callables in `functions/src` are still bare `onCall(...)` rather than
 * `validated(...)`, and a bare handler reads `request.data` directly — so an
 * extra `_correlationId` key reaches it unstripped and could fail a strict
 * schema or be persisted. Check the backend wrapper before removing an entry.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const DB_SERVICE = path.join(REPO_ROOT, 'src', 'services', 'dbService.ts');

/** `httpsCallable<…>(functions, 'name')` — the only way this file calls a callable. */
const CALLABLE = /httpsCallable[^(]*\(\s*functions\s*,\s*['"]([A-Za-z0-9_]+)['"]/;

/**
 * How many lines after the declaration to look for the invocation. The wrapper
 * bodies in this file are short; 12 lines spans every one of them, and the
 * "found some" assertion below fails loudly if the shape ever drifts.
 */
const LOOKAHEAD = 12;

/**
 * Blank out comments before scanning, so PROSE cannot vouch for CODE.
 *
 * The first version of this scan matched the bare substring `withCorrelationId`
 * anywhere in the window — and the wrappers this PR fixed carry comments that
 * name the helper. Deleting the actual call while leaving the comment would have
 * left the ratchet green: a guard satisfied by its own documentation, which is
 * the exact shape `heartbeat.test.ts` already blanks comments to avoid. Found by
 * qodo on PR #397.
 *
 * Replaced with spaces rather than removed so line indices stay exact.
 *
 * WARNING: THE BLOCK-COMMENT BRANCH KEEPS ITS NEWLINES, and that is a fix, not
 * a flourish. Blanking a multi-line block comment to a run of spaces collapsed
 * it into ONE line, so every line below it shifted UP -- and the LOOKAHEAD
 * window then reached past the wrapper it belongs to and into the NEXT one.
 * Measured 2026-08-23: adding a correlated wrapper below
 * `adminUpdatePoolBilling`, with a doc comment between them, made the ratchet
 * report `adminUpdatePoolBilling` as fixed. A guard that credits one callable
 * for its neighbour's correlation id is worse than no guard.
 * The `(?<!:)` keeps `https://` from being read as a line comment.
 */
function blankComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** A real invocation, not a mention: `withCorrelationId(` with its open paren. */
const CALL = /withCorrelationId\s*\(/;

function callablesMissingCorrelation(src: string): string[] {
  const lines = blankComments(src).split(/\r?\n/);
  const missing: string[] = [];
  lines.forEach((line, i) => {
    const m = CALLABLE.exec(line);
    if (!m) return;
    const window = lines.slice(i, i + LOOKAHEAD).join('\n');
    if (!CALL.test(window)) missing.push(m[1]);
  });
  return [...new Set(missing)].sort();
}

/**
 * Callables that do NOT attach a correlation id today. Every one of them is
 * invisible in logs unless it throws all the way out of the function.
 *
 * Baselined 2026-08-08 at 35 (down from 37: `importNFLSchedule` and
 * `scoreNFLWeek` were fixed in the same PR that wrote this file — the reported
 * import button, and the commissioner Score & Recap button, which is the
 * documented FALLBACK for automated scoring and so the worst possible place to
 * have no trace).
 *
 * The rest are a real, named backlog. The admin and billing clusters
 * (`adminAdjustUserCredits`, `adminSaveBillingConfig`, `setUserRole`,
 * `redeemCoupon`, `confirmPayment`, `createCheckoutSession`…) are the ones worth
 * doing next: they are money- and authorization-adjacent, which is exactly where
 * "did that actually run?" needs an answer.
 */
const KNOWN_UNTRACED = [
  'acknowledgeMonetizationAlert',
  'adminAdjustUserCredits',
  'adminGrantEntitlement',
  'adminManageCoupon',
  'adminRevokeEntitlement',
  'adminSaveBillingConfig',
  'adminUpdatePoolBilling',
  'backfillUserRoles',
  'cancelPool',
  'closePool',
  'confirmPayment',
  'createCheckoutSession',
  'createCouponTemplate',
  'createNFLPool',
  'createPool',
  'deleteCouponTemplate',
  'deleteUserAccount',
  'extendWeekDeadline',
  'fixParticipantIds',
  'fixPoolScores',
  'getPoolQuote',
  'joinNFLPool',
  'logAdminAction',
  'mintCouponFromTemplate',
  'proxyPick',
  'recalculateGlobalStats',
  'redeemCoupon',
  'redeemPoolCredit',
  'searchUsersByEmail',
  'sendAdminPasswordReset',
  'sendManualReminder',
  'sendUserEmail',
  'setUserRole',
  'updateCouponTemplate',
  'updatePoolSettings',
].sort();

describe('callable correlation coverage', () => {
  const src = fs.readFileSync(DB_SERVICE, 'utf8');
  const missing = callablesMissingCorrelation(src);

  // Guards the regex. Without this the whole file passes vacuously the moment
  // the callable declaration shape changes.
  it('finds the callables (the scan is not matching nothing)', () => {
    const total = src.split(/\r?\n/).filter((l) => CALLABLE.test(l)).length;
    expect(total).toBeGreaterThanOrEqual(50);
  });

  // Pins the comment-blanking above, on a fixture rather than on the real file —
  // otherwise the protection is asserted only by the absence of a failure.
  it('a COMMENT naming the helper does not count as using it', () => {
    const commentOnly = [
      "const fn = httpsCallable<A, B>(functions, 'fakeCallable');",
      '// withCorrelationId is deliberately not used here',
      '/* withCorrelationId( — even with a paren, inside a block comment */',
      'const r = await fn(payload);',
    ].join('\n');
    expect(callablesMissingCorrelation(commentOnly)).toEqual(['fakeCallable']);
  });

  it('a real call DOES count', () => {
    const realCall = [
      "const fn = httpsCallable<A, B>(functions, 'fakeCallable');",
      'const r = await fn(withCorrelationId(payload));',
    ].join('\n');
    expect(callablesMissingCorrelation(realCall)).toEqual([]);
  });

  it('no NEW callable ships without a correlation id', () => {
    const added = missing.filter((c) => !KNOWN_UNTRACED.includes(c));
    expect(
      added,
      'this callable attaches no _correlationId, so validated() logs NOTHING for ' +
        'it — not on entry, not on success, and not when it rejects the call at ' +
        'the auth/role/schema gate. Wrap its payload in withCorrelationId(), or ' +
        'add it to KNOWN_UNTRACED with a reason in the PR',
    ).toEqual([]);
  });

  it('KNOWN_UNTRACED carries no entry that has since been fixed', () => {
    const stale = KNOWN_UNTRACED.filter((c) => !missing.includes(c));
    expect(
      stale,
      'these now attach a correlation id — remove them from KNOWN_UNTRACED so the ' +
        'ratchet keeps tightening',
    ).toEqual([]);
  });

  // The two this PR fixed, pinned by name. The ratchet above would let both
  // regress silently: removing withCorrelationId from either puts it back in
  // `missing`, and `added` stays empty only because... it would NOT stay empty,
  // since neither is in KNOWN_UNTRACED. Stated explicitly anyway, because these
  // two are the reason the file exists and a future edit to KNOWN_UNTRACED
  // could re-admit them.
  it('the reported import button and the manual scoring fallback are traced', () => {
    expect(missing).not.toContain('importNFLSchedule');
    expect(missing).not.toContain('scoreNFLWeek');
    expect(KNOWN_UNTRACED).not.toContain('importNFLSchedule');
    expect(KNOWN_UNTRACED).not.toContain('scoreNFLWeek');
  });
});
